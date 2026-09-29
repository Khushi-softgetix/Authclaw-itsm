// Live End-to-End Verification script for Problem and Change Manager (Step 8: Problem <-> Change Connection)
// Verifies:
// 1. Unauthenticated protection (401 on link, unlink, create-change, get problem changes, get change problem)
// 2. Role authorization boundaries (403 Forbidden for unauthorized requester role)
// 3. Problem and Change Manager linking capabilities:
//    - GET /v1/itsm/problems/{problem_id}/changes
//    - POST /v1/itsm/problems/{problem_id}/create-change
//    - POST /v1/itsm/problems/{problem_id}/link-change
//    - POST /v1/itsm/problems/{problem_id}/unlink-change
//    - GET /v1/itsm/changes/{change_id}/problem
// 4. Bidirectional relation persistence and schema fields
// 5. Validation and idempotency (duplicate link, unlinking non-linked change)
// 6. Audit & Activity recording on both tickets
// 7. Cross-tenant isolation protection

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

async function runStep8Verification() {
  console.log("==================================================");
  console.log("Starting Problem and Change Manager (Step 8) Problem <-> Change Connection Verification");
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
    const unauthChanges = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/changes`);
    assert(unauthChanges.status === 401, "Unauthenticated GET /problems/{id}/changes returns 401");

    const unauthLink = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/link-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ change_id: fakeId }),
    });
    assert(unauthLink.status === 401, "Unauthenticated POST /problems/{id}/link-change returns 401");

    const unauthUnlink = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/unlink-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ change_id: fakeId }),
    });
    assert(unauthUnlink.status === 401, "Unauthenticated POST /problems/{id}/unlink-change returns 401");

    const unauthCreate = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/create-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Fix" }),
    });
    assert(unauthCreate.status === 401, "Unauthenticated POST /problems/{id}/create-change returns 401");

    const unauthProblem = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}/problem`);
    assert(unauthProblem.status === 401, "Unauthenticated GET /changes/{id}/problem returns 401");

    // -------------------------------------------------------------------------
    // TEST 2: Role Authorization Boundaries (Requester is Forbidden)
    // -------------------------------------------------------------------------
    console.log("\n--- Part 2: Role Authorization Boundaries ---");
    const reqLogin = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    const reqToken = reqLogin.session_token || reqLogin.token || reqLogin.access_token;
    const reqHeaders = {
      Authorization: `Bearer ${reqToken}`,
      "Content-Type": "application/json",
    };

    const reqLink = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/link-change`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ change_id: fakeId }),
    });
    assert(reqLink.status === 403, "Requester POST link-change returns 403 Forbidden");

    const reqCreate = await fetch(`${BACKEND_URL}/v1/itsm/problems/${fakeId}/create-change`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ title: "Fix" }),
    });
    assert(reqCreate.status === 403, "Requester POST create-change returns 403 Forbidden");

    // -------------------------------------------------------------------------
    // TEST 3: PCM Authentication & Problem Retrieval
    // -------------------------------------------------------------------------
    console.log("\n--- Part 3: PCM Setup & Existing Records ---");
    const pcmLogin = await login("processchange@authclaw-lite.demo", "AuthClawDemo!234");
    const pcmToken = pcmLogin.session_token || pcmLogin.token || pcmLogin.access_token;
    const pcmHeaders = {
      Authorization: `Bearer ${pcmToken}`,
      "Content-Type": "application/json",
    };

    // List problems
    const problemsRes = await fetch(`${BACKEND_URL}/v1/itsm/problems?limit=10`, {
      headers: pcmHeaders,
    });
    assert(problemsRes.ok, "PCM can list problem tickets");
    const problems = await problemsRes.json();
    assert(problems.length > 0, `At least 1 problem ticket exists (found ${problems.length})`);
    const targetProblem = problems[0];
    console.log(`Using target problem: ${targetProblem.ticket_number} (${targetProblem.id})`);

    // Fetch problem details
    const problemDetailRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${targetProblem.id}`, {
      headers: pcmHeaders,
    });
    assert(problemDetailRes.ok, "PCM can fetch problem details");
    const problemDetail = await problemDetailRes.json();
    assert(Array.isArray(problemDetail.related_changes), "problem.related_changes is present in response");

    // -------------------------------------------------------------------------
    // TEST 4: Create Change Request from Problem Ticket
    // -------------------------------------------------------------------------
    console.log("\n--- Part 4: Create Change Request from Problem Ticket ---");
    const createPayload = {
      title: `Permanent fix for ${targetProblem.ticket_number}: Automated failover`,
      description: `Resolves root cause documented in ${targetProblem.ticket_number}. Configures secondary failover cluster.`,
      change_type: "NORMAL",
      risk_level: "LOW",
      impact_level: "LOW",
      implementation_plan: "1. Deploy hotfix binary\n2. Rebalance traffic\n3. Verify health checks",
      backout_plan: "1. Drain traffic from updated nodes\n2. Revert binary to previous release",
      test_plan: "1. Run synthetic end-to-end tests\n2. Verify latency metrics",
    };

    const createRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${targetProblem.id}/create-change`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify(createPayload),
    });
    let createdChange = {};
    if (!createRes.ok) {
      const errText = await createRes.text();
      console.log(`Create change returned status ${createRes.status}: ${errText}`);
    } else {
      createdChange = await createRes.json();
    }
    assert(createRes.status === 201, "Create change from problem returns 201 Created");
    assert(Boolean(createdChange.id), "Created change has a valid ID");
    assert(createdChange.change_number.startsWith("CHG-"), `Created change number starts with CHG- (${createdChange.change_number})`);
    assert(createdChange.status === "DRAFT", "New change has initial status DRAFT");
    assert(createdChange.title === createPayload.title, "New change has expected title");
    assert(Boolean(createdChange.related_problem), "Created change includes related_problem");
    assert(createdChange.related_problem?.id === targetProblem.id, "Created change related_problem ID matches target problem");
    assert(createdChange.related_problem?.ticket_number === targetProblem.ticket_number, "related_problem ticket number matches target problem");

    // -------------------------------------------------------------------------
    // TEST 5: Verify Problem's Linked Changes List
    // -------------------------------------------------------------------------
    console.log("\n--- Part 5: Verify Problem's Linked Changes ---");
    const relatedChangesRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${targetProblem.id}/changes`, {
      headers: pcmHeaders,
    });
    assert(relatedChangesRes.ok, "GET /problems/{id}/changes returns 200 OK");
    const relatedChanges = await relatedChangesRes.json();
    assert(Array.isArray(relatedChanges), "Linked changes is an array");
    const foundCreated = relatedChanges.some((c) => c.id === createdChange.id);
    assert(foundCreated, "Created change appears in GET /problems/{id}/changes");

    // -------------------------------------------------------------------------
    // TEST 6: Reverse Lookup: GET /v1/itsm/changes/{change_id}/problem
    // -------------------------------------------------------------------------
    console.log("\n--- Part 6: Reverse Lookup from Change to Problem ---");
    const changeProblemRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${createdChange.id}/problem`, {
      headers: pcmHeaders,
    });
    assert(changeProblemRes.ok, "GET /changes/{id}/problem returns 200 OK");
    const changeProblem = await changeProblemRes.json();
    assert(changeProblem.id === targetProblem.id, "Reverse lookup problem ID matches target problem");
    assert(changeProblem.ticket_number === targetProblem.ticket_number, "Reverse lookup ticket number matches");

    // -------------------------------------------------------------------------
    // TEST 7: Link an Existing Standalone Change to Problem
    // -------------------------------------------------------------------------
    console.log("\n--- Part 7: Link Existing Standalone Change to Problem ---");
    // List existing changes
    const changesListRes = await fetch(`${BACKEND_URL}/v1/itsm/changes?limit=20`, {
      headers: pcmHeaders,
    });
    assert(changesListRes.ok, "PCM can list changes");
    const allChanges = await changesListRes.json();
    // Pick another change not already linked
    const existingChange = allChanges.find((c) => !relatedChanges.some((rc) => rc.id === c.id) && c.id !== createdChange.id);
    assert(Boolean(existingChange), "Found an existing standalone change to link");

    if (existingChange) {
      const linkRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${targetProblem.id}/link-change`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({ change_id: existingChange.id }),
      });
      assert(linkRes.ok, `Link existing change returns 200 OK (${linkRes.status})`);
      const updatedList = await linkRes.json();
      assert(updatedList.some((c) => c.id === existingChange.id), "Linked change now appears in problem's related changes");

      // Verify duplicate link returns 400 Bad Request
      const dupLinkRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${targetProblem.id}/link-change`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({ change_id: existingChange.id }),
      });
      assert(dupLinkRes.status === 400, "Duplicate link returns 400 Bad Request");

      // -------------------------------------------------------------------------
      // TEST 8: Unlink Change from Problem (Reversibility)
      // -------------------------------------------------------------------------
      console.log("\n--- Part 8: Unlink Change from Problem ---");
      const unlinkRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${targetProblem.id}/unlink-change`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({ change_id: existingChange.id }),
      });
      assert(unlinkRes.ok, `Unlink change returns 200 OK (${unlinkRes.status})`);
      const afterUnlinkList = await unlinkRes.json();
      assert(!afterUnlinkList.some((c) => c.id === existingChange.id), "Unlinked change no longer appears in problem's related changes");

      // Verify unlinking a non-linked change returns 400 Bad Request
      const nonLinkedUnlink = await fetch(`${BACKEND_URL}/v1/itsm/problems/${targetProblem.id}/unlink-change`, {
        method: "POST",
        headers: pcmHeaders,
        body: JSON.stringify({ change_id: existingChange.id }),
      });
      assert(nonLinkedUnlink.status === 400, "Unlinking non-linked change returns 400 Bad Request");
    }

    // -------------------------------------------------------------------------
    // TEST 9: Activity & Audit Trail Verification
    // -------------------------------------------------------------------------
    console.log("\n--- Part 9: Activity & Audit Trail Verification ---");
    // Verify problem activities
    const problemActivitiesRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${targetProblem.id}/activities`, {
      headers: pcmHeaders,
    });
    assert(problemActivitiesRes.ok, "GET /problems/{id}/activities returns 200 OK");
    const problemActivities = await problemActivitiesRes.json();
    const hasChangeLinkedActivity = problemActivities.some((a) => a.activity_type === "CHANGE_LINKED");
    assert(hasChangeLinkedActivity, "Problem activities contain CHANGE_LINKED event");

    // Verify change activities
    const changeActivitiesRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${createdChange.id}/activities`, {
      headers: pcmHeaders,
    });
    assert(changeActivitiesRes.ok, "GET /changes/{id}/activities returns 200 OK");
    const changeActivities = await changeActivitiesRes.json();
    assert(changeActivities.length > 0, `Change activities returned (count: ${changeActivities.length})`);
    console.log("Change activities recorded:", changeActivities.map((a) => a.action).join(", "));

    // -------------------------------------------------------------------------
    // TEST 10: Cross-Tenant Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- Part 10: Cross-Tenant Isolation ---");
    const foreignLink = await fetch(`${BACKEND_URL}/v1/itsm/problems/${targetProblem.id}/link-change`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({ change_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" }),
    });
    assert(foreignLink.status === 404, "Linking nonexistent or foreign change returns 404 Not Found");

    console.log("\n==================================================");
    console.log(`Step 8 Verification Complete: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Verification crashed:", err);
    process.exit(1);
  }
}

runStep8Verification();
