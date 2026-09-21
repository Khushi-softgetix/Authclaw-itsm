// Live End-to-End Verification script for Problem and Change Manager (Step 4 Problem Resolution & Closure)
// Verifies:
// 1. Unauthenticated protection (401 on /resolve and /close)
// 2. Role authorization enforcement (403 Forbidden for REQUESTER and SERVICE_AGENT)
// 3. Premature closure rejection (400 Bad Request when closing an unresolved problem)
// 4. Problem Resolution via POST /v1/itsm/problems/{id}/resolve (200 OK, status=RESOLVED, resolved_at set)
// 5. Resolution activity logged in timeline (activity_type=RESOLUTION)
// 6. Problem Closure via POST /v1/itsm/problems/{id}/close (200 OK, status=CLOSED, closed_at and closed_by set)
// 7. Closure activity logged in timeline (activity_type=STATUS_CHANGE)
// 8. Lifecycle finality enforcement (re-resolve or re-close on CLOSED returns 400 Bad Request)
// 9. Related Incidents preservation (related incidents intact)

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

async function runResolutionVerification() {
  console.log("==================================================");
  console.log("Starting Problem and Change Manager (Step 4) Resolution & Closure Verification");
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
    const unauthResolve = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution_summary: "Test resolve" }),
    });
    assert(unauthResolve.status === 401, "Unauthenticated POST /resolve returns 401");

    const unauthClose = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closure_notes: "Test close" }),
    });
    assert(unauthClose.status === 401, "Unauthenticated POST /close returns 401");

    // -------------------------------------------------------------------------
    // TEST 2: Role Authorization Boundaries
    // -------------------------------------------------------------------------
    console.log("\n--- Part 2: Role Authorization Boundaries ---");
    const reqSession = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    const reqRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/resolve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reqSession.session_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resolution_summary: "Unauthorized resolution" }),
    });
    assert(reqRes.status === 403, "Requester role is forbidden from resolving problems (403)");

    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    const agentRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/close`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${agentSession.session_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ closure_notes: "Unauthorized closure" }),
    });
    assert(agentRes.status === 403, "Service Agent role is forbidden from closing problems (403)");

    // -------------------------------------------------------------------------
    // TEST 3: Login as Problem and Change Manager & Fetch Target Problem
    // -------------------------------------------------------------------------
    console.log("\n--- Part 3: Problem and Change Manager Lifecycle Testing ---");
    const pcmSession = await login("processchange@authclaw-lite.demo", "AuthClawDemo!234");
    const pcmToken = pcmSession.session_token;

    const listRes = await fetch(`${BACKEND_URL}/v1/itsm/problems`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(listRes.status === 200, "PCM can list problems queue (200 OK)");
    const problems = await listRes.json();
    assert(problems.length > 0, "At least one problem exists for testing");

    // Pick first problem (e.g. PRB-000001)
    const targetProblem = problems[0];
    const problemId = targetProblem.id;
    console.log(`Using Target Problem: ${targetProblem.ticket_number} (ID: ${problemId}), Current Status: ${targetProblem.status}`);

    // Ensure it's in IN_PROGRESS or OPEN first to test lifecycle transitions
    if (targetProblem.status === "CLOSED") {
      console.log("Problem was closed from previous runs; resetting status to IN_PROGRESS for test suite...");
      // Patch investigation status
      await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/investigation`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${pcmToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
    }

    // If currently IN_PROGRESS or OPEN, test premature close prevention
    const currentDetailRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    const currentDetail = await currentDetailRes.json();

    if (currentDetail.status !== "RESOLVED") {
      console.log("\n--- Part 4: Premature Closure Prevention ---");
      const prematureCloseRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/close`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pcmToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ closure_notes: "Attempting premature closure" }),
      });
      assert(prematureCloseRes.status === 400, "Attempting to close an unresolved problem fails with 400 Bad Request");
      const errDetail = await prematureCloseRes.json();
      assert(errDetail.detail.includes("must be RESOLVED before closing"), "Error specifies problem must be RESOLVED before closing");
    }

    // -------------------------------------------------------------------------
    // TEST 5: Resolve Problem
    // -------------------------------------------------------------------------
    console.log("\n--- Part 5: Resolving the Problem ---");
    const testResolutionSummary = "Root cause eliminated by reconfiguring connection pool reaper timeouts to 60s and rolling out v2.4.1 hotfix.";
    const testPermFix = "Deploy patch v2.4.1 with automated idle connection cleanup and heartbeat probes.";
    const testWorkaround = "Nightly container reboot script retired following hotfix.";
    const testRootCauseConfirm = "Idle TCP sessions holding open pool slots indefinitely without TCP keepalive.";
    const testNotes = "Validated across 3 clusters for 48 hours with 0 connection leaks observed. All metrics normal.";

    const resolveRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/resolve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resolution_summary: testResolutionSummary,
        resolution_notes: testNotes,
        permanent_solution: testPermFix,
        workaround_summary: testWorkaround,
        root_cause_summary: testRootCauseConfirm,
      }),
    });
    assert(resolveRes.status === 200, "POST /resolve returns 200 OK");
    const resolvedData = await resolveRes.json();

    assert(resolvedData.status === "RESOLVED", "Problem status transitioned to RESOLVED");
    assert(resolvedData.resolution_summary === testResolutionSummary, "Resolution summary persisted on ticket");
    assert(resolvedData.resolved_at !== null, "resolved_at timestamp is set");
    assert(resolvedData.problem_details.permanent_solution === testPermFix, "Permanent fix updated on problem details");
    assert(resolvedData.problem_details.workaround_summary === testWorkaround, "Workaround updated on problem details");
    assert(resolvedData.problem_details.root_cause_summary === testRootCauseConfirm, "Root cause confirmed on problem details");

    // -------------------------------------------------------------------------
    // TEST 6: Verify Activity Timeline for RESOLUTION
    // -------------------------------------------------------------------------
    console.log("\n--- Part 6: Timeline Activity for Resolution ---");
    const actRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/activities`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(actRes.status === 200, "GET activities returns 200 OK");
    const activities = await actRes.json();
    const resolutionAct = activities.find((a) => a.activity_type === "RESOLUTION");
    assert(resolutionAct !== undefined, "Activity timeline contains an entry with activity_type=RESOLUTION");
    assert(resolutionAct.content.includes(testResolutionSummary), "Resolution activity content contains resolution summary");
    assert(resolutionAct.content.includes(testNotes), "Resolution activity content contains resolution notes");

    // -------------------------------------------------------------------------
    // TEST 7: Close Problem
    // -------------------------------------------------------------------------
    console.log("\n--- Part 7: Closing the Problem ---");
    const testClosureNotes = "Permanent fix verified in production. Post-incident review sign-off completed by Engineering and Service Operations.";

    const closeRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/close`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ closure_notes: testClosureNotes }),
    });
    assert(closeRes.status === 200, "POST /close returns 200 OK");
    const closedData = await closeRes.json();

    assert(closedData.status === "CLOSED", "Problem status transitioned to CLOSED");
    assert(closedData.closed_at !== null, "closed_at timestamp is populated");
    assert(closedData.closed_by_email !== null, "closed_by_email is populated with actor email");

    // -------------------------------------------------------------------------
    // TEST 8: Timeline Activity for Closure
    // -------------------------------------------------------------------------
    console.log("\n--- Part 8: Timeline Activity for Closure ---");
    const actResAfterClose = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/activities`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    const activitiesAfterClose = await actResAfterClose.json();
    const closeAct = activitiesAfterClose.find(
      (a) => a.activity_type === "STATUS_CHANGE" && (a.content || "").toLowerCase().includes("closed")
    );
    assert(closeAct !== undefined, "Activity timeline contains STATUS_CHANGE event for closure");
    assert(closeAct.content.includes(testClosureNotes), "Closure activity contains closure notes");

    // -------------------------------------------------------------------------
    // TEST 9: Lifecycle Finality Checks
    // -------------------------------------------------------------------------
    console.log("\n--- Part 9: Lifecycle Finality Enforcements ---");
    // Attempting to resolve a CLOSED problem
    const reResolveRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/resolve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resolution_summary: "Re-resolve attempt" }),
    });
    assert(reResolveRes.status === 400, "Attempting to resolve a CLOSED problem fails with 400 Bad Request");
    const reResolveErr = await reResolveRes.json();
    assert(reResolveErr.detail.includes("Cannot resolve a CLOSED problem"), "Error details inform that problem is CLOSED");

    // Attempting to close an already CLOSED problem
    const reCloseRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/close`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ closure_notes: "Re-close attempt" }),
    });
    assert(reCloseRes.status === 400, "Attempting to re-close an already CLOSED problem fails with 400 Bad Request");
    const reCloseErr = await reCloseRes.json();
    assert(reCloseErr.detail.includes("already CLOSED"), "Error details inform that problem is already CLOSED");

    // -------------------------------------------------------------------------
    // TEST 10: Related Incidents Preservation
    // -------------------------------------------------------------------------
    console.log("\n--- Part 10: Related Incidents Preservation ---");
    const finalDetailRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    const finalDetail = await finalDetailRes.json();
    assert(finalDetail.related_incidents !== undefined, "Related incidents list is preserved");
    console.log(`Related incidents preserved: ${finalDetail.related_incidents.length} linked incidents`);

  } catch (err) {
    console.error("❌ Unexpected test exception:", err);
    failed++;
  }

  console.log("\n==================================================");
  console.log(`Step 4 Verification Complete: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runResolutionVerification();
