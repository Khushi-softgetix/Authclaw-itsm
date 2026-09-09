// End-to-end verification script for Separate Incident Manager Portal Foundation
// Validates:
// Test A: Incident Manager Login & Landing at /itsm/incident-manager
// Test B: User & Access State (email, itsm_access: true, itsm_role: INCIDENT_MANAGER)
// Test C: Blank Workspace (Zero operational widgets, displays Incident Manager, no Service Lead)
// Test D: Requester Blocked (Redirected away from /itsm/incident-manager)
// Test E: Service Agent Blocked (Redirected away from /itsm/incident-manager)
// Test F: Process Change Manager Blocked (Redirected away from /itsm/incident-manager)
// Test G: Auditor Blocked (Redirected away from /itsm/incident-manager)
// Test H: Platform Administrator Separation (/itsm/admin-portal vs /itsm/incident-manager)

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
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
  console.log("Starting Incident Manager Portal Verification");
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
    // Test A: Incident Manager Login
    // -------------------------------------------------------------
    console.log("--- Test A: Incident Manager Login ---");
    const imSession = await login("incidentmanager@authclaw-lite.demo", "AuthClawDemo!234");
    assert(imSession.session_token?.startsWith("acl_session_"), "Session token generated for Incident Manager");
    const imToken = imSession.session_token;

    // Fetch /itsm/incident-manager via console
    const imPageRes = await fetch(`${CONSOLE_URL}/itsm/incident-manager`, {
      headers: {
        Cookie: `authclaw_session=${imToken}`,
      },
      redirect: "manual",
    });
    assert(imPageRes.status === 200, `Incident Manager access to /itsm/incident-manager returns 200 OK (got ${imPageRes.status})`);

    // Verify navigating to old operational /itsm/incidents redirects to /itsm/incident-manager
    const imIncidentsRes = await fetch(`${CONSOLE_URL}/itsm/incidents`, {
      headers: { Cookie: `authclaw_session=${imToken}` },
      redirect: "manual",
    });
    assert(
      imIncidentsRes.status === 307 || imIncidentsRes.status === 302,
      `Incident Manager accessing /itsm/incidents is redirected away (got ${imIncidentsRes.status})`
    );
    const imIncidentsLocation = imIncidentsRes.headers.get("location") || "";
    assert(
      imIncidentsLocation.includes("/itsm/incident-manager"),
      `Incident Manager redirected to /itsm/incident-manager (got: ${imIncidentsLocation})`
    );

    // -------------------------------------------------------------
    // Test B: User & Access Verification
    // -------------------------------------------------------------
    console.log("\n--- Test B: User & Access State Verification ---");
    assert(imSession.email === "incidentmanager@authclaw-lite.demo", "Email is incidentmanager@authclaw-lite.demo");
    assert(imSession.product_access?.itsm === true, "product_access.itsm is true");
    assert(imSession.itsm_role === "INCIDENT_MANAGER", `itsm_role is INCIDENT_MANAGER (got ${imSession.itsm_role})`);

    // Check /v1/auth/me
    const meRes = await fetch(`${BACKEND_URL}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${imToken}` },
    });
    assert(meRes.status === 200, "GET /v1/auth/me returns 200 OK");
    const me = await meRes.json();
    assert(me.itsm_role === "INCIDENT_MANAGER", `me.itsm_role is INCIDENT_MANAGER (got ${me.itsm_role})`);
    assert(me.product_access?.itsm === true, "me.product_access.itsm is true");

    // -------------------------------------------------------------
    // Test C: Blank Workspace UI Inspection
    // -------------------------------------------------------------
    console.log("\n--- Test C: Blank Workspace UI Verification ---");
    const imHtml = await imPageRes.text();
    assert(imHtml.includes("Incident Manager"), "Page contains 'Incident Manager'");
    assert(imHtml.includes("Incident Manager Portal"), "Header shell contains 'Incident Manager Portal'");
    assert(imHtml.includes("Workspace Initialized"), "Contains 'Workspace Initialized' placeholder card");
    assert(imHtml.includes("Welcome to the Incident Manager workspace"), "Contains welcome placeholder copy");
    assert(!imHtml.includes("Service Lead"), "Does NOT contain obsolete title 'Service Lead'");
    assert(!imHtml.includes("<table"), "Contains no data tables");
    assert(!imHtml.includes("Total Incidents"), "Contains no fake metrics or queue statistics");
    assert(!imHtml.includes("Assign Ticket"), "Contains no mock action buttons");

    // -------------------------------------------------------------
    // Test D: Requester Blocked
    // -------------------------------------------------------------
    console.log("\n--- Test D: Requester Role Guard ---");
    const requesterSession = await login("requester123@gmail.com", "Requester@123");
    const reqRes = await fetch(`${CONSOLE_URL}/itsm/incident-manager`, {
      headers: { Cookie: `authclaw_session=${requesterSession.session_token}` },
      redirect: "manual",
    });
    assert(
      reqRes.status === 307 || reqRes.status === 302 || reqRes.status === 303,
      `Requester is redirected (got HTTP ${reqRes.status})`
    );
    const reqLocation = reqRes.headers.get("location") || "";
    assert(
      reqLocation.includes("/itsm/incidents"),
      `Requester redirected to /itsm/incidents (got location: ${reqLocation})`
    );

    // -------------------------------------------------------------
    // Test E: Service Agent Blocked
    // -------------------------------------------------------------
    console.log("\n--- Test E: Service Agent Role Guard ---");
    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    const agentRes = await fetch(`${CONSOLE_URL}/itsm/incident-manager`, {
      headers: { Cookie: `authclaw_session=${agentSession.session_token}` },
      redirect: "manual",
    });
    assert(
      agentRes.status === 307 || agentRes.status === 302 || agentRes.status === 303,
      `Service Agent is redirected (got HTTP ${agentRes.status})`
    );
    const agentLocation = agentRes.headers.get("location") || "";
    assert(
      agentLocation.includes("/itsm/incidents"),
      `Service Agent redirected away from incident-manager (got: ${agentLocation})`
    );

    // -------------------------------------------------------------
    // Test F: Process Change Manager Blocked
    // -------------------------------------------------------------
    console.log("\n--- Test F: Process Change Manager Role Guard ---");
    const pcmSession = await login("processchange@authclaw-lite.demo", "AuthClawDemo!234");
    const pcmRes = await fetch(`${CONSOLE_URL}/itsm/incident-manager`, {
      headers: { Cookie: `authclaw_session=${pcmSession.session_token}` },
      redirect: "manual",
    });
    assert(
      pcmRes.status === 307 || pcmRes.status === 302 || pcmRes.status === 303,
      `Process Change Manager is redirected (got HTTP ${pcmRes.status})`
    );

    // -------------------------------------------------------------
    // Test G: Auditor Blocked
    // -------------------------------------------------------------
    console.log("\n--- Test G: Auditor Role Guard ---");
    const auditorSession = await login("auditor@authclaw-lite.demo", "AuthClawDemo!234");
    const auditorRes = await fetch(`${CONSOLE_URL}/itsm/incident-manager`, {
      headers: { Cookie: `authclaw_session=${auditorSession.session_token}` },
      redirect: "manual",
    });
    assert(
      auditorRes.status === 307 || auditorRes.status === 302 || auditorRes.status === 303,
      `Auditor is redirected (got HTTP ${auditorRes.status})`
    );

    // -------------------------------------------------------------
    // Test H: Platform Administrator Separation
    // -------------------------------------------------------------
    console.log("\n--- Test H: Platform Administrator Separation ---");
    // 1. Incident Manager blocked from /itsm/admin-portal
    const imToAdminRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${imToken}` },
      redirect: "manual",
    });
    assert(
      imToAdminRes.status === 307 || imToAdminRes.status === 302 || imToAdminRes.status === 403,
      `Incident Manager cannot access /itsm/admin-portal (got HTTP ${imToAdminRes.status})`
    );

    // 2. Platform Admin accesses /itsm/admin-portal
    const adminSession = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
    const adminRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${adminSession.session_token}` },
      redirect: "manual",
    });
    assert(adminRes.status === 200, `Platform Admin access to /itsm/admin-portal returns 200 OK`);
    const adminHtml = await adminRes.text();
    assert(adminHtml.includes("Platform Administration"), "Admin portal shell renders Platform Administration");
    assert(!adminHtml.includes("Incident Manager Portal"), "Admin portal does NOT render Incident Manager Portal shell");

    // 3. Platform Admin users page shows Incident Manager role option
    const adminUsersRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal/users`, {
      headers: { Cookie: `authclaw_session=${adminSession.session_token}` },
    });
    assert(adminUsersRes.status === 200, "Admin portal users page returns 200 OK");
    const adminUsersHtml = await adminUsersRes.text();
    assert(adminUsersHtml.includes("Incident Manager"), "Admin users page includes 'Incident Manager' role");

    console.log("\n==================================================");
    console.log(`ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY! Passed: ${passed}, Failed: ${failed}`);
    console.log("==================================================");
  } catch (err) {
    console.error(`\nTest suite failed:`, err);
    process.exit(1);
  }
}

runTests();
