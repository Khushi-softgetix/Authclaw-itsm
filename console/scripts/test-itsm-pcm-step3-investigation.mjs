// Live End-to-End Verification script for Problem and Change Manager (Step 3 Problem Investigation & Root Cause)
// Verifies:
// 1. Unauthenticated protection (401)
// 2. Role authorization enforcement (403 Forbidden for REQUESTER and SERVICE_AGENT)
// 3. Problem Investigation recording via PATCH /v1/itsm/problems/{id}/investigation (200 OK)
// 4. Persistence of Root Cause, Workaround, Known Error flag, Permanent Solution, and RCA URL
// 5. Lifecycle status transitions (OPEN -> IN_PROGRESS)
// 6. Chronological Activity history logging via GET /v1/itsm/problems/{id}/activities
// 7. Input validation (400 Bad Request on invalid status)
// 8. Regression checks across ITSM roles

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

async function runInvestigationVerification() {
  console.log("==================================================");
  console.log("Starting Problem and Change Manager (Step 3) Investigation Verification");
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
    const fakeId = "00000000-0000-0000-0000-000000000001";
    const unauthInv = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/investigation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root_cause_summary: "Test" }),
    });
    assert(unauthInv.status === 401, "Unauthenticated PATCH /v1/itsm/problems/{id}/investigation returns 401");

    const unauthActs = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/activities`);
    assert(unauthActs.status === 401, "Unauthenticated GET /v1/itsm/problems/{id}/activities returns 401");

    // -------------------------------------------------------------------------
    // TEST 2: Role Authorization Checks
    // -------------------------------------------------------------------------
    console.log("\n--- Part 2: Role Authorization Boundaries ---");
    const reqSession = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    const reqRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/investigation`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${reqSession.session_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ root_cause_summary: "Test" }),
    });
    assert(reqRes.status === 403, "Requester role is forbidden from updating investigations (403)");

    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    const agentRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/investigation`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${agentSession.session_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ root_cause_summary: "Test" }),
    });
    assert(agentRes.status === 403, "Service Agent role is forbidden from updating investigations (403)");

    // -------------------------------------------------------------------------
    // TEST 3: Login as Problem and Change Manager
    // -------------------------------------------------------------------------
    console.log("\n--- Part 3: Problem and Change Manager Investigation Workflow ---");
    const pcmSession = await login("processchange@authclaw-lite.demo", "AuthClawDemo!234");
    const pcmToken = pcmSession.session_token;

    // Get problem queue to pick an active problem
    const listRes = await fetch(`${BACKEND_URL}/v1/itsm/problems`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(listRes.status === 200, "PCM can list problems queue (200 OK)");
    const problems = await listRes.json();
    assert(problems.length > 0, "At least one problem exists for investigation testing");

    const targetProblem = problems[0];
    const problemId = targetProblem.id;
    console.log(`Target Problem: ${targetProblem.ticket_number} - "${targetProblem.title}" (ID: ${problemId})`);

    // -------------------------------------------------------------------------
    // TEST 4: Record Root-Cause Investigation & Known Error
    // -------------------------------------------------------------------------
    console.log("\n--- Part 4: Updating Problem Investigation & Root Cause ---");
    const testRootCause = "Connection pool exhaustion due to missing idle connection reaper timeout.";
    const testWorkaround = "Reboot connection pool nodes periodically and throttle inbound sync batches.";
    const testPermanent = "Implement automatic connection leak detector and socket keep-alive patch.";
    const testRcaUrl = "https://wiki.demo.authclaw.com/rca/prb-leak-fix";
    const testNote = "Diagnostic trace completed. Root cause isolated to connection pool configuration.";

    const patchRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/investigation`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "IN_PROGRESS",
        known_error: true,
        root_cause_summary: testRootCause,
        workaround_summary: testWorkaround,
        permanent_solution: testPermanent,
        rca_document_url: testRcaUrl,
        investigation_notes: testNote,
      }),
    });
    assert(patchRes.status === 200, "PATCH investigation returns 200 OK");
    const updatedProblem = await patchRes.json();

    assert(updatedProblem.status === "IN_PROGRESS", "Problem status updated to IN_PROGRESS");
    assert(updatedProblem.problem_details !== null, "Problem details record is populated");
    assert(updatedProblem.problem_details.known_error === true, "Known error flag is true");
    assert(updatedProblem.problem_details.root_cause_summary === testRootCause, "Root cause summary persisted correctly");
    assert(updatedProblem.problem_details.workaround_summary === testWorkaround, "Workaround summary persisted correctly");
    assert(updatedProblem.problem_details.permanent_solution === testPermanent, "Permanent solution persisted correctly");
    assert(updatedProblem.problem_details.rca_document_url === testRcaUrl, "RCA document URL persisted correctly");

    // -------------------------------------------------------------------------
    // TEST 5: Verify Activity Timeline History
    // -------------------------------------------------------------------------
    console.log("\n--- Part 5: Activity / History Timeline Verification ---");
    const activitiesRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/activities`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(activitiesRes.status === 200, "GET problem activities returns 200 OK");
    const activities = await activitiesRes.json();
    assert(Array.isArray(activities), "Activities returned as an array");
    assert(activities.length > 0, "At least one activity event recorded");

    const noteAct = activities.find((a) => a.activity_type === "INVESTIGATION" && a.content?.includes("Diagnostic trace completed"));
    assert(Boolean(noteAct), "Investigation note is present in the activity history");
    if (noteAct) {
      assert(Boolean(noteAct.actor_email), `Activity includes actor email (${noteAct.actor_email})`);
    }

    // -------------------------------------------------------------------------
    // TEST 6: Input Validation (Invalid Status)
    // -------------------------------------------------------------------------
    console.log("\n--- Part 6: Input Validation ---");
    const invalidStatusRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/investigation`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "NOT_A_VALID_STATUS" }),
    });
    assert(invalidStatusRes.status === 400, "Invalid status yields 400 Bad Request");

    // -------------------------------------------------------------------------
    // TEST 7: Problem Detail Endpoint Verification
    // -------------------------------------------------------------------------
    console.log("\n--- Part 7: Problem Detail Verification ---");
    const detailRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(detailRes.status === 200, "GET problem detail returns 200 OK");
    const freshDetail = await detailRes.json();
    assert(freshDetail.problem_details.known_error === true, "Detail endpoint reflects known_error");
    assert(freshDetail.problem_details.root_cause_summary === testRootCause, "Detail endpoint reflects root cause");

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log("\n==================================================");
    console.log(`Step 3 Verification Complete: ${passed} passed, ${failed} failed`);
    console.log("==================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Verification failed with exception:", err);
    process.exit(1);
  }
}

runInvestigationVerification();
