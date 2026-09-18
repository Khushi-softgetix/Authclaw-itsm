import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

// Test suite for Step 6: Service Agent - Service Request Work
test("1. Requests Workspace exists at /itsm/requests/page.tsx and renders container", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Requests workspace page must exist at /itsm/requests/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="service-agent-requests-page"'), "Must render #service-agent-requests-page container");
  assert.ok(source.includes("/api/itsm/requests"), "Must fetch from /api/itsm/requests BFF endpoint");
  assert.ok(source.includes("useSearchParams"), "Must support URL search params");
});

test("2. Search bar and filter tabs exist on Requests Workspace", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="requests-search-input"'), "Must have #requests-search-input");
  assert.ok(source.includes('id="requests-search-button"'), "Must have #requests-search-button");
  assert.ok(source.includes('id="request-filter-tabs"'), "Must have filter tab container");
  assert.ok(source.includes("filter-tab-"), "Must render filter tab buttons with filter-tab- ids");
  assert.ok(source.includes("ALL") && source.includes("ASSIGNED_TO_ME") && source.includes("OPEN") && source.includes("IN_PROGRESS") && source.includes("RESOLVED"), "Must support all five required filter tabs");
});

test("3. Request cards render required ticket fields and metadata", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("req.ticket_number"), "Must render ticket number");
  assert.ok(source.includes("req.priority"), "Must render priority badge");
  assert.ok(source.includes("req.status"), "Must render status badge");
  assert.ok(source.includes("req.requester_email"), "Must render requester email");
  assert.ok(source.includes("req.service_name"), "Must render service name");
  assert.ok(source.includes("req.assignment_group"), "Must render assignment group");
  assert.ok(source.includes("req.assignee_email"), "Must render assignee email");
  assert.ok(source.includes("req.updated_at"), "Must render updated timestamp");
  assert.ok(source.includes("req.sla_status"), "Must render SLA indicator when present");
  assert.ok(source.includes("href={`/itsm/requests/${req.id}`}"), "Cards must link to detail page");
});

test("4. Loading, error, empty, and search-empty states are handled on workspace", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="requests-loading-state"'), "Must have loading state");
  assert.ok(source.includes('id="requests-error-state"'), "Must have error state");
  assert.ok(source.includes("requests-empty-state"), "Must have default empty state");
  assert.ok(source.includes("requests-search-empty-state"), "Must have search empty state");
  assert.ok(source.includes('id="retry-requests-btn"'), "Must provide retry button");
});

test("5. Request Detail page exists at /itsm/requests/[id]/page.tsx with required layout and actions", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/[id]/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Request detail page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="service-agent-request-detail"'), "Must render #service-agent-request-detail");
  assert.ok(source.includes('id="back-to-requests-link"'), "Must provide back link to requests workspace");
  assert.ok(source.includes('href="/itsm/requests"'), "Back link must point to /itsm/requests");
  assert.ok(source.includes('id="agent-update-status-action"'), "Must have Update Status button");
  assert.ok(source.includes('id="agent-resolve-request-action"'), "Must have Resolve Request button");
  assert.ok(source.includes('id="agent-reopen-request-action"'), "Must have Reopen Request button");
  assert.ok(source.includes('id="request-variables-card"'), "Must have #request-variables-card");
  assert.ok(source.includes('id="request-activity-section"'), "Must have #request-activity-section");
  assert.ok(source.includes("<ActivityTimeline"), "Must render ActivityTimeline component");
  assert.ok(source.includes("<StatusModal"), "Must render StatusModal component");
});

test("6. Request Detail page handles 401, 403, 404, and server errors cleanly", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="request-detail-loading"'), "Must have detail loading state");
  assert.ok(source.includes('id="request-detail-unauthorized"'), "Must have unauthorized 403 state");
  assert.ok(source.includes('id="request-detail-not-found"'), "Must have not found 404 state");
  assert.ok(source.includes('id="request-detail-error"'), "Must have server error state");
});

test("7. BFF routes allow itsm/requests for GET, POST, and CREATED", () => {
  // Test route resolution for requests workspace and details
  const getList = resolveBffRoute("GET", "itsm/requests");
  assert.ok(getList, "GET itsm/requests must resolve");
  assert.equal(getList.backendPath, "/v1/itsm/requests");

  const getDetail = resolveBffRoute("GET", "itsm/requests/req-123");
  assert.ok(getDetail, "GET itsm/requests/req-123 must resolve");
  assert.equal(getDetail.backendPath, "/v1/itsm/requests/req-123");

  const getActivities = resolveBffRoute("GET", "itsm/requests/req-123/activities");
  assert.ok(getActivities, "GET itsm/requests/req-123/activities must resolve");
  assert.equal(getActivities.backendPath, "/v1/itsm/requests/req-123/activities");

  const postStatus = resolveBffRoute("POST", "itsm/requests/req-123/status");
  assert.ok(postStatus, "POST itsm/requests/req-123/status must resolve");
  assert.equal(postStatus.backendPath, "/v1/itsm/requests/req-123/status");

  const postAssign = resolveBffRoute("POST", "itsm/requests/req-123/assign");
  assert.ok(postAssign, "POST itsm/requests/req-123/assign must resolve");
  assert.equal(postAssign.backendPath, "/v1/itsm/requests/req-123/assign");

  const postActivity = resolveBffRoute("POST", "itsm/requests/req-123/activities");
  assert.ok(postActivity, "POST itsm/requests/req-123/activities must resolve");
  assert.equal(postActivity.backendPath, "/v1/itsm/requests/req-123/activities");
  assert.equal(postActivity.status, 201, "POST activity must return 201 Created status");
});

test("8. ITSM types include ServiceRequest and ServiceRequestDetailData", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  assert.ok(fs.existsSync(typesPath), "itsm-types.ts must exist");
  const source = fs.readFileSync(typesPath, "utf-8");

  assert.ok(source.includes("export interface ServiceRequest"), "Must export ServiceRequest interface");
  assert.ok(source.includes("export interface ServiceRequestDetailData"), "Must export ServiceRequestDetailData interface");
  assert.ok(source.includes("catalog_item_id"), "ServiceRequestDetailData must have catalog_item_id");
  assert.ok(source.includes("submitted_form_data"), "ServiceRequestDetailData must have submitted_form_data");
});

test("9. Console shell navigation configures /itsm/requests for Service Agent", () => {
  const shellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  assert.ok(fs.existsSync(shellPath), "console-shell.tsx must exist");
  const source = fs.readFileSync(shellPath, "utf-8");

  assert.ok(source.includes('href: "/itsm/requests"'), "Navigation must include /itsm/requests");
  assert.ok(source.includes('name: "Requests"'), "Navigation must label item as Requests");
});
