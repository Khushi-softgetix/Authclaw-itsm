import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const consoleDir = path.resolve(__dirname, "..");

test("BFF routes whitelist CMDB-005 CI import dry-run and commit endpoints while retaining standard CI creation 201 status", () => {
  // Standard CI creation
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/configuration-items"), {
    backendPath: "/v1/itsm/admin/configuration-items",
    body: "json",
    status: 201,
  });

  // CMDB-005 Dry-Run Import endpoint
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/configuration-items/import/dry-run"), {
    backendPath: "/v1/itsm/admin/configuration-items/import/dry-run",
    body: "json",
    status: undefined,
  });

  // CMDB-005 Commit Import endpoint
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/configuration-items/import/commit"), {
    backendPath: "/v1/itsm/admin/configuration-items/import/commit",
    body: "json",
    status: undefined,
  });

  // External connectors or non-approved CMDB paths remain blocked
  assert.equal(resolveBffRoute("POST", "itsm/admin/configuration-items/import/external-connector"), null);
  assert.equal(resolveBffRoute("POST", "itsm/admin/configuration-items/api-keys"), null);
  assert.equal(resolveBffRoute("GET", "itsm/admin/cmdb-connectors"), null);
});

test("Configuration Items page at /itsm/admin-portal/configuration-items integrates 'Import CIs' workflow", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/configuration-items/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Configuration Items page must exist");

  const source = fs.readFileSync(pagePath, "utf-8");
  assert.ok(source.includes("Import CIs"), "Page must contain 'Import CIs' action button");
  assert.ok(source.includes("CIImportModal"), "Page must mount CIImportModal component");
  assert.ok(source.includes("setImportModalOpen"), "Page must manage import modal visibility state");
});

test("CIImportModal component implements the CMDB-005 4-step import lifecycle", () => {
  const modalPath = path.join(consoleDir, "src/components/itsm/ci-import-modal.tsx");
  assert.ok(fs.existsSync(modalPath), "CIImportModal component file must exist");

  const source = fs.readFileSync(modalPath, "utf-8");

  // Title and capabilities
  assert.ok(source.includes("Bulk CI Import (CMDB-005)"), "Must identify CMDB-005 feature");
  assert.ok(source.includes("Sample CSV"), "Must provide sample CSV download");
  assert.ok(source.includes("Sample JSON"), "Must provide sample JSON download");

  // Formats supported
  assert.ok(source.includes(".csv") && source.includes(".json"), "Must restrict to CSV and JSON formats");

  // Field mapping
  assert.ok(source.includes("autoDetectField"), "Must support automatic field detection");
  assert.ok(source.includes("CI Name (Required)"), "Must require CI Name field mapping");
  assert.ok(source.includes("CI Class / Type (Required)"), "Must require CI Type/Class field mapping");

  // API endpoints
  assert.ok(source.includes("/api/itsm/admin/configuration-items/import/dry-run"), "Must call BFF dry-run endpoint");
  assert.ok(source.includes("/api/itsm/admin/configuration-items/import/commit"), "Must call BFF commit endpoint");

  // Reconciliation & Error Queue
  assert.ok(source.includes("Update existing CIs"), "Must provide update existing CIs toggle");
  assert.ok(source.includes("downloadErrorQueueCSV") || source.includes("Download Error Queue"), "Must provide error queue export");
});
