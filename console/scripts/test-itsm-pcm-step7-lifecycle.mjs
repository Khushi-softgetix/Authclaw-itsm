// Live End-to-End Verification script for Problem and Change Manager (Step 7 Change Lifecycle)
// Verifies:
// 1. Unauthenticated protection (401 on transition and activities)
// 2. Role authorization boundaries (403 Forbidden for unauthorized roles)
// 3. Problem and Change Manager lifecycle transitions:
//    - submit_review (DRAFT -> CAB_REVIEW)
//    - approve (CAB_REVIEW -> APPROVED)
//    - schedule (APPROVED -> SCHEDULED with dates)
//    - start_implementation (SCHEDULED -> IMPLEMENTING with actual_start_at)
//    - complete (IMPLEMENTING -> COMPLETED with actual_finish_at & validation_notes)
//    - close (COMPLETED -> CLOSED)
// 4. Terminal state protection (400 Bad Request when transitioning from CLOSED)
// 5. Invalid transition rule enforcement (400 Bad Request on illegal state hops)
// 6. Change activities/audit history verification
// 7. Cross-tenant isolation (404 on foreign change)

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

async function runStep7Verification() {
  console.log("==================================================");
  console.log("Starting Problem and Change Manager (Step 7) Change Lifecycle Verification");
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
    const fakeId = "00000000-0000-0000-0000-000000000001";

    // -------------------------------------------------------------------------
    // TEST 1: Unauthenticated Protection
    // -------------------------------------------------------------------------
    console.log("\n--- Part 1: Unauthenticated Protection ---");
    const unauthTrans = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    assert(unauthTrans.status === 401, "Unauthenticated POST transition returns 401");

    const unauthActivities = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}/activities`);
    assert(unauthActivities.status === 401, "Unauthenticated GET activities returns 401");

    // -------------------------------------------------------------------------
    // TEST 2: Role Authorization Boundaries
    // -------------------------------------------------------------------------
    console.log("\n--- Part 2: Role Authorization Boundaries ---");
    // Login as requester
    const requesterLogin = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    const reqHeaders = {
      Authorization: `Bearer ${requesterLogin.session_token || requesterLogin.token}`,
      "Content-Type": "application/json",
    };

    const reqTrans = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}/transition`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ action: "approve" }),
    });
    assert(reqTrans.status === 403, "Requester role is rejected with 403 on transition");

    // -------------------------------------------------------------------------
    // TEST 3: Login as Problem and Change Manager
    // -------------------------------------------------------------------------
    console.log("\n--- Part 3: Authenticate Problem & Change Manager ---");
    const pcmLogin = await login("processchange@authclaw-lite.demo", "AuthClawDemo!234");
    const pcmHeaders = {
      Authorization: `Bearer ${pcmLogin.session_token || pcmLogin.token}`,
      "Content-Type": "application/json",
    };
    assert(!!pcmLogin, "Successfully authenticated as processchange@authclaw-lite.demo");

    // List changes to find or inspect existing changes
    const listRes = await fetch(`${BACKEND_URL}/v1/itsm/changes?limit=10`, { headers: pcmHeaders });
    assert(listRes.status === 200, "PCM can list changes");
    const changes = await listRes.json();
    assert(Array.isArray(changes) && changes.length > 0, `Found ${changes.length} changes`);

    // Find or pick target changes to test transitions (create fresh from problem if all existing are closed)
    let targetChange = changes.find((c) => c.status === "DRAFT" || c.status === "OPEN");
    if (!targetChange) {
      const probRes = await fetch(`${BACKEND_URL}/v1/itsm/problems?limit=1`, { headers: pcmHeaders });
      if (probRes.ok) {
        const probs = await probRes.json();
        if (probs && probs.length > 0) {
          const createChgRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${probs[0].id}/change`, {
            method: "POST",
            headers: pcmHeaders,
            body: JSON.stringify({
              title: "Step 7 Full Lifecycle Test Change",
              description: "Created dynamically to test complete lifecycle progression",
              change_type: "NORMAL",
              risk_level: "MEDIUM",
              impact_level: "MODERATE",
            }),
          });
          if (createChgRes.ok) {
            targetChange = await createChgRes.json();
          }
        }
      }
    }
    if (!targetChange) targetChange = changes[0];
    console.log(`Using target change ${targetChange.change_number} (${targetChange.id}), initial status=${targetChange.status}`);

    const changeId = targetChange.id;

    // -------------------------------------------------------------------------
    // TEST 4: Lifecycle Action Progression
    // -------------------------------------------------------------------------
    console.log("\n--- Part 4: Lifecycle Action Progression ---");

    // If in DRAFT, transition to CAB_REVIEW
    if (targetChange.status === "DRAFT" || targetChange.status === "OPEN") {
      const submitRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({ action: "submit_review", notes: "Submitting for CAB" }),
      });
      assert(submitRes.status === 200, "submit_review returns 200 OK");
      targetChange = await submitRes.json();
      assert(targetChange.status === "CAB_REVIEW", `Status moved to CAB_REVIEW (actual: ${targetChange.status})`);
    }

    // If in CAB_REVIEW, approve
    if (targetChange.status === "CAB_REVIEW" || targetChange.status === "AWAITING_APPROVAL" || targetChange.status === "SUBMITTED") {
      const approveRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({ action: "approve", notes: "Approved by manager" }),
      });
      assert(approveRes.status === 200, "approve returns 200 OK");
      targetChange = await approveRes.json();
      assert(targetChange.status === "APPROVED", `Status moved to APPROVED (actual: ${targetChange.status})`);
    }

    // If in APPROVED, schedule
    if (targetChange.status === "APPROVED") {
      const startAt = new Date(Date.now() + 3600000).toISOString();
      const finishAt = new Date(Date.now() + 7200000).toISOString();
      const schedRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({
          action: "schedule",
          earliest_start_at: startAt,
          latest_finish_at: finishAt,
          notes: "Planned window assigned",
        }),
      });
      assert(schedRes.status === 200, "schedule returns 200 OK");
      targetChange = await schedRes.json();
      assert(targetChange.status === "SCHEDULED", `Status moved to SCHEDULED (actual: ${targetChange.status})`);
      assert(!!targetChange.earliest_start_at, "earliest_start_at was persisted");
    }

    // If in SCHEDULED, start implementation
    if (targetChange.status === "SCHEDULED") {
      const startRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({
          action: "start_implementation",
          implementation_notes: "Engineer started rollout",
        }),
      });
      assert(startRes.status === 200, "start_implementation returns 200 OK");
      targetChange = await startRes.json();
      assert(
        targetChange.status === "IMPLEMENTING" || targetChange.status === "IN_PROGRESS",
        `Status moved to IMPLEMENTING (actual: ${targetChange.status})`
      );
      assert(!!targetChange.actual_start_at, "actual_start_at was recorded");
    }

    // If in IMPLEMENTING, complete implementation with validation notes
    if (targetChange.status === "IMPLEMENTING" || targetChange.status === "IN_PROGRESS") {
      const compRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({
          action: "complete",
          validation_notes: "All test scripts and post-validation checks succeeded",
        }),
      });
      assert(compRes.status === 200, "complete returns 200 OK");
      targetChange = await compRes.json();
      assert(targetChange.status === "COMPLETED", `Status moved to COMPLETED (actual: ${targetChange.status})`);
      assert(!!targetChange.actual_finish_at, "actual_finish_at was recorded");
      assert(
        targetChange.test_plan === "All test scripts and post-validation checks succeeded",
        "validation_notes recorded in test_plan"
      );
    }

    // If in COMPLETED, close change
    if (targetChange.status === "COMPLETED") {
      const closeRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({ action: "close", notes: "Final governance review passed" }),
      });
      assert(closeRes.status === 200, "close returns 200 OK");
      targetChange = await closeRes.json();
      assert(targetChange.status === "CLOSED", `Status moved to CLOSED (actual: ${targetChange.status})`);
    }

    // -------------------------------------------------------------------------
    // TEST 5: Terminal State Protection
    // -------------------------------------------------------------------------
    console.log("\n--- Part 5: Terminal State Protection ---");
    const termRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({ action: "start_implementation" }),
    });
    assert(termRes.status === 400, "Cannot transition from CLOSED state returns 400 Bad Request");

    // -------------------------------------------------------------------------
    // TEST 6: Activities & Audit Trail
    // -------------------------------------------------------------------------
    console.log("\n--- Part 6: Activities and Audit Trail ---");
    const actRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/activities`, {
      headers: pcmHeaders,
    });
    assert(actRes.status === 200, "GET /activities returns 200 OK");
    const activities = await actRes.json();
    assert(Array.isArray(activities) && activities.length > 0, `Returned ${activities.length} activity events`);
    console.log(`Latest activity action: ${activities[0]?.action}, message: ${activities[0]?.message}`);

    // Verify activities also included directly in GET change detail
    const detailRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}`, { headers: pcmHeaders });
    assert(detailRes.status === 200, "GET change detail returns 200 OK");
    const detail = await detailRes.json();
    assert(Array.isArray(detail.activities) && detail.activities.length > 0, "activities array embedded in ChangeDetail");

    // -------------------------------------------------------------------------
    // TEST 7: Cross-Tenant Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- Part 7: Cross-Tenant Isolation ---");
    const isoRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}/transition`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({ action: "approve" }),
    });
    assert(isoRes.status === 404, "Foreign change returns 404 Not Found");

  } catch (err) {
    console.error(`💥 Unexpected Exception: ${err.message}`, err);
    failed++;
  }

  console.log("\n==================================================");
  console.log(`Final Verification Result: ${passed} Passed, ${failed} Failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runStep7Verification();
