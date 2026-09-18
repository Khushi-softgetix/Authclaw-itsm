// End-to-end verification script for Step 6 of the Service Agent portal: Service Request Work
// Flow verified:
// 1. SERVICE AGENT LOGIN (agent@authclaw-lite.demo)
// 2. LIST SERVICE REQUESTS (GET /v1/itsm/requests)
// 3. SEARCH REQUESTS (GET /v1/itsm/requests?search=Laptop)
// 4. FILTER BY STATUS (GET /v1/itsm/requests?status=IN_PROGRESS)
// 5. GET REQUEST DETAIL (GET /v1/itsm/requests/:id) -> verify catalog intake form variables
// 6. ADD ACTIVITY / COMMENT (POST /v1/itsm/requests/:id/activities) -> verify in timeline
// 7. STATUS TRANSITION (POST /v1/itsm/requests/:id/status) -> resolve request
// 8. SECURITY CHECKS (unauthenticated 401, non-existent 404)

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

async function runStep6Verification() {
  console.log("==================================================");
  console.log("Starting Service Agent Step 6 End-to-End Verification");
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
    console.log("--- Step 6.1: Service Agent Login ---");
    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    assert(agentSession.itsm_role === "SERVICE_AGENT", "Agent has SERVICE_AGENT role");
    assert(agentSession.product_access?.itsm === true, "Agent has active ITSM access");
    const agentToken = agentSession.session_token;
    const agentHeaders = {
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
    };

    // -------------------------------------------------------------
    // 2. List Service Requests
    // -------------------------------------------------------------
    console.log("\n--- Step 6.2: List Service Requests ---");
    const listRes = await fetch(`${BACKEND_URL}/v1/itsm/requests`, { headers: agentHeaders });
    assert(listRes.ok, "GET /v1/itsm/requests succeeded (200 OK)");
    const requests = await listRes.json();
    assert(Array.isArray(requests), "Returns array of service requests");
    assert(requests.length >= 3, `Expected at least 3 seeded requests, found ${requests.length}`);
    for (const req of requests) {
      assert(req.ticket_type === "SERVICE_REQUEST", `Ticket ${req.ticket_number} has ticket_type SERVICE_REQUEST`);
      assert(Boolean(req.ticket_number), "Ticket has ticket_number");
      assert(Boolean(req.title), "Ticket has title/short description");
      assert(Boolean(req.status), "Ticket has status");
      assert(Boolean(req.priority), "Ticket has priority");
    }
    console.log(`Found ${requests.length} service requests in agent workspace.`);

    // -------------------------------------------------------------
    // 3. Search Service Requests
    // -------------------------------------------------------------
    console.log("\n--- Step 6.3: Search Service Requests (query: Laptop) ---");
    const searchRes = await fetch(`${BACKEND_URL}/v1/itsm/requests?search=Laptop`, { headers: agentHeaders });
    assert(searchRes.ok, "GET /v1/itsm/requests?search=Laptop succeeded (200 OK)");
    const searchResults = await searchRes.json();
    assert(searchResults.length >= 1, "Search returns at least 1 match for 'Laptop'");
    assert(
      searchResults.some((r) => r.title.toLowerCase().includes("laptop") || r.ticket_number.toLowerCase().includes("laptop")),
      "Result title or number matches search keyword"
    );

    // -------------------------------------------------------------
    // 4. Filter by Status
    // -------------------------------------------------------------
    console.log("\n--- Step 6.4: Filter Requests by Status ---");
    const openRes = await fetch(`${BACKEND_URL}/v1/itsm/requests?status=OPEN`, { headers: agentHeaders });
    assert(openRes.ok, "GET /v1/itsm/requests?status=OPEN succeeded (200 OK)");
    const openRequests = await openRes.json();
    for (const r of openRequests) {
      assert(r.status === "NEW" || r.status === "ASSIGNED", `Filtered request status is open (NEW or ASSIGNED) (${r.status})`);
    }

    // -------------------------------------------------------------
    // 5. Get Request Detail with Submitted Form Variables
    // -------------------------------------------------------------
    console.log("\n--- Step 6.5: Get Service Request Detail & Intake Variables ---");
    const targetRequest = requests.find((r) => r.ticket_number === "REQ-000001") || requests[0];
    const detailRes = await fetch(`${BACKEND_URL}/v1/itsm/requests/${targetRequest.id}`, { headers: agentHeaders });
    assert(detailRes.ok, `GET /v1/itsm/requests/:id succeeded (200 OK)`);
    const detail = await detailRes.json();
    assert(detail.id === targetRequest.id, "Request ID matches");
    assert(detail.ticket_number === targetRequest.ticket_number, "Ticket number matches");
    assert(Boolean(detail.request_detail), "Request detail object is populated");
    assert(Boolean(detail.request_detail.catalog_item_name), "Catalog item name is captured");
    assert(Boolean(detail.request_detail.submitted_form_data), "submitted_form_data is captured");
    console.log("Submitted Intake Variables:", JSON.stringify(detail.request_detail.submitted_form_data));
    assert(
      Object.keys(detail.request_detail.submitted_form_data).length > 0,
      "Intake variables dictionary contains at least 1 field"
    );

    // -------------------------------------------------------------
    // 6. Add Activity Comment & Verify Timeline
    // -------------------------------------------------------------
    console.log("\n--- Step 6.6: Add Activity Comment to Service Request ---");
    const commentBody = `Fulfillment work logged by Service Agent at ${new Date().toISOString()}`;
    const actPostRes = await fetch(`${BACKEND_URL}/v1/itsm/requests/${targetRequest.id}/activities`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        activity_type: "NOTE",
        content: commentBody,
        is_internal: true,
      }),
    });
    assert(actPostRes.status === 201, `POST /v1/itsm/requests/:id/activities succeeded (201 Created)`);
    const newActivity = await actPostRes.json();
    assert(newActivity.content === commentBody, "Activity content matches comment");
    assert(newActivity.activity_type === "NOTE", "Activity type matches NOTE");

    const getActsRes = await fetch(`${BACKEND_URL}/v1/itsm/requests/${targetRequest.id}/activities`, {
      headers: agentHeaders,
    });
    assert(getActsRes.ok, "GET /v1/itsm/requests/:id/activities succeeded (200 OK)");
    const allActivities = await getActsRes.json();
    assert(
      allActivities.some((a) => a.id === newActivity.id),
      "New activity is present in ticket activity timeline"
    );

    // -------------------------------------------------------------
    // 7. Request Status Transitions (Lifecycle Progression)
    // -------------------------------------------------------------
    console.log("\n--- Step 6.7: Status Lifecycle Transitions ---");
    if (targetRequest.status === "RESOLVED") {
      const reopenRes = await fetch(`${BACKEND_URL}/v1/itsm/requests/${targetRequest.id}/status`, {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({
          status: "IN_PROGRESS",
          status_reason: "Reopening for fulfillment verification",
        }),
      });
      assert(reopenRes.ok, `POST /v1/itsm/requests/:id/status (Reopen to IN_PROGRESS) succeeded (200 OK)`);
    } else if (targetRequest.status === "NEW" || targetRequest.status === "ASSIGNED") {
      const startRes = await fetch(`${BACKEND_URL}/v1/itsm/requests/${targetRequest.id}/status`, {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({
          status: "IN_PROGRESS",
          status_reason: "Fulfillment work started",
        }),
      });
      assert(startRes.ok, `POST /v1/itsm/requests/:id/status (IN_PROGRESS) succeeded (200 OK)`);
      const startedReq = await startRes.json();
      assert(startedReq.status === "IN_PROGRESS", "Status updated to IN_PROGRESS");
    }

    // Transition IN_PROGRESS -> RESOLVED
    const statusUpdateRes = await fetch(`${BACKEND_URL}/v1/itsm/requests/${targetRequest.id}/status`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        status: "RESOLVED",
        resolution_code: "Fulfilled",
        resolution_summary: "Hardware provisioned and handed off to employee.",
      }),
    });
    assert(statusUpdateRes.ok, `POST /v1/itsm/requests/:id/status (RESOLVED) succeeded (200 OK)`);
    const updatedReq = await statusUpdateRes.json();
    assert(updatedReq.status === "RESOLVED", "Ticket status successfully updated to RESOLVED");
    assert(Boolean(updatedReq.resolved_at), "resolved_at timestamp populated upon resolution");

    // -------------------------------------------------------------
    // 8. Security & Edge Case Checks
    // -------------------------------------------------------------
    console.log("\n--- Step 6.8: Security & Error Handling ---");
    const unauthList = await fetch(`${BACKEND_URL}/v1/itsm/requests`);
    assert(unauthList.status === 401, "Unauthenticated list request returns 401 Unauthorized");

    const unauthDetail = await fetch(`${BACKEND_URL}/v1/itsm/requests/${targetRequest.id}`);
    assert(unauthDetail.status === 401, "Unauthenticated detail request returns 401 Unauthorized");

    const notFoundRes = await fetch(`${BACKEND_URL}/v1/itsm/requests/00000000-0000-0000-0000-000000000000`, {
      headers: agentHeaders,
    });
    assert(notFoundRes.status === 404, "Non-existent request returns 404 Not Found");

    console.log("\n==================================================");
    console.log(`Step 6 Verification Complete: ${passed} passed, ${failed} failed.`);
    console.log("==================================================");
  } catch (err) {
    console.error("\n❌ Step 6 Verification Error:", err.message);
    process.exit(1);
  }
}

runStep6Verification();
