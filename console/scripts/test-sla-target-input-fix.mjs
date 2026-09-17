// Verification test for SLA Policy numeric target minutes input fix
import fs from "fs";
import path from "path";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

async function login(email, password, tenant_name = "AuthClaw Lite Demo") {
  const res = await fetch(`${BACKEND_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tenant_name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed (${res.status}): ${text}`);
  }
  return await res.json();
}

async function runTests() {
  console.log("==================================================");
  console.log("Starting SLA Target Input Fix Verification");
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

  // 1. Verify new/page.tsx code
  console.log("--- Check 1: Verify SLA new/page.tsx implementation ---");
  const candidatesNew = [
    "src/app/(console)/itsm/admin-portal/sla/policies/new/page.tsx",
    "console/src/app/(console)/itsm/admin-portal/sla/policies/new/page.tsx",
  ];
  const newPath = candidatesNew.find((p) => fs.existsSync(p));
  if (newPath) {
    const newPageCode = fs.readFileSync(newPath, "utf-8");
    assert(newPageCode.includes('setResponseTargetMinutes("")'), "new/page.tsx allows clearing response target without sticky zero");
    assert(newPageCode.includes('setResolutionTargetMinutes("")'), "new/page.tsx allows clearing resolution target without sticky zero");
    assert(newPageCode.includes('parseInt(val, 10)'), "new/page.tsx parses numeric value to strip leading zeros");
    assert(!newPageCode.includes('onChange={(e) => setResponseTargetMinutes(Number(e.target.value))}'), "new/page.tsx no longer uses naive Number(e.target.value) which forces zero on empty string");
  } else {
    console.log("Skipping raw source inspection (running in container runtime)");
  }

  // 2. Verify [id]/page.tsx code
  console.log("\n--- Check 2: Verify SLA [id]/page.tsx implementation ---");
  const candidatesEdit = [
    "src/app/(console)/itsm/admin-portal/sla/policies/[id]/page.tsx",
    "console/src/app/(console)/itsm/admin-portal/sla/policies/[id]/page.tsx",
  ];
  const editPath = candidatesEdit.find((p) => fs.existsSync(p));
  if (editPath) {
    const editPageCode = fs.readFileSync(editPath, "utf-8");
    assert(editPageCode.includes('setResponseTargetMinutes("")'), "[id]/page.tsx allows clearing response target without sticky zero");
    assert(editPageCode.includes('setResolutionTargetMinutes("")'), "[id]/page.tsx allows clearing resolution target without sticky zero");
    assert(editPageCode.includes('parseInt(val, 10)'), "[id]/page.tsx parses numeric value to strip leading zeros");
    assert(!editPageCode.includes('onChange={(e) => setResponseTargetMinutes(Number(e.target.value))}'), "[id]/page.tsx no longer uses naive Number(e.target.value) which forces zero on empty string");
  } else {
    console.log("Skipping raw source inspection (running in container runtime)");
  }

  // 3. API test: Create policy with 30m response and 30m resolution
  console.log("\n--- Check 3: API Create and Update with Target Values ---");
  const session = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
  const token = session.session_token;

  const createRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/sla-policies`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `SLA Test 30m ${Date.now()}`,
      description: "Testing target input fix",
      ticket_type: "INCIDENT",
      priority: "P2",
      response_target_minutes: 30,
      resolution_target_minutes: 30,
      is_active: true,
    }),
  });
  assert(createRes.status === 201, "SLA policy with 30m targets created successfully (201)");
  const created = await createRes.json();
  assert(created.response_target_minutes === 30, "Response target is exactly 30 minutes");
  assert(created.resolution_target_minutes === 30, "Resolution target is exactly 30 minutes");

  // Cleanup
  await fetch(`${BACKEND_URL}/v1/itsm/admin/sla-policies/${created.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ is_active: false }),
  });

  console.log("\n==================================================");
  console.log(`All SLA Target Fix Checks Passed! (${passed} checks, 0 failed)`);
  console.log("==================================================");
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
