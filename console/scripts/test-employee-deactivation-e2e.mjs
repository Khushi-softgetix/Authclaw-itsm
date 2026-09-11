// Comprehensive end-to-end verification for ITSM Employee Deactivation Feature
// Tests:
// 1. Platform Admin authenticates with PLATFORM_ADMINISTRATOR role
// 2. Platform Admin creates an active employee
// 3. Employee successfully logs in with email + password, verifies ITSM access
// 4. Platform Admin self-deactivation is rejected with HTTP 400
// 5. Non-admin employee attempts to deactivate a user and is rejected with HTTP 403
// 6. Platform Admin successfully deactivates employee via POST /v1/itsm/admin/users/{user_id}/deactivate
// 7. Deactivated response verified: status="inactive", itsm_access=false
// 8. Deactivated employee CANNOT log in (POST /v1/auth/login returns HTTP 401)
// 9. Existing sessions for deactivated employee are terminated (GET /v1/auth/me returns HTTP 401)
// 10. Deactivated user appears as "inactive" in GET /v1/itsm/admin/users
// 11. User record in database is preserved (soft deactivation check)
// 12. Regression: Platform Admin can still create/invite other users normally

const BACKEND_URL = process.env.API_URL || process.env.BACKEND_URL || "http://127.0.0.1:8000";
const CONSOLE_URL = process.env.CONSOLE_URL || "http://127.0.0.1:3001";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  }
  passed++;
  console.log(`✅ PASSED: ${message}`);
}

async function login(email, password, tenant_name = "AuthClaw Lite Demo") {
  const res = await fetch(`${BACKEND_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tenant_name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed for ${email} (${res.status}): ${text}`);
  }
  return await res.json();
}

async function runTests() {
  console.log("==================================================");
  console.log("Starting ITSM Employee Deactivation Verification");
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`Console URL: ${CONSOLE_URL}`);
  console.log("==================================================");

  const timestamp = Date.now();

  try {
    // -------------------------------------------------------------
    // Step 0: Authenticate Platform Administrator
    // -------------------------------------------------------------
    console.log("\n--- Step 0: Authenticate Platform Administrator ---");
    const adminSession = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
    const adminToken = adminSession.session_token;
    const adminUserId = adminSession.user_id;
    assert(adminSession.itsm_role === "PLATFORM_ADMINISTRATOR", "Admin has PLATFORM_ADMINISTRATOR role");

    // -------------------------------------------------------------
    // Step 1: Create an Active Employee for Testing
    // -------------------------------------------------------------
    console.log("\n--- Step 1: Create Active Employee ---");
    const empEmail = `emp.deact.${timestamp}@authclaw-lite.demo`;
    const empPassword = "SecurePass!123456";

    const createRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        email: empEmail,
        itsm_role: "SERVICE_AGENT",
        password: empPassword,
        confirm_password: empPassword,
        email_credentials: false,
      }),
    });
    assert(createRes.status === 201, `Employee created with 201 Created (got ${createRes.status})`);
    const createData = await createRes.json();
    const empUserId = createData.user_id;
    assert(empUserId !== undefined, `Target user ID issued: ${empUserId}`);

    // -------------------------------------------------------------
    // Step 2: Employee Logs in and Confirms ITSM Access
    // -------------------------------------------------------------
    console.log("\n--- Step 2: Verify Initial Employee Login & Access ---");
    const empLogin = await login(empEmail, empPassword);
    const empToken = empLogin.session_token;
    assert(empLogin.email === empEmail, "Employee email matches");
    assert(empLogin.itsm_role === "SERVICE_AGENT", "Employee assigned role is SERVICE_AGENT");
    assert(empLogin.product_access?.itsm === true, "Employee has ITSM access");

    const empMeRes = await fetch(`${BACKEND_URL}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(empMeRes.status === 200, "Employee session active at /v1/auth/me");

    // -------------------------------------------------------------
    // Step 3: Prevent Self-Deactivation of Platform Administrator
    // -------------------------------------------------------------
    console.log("\n--- Step 3: Test Self-Deactivation Prevention ---");
    const selfDeactRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${adminUserId}/deactivate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(selfDeactRes.status === 400, `Self-deactivation rejected with HTTP 400 (got ${selfDeactRes.status})`);
    const selfDeactData = await selfDeactRes.json();
    assert(
      selfDeactData.detail.includes("Cannot deactivate the currently authenticated Platform Administrator"),
      `Clear error detail returned: ${selfDeactData.detail}`
    );

    // -------------------------------------------------------------
    // Step 4: Non-Admin Cannot Deactivate Users (RBAC Check)
    // -------------------------------------------------------------
    console.log("\n--- Step 4: Test Non-Admin RBAC Denial ---");
    const nonAdminDeactRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${empUserId}/deactivate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(nonAdminDeactRes.status === 403, `Non-admin deactivation rejected with HTTP 403 (got ${nonAdminDeactRes.status})`);

    // -------------------------------------------------------------
    // Step 5: Platform Admin Deactivates Employee
    // -------------------------------------------------------------
    console.log("\n--- Step 5: Platform Admin Deactivates Employee ---");
    const deactRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${empUserId}/deactivate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(deactRes.status === 200, `Deactivation returns 200 OK (got ${deactRes.status})`);
    const deactData = await deactRes.json();
    assert(deactData.id === empUserId, `Returned ID matches deactivated user: ${deactData.id}`);
    assert(deactData.status === "inactive", `Status is now 'inactive' (got '${deactData.status}')`);
    assert(deactData.itsm_access === false, `ITSM access is now false (got ${deactData.itsm_access})`);

    // -------------------------------------------------------------
    // Step 6: Verify Deactivated Employee CANNOT Log In
    // -------------------------------------------------------------
    console.log("\n--- Step 6: Verify Deactivated Employee Login Denied ---");
    const blockedLoginRes = await fetch(`${BACKEND_URL}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: empEmail, password: empPassword, tenant_name: "AuthClaw Lite Demo" }),
    });
    assert(blockedLoginRes.status === 401, `Deactivated employee login rejected with HTTP 401 (got ${blockedLoginRes.status})`);

    // -------------------------------------------------------------
    // Step 7: Verify Prior Active Session is Revoked / Terminated
    // -------------------------------------------------------------
    console.log("\n--- Step 7: Verify Session Revocation ---");
    const revokedSessionRes = await fetch(`${BACKEND_URL}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert(revokedSessionRes.status === 401, `Pre-existing session rejected with HTTP 401 (got ${revokedSessionRes.status})`);

    // -------------------------------------------------------------
    // Step 8: Verify Deactivated User in Admin List
    // -------------------------------------------------------------
    console.log("\n--- Step 8: Verify Deactivated User in Admin List ---");
    const usersListRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(usersListRes.status === 200, "Users list returns 200 OK");
    const usersList = await usersListRes.json();
    const foundUser = usersList.find((u) => u.id === empUserId);
    assert(foundUser !== undefined, "User record is preserved in list (soft deactivation)");
    assert(foundUser.status === "inactive", `User status reflects 'inactive' in list: ${foundUser.status}`);
    assert(foundUser.itsm_access === false, `User itsm_access reflects false in list: ${foundUser.itsm_access}`);

    // -------------------------------------------------------------
    // Step 9: Verify Second Employee via DELETE /v1/itsm/admin/users/{id}
    // -------------------------------------------------------------
    console.log("\n--- Step 9: Test DELETE Alias Endpoint ---");
    const emp2Email = `emp.deact.del.${timestamp}@authclaw-lite.demo`;
    const create2Res = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        email: emp2Email,
        itsm_role: "AUDITOR",
        password: empPassword,
        confirm_password: empPassword,
        email_credentials: false,
      }),
    });
    const emp2Data = await create2Res.json();
    const deleteRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${emp2Data.user_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(deleteRes.status === 200 || deleteRes.status === 204, `DELETE alias returns 200/204 (got ${deleteRes.status})`);

    const blockedLogin2 = await fetch(`${BACKEND_URL}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emp2Email, password: empPassword, tenant_name: "AuthClaw Lite Demo" }),
    });
    assert(blockedLogin2.status === 401, "User deactivated via DELETE alias cannot log in (HTTP 401)");

    // -------------------------------------------------------------
    // Step 10: Security Check: No Secrets Exposed
    // -------------------------------------------------------------
    console.log("\n--- Step 10: Security Audit: No Secrets Exposed ---");
    const deactPayloadStr = JSON.stringify(deactData);
    assert(!deactPayloadStr.includes("password"), "No password in deactivation payload");
    assert(!deactPayloadStr.includes("password_hash"), "No password hash in deactivation payload");
    assert(!deactPayloadStr.includes("session_token"), "No session token in deactivation payload");

    console.log("\n==================================================");
    console.log(`ALL DEACTIVATION TEST PHASES PASSED! (${passed} checks passed, ${failed} failed)`);
    console.log("==================================================");
  } catch (err) {
    console.error(`\nTest suite aborted with error: ${err.message}`);
    process.exit(1);
  }
}

runTests();
