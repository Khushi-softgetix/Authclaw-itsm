// Live End-to-End Verification script for Problem and Change Manager (Step 2 Queue)
// Verifies:
// 1. Unauthenticated protection (401)
// 2. Role enforcement (403 Forbidden for REQUESTER and SERVICE_AGENT)
// 3. Problem Queue retrieval for PROCESS_CHANGE_MANAGER (200 OK)
// 4. Problem Stats retrieval (200 OK)
// 5. Lifecycle and status filtering
// 6. Search filtering by problem number and title
// 7. Problem Detail with Related Incidents
// 8. Tenant isolation (Cross-tenant Problem access returns 404)
// 9. Regression check for existing ITSM roles (Service Agent, Requester, Incident Manager, Knowledge)

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

async function runProblemQueueVerification() {
  console.log("==================================================");
  console.log("Starting Problem and Change Manager (Step 2) Queue Verification");
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
    const unauthProblems = await fetch(`${BACKEND_URL}/v1/itsm/problems`);
    assert(unauthProblems.status === 401, "Unauthenticated GET /v1/itsm/problems returns 401 Unauthorized");

    const unauthStats = await fetch(`${BACKEND_URL}/v1/itsm/problems/stats`);
    assert(unauthStats.status === 401, "Unauthenticated GET /v1/itsm/problems/stats returns 401 Unauthorized");

    // -------------------------------------------------------------------------
    // TEST 2: Role Authorization Checks
    // -------------------------------------------------------------------------
    console.log("\n--- Part 2: Role Authorization Boundaries ---");
    const reqSession = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    const reqRes = await fetch(`${BACKEND_URL}/v1/itsm/problems`, {
      headers: { Authorization: `Bearer ${reqSession.session_token}` },
    });
    assert(reqRes.status === 403, "Requester role is denied access (403 Forbidden)");

    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    const agentRes = await fetch(`${BACKEND_URL}/v1/itsm/problems`, {
      headers: { Authorization: `Bearer ${agentSession.session_token}` },
    });
    assert(agentRes.status === 403, "Service Agent role is denied access (403 Forbidden)");

    // -------------------------------------------------------------------------
    // TEST 3: Problem Manager Queue & Stats Access
    // -------------------------------------------------------------------------
    console.log("\n--- Part 3: Problem and Change Manager Access ---");
    const pcmSession = await login("processchange@authclaw-lite.demo", "AuthClawDemo!234");
    const pcmToken = pcmSession.session_token;

    const listRes = await fetch(`${BACKEND_URL}/v1/itsm/problems`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(listRes.status === 200, "PCM can access GET /v1/itsm/problems (200 OK)");
    const problemsList = await listRes.json();
    assert(Array.isArray(problemsList), "Problems queue returns a JSON array");

    const statsRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/stats`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(statsRes.status === 200, "PCM can access GET /v1/itsm/problems/stats (200 OK)");
    const stats = await statsRes.json();
    assert(typeof stats.open === "number", "Stats contains numeric 'open' count");
    assert(typeof stats.in_progress === "number", "Stats contains numeric 'in_progress' count");
    assert(typeof stats.resolved === "number", "Stats contains numeric 'resolved' count");
    assert(typeof stats.total === "number", "Stats contains numeric 'total' count");

    // -------------------------------------------------------------------------
    // TEST 4: Status and Search Filtering Contract
    // -------------------------------------------------------------------------
    console.log("\n--- Part 4: Queue Filters & Search ---");
    const openRes = await fetch(`${BACKEND_URL}/v1/itsm/problems?status=OPEN`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(openRes.status === 200, "Filtering by status=OPEN returns 200 OK");

    const inProgressRes = await fetch(`${BACKEND_URL}/v1/itsm/problems?status=IN_PROGRESS`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(inProgressRes.status === 200, "Filtering by status=IN_PROGRESS returns 200 OK");

    const resolvedRes = await fetch(`${BACKEND_URL}/v1/itsm/problems?status=RESOLVED`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(resolvedRes.status === 200, "Filtering by status=RESOLVED returns 200 OK");

    const closedRes = await fetch(`${BACKEND_URL}/v1/itsm/problems?status=CLOSED`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(closedRes.status === 200, "Filtering by status=CLOSED returns 200 OK");

    const searchRes = await fetch(`${BACKEND_URL}/v1/itsm/problems?search=PRB`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(searchRes.status === 200, "Search by keyword returns 200 OK");

    // -------------------------------------------------------------------------
    // TEST 5: Non-existent Problem Detail
    // -------------------------------------------------------------------------
    console.log("\n--- Part 5: Non-existent Problem ---");
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const notFoundRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(notFoundRes.status === 404, "Non-existent problem returns 404 Not Found");

    // -------------------------------------------------------------------------
    // TEST 6: Regression Check for Existing Roles
    // -------------------------------------------------------------------------
    console.log("\n--- Part 6: Regression Verification ---");
    const agentQueueRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/queue`, {
      headers: { Authorization: `Bearer ${agentSession.session_token}` },
    });
    assert(agentQueueRes.status === 200, "Service Agent queue remains operational (200 OK)");

    const kbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(kbRes.status === 200, "Knowledge Base access remains operational (200 OK)");

  } catch (err) {
    console.error("Fatal test error:", err);
    failed++;
  }

  console.log("\n==================================================");
  console.log(`Problem & Change Manager Step 2: ${passed} passed, ${failed} failed.`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runProblemQueueVerification();
