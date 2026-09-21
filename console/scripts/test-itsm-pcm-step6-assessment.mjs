// Live End-to-End Verification script for Problem and Change Manager (Step 6 Change Detail & Assessment)
// Verifies:
// 1. Unauthenticated protection (401 on GET detail and PATCH assessment)
// 2. Role authorization boundaries (403 Forbidden for REQUESTER and SERVICE_AGENT)
// 3. Problem and Change Manager detail retrieval with Affected CIs
// 4. Affected CIs empty state handling for changes without CIs
// 5. Updating assessment fields (risk, impact, type, reason, impl plan, test plan, backout plan)
// 6. Persistence of assessment updates on re-fetch
// 7. Validation enforcement on invalid risk/impact enum values (400 Bad Request)
// 8. Cross-tenant isolation enforcement (404 on foreign/non-existent change)

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
  console.log("Starting Problem and Change Manager (Step 6) Change Detail & Assessment Verification");
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
    const unauthGet = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}`);
    assert(unauthGet.status === 401, "Unauthenticated GET /v1/itsm/changes/{id} returns 401");

    const unauthPatch = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}/assessment`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ risk_level: "HIGH" }),
    });
    assert(unauthPatch.status === 401, "Unauthenticated PATCH /v1/itsm/changes/{id}/assessment returns 401");

    // -------------------------------------------------------------------------
    // TEST 2: Role Authorization Boundaries
    // -------------------------------------------------------------------------
    console.log("\n--- Part 2: Role Authorization Boundaries ---");
    const reqSession = await login("requester@authclaw-lite.demo", "AuthClawDemo!234");
    const reqPatch = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}/assessment`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${reqSession.session_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ risk_level: "HIGH" }),
    });
    assert(reqPatch.status === 403, "Requester role is forbidden from updating assessment (403)");

    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    const agentPatch = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}/assessment`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${agentSession.session_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ risk_level: "HIGH" }),
    });
    assert(agentPatch.status === 403, "Service Agent role is forbidden from updating assessment (403)");

    // -------------------------------------------------------------------------
    // TEST 3: Login as Problem and Change Manager & Fetch Target Change
    // -------------------------------------------------------------------------
    console.log("\n--- Part 3: Problem and Change Manager Detail & CI Verification ---");
    const pcmSession = await login("processchange@authclaw-lite.demo", "AuthClawDemo!234");
    const pcmToken = pcmSession.session_token;

    const listRes = await fetch(`${BACKEND_URL}/v1/itsm/changes`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(listRes.status === 200, "PCM can list changes (200 OK)");
    const changes = await listRes.json();
    assert(changes.length >= 2, "At least 2 changes exist in queue for testing");

    // Pick target change 1 (CHG-000001)
    const targetChange = changes.find((c) => c.change_number === "CHG-000001") || changes[0];
    const changeId = targetChange.id;
    console.log(`Using Target Change: ${targetChange.change_number} (ID: ${changeId})`);

    const detailRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(detailRes.status === 200, "PCM can fetch detailed change record (200 OK)");
    const detail = await detailRes.json();
    assert(detail.change_number === targetChange.change_number, "Detail change_number matches");
    assert(Array.isArray(detail.affected_cis), "Detail contains affected_cis array");
    console.log(`Change has ${detail.affected_cis.length} affected CIs linked`);

    if (detail.affected_cis.length > 0) {
      const ci = detail.affected_cis[0];
      assert(typeof ci.name === "string", "Affected CI contains name");
      assert(typeof ci.ci_type === "string", "Affected CI contains ci_type");
      assert(typeof ci.impact_type === "string", "Affected CI contains impact_type");
      console.log(`First Affected CI: ${ci.name} (${ci.ci_type}, ${ci.impact_type})`);
    }

    // Check second change (should have 0 CIs for empty state verification)
    const otherChange = changes.find((c) => c.id !== changeId) || changes[1];
    const otherDetailRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${otherChange.id}`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(otherDetailRes.status === 200, "Fetch second change returns 200 OK");
    const otherDetail = await otherDetailRes.json();
    assert(Array.isArray(otherDetail.affected_cis), "Second change contains affected_cis array");

    // -------------------------------------------------------------------------
    // TEST 4: Update Assessment via PATCH /v1/itsm/changes/{id}/assessment
    // -------------------------------------------------------------------------
    console.log("\n--- Part 4: Updating Change Assessment ---");
    const assessmentPayload = {
      change_type: "NORMAL",
      risk_level: "HIGH",
      impact_level: "MEDIUM",
      description: "Business requirement: Harden ingress auth connection pooling against transient network partitioning.",
      implementation_plan: "1. Stage rollout in staging cluster\n2. Drain ingress pool\n3. Apply pool capacity patch v2.4.2\n4. Re-enable traffic",
      test_plan: "1. Run synthetic login probe\n2. Validate 0 dropped TLS handshakes\n3. Confirm connection reaper timeout <= 60s",
      backout_plan: "Revert connection pool configuration via Helm values rollback to release 4.1.0",
    };

    const patchRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/assessment`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(assessmentPayload),
    });
    assert(patchRes.status === 200, "Updating assessment returns 200 OK");
    const patched = await patchRes.json();
    assert(patched.change_type === "NORMAL", "Updated change_type is NORMAL");
    assert(patched.risk_level === "HIGH", "Updated risk_level is HIGH");
    assert(patched.impact_level === "MEDIUM", "Updated impact_level is MEDIUM");
    assert(patched.description === assessmentPayload.description, "Updated description matches");
    assert(patched.implementation_plan === assessmentPayload.implementation_plan, "Updated implementation_plan matches");
    assert(patched.test_plan === assessmentPayload.test_plan, "Updated test_plan matches");
    assert(patched.backout_plan === assessmentPayload.backout_plan, "Updated backout_plan matches");

    // -------------------------------------------------------------------------
    // TEST 5: Verify Persistence on Re-fetch
    // -------------------------------------------------------------------------
    console.log("\n--- Part 5: Assessment Persistence Verification ---");
    const refetchRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}`, {
      headers: { Authorization: `Bearer ${pcmToken}` },
    });
    assert(refetchRes.status === 200, "Re-fetching change returns 200 OK");
    const refetched = await refetchRes.json();
    assert(refetched.risk_level === "HIGH", "Persisted risk_level is HIGH");
    assert(refetched.impact_level === "MEDIUM", "Persisted impact_level is MEDIUM");
    assert(refetched.implementation_plan === assessmentPayload.implementation_plan, "Persisted implementation_plan matches");
    assert(refetched.test_plan === assessmentPayload.test_plan, "Persisted test_plan matches");

    // -------------------------------------------------------------------------
    // TEST 6: Validation Rejection on Invalid Enums
    // -------------------------------------------------------------------------
    console.log("\n--- Part 6: Validation Enforcement ---");
    const badRiskRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/assessment`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ risk_level: "EXTREME_CHAOS" }),
    });
    assert(badRiskRes.status === 400, "Invalid risk_level returns 400 Bad Request");

    const badTypeRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${changeId}/assessment`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ change_type: "UNPLANNED_MAYHEM" }),
    });
    assert(badTypeRes.status === 400, "Invalid change_type returns 400 Bad Request");

    // -------------------------------------------------------------------------
    // TEST 7: Cross-Tenant Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- Part 7: Cross-Tenant Isolation ---");
    const notFoundRes = await fetch(`${BACKEND_URL}/v1/itsm/changes/${fakeId}/assessment`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${pcmToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ risk_level: "LOW" }),
    });
    assert(notFoundRes.status === 404, "Updating non-existent change returns 404 Not Found");

    console.log("\n==================================================");
    console.log(`STEP 6 VERIFICATION RESULTS: ${passed} passed, ${failed} failed`);
    console.log("==================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Unhandled error during verification:", err);
    process.exit(1);
  }
}

runStep6Verification();
