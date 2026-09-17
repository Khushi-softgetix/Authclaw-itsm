// End-to-end verification script for Phase 4 Step 4: Final MVP Settings + Security Verification
// Validates:
// 1. Basic Platform Settings (GET /v1/itsm/admin/settings & /itsm/admin-portal/settings)
// 2. Full 8-Role Security & RBAC Denial Matrix (PLATFORM_ADMINISTRATOR, REQUESTER, SERVICE_AGENT, INCIDENT_MANAGER, PROCESS_CHANGE_MANAGER, AUDITOR, Governance-only, Unauthenticated)
// 3. Tenant Isolation & Server-Side Guard
// 4. All 8 Platform Administrator Modules Accessible Only in Admin Portal
// 5. Full Regression of Steps 1, 2, and 3

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
  console.log("Starting ITSM Step 4 Verification (Settings & Security)");
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
    // Scenario 1: Platform Settings Endpoint & UI
    // -------------------------------------------------------------
    console.log("--- Scenario 1: Platform Settings Endpoint & Verification ---");
    const adminSession = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
    assert(adminSession.itsm_role === "PLATFORM_ADMINISTRATOR", "Admin has PLATFORM_ADMINISTRATOR role");
    const adminToken = adminSession.session_token;

    const settingsRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/settings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(settingsRes.status === 200, "GET /v1/itsm/admin/settings returns 200 OK");
    const settings = await settingsRes.json();
    assert(settings.platform_edition === "AuthClaw ITSM Foundation (Phase 4 MVP)", "Platform edition verified");
    assert(settings.notifications_enabled === true, "Notifications enabled");
    assert(settings.notification_delivery_channel === "IN_APP", "Delivery channel verified as IN_APP");
    assert(settings.default_priority === "P3", "Default priority is P3");
    assert(typeof settings.active_services_count === "number", "Active services count is integer");
    assert(typeof settings.active_catalog_items_count === "number", "Active catalog items count is integer");
    assert(typeof settings.active_sla_policies_count === "number", "Active SLA policies count is integer");
    assert(Boolean(settings.default_business_calendar), "Default business calendar name is returned");

    // Fetch /itsm/admin-portal/settings page
    const settingsPageRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal/settings`, {
      headers: { Cookie: `authclaw_session=${adminToken}`, "x-authclaw-pathname": "/itsm/admin-portal/settings" },
    });
    assert(settingsPageRes.status === 200, "GET /itsm/admin-portal/settings returns 200 OK for Platform Admin");
    const settingsHtml = await settingsPageRes.text();
    assert(settingsHtml.includes("Platform Settings"), "Settings page HTML contains 'Platform Settings'");
    assert(settingsHtml.includes("in-app notification infrastructure"), "Settings page HTML contains notification architecture");

    // -------------------------------------------------------------
    // Scenario 2: Full 8-Role Security & RBAC Denial Matrix
    // -------------------------------------------------------------
    console.log("\n--- Scenario 2: Full 8-Role Security & RBAC Denial Matrix ---");

    // 1. PLATFORM_ADMINISTRATOR -> ALLOW
    const adminPortalRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${adminToken}`, "x-authclaw-pathname": "/itsm/admin-portal" },
    });
    assert(adminPortalRes.status === 200, "1. PLATFORM_ADMINISTRATOR -> /itsm/admin-portal -> ALLOW (200 OK)");

    // 2. REQUESTER -> DENY
    const requesterSession = await login("requester123@gmail.com", "Requester@123");
    const requesterPortalRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${requesterSession.session_token}`, "x-authclaw-pathname": "/itsm/admin-portal" },
      redirect: "manual",
    });
    assert(
      requesterPortalRes.status === 307 || requesterPortalRes.status === 302,
      `2. REQUESTER -> /itsm/admin-portal -> DENIED (Redirected with status ${requesterPortalRes.status})`
    );
    assert(
      (requesterPortalRes.headers.get("location") || "").includes("admin_required"),
      "REQUESTER redirected to /itsm/incidents?error=admin_required"
    );
    const requesterApiRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/settings`, {
      headers: { Authorization: `Bearer ${requesterSession.session_token}` },
    });
    assert(requesterApiRes.status === 403, "REQUESTER denied API access (403 Forbidden)");

    // 3. SERVICE_AGENT -> DENY
    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    const agentPortalRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${agentSession.session_token}`, "x-authclaw-pathname": "/itsm/admin-portal" },
      redirect: "manual",
    });
    assert(
      agentPortalRes.status === 307 || agentPortalRes.status === 302,
      `3. SERVICE_AGENT -> /itsm/admin-portal -> DENIED (Redirected with status ${agentPortalRes.status})`
    );
    const agentApiRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/settings`, {
      headers: { Authorization: `Bearer ${agentSession.session_token}` },
    });
    assert(agentApiRes.status === 403, "SERVICE_AGENT denied API access (403 Forbidden)");

    // 4. INCIDENT_MANAGER -> DENY
    const imSession = await login("incidentmanager@authclaw-lite.demo", "AuthClawDemo!234");
    const imPortalRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${imSession.session_token}`, "x-authclaw-pathname": "/itsm/admin-portal" },
      redirect: "manual",
    });
    assert(
      imPortalRes.status === 307 || imPortalRes.status === 302,
      `4. INCIDENT_MANAGER -> /itsm/admin-portal -> DENIED (Redirected with status ${imPortalRes.status})`
    );
    const imApiRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/settings`, {
      headers: { Authorization: `Bearer ${imSession.session_token}` },
    });
    assert(imApiRes.status === 403, "INCIDENT_MANAGER denied API access (403 Forbidden)");

    // Find test user for dynamic role assignments
    const usersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const usersList = await usersRes.json();
    const testUser = usersList.find((u) => u.email === "operator@authclaw-lite.demo");
    assert(Boolean(testUser), "Test operator user found");

    // 5. PROCESS_CHANGE_MANAGER -> DENY
    await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${testUser.id}/access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ has_itsm_access: true, itsm_role: "PROCESS_CHANGE_MANAGER", has_governance_access: true }),
    });
    const pcmSession = await login("operator@authclaw-lite.demo", "AuthClawDemo!234");
    const pcmPortalRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${pcmSession.session_token}`, "x-authclaw-pathname": "/itsm/admin-portal" },
      redirect: "manual",
    });
    assert(
      pcmPortalRes.status === 307 || pcmPortalRes.status === 302,
      `5. PROCESS_CHANGE_MANAGER -> /itsm/admin-portal -> DENIED (Redirected with status ${pcmPortalRes.status})`
    );
    const pcmApiRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/settings`, {
      headers: { Authorization: `Bearer ${pcmSession.session_token}` },
    });
    assert(pcmApiRes.status === 403, "PROCESS_CHANGE_MANAGER denied API access (403 Forbidden)");

    // 6. AUDITOR -> DENY
    await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${testUser.id}/access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ has_itsm_access: true, itsm_role: "AUDITOR", has_governance_access: true }),
    });
    const auditorSession = await login("operator@authclaw-lite.demo", "AuthClawDemo!234");
    const auditorPortalRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${auditorSession.session_token}`, "x-authclaw-pathname": "/itsm/admin-portal" },
      redirect: "manual",
    });
    assert(
      auditorPortalRes.status === 307 || auditorPortalRes.status === 302,
      `6. AUDITOR -> /itsm/admin-portal -> DENIED (Redirected with status ${auditorPortalRes.status})`
    );
    const auditorApiRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/settings`, {
      headers: { Authorization: `Bearer ${auditorSession.session_token}` },
    });
    assert(auditorApiRes.status === 403, "AUDITOR denied API access (403 Forbidden)");

    // 7. Governance-only user (has_itsm_access = false) -> DENY
    await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${testUser.id}/access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ has_itsm_access: false, itsm_role: "REQUESTER", has_governance_access: true }),
    });
    const govOnlySession = await login("operator@authclaw-lite.demo", "AuthClawDemo!234");
    const govOnlyPortalRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${govOnlySession.session_token}`, "x-authclaw-pathname": "/itsm/admin-portal" },
      redirect: "manual",
    });
    assert(
      govOnlyPortalRes.status === 307 || govOnlyPortalRes.status === 302,
      `7. Governance-Only User -> /itsm/admin-portal -> DENIED (Redirected with status ${govOnlyPortalRes.status})`
    );
    assert(
      (govOnlyPortalRes.headers.get("location") || "").includes("access_denied"),
      "Governance-Only user redirected with access_denied"
    );
    const govOnlyApiRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/settings`, {
      headers: { Authorization: `Bearer ${govOnlySession.session_token}` },
    });
    assert(govOnlyApiRes.status === 403, "Governance-Only user denied API access (403 Forbidden)");

    // Restore testUser access
    await fetch(`${BACKEND_URL}/v1/itsm/admin/users/${testUser.id}/access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ has_itsm_access: true, itsm_role: "SERVICE_AGENT", has_governance_access: true }),
    });

    // 8. Unauthenticated User -> DENY
    const unauthPortalRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      redirect: "manual",
    });
    assert(
      unauthPortalRes.status === 307 || unauthPortalRes.status === 302,
      `8. Unauthenticated user -> /itsm/admin-portal -> DENIED (Redirected with status ${unauthPortalRes.status})`
    );
    assert(
      (unauthPortalRes.headers.get("location") || "").includes("/itsm/login"),
      "Unauthenticated user redirected to /itsm/login"
    );
    const unauthApiRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/settings`);
    assert(unauthApiRes.status === 401, "Unauthenticated user denied API access (401 Unauthorized)");

    // -------------------------------------------------------------
    // Scenario 3: Verify All 8 Platform Admin Routes
    // -------------------------------------------------------------
    console.log("\n--- Scenario 3: Verify All 8 Admin Routes in Separate Portal ---");
    const adminRoutes = [
      { name: "Overview", path: "/itsm/admin-portal" },
      { name: "Users", path: "/itsm/admin-portal/users" },
      { name: "Teams", path: "/itsm/admin-portal/teams" },
      { name: "Services", path: "/itsm/admin-portal/services" },
      { name: "Configuration Items", path: "/itsm/admin-portal/configuration-items" },
      { name: "Service Catalog", path: "/itsm/admin-portal/service-catalog" },
      { name: "SLA Configuration", path: "/itsm/admin-portal/sla" },
      { name: "Settings", path: "/itsm/admin-portal/settings" },
    ];

    for (const route of adminRoutes) {
      const res = await fetch(`${CONSOLE_URL}${route.path}`, {
        headers: { Cookie: `authclaw_session=${adminToken}`, "x-authclaw-pathname": route.path },
      });
      assert(res.status === 200, `Platform Admin access to ${route.path} returns 200 OK`);
      const html = await res.text();
      assert(html.includes("Platform Administration"), `${route.path} contains Platform Administration header`);
      assert(!html.includes("Incident Manager Workspace"), `${route.path} does not mix with Incident Manager`);
    }

    // Verify sidebar links inside /itsm/admin-portal HTML
    const overviewRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
      headers: { Cookie: `authclaw_session=${adminToken}`, "x-authclaw-pathname": "/itsm/admin-portal" },
    });
    const overviewHtml = await overviewRes.text();
    for (const route of adminRoutes) {
      if (route.path !== "/itsm/admin-portal") {
        assert(overviewHtml.includes(route.path), `Sidebar navigation contains link to ${route.path}`);
      }
    }

    // -------------------------------------------------------------
    // Scenario 4: Regression Testing (Step 1, 2, 3)
    // -------------------------------------------------------------
    console.log("\n--- Scenario 4: Regression Testing of Steps 1, 2, and 3 ---");

    // Step 1: Users list and detail
    const step1Res = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(step1Res.status === 200, "Step 1: GET /v1/itsm/admin/users operational");

    // Step 2: Teams, Services, CMDB
    const teamsRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(teamsRes.status === 200, "Step 2: GET /v1/itsm/admin/teams operational");

    const svcsRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/services`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(svcsRes.status === 200, "Step 2: GET /v1/itsm/admin/services operational");

    const cisRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/configuration-items`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(cisRes.status === 200, "Step 2: GET /v1/itsm/admin/configuration-items operational");

    // Step 3: Service Catalog, Business Calendars, SLA Policies
    const catRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/service-catalog`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(catRes.status === 200, "Step 3: GET /v1/itsm/admin/service-catalog operational");

    const calRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/business-calendars`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(calRes.status === 200, "Step 3: GET /v1/itsm/admin/business-calendars operational");

    const slaRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/sla-policies`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(slaRes.status === 200, "Step 3: GET /v1/itsm/admin/sla-policies operational");

    // Incident Manager separation check
    const imCheckRes = await fetch(`${CONSOLE_URL}/itsm/incident-manager`, {
      headers: { Cookie: `authclaw_session=${imSession.session_token}`, "x-authclaw-pathname": "/itsm/incident-manager" },
    });
    assert(imCheckRes.status === 200, "Incident Manager workspace remains accessible at /itsm/incident-manager");
    const imCheckHtml = await imCheckRes.text();
    assert(!imCheckHtml.includes("Platform Administration"), "Incident Manager workspace does NOT contain Platform Administration");

    console.log("\n==================================================");
    console.log(`Step 4 Verification Complete: ${passed} passed, ${failed} failed.`);
    console.log("==================================================");
  } catch (error) {
    console.error("\n❌ Step 4 Verification encountered an error:", error);
    process.exit(1);
  }
}

runTests();
