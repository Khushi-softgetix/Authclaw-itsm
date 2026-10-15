import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const consoleDir = path.resolve(__dirname, "..");

test("Operational ConsoleShell contains no Administration menu; dedicated AdminPortalShell provides Platform Admin navigation", () => {
  const consoleShellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  const consoleShellSource = fs.readFileSync(consoleShellPath, "utf-8");

  // Operational portal must NOT have Administration in itsmNavigation
  assert.ok(!consoleShellSource.includes('name: "Administration"'), "ConsoleShell must NOT define Administration navigation");

  const adminShellPath = path.join(consoleDir, "src/components/admin-portal-shell.tsx");
  assert.ok(fs.existsSync(adminShellPath), "Dedicated AdminPortalShell component must exist");

  const adminShellSource = fs.readFileSync(adminShellPath, "utf-8");
  assert.ok(adminShellSource.includes("Platform Administration"), "Must display Platform Administration header");
  assert.ok(adminShellSource.includes("Administration"), "Must define Administration navigation section");
  assert.ok(adminShellSource.includes('name: "Users"'), "Must include Users sub-navigation");
  assert.ok(adminShellSource.includes('href: "/itsm/admin-portal/users"'), "Users must link to /itsm/admin-portal/users");

  // Step 2 navigation in AdminPortalShell
  assert.ok(adminShellSource.includes('name: "Teams"'), "Must include Teams sub-navigation");
  assert.ok(adminShellSource.includes('href: "/itsm/admin-portal/teams"'), "Teams must link to /itsm/admin-portal/teams");
  assert.ok(adminShellSource.includes('name: "Services"'), "Must include Services sub-navigation");
  assert.ok(adminShellSource.includes('href: "/itsm/admin-portal/services"'), "Services must link to /itsm/admin-portal/services");
  assert.ok(adminShellSource.includes('name: "Configuration Items"'), "Must include Configuration Items sub-navigation");
  assert.ok(adminShellSource.includes('href: "/itsm/admin-portal/configuration-items"'), "Configuration Items must link to /itsm/admin-portal/configuration-items");

  // Verify root console layout switches to AdminPortalShell for /itsm/admin-portal
  const rootLayoutPath = path.join(consoleDir, "src/app/(console)/layout.tsx");
  const rootLayoutSource = fs.readFileSync(rootLayoutPath, "utf-8");
  assert.ok(rootLayoutSource.includes("AdminPortalShell"), "Root layout must import AdminPortalShell");
  assert.ok(rootLayoutSource.includes('currentPath.startsWith("/itsm/admin-portal")'), "Root layout must switch shells for /itsm/admin-portal");
});

test("Platform admin portal layout enforces server-side PLATFORM_ADMINISTRATOR authorization", () => {
  const layoutPath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/layout.tsx");
  assert.ok(fs.existsSync(layoutPath), "Platform admin layout must exist at /itsm/admin-portal/layout.tsx");

  const source = fs.readFileSync(layoutPath, "utf-8");
  assert.ok(source.includes("v1/auth/me"), "Must fetch principal from authoritative backend");
  assert.ok(source.includes("hasItsmAccess"), "Must check ITSM product access");
  assert.ok(source.includes('itsmRole !== "PLATFORM_ADMINISTRATOR"'), "Must check for PLATFORM_ADMINISTRATOR role");
  assert.ok(source.includes("admin_required"), "Must redirect unauthorized users");
});

test("Platform admin landing page exists at /itsm/admin-portal with 4 admin workspace cards and no fake statistics", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Platform admin landing page must exist at /itsm/admin-portal/page.tsx");

  const source = fs.readFileSync(pagePath, "utf-8");
  assert.ok(source.includes("Platform Administration"), "Must have Platform Administration header");
  assert.ok(source.includes("User Management"), "Must include User Management card");
  assert.ok(source.includes("/itsm/admin-portal/users"), "Must link to /itsm/admin-portal/users");
  assert.ok(source.includes("Teams & Groups"), "Must include Teams & Groups card");
  assert.ok(source.includes("/itsm/admin-portal/teams"), "Must link to /itsm/admin-portal/teams");
  assert.ok(source.includes("Services"), "Must include Services card");
  assert.ok(source.includes("/itsm/admin-portal/services"), "Must link to /itsm/admin-portal/services");
  assert.ok(source.includes("Configuration Items (CMDB)"), "Must include Configuration Items card");
  assert.ok(source.includes("/itsm/admin-portal/configuration-items"), "Must link to /itsm/admin-portal/configuration-items");
  assert.ok(!source.includes("fakeCount"), "Must not include fake statistics");
  assert.ok(!source.includes("mockStats"), "Must not include mock stats");
});

test("Legacy /itsm/admin and /itsm/admin/users routes redirect to canonical /itsm/admin-portal routes", () => {
  const legacyAdminPage = path.join(consoleDir, "src/app/(console)/itsm/admin/page.tsx");
  assert.ok(fs.existsSync(legacyAdminPage), "Legacy /itsm/admin/page.tsx must exist");
  const legacyAdminSource = fs.readFileSync(legacyAdminPage, "utf-8");
  assert.ok(legacyAdminSource.includes('redirect("/itsm/admin-portal")'), "Legacy /itsm/admin must redirect to /itsm/admin-portal");

  const legacyUsersPage = path.join(consoleDir, "src/app/(console)/itsm/admin/users/page.tsx");
  assert.ok(fs.existsSync(legacyUsersPage), "Legacy /itsm/admin/users/page.tsx must exist");
  const legacyUsersSource = fs.readFileSync(legacyUsersPage, "utf-8");
  assert.ok(legacyUsersSource.includes('redirect("/itsm/admin-portal/users")'), "Legacy /itsm/admin/users must redirect to /itsm/admin-portal/users");
});

test("User management page supports listing, search/filter, and links to dedicated user access page", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/users/page.tsx");
  assert.ok(fs.existsSync(pagePath), "User management page must exist at /itsm/admin-portal/users/page.tsx");

  const source = fs.readFileSync(pagePath, "utf-8");
  assert.ok(source.includes("ITSM User Management"), "Must have ITSM User Management header");
  assert.ok(source.includes("Grant ITSM Access"), "Must have Grant ITSM Access CTA");
  assert.ok(source.includes("/itsm/admin-portal/users/${user.id}"), "Must link each user to dedicated user access route");
  assert.ok(source.includes("/api/itsm/admin/users"), "Must query ITSM admin users API");
  assert.ok(!source.includes('type="password"'), "Must not expose password inputs");
});

test("Dedicated user access page exists at /itsm/admin-portal/users/[id] with required sections and no modal", () => {
  const detailPath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/users/[id]/page.tsx");
  assert.ok(fs.existsSync(detailPath), "Dedicated user access detail page must exist at /itsm/admin-portal/users/[id]/page.tsx");

  const source = fs.readFileSync(detailPath, "utf-8");
  assert.ok(source.includes("Back to Users"), "Must have 'Back to Users' navigation link");
  assert.ok(source.includes("/itsm/admin-portal/users"), "Back link must point to /itsm/admin-portal/users");
  assert.ok(source.includes("Platform Administration"), "Breadcrumb must include Platform Administration");
  assert.ok(source.includes("User Access"), "Breadcrumb must include User Access");
  assert.ok(source.includes("Edit ITSM Access"), "Must have 'Edit ITSM Access' heading");
  assert.ok(source.includes("Authentication and passwords are managed by AuthClaw"), "Must include AuthClaw identity note");
  assert.ok(source.includes("ITSM Product Access"), "Must include ITSM Product Access section");
  assert.ok(source.includes("ITSM Role"), "Must include ITSM Role section");
  assert.ok(source.includes("Configure as Normal Employee"), "Must provide employee preset");
  assert.ok(source.includes("Governance Access"), "Must include Governance Access section");
  assert.ok(source.includes("Governance access is managed separately from ITSM access"), "Must include governance informational note");
  assert.ok(source.includes("Save Changes"), "Must provide Save Changes action");
  assert.ok(source.includes("Cancel"), "Must provide Cancel action");
  assert.ok(!source.includes('type="password"'), "Must not expose password inputs");

  // Verify all 6 approved roles are present
  const requiredRoles = [
    "REQUESTER",
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "AUDITOR",
  ];
  for (const role of requiredRoles) {
    assert.ok(source.includes(role), `Must support approved ITSM role ${role}`);
  }
});

test("Step 2 Teams workspace exists at /itsm/admin-portal/teams with member management and no passwords", () => {
  const teamsPath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/teams/page.tsx");
  assert.ok(fs.existsSync(teamsPath), "Teams page must exist at /itsm/admin-portal/teams/page.tsx");

  const source = fs.readFileSync(teamsPath, "utf-8");
  assert.ok(source.includes("Teams & Groups"), "Must have Teams & Groups header");
  assert.ok(source.includes("Create Team"), "Must have Create Team action");
  assert.ok(source.includes("Manage Members"), "Must support Manage Members action");
  assert.ok(source.includes("/api/itsm/admin/teams"), "Must query ITSM admin teams API");
  assert.ok(!source.includes('type="password"'), "Must not create or ask for passwords");
});

test("Step 2 Services workspace exists at /itsm/admin-portal/services with CRUD and no passwords", () => {
  const servicesPath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/services/page.tsx");
  assert.ok(fs.existsSync(servicesPath), "Services page must exist at /itsm/admin-portal/services/page.tsx");

  const source = fs.readFileSync(servicesPath, "utf-8");
  assert.ok(source.includes("Services"), "Must have Services header");
  assert.ok(source.includes("Create Service"), "Must have Create Service action");
  assert.ok(source.includes("/api/itsm/admin/services"), "Must query ITSM admin services API");
  assert.ok(!source.includes('type="password"'), "Must not create or ask for passwords");
});

test("Step 2 Configuration Items workspace exists at /itsm/admin-portal/configuration-items with CI CRUD and no passwords", () => {
  const ciPath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/configuration-items/page.tsx");
  assert.ok(fs.existsSync(ciPath), "Configuration Items page must exist at /itsm/admin-portal/configuration-items/page.tsx");

  const source = fs.readFileSync(ciPath, "utf-8");
  assert.ok(source.includes("Configuration Items"), "Must have Configuration Items header");
  assert.ok(source.includes("Add Configuration Item"), "Must have Add Configuration Item action");
  assert.ok(source.includes("/api/itsm/admin/configuration-items"), "Must query ITSM admin configuration items API");
  assert.ok(!source.includes('type="password"'), "Must not create or ask for passwords");
});

test("BFF routes whitelist Step 1 & Step 2 endpoints and reject non-implemented admin modules", () => {
  // Step 1 endpoints
  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/users"), {
    backendPath: "/v1/itsm/admin/users",
    body: "none",
    status: undefined,
  });

  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/users/u-123/access"), {
    backendPath: "/v1/itsm/admin/users/u-123/access",
    body: "json",
    status: undefined,
  });

  // Step 2 endpoints
  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/teams"), {
    backendPath: "/v1/itsm/admin/teams",
    body: "none",
    status: undefined,
  });

  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/teams"), {
    backendPath: "/v1/itsm/admin/teams",
    body: "json",
    status: 201,
  });

  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/services"), {
    backendPath: "/v1/itsm/admin/services",
    body: "none",
    status: undefined,
  });

  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/services"), {
    backendPath: "/v1/itsm/admin/services",
    body: "json",
    status: 201,
  });

  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/configuration-items"), {
    backendPath: "/v1/itsm/admin/configuration-items",
    body: "none",
    status: undefined,
  });

  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/configuration-items"), {
    backendPath: "/v1/itsm/admin/configuration-items",
    body: "json",
    status: 201,
  });

  // Future modules must remain strictly blocked
  assert.equal(resolveBffRoute("GET", "itsm/admin/groups"), null);
  assert.equal(resolveBffRoute("GET", "itsm/admin/cmdb"), null);
  assert.equal(resolveBffRoute("GET", "itsm/admin/slas"), null);
  assert.equal(resolveBffRoute("GET", "itsm/admin/workflows"), null);
  assert.equal(resolveBffRoute("GET", "itsm/admin/cmdb-discovery"), null);
  assert.equal(resolveBffRoute("GET", "itsm/admin/integrations"), null);
});

test("Prompt 4: Create/Invite modal removes temporary passwords and adds invitation lifecycle actions", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/users/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Zero temporary passwords
  assert.ok(!source.includes('type="password"'), "Modal must not contain password inputs");
  assert.ok(!source.includes("manualPassword"), "manualPassword state must be removed");
  assert.ok(!source.includes("manualConfirmPassword"), "manualConfirmPassword state must be removed");
  assert.ok(!source.includes("Email these login credentials"), "Credentials checkbox must be removed");

  // Required invitation inputs
  assert.ok(source.includes("inviteEmail"), "Must require employee email");
  assert.ok(source.includes("inviteRole"), "Must require ITSM role");
  assert.ok(source.includes("Send Invitation"), "Must provide Send Invitation action");

  // Status displays
  assert.ok(source.includes("Pending Activation"), "Must display Pending Activation status");
  assert.ok(source.includes("Expired"), "Must handle Expired status");
  assert.ok(source.includes("Revoked"), "Must handle Revoked status");

  // Authorized actions
  assert.ok(source.includes("Resend Invite"), "Must provide Resend Invite action");
  assert.ok(source.includes("Revoke"), "Must provide Revoke action");
});

test("Prompt 4: Account activation page exists and provides secure password setup without temporary passwords", () => {
  const setupPath = path.join(consoleDir, "src/app/itsm/setup/page.tsx");
  assert.ok(fs.existsSync(setupPath), "Account activation page must exist at /itsm/setup/page.tsx");

  const source = fs.readFileSync(setupPath, "utf-8");
  assert.ok(source.includes("Activate Your Account"), "Must have 'Activate Your Account' heading");
  assert.ok(source.includes("new-password"), "Must have new password input");
  assert.ok(source.includes("confirm-password"), "Must have confirm password input");
  assert.ok(source.includes("showPassword"), "Must have show/hide password control");
  assert.ok(source.includes("password.length < 12"), "Must validate minimum 12 characters");
  assert.ok(source.includes("password !== confirmPassword"), "Must validate matching passwords");
  assert.ok(source.includes("/api/itsm/activate"), "Must call activation API");
  assert.ok(!source.includes("localStorage.setItem"), "Must not store tokens in localStorage");
  assert.ok(!source.includes("sessionStorage.setItem"), "Must not store tokens in sessionStorage");
});
