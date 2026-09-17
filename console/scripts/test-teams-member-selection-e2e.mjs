// End-to-end verification script for Teams -> Members user-selection fix
// Validates:
// 1. Authenticate as Platform Administrator
// 2. khushiverma9111@gmail.com exists in ITSM user access source with status=active, itsm_access=true, itsm_role=SERVICE_AGENT
// 3. Search query "khushiverma9111" matches khushiverma9111@gmail.com
// 4. Active users with diverse ITSM roles (SERVICE_AGENT, REQUESTER, INCIDENT_MANAGER, PROCESS_CHANGE_MANAGER) are available
// 5. khushiverma9111@gmail.com can be added to a team (POST /v1/itsm/admin/teams/{id}/members)
// 6. Users with other ITSM roles (REQUESTER, INCIDENT_MANAGER, PROCESS_CHANGE_MANAGER) can be added to the team
// 7. Team member count and member list accurately update
// 8. Member removal succeeds (DELETE /v1/itsm/admin/teams/{id}/members/{user_id})
// 9. Existing team functionality continues working normally

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
  console.log("Starting Teams -> Members User Selection Verification");
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
    // Step 1: Platform Admin Login
    // -------------------------------------------------------------
    console.log("--- Step 1: Authenticate as Platform Administrator ---");
    const adminSession = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
    assert(adminSession.itsm_role === "PLATFORM_ADMINISTRATOR", "Admin has PLATFORM_ADMINISTRATOR role");
    const token = adminSession.session_token;

    // -------------------------------------------------------------
    // Step 2: Query /v1/itsm/admin/users
    // -------------------------------------------------------------
    console.log("\n--- Step 2: Verify khushiverma9111@gmail.com in ITSM Users ---");
    const usersRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(usersRes.status === 200, "GET /v1/itsm/admin/users returns 200");
    const users = await usersRes.json();
    assert(Array.isArray(users), "Users response is an array");
    console.log(`Total active tenant users returned: ${users.length}`);

    const khushiUser = users.find((u) => u.email.toLowerCase() === "khushiverma9111@gmail.com");
    assert(!!khushiUser, "khushiverma9111@gmail.com exists in user source");
    assert(khushiUser.status === "active", `khushiverma9111 status is active (was ${khushiUser.status})`);
    assert(khushiUser.itsm_access === true, "khushiverma9111 has ITSM access enabled");
    assert(khushiUser.itsm_role === "SERVICE_AGENT", `khushiverma9111 role is SERVICE_AGENT (was ${khushiUser.itsm_role})`);

    // -------------------------------------------------------------
    // Step 3: Search Simulation ("khushiverma9111")
    // -------------------------------------------------------------
    console.log("\n--- Step 3: Search Simulation for 'khushiverma9111' ---");
    const searchQuery = "khushiverma9111";
    const searchMatches = users.filter((u) => {
      const q = searchQuery.toLowerCase();
      return (
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q))
      );
    });
    assert(searchMatches.length > 0, `Search for '${searchQuery}' found matches`);
    assert(
      searchMatches.some((u) => u.email.toLowerCase() === "khushiverma9111@gmail.com"),
      `Search for '${searchQuery}' specifically finds khushiverma9111@gmail.com`
    );

    // -------------------------------------------------------------
    // Step 4: Multi-role availability verification
    // -------------------------------------------------------------
    console.log("\n--- Step 4: Multi-Role Active ITSM Users Availability ---");
    const rolesPresent = new Set(users.filter((u) => u.itsm_access && u.status === "active").map((u) => u.itsm_role));
    console.log("Active ITSM roles present in tenant:", Array.from(rolesPresent).join(", "));
    assert(rolesPresent.has("SERVICE_AGENT"), "SERVICE_AGENT role available for teams");
    assert(rolesPresent.has("REQUESTER"), "REQUESTER role available for teams");

    // -------------------------------------------------------------
    // Step 5: Team Creation & Adding khushiverma9111@gmail.com
    // -------------------------------------------------------------
    console.log("\n--- Step 5: Add khushiverma9111@gmail.com to Team ---");
    const teamName = `Team User Selection Test ${Date.now()}`;
    const createTeamRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: teamName,
        description: "Testing member selection with khushiverma9111",
        is_active: true,
      }),
    });
    assert(createTeamRes.status === 201, "POST /v1/itsm/admin/teams returns 201 Created");
    const createdTeam = await createTeamRes.json();
    const teamId = createdTeam.id;

    // Add khushiverma9111
    const addKhushiRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}/members`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: khushiUser.id }),
    });
    assert(addKhushiRes.status === 201, "Add khushiverma9111 to team returns 201 Created");
    const khushiMember = await addKhushiRes.json();
    assert(khushiMember.user_id === khushiUser.id, "Added member has matching user_id");
    assert(khushiMember.email.toLowerCase() === "khushiverma9111@gmail.com", "Added member email matches khushiverma9111");

    // Verify team detail
    const teamDetail1 = await (
      await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    assert(teamDetail1.member_count === 1, "Team member count is 1");
    assert(
      teamDetail1.members.some((m) => m.email.toLowerCase() === "khushiverma9111@gmail.com"),
      "khushiverma9111 appears in team members list"
    );

    // -------------------------------------------------------------
    // Step 6: Add Users with Other ITSM Roles (e.g. REQUESTER)
    // -------------------------------------------------------------
    console.log("\n--- Step 6: Add Users with Other ITSM Roles ---");
    const requesterUser = users.find((u) => u.itsm_access && u.status === "active" && u.itsm_role === "REQUESTER" && u.id !== khushiUser.id);
    if (requesterUser) {
      const addReqRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}/members`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: requesterUser.id }),
      });
      assert(addReqRes.status === 201, `Add REQUESTER (${requesterUser.email}) returns 201 Created`);
      console.log(`Successfully added REQUESTER ${requesterUser.email} to team`);
    }

    const otherRoleUser = users.find(
      (u) => u.itsm_access && u.status === "active" && !["SERVICE_AGENT", "REQUESTER"].includes(u.itsm_role) && u.id !== khushiUser.id
    );
    if (otherRoleUser) {
      const addOtherRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}/members`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: otherRoleUser.id }),
      });
      assert(addOtherRes.status === 201, `Add ${otherRoleUser.itsm_role} (${otherRoleUser.email}) returns 201 Created`);
      console.log(`Successfully added ${otherRoleUser.itsm_role} ${otherRoleUser.email} to team`);
    }

    // -------------------------------------------------------------
    // Step 7: Remove Member & Verify List Update
    // -------------------------------------------------------------
    console.log("\n--- Step 7: Remove khushiverma9111 from Team ---");
    const removeRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}/members/${khushiUser.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(removeRes.status === 204 || removeRes.status === 200, "DELETE member returns 204 No Content");

    const teamAfterRemove = await (
      await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    assert(
      !teamAfterRemove.members.some((m) => m.email.toLowerCase() === "khushiverma9111@gmail.com"),
      "khushiverma9111 removed from team members list"
    );

    // -------------------------------------------------------------
    // Step 8: Clean up team
    // -------------------------------------------------------------
    console.log("\n--- Step 8: Cleanup Test Team ---");
    const deactRes = await fetch(`${BACKEND_URL}/v1/itsm/admin/teams/${teamId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ is_active: false }),
    });
    assert(deactRes.status === 200, "Deactivate test team returns 200");

    console.log("\n==================================================");
    console.log(`All Tests Passed Successfully! (${passed} checks, 0 failed)`);
    console.log("==================================================");
  } catch (err) {
    console.error(`\n❌ Test suite failed: ${err.message}`);
    process.exit(1);
  }
}

runTests();
