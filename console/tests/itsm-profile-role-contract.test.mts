import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("ITSM Profile page is role-aware with dynamic titles and entitlement labels", () => {
  const profilePath = path.join(consoleDir, "src/app/(console)/itsm/profile/page.tsx");
  assert.ok(fs.existsSync(profilePath), "Profile page must exist at src/app/(console)/itsm/profile/page.tsx");
  const source = fs.readFileSync(profilePath, "utf-8");

  // Verify that the title is dynamic and not hardcoded to Requester Profile
  assert.ok(source.includes("getRoleProfileTitle"), "Must define getRoleProfileTitle helper");
  assert.ok(source.includes("getRoleSubtitle"), "Must define getRoleSubtitle helper");
  assert.ok(source.includes("getProductEntitlement"), "Must define getProductEntitlement helper");

  // Verify required role mappings for titles
  assert.ok(source.includes('"Requester Profile"'), "Must support 'Requester Profile'");
  assert.ok(source.includes('"Service Agent Profile"'), "Must support 'Service Agent Profile'");
  assert.ok(source.includes('"Incident Manager Profile"'), "Must support 'Incident Manager Profile'");
  assert.ok(source.includes('"Problem and Change Manager Profile"'), "Must support 'Problem and Change Manager Profile'");
  assert.ok(source.includes('"Platform Administrator Profile"'), "Must support 'Platform Administrator Profile'");
  assert.ok(source.includes('"Auditor Profile"'), "Must support 'Auditor Profile'");
  assert.ok(source.includes('"Catalog Manager Profile"'), "Must support 'Catalog Manager Profile'");

  // Verify role key checks
  assert.ok(source.includes('"REQUESTER"'), "Must handle REQUESTER role");
  assert.ok(source.includes('"SERVICE_AGENT"'), "Must handle SERVICE_AGENT role");
  assert.ok(source.includes('"INCIDENT_MANAGER"'), "Must handle INCIDENT_MANAGER role");
  assert.ok(source.includes('"PROCESS_CHANGE_MANAGER"'), "Must handle PROCESS_CHANGE_MANAGER role");
  assert.ok(source.includes('"PLATFORM_ADMINISTRATOR"'), "Must handle PLATFORM_ADMINISTRATOR role");
  assert.ok(source.includes('"AUDITOR"'), "Must handle AUDITOR role");
  assert.ok(source.includes('"ITSM_AUDITOR"'), "Must handle ITSM_AUDITOR role");
  assert.ok(source.includes('"CATALOG_MANAGER"'), "Must handle CATALOG_MANAGER role");

  // Verify Product Entitlement is neutral for non-requesters
  assert.ok(source.includes('"AuthClaw ITSM"'), "Must display neutral 'AuthClaw ITSM' for non-requesters");
  assert.ok(
    source.includes('role?.toUpperCase() === "REQUESTER"') || source.includes('role === "REQUESTER"'),
    "Must only show Requester Self-Service when role is REQUESTER"
  );

  // Verify element IDs for verification
  assert.ok(source.includes('id="profile-role-title"'), "Header must have profile-role-title ID");
  assert.ok(source.includes('id="profile-role-subtitle"'), "Header must have profile-role-subtitle ID");
  assert.ok(source.includes('id="profile-product-entitlement"'), "Entitlement must have profile-product-entitlement ID");

  // Verify existing identity details are preserved
  assert.ok(source.includes("Email Address"), "Must preserve Email Address");
  assert.ok(source.includes("ITSM Role"), "Must preserve ITSM Role");
  assert.ok(source.includes("Account Status"), "Must preserve Account Status");
  assert.ok(source.includes("Tenant Identifier"), "Must preserve Tenant Identifier");
  assert.ok(source.includes("Authentication Protocol"), "Must preserve Authentication Protocol");
  assert.ok(source.includes("Session Protection"), "Must preserve Session Protection");
  assert.ok(source.includes("Sign Out"), "Must preserve Sign Out button");
});
