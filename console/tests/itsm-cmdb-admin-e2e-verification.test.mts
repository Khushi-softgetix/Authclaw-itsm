import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

// 1. Role Definitions & Labels Verification
test("ITSM Shell and Profile provide dedicated CMDB_ADMIN role definition and correct labels", () => {
  const consoleShellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  assert.ok(fs.existsSync(consoleShellPath), "ConsoleShell must exist");
  const consoleShellSource = fs.readFileSync(consoleShellPath, "utf-8");

  // Verify label mapping
  assert.ok(
    consoleShellSource.includes('CMDB_ADMIN: "CMDB Admin"'),
    "ConsoleShell must map CMDB_ADMIN to 'CMDB Admin'"
  );

  // Verify all 8 ITSM role labels exist
  const expectedRoles = [
    "REQUESTER",
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "AUDITOR",
    "CATALOG_MANAGER",
    "CMDB_ADMIN",
  ];
  for (const role of expectedRoles) {
    assert.ok(
      consoleShellSource.includes(`${role}:`),
      `ConsoleShell must contain role mapping for ${role}`
    );
  }

  // Profile page verification
  const profilePath = path.join(consoleDir, "src/app/(console)/itsm/profile/page.tsx");
  assert.ok(fs.existsSync(profilePath), "ITSM Profile page must exist");
  const profileSource = fs.readFileSync(profilePath, "utf-8");
  assert.ok(
    profileSource.includes('"CMDB_ADMIN"') && profileSource.includes('"CMDB Admin"'),
    "Profile page must recognize CMDB_ADMIN role and map to 'CMDB Admin'"
  );
  assert.ok(
    profileSource.includes('"CMDB_ADMIN"') && profileSource.includes('return "CA";'),
    "Profile page must define 'CA' initials for CMDB_ADMIN"
  );
});

// 2. Portal Navigation Isolation for CMDB_ADMIN
test("AdminPortalShell and ConsoleShell isolate navigation strictly for CMDB_ADMIN", () => {
  const adminShellPath = path.join(consoleDir, "src/components/admin-portal-shell.tsx");
  const adminShellSource = fs.readFileSync(adminShellPath, "utf-8");

  // Filter definition
  assert.ok(
    adminShellSource.includes('const isCmdbAdmin = itsmRole?.toUpperCase() === "CMDB_ADMIN";'),
    "AdminPortalShell must check isCmdbAdmin"
  );
  assert.ok(
    adminShellSource.includes(
      "const effectiveAdminNavigation = isCmdbAdmin\n    ? adminNavigation.filter((item) => item.name === \"Configuration Items\")\n    : adminNavigation;"
    ),
    "AdminPortalShell must filter down to only Configuration Items for CMDB_ADMIN"
  );

  // Hidden admin sections for CMDB_ADMIN
  const restrictedSections = [
    "Users",
    "Teams",
    "Services",
    "Service Catalog",
    "SLA Configuration",
    "Macros & Templates",
    "Settings",
  ];
  for (const section of restrictedSections) {
    assert.ok(
      adminShellSource.includes(`name: "${section}"`),
      `Admin navigation catalog must include ${section}`
    );
  }

  // ConsoleShell navigation list for CMDB_ADMIN
  const consoleShellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  const consoleShellSource = fs.readFileSync(consoleShellPath, "utf-8");
  assert.ok(
    consoleShellSource.includes("const cmdbAdminNavigation: NavItem[] = ["),
    "ConsoleShell must have dedicated cmdbAdminNavigation"
  );
  assert.ok(
    consoleShellSource.includes('effectiveItsmRole === "CMDB_ADMIN"'),
    "ConsoleShell must activate cmdbAdminNavigation when role is CMDB_ADMIN"
  );
});

// 3. Server Route Guards Verification
test("AdminPortalLayout strictly enforces route guards between CMDB_ADMIN and PLATFORM_ADMINISTRATOR", () => {
  const layoutPath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/layout.tsx");
  assert.ok(fs.existsSync(layoutPath), "AdminPortalLayout must exist");
  const layoutSource = fs.readFileSync(layoutPath, "utf-8");

  // CMDB_ADMIN restricted to configuration-items workspace
  assert.ok(
    layoutSource.includes('if (itsmRole === "CMDB_ADMIN") {'),
    "Layout must check CMDB_ADMIN role"
  );
  assert.ok(
    layoutSource.includes('!currentPath.startsWith("/itsm/admin-portal/configuration-items")'),
    "Layout must verify path begins with /itsm/admin-portal/configuration-items"
  );
  assert.ok(
    layoutSource.includes('redirect("/itsm/admin-portal/configuration-items");'),
    "Layout must redirect CMDB_ADMIN back to configuration-items workspace when attempting unauthorized admin sections"
  );

  // Non-admins blocked completely
  assert.ok(
    layoutSource.includes('redirect("/itsm/incidents?error=admin_required");'),
    "Layout must redirect unauthorized non-admins to /itsm/incidents?error=admin_required"
  );
});

// 4. BFF Routes Contract Verification for CMDB Operations
test("BFF routes whitelist all CMDB Configuration Item and Relationship endpoints with correct HTTP semantics", async () => {
  const bffModule = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });
  const { resolveBffRoute } = bffModule;

  // 1. GET Configuration Items
  const getCIs = resolveBffRoute("GET", "itsm/admin/configuration-items");
  assert.ok(getCIs, "GET itsm/admin/configuration-items must resolve");
  assert.equal(getCIs.backendPath, "/v1/itsm/admin/configuration-items");
  assert.equal(getCIs.body, "none");

  // 2. POST Configuration Items (201 Created)
  const postCI = resolveBffRoute("POST", "itsm/admin/configuration-items");
  assert.ok(postCI, "POST itsm/admin/configuration-items must resolve");
  assert.equal(postCI.backendPath, "/v1/itsm/admin/configuration-items");
  assert.equal(postCI.body, "json");
  assert.equal(postCI.status, 201);

  // 3. PATCH Configuration Items
  const patchCI = resolveBffRoute("PATCH", "itsm/admin/configuration-items/123e4567-e89b-12d3-a456-426614174000");
  assert.ok(patchCI, "PATCH itsm/admin/configuration-items/:id must resolve");
  assert.equal(patchCI.backendPath, "/v1/itsm/admin/configuration-items/123e4567-e89b-12d3-a456-426614174000");
  assert.equal(patchCI.body, "json");

  // 4. Import Dry-Run (POST, 200)
  const dryRun = resolveBffRoute("POST", "itsm/admin/configuration-items/import/dry-run");
  assert.ok(dryRun, "POST import/dry-run must resolve");
  assert.equal(dryRun.backendPath, "/v1/itsm/admin/configuration-items/import/dry-run");
  assert.equal(dryRun.body, "json");
  assert.equal(dryRun.status, undefined); // 200 OK

  // 5. Import Commit (POST, 200)
  const commit = resolveBffRoute("POST", "itsm/admin/configuration-items/import/commit");
  assert.ok(commit, "POST import/commit must resolve");
  assert.equal(commit.backendPath, "/v1/itsm/admin/configuration-items/import/commit");
  assert.equal(commit.body, "json");
  assert.equal(commit.status, undefined); // 200 OK

  // 6. GET CI Relationships
  const getRels = resolveBffRoute("GET", "itsm/admin/configuration-items/123e4567-e89b-12d3-a456-426614174000/relationships");
  assert.ok(getRels, "GET CI relationships must resolve");
  assert.equal(getRels.backendPath, "/v1/itsm/admin/configuration-items/123e4567-e89b-12d3-a456-426614174000/relationships");
  assert.equal(getRels.body, "none");

  // 7. POST CI Relationships (201 Created)
  const postRel = resolveBffRoute("POST", "itsm/admin/configuration-items/relationships");
  assert.ok(postRel, "POST relationships must resolve");
  assert.equal(postRel.backendPath, "/v1/itsm/admin/configuration-items/relationships");
  assert.equal(postRel.body, "json");
  assert.equal(postRel.status, 201);

  // 8. DELETE CI Relationships (204 No Content)
  const delRel = resolveBffRoute("DELETE", "itsm/admin/configuration-items/relationships/123e4567-e89b-12d3-a456-426614174000");
  assert.ok(delRel, "DELETE relationship must resolve");
  assert.equal(delRel.backendPath, "/v1/itsm/admin/configuration-items/relationships/123e4567-e89b-12d3-a456-426614174000");
  assert.equal(delRel.status, 204);

  // 9. Canonical /ci-relationships endpoints
  const getCanon = resolveBffRoute("GET", "itsm/admin/ci-relationships");
  assert.ok(getCanon, "GET ci-relationships must resolve");
  assert.equal(getCanon.body, "none");

  const postCanon = resolveBffRoute("POST", "itsm/admin/ci-relationships");
  assert.ok(postCanon, "POST ci-relationships must resolve");
  assert.equal(postCanon.status, 201);

  const delCanon = resolveBffRoute("DELETE", "itsm/admin/ci-relationships/123e4567-e89b-12d3-a456-426614174000");
  assert.ok(delCanon, "DELETE ci-relationships must resolve");
  assert.equal(delCanon.status, 204);
});

// 5. Configuration Items Workspace & Modal Integrations
test("Configuration Items page integrates Create, Edit, Import, and CI Relationships modals", () => {
  const ciPagePath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/configuration-items/page.tsx");
  assert.ok(fs.existsSync(ciPagePath), "Configuration Items page must exist");
  const ciPageSource = fs.readFileSync(ciPagePath, "utf-8");

  // Modal integrations
  assert.ok(
    ciPageSource.includes("CIRelationshipsModal"),
    "CI workspace must integrate CIRelationshipsModal"
  );
  assert.ok(
    ciPageSource.includes("CIImportModal"),
    "CI workspace must integrate CIImportModal"
  );
  assert.ok(
    ciPageSource.includes("setRelationshipsCi"),
    "CI workspace must manage setRelationshipsCi state"
  );

  // UI state handling
  assert.ok(
    ciPageSource.includes("isLoading") || ciPageSource.includes("loading"),
    "CI workspace must handle loading state"
  );
  assert.ok(
    ciPageSource.includes("error"),
    "CI workspace must handle error state"
  );
  assert.ok(
    ciPageSource.includes("No configuration items yet"),
    "CI workspace must provide clear empty state"
  );
});

// 6. CI Relationships Modal Component Requirements
test("CIRelationshipsModal component implements supported relationship types and directional filters", () => {
  const modalPath = path.join(consoleDir, "src/components/itsm/ci-relationships-modal.tsx");
  assert.ok(fs.existsSync(modalPath), "CIRelationshipsModal component must exist");
  const modalSource = fs.readFileSync(modalPath, "utf-8");

  // Supported relationship types
  const expectedTypes = [
    "DEPENDS_ON",
    "RUNS_ON",
    "HOSTED_ON",
    "CONNECTS_TO",
    "OWNED_BY",
    "SUPPORTS",
    "PART_OF",
  ];
  for (const t of expectedTypes) {
    assert.ok(
      modalSource.includes(t),
      `CIRelationshipsModal must support relationship type ${t}`
    );
  }

  // Direction filter buttons
  assert.ok(
    modalSource.includes("upstream"),
    "CIRelationshipsModal must support upstream filter"
  );
  assert.ok(
    modalSource.includes("downstream"),
    "CIRelationshipsModal must support downstream filter"
  );
  assert.ok(
    modalSource.includes("directionTab"),
    "CIRelationshipsModal must support direction tab filtering"
  );

  // Direction semantics for creation
  assert.ok(
    modalSource.includes("current_is_parent"),
    "Must support Current CI as parent"
  );
  assert.ok(
    modalSource.includes("target_is_parent"),
    "Must support Target CI as parent"
  );

  // Deletion support
  assert.ok(
    modalSource.includes("handleDeleteRelationship"),
    "CIRelationshipsModal must provide relationship deletion capability"
  );
});
