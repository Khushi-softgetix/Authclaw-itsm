import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. Form Builder route exists, wraps in Suspense, and accepts item query parameter", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Form builder page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("<Suspense"), "Must wrap component in Suspense boundary for Next.js app router");
  assert.ok(source.includes('searchParams.get("item")'), "Must read item query parameter");
  assert.ok(source.includes("/itsm/catalog-manager/studio"), "Must provide navigation back to Catalog Studio");
});

test("2. Displays friendly empty state when no catalog item is selected", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes("Select a catalog item to configure its request form"),
    "Must show clear message when no catalog item is specified"
  );
  assert.ok(
    source.includes("Browse Catalog Items in Studio"),
    "Must link to Catalog Studio for item selection"
  );
});

test("3. Renders offering context header and metadata when catalog item is loaded", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("Configuring Request Form For"), "Must display target offering banner");
  assert.ok(source.includes("No-Code Form Question Builder"), "Must display Form Builder milestone title");
  assert.ok(source.includes("Back to Offering"), "Must provide link back to offering detail");
});

test("4. Displays empty questions state when offering has no questions configured", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("No questions configured yet"), "Must show empty questions state");
  assert.ok(
    source.includes("Add questions to define what information Requesters must provide"),
    "Must display explanatory guidance text"
  );
  assert.ok(source.includes("add-question-btn"), "Must have Add Question button in empty and non-empty states");
});

test("5. Supports all 6 required question types with visual badges and icons", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Check supported question types in meta config
  assert.ok(source.includes('"text"'), "Must support Short Text");
  assert.ok(source.includes('"textarea"'), "Must support Long Text");
  assert.ok(source.includes('"number"'), "Must support Number");
  assert.ok(source.includes('"dropdown"'), "Must support Dropdown");
  assert.ok(source.includes('"radio"'), "Must support Radio");
  assert.ok(source.includes('"multiselect"'), "Must support Multi-Select");

  assert.ok(source.includes("Short Text"), "Must display Short Text label");
  assert.ok(source.includes("Long Text"), "Must display Long Text label");
  assert.ok(source.includes("Dropdown"), "Must display Dropdown label");
  assert.ok(source.includes("Multi-Select"), "Must display Multi-Select label");
});

test("6. Question editor modal provides Question Label, Machine-Friendly Field Key, and Validation", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("question-editor-modal"), "Must have question editor modal");
  assert.ok(source.includes("modal-question-label-input"), "Must have Question Label input");
  assert.ok(source.includes("modal-field-key-input"), "Must have Internal Field Key input");
  assert.ok(source.includes("slugifyFieldKey"), "Must auto-slugify field key from question label");
  assert.ok(source.includes("^[a-z][a-z0-9_]*$"), "Must enforce safe field key format regex");
});

test("7. Options editor supports adding, editing, removing, and validating options for choice types", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("modal-new-option-input"), "Must have input for adding options");
  assert.ok(source.includes("modal-add-option-btn"), "Must have button to add options");
  assert.ok(source.includes("handleEditOption"), "Must support in-place option editing");
  assert.ok(source.includes("modal-option-input-"), "Must have editable option input fields");
  assert.ok(source.includes("handleRemoveOption"), "Must support removing options");
  assert.ok(source.includes("Option value cannot be empty."), "Must validate and reject empty options");
  assert.ok(source.includes("Option already exists."), "Must validate and reject duplicate options");
  assert.ok(!source.includes('["Option 1", "Option 2"]'), "Must NOT contain hardcoded Option 1 / Option 2 defaults");
});

test("8. Question card supports Move Up, Move Down, Edit, Duplicate, and Delete actions", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("handleMoveUp"), "Must support Move Up action");
  assert.ok(source.includes("handleMoveDown"), "Must support Move Down action");
  assert.ok(source.includes("handleOpenEditModal"), "Must support Edit action");
  assert.ok(source.includes("handleDuplicateQuestion"), "Must support Duplicate action");
  assert.ok(source.includes("deletingIndex"), "Must track question index for deletion confirmation");
});

test("9. Delete question enforces explicit confirmation dialog", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("delete-confirm-modal"), "Must display delete confirmation modal");
  assert.ok(source.includes("Delete this question?"), "Must have delete confirmation title");
  assert.ok(
    source.includes("Removing this question will remove it from the catalog item"),
    "Must explain consequence of question removal"
  );
  assert.ok(source.includes("confirm-delete-btn"), "Must have confirmation action button");
});

test("10. Right column provides Live Requester Preview foundation", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("Requester Live Preview"), "Must have Requester Live Preview header");
  assert.ok(source.includes("How questions will render on the request submission form"), "Must describe preview intent");
  assert.ok(source.includes("Total Form Questions:"), "Must display total questions count in summary");
  assert.ok(source.includes("Required Questions:"), "Must display required questions count in summary");
});

test("11. Form saving persists to existing catalog item intake_schema via PATCH and preserves metadata", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("save-form-button"), "Must provide Save Form button");
  assert.ok(source.includes('method: "PATCH"'), "Must update item via PATCH");
  assert.ok(source.includes("/api/itsm/admin/service-catalog/"), "Must persist to admin service-catalog endpoint");
  assert.ok(source.includes("intake_schema: updatedIntakeSchema"), "Must update intake_schema payload");
  assert.ok(source.includes("...rawIntakeSchema"), "Must preserve existing schema root fields non-destructively");
});

test("12. Unsaved changes tracking warns user and shows status indicator", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("You have unsaved changes"), "Must display unsaved changes badge");
  assert.ok(source.includes("beforeunload"), "Must listen to beforeunload event to prevent data loss");
  assert.ok(source.includes("handleSafeNavigate"), "Must prompt before leaving page with unsaved edits");
});

test("13. New Dropdown, Radio, and Multi-Select questions start with zero options", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Verify modalQuestion initializes with empty options array
  assert.ok(source.includes("options: []"), "Modal question state must initialize options to an empty array");
  assert.ok(!source.includes('"Option 1"'), "Option 1 must never be hardcoded in form builder");
  assert.ok(!source.includes('"Option 2"'), "Option 2 must never be hardcoded in form builder");
  assert.ok(source.includes("configured"), "Must display number of configured options");
});

test("14. Options list renders editable input fields for in-place option editing", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Verify option list renders <input> with handleEditOption instead of static <span>
  assert.ok(source.includes("handleEditOption(optIdx, e.target.value)"), "Must update option on text change");
  assert.ok(source.includes('placeholder="Option text..."'), "Must provide clean placeholder for option input");
  assert.ok(source.includes("id={`modal-option-input-${optIdx}`}"), "Must assign unique ID to each option input");
});

test("15. Switching question types preserves intentionally configured options and does not inject fake options", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Verify type switch button keeps modalQuestion.options || []
  assert.ok(
    source.includes("options: modalQuestion.options || []"),
    "Type switch must preserve existing options and never populate fake defaults"
  );
});

test("16. Requester live preview renders only actual configured options and avoids fake options", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("No options configured yet."), "Must show empty placeholder when 0 options configured");
  assert.ok(!source.includes("Option 1"), "Preview must never contain Option 1");
  assert.ok(!source.includes("Option 2"), "Preview must never contain Option 2");
});

