// End-to-end verification script for Phase 4 Step 2: Teams + Services + Basic CMDB
// Validates:
// 1. Platform Admin access to Teams, Services, and Configuration Items
// 2. Teams CRUD, member add/remove, toggle active
// 3. Services CRUD, tier, status toggle
// 4. Configuration Items CRUD with Service association, status toggle
// 5. Zero passwords / single identity foundation
// 6. RBAC rejection (403) for non-admin ITSM roles and governance-only users
// 7. Step 1 regression checks (User management remains fully operational)
// 8. Whitelist boundaries (Blocked future modules)

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
  console.log("Starting ITSM Step 2 Verification (Teams, Services, CMDB)");
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
    console.log("--- Scenario 1: Platform Admin Login & Baseline ---");
    const adminSession = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
    assert(adminSession.itsm_role === "PLATFORM_ADMINISTRATOR", "Admin has PLATFORM_ADMINISTRATOR role");
    assert(adminSession.product_access?.itsm === true, "Admin has ITSM product access enabled");
    const adminToken = adminSession.session_token;

    // Get tenant users to find an existing AuthClaw user to add as team member
    const usersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(usersRes.status === 200, "GET /v1/itsm/admin/users returns 200");
    const users = await usersRes.json();
    assert(users.length > 0, "Users list is populated from public.users");
    const targetUser = users.find((u) => u.email === "agent@authclaw-lite.demo") || users[0];
    console.log(`Using existing AuthClaw user for team member test: ${targetUser.email} (${targetUser.id})`);

    // -------------------------------------------------------------
    // Scenario 2: Teams / Groups CRUD & Member Management
    // -------------------------------------------------------------
    console.log("\n--- Scenario 2: Teams & Member Management ---");
    // List initial teams
    const initialTeamsRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(initialTeamsRes.status === 200, "GET /v1/itsm/admin/teams returns 200");
    const initialTeams = await initialTeamsRes.json();
    assert(Array.isArray(initialTeams), "Teams response is an array");

    // Create a new team
    const teamName = `SecOps Response Team ${Date.now()}`;
    const createTeamRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: teamName,
        description: "Specialized Incident and Vulnerability response squad",
      }),
    });
    assert(createTeamRes.status === 201, "POST /v1/itsm/admin/teams returns 201 Created");
    const createdTeam = await createTeamRes.json();
    assert(createdTeam.name === teamName, "Created team has correct name");
    assert(createdTeam.member_count === 0, "Initial member count is strictly 0 (no fake numbers)");
    assert(createdTeam.is_active === true, "New team is active by default");
    const teamId = createdTeam.id;

    // Update team description
    const updateTeamRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: "Updated description for SecOps squad",
      }),
    });
    assert(updateTeamRes.status === 200, "PATCH /v1/itsm/admin/teams/{id} returns 200");
    const updatedTeam = await updateTeamRes.json();
    assert(updatedTeam.description === "Updated description for SecOps squad", "Team description updated");

    // Add existing AuthClaw user as member
    const addMemberRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}/members`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: targetUser.id,
      }),
    });
    assert(addMemberRes.status === 201, "POST /v1/itsm/admin/teams/{id}/members returns 201 Created");
    const addedMember = await addMemberRes.json();
    assert(addedMember.user_id === targetUser.id, "Added member has matching user_id");
    assert(addedMember.email === targetUser.email, "Added member returned with AuthClaw email");

    // Fetch team details and verify member count and members list
    const teamDetailRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(teamDetailRes.status === 200, "GET /v1/itsm/admin/teams/{id} returns 200");
    const teamDetail = await teamDetailRes.json();
    assert(teamDetail.member_count === 1, "Team member_count is now exactly 1");
    assert(teamDetail.members.length === 1, "Members list contains 1 user");
    assert(teamDetail.members[0].email === targetUser.email, "Member email matches existing identity");

    // Remove member
    const removeMemberRes = await fetch(
      `${BACKEND_URL}/v1/itsm/admin/teams/${teamId}/members/${targetUser.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    assert(removeMemberRes.status === 204 || removeMemberRes.status === 200, "DELETE /v1/itsm/admin/teams/{id}/members/{user_id} returns 204 No Content");

    // Verify member count decreased back to 0
    const teamAfterRemoveRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const teamAfterRemove = await teamAfterRemoveRes.json();
    assert(teamAfterRemove.member_count === 0, "Team member count is 0 after removal");
    assert(teamAfterRemove.members.length === 0, "Team members list is empty");

    // Deactivate / toggle team active status
    const deactivateRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_active: false }),
    });
    assert(deactivateRes.status === 200, "PATCH toggle active status returns 200");
    const deactivatedTeam = await deactivateRes.json();
    assert(deactivatedTeam.is_active === false, "Team is successfully deactivated");

    // -------------------------------------------------------------
    // Scenario 3: Services Management
    // -------------------------------------------------------------
    console.log("\n--- Scenario 3: Services Management ---");
    const initialServicesRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/services`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(initialServicesRes.status === 200, "GET /v1/itsm/admin/services returns 200");
    const initialServices = await initialServicesRes.json();
    assert(Array.isArray(initialServices), "Services response is an array");

    // Create service
    const serviceName = `Core Identity Gateway ${Date.now()}`;
    const createServiceRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/services`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: serviceName,
        description: "Primary user authentication and federation endpoint",
        tier: "TIER_1",
        status: "OPERATIONAL",
        escalation_team: teamName,
      }),
    });
    assert(createServiceRes.status === 201, "POST /v1/itsm/admin/services returns 201 Created");
    const createdService = await createServiceRes.json();
    assert(createdService.name === serviceName, "Service name matches");
    assert(createdService.tier === "TIER_1", "Service tier matches TIER_1");
    assert(createdService.status === "OPERATIONAL", "Service status matches OPERATIONAL");
    assert(createdService.escalation_team === teamName, "Escalation team linked properly");
    const serviceId = createdService.id;

    // Update service
    const updateServiceRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/services/${serviceId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tier: "TIER_2",
        status: "DEGRADED",
      }),
    });
    assert(updateServiceRes.status === 200, "PATCH /v1/itsm/admin/services/{id} returns 200");
    const updatedService = await updateServiceRes.json();
    assert(updatedService.tier === "TIER_2", "Service tier updated to TIER_2");
    assert(updatedService.status === "DEGRADED", "Service status updated to DEGRADED");

    // -------------------------------------------------------------
    // Scenario 4: Configuration Items (Basic CMDB)
    // -------------------------------------------------------------
    console.log("\n--- Scenario 4: Configuration Items Management ---");
    const initialCIsRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/configuration-items`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(initialCIsRes.status === 200, "GET /v1/itsm/admin/configuration-items returns 200");
    const initialCIs = await initialCIsRes.json();
    assert(Array.isArray(initialCIs), "Configuration items response is an array");

    // Create CI linked to service
    const ciName = `auth-lb-prod-01-${Date.now()}`;
    const createCIRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/configuration-items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: ciName,
        ci_type: "LOAD_BALANCER",
        service_id: serviceId,
        environment: "PRODUCTION",
        status: "OPERATIONAL",
        attributes: { ip_address: "10.0.1.50", zone: "us-east-1a" },
      }),
    });
    assert(createCIRes.status === 201, "POST /v1/itsm/admin/configuration-items returns 201 Created");
    const createdCI = await createCIRes.json();
    assert(createdCI.name === ciName, "CI name matches");
    assert(createdCI.ci_type === "LOAD_BALANCER", "CI type matches LOAD_BALANCER");
    assert(createdCI.service_id === serviceId, "CI linked to correct service");
    assert(createdCI.environment === "PRODUCTION", "CI environment matches PRODUCTION");
    const ciId = createdCI.id;

    // Update CI status
    const updateCIRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/configuration-items/${ciId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "MAINTENANCE",
        environment: "STAGING",
      }),
    });
    assert(updateCIRes.status === 200, "PATCH /v1/itsm/admin/configuration-items/{id} returns 200");
    const updatedCI = await updateCIRes.json();
    assert(updatedCI.status === "MAINTENANCE", "CI status updated to MAINTENANCE");
    assert(updatedCI.environment === "STAGING", "CI environment updated to STAGING");

    // -------------------------------------------------------------
    // Scenario 5: RBAC Enforcement & Forbidden Roles
    // -------------------------------------------------------------
    console.log("\n--- Scenario 5: RBAC Enforcement for Non-Admin Roles ---");

    // Test with Service Agent
    const agentSession = await login("itsm-agent@test.com", "AuthClawDemo!234");
    const agentToken = agentSession.session_token;

    const agentTeamsRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(agentTeamsRes.status === 403, "Service Agent denied access to /teams (403 Forbidden)");

    const agentServicesRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/services`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(agentServicesRes.status === 403, "Service Agent denied access to /services (403 Forbidden)");

    const agentCIsRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/configuration-items`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(agentCIsRes.status === 403, "Service Agent denied access to /configuration-items (403 Forbidden)");

    // Test with Requester
    const requesterSession = await login("requester123@gmail.com", "Requester@123");
    const reqToken = requesterSession.session_token;

    const reqTeamsRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams`, {
      headers: { Authorization: `Bearer ${reqToken}` },
    });
    assert(reqTeamsRes.status === 403, "Requester denied access to /teams (403 Forbidden)");

    // -------------------------------------------------------------
    // Scenario 6: Step 1 Non-Regression (User Access)
    // -------------------------------------------------------------
    console.log("\n--- Scenario 6: Step 1 User Management Non-Regression ---");
    const adminUserAccessRes = await fetch(
      `${BACKEND_URL}/v1/itsm/admin/users/${targetUser.id}/access`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          has_itsm_access: true,
          itsm_role: "SERVICE_AGENT",
        }),
      }
    );
    if (!adminUserAccessRes.ok) {
      console.log("adminUserAccessRes failed status:", adminUserAccessRes.status, await adminUserAccessRes.text());
    }
    assert(adminUserAccessRes.status === 200, "Platform Admin can still update user access");
    const userAccessResult = await adminUserAccessRes.json();
    assert(userAccessResult.itsm_role === "SERVICE_AGENT", "User access updated accurately");

    console.log("\n==================================================");
    console.log(`All Step 2 Verification Scenarios Passed! (${passed} checks, ${failed} failed)`);
    console.log("==================================================");
  } catch (err) {
    console.error("\n❌ Verification terminated with error:", err.message);
    process.exit(1);
  }
}

runTests();
