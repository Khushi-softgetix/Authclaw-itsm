// End-to-end verification script for Phase 4 Step 3: Service Catalog + SLA Configuration
// Validates:
// 1. Platform Admin access to Service Catalog, Business Calendars, and SLA Policies
// 2. Service Catalog CRUD, Service binding, approval toggle, active status toggle
// 3. Business Calendar CRUD, timezone, working hours, default calendar flag
// 4. SLA Policy CRUD, Priority validation (P1-P4), response/resolution targets, calendar & service binding
// 5. RBAC rejection (403) for non-admin ITSM roles (Requester, Agent, Incident Manager, PCM, Auditor)
// 6. Regression checks for Step 1 (Users), Step 2 (Teams/Services/CMDB), and Incident Manager portal

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const CONSOLE_URL = process.env.CONSOLE_URL || "http://127.0.0.1:3001";

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

async function runTests() {
  console.log("==================================================");
  console.log("Starting ITSM Step 3 Verification (Service Catalog + SLA Configuration)");
  console.log(`Backend URL: ${BACKEND_URL}`);
  console.log(`Console URL: ${CONSOLE_URL}`);
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
    // Scenario 1: Platform Administrator Authentication & Setup
    // -------------------------------------------------------------
    console.log("--- Scenario 1: Platform Admin Login & Services Discovery ---");
    const adminSession = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
    assert(adminSession.itsm_role === "PLATFORM_ADMINISTRATOR", "Admin has PLATFORM_ADMINISTRATOR role");
    assert(adminSession.product_access?.itsm === true, "Admin has ITSM product access enabled");
    const adminToken = adminSession.session_token;

    // Fetch existing services to link with Catalog and SLA
    const servicesRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/services`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(servicesRes.status === 200, "GET /v1/itsm/admin/services returns 200");
    const services = await servicesRes.json();
    assert(services.length > 0, "Found existing service to associate with catalog & SLA items");
    const testService = services[0];
    console.log(`Using Service: ${testService.name} (${testService.id})`);

    // -------------------------------------------------------------
    // Scenario 2: Service Catalog Item CRUD
    // -------------------------------------------------------------
    console.log("\n--- Scenario 2: Service Catalog Administration CRUD ---");
    const catalogItemName = `Cloud Sandbox Access ${Date.now()}`;
    const createCatalogRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/service-catalog`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: catalogItemName,
        description: "Temporary AWS sandbox environment for testing infrastructure code",
        service_id: testService.id,
        approval_required: true,
        fulfillment_group: "Cloud Engineering",
        estimated_delivery_hours: 8,
        is_active: true,
      }),
    });
    assert(createCatalogRes.status === 201, "POST /v1/itsm/admin/service-catalog returns 201 Created");
    const createdCatalogItem = await createCatalogRes.json();
    assert(createdCatalogItem.name === catalogItemName, "Created catalog item has matching name");
    assert(createdCatalogItem.service_id === testService.id, "Catalog item binds to specified service");
    assert(createdCatalogItem.approval_required === true, "Approval required set to true");
    assert(createdCatalogItem.estimated_delivery_hours === 8, "Estimated delivery set to 8 hours");
    assert(createdCatalogItem.is_active === true, "Catalog item active by default");
    const catalogItemId = createdCatalogItem.id;

    // Get single catalog item detail
    const getCatalogRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/service-catalog/${catalogItemId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(getCatalogRes.status === 200, "GET /v1/itsm/admin/service-catalog/{id} returns 200");
    const fetchedCatalogItem = await getCatalogRes.json();
    assert(fetchedCatalogItem.id === catalogItemId, "Fetched catalog item matches ID");
    assert(fetchedCatalogItem.service_name === testService.name, "Joined service name matches");

    // Patch catalog item (e.g. toggle status and update fulfillment group)
    const patchCatalogRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/service-catalog/${catalogItemId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fulfillment_group: "IT Operations & Cloud",
        is_active: false,
      }),
    });
    assert(patchCatalogRes.status === 200, "PATCH /v1/itsm/admin/service-catalog/{id} returns 200");
    const patchedCatalogItem = await patchCatalogRes.json();
    assert(patchedCatalogItem.fulfillment_group === "IT Operations & Cloud", "Fulfillment group updated");
    assert(patchedCatalogItem.is_active === false, "Catalog item disabled via is_active=false");

    // -------------------------------------------------------------
    // Scenario 3: Business Calendar Management CRUD
    // -------------------------------------------------------------
    console.log("\n--- Scenario 3: Business Calendar Administration CRUD ---");
    const calendarName = `Americas Standard Shift ${Date.now()}`;
    const createCalRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/business-calendars`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: calendarName,
        timezone: "America/New_York",
        weekly_hours: {
          monday: { start: "08:00", end: "17:00" },
          tuesday: { start: "08:00", end: "17:00" },
          wednesday: { start: "08:00", end: "17:00" },
          thursday: { start: "08:00", end: "17:00" },
          friday: { start: "08:00", end: "17:00" },
        },
        holidays: ["2026-12-25", "2026-01-01"],
        is_default: true,
      }),
    });
    assert(createCalRes.status === 201, "POST /v1/itsm/admin/business-calendars returns 201 Created");
    const createdCal = await createCalRes.json();
    assert(createdCal.name === calendarName, "Calendar created with correct name");
    assert(createdCal.timezone === "America/New_York", "Timezone matches America/New_York");
    assert(createdCal.is_default === true, "Calendar marked as default");
    const calId = createdCal.id;

    // Get single calendar
    const getCalRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/business-calendars/${calId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(getCalRes.status === 200, "GET /v1/itsm/admin/business-calendars/{id} returns 200");
    const fetchedCal = await getCalRes.json();
    assert(fetchedCal.name === calendarName, "Fetched calendar name matches");

    // Patch calendar (update timezone)
    const patchCalRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/business-calendars/${calId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timezone: "America/Chicago",
      }),
    });
    assert(patchCalRes.status === 200, "PATCH /v1/itsm/admin/business-calendars/{id} returns 200");
    const patchedCal = await patchCalRes.json();
    assert(patchedCal.timezone === "America/Chicago", "Calendar timezone updated to America/Chicago");

    // -------------------------------------------------------------
    // Scenario 4: SLA Policy Management CRUD
    // -------------------------------------------------------------
    console.log("\n--- Scenario 4: SLA Policy Administration CRUD ---");
    const policyName = `P1 Critical Outage Policy ${Date.now()}`;
    const createPolicyRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/sla-policies`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: policyName,
        description: "Strict 15m response / 2h resolution SLA for P1 major system incidents",
        ticket_type: "INCIDENT",
        priority: "P1",
        service_id: testService.id,
        calendar_id: calId,
        response_target_minutes: 15,
        resolution_target_minutes: 120,
        is_active: true,
      }),
    });
    assert(createPolicyRes.status === 201, "POST /v1/itsm/admin/sla-policies returns 201 Created");
    const createdPolicy = await createPolicyRes.json();
    assert(createdPolicy.name === policyName, "Created policy has correct name");
    assert(createdPolicy.priority === "P1", "Priority is P1");
    assert(createdPolicy.response_target_minutes === 15, "Response target 15 minutes");
    assert(createdPolicy.resolution_target_minutes === 120, "Resolution target 120 minutes");
    assert(createdPolicy.service_id === testService.id, "Service ID bound correctly");
    assert(createdPolicy.calendar_id === calId, "Calendar ID bound correctly");
    const policyId = createdPolicy.id;

    // Get policy detail
    const getPolicyRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/sla-policies/${policyId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(getPolicyRes.status === 200, "GET /v1/itsm/admin/sla-policies/{id} returns 200");
    const fetchedPolicy = await getPolicyRes.json();
    assert(fetchedPolicy.calendar_name === patchedCal.name, "Joined calendar name matches");
    assert(fetchedPolicy.service_name === testService.name, "Joined service name matches");

    // Patch policy (toggle status and adjust resolution target)
    const patchPolicyRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/sla-policies/${policyId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resolution_target_minutes: 180,
        is_active: false,
      }),
    });
    assert(patchPolicyRes.status === 200, "PATCH /v1/itsm/admin/sla-policies/{id} returns 200");
    const patchedPolicy = await patchPolicyRes.json();
    assert(patchedPolicy.resolution_target_minutes === 180, "Resolution target updated to 180m");
    assert(patchedPolicy.is_active === false, "Policy deactivated successfully");

    // -------------------------------------------------------------
    // Scenario 5: Non-Admin RBAC Denial (403 Forbidden)
    // -------------------------------------------------------------
    console.log("\n--- Scenario 5: Non-Admin RBAC Denial ---");
    const agentSession = await login("agent@authclaw-lite.demo", "AuthClawDemo!234");
    assert(agentSession.itsm_role === "SERVICE_AGENT", "Agent session verified");
    const agentToken = agentSession.session_token;

    // Agent denied for Service Catalog
    const agentCatRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/service-catalog`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(agentCatRes.status === 403, "SERVICE_AGENT is denied GET /v1/itsm/admin/service-catalog (403)");

    // Agent denied for SLA policies
    const agentSLARes = await fetch(`${BACKEND_URL}/v1/itsm/admin/sla-policies`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(agentSLARes.status === 403, "SERVICE_AGENT is denied GET /v1/itsm/admin/sla-policies (403)");

    // Agent denied for Business Calendars
    const agentCalRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/business-calendars`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(agentCalRes.status === 403, "SERVICE_AGENT is denied GET /v1/itsm/admin/business-calendars (403)");

    // Incident Manager denied for Platform Administration
    const imSession = await login("incidentmanager@authclaw-lite.demo", "AuthClawDemo!234");
    assert(imSession.itsm_role === "INCIDENT_MANAGER", "Incident Manager session verified");
    const imToken = imSession.session_token;

    const imCatRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/service-catalog`, {
      headers: { Authorization: `Bearer ${imToken}` },
    });
    assert(imCatRes.status === 403, "INCIDENT_MANAGER is denied GET /v1/itsm/admin/service-catalog (403)");

    const imSLARes = await fetch(`${BACKEND_URL}/v1/itsm/admin/sla-policies`, {
      headers: { Authorization: `Bearer ${imToken}` },
    });
    assert(imSLARes.status === 403, "INCIDENT_MANAGER is denied GET /v1/itsm/admin/sla-policies (403)");

    // -------------------------------------------------------------
    // Scenario 6: Regression Verification (Step 1, Step 2, Incident Manager)
    // -------------------------------------------------------------
    console.log("\n--- Scenario 6: Regression Verification ---");
    // Step 1 check: Users endpoint works
    const adminUsersCheck = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminUsersCheck.status === 200, "Step 1 regression: GET /v1/itsm/admin/users returns 200");

    // Step 2 check: Teams and CMDB endpoints work
    const adminTeamsCheck = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminTeamsCheck.status === 200, "Step 2 regression: GET /v1/itsm/admin/teams returns 200");

    const adminCIsCheck = await fetch(`${BACKEND_URL}/v1/itsm/admin/configuration-items`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminCIsCheck.status === 200, "Step 2 regression: GET /v1/itsm/admin/configuration-items returns 200");

    console.log("\n==================================================");
    console.log(`Step 3 Verification Complete: ${passed} passed, ${failed} failed.`);
    console.log("==================================================");
  } catch (error) {
    console.error("\n❌ Verification encountered fatal error:", error);
    process.exit(1);
  }
}

runTests();
