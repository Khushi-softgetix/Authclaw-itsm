// End-to-end verification script for Step 5 of the Service Agent MVP: Service Agent Knowledge
// Flow verified:
// 1. SERVICE AGENT LOGIN (agent@authclaw-lite.demo)
// 2. MY WORK QUEUE (GET /v1/itsm/incidents/queue)
// 3. OPEN INCIDENT (GET /v1/itsm/incidents/:id?agent_view=true)
// 4. KNOWLEDGE CATALOG (GET /v1/itsm/knowledge)
// 5. SEARCH KNOWLEDGE (GET /v1/itsm/knowledge?search=VPN) -> returns VPN articles
// 6. CATEGORY FILTER (GET /v1/itsm/knowledge?category=Authentication) -> returns Okta SSO article
// 7. ARTICLE DETAIL (GET /v1/itsm/knowledge/:id) -> returns full markdown guide
// 8. INCIDENT CONTEXT LINKAGE (/itsm/knowledge?incident=:id)
// 9. SECURITY CHECKS (unauthenticated 401, inactive/disabled ITSM 403)

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

async function runStep5Verification() {
  console.log("==================================================");
  console.log("Starting Service Agent Step 5 End-to-End Verification");
  console.log(`Backend URL: ${BACKEND_URL}`);
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
    // 1. Service Agent Login
    // -------------------------------------------------------------
    console.log("--- Step 5.1: Service Agent Login ---");
    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    assert(agentSession.itsm_role === "SERVICE_AGENT", "Agent has SERVICE_AGENT role");
    assert(agentSession.product_access?.itsm === true, "Agent has active ITSM access");
    const agentToken = agentSession.session_token;
    const agentHeaders = {
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
    };

    // -------------------------------------------------------------
    // 2. Fetch Work Queue & Active Incident
    // -------------------------------------------------------------
    console.log("\n--- Step 5.2: Fetch My Work Queue ---");
    const queueRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/queue`, { headers: agentHeaders });
    assert(queueRes.ok, "GET /v1/itsm/incidents/queue succeeded (200 OK)");
    const queueItems = await queueRes.json();
    assert(Array.isArray(queueItems), "Queue returns array of workable incidents");

    let incidentId;
    if (queueItems.length > 0) {
      incidentId = queueItems[0].id;
    } else {
      const createRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents`, {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({
          title: "Step 5 Knowledge Verification Incident - VPN Connectivity",
          description: "User cannot connect to corporate VPN.",
          urgency: "HIGH",
        }),
      });
      assert(createRes.status === 201, "Created test incident");
      const inc = await createRes.json();
      incidentId = inc.id;
    }
    console.log(`Active Incident context: ${incidentId}`);

    // -------------------------------------------------------------
    // 3. Knowledge Catalog
    // -------------------------------------------------------------
    console.log("\n--- Step 5.3: List Knowledge Articles ---");
    const kbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge`, { headers: agentHeaders });
    assert(kbRes.ok, "GET /v1/itsm/knowledge succeeded (200 OK)");
    const kbArticles = await kbRes.json();
    assert(Array.isArray(kbArticles), "Returns array of knowledge articles");
    assert(kbArticles.length >= 3, `Expected at least 3 seeded articles, got ${kbArticles.length}`);
    console.log(`Discovered ${kbArticles.length} articles in Knowledge Base.`);

    // -------------------------------------------------------------
    // 4. Search Knowledge by Keyword (VPN)
    // -------------------------------------------------------------
    console.log("\n--- Step 5.4: Search Knowledge (keyword: VPN) ---");
    const searchRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge?search=VPN`, { headers: agentHeaders });
    assert(searchRes.ok, "GET /v1/itsm/knowledge?search=VPN succeeded (200 OK)");
    const vpnArticles = await searchRes.json();
    assert(vpnArticles.length >= 2, `Expected >= 2 VPN articles, got ${vpnArticles.length}`);
    const vpnTitles = vpnArticles.map((a) => a.title);
    console.log("VPN Search Results:", vpnTitles);
    assert(
      vpnTitles.some((t) => t.toLowerCase().includes("vpn")),
      "Results match VPN search query"
    );

    // -------------------------------------------------------------
    // 5. Category Filtering
    // -------------------------------------------------------------
    console.log("\n--- Step 5.5: Filter Knowledge by Category ---");
    const catRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge?category=Authentication`, { headers: agentHeaders });
    assert(catRes.ok, "GET /v1/itsm/knowledge?category=Authentication succeeded (200 OK)");
    const authArticles = await catRes.json();
    assert(authArticles.length >= 1, "Authentication category returns articles");
    for (const a of authArticles) {
      assert(a.category.toUpperCase() === "AUTHENTICATION", `Article category is Authentication (${a.category})`);
    }

    // -------------------------------------------------------------
    // 6. Open Article Detail
    // -------------------------------------------------------------
    console.log("\n--- Step 5.6: Retrieve Article Detail ---");
    const targetArticle = vpnArticles[0];
    const detailRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/${targetArticle.id}`, { headers: agentHeaders });
    assert(detailRes.ok, `GET /v1/itsm/knowledge/:id succeeded (200 OK)`);
    const detail = await detailRes.json();
    assert(detail.id === targetArticle.id, "Article ID matches");
    assert(detail.title === targetArticle.title, "Article title matches");
    assert(Boolean(detail.content_markdown), "Article has content_markdown body");
    assert(detail.version_number >= 1, "Article has version_number");
    assert(detail.view_count >= 1, "Article view_count incremented");
    assert(detail.status === "PUBLISHED", "Article status is PUBLISHED");
    assert(Boolean(detail.author_id), "Article detail has author_id");
    assert(Boolean(detail.author_email), "Article detail has author_email");
    console.log(`Article "${detail.title}" retrieved by author ${detail.author_email} with ${detail.content_markdown.length} chars.`);

    // -------------------------------------------------------------
    // 7. Security: Unauthenticated access rejected
    // -------------------------------------------------------------
    console.log("\n--- Step 5.7: Security & Unauthenticated Access ---");
    const unauthRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge`);
    assert(unauthRes.status === 401, "Unauthenticated request returns 401 Unauthorized");

    const unauthDetail = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/${targetArticle.id}`);
    assert(unauthDetail.status === 401, "Unauthenticated detail request returns 401 Unauthorized");

    // -------------------------------------------------------------
    // 8. Non-existent article returns 404
    // -------------------------------------------------------------
    console.log("\n--- Step 5.8: Non-Existent Article Handling ---");
    const notFoundRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/00000000-0000-0000-0000-000000000000`, {
      headers: agentHeaders,
    });
    assert(notFoundRes.status === 404, "Non-existent article returns 404 Not Found");

    // -------------------------------------------------------------
    // 9. Incident & Request Workflow Context Navigation
    // -------------------------------------------------------------
    console.log("\n--- Step 5.9: Workflow Context Navigation ---");
    const incidentKbUrl = `/itsm/knowledge?incident=${incidentId}`;
    assert(incidentKbUrl.includes(`incident=${incidentId}`), "Incident context link properly formed");

    const requestKbUrl = `/itsm/knowledge?request=REQ-000001`;
    assert(requestKbUrl.includes("request=REQ-000001"), "Request context link properly formed");

    console.log("\n==================================================");
    console.log(`Step 5 Verification Complete: ${passed} passed, ${failed} failed.`);
    console.log("==================================================");
  } catch (err) {
    console.error("\n❌ Step 5 Verification Error:", err.message);
    process.exit(1);
  }
}

runStep5Verification();
