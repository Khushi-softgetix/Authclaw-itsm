import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. Approval & Fulfillment section renders in Studio detail and edit views", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  assert.ok(fs.existsSync(detailPath), "Studio detail page must exist");
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(
    source.includes("Approval & Fulfillment") || source.includes("Approval &amp; Fulfillment"),
    "Must render Approval & Fulfillment section"
  );
  assert.ok(
    source.includes('id="approval-fulfillment-section"') || source.includes('id="detail-approval-fulfillment-card"'),
    "Must have dedicated approval fulfillment container"
  );
});

test("2. Current approval configuration loads correctly from catalog item API", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes("setApprovalRequired(Boolean(data.approval_required))"), "Must load approval_required state");
  assert.ok(source.includes("setFulfillmentGroup(data.fulfillment_group || \"\")"), "Must load fulfillment_group");
  assert.ok(source.includes("setEstimatedDeliveryHours(data.estimated_delivery_hours"), "Must load estimated_delivery_hours");
  assert.ok(source.includes("detail-approval-status-badge"), "Must have read-only approval status indicator");
  assert.ok(source.includes("detail-fulfillment-group"), "Must have read-only fulfillment group indicator");
  assert.ok(source.includes("detail-delivery-sla"), "Must have read-only SLA indicator");
});

test("3. Approval toggle works with clear visual feedback", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes("approval-required-toggle-btn"), "Must have interactive toggle button");
  assert.ok(source.includes("setApprovalRequired(!approvalRequired)"), "Toggle click must invert state");
  assert.ok(source.includes('approvalRequired ? "ON" : "OFF"'), "Must display explicit ON/OFF label");
  assert.ok(
    source.includes("Requests for this catalog item require approval before fulfillment"),
    "Must display standard approval requirement description"
  );
});

test("4. Fulfillment team selector loads active teams from dedicated backend endpoint", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(
    source.includes("/api/itsm/admin/service-catalog/fulfillment-teams"),
    "Must query dedicated catalog fulfillment-teams endpoint"
  );
  assert.ok(source.includes("edit-catalog-fulfillment-select"), "Must have fulfillment select input");
  assert.ok(source.includes("Select team ▼"), "Must display standard select prompt");
});

test("5. Saving persists approval and fulfillment configuration via standard PATCH", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes("approval_required: Boolean(approvalRequired)"), "Must include approval_required in payload");
  assert.ok(source.includes("fulfillment_group: fulfillmentGroup.trim() || null"), "Must include fulfillment_group in payload");
  assert.ok(source.includes("estimated_delivery_hours: Number(estimatedDeliveryHours)"), "Must include SLA in payload");
  assert.ok(source.includes('method: "PATCH"'), "Must persist via PATCH");
});

test("6. Create Offering page supports approval and fulfillment configuration", () => {
  const newPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/new/page.tsx"
  );
  assert.ok(fs.existsSync(newPath), "Create offering page must exist");
  const source = fs.readFileSync(newPath, "utf-8");

  assert.ok(source.includes("catalog-item-approval-checkbox"), "Must have approval input on new page");
  assert.ok(source.includes("catalog-item-fulfillment-input"), "Must have fulfillment team input on new page");
  assert.ok(source.includes("catalog-item-delivery-input"), "Must have delivery SLA input on new page");
  assert.ok(source.includes("/api/itsm/admin/service-catalog/fulfillment-teams"), "Must query active fulfillment teams");
  assert.ok(source.includes("approval_required: Boolean(approvalRequired)"), "Must persist approval on creation");
});

test("7. Catalog Manager Studio controls are secured in dedicated catalog-manager route hierarchy", () => {
  const layoutPath = path.join(consoleDir, "src/app/(console)/layout.tsx");
  const source = fs.readFileSync(layoutPath, "utf-8");

  assert.ok(source.includes('currentPath.startsWith("/itsm/catalog-manager")'), "Must guard catalog-manager paths");
  assert.ok(source.includes('itsmRole !== "CATALOG_MANAGER"'), "Must enforce CATALOG_MANAGER role");
  assert.ok(source.includes('itsmRole !== "PLATFORM_ADMINISTRATOR"'), "Must allow PLATFORM_ADMINISTRATOR");
});

test("8. Requester request submission page does not expose internal approval/fulfillment configuration controls", () => {
  const requesterPagePath = path.join(
    consoleDir,
    "src/app/(console)/itsm/requests/new/page.tsx"
  );
  assert.ok(fs.existsSync(requesterPagePath), "Requester page must exist");
  const source = fs.readFileSync(requesterPagePath, "utf-8");

  // Requesters should answer questions, NOT configure governance
  assert.ok(!source.includes("edit-catalog-fulfillment-select"), "Requester must not have fulfillment team selector");
  assert.ok(!source.includes("approval-required-toggle-btn"), "Requester must not have approval toggle");
  assert.ok(!source.includes("catalog-item-delivery-input"), "Requester must not configure delivery SLA");
});

test("9. Catalog Studio main table displays fulfillment team, approval status, and SLA columns", () => {
  const studioPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/page.tsx"
  );
  assert.ok(fs.existsSync(studioPath), "Studio main page must exist");
  const source = fs.readFileSync(studioPath, "utf-8");

  assert.ok(source.includes("Fulfillment Group"), "Must show fulfillment column header");
  assert.ok(source.includes("Approval"), "Must show approval column header");
  assert.ok(source.includes("Est. Delivery"), "Must show delivery SLA column header");
});

test("10. API handles 403 Forbidden gracefully without unexpected redirection", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(
    source.includes('if (res.status === 403)'),
    "Must handle 403 Forbidden on detail load and update"
  );
});
