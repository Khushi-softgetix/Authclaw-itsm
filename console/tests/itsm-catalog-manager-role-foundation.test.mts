import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("ITSM ConsoleShell provides dedicated CATALOG_MANAGER role navigation with strict boundaries", () => {
  const shellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  assert.ok(fs.existsSync(shellPath), "ConsoleShell component must exist");
  const source = fs.readFileSync(shellPath, "utf-8");

  // 1. Role label mapping
  assert.ok(
    source.includes('CATALOG_MANAGER: "Catalog Manager"'),
    "ITSM_ROLE_LABELS must map CATALOG_MANAGER to 'Catalog Manager'"
  );

  // 2. Dedicated navigation definition
  assert.ok(source.includes("catalogManagerNavigation"), "Must define catalogManagerNavigation");
  assert.ok(source.includes('name: "Dashboard", href: "/itsm/dashboard"'), "Catalog Manager nav must include Dashboard");
  assert.ok(
    source.includes('name: "Catalog Items"') &&
      (source.includes('href: "/itsm/catalog-manager/studio"') || source.includes('href: "/itsm/services"')),
    "Catalog Manager nav must include Catalog Items"
  );
  assert.ok(
    source.includes('name: "Form Builder", href: "/itsm/catalog-manager/form-builder"'),
    "Catalog Manager nav must include Form Builder"
  );

  // 3. Role-aware active navigation selection
  assert.ok(
    source.includes('effectiveItsmRole === "CATALOG_MANAGER"'),
    "ConsoleShell must conditionally check for CATALOG_MANAGER role"
  );

  // 4. Strict RBAC isolation - Catalog Manager navigation must NOT expose admin or governance links
  assert.ok(!source.includes('href: "/itsm/admin-portal/users"'), "ConsoleShell must not link to admin users");
  assert.ok(!source.includes('href: "/itsm/admin-portal/teams"'), "ConsoleShell must not link to admin teams");
  assert.ok(!source.includes('href: "/itsm/admin-portal/sla"'), "ConsoleShell must not link to admin SLA");
  assert.ok(!source.includes('href: "/itsm/admin-portal/settings"'), "ConsoleShell must not link to admin settings");
});

test("ITSM Profile page provides role-aware Catalog Manager title, subtitle, and badge", () => {
  const profilePath = path.join(consoleDir, "src/app/(console)/itsm/profile/page.tsx");
  assert.ok(fs.existsSync(profilePath), "Profile page must exist");
  const source = fs.readFileSync(profilePath, "utf-8");

  // Title & subtitle
  assert.ok(source.includes('"Catalog Manager Profile"'), "Must display 'Catalog Manager Profile'");
  assert.ok(
    source.includes("managing Service Catalog offerings and request intake forms"),
    "Subtitle must explain managing Service Catalog offerings and request intake forms"
  );

  // Avatar initials
  assert.ok(source.includes('case "CATALOG_MANAGER":'), "Avatar initials must support CATALOG_MANAGER");
  assert.ok(source.includes('return "CM";'), "Avatar initials for Catalog Manager must be 'CM'");

  // Role badge label
  assert.ok(source.includes('return "Catalog Manager";'), "Must return user-facing 'Catalog Manager' label");
  assert.ok(source.includes('id="profile-role-badge"'), "Must have profile-role-badge element");

  // All 6 existing roles preserved
  const existingRoles = [
    "REQUESTER",
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "AUDITOR",
  ];
  for (const role of existingRoles) {
    assert.ok(source.includes(`"${role}"`), `Must preserve existing role ${role}`);
  }
});

test("ITSM Dashboard root page redirects CATALOG_MANAGER to dedicated workspace", () => {
  const rootPath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/page.tsx");
  assert.ok(fs.existsSync(rootPath), "Dashboard root page must exist");
  const source = fs.readFileSync(rootPath, "utf-8");

  assert.ok(source.includes('case "CATALOG_MANAGER":'), "Dashboard root must handle CATALOG_MANAGER");
  assert.ok(
    source.includes('redirect("/itsm/dashboard/catalog-manager")'),
    "CATALOG_MANAGER must redirect to /itsm/dashboard/catalog-manager"
  );

  // All 6 existing roles preserved
  assert.ok(source.includes('case "REQUESTER":'));
  assert.ok(source.includes('case "SERVICE_AGENT":'));
  assert.ok(source.includes('case "INCIDENT_MANAGER":'));
  assert.ok(source.includes('case "PROCESS_CHANGE_MANAGER":'));
  assert.ok(source.includes('case "PLATFORM_ADMINISTRATOR":'));
  assert.ok(source.includes('case "AUDITOR":'));
});

test("ITSM Catalog Manager workspace and Form Builder placeholder pages exist", () => {
  const dashboardPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/dashboard/catalog-manager/page.tsx"
  );
  assert.ok(fs.existsSync(dashboardPath), "Catalog Manager dashboard page must exist");
  const dashSource = fs.readFileSync(dashboardPath, "utf-8");

  assert.ok(dashSource.includes("Catalog Manager Workspace"), "Must display Catalog Manager Workspace header");
  assert.ok(
    dashSource.includes("/itsm/catalog-manager/studio") || dashSource.includes("/itsm/services"),
    "Must link to /itsm/catalog-manager/studio or /itsm/services"
  );
  assert.ok(
    dashSource.includes("/itsm/catalog-manager/form-builder"),
    "Must link to Form Builder placeholder"
  );
  assert.ok(dashSource.includes("/itsm/profile"), "Must link to profile");

  // Verify navigation cards are fully clickable across their entire area
  assert.ok(
    dashSource.includes('id="catalog-manager-studio-card"') &&
      dashSource.includes('id="catalog-manager-form-builder-card"') &&
      dashSource.includes('id="catalog-manager-profile-card"'),
    "Must have dedicated IDs for all navigation cards"
  );
  assert.ok(dashSource.includes("cursor-pointer"), "Navigation cards must have cursor-pointer");
  assert.ok(dashSource.includes("hover:border-[#6D28D9]"), "Navigation cards must have clear hover border state");
  assert.ok(dashSource.includes("hover:shadow-md"), "Navigation cards must have hover shadow");
  assert.ok(dashSource.includes("hover:-translate-y-0.5"), "Navigation cards must have hover elevation transform");

  // Verify Catalog Item summary cards on the Catalog Manager dashboard
  assert.ok(dashSource.includes('id="catalog-metrics-grid"'), "Must render catalog metrics grid");
  assert.ok(dashSource.includes('id="metric-card-total-offerings"'), "Must have Total Offerings card");
  assert.ok(dashSource.includes('id="metric-card-active-offerings"'), "Must have Active Offerings card");
  assert.ok(dashSource.includes('id="metric-card-inactive-offerings"'), "Must have Inactive Offerings card");
  assert.ok(dashSource.includes('id="metric-card-needs-attention"'), "Must have Needs Attention card");
  assert.ok(dashSource.includes('id="metric-total-offerings"'), "Must display total offerings metric");
  assert.ok(dashSource.includes('id="metric-active-offerings"'), "Must display active offerings metric");
  assert.ok(dashSource.includes('id="metric-inactive-offerings"'), "Must display inactive offerings metric");
  assert.ok(dashSource.includes('id="metric-needs-attention"'), "Must display needs attention metric");

  const formBuilderPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx"
  );
  assert.ok(fs.existsSync(formBuilderPath), "Form builder placeholder page must exist");
  const fbSource = fs.readFileSync(formBuilderPath, "utf-8");

  assert.ok(fbSource.includes("No-Code"), "Must describe No-Code capabilities");
  assert.ok(fbSource.includes("Prompt 3") || fbSource.includes("Step 2"), "Must indicate upcoming roadmap");
});

test("ITSM Login page supports CATALOG_MANAGER default redirect", () => {
  const loginPath = path.join(consoleDir, "src/app/itsm/login/page.tsx");
  assert.ok(fs.existsSync(loginPath), "Login page must exist");
  const source = fs.readFileSync(loginPath, "utf-8");

  assert.ok(source.includes('case "CATALOG_MANAGER":'), "Login must handle CATALOG_MANAGER role");
  assert.ok(
    source.includes('defaultRoute = "/itsm/dashboard/catalog-manager"'),
    "Login must route CATALOG_MANAGER to /itsm/dashboard/catalog-manager"
  );
});

test("ITSM Admin Portal User Management includes CATALOG_MANAGER option", () => {
  const userDetailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/admin-portal/users/[id]/page.tsx"
  );
  assert.ok(fs.existsSync(userDetailPath), "User detail page must exist");
  const detailSource = fs.readFileSync(userDetailPath, "utf-8");

  assert.ok(
    detailSource.includes('value: "CATALOG_MANAGER"'),
    "User detail must include CATALOG_MANAGER option"
  );
  assert.ok(
    detailSource.includes('label: "Catalog Manager"'),
    "User detail must label CATALOG_MANAGER as 'Catalog Manager'"
  );

  const usersPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/admin-portal/users/page.tsx"
  );
  assert.ok(fs.existsSync(usersPath), "Users page must exist");
  const usersSource = fs.readFileSync(usersPath, "utf-8");

  assert.ok(
    usersSource.includes('<option value="CATALOG_MANAGER">'),
    "Users filter must include CATALOG_MANAGER option"
  );
});
