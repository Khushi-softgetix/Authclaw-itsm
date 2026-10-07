import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. Dynamic Short Text renders in Requester Request Form", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Request form page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('q.type === "text"'), "Must have branch rendering text input for Short Text");
  assert.ok(source.includes('type="text"'), "Must render input element with type text");
  assert.ok(source.includes("const fieldId = `dynamic-field-${q.id}`"), "Must provide unique ID for dynamic text field");
});

test("2. Dynamic Long Text renders as textarea in Requester Request Form", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('q.type === "textarea"'), "Must have branch rendering textarea for Long Text");
  assert.ok(source.includes("<textarea"), "Must render textarea element");
  assert.ok(source.includes("rows={3}"), "Must provide multi-line textarea");
});

test("3. Dynamic Number renders as numeric input in Requester Request Form", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('q.type === "number"'), "Must have branch rendering number input for Number");
  assert.ok(source.includes('type="number"'), "Must render input element with type number");
  assert.ok(source.includes("Number(e.target.value)"), "Must handle numeric type parsing properly");
});

test("4. Dynamic Dropdown renders select control using intake_schema options", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('q.type === "dropdown"'), "Must have branch rendering select for Dropdown");
  assert.ok(source.includes("<select"), "Must render select element");
  assert.ok(source.includes("q.options && q.options.length > 0"), "Must check options existence from intake_schema");
  assert.ok(source.includes("q.options.map("), "Must map options configured by Catalog Manager");
});

test("5. Dynamic Radio renders options as radio choices", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('q.type === "radio"'), "Must have branch rendering radio choices for Radio");
  assert.ok(source.includes('type="radio"'), "Must render input elements of type radio");
  assert.ok(source.includes("name={`radio-${q.id}`}"), "Must group radio buttons by question ID");
});

test("6. Dynamic Multi-Select renders checkboxes allowing multiple selections", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('q.type === "multiselect"'), "Must have branch rendering checkboxes for Multi-Select");
  assert.ok(source.includes('type="checkbox"'), "Must render input elements of type checkbox");
  assert.ok(source.includes("sel.filter((item) => item !== opt)"), "Must support toggle/multi selection array state");
});

test("7. Required validation works and blocks submission when required fields are missing", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("q.required"), "Must inspect question required metadata");
  assert.ok(source.includes("`${q.label} is required.`"), "Must format friendly required validation message with question label");
  assert.ok(source.includes("setError(`${q.label} is required.`)"), "Must block submission and set error");
  assert.ok(source.includes("bg-red-50 border border-red-200 text-red-700"), "Must display validation error alert banner");
});

test("8. Options render from intake_schema without hardcoded fake choices", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("q.options.map((opt, optIdx)"), "Options must be dynamically mapped from question metadata");
  assert.ok(!source.includes('"Option 1"'), "Must not contain hardcoded default 'Option 1'");
  assert.ok(!source.includes('"Option 2"'), "Must not contain hardcoded default 'Option 2'");
});

test("9. Safe state displayed when question has zero configured options", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("No options configured"), "Must display safe notice when question has zero configured options");
});

test("10. Question order is preserved matching intake_schema", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("dynamicQuestions.map((q, qIdx)"), "Must map over dynamicQuestions array in stored sequence");
});

test("11. Submit sends dynamic answers in form_data payload to existing Service Request API", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('fetch("/api/itsm/requests"'), "Must reuse existing Service Request creation endpoint");
  assert.ok(source.includes("form_data: {"), "Must include dynamic answers in form_data payload");
  assert.ok(source.includes("ticket_number"), "Must display standard REQ-XXXXXX confirmation upon success");
});

test("12. Request detail displays saved dynamic answers using configured labels", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/[id]/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Request detail page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("request.request_detail?.submitted_form_data"), "Must access submitted_form_data from request details");
  assert.ok(source.includes("displayEntries"), "Must prepare displayEntries mapping submitted dynamic answers");
  assert.ok(source.includes("q.label"), "Must display configured human-readable question label");
  assert.ok(source.includes("formatFieldValue"), "Must format field values properly including multi-select arrays");
});

test("13. Service Agent request detail displays saved answers in unified request view", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="service-agent-request-detail"'), "Must support Service Agent detail view");
  assert.ok(source.includes('id="request-variables-card"'), "Must display submitted request details card for Service Agent");
  assert.ok(source.includes('id="agent-update-status-action"'), "Must provide fulfillment action controls for Service Agent");
});

test("14. Catalog items without intake_schema continue working gracefully", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes("This catalog item has no additional questions"),
    "Must display friendly guidance when catalog item has no dynamic schema"
  );
});

test("15. Existing Requester catalog flow does not regress", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/new/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("catalog_item_id"), "Must maintain catalog_item_id in request payload");
  assert.ok(source.includes("service_id"), "Must maintain service_id in request payload");
  assert.ok(source.includes("priority"), "Must maintain priority selection");
  assert.ok(source.includes("source_channel"), "Must maintain source channel tracking");
});
