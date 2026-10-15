import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

// 1. CMDB_ADMIN sees Configuration Items navigation link
test("CMDB_ADMIN sees the Configuration Items navigation link in ConsoleShell and AdminPortalShell", () => {
  const consoleShellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  assert.ok(fs.existsSync(consoleShellPath), "ConsoleShell must exist");
  const consoleShellSource = fs.readFileSync(consoleShellPath, "utf-8");

  // ConsoleShell navigation definition
  assert.ok(
    consoleShellSource.includes("const cmdbAdminNavigation: NavItem[] = ["),
    "ConsoleShell must define cmdbAdminNavigation"
  );
  assert.ok(
    consoleShellSource.includes('name: "Configuration Items", href: "/itsm/admin-portal/configuration-items"'),
    "ConsoleShell must link CMDB Admin to /itsm/admin-portal/configuration-items"
  );
  assert.ok(
    consoleShellSource.includes('effectiveItsmRole === "CMDB_ADMIN"'),
    "ConsoleShell must activate cmdbAdminNavigation for CMDB_ADMIN role"
  );

  // AdminPortalShell navigation definition
  const adminShellPath = path.join(consoleDir, "src/components/admin-portal-shell.tsx");
  assert.ok(fs.existsSync(adminShellPath), "AdminPortalShell must exist");
  const adminShellSource = fs.readFileSync(adminShellPath, "utf-8");

  assert.ok(
    adminShellSource.includes('const isCmdbAdmin = itsmRole?.toUpperCase() === "CMDB_ADMIN";'),
    "AdminPortalShell must detect CMDB_ADMIN role"
  );
  assert.ok(
    adminShellSource.includes('item.name === "Configuration Items"'),
    "AdminPortalShell must preserve Configuration Items in effective navigation for CMDB_ADMIN"
  );
});

// 2. CMDB_ADMIN does not see unrelated administration links
test("CMDB_ADMIN does not see unrelated administration links", () => {
  const adminShellPath = path.join(consoleDir, "src/components/admin-portal-shell.tsx");
  const adminShellSource = fs.readFileSync(adminShellPath, "utf-8");

  // Effective navigation strictly filters down to Configuration Items for CMDB_ADMIN
  assert.ok(
    adminShellSource.includes(
      "const effectiveAdminNavigation = isCmdbAdmin\n    ? adminNavigation.filter((item) => item.name === \"Configuration Items\")\n    : adminNavigation;"
    ),
    "AdminPortalShell must strictly filter navigation to only Configuration Items for CMDB_ADMIN"
  );

  // Header and logo branding are role-aware
  assert.ok(
    adminShellSource.includes('{isCmdbAdmin ? "CMDB Administration" : "Administration"}'),
    "Sidebar section header must reflect CMDB Administration for CMDB_ADMIN"
  );
  assert.ok(
    adminShellSource.includes('{isCmdbAdmin ? "CMDB Administration" : "Platform Administration"}'),
    "Logo and header must display CMDB Administration for CMDB_ADMIN"
  );

  // ConsoleShell CMDB nav does not contain operational or admin links
  const consoleShellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  const consoleShellSource = fs.readFileSync(consoleShellPath, "utf-8");
  const cmdbNavMatch = consoleShellSource.match(/const cmdbAdminNavigation: NavItem\[\] = \[\s*([\s\S]*?)\s*\];/);
  assert.ok(cmdbNavMatch, "Must find cmdbAdminNavigation definition");
  const cmdbNavContent = cmdbNavMatch[1];
  assert.ok(!cmdbNavContent.includes("/itsm/admin-portal/users"), "CMDB nav must not link to Users");
  assert.ok(!cmdbNavContent.includes("/itsm/admin-portal/teams"), "CMDB nav must not link to Teams");
  assert.ok(!cmdbNavContent.includes("/itsm/admin-portal/settings"), "CMDB nav must not link to Settings");
  assert.ok(!cmdbNavContent.includes("/itsm/incidents"), "CMDB nav must not link to Incidents");
});

// 3. CMDB_ADMIN can open Configuration Items route
test("CMDB_ADMIN can open the Configuration Items route", () => {
  const adminLayoutPath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/layout.tsx");
  assert.ok(fs.existsSync(adminLayoutPath), "AdminPortalLayout must exist");
  const adminLayoutSource = fs.readFileSync(adminLayoutPath, "utf-8");

  assert.ok(
    adminLayoutSource.includes('if (itsmRole === "CMDB_ADMIN")'),
    "AdminPortalLayout must handle CMDB_ADMIN"
  );
  assert.ok(
    adminLayoutSource.includes('currentPath.startsWith("/itsm/admin-portal/configuration-items")'),
    "AdminPortalLayout must allow CMDB_ADMIN on configuration-items path"
  );

  const consoleLayoutPath = path.join(consoleDir, "src/app/(console)/layout.tsx");
  assert.ok(fs.existsSync(consoleLayoutPath), "ConsoleLayout must exist");
  const consoleLayoutSource = fs.readFileSync(consoleLayoutPath, "utf-8");

  assert.ok(
    consoleLayoutSource.includes('redirect("/itsm/admin-portal/configuration-items")'),
    "ConsoleLayout must route CMDB_ADMIN to configuration-items"
  );

  const ciPagePath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/configuration-items/page.tsx");
  assert.ok(fs.existsSync(ciPagePath), "Configuration Items page component must exist");
});

// 4. CMDB_ADMIN is denied access to unrelated admin routes
test("CMDB_ADMIN is denied access to unrelated admin routes via server route guards", () => {
  const adminLayoutPath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/layout.tsx");
  const adminLayoutSource = fs.readFileSync(adminLayoutPath, "utf-8");

  // Verify that navigating to any admin-portal page other than configuration-items redirects to configuration-items
  assert.ok(
    adminLayoutSource.includes('if (itsmRole === "CMDB_ADMIN")') &&
      adminLayoutSource.includes('!currentPath.startsWith("/itsm/admin-portal/configuration-items")') &&
      adminLayoutSource.includes('redirect("/itsm/admin-portal/configuration-items")'),
    "AdminPortalLayout must redirect CMDB_ADMIN away from unrelated admin pages back to configuration-items"
  );

  const consoleLayoutPath = path.join(consoleDir, "src/app/(console)/layout.tsx");
  const consoleLayoutSource = fs.readFileSync(consoleLayoutPath, "utf-8");

  assert.ok(
    consoleLayoutSource.includes('itsmRole === "CMDB_ADMIN"') &&
      consoleLayoutSource.includes('!currentPath.startsWith("/itsm/admin-portal/configuration-items")') &&
      consoleLayoutSource.includes('redirect("/itsm/admin-portal/configuration-items")'),
    "ConsoleLayout must guard the admin portal against unauthorized CMDB_ADMIN access"
  );
});

// 5. PLATFORM_ADMINISTRATOR retains existing navigation and access
test("PLATFORM_ADMINISTRATOR retains full administrative navigation and access", () => {
  const adminShellPath = path.join(consoleDir, "src/components/admin-portal-shell.tsx");
  const adminShellSource = fs.readFileSync(adminShellPath, "utf-8");

  // Full adminNavigation items defined
  const expectedAdminItems = [
    "Users",
    "Teams",
    "Services",
    "Configuration Items",
    "Service Catalog",
    "SLA Configuration",
    "Macros & Templates",
    "Settings",
  ];
  for (const item of expectedAdminItems) {
    assert.ok(
      adminShellSource.includes(`name: "${item}"`),
      `adminNavigation must retain '${item}' for Platform Administrator`
    );
  }

  // PLATFORM_ADMINISTRATOR bypasses CMDB filter
  assert.ok(
    adminShellSource.includes("effectiveAdminNavigation = isCmdbAdmin\n    ? adminNavigation.filter"),
    "Non-CMDB_ADMIN (Platform Administrator) must receive the full unfiltered adminNavigation"
  );

  // Layout allows PLATFORM_ADMINISTRATOR
  const adminLayoutPath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/layout.tsx");
  const adminLayoutSource = fs.readFileSync(adminLayoutPath, "utf-8");
  assert.ok(
    adminLayoutSource.includes('else if (itsmRole !== "PLATFORM_ADMINISTRATOR")'),
    "AdminPortalLayout must permit PLATFORM_ADMINISTRATOR across all admin sections"
  );
});

// 6. Other existing roles retain their intended navigation and access
test("Other existing roles retain their intended navigation and access", () => {
  const consoleShellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  const consoleShellSource = fs.readFileSync(consoleShellPath, "utf-8");

  assert.ok(consoleShellSource.includes('effectiveItsmRole === "REQUESTER"'), "REQUESTER role mapping preserved");
  assert.ok(consoleShellSource.includes('effectiveItsmRole === "SERVICE_AGENT"'), "SERVICE_AGENT role mapping preserved");
  assert.ok(consoleShellSource.includes('effectiveItsmRole === "AUDITOR"'), "AUDITOR role mapping preserved");
  assert.ok(consoleShellSource.includes('effectiveItsmRole === "PROCESS_CHANGE_MANAGER"'), "PROCESS_CHANGE_MANAGER role mapping preserved");
  assert.ok(consoleShellSource.includes('effectiveItsmRole === "CATALOG_MANAGER"'), "CATALOG_MANAGER role mapping preserved");
  assert.ok(consoleShellSource.includes('effectiveItsmRole === "CMDB_ADMIN"'), "CMDB_ADMIN role mapping defined");

  // Verify role label mappings
  assert.ok(consoleShellSource.includes('REQUESTER: "Requester"'), "ITSM_ROLE_LABELS maps REQUESTER");
  assert.ok(consoleShellSource.includes('SERVICE_AGENT: "Service Agent"'), "ITSM_ROLE_LABELS maps SERVICE_AGENT");
  assert.ok(consoleShellSource.includes('INCIDENT_MANAGER: "Incident Manager"'), "ITSM_ROLE_LABELS maps INCIDENT_MANAGER");
  assert.ok(consoleShellSource.includes('PROCESS_CHANGE_MANAGER: "Problem and Change Manager"'), "ITSM_ROLE_LABELS maps PROCESS_CHANGE_MANAGER");
  assert.ok(consoleShellSource.includes('PLATFORM_ADMINISTRATOR: "Platform Administrator"'), "ITSM_ROLE_LABELS maps PLATFORM_ADMINISTRATOR");
  assert.ok(consoleShellSource.includes('AUDITOR: "Auditor"'), "ITSM_ROLE_LABELS maps AUDITOR");
  assert.ok(consoleShellSource.includes('CATALOG_MANAGER: "Catalog Manager"'), "ITSM_ROLE_LABELS maps CATALOG_MANAGER");
  assert.ok(consoleShellSource.includes('CMDB_ADMIN: "CMDB Admin"'), "ITSM_ROLE_LABELS maps CMDB_ADMIN");

  const dashPath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/page.tsx");
  const dashSource = fs.readFileSync(dashPath, "utf-8");
  assert.ok(dashSource.includes('case "REQUESTER":'), "Dashboard handles REQUESTER");
  assert.ok(dashSource.includes('case "SERVICE_AGENT":'), "Dashboard handles SERVICE_AGENT");
  assert.ok(dashSource.includes('case "PROCESS_CHANGE_MANAGER":'), "Dashboard handles PROCESS_CHANGE_MANAGER");
  assert.ok(dashSource.includes('case "AUDITOR":'), "Dashboard handles AUDITOR");
  assert.ok(dashSource.includes('case "CATALOG_MANAGER":'), "Dashboard handles CATALOG_MANAGER");
  assert.ok(dashSource.includes('case "PLATFORM_ADMINISTRATOR":'), "Dashboard handles PLATFORM_ADMINISTRATOR");
  assert.ok(dashSource.includes('case "CMDB_ADMIN":'), "Dashboard handles CMDB_ADMIN");
});

// 7. Loading, error, empty, and unauthorized states are handled correctly
test("Configuration Items page handles loading, error, modal, and breadcrumb states", () => {
  const ciPagePath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/configuration-items/page.tsx");
  const ciPageSource = fs.readFileSync(ciPagePath, "utf-8");

  // Loading state
  assert.ok(ciPageSource.includes("Loading configuration items..."), "Must handle loading state with message");
  assert.ok(ciPageSource.includes("Loader2"), "Must render loading spinner");

  // Error alert & retry
  assert.ok(ciPageSource.includes("AlertCircle"), "Must render error alert with AlertCircle icon");
  assert.ok(ciPageSource.includes("Retry"), "Must provide retry button on error");

  // Empty state
  assert.ok(ciPageSource.includes("No configuration items yet"), "Must handle empty state");
  assert.ok(ciPageSource.includes("Add Configuration Item"), "Must provide Add Configuration Item CTA on empty state");

  // Save modal error
  assert.ok(ciPageSource.includes("modalError &&"), "Must display modalError alert when validation or save fails");

  // CI Import modal integration
  assert.ok(ciPageSource.includes("<CIImportModal"), "Must embed CIImportModal for bulk import dry-run and commit");

  // Role-aware breadcrumb
  assert.ok(
    ciPageSource.includes('isCmdbAdmin ? "CMDB Administration" : "Platform Administration"'),
    "Breadcrumb must adapt label based on CMDB_ADMIN role"
  );
  assert.ok(
    ciPageSource.includes('isCmdbAdmin ? "/itsm/admin-portal/configuration-items" : "/itsm/admin-portal"'),
    "Breadcrumb must adapt destination link based on CMDB_ADMIN role"
  );
});
