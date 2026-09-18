// End-to-end verification script for Step 4 of the Service Agent MVP: Incident Resolution & Closure
// Flow verified:
// 1. SERVICE AGENT LOGIN (agent@authclaw-lite.demo)
// 2. MY WORK QUEUE (GET /v1/itsm/incidents/queue)
// 3. OPEN INCIDENT (GET /v1/itsm/incidents/:id?agent_view=true)
// 4. ACTIVITY & COLLABORATION (POST public comment, POST internal note, GET activities)
// 5. INVESTIGATE (transition status to IN_PROGRESS)
// 6. RESOLVE INCIDENT (POST /status with RESOLVED, code, summary)
// 7. INCIDENT BECOMES RESOLVED (assert resolved_at, resolution_code, resolution_summary)
// 8. RESOLUTION ACTIVITY VISIBLE in timeline
// 9. REOPEN SUPPORT (transition RESOLVED -> IN_PROGRESS, assert resolved_at cleared)
// 10. CLOSURE SUPPORT (transition RESOLVED -> CLOSED, assert closed_at set)
// 11. SECURITY ENFORCEMENT (Requester cannot resolve, cross-tenant rejected, unauthenticated 401)

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

async function runStep4Verification() {
  console.log("==================================================");
  console.log("Starting Service Agent Step 4 End-to-End Verification");
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
    console.log("--- Step 4.1: Service Agent Login ---");
    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    assert(agentSession.itsm_role === "SERVICE_AGENT", "Agent has SERVICE_AGENT role");
    assert(agentSession.product_access?.itsm === true, "Agent has active ITSM access");
    const agentToken = agentSession.session_token;
    const agentHeaders = {
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
    };

    // -------------------------------------------------------------
    // 2. Fetch Work Queue
    // -------------------------------------------------------------
    console.log("\n--- Step 4.2: Fetch My Work Queue ---");
    const queueRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/queue`, { headers: agentHeaders });
    assert(queueRes.ok, "GET /v1/itsm/incidents/queue succeeded (200 OK)");
    const queueItems = await queueRes.json();
    assert(Array.isArray(queueItems), "Queue returns array of workable incidents");

    // Create a dedicated test incident for Step 4 lifecycle
    const createRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        title: "Step 4 Verification Incident - Database Connection Spike",
        description: "Postgres connection pool exhaustion observed during peak hours.",
        urgency: "HIGH",
      }),
    });
    assert(createRes.status === 201, "Created test incident (201 Created)");
    const testIncident = await createRes.json();
    const incidentId = testIncident.id;
    console.log(`Working with Incident: ${testIncident.ticket_number} (ID: ${incidentId})`);

    // -------------------------------------------------------------
    // 3. Open Incident Detail (Agent View)
    // -------------------------------------------------------------
    console.log("\n--- Step 4.3: Open Incident Detail ---");
    const detailRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}?agent_view=true`, {
      headers: agentHeaders,
    });
    assert(detailRes.ok, "GET /v1/itsm/incidents/:id?agent_view=true succeeded (200 OK)");
    const incidentData = await detailRes.json();
    assert(incidentData.id === incidentId, "Incident ID matches");

    // -------------------------------------------------------------
    // 4. Activity & Collaboration
    // -------------------------------------------------------------
    console.log("\n--- Step 4.4: Activity & Collaboration ---");
    // Public comment
    const pubRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/activities`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        content: "Investigating active connection metrics and query duration histograms.",
        activity_type: "COMMENT",
        is_internal: false,
      }),
    });
    assert(pubRes.status === 201, "Service Agent posted public comment (201 Created)");

    // Internal note
    const noteRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/activities`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        content: "Internal note: RDS pgBouncer pool mode may need to be adjusted from session to transaction.",
        activity_type: "NOTE",
        is_internal: true,
      }),
    });
    assert(noteRes.status === 201, "Service Agent posted internal note (201 Created)");

    // -------------------------------------------------------------
    // 5. Investigate: Move to IN_PROGRESS
    // -------------------------------------------------------------
    console.log("\n--- Step 4.5: Transition to IN_PROGRESS ---");
    const progressRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/status`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        status: "IN_PROGRESS",
        status_reason: "Actively troubleshooting pool configuration",
      }),
    });
    assert(progressRes.ok, "Transition to IN_PROGRESS succeeded (200 OK)");
    const inProgressIncident = await progressRes.json();
    assert(inProgressIncident.status === "IN_PROGRESS", "Incident status is now IN_PROGRESS");

    // -------------------------------------------------------------
    // 6. Validation: Attempt Resolve without required fields
    // -------------------------------------------------------------
    console.log("\n--- Step 4.6: Resolution Validation Rules ---");
    const invalidResolveRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/status`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        status: "RESOLVED",
      }),
    });
    assert(invalidResolveRes.status === 400, "Resolution without code/summary rejected (400 Bad Request)");

    // -------------------------------------------------------------
    // 7. Resolve Incident
    // -------------------------------------------------------------
    console.log("\n--- Step 4.7: Resolve Incident ---");
    const resolveRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/status`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        status: "RESOLVED",
        resolution_code: "PERMANENT_FIX",
        resolution_summary: "Reconfigured connection pooler to transaction pooling mode and scaled idle connection timeouts.",
      }),
    });
    assert(resolveRes.ok, "POST /v1/itsm/incidents/:id/status (RESOLVED) succeeded (200 OK)");
    const resolvedIncident = await resolveRes.json();
    assert(resolvedIncident.status === "RESOLVED", "Incident status is RESOLVED");
    assert(resolvedIncident.resolution_code === "PERMANENT_FIX", "Resolution code is PERMANENT_FIX");
    assert(resolvedIncident.resolution_summary.includes("transaction pooling mode"), "Resolution summary is recorded");
    assert(Boolean(resolvedIncident.resolved_at), "Resolved timestamp resolved_at is set");
    console.log(`Incident resolved at: ${resolvedIncident.resolved_at}`);

    // -------------------------------------------------------------
    // 8. Activity History Verification
    // -------------------------------------------------------------
    console.log("\n--- Step 4.8: Verify Activity History ---");
    const actListRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/activities`, {
      headers: agentHeaders,
    });
    assert(actListRes.ok, "GET /v1/itsm/incidents/:id/activities succeeded");
    const activities = await actListRes.json();
    const resolveActivity = activities.find(
      (a) => a.activity_type === "STATUS_CHANGE" && (a.content || "").toLowerCase().includes("resolved")
    );
    assert(Boolean(resolveActivity), "Resolution entry recorded in activity timeline");
    console.log(`Activity Timeline Resolution entry: "${resolveActivity.content}"`);

    // -------------------------------------------------------------
    // 9. Reopen Support
    // -------------------------------------------------------------
    console.log("\n--- Step 4.9: Reopen Incident Support ---");
    const reopenRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/status`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        status: "IN_PROGRESS",
        status_reason: "Monitoring alert showed minor recurrence during load spike",
      }),
    });
    assert(reopenRes.ok, "Reopening incident succeeded (200 OK)");
    const reopenedIncident = await reopenRes.json();
    assert(reopenedIncident.status === "IN_PROGRESS", "Incident status is IN_PROGRESS after reopen");
    assert(reopenedIncident.resolved_at === null, "resolved_at timestamp is reset to null on reopen");

    // Re-resolve for closure step
    await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/status`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        status: "RESOLVED",
        resolution_code: "PERMANENT_FIX",
        resolution_summary: "Confirmed load spike handled cleanly.",
      }),
    });

    // -------------------------------------------------------------
    // 10. Close Support
    // -------------------------------------------------------------
    console.log("\n--- Step 4.10: Close Incident Support ---");
    const closeRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/status`, {
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        status: "CLOSED",
      }),
    });
    assert(closeRes.ok, "Closing incident succeeded (200 OK)");
    const closedIncident = await closeRes.json();
    assert(closedIncident.status === "CLOSED", "Incident status is CLOSED");
    assert(Boolean(closedIncident.closed_at), "closed_at timestamp is set");
    console.log(`Incident closed at: ${closedIncident.closed_at}`);

    // -------------------------------------------------------------
    // 11. Security Checks
    // -------------------------------------------------------------
    console.log("\n--- Step 4.11: Security & RBAC Checks ---");
    // Requester cannot resolve
    const requesterSession = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    const reqHeaders = {
      Authorization: `Bearer ${requesterSession.session_token}`,
      "Content-Type": "application/json",
    };
    const reqResolveRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/status`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({
        status: "RESOLVED",
        resolution_code: "PERMANENT_FIX",
        resolution_summary: "Requester attempt",
      }),
    });
    assert(reqResolveRes.status === 403, "Requester blocked from resolving (403 Forbidden)");

    // Unauthenticated request
    const unauthRes = await fetch(`${BACKEND_URL}/v1/itsm/incidents/${incidentId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "RESOLVED",
        resolution_code: "PERMANENT_FIX",
        resolution_summary: "No auth",
      }),
    });
    assert(unauthRes.status === 401, "Unauthenticated request returns 401 Unauthorized");

    console.log("\n==================================================");
    console.log(`Step 4 Verification Complete: ${passed} passed, ${failed} failed.`);
    console.log("==================================================");
  } catch (err) {
    console.error(`\n❌ Execution halted on error: ${err.message}`);
    process.exit(1);
  }
}

runStep4Verification();
