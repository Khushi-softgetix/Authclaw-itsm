// End-to-end verification script for Phase 4 ITSM Platform Administrator Portal
// Tests Scenarios A through J against live backend and console.

import fs from "node:fs";
import path from "node:path";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const CONSOLE_URL = process.env.CONSOLE_URL || "http://127.0.0.1:3001";

async function login(email, password) {
  const res = await fetch(`${BACKEND_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tenant_name: "AuthClaw Lite Demo" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed for ${email} (${res.status}): ${text}`);
  }
  return await res.json();
}

async function runTests() {
  console.log("==================================================");
  console.log("Starting ITSM Platform Administrator Portal Verification");
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
    // Test A: Platform Administrator Access
    // -------------------------------------------------------------
    console.log("--- Test A: Platform Administrator Access ---");
    const adminSession = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
    assert(adminSession.itsm_role === "PLATFORM_ADMINISTRATOR", "Admin has PLATFORM_ADMINISTRATOR role");
    assert(adminSession.product_access?.itsm === true, "Admin has ITSM product access");

    const adminToken = adminSession.session_token;
    const adminUsersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminUsersRes.status === 200, "Platform Administrator can access GET /v1/itsm/admin/users (200 OK)");

    const usersList = await adminUsersRes.json();
    assert(Array.isArray(usersList) && usersList.length > 0, `Users list returned ${usersList.length} tenant members`);

    const sampleUser = usersList[0];
    assert("id" in sampleUser, "User record includes id");
    assert("name" in sampleUser, "User record includes name");
    assert("email" in sampleUser, "User record includes email");
    assert("itsm_access" in sampleUser, "User record includes itsm_access");
    assert("itsm_role" in sampleUser, "User record includes itsm_role");
    assert("governance_access" in sampleUser, "User record includes governance_access");
    assert("status" in sampleUser, "User record includes status");

    // Test console SSR access for Platform Administrator
    const adminPortalHtmlRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${adminToken}` },
      redirect: "manual",
    });
    assert(
      adminPortalHtmlRes.status === 200,
      `Platform Admin receives 200 OK on /itsm/admin-portal (Got ${adminPortalHtmlRes.status})`
    );

    const adminUsersHtmlRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal/users`, {
      headers: { Cookie: `authclaw_session=${adminToken}` },
      redirect: "manual",
    });
    assert(
      adminUsersHtmlRes.status === 200,
      `Platform Admin receives 200 OK on /itsm/admin-portal/users (Got ${adminUsersHtmlRes.status})`
    );

    // Test dedicated user access page for Platform Administrator
    const adminUserDetailRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal/users/${sampleUser.id}`, {
      headers: { Cookie: `authclaw_session=${adminToken}` },
      redirect: "manual",
    });
    assert(
      adminUserDetailRes.status === 200,
      `Platform Admin receives 200 OK on /itsm/admin-portal/users/${sampleUser.id} (Got ${adminUserDetailRes.status})`
    );
    const adminUserDetailHtml = await adminUserDetailRes.text();
    assert(
      adminUserDetailHtml.includes("Back to Users"),
      "Dedicated user access page renders 'Back to Users' link"
    );
    assert(
      adminUserDetailHtml.includes("Edit ITSM Access"),
      "Dedicated user access page renders 'Edit ITSM Access' heading"
    );

    // Test legacy redirects
    const legacyAdminRes = await fetch(`${CONSOLE_URL}/itsm/admin`, {
      headers: { Cookie: `authclaw_session=${adminToken}` },
      redirect: "manual",
    });
    assert(
      legacyAdminRes.status === 307 || legacyAdminRes.status === 308 || legacyAdminRes.status === 302,
      `Legacy /itsm/admin redirects (Status ${legacyAdminRes.status})`
    );
    assert(
      (legacyAdminRes.headers.get("location") || "").includes("/itsm/admin-portal"),
      `Legacy /itsm/admin redirects to /itsm/admin-portal (Location: ${legacyAdminRes.headers.get("location")})`
    );

    const legacyUsersRes = await fetch(`${CONSOLE_URL}/itsm/admin/users`, {
      headers: { Cookie: `authclaw_session=${adminToken}` },
      redirect: "manual",
    });
    assert(
      legacyUsersRes.status === 307 || legacyUsersRes.status === 308 || legacyUsersRes.status === 302,
      `Legacy /itsm/admin/users redirects (Status ${legacyUsersRes.status})`
    );
    assert(
      (legacyUsersRes.headers.get("location") || "").includes("/itsm/admin-portal/users"),
      `Legacy /itsm/admin/users redirects to /itsm/admin-portal/users (Location: ${legacyUsersRes.headers.get("location")})`
    );

    // -------------------------------------------------------------
    // Test B: Requester Access Denied
    // -------------------------------------------------------------
    console.log("\n--- Test B: Requester Role Access Denied ---");
    const requesterSession = await login("requester123@gmail.com", "Requester@123");
    assert(requesterSession.itsm_role === "REQUESTER", "Requester has REQUESTER role");

    const requesterUsersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${requesterSession.session_token}` },
    });
    assert(
      requesterUsersRes.status === 403,
      `Requester is denied access to /v1/itsm/admin/users (Expected 403, Got ${requesterUsersRes.status})`
    );

    const requesterPortalHtml = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${requesterSession.session_token}` },
      redirect: "manual",
    });
    assert(
      requesterPortalHtml.status === 307 || requesterPortalHtml.status === 302,
      `Requester is redirected from /itsm/admin-portal (Status ${requesterPortalHtml.status})`
    );
    assert(
      (requesterPortalHtml.headers.get("location") || "").includes("admin_required"),
      `Requester redirected to /itsm/incidents?error=admin_required (Location: ${requesterPortalHtml.headers.get("location")})`
    );

    const requesterDetailHtml = await fetch(`${CONSOLE_URL}/itsm/admin-portal/users/${sampleUser.id}`, {
      headers: { Cookie: `authclaw_session=${requesterSession.session_token}` },
      redirect: "manual",
    });
    assert(
      requesterDetailHtml.status === 307 || requesterDetailHtml.status === 302,
      `Requester is redirected from /itsm/admin-portal/users/${sampleUser.id} (Status ${requesterDetailHtml.status})`
    );

    // -------------------------------------------------------------
    // Test C: Service Agent Access Denied
    // -------------------------------------------------------------
    console.log("\n--- Test C: Service Agent Role Access Denied ---");
    const agentSession = await login("itsm-agent@test.com", "AuthClawDemo!234");
    assert(agentSession.itsm_role === "SERVICE_AGENT", "Agent has SERVICE_AGENT role");

    const agentUsersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${agentSession.session_token}` },
    });
    assert(
      agentUsersRes.status === 403,
      `Service Agent is denied access to /v1/itsm/admin/users (Expected 403, Got ${agentUsersRes.status})`
    );

    const agentPortalHtml = await fetch(`${CONSOLE_URL}/itsm/admin-portal/users`, {
      headers: { Cookie: `authclaw_session=${agentSession.session_token}` },
      redirect: "manual",
    });
    assert(
      agentPortalHtml.status === 307 || agentPortalHtml.status === 302,
      `Service Agent is redirected from /itsm/admin-portal/users (Status ${agentPortalHtml.status})`
    );

    const agentDetailHtml = await fetch(`${CONSOLE_URL}/itsm/admin-portal/users/${sampleUser.id}`, {
      headers: { Cookie: `authclaw_session=${agentSession.session_token}` },
      redirect: "manual",
    });
    assert(
      agentDetailHtml.status === 307 || agentDetailHtml.status === 302,
      `Service Agent is redirected from /itsm/admin-portal/users/${sampleUser.id} (Status ${agentDetailHtml.status})`
    );

    // -------------------------------------------------------------
    // Test D: Service Lead Access Denied & Operational Nav Clean
    // -------------------------------------------------------------
    console.log("\n--- Test D: Service Lead Access Denied & Nav Clean ---");
    // Temporarily assign operator@authclaw-lite.demo to SERVICE_LEAD
    const operatorUser = usersList.find((u) => u.email === "operator@authclaw-lite.demo");
    assert(Boolean(operatorUser), "Operator user exists in tenant");

    await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${operatorUser.id}/access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ has_itsm_access: true, itsm_role: "SERVICE_LEAD", has_governance_access: true }),
    });

    const leadSession = await login("operator@authclaw-lite.demo", "AuthClawDemo!234");
    assert(leadSession.itsm_role === "INCIDENT_MANAGER" || leadSession.itsm_role === "SERVICE_LEAD", "Operator user logged in as INCIDENT_MANAGER (formerly SERVICE_LEAD)");

    const leadUsersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${leadSession.session_token}` },
    });
    assert(
      leadUsersRes.status === 403,
      `Service Lead is denied access to /v1/itsm/admin/users (Expected 403, Got ${leadUsersRes.status})`
    );

    const leadPortalHtml = await fetch(`${CONSOLE_URL}/itsm/admin-portal/users`, {
      headers: { Cookie: `authclaw_session=${leadSession.session_token}` },
      redirect: "manual",
    });
    assert(
      leadPortalHtml.status === 307 || leadPortalHtml.status === 302,
      `Service Lead is redirected from /itsm/admin-portal/users (Status ${leadPortalHtml.status})`
    );

    // -------------------------------------------------------------
    // Test E: Process Change Manager Access Denied
    // -------------------------------------------------------------
    console.log("\n--- Test E: Process Change Manager Access Denied ---");
    await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${operatorUser.id}/access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ has_itsm_access: true, itsm_role: "PROCESS_CHANGE_MANAGER", has_governance_access: true }),
    });
    const pcmSession = await login("operator@authclaw-lite.demo", "AuthClawDemo!234");
    assert(pcmSession.itsm_role === "PROCESS_CHANGE_MANAGER", "User now logged in as PROCESS_CHANGE_MANAGER");

    const pcmUsersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${pcmSession.session_token}` },
    });
    assert(
      pcmUsersRes.status === 403,
      `Process Change Manager is denied access to /v1/itsm/admin/users (Expected 403, Got ${pcmUsersRes.status})`
    );

    // -------------------------------------------------------------
    // Test F: Auditor Access Denied
    // -------------------------------------------------------------
    console.log("\n--- Test F: Auditor Access Denied ---");
    await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${operatorUser.id}/access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ has_itsm_access: true, itsm_role: "AUDITOR", has_governance_access: true }),
    });
    const auditorSession = await login("operator@authclaw-lite.demo", "AuthClawDemo!234");
    assert(auditorSession.itsm_role === "AUDITOR", "User now logged in as AUDITOR");

    const auditorUsersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${auditorSession.session_token}` },
    });
    assert(
      auditorUsersRes.status === 403,
      `Auditor is denied access to /v1/itsm/admin/users (Expected 403, Got ${auditorUsersRes.status})`
    );

    // Reset operator back to its original state
    await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${operatorUser.id}/access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ has_itsm_access: false, itsm_role: "REQUESTER", has_governance_access: true }),
    });

    // -------------------------------------------------------------
    // Test G: Governance-Only User Access Denied
    // -------------------------------------------------------------
    console.log("\n--- Test G: Governance-Only User (No ITSM Access) ---");
    const viewerSession = await login("viewer@authclaw-lite.demo", "AuthClawDemo!234");
    assert(viewerSession.product_access?.itsm === false, "Viewer has ITSM access = false");

    const viewerUsersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${viewerSession.session_token}` },
    });
    assert(
      viewerUsersRes.status === 403,
      `Governance-only user is denied access to ITSM admin endpoints (403 Forbidden)`
    );

    // -------------------------------------------------------------
    // Test H: Provision Existing User as REQUESTER & Verify ITSM Login
    // -------------------------------------------------------------
    console.log("\n--- Test H: Employee Provisioning Flow (REQUESTER) ---");
    const targetUserId = viewerSession.user_id;

    const grantRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${targetUserId}/access`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        has_itsm_access: true,
        itsm_role: "REQUESTER",
        has_governance_access: false,
      }),
    });
    assert(grantRes.status === 200, "Admin granted ITSM access to employee (200 OK)");
    const grantedData = await grantRes.json();
    assert(grantedData.itsm_access === true, "Target user now has itsm_access = true");
    assert(grantedData.itsm_role === "REQUESTER", "Target user has itsm_role = REQUESTER");
    assert(grantedData.governance_access === false, "Target user has governance_access = false");

    // Verify employee can now log in and is recognized with ITSM access = true, governance = false
    const employeeLogin = await login("viewer@authclaw-lite.demo", "AuthClawDemo!234");
    assert(employeeLogin.product_access?.itsm === true, "Provisioned employee can access ITSM");
    assert(employeeLogin.product_access?.governance === false, "Provisioned employee has governance = false");
    assert(employeeLogin.itsm_role === "REQUESTER", "Provisioned employee recognized as REQUESTER");

    // -------------------------------------------------------------
    // Test I: Tenant Isolation
    // -------------------------------------------------------------
    console.log("\n--- Test I: Tenant Isolation ---");
    const fakeUserId = "00000000-0000-4000-8000-000000000000";
    const crossTenantRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${fakeUserId}/access`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        has_itsm_access: true,
        itsm_role: "REQUESTER",
      }),
    });
    assert(
      crossTenantRes.status === 404,
      `Access to user not in active tenant is rejected (Expected 404, Got ${crossTenantRes.status})`
    );

    // Verify invalid role rejection
    const invalidRoleRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${targetUserId}/access`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        has_itsm_access: true,
        itsm_role: "SUPER_GOD_ADMIN",
      }),
    });
    assert(
      invalidRoleRes.status === 400 || invalidRoleRes.status === 422,
      `Invalid ITSM role rejected with 400/422 Bad Request (Got ${invalidRoleRes.status})`
    );

    // -------------------------------------------------------------
    // Test J: No Duplicate Access Records
    // -------------------------------------------------------------
    console.log("\n--- Test J: Duplicate Access Prevention ---");
    const secondGrantRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${targetUserId}/access`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        has_itsm_access: true,
        itsm_role: "SERVICE_AGENT",
        has_governance_access: true,
      }),
    });
    assert(secondGrantRes.status === 200, "Second grant to same user succeeds without duplicate record errors");
    const secondGrantedData = await secondGrantRes.json();
    assert(secondGrantedData.itsm_role === "SERVICE_AGENT", "Second grant cleanly updated role to SERVICE_AGENT");

    // Fetch user list and ensure the target user appears exactly once
    const updatedUsersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const updatedUsersList = await updatedUsersRes.json();
    const matches = updatedUsersList.filter((u) => u.id === targetUserId);
    assert(matches.length === 1, `Target user appears exactly 1 time in tenant user list (no duplicate records)`);

    // Reset viewer back to original state (governance = true, itsm = false, role = REQUESTER)
    await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${targetUserId}/access`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        has_itsm_access: false,
        itsm_role: "REQUESTER",
        has_governance_access: true,
      }),
    });

    console.log("\n==================================================");
    console.log(`ALL 10 SCENARIOS VERIFIED: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  }
}

runTests();
