// Verifies console HTTP SSR responses and redirects for Platform Administrator routes.

const CONSOLE_URL = process.env.CONSOLE_URL || "http://127.0.0.1:3001";
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

async function login(email, password) {
  const res = await fetch(`${BACKEND_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tenant_name: "AuthClaw Lite Demo" }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}`);
  return await res.json();
}

async function testConsoleRoutes() {
  console.log("Testing Console HTTP SSR routes and redirection...");

  // 1. Unauthenticated request to /itsm/admin must redirect to /itsm/login
  const unauthRes = await fetch(`${CONSOLE_URL}/itsm/admin`, { redirect: "manual" });
  console.log(`Unauthenticated /itsm/admin status: ${unauthRes.status}, location: ${unauthRes.headers.get("location")}`);
  if (unauthRes.status !== 307 && unauthRes.status !== 302) {
    throw new Error(`Expected redirect for unauthenticated user, got ${unauthRes.status}`);
  }

  // 2. Legacy /itsm/admin must redirect to /itsm/admin-portal
  const admin = await login("admin@authclaw-lite.demo", "AuthClawDemo!234");
  const adminCookie = `authclaw_session=${admin.session_token}`;

  const legacyAdminRes = await fetch(`${CONSOLE_URL}/itsm/admin`, {
    headers: { Cookie: adminCookie },
    redirect: "manual",
  });
  console.log(`Legacy Admin /itsm/admin status: ${legacyAdminRes.status}, location: ${legacyAdminRes.headers.get("location")}`);
  if (legacyAdminRes.status !== 307 || legacyAdminRes.headers.get("location") !== "/itsm/admin-portal") {
    throw new Error(`Expected legacy /itsm/admin to redirect to /itsm/admin-portal, got ${legacyAdminRes.status}`);
  }

  // 3. Canonical /itsm/admin-portal must return 200 for Admin
  const adminLandingRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
    headers: { Cookie: adminCookie },
    redirect: "manual",
  });
  console.log(`Admin /itsm/admin-portal status: ${adminLandingRes.status}`);
  if (adminLandingRes.status !== 200) {
    throw new Error(`Admin failed to access /itsm/admin-portal, got ${adminLandingRes.status}`);
  }

  // 4. Canonical /itsm/admin-portal/users must return 200 for Admin
  const adminUsersRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal/users`, {
    headers: { Cookie: adminCookie },
    redirect: "manual",
  });
  console.log(`Admin /itsm/admin-portal/users status: ${adminUsersRes.status}`);
  if (adminUsersRes.status !== 200) {
    throw new Error(`Admin failed to access /itsm/admin-portal/users, got ${adminUsersRes.status}`);
  }

  // 5. Canonical /itsm/admin-portal/teams must return 200 for Admin
  const adminTeamsRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal/teams`, {
    headers: { Cookie: adminCookie },
    redirect: "manual",
  });
  console.log(`Admin /itsm/admin-portal/teams status: ${adminTeamsRes.status}`);
  if (adminTeamsRes.status !== 200) {
    throw new Error(`Admin failed to access /itsm/admin-portal/teams, got ${adminTeamsRes.status}`);
  }

  // 6. Canonical /itsm/admin-portal/services must return 200 for Admin
  const adminServicesRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal/services`, {
    headers: { Cookie: adminCookie },
    redirect: "manual",
  });
  console.log(`Admin /itsm/admin-portal/services status: ${adminServicesRes.status}`);
  if (adminServicesRes.status !== 200) {
    throw new Error(`Admin failed to access /itsm/admin-portal/services, got ${adminServicesRes.status}`);
  }

  // 7. Canonical /itsm/admin-portal/configuration-items must return 200 for Admin
  const adminCiRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal/configuration-items`, {
    headers: { Cookie: adminCookie },
    redirect: "manual",
  });
  console.log(`Admin /itsm/admin-portal/configuration-items status: ${adminCiRes.status}`);
  if (adminCiRes.status !== 200) {
    throw new Error(`Admin failed to access /itsm/admin-portal/configuration-items, got ${adminCiRes.status}`);
  }

  // 8. Requester request to canonical /itsm/admin-portal must redirect to /itsm/incidents?error=admin_required
  const requester = await login("requester123@gmail.com", "Requester@123");
  const reqCookie = `authclaw_session=${requester.session_token}`;

  const requesterAdminRes = await fetch(`${CONSOLE_URL}/itsm/admin-portal`, {
    headers: { Cookie: reqCookie },
    redirect: "manual",
  });
  console.log(`Requester /itsm/admin-portal status: ${requesterAdminRes.status}, location: ${requesterAdminRes.headers.get("location")}`);
  if (requesterAdminRes.status !== 307 && requesterAdminRes.status !== 302) {
    throw new Error(`Expected redirect for requester user, got ${requesterAdminRes.status}`);
  }
  const loc = requesterAdminRes.headers.get("location") || "";
  if (!loc.includes("admin_required")) {
    throw new Error(`Expected admin_required in redirect location, got ${loc}`);
  }

  console.log("All console route guards verified successfully!");
}

testConsoleRoutes().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
