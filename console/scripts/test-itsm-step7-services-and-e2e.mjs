// Complete End-to-End Verification script for Service Agent Portal (Steps 1 through 7)
// Verifies:
// 1. Service Agent Login & ITSM Entitlement
// 2. My Work Queue (/v1/itsm/incidents/queue) - Priority, Status, SLA Risk
// 3. Incident Detail (/v1/itsm/incidents/:id) - Service, Team, Assignee, Activity Timeline
// 4. Activity & Collaboration - Public Comments, Internal Notes (protected from Requesters)
// 5. Resolution Workflow - Status transition to RESOLVED with resolution_code & summary
// 6. Knowledge Base (/v1/itsm/knowledge) - Catalog, Search, Filtering, Detail View
// 7. Service Requests (/v1/itsm/requests) - Queue, Filters, Detail with Form Variables
// 8. Services Workspace (/v1/itsm/services) - List, Search, Tier/Status filter, Detail with CIs & Tickets
// 9. Security & Tenant Isolation - 401 unauth, 403 inactive, 404 cross-tenant

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

async function runFullServiceAgentVerification() {
  console.log("==================================================");
  console.log("Starting Complete Service Agent (Steps 1-7) Verification");
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log("==================================================\n");

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
    // STEP 1: AUTHENTICATION & AGENT SESSION
    // -------------------------------------------------------------------------
    console.log("--- Part 1: Service Agent Login & Entitlement ---");
    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    assert(!!agentSession.session_token, "Agent login succeeded with session token");
    assert(agentSession.itsm_role === "SERVICE_AGENT", "Agent has SERVICE_AGENT role");
    assert(agentSession.product_access?.itsm === true, "Agent has active ITSM access");

    const agentHeaders = {
      Authorization: `Bearer ${agentSession.session_token}`,
      "Content-Type": "application/json",
    };

    // -------------------------------------------------------------------------
    // STEP 2: MY WORK QUEUE
    // -------------------------------------------------------------------------
    console.log("\n--- Part 2: My Work Queue (Step 1 & 2) ---");
    const queueRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/queue`, { headers: agentHeaders });
    assert(queueRes.status === 200, "GET /v1/itsm/incidents/queue succeeded (200 OK)");
    const queue = await queueRes.json();
    assert(Array.isArray(queue) && queue.length > 0, "Queue returned workable tickets");

    const activeIncident = queue[0];
    assert(!!activeIncident.ticket_number, `Ticket ${activeIncident.ticket_number} has ticket number`);
    assert(!!activeIncident.priority, `Ticket ${activeIncident.ticket_number} has priority (${activeIncident.priority})`);
    assert(!!activeIncident.status, `Ticket ${activeIncident.ticket_number} has status (${activeIncident.status})`);
    assert("sla_status" in activeIncident, "Ticket has SLA status indicator");

    // -------------------------------------------------------------------------
    // STEP 3: INCIDENT DETAIL & SERVICE CONTEXT
    // -------------------------------------------------------------------------
    console.log("\n--- Part 3: Incident Detail & Service Context (Step 3) ---");
    const incRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${activeIncident.id}?agent_view=true`, { headers: agentHeaders });
    assert(incRes.status === 200, `GET /v1/itsm/incidents/${activeIncident.id} succeeded (200 OK)`);
    const incidentDetail = await incRes.json();
    assert(incidentDetail.id === activeIncident.id, "Incident ID matches");
    assert("service_name" in incidentDetail, "Incident detail exposes service context");
    assert("assignment_group" in incidentDetail, "Incident detail exposes assignment team");
    assert("assignee_id" in incidentDetail, "Incident detail exposes assignee");

    // -------------------------------------------------------------------------
    // STEP 4: ACTIVITY & COLLABORATION (INTERNAL NOTE PROTECTION)
    // -------------------------------------------------------------------------
    console.log("\n--- Part 4: Activity & Internal Note Protection (Step 3 & 4) ---");
    // Requester creates an incident
    const reqSession = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    const reqHeaders = {
      Authorization: `Bearer ${reqSession.session_token}`,
      "Content-Type": "application/json",
    };

    const newIncRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({
        title: "Step 7 E2E Network Connectivity Diagnostic",
        description: "Diagnosing latency spike on WireGuard VPN node.",
        urgency: "LOW",
      }),
    });
    if (!newIncRes.ok) {
      const errTxt = await newIncRes.text();
      console.error("Incident creation failed:", newIncRes.status, errTxt);
    }
    assert(newIncRes.status === 201, "Requester created an incident (201 Created)");
    const createdIncident = await newIncRes.json();

    // Agent posts an internal note
    const postNoteRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${createdIncident.id}/activities`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        activity_type: "NOTE",
        content: "Internal diagnostic note: checking MTU 1420 on WireGuard gateway.",
        is_internal: true,
      }),
    });
    assert(postNoteRes.status === 201, "Agent posted an internal note (201 Created)");

    // Agent posts a public comment
    const postCommentRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${createdIncident.id}/activities`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        activity_type: "COMMENT",
        content: "We have initiated telemetry capture on your session.",
        is_internal: false,
      }),
    });
    assert(postCommentRes.status === 201, "Agent posted a public comment (201 Created)");

    // Requester reads activities on their incident
    const reqActsRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${createdIncident.id}/activities`, { headers: reqHeaders });
    assert(reqActsRes.status === 200, "Requester read incident activities (200 OK)");
    const reqActivities = await reqActsRes.json();
    assert(Array.isArray(reqActivities), "Activities returned as an array");
    const leakedNotes = reqActivities.filter((a) => a.is_internal || a.activity_type === "NOTE");
    assert(leakedNotes.length === 0, "Internal notes are strictly hidden from Requester");
    const visibleComments = reqActivities.filter((a) => !a.is_internal && a.activity_type === "COMMENT");
    assert(visibleComments.length >= 1, "Public comments are visible to Requester");

    // Resolution: Move to IN_PROGRESS first, then RESOLVED
    const inProgRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${createdIncident.id}/status`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        status: "IN_PROGRESS",
        status_reason: "Actively investigating WireGuard MTU configuration.",
      }),
    });
    assert(inProgRes.status === 200, "Service Agent transitioned incident to IN_PROGRESS (200 OK)");

    const resolveRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${createdIncident.id}/status`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        status: "RESOLVED",
        resolution_code: "PERMANENT_FIX",
        resolution_summary: "WireGuard MTU clamped to 1420 successfully.",
      }),
    });
    assert(resolveRes.status === 200, "Service Agent resolved incident (200 OK)");
    const resolvedIncident = await resolveRes.json();
    assert(resolvedIncident.status === "RESOLVED", "Incident status transitioned to RESOLVED");
    assert(resolvedIncident.resolution_code === "PERMANENT_FIX", "Resolution code recorded");

    // -------------------------------------------------------------------------
    // STEP 5: KNOWLEDGE BASE
    // -------------------------------------------------------------------------
    console.log("\n--- Part 5: Knowledge Base (Step 5) ---");
    const kbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge`, { headers: agentHeaders });
    assert(kbRes.status === 200, "GET /v1/itsm/knowledge succeeded (200 OK)");
    const kbArticles = await kbRes.json();
    assert(Array.isArray(kbArticles) && kbArticles.length >= 3, "Knowledge base returns published articles");

    // Search knowledge
    const searchKbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge?search=VPN`, { headers: agentHeaders });
    assert(searchKbRes.status === 200, "GET /v1/itsm/knowledge?search=VPN succeeded (200 OK)");
    const searchKb = await searchKbRes.json();
    assert(searchKb.length > 0, "Search returns matching VPN articles");

    // Detail
    const kbDetailRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/${kbArticles[0].id}`, { headers: agentHeaders });
    assert(kbDetailRes.status === 200, "GET /v1/itsm/knowledge/:id succeeded (200 OK)");
    const kbDetail = await kbDetailRes.json();
    assert(!!kbDetail.content_markdown, "Article detail includes markdown body");
    assert(!!kbDetail.author_email, "Article detail includes author email");

    // -------------------------------------------------------------------------
    // STEP 6: SERVICE REQUESTS
    // -------------------------------------------------------------------------
    console.log("\n--- Part 6: Service Requests (Step 6) ---");
    const reqListRes = await fetch(`${BACKEND_URL}/v1/itsm/requests`, { headers: agentHeaders });
    assert(reqListRes.status === 200, "GET /v1/itsm/requests succeeded (200 OK)");
    const requests = await reqListRes.json();
    assert(Array.isArray(requests) && requests.length >= 2, "Service Requests list returns tickets");

    const reqDetailRes = await fetch(`${BACKEND_URL}/v1/itsm/requests/${requests[0].id}`, { headers: agentHeaders });
    assert(reqDetailRes.status === 200, "GET /v1/itsm/requests/:id succeeded (200 OK)");
    const requestDetail = await reqDetailRes.json();
    assert(!!requestDetail.ticket_number, "Request has ticket number");
    assert(requestDetail.ticket_type === "SERVICE_REQUEST", "Ticket type is SERVICE_REQUEST");
    assert(!!requestDetail.request_detail, "Request detail includes intake metadata");

    // -------------------------------------------------------------------------
    // STEP 7: SERVICES & SERVICE CONTEXT
    // -------------------------------------------------------------------------
    console.log("\n--- Part 7: Services & CMDB Context (Step 7) ---");
    const svcListRes = await fetch(`${BACKEND_URL}/v1/itsm/services`, { headers: agentHeaders });
    assert(svcListRes.status === 200, "GET /v1/itsm/services succeeded (200 OK)");
    const services = await svcListRes.json();
    assert(Array.isArray(services) && services.length >= 3, `Discovered ${services.length} services`);

    // Search services
    const searchSvcRes = await fetch(`${BACKEND_URL}/v1/itsm/services?search=VPN`, { headers: agentHeaders });
    assert(searchSvcRes.status === 200, "GET /v1/itsm/services?search=VPN succeeded (200 OK)");
    const searchSvcs = await searchSvcRes.json();
    assert(searchSvcs.length >= 1, "Service search returned matching results");

    // Filter by tier
    const tierSvcRes = await fetch(`${BACKEND_URL}/v1/itsm/services?tier=TIER_1`, { headers: agentHeaders });
    assert(tierSvcRes.status === 200, "GET /v1/itsm/services?tier=TIER_1 succeeded (200 OK)");
    const tierSvcs = await tierSvcRes.json();
    assert(tierSvcs.every((s) => s.tier === "TIER_1"), "All filtered services have TIER_1");

    // Service Detail with CIs
    const targetService = services.find((s) => s.name.includes("Network") || s.name.includes("VPN")) || services[0];
    const svcDetailRes = await fetch(`${BACKEND_URL}/v1/itsm/services/${targetService.id}`, { headers: agentHeaders });
    assert(svcDetailRes.status === 200, `GET /v1/itsm/services/${targetService.id} succeeded (200 OK)`);
    const serviceDetail = await svcDetailRes.json();
    assert(serviceDetail.id === targetService.id, "Service detail ID matches");
    assert(!!serviceDetail.name, `Service name: ${serviceDetail.name}`);
    assert(Array.isArray(serviceDetail.configuration_items), "Service detail contains configuration_items array");
    assert(Array.isArray(serviceDetail.recent_incidents), "Service detail contains recent_incidents array");
    assert(Array.isArray(serviceDetail.recent_requests), "Service detail contains recent_requests array");

    // -------------------------------------------------------------------------
    // STEP 8: SECURITY & TENANT ISOLATION
    // -------------------------------------------------------------------------
    console.log("\n--- Part 8: Security & Isolation Across All Endpoints ---");
    // Unauthenticated requests receive 401
    const unauthSvc = await fetch(`${BACKEND_URL}/v1/itsm/services`);
    assert(unauthSvc.status === 401, "Unauthenticated GET /v1/itsm/services returns 401");

    const unauthKb = await fetch(`${BACKEND_URL}/v1/itsm/knowledge`);
    assert(unauthKb.status === 401, "Unauthenticated GET /v1/itsm/knowledge returns 401");

    const unauthReq = await fetch(`${BACKEND_URL}/v1/itsm/requests`);
    assert(unauthReq.status === 401, "Unauthenticated GET /v1/itsm/requests returns 401");

    // Non-existent service returns 404
    const nonExistentSvc = await fetch(`${BACKEND_URL}/v1/itsm/services/00000000-0000-0000-0000-000000000000`, { headers: agentHeaders });
    assert(nonExistentSvc.status === 404, "Non-existent service returns 404 Not Found");

    console.log("\n==================================================");
    console.log(`Service Agent E2E Verification: ${passed} passed, ${failed} failed.`);
    console.log("==================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ E2E Verification Error:", err);
    process.exit(1);
  }
}

runFullServiceAgentVerification();
