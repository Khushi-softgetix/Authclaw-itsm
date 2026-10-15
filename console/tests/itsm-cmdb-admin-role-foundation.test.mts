import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("ITSM ConsoleShell provides dedicated CMDB_ADMIN role definition and label mapping", () => {
  const shellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  assert.ok(fs.existsSync(shellPath), "ConsoleShell component must exist");
  const source = fs.readFileSync(shellPath, "utf-8");

  // 1. Role label mapping
  assert.ok(
    source.includes('CMDB_ADMIN: "CMDB Admin"'),
    "ITSM_ROLE_LABELS must map CMDB_ADMIN to 'CMDB Admin'"
  );

  // 2. Dedicated navigation definition
  assert.ok(source.includes("cmdbAdminNavigation"), "Must define cmdbAdminNavigation");
  assert.ok(
    source.includes('name: "Configuration Items", href: "/itsm/admin-portal/configuration-items"'),
    "CMDB Admin nav must link to /itsm/admin-portal/configuration-items"
  );

  // 3. Role-aware active navigation selection
  assert.ok(
    source.includes('effectiveItsmRole === "CMDB_ADMIN"'),
    "ConsoleShell must conditionally check for CMDB_ADMIN role"
  );
});

test("AdminPortalShell filters navigation for CMDB_ADMIN hiding unauthorized admin sections", () => {
  const adminShellPath = path.join(consoleDir, "src/components/admin-portal-shell.tsx");
  assert.ok(fs.existsSync(adminShellPath), "AdminPortalShell component must exist");
  const source = fs.readFileSync(adminShellPath, "utf-8");

  // 1. CMDB Admin role detection
  assert.ok(
    source.includes('itsmRole?.toUpperCase() === "CMDB_ADMIN"'),
    "AdminPortalShell must detect CMDB_ADMIN role"
  );

  // 2. Navigation filtering
  assert.ok(
    source.includes('item.name === "Configuration Items"'),
    "AdminPortalShell must filter navigation to only Configuration Items for CMDB_ADMIN"
  );

  // 3. Label customization
  assert.ok(
    source.includes('"CMDB Administration" : "Platform Administration"') ||
      source.includes('"CMDB Administration" : "Administration"'),
    "AdminPortalShell must adjust header to CMDB Administration when user is CMDB_ADMIN"
  );
});

test("ITSM layout enforces CMDB_ADMIN route guards to the Configuration Items workspace", () => {
  const layoutPath = path.join(consoleDir, "src/app/(console)/layout.tsx");
  assert.ok(fs.existsSync(layoutPath), "Layout component must exist");
  const source = fs.readFileSync(layoutPath, "utf-8");

  assert.ok(
    source.includes('itsmRole === "CMDB_ADMIN"'),
    "Layout must check for CMDB_ADMIN role"
  );
  assert.ok(
    source.includes('redirect("/itsm/admin-portal/configuration-items")'),
    "Layout must redirect CMDB_ADMIN to /itsm/admin-portal/configuration-items"
  );
});

test("ITSM Dashboard and Login pages route CMDB_ADMIN to Configuration Items workspace", () => {
  const dashPath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/page.tsx");
  assert.ok(fs.existsSync(dashPath), "Dashboard root must exist");
  const dashSource = fs.readFileSync(dashPath, "utf-8");

  assert.ok(dashSource.includes('case "CMDB_ADMIN":'), "Dashboard must handle CMDB_ADMIN");
  assert.ok(
    dashSource.includes('redirect("/itsm/admin-portal/configuration-items")'),
    "Dashboard must redirect CMDB_ADMIN to /itsm/admin-portal/configuration-items"
  );

  const loginPath = path.join(consoleDir, "src/app/itsm/login/page.tsx");
  assert.ok(fs.existsSync(loginPath), "Login page must exist");
  const loginSource = fs.readFileSync(loginPath, "utf-8");

  assert.ok(loginSource.includes('case "CMDB_ADMIN":'), "Login must handle CMDB_ADMIN");
  assert.ok(
    loginSource.includes('defaultRoute = "/itsm/admin-portal/configuration-items"'),
    "Login must route CMDB_ADMIN to /itsm/admin-portal/configuration-items"
  );
});

test("ITSM Profile page provides role-aware CMDB Admin title, subtitle, initials, and badge", () => {
  const profilePath = path.join(consoleDir, "src/app/(console)/itsm/profile/page.tsx");
  assert.ok(fs.existsSync(profilePath), "Profile page must exist");
  const source = fs.readFileSync(profilePath, "utf-8");

  // Title & Subtitle
  assert.ok(source.includes('"CMDB Admin Profile"'), "Must display 'CMDB Admin Profile'");
  assert.ok(
    source.includes("managing Configuration Items, relationships, schemas, and imports"),
    "Must explain CMDB management scope in subtitle"
  );

  // Badge and Avatar
  assert.ok(source.includes('return "CMDB Admin";'), "Must return user-facing 'CMDB Admin' badge label");
  assert.ok(source.includes('case "CMDB_ADMIN":'), "Must handle CMDB_ADMIN avatar case");
  assert.ok(source.includes('return "CA";'), "Avatar initials for CMDB Admin must be 'CA'");
});

test("ITSM Admin Portal User Management includes CMDB_ADMIN across all role selection inputs", () => {
  const userDetailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/admin-portal/users/[id]/page.tsx"
  );
  assert.ok(fs.existsSync(userDetailPath), "User detail page must exist");
  const detailSource = fs.readFileSync(userDetailPath, "utf-8");

  assert.ok(
    detailSource.includes('value: "CMDB_ADMIN"'),
    "User detail must include CMDB_ADMIN option"
  );
  assert.ok(
    detailSource.includes('label: "CMDB Admin"'),
    "User detail must label CMDB_ADMIN as 'CMDB Admin'"
  );

  const usersPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/admin-portal/users/page.tsx"
  );
  assert.ok(fs.existsSync(usersPath), "Users page must exist");
  const usersSource = fs.readFileSync(usersPath, "utf-8");

  assert.ok(
    usersSource.includes('<option value="CMDB_ADMIN">'),
    "Users filter must include CMDB_ADMIN option"
  );
  assert.ok(
    usersSource.includes('<option value="CMDB_ADMIN">CMDB Admin (Configuration items & CMDB)</option>'),
    "Users manual and invite modals must include CMDB Admin option"
  );
});
