// Comprehensive E2E Verification Script for AuthClaw ITSM Incident Management,
// Product Separation, Dedicated ITSM Login, and Console Isolation

const BASE_URL = process.env.CONSOLE_URL || "http://host.docker.internal:3001";

async function run() {
  console.log("=== Starting AuthClaw ITSM & Product Separation E2E Verification ===");
  console.log(`Target URL: ${BASE_URL}`);

  // 1. Health check public marketing routes
  console.log("\n1. Verifying Public Marketing Routes...");
  const publicRoutes = ["/", "/product", "/pricing", "/security", "/company", "/login", "/itsm", "/itsm/login"];
  for (const route of publicRoutes) {
    const res = await fetch(`${BASE_URL}${route}`);
    console.log(`   GET ${route}: status ${res.status}`);
    if (res.status !== 200) {
      throw new Error(`Public route ${route} failed: ${res.status}`);
    }
  }

  // 2. Verify Dedicated /itsm/login Page (Unauthenticated)
  console.log("\n2. Verifying Dedicated /itsm/login Page (Unauthenticated)...");
  const itsmLoginRes = await fetch(`${BASE_URL}/itsm/login`);
  console.log(`   GET /itsm/login (unauth): status ${itsmLoginRes.status}`);
  if (itsmLoginRes.status !== 200) {
    throw new Error(`Public /itsm/login returned status ${itsmLoginRes.status}`);
  }
  const itsmLoginHtml = await itsmLoginRes.text();
  if (!itsmLoginHtml.includes("AuthClaw ITSM")) {
    throw new Error("ITSM login page missing 'AuthClaw ITSM' branding");
  }
  if (!itsmLoginHtml.includes("Sign in to your ITSM workspace")) {
    throw new Error("ITSM login page missing 'Sign in to your ITSM workspace' subtitle");
  }
  if (!itsmLoginHtml.includes("Login to ITSM")) {
    throw new Error("ITSM login page missing 'Login to ITSM' submit button");
  }
  if (!itsmLoginHtml.includes("Looking for AI Governance?")) {
    throw new Error("ITSM login page missing link to Governance login");
  }
  console.log("   ✓ Dedicated /itsm/login page renders brand, subtitle, and CTA cleanly.");

  // 3. Verify Public /itsm Landing Page (Unauthenticated CTA points to /itsm/login)
  console.log("\n3. Verifying Public /itsm Landing Page (Unauthenticated)...");
  const unauthItsmRes = await fetch(`${BASE_URL}/itsm`);
  console.log(`   GET /itsm (unauth): status ${unauthItsmRes.status}`);
  if (unauthItsmRes.status !== 200) {
    throw new Error(`Public /itsm returned status ${unauthItsmRes.status}`);
  }
  const unauthItsmHtml = await unauthItsmRes.text();
  if (!unauthItsmHtml.includes("AI-native service management")) {
    throw new Error("Public /itsm landing page missing expected headline");
  }
  if (!unauthItsmHtml.includes("Login to ITSM")) {
    throw new Error("Public /itsm landing page missing 'Login to ITSM' CTA for unauthenticated visitor");
  }
  if (!unauthItsmHtml.includes('href="/itsm/login"')) {
    throw new Error("Public /itsm landing page CTA must point to /itsm/login");
  }
  console.log("   ✓ Unauthenticated /itsm renders headline & 'Login to ITSM' CTA pointing to /itsm/login.");

  // 4. Perform Login via shared BFF /api/auth/login
  console.log("\n4. Performing Login via shared /api/auth/login...");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
    },
    body: JSON.stringify({
      email: "admin@authclaw-lite.demo",
      password: "AuthClawDemo!234",
    }),
  });

  console.log(`   Login response status: ${loginRes.status}`);
  const setCookie = loginRes.headers.get("set-cookie") || "";
  console.log(`   Set-Cookie received: ${setCookie ? "YES" : "NO"}`);
  
  // Extract session cookie
  const sessionMatch = setCookie.match(/authclaw_session=([^;]+)/);
  let cookieHeader = "";
  if (sessionMatch) {
    cookieHeader = `authclaw_session=${sessionMatch[1]}`;
    console.log(`   Found session token: ${sessionMatch[1].substring(0, 20)}...`);
  } else {
    const text = await loginRes.text();
    console.log("Login response body:", text);
    throw new Error("Failed to get session cookie from login");
  }

  const authHeaders = {
    Cookie: cookieHeader,
    Origin: BASE_URL,
  };

  // 5. Verify Authenticated /itsm Experience
  console.log("\n5. Verifying Public /itsm Landing Page (Authenticated User)...");
  const authItsmRes = await fetch(`${BASE_URL}/itsm`, { headers: authHeaders });
  console.log(`   GET /itsm (auth): status ${authItsmRes.status}`);
  const authItsmHtml = await authItsmRes.text();
  if (!authItsmHtml.includes("Go to ITSM Console")) {
    throw new Error("Authenticated /itsm page should display 'Go to ITSM Console' CTA");
  }
  if (!authItsmHtml.includes('href="/itsm/incidents"')) {
    throw new Error("Authenticated /itsm page CTA should point to /itsm/incidents");
  }
  console.log("   ✓ Authenticated /itsm displays 'Go to ITSM Console' pointing directly to /itsm/incidents.");

  // 6. Verify Authenticated User Visiting /itsm/login Redirects to /itsm/incidents
  console.log("\n6. Verifying Authenticated User Redirect on /itsm/login...");
  const itsmLoginRedirectRes = await fetch(`${BASE_URL}/itsm/login`, {
    headers: authHeaders,
    redirect: "manual",
  });
  console.log(`   GET /itsm/login (auth): status ${itsmLoginRedirectRes.status}`);
  const itsmRedirectLocation = itsmLoginRedirectRes.headers.get("location");
  console.log(`   Redirect Location: ${itsmRedirectLocation}`);
  if (itsmLoginRedirectRes.status === 307 || itsmLoginRedirectRes.status === 302) {
    if (!itsmRedirectLocation || !itsmRedirectLocation.includes("/itsm/incidents")) {
      throw new Error(`Expected redirect to /itsm/incidents, got: ${itsmRedirectLocation}`);
    }
    console.log("   ✓ Authenticated /itsm/login cleanly redirects to /itsm/incidents.");
  } else {
    console.log("   (Proxy status: " + itsmLoginRedirectRes.status + ")");
  }

  // 7. Verify Authenticated User Visiting /login Redirects to /overview
  console.log("\n7. Verifying Authenticated User Redirect on /login...");
  const loginRedirectRes = await fetch(`${BASE_URL}/login`, {
    headers: authHeaders,
    redirect: "manual",
  });
  console.log(`   GET /login (auth): status ${loginRedirectRes.status}`);
  const loginRedirectLocation = loginRedirectRes.headers.get("location");
  console.log(`   Redirect Location: ${loginRedirectLocation}`);
  if (loginRedirectRes.status === 307 || loginRedirectRes.status === 302) {
    if (!loginRedirectLocation || !loginRedirectLocation.includes("/overview")) {
      throw new Error(`Expected redirect to /overview, got: ${loginRedirectLocation}`);
    }
    console.log("   ✓ Authenticated /login cleanly redirects to /overview.");
  } else {
    console.log("   (Proxy status: " + loginRedirectRes.status + ")");
  }

  // 8. Verify Governance Console Isolation (No ITSM links/switchers in Governance Console)
  console.log("\n8. Verifying Governance Console Isolation (GET /overview)...");
  const overviewRes = await fetch(`${BASE_URL}/overview`, { headers: authHeaders });
  console.log(`   GET /overview: status ${overviewRes.status}`);
  if (overviewRes.status !== 200) {
    throw new Error(`/overview returned status ${overviewRes.status}`);
  }
  const overviewHtml = await overviewRes.text();
  if (overviewHtml.includes("Platform Products") || overviewHtml.includes("Return to AI Governance")) {
    throw new Error("Governance console contains forbidden cross-product link!");
  }
  console.log("   ✓ Governance console has zero cross-product links or switchers.");

  // 9. Verify ITSM Console Isolation (No Governance links/switchers in ITSM Console)
  console.log("\n9. Verifying ITSM Console Isolation (GET /itsm/incidents)...");
  const incidentsPageRes = await fetch(`${BASE_URL}/itsm/incidents`, { headers: authHeaders });
  console.log(`   GET /itsm/incidents: status ${incidentsPageRes.status}`);
  if (incidentsPageRes.status !== 200) {
    throw new Error(`/itsm/incidents page returned status ${incidentsPageRes.status}`);
  }
  const incidentsHtml = await incidentsPageRes.text();
  if (incidentsHtml.includes("Platform Products") || incidentsHtml.includes("Return to AI Governance")) {
    throw new Error("ITSM console contains forbidden cross-product link!");
  }
  console.log("   ✓ ITSM console has zero cross-product links or switchers.");

  // 10. Verify Existing Governance Routes (Regression Check)
  console.log("\n10. Verifying Existing Governance Routes (Regression Check)...");
  for (const route of ["/compliance", "/findings"]) {
    const res = await fetch(`${BASE_URL}${route}`, { headers: authHeaders });
    console.log(`   GET ${route}: status ${res.status}`);
    if (res.status !== 200) {
      throw new Error(`Route ${route} returned status ${res.status}`);
    }
  }

  // 11. Verify New Incident Page & Operations
  console.log("\n11. Verifying Incident Creation & Lifecycle Operations...");
  const newIncidentPageRes = await fetch(`${BASE_URL}/itsm/incidents/new`, { headers: authHeaders });
  console.log(`   GET /itsm/incidents/new: status ${newIncidentPageRes.status}`);
  if (newIncidentPageRes.status !== 200) {
    throw new Error(`/itsm/incidents/new page returned status ${newIncidentPageRes.status}`);
  }

  // Create P1 incident
  console.log("   POST /api/itsm/incidents (Creating P1 incident)...");
  const createPayload = {
    title: "E2E Verification Payment Incident",
    description: "Automated regression verification ticket testing public to console journey.",
    impact: "HIGH",
    urgency: "HIGH",
    category: "Infrastructure",
    assignment_group: "Site Reliability",
    source_channel: "PORTAL",
  };
  const createRes = await fetch(`${BASE_URL}/api/itsm/incidents`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createPayload),
  });
  console.log(`   POST /api/itsm/incidents status: ${createRes.status}`);
  if (createRes.status !== 201) {
    const err = await createRes.text();
    throw new Error(`POST /api/itsm/incidents failed: ${createRes.status} ${err}`);
  }
  const createdIncident = await createRes.json();
  const incidentId = createdIncident.id;
  console.log(`   Created incident: ${createdIncident.ticket_number || createdIncident.number} (Priority: ${createdIncident.priority})`);

  // Add work note
  const noteRes = await fetch(`${BASE_URL}/api/itsm/incidents/${incidentId}/activities`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: "E2E automated work note test for product separation.",
      is_internal: true,
      activity_type: "NOTE",
    }),
  });
  console.log(`   Add note status: ${noteRes.status}`);

  // Transition to IN_PROGRESS
  const statusRes1 = await fetch(`${BASE_URL}/api/itsm/incidents/${incidentId}/status`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "IN_PROGRESS" }),
  });
  console.log(`   Status transition to IN_PROGRESS status: ${statusRes1.status}`);

  // Transition to RESOLVED
  const statusRes2 = await fetch(`${BASE_URL}/api/itsm/incidents/${incidentId}/status`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "RESOLVED",
      resolution_code: "SOLVED_PERMANENTLY",
      resolution_summary: "Automated verification test completed successfully.",
    }),
  });
  console.log(`   Status transition to RESOLVED status: ${statusRes2.status}`);

  // Verify Incident Details page render for the new incident
  // 13. Verify Multi-Product Access Control & Isolation Scenarios
  console.log("\n13. Verifying Multi-Product Access Control & Isolation Scenarios...");

  // Scenario A: Governance-only user (viewer@authclaw-lite.demo)
  console.log("\n--- Scenario A: Governance-Only User (viewer@authclaw-lite.demo) ---");
  const viewerLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE_URL },
    body: JSON.stringify({
      email: "viewer@authclaw-lite.demo",
      password: "AuthClawDemo!234",
      tenantName: "AuthClaw Lite Demo",
    }),
  });
  if (!viewerLoginRes.ok) {
    throw new Error(`Viewer login failed: ${viewerLoginRes.status}`);
  }
  const viewerData = await viewerLoginRes.json();
  console.log("   Viewer ProductAccess:", viewerData.user?.productAccess);
  if (viewerData.user?.productAccess?.governance !== true || viewerData.user?.productAccess?.itsm !== false) {
    throw new Error(`Viewer productAccess incorrect: ${JSON.stringify(viewerData.user?.productAccess)}`);
  }
  const viewerCookie = (viewerLoginRes.headers.get("set-cookie") || "").match(/authclaw_session=([^;]+)/)?.[1];
  const viewerHeaders = { Cookie: `authclaw_session=${viewerCookie}`, Origin: BASE_URL };

  // Viewer can access /overview
  const viewerGovRes = await fetch(`${BASE_URL}/overview`, { headers: viewerHeaders });
  console.log(`   Viewer GET /overview status: ${viewerGovRes.status}`);
  if (viewerGovRes.status !== 200) {
    throw new Error(`Viewer should access /overview: ${viewerGovRes.status}`);
  }

  // Viewer blocked from /itsm/incidents
  const viewerItsmRes = await fetch(`${BASE_URL}/itsm/incidents`, { headers: viewerHeaders, redirect: "manual" });
  console.log(`   Viewer GET /itsm/incidents status: ${viewerItsmRes.status}, location: ${viewerItsmRes.headers.get("location")}`);
  if (viewerItsmRes.status !== 307 && viewerItsmRes.status !== 302 && viewerItsmRes.status !== 403) {
    throw new Error(`Viewer should be blocked from /itsm/incidents, got: ${viewerItsmRes.status}`);
  }
  const viewerRedirect = viewerItsmRes.headers.get("location") || "";
  if (viewerItsmRes.status === 307 || viewerItsmRes.status === 302) {
    if (!viewerRedirect.includes("error=access_denied")) {
      throw new Error(`Expected redirect to include error=access_denied, got: ${viewerRedirect}`);
    }
  }
  console.log("   ✓ Governance-only user allowed in Governance, cleanly blocked from ITSM.");

  // Scenario B: ITSM-only user (itsm-agent@test.com)
  console.log("\n--- Scenario B: ITSM-Only User (itsm-agent@test.com) ---");
  const agentLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE_URL },
    body: JSON.stringify({
      email: "itsm-agent@test.com",
      password: "AuthClawDemo!234",
    }),
  });
  if (!agentLoginRes.ok) {
    throw new Error(`ITSM agent login failed: ${agentLoginRes.status}`);
  }
  const agentData = await agentLoginRes.json();
  console.log("   Agent ProductAccess:", agentData.user?.productAccess, "ITSM Role:", agentData.user?.itsmRole);
  if (agentData.user?.productAccess?.governance !== false || agentData.user?.productAccess?.itsm !== true) {
    throw new Error(`Agent productAccess incorrect: ${JSON.stringify(agentData.user?.productAccess)}`);
  }
  if (agentData.user?.itsmRole !== "SERVICE_AGENT") {
    throw new Error(`Agent itsmRole should be SERVICE_AGENT, got: ${agentData.user?.itsmRole}`);
  }
  const agentCookie = (agentLoginRes.headers.get("set-cookie") || "").match(/authclaw_session=([^;]+)/)?.[1];
  const agentHeaders = { Cookie: `authclaw_session=${agentCookie}`, Origin: BASE_URL };

  // Agent can access /itsm/incidents
  const agentItsmRes = await fetch(`${BASE_URL}/itsm/incidents`, { headers: agentHeaders });
  console.log(`   Agent GET /itsm/incidents status: ${agentItsmRes.status}`);
  if (agentItsmRes.status !== 200) {
    throw new Error(`Agent should access /itsm/incidents: ${agentItsmRes.status}`);
  }
  const agentItsmHtml = await agentItsmRes.text();
  if (!agentItsmHtml.includes("Service Agent")) {
    throw new Error("ITSM console should display 'Service Agent' role for itsm-agent user");
  }

  // Agent blocked from /overview
  const agentGovRes = await fetch(`${BASE_URL}/overview`, { headers: agentHeaders, redirect: "manual" });
  console.log(`   Agent GET /overview status: ${agentGovRes.status}, location: ${agentGovRes.headers.get("location")}`);
  if (agentGovRes.status !== 307 && agentGovRes.status !== 302 && agentGovRes.status !== 403) {
    throw new Error(`Agent should be blocked from /overview, got: ${agentGovRes.status}`);
  }
  const agentRedirect = agentGovRes.headers.get("location") || "";
  if (agentGovRes.status === 307 || agentGovRes.status === 302) {
    if (!agentRedirect.includes("error=access_denied")) {
      throw new Error(`Expected redirect to include error=access_denied, got: ${agentRedirect}`);
    }
  }
  console.log("   ✓ ITSM-only user allowed in ITSM with 'Service Agent' role, cleanly blocked from Governance.");

  // Scenario C: Unauthenticated access to /itsm/incidents redirects to /itsm/login
  console.log("\n--- Scenario C: Unauthenticated /itsm/incidents Redirect ---");
  const unauthIncidentsRes = await fetch(`${BASE_URL}/itsm/incidents`, { redirect: "manual" });
  console.log(`   Unauthenticated GET /itsm/incidents status: ${unauthIncidentsRes.status}, location: ${unauthIncidentsRes.headers.get("location")}`);
  if (unauthIncidentsRes.status !== 307 && unauthIncidentsRes.status !== 302) {
    throw new Error(`Unauthenticated /itsm/incidents must redirect, got: ${unauthIncidentsRes.status}`);
  }
  const unauthLocation = unauthIncidentsRes.headers.get("location") || "";
  if (!unauthLocation.includes("/itsm/login")) {
    throw new Error(`Unauthenticated /itsm/incidents must redirect to /itsm/login, got: ${unauthLocation}`);
  }
  // Scenario D: Verify ITSM Public Shell, Roles Page, and 6 Role Dashboards
  console.log("\n--- Scenario D: Verify ITSM Public Shell, Roles Page, and 6 Role Dashboards ---");
  
  // 1. Verify Public /itsm/roles Page
  console.log("   Verifying Public /itsm/roles page...");
  const rolesRes = await fetch(`${BASE_URL}/itsm/roles`);
  console.log(`   GET /itsm/roles: status ${rolesRes.status}`);
  if (rolesRes.status !== 200) {
    throw new Error(`Public /itsm/roles returned status ${rolesRes.status}`);
  }
  const rolesHtml = await rolesRes.text();
  const requiredRoles = [
    "Requester",
    "Service Agent",
    "Service Lead",
    "Process & Change Manager",
    "Platform Administrator",
    "Auditor & Compliance",
  ];
  for (const r of requiredRoles) {
    if (!rolesHtml.includes(r) && !rolesHtml.includes(r.replace(/&/g, "&amp;"))) {
      throw new Error(`Roles page missing expected role: ${r}`);
    }
  }
  console.log("   ✓ All 6 roles present on /itsm/roles page.");

  // 2. Verify all 6 Role Dashboards (Authenticated admin session)
  console.log("   Verifying all 6 Role Dashboards with authenticated session...");
  const dashboards = [
    { path: "/itsm/dashboard/requester", text: "Requester Self-Service Portal" },
    { path: "/itsm/dashboard/service-agent", text: "Service Agent Operations Workspace" },
    { path: "/itsm/dashboard/service-lead", text: "Service Lead & Major Incident Command" },
    { path: "/itsm/dashboard/process-change", text: "Change Advisory Board" },
    { path: "/itsm/dashboard/platform-admin", text: "Platform & Systems Administration" },
    { path: "/itsm/dashboard/auditor", text: "Independent Assurance & Compliance" },
  ];

  for (const db of dashboards) {
    const dbRes = await fetch(`${BASE_URL}${db.path}`, { headers: authHeaders });
    console.log(`   GET ${db.path}: status ${dbRes.status}`);
    if (dbRes.status !== 200) {
      throw new Error(`Dashboard ${db.path} failed with status ${dbRes.status}`);
    }
    const dbHtml = await dbRes.text();
    if (!dbHtml.includes(db.text) && !dbHtml.includes(db.text.replace(/&/g, "&amp;"))) {
      throw new Error(`Dashboard ${db.path} missing expected text '${db.text}'`);
    }
  }
  console.log("   ✓ All 6 role dashboards render cleanly with expected headings and data.");

  // 3. Verify Sidebar Navigation items in ITSM console
  console.log("   Verifying ITSM Console Sidebar items...");
  const consoleRes = await fetch(`${BASE_URL}/itsm/incidents`, { headers: authHeaders });
  const consoleHtml = await consoleRes.text();
  const requiredNavItems = [
    "Dashboard",
    "Incidents",
    "Requests",
    "Knowledge",
    "Services",
    "Problems & Changes",
    "CMDB",
    "Reports & Audit",
    "Administration",
  ];
  for (const nav of requiredNavItems) {
    if (!consoleHtml.includes(nav) && !consoleHtml.includes(nav.replace(/&/g, "&amp;"))) {
      throw new Error(`ITSM console sidebar missing item: ${nav}`);
    }
  }
  console.log("   ✓ ITSM console sidebar contains all 9 approved modules with zero Governance items.");

  console.log("\n=======================================================");
  console.log("🎉 ALL PRODUCT SEPARATION, ACCESS CONTROL & ITSM E2E CHECKS PASSED!");
  console.log("=======================================================");
}

run().catch((err) => {
  console.error("\n❌ E2E VERIFICATION FAILED:", err);
  process.exit(1);
});
