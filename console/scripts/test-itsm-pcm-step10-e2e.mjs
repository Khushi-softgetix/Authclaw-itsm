// Step 10: Complete End-to-End Verification of Problem and Change Manager Workflow
// Problem Investigation & Resolution -> Problem-Change Connection -> Change Assessment & Lifecycle -> Knowledge Governance

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

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

async function runStep10Verification() {
  console.log("==================================================");
  console.log("Starting Problem and Change Manager Step 10 Full E2E Verification");
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
    const pcmAuth = await login("processchange@authclaw-lite.demo", "AuthClawDemo!234");
    const pcmToken = pcmAuth.session_token || pcmAuth.token || pcmAuth.access_token;
    const pcmHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pcmToken}`,
    };

    // ----------------------------------------------------
    // PART 1: PROBLEM INVESTIGATION & RESOLUTION
    // ----------------------------------------------------
    console.log("\n--- Flow 1: Problem Investigation & Resolution ---");
    const problemsRes = await fetch(`${BACKEND_URL}/v1/itsm/problems`, { headers: pcmHeaders });
    assert(problemsRes.ok, "PCM can fetch problems queue");
    const problemsData = await problemsRes.json();
    const problemList = problemsData.items || problemsData;
    assert(Array.isArray(problemList) && problemList.length > 0, "Problem queue has records");

    const targetProblem = problemList[0];
    const problemId = targetProblem.id;
    console.log(`Using target problem: ${targetProblem.ticket_number} (${problemId})`);

    // Update Investigation
    const investRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/investigation`, {
      method: "PATCH",
      headers: pcmHeaders,
      body: JSON.stringify({
        root_cause_summary: "High memory fragmentation under sustained concurrent write workloads",
        workaround_summary: "Periodic restart of connection pooler every 12 hours",
        known_error: true,
      }),
    });
    assert(investRes.ok, `Problem investigation updated (status ${investRes.status})`);
    const investData = await investRes.json();
    assert(investData.problem_details?.root_cause_summary?.includes("memory fragmentation"), "Root cause persisted in problem");
    assert(investData.problem_details?.known_error === true, "Known error flag updated");

    // ----------------------------------------------------
    // PART 2: PROBLEM -> RELATED CHANGE
    // ----------------------------------------------------
    console.log("\n--- Flow 2: Problem -> Related Change Connection ---");
    const createChgRes = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/create-change`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({
        title: "Patch Connection Pooler Memory Reclamation Mechanism",
        description: "Apply hotfix to reduce allocator fragmentation on Linux kernels",
        change_type: "NORMAL",
        risk_level: "MEDIUM",
        impact_level: "MEDIUM",
      }),
    });
    assert(createChgRes.status === 201, `Create change from problem returned 201 (status ${createChgRes.status})`);
    const createdChange = await createChgRes.json();
    const changeId = createdChange.id;
    console.log(`Created Change Request: ${createdChange.change_number} (${changeId})`);
    assert(createdChange.related_problem?.id === problemId, "Change bidirectionally linked to Problem");

    // ----------------------------------------------------
    // PART 3: CHANGE ASSESSMENT
    // ----------------------------------------------------
    console.log("\n--- Flow 3: Change Assessment ---");
    const assessRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/assessment`, {
      method: "PATCH",
      headers: pcmHeaders,
      body: JSON.stringify({
        risk_level: "LOW",
        impact_level: "LOW",
        implementation_plan: "1. Pull patched binaries\n2. Perform rolling reload across nodes",
        backout_plan: "Revert to v2.4.1 binary and restart service",
        test_plan: "Run memory leak test under synthetic 5000 req/sec load",
      }),
    });
    assert(assessRes.ok, `Change assessment updated (status ${assessRes.status})`);
    const assessedChange = await assessRes.json();
    assert(assessedChange.risk_level === "LOW", "Change risk level updated");
    assert(assessedChange.implementation_plan?.includes("rolling reload"), "Implementation plan updated");

    // ----------------------------------------------------
    // PART 4: CHANGE LIFECYCLE PROGRESSION
    // ----------------------------------------------------
    console.log("\n--- Flow 4: Change Lifecycle Progression ---");
    // 4a. Submit review
    const submitRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({ action: "submit_review", notes: "Ready for CAB review" }),
    });
    assert(submitRes.ok, "Transitioned to CAB_REVIEW");
    const submitData = await submitRes.json();
    assert(submitData.status === "CAB_REVIEW", `Status is CAB_REVIEW (got ${submitData.status})`);

    // 4b. Approve
    const approveRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({ action: "approve", notes: "Approved by CAB" }),
    });
    assert(approveRes.ok, "Transitioned to APPROVED");
    const approveData = await approveRes.json();
    assert(approveData.status === "APPROVED", `Status is APPROVED (got ${approveData.status})`);

    // 4c. Schedule
    const now = new Date();
    const future = new Date(now.getTime() + 7200000);
    const schedRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({
        action: "schedule",
        earliest_start_at: now.toISOString(),
        latest_finish_at: future.toISOString(),
        notes: "Scheduled maintenance window",
      }),
    });
    assert(schedRes.ok, "Transitioned to SCHEDULED");
    const schedData = await schedRes.json();
    assert(schedData.status === "SCHEDULED", `Status is SCHEDULED (got ${schedData.status})`);
    assert(schedData.earliest_start_at !== null, "Earliest start window persisted");

    // 4d. Start implementation
    const startRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({ action: "start_implementation", notes: "Applying patch" }),
    });
    assert(startRes.ok, "Transitioned to IMPLEMENTING");
    const startData = await startRes.json();
    assert(startData.status === "IMPLEMENTING", `Status is IMPLEMENTING (got ${startData.status})`);
    assert(startData.actual_start_at !== null, "Actual start timestamp recorded");

    // 4e. Complete & Validate
    const completeRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({
        action: "complete",
        validation_notes: "Memory stable at 42MB. Leak verification passed.",
        notes: "Patch deployed successfully",
      }),
    });
    assert(completeRes.ok, "Transitioned to COMPLETED");
    const completeData = await completeRes.json();
    assert(completeData.status === "COMPLETED", `Status is COMPLETED (got ${completeData.status})`);
    assert(completeData.actual_finish_at !== null, "Actual finish timestamp recorded");
    assert(completeData.test_plan?.includes("Leak verification passed"), "Validation notes saved in test plan");

    // 4f. Close Change
    const closeRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({ action: "close", notes: "Change lifecycle closed cleanly" }),
    });
    assert(closeRes.ok, "Transitioned to CLOSED");
    const closeData = await closeRes.json();
    assert(closeData.status === "CLOSED", `Status is CLOSED (got ${closeData.status})`);

    // Verify terminal protection
    const illegalRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({ action: "start_implementation" }),
    });
    assert(illegalRes.status === 400, "Terminal CLOSED state blocks further transitions (400)");

    // ----------------------------------------------------
    // PART 5: KNOWLEDGE GOVERNANCE & VERSIONING
    // ----------------------------------------------------
    console.log("\n--- Flow 5: Knowledge Governance Lifecycle ---");
    // 5a. Create Draft Article
    const createKbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge`, {
      method: "POST",
      headers: pcmHeaders,
      body: JSON.stringify({
        title: "Memory Fragmentation Mitigation Runbook",
        category: "TROUBLESHOOTING",
        summary: "Step-by-step resolution for high memory fragmentation in connection pooler",
        content_markdown: "# Memory Mitigation\n\n## Details\nApply binary patch v2.4.2.",
        keywords: ["memory", "fragmentation", "pooler"],
      }),
    });
    assert(createKbRes.status === 201, `Create Knowledge Article returned 201 (status ${createKbRes.status})`);
    const createdKb = await createKbRes.json();
    const articleId = createdKb.id;
    assert(createdKb.status === "DRAFT", "Initial knowledge status is DRAFT");
    assert(createdKb.version_number === 1, "Initial version is 1");

    // 5b. Update Article (Version 2)
    const updateKbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/${articleId}`, {
      method: "PATCH",
      headers: pcmHeaders,
      body: JSON.stringify({
        title: "Memory Fragmentation Mitigation Runbook (Revised)",
        change_summary: "Added kernel sysctl parameter tuning section",
        content_markdown: "# Memory Mitigation (v2)\n\n## Details\nApply binary patch v2.4.2.\n\n## Kernel tuning\nSet vm.dirty_ratio=10.",
      }),
    });
    assert(updateKbRes.ok, `Article updated to Version 2 (status ${updateKbRes.status})`);
    const updatedKb = await updateKbRes.json();
    assert(updatedKb.version_number === 2, `Version number updated to 2 (got ${updatedKb.version_number})`);
    assert(updatedKb.versions?.length === 2, `Version history has 2 revisions (got ${updatedKb.versions?.length})`);

    // 5c. Publish Article
    const pubKbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/${articleId}/publish`, {
      method: "POST",
      headers: pcmHeaders,
    });
    assert(pubKbRes.ok, `Article published (status ${pubKbRes.status})`);
    const pubData = await pubKbRes.json();
    assert(pubData.status === "PUBLISHED", `Article status is PUBLISHED (got ${pubData.status})`);
    assert(pubData.current_published_version === 2, "current_published_version set to 2");

    // 5d. Archive Article
    const archKbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/${articleId}/archive`, {
      method: "POST",
      headers: pcmHeaders,
    });
    assert(archKbRes.ok, `Article archived (status ${archKbRes.status})`);
    const archData = await archKbRes.json();
    assert(archData.status === "ARCHIVED", `Article status is ARCHIVED (got ${archData.status})`);

    // 5e. Return to Draft
    const draftKbRes = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/${articleId}/draft`, {
      method: "POST",
      headers: pcmHeaders,
    });
    assert(draftKbRes.ok, `Article returned to DRAFT (status ${draftKbRes.status})`);
    const draftData = await draftKbRes.json();
    assert(draftData.status === "DRAFT", `Article status is DRAFT (got ${draftData.status})`);

    // ----------------------------------------------------
    // PART 6: SECURITY & AUTHORIZATION BOUNDARIES
    // ----------------------------------------------------
    console.log("\n--- Flow 6: Security & Authorization Boundaries ---");
    const reqAuth = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    const reqToken = reqAuth.session_token || reqAuth.token || reqAuth.access_token;
    const reqHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${reqToken}`,
    };

    // Unauthorized transition
    const unauthTrans = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/transition`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ action: "close" }),
    });
    assert(unauthTrans.status === 403, `Requester transition rejected with 403 (got ${unauthTrans.status})`);

    // Unauthorized publish
    const unauthPub = await fetch(`${BACKEND_URL}/v1/itsm/knowledge/${articleId}/publish`, {
      method: "POST",
      headers: reqHeaders,
    });
    assert(unauthPub.status === 403, `Requester publish rejected with 403 (got ${unauthPub.status})`);

    // Unauthorized problem investigation
    const unauthInvest = await fetch(`${BACKEND_URL}/v1/itsm/problems/${problemId}/investigation`, {
      method: "PATCH",
      headers: reqHeaders,
      body: JSON.stringify({ root_cause_summary: "Malicious edit attempt" }),
    });
    assert(unauthInvest.status === 403, `Requester investigation edit rejected with 403 (got ${unauthInvest.status})`);

  } catch (err) {
    console.error("💥 Unhandled Error:", err);
    failed++;
  }

  console.log("\n==================================================");
  console.log(`Step 10 E2E Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runStep10Verification();
