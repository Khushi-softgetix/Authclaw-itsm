// Live End-to-End Verification script for Problem and Change Manager (Step 1 Foundation)
// Verifies:
// 1. Unauthenticated access protection
// 2. Authentication & Session creation for PROCESS_CHANGE_MANAGER
// 3. /v1/auth/me principal validation (role, tenant_id, product_access.itsm)
// 4. Role distinction (REQUESTER vs SERVICE_AGENT vs PROCESS_CHANGE_MANAGER)
// 5. Existing knowledge base read access for Problem and Change Manager
// 6. Tenant isolation and security boundaries
// 7. Regression check for existing ITSM roles

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

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

async function runProblemChangeManagerFoundationVerification() {
  console.log("==================================================");
  console.log("Starting Problem and Change Manager (Step 1) E2E Verification");
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      failed++;
    } else {
      console.log(`✅ PASSED: ${message}`);
      passed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated Protection
    // -------------------------------------------------------------------------
    console.log("\n--- Part 1: Unauthenticated Protection ---");
    const unauthMe = await fetch(`${BACKEND_URL}/v1/auth/me`);
    assert(unauthMe.status === 401, "Unauthenticated request to /v1/auth/me returns 401 Unauthorized");

    // -------------------------------------------------------------------------
    // TEST 2: Problem and Change Manager Authentication
    // -------------------------------------------------------------------------
    console.log("\n--- Part 2: Authentication & Entitlement ---");
    const pcmSession = await login("processchange@authclaw-lite.demo", "AuthClawDemo!234");
    assert(!!pcmSession.session_token, "PCM login succeeded with session token");
    assert(pcmSession.itsm_role === "PROCESS_CHANGE_MANAGER", "PCM principal has itsm_role === 'PROCESS_CHANGE_MANAGER'");
    assert(pcmSession.product_access?.itsm === true, "PCM principal has active ITSM product access");

    const pcmHeaders = {
      Authorization: `Bearer ${pcmSession.session_token}`,
      "Content-Type": "application/json",
    };

    // -------------------------------------------------------------------------
    // TEST 3: Principal & Tenant Context via /v1/auth/me
    // -------------------------------------------------------------------------
    console.log("\n--- Part 3: Principal & Tenant Context ---");
    const meRes = await fetch(`${BACKEND_URL}/v1/auth/me`, { headers: pcmHeaders });
    assert(meRes.status === 200, "GET /v1/auth/me returns 200 OK");
    const meData = await meRes.json();
    assert(meData.email === "processchange@authclaw-lite.demo", "Principal email matches processchange account");
    assert(!!meData.tenant_id, "Principal has valid tenant_id context");
    assert(meData.itsm_role === "PROCESS_CHANGE_MANAGER", "Principal retains itsm_role = PROCESS_CHANGE_MANAGER");
    assert(meData.product_access?.itsm === true, "Principal retains product_access.itsm = true");

    // -------------------------------------------------------------------------
    // TEST 4: Role Separation Across Portals
    // -------------------------------------------------------------------------
    console.log("\n--- Part 4: Role Separation Verification ---");
    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    assert(agentSession.itsm_role === "SERVICE_AGENT", "Agent login has role SERVICE_AGENT");
    assert(agentSession.itsm_role !== pcmSession.itsm_role, "SERVICE_AGENT and PROCESS_CHANGE_MANAGER roles are distinct");

    const reqSession = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    assert(reqSession.itsm_role === "REQUESTER", "Requester login has role REQUESTER");
    assert(reqSession.itsm_role !== pcmSession.itsm_role, "REQUESTER and PROCESS_CHANGE_MANAGER roles are distinct");

    // -------------------------------------------------------------------------
    // TEST 5: Knowledge Base Access
    // -------------------------------------------------------------------------
    console.log("\n--- Part 5: Knowledge Base Read Access ---");
    const kbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge`, { headers: pcmHeaders });
    assert(kbRes.status === 200, "PCM user can read Knowledge Base (/v1/itsm/knowledge)");
    const kbData = await kbRes.json();
    assert(Array.isArray(kbData) && kbData.length > 0, "Knowledge Base returns published operational articles");

    // -------------------------------------------------------------------------
    // TEST 6: Tenant Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- Part 6: Tenant Isolation & Security ---");
    const crossTenantHeaders = {
      Authorization: `Bearer ${pcmSession.session_token}`,
      "X-Tenant-Id": "00000000-0000-0000-0000-000000000000",
    };
    const crossTenantRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/00000000-0000-0000-0000-000000000000`, {
      headers: crossTenantHeaders,
    });
    assert(crossTenantRes.status === 404, "Invalid cross-tenant resource returns 404 Not Found");

    // -------------------------------------------------------------------------
    // TEST 7: Regression Check for Existing Portals
    // -------------------------------------------------------------------------
    console.log("\n--- Part 7: Regression Check for Existing Roles ---");
    const agentHeaders = {
      Authorization: `Bearer ${agentSession.session_token}`,
      "Content-Type": "application/json",
    };
    const queueRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/queue`, { headers: agentHeaders });
    assert(queueRes.status === 200, "Service Agent queue access remains functional (200 OK)");

    const servicesRes = await fetch(`${BACKEND_URL}/v1/itsm/services`, { headers: agentHeaders });
    assert(servicesRes.status === 200, "Service Agent services access remains functional (200 OK)");

  } catch (err) {
    console.error("❌ E2E Verification Error:", err);
    failed++;
  }

  console.log("\n==================================================");
  console.log(`Problem & Change Manager Step 1: ${passed} passed, ${failed} failed.`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runProblemChangeManagerFoundationVerification();
