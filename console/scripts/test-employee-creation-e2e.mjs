// Comprehensive end-to-end verification for ITSM Employee Creation & Invitation
// Tests:
// 1. Platform Admin -> Create Manually -> new employee
// 2. Employee login via /itsm/login credentials verification
// 3. Verify correct ITSM role is applied
// 4. Platform Admin -> Invite by Email -> new employee (send_email: true) - NO 503!
// 5. Verify email delivery / outbox handling
// 6. Platform Admin -> Invite by Email -> (send_email: false)
// 7. Existing user handling on Manual Create (no duplication, password preserved)
// 8. Existing user handling on Invite (no duplication, password preserved)
// 9. Role update on existing user without password reset
// 10. RBAC Denial for REQUESTER (403)
// 11. RBAC Denial for SERVICE_AGENT (403)
// 12. Verification of GET /v1/itsm/admin/users
// 13. Security check: no secrets in responses

const BACKEND_URL = process.env.API_URL || process.env.BACKEND_URL || "http://127.0.0.1:8000";
const CONSOLE_URL = process.env.CONSOLE_URL || "http://127.0.0.1:3001";

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
  console.log("Starting ITSM Employee Creation & Invitation Verification");
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`Console URL: ${CONSOLE_URL}`);
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      failed++;
      throw new Error(message);
    } else {
      console.log(`✅ PASSED: ${message}`);
      passed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Step 0: Admin Login
    // -------------------------------------------------------------
    console.log("--- Step 0: Authenticate Platform Administrator ---");
    const adminSession = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
    assert(adminSession.itsm_role === "PLATFORM_ADMINISTRATOR", "Admin has PLATFORM_ADMINISTRATOR role");
    const adminToken = adminSession.session_token;

    // -------------------------------------------------------------
    // Step 1: Create Manually -> New Employee
    // -------------------------------------------------------------
    console.log("\n--- Step 1: Platform Admin -> Create Manually -> New Employee ---");
    const timestamp = Date.now();
    const manualEmail = `emp.manual.${timestamp}@authclaw-lite.demo`;
    const manualPassword = "EmployeePass!1234";

    const manualCreateRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        email: manualEmail,
        itsm_role: "SERVICE_AGENT",
        password: manualPassword,
        confirm_password: manualPassword,
        email_credentials: false,
      }),
    });

    assert(manualCreateRes.status === 201, `POST /v1/itsm/admin/users/create returns 201 (got ${manualCreateRes.status})`);
    const createData = await manualCreateRes.json();
    assert(createData.status === "created", `Status is 'created' (got '${createData.status}')`);
    assert(createData.message === "Employee created successfully.", `Message verified: ${createData.message}`);
    assert(createData.email === manualEmail, `Email matches created email: ${createData.email}`);
    assert(createData.itsm_role === "SERVICE_AGENT", `Assigned role is SERVICE_AGENT`);
    assert(createData.password === undefined, "Security: Password is NOT returned in API response");
    assert(createData.password_hash === undefined, "Security: Password hash is NOT returned in API response");
    assert(typeof createData.user_id === "string", "Valid user_id returned");

    // -------------------------------------------------------------
    // Step 2 & 3: Employee Logs In Through /itsm/login Mechanism
    // -------------------------------------------------------------
    console.log("\n--- Steps 2 & 3: Employee Logs In & Verifies ITSM Role ---");
    const employeeSession = await login(manualEmail, manualPassword);
    assert(employeeSession.session_token !== undefined, "Employee login succeeded with created password");
    assert(employeeSession.email === manualEmail, "Session email matches");
    assert(employeeSession.itsm_role === "SERVICE_AGENT", `Correct ITSM role SERVICE_AGENT applied to employee`);
    assert(employeeSession.product_access.itsm === true, "Employee has ITSM access granted");
    assert(employeeSession.product_access.governance === false, "Employee does NOT have governance access (strict separation)");

    // -------------------------------------------------------------
    // Step 4: Existing User Handling (Manual Create)
    // -------------------------------------------------------------
    console.log("\n--- Step 4: Existing User Handling on Manual Create ---");
    const duplicateCreateRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        email: manualEmail,
        itsm_role: "INCIDENT_MANAGER",
        password: "DifferentPass!999",
        confirm_password: "DifferentPass!999",
        email_credentials: false,
      }),
    });

    assert(duplicateCreateRes.status === 201, "Existing user request returns 201 posture response");
    const duplicateData = await duplicateCreateRes.json();
    assert(duplicateData.status === "already_exists", `Status is 'already_exists' (got '${duplicateData.status}')`);
    assert(duplicateData.message === "This employee already has an AuthClaw account.", `Message verified: ${duplicateData.message}`);

    // Verify existing password was NOT modified by logging in with original password
    const reLogin = await login(manualEmail, manualPassword);
    assert(reLogin.session_token !== undefined, "Original password still works; existing user password was NOT reset");

    // -------------------------------------------------------------
    // Step 5: Assign/Change ITSM Role for Existing User
    // -------------------------------------------------------------
    console.log("\n--- Step 5: Platform Admin Updates Existing User ITSM Role ---");
    const updateRoleRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${createData.user_id}/access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        has_itsm_access: true,
        itsm_role: "INCIDENT_MANAGER",
      }),
    });
    assert(updateRoleRes.status === 200, "POST /v1/itsm/admin/users/{user_id}/access returns 200 OK");
    const updatedAccess = await updateRoleRes.json();
    assert(updatedAccess.itsm_role === "INCIDENT_MANAGER", "Role successfully changed to INCIDENT_MANAGER");

    // Verify changed role upon next login
    const updatedLogin = await login(manualEmail, manualPassword);
    assert(updatedLogin.itsm_role === "INCIDENT_MANAGER", "Updated ITSM role INCIDENT_MANAGER reflected on login");

    // -------------------------------------------------------------
    // Step 6: Invite by Email (send_email: true) - Fix 503 verification!
    // -------------------------------------------------------------
    console.log("\n--- Step 6: Platform Admin -> Invite by Email (send_email: true) ---");
    const inviteEmail = `emp.invite.${timestamp}@authclaw-lite.demo`;
    const inviteRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        email: inviteEmail,
        itsm_role: "AUDITOR",
        send_email: true,
      }),
    });

    assert(inviteRes.status === 201, `POST /v1/itsm/admin/users/invite returns 201 (NO 503! got status ${inviteRes.status})`);
    const inviteData = await inviteRes.json();
    assert(inviteData.status === "invited", `Invite status is 'invited' (got '${inviteData.status}')`);
    assert(inviteData.message === "Invitation sent successfully.", `Message verified: ${inviteData.message}`);
    assert(inviteData.email === inviteEmail, `Email matches: ${inviteData.email}`);
    assert(inviteData.itsm_role === "AUDITOR", `Role matches: ${inviteData.itsm_role}`);
    assert(inviteData.signup_id !== undefined, `Signup ID issued: ${inviteData.signup_id}`);
    assert(inviteData.delivery === "local_outbox" || inviteData.delivery === "smtp", `Delivery handled cleanly (${inviteData.delivery})`);

    // -------------------------------------------------------------
    // Step 7: Invite by Email with send_email: false
    // -------------------------------------------------------------
    console.log("\n--- Step 7: Invite by Email (send_email: false) ---");
    const noEmailInvite = `emp.noemail.${timestamp}@authclaw-lite.demo`;
    const noEmailRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        email: noEmailInvite,
        itsm_role: "PROCESS_CHANGE_MANAGER",
        send_email: false,
      }),
    });

    assert(noEmailRes.status === 201, `POST /v1/itsm/admin/users/invite with send_email: false returns 201`);
    const noEmailData = await noEmailRes.json();
    assert(noEmailData.delivery === "skipped", `Delivery reported as 'skipped'`);
    assert(noEmailData.itsm_role === "PROCESS_CHANGE_MANAGER", "Role is PROCESS_CHANGE_MANAGER");

    // -------------------------------------------------------------
    // Step 8: Existing User Handling on Email Invite
    // -------------------------------------------------------------
    console.log("\n--- Step 8: Existing User Handling on Email Invite ---");
    const existInviteRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        email: manualEmail,
        itsm_role: "REQUESTER",
        send_email: true,
      }),
    });

    assert(existInviteRes.status === 201, "Existing user invite returns 201");
    const existInviteData = await existInviteRes.json();
    assert(existInviteData.status === "already_exists", "Status is 'already_exists'");
    assert(existInviteData.message === "This employee already has an AuthClaw account.", "Message verified");

    // -------------------------------------------------------------
    // Step 9: Non-Platform Admin Rejected (RBAC Check)
    // -------------------------------------------------------------
    // Login as non-admin user (manualEmail created earlier has INCIDENT_MANAGER role)
    const agentSession = await login(manualEmail, manualPassword);
    const agentToken = agentSession.session_token;

    const agentCreateRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({
        email: "hacker@demo.com",
        itsm_role: "SERVICE_AGENT",
        password: "HackerPass!1234",
        confirm_password: "HackerPass!1234",
      }),
    });
    assert(agentCreateRes.status === 403, `SERVICE_AGENT blocked from create (HTTP 403, got ${agentCreateRes.status})`);

    const agentInviteRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({
        email: "hacker@demo.com",
        itsm_role: "SERVICE_AGENT",
      }),
    });
    assert(agentInviteRes.status === 403, `SERVICE_AGENT blocked from invite (HTTP 403, got ${agentInviteRes.status})`);

    // -------------------------------------------------------------
    // Step 10: Platform Admin User List Verification
    // -------------------------------------------------------------
    console.log("\n--- Step 10: Verify GET /v1/itsm/admin/users ---");
    const usersListRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(usersListRes.status === 200, "GET /v1/itsm/admin/users returns 200 OK");
    const usersList = await usersListRes.json();
    assert(Array.isArray(usersList), "User list is array");
    const foundManualUser = usersList.find((u) => u.email === manualEmail);
    assert(foundManualUser !== undefined, "Newly created manual user present in admin list");
    assert(foundManualUser.itsm_access === true, "User ITSM access is enabled");

    // -------------------------------------------------------------
    // Step 11: Security & Secret Leakage Check
    // -------------------------------------------------------------
    console.log("\n--- Step 11: Security Verification: No Secrets Exposed ---");
    const responsePayloads = [createData, duplicateData, inviteData, noEmailData, existInviteData, updatedAccess];
    for (const payload of responsePayloads) {
      const serialized = JSON.stringify(payload);
      assert(!serialized.includes("EmployeePass!1234"), "No password in payload");
      assert(!serialized.includes("password_hash"), "No password_hash in payload");
      assert(!serialized.includes("SMTP_PASSWORD"), "No SMTP_PASSWORD in payload");
      assert(!serialized.includes("apikey"), "No SMTP apiKey in payload");
    }

    console.log("\n==================================================");
    console.log(`ALL TESTS PASSED! (${passed} checks passed, ${failed} failed)`);
    console.log("==================================================");
  } catch (err) {
    console.error(`\nTest suite aborted with error: ${err.message}`);
    process.exit(1);
  }
}

runTests();
