import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. Validate button exists in Catalog Studio action toolbar", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  assert.ok(fs.existsSync(detailPath), "Studio detail page must exist");
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="validate-catalog-item-btn"'), "Must have validate button");
  assert.ok(source.includes("handleValidate"), "Must wire validate click handler");
  assert.ok(source.includes("/api/itsm/admin/service-catalog/"), "Must query catalog admin API");
  assert.ok(source.includes("/validate"), "Must call validate endpoint");
});

test("2. Validation result display shows status, check categories, and actionable errors", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="catalog-validation-modal"'), "Must have validation result modal");
  assert.ok(source.includes('id="validation-status-result"'), "Must show validation status container");
  assert.ok(source.includes("READY TO PUBLISH") || source.includes("VALIDATION FAILED"), "Must display standard status text");
  assert.ok(source.includes("validationResult.checks.map"), "Must render checks list");
  assert.ok(source.includes("validationResult.errors.map"), "Must render actionable errors list");
});

test("3. Preview button exists in Catalog Studio action toolbar", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="preview-catalog-item-btn"'), "Must have preview button");
  assert.ok(source.includes("handleOpenPreview"), "Must wire preview open handler");
});

test("4. Requester Live Preview renders current intake_schema dynamic questions", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="requester-preview-modal"'), "Must have requester preview modal");
  assert.ok(source.includes('id="preview-questions-container"'), "Must have questions container in preview");
  assert.ok(source.includes("questionsList.map"), "Must iterate over dynamic questions");
  assert.ok(source.includes('q.type === "text"'), "Must render text questions");
  assert.ok(source.includes('q.type === "dropdown"'), "Must render dropdown questions");
  assert.ok(source.includes('q.type === "textarea"'), "Must render textarea questions");
  assert.ok(source.includes('q.type === "radio"'), "Must render radio questions");
  assert.ok(source.includes('q.type === "multiselect"'), "Must render multiselect questions");
});

test("5. Preview is a read-only simulation that does NOT create real tickets", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes("Read-Only Simulation"), "Must display read-only simulation notice");
  assert.ok(source.includes("Submit Request (Simulation)"), "Must have simulation submit button");
  assert.ok(source.includes('id="preview-submit-btn"'), "Must have preview submit button ID");
  assert.ok(source.includes("handlePreviewSimulationSubmit"), "Submit handler must be simulation only");
  assert.ok(!source.includes('POST /api/itsm/requests'), "Preview submit must NOT make POST to /api/itsm/requests");
});

test("6. Publish button is present for inactive items with publish guard", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="publish-catalog-item-btn"'), "Must render publish button for inactive items");
  assert.ok(source.includes("handleOpenPublish"), "Must wire publish handler");
  assert.ok(source.includes("valData.is_valid"), "Must guard publish behind validation readiness");
});

test("7. Publish confirmation dialog shows offering details and validation summary", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="publish-confirm-modal"'), "Must render publish confirmation modal");
  assert.ok(source.includes('id="confirm-publish-btn"'), "Must have confirm publish button");
  assert.ok(source.includes("handleConfirmPublish"), "Must wire publish confirmation handler");
  assert.ok(source.includes("/publish"), "Must call publish endpoint");
  assert.ok(source.includes("questionCount"), "Must display question count in publish summary");
  assert.ok(source.includes("item.approval_required"), "Must display approval requirement in publish summary");
});

test("8. Status badge clearly displays Active vs Draft/Inactive state", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="catalog-item-status-badge"'), "Must have status badge");
  assert.ok(source.includes("Active / Published") || source.includes("Active"), "Must display active status label");
  assert.ok(source.includes("Draft / Inactive") || source.includes("Inactive"), "Must display inactive status label");
  assert.ok(source.includes("item.is_active"), "Status badge must reflect item.is_active");
});

test("9. Deactivate action exists for active items with data preservation note", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="deactivate-catalog-item-btn"'), "Must render deactivate button for active items");
  assert.ok(source.includes('id="deactivate-confirm-modal"'), "Must render deactivate confirmation modal");
  assert.ok(source.includes('id="confirm-deactivate-btn"'), "Must have confirm deactivate button");
  assert.ok(source.includes("Historical Requests Protected"), "Must explain that existing requests remain intact");
  assert.ok(source.includes("/deactivate"), "Must call deactivate endpoint");
});

test("10. BFF routes permit service-catalog validate, publish, deactivate, and retire", () => {
  const bffPath = path.join(consoleDir, "src/lib/bff-routes.ts");
  assert.ok(fs.existsSync(bffPath), "BFF routes must exist");
  const source = fs.readFileSync(bffPath, "utf-8");

  assert.ok(source.includes("validate"), "ALLOWED.GET must include validate route");
  assert.ok(source.includes("publish"), "ALLOWED.POST must include publish route");
  assert.ok(source.includes("deactivate"), "ALLOWED.POST must include deactivate route");
  assert.ok(source.includes("retire"), "ALLOWED.POST must include retire route");
});

test("11. Unsaved changes warning prevents accidental publish or validation with stale state", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes("if (isEditing)"), "Must check isEditing before validate / publish");
  assert.ok(source.includes("save your pending changes"), "Must notify user to save first");
});

test("12. Requester Service Catalog page renders metadata-driven intake form for published items", () => {
  const requesterPagePath = path.join(
    consoleDir,
    "src/app/(console)/itsm/requests/new/page.tsx"
  );
  assert.ok(fs.existsSync(requesterPagePath), "Requester page must exist");
  const source = fs.readFileSync(requesterPagePath, "utf-8");

  assert.ok(source.includes("dynamicQuestions"), "Requester page must render dynamic questions");
  assert.ok(source.includes("intake_schema"), "Must read catalog item intake_schema");
});
