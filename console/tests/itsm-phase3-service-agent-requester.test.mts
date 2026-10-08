import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(consoleDir, "..");

test("1. itsm-types.ts includes approval_status, approval_required, and rejection_reason on Incident and ServiceRequest", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  assert.ok(fs.existsSync(typesPath), "itsm-types.ts must exist");
  const source = fs.readFileSync(typesPath, "utf-8");

  // Incident interface
  assert.ok(source.includes("approval_status?:"), "Incident interface must include approval_status");
  assert.ok(source.includes("approval_required?:"), "Incident interface must include approval_required");
  assert.ok(source.includes("rejection_reason?:"), "Incident interface must include rejection_reason");

  // ServiceRequest interface
  assert.ok(source.includes("interface ServiceRequest"), "ServiceRequest interface must exist");
  const srBlock = source.slice(source.indexOf("interface ServiceRequest"));
  assert.ok(srBlock.includes("approval_status?:"), "ServiceRequest interface must include approval_status");
  assert.ok(srBlock.includes("approval_required?:"), "ServiceRequest interface must include approval_required");
  assert.ok(srBlock.includes("rejection_reason?:"), "ServiceRequest interface must include rejection_reason");
});

test("2. Service Agent Request Detail page enforces pending-approval UI restrictions and awaiting approval message", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/[id]/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Request detail page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Approval state calculation
  assert.ok(source.includes("isApprovalPending"), "Must calculate isApprovalPending");
  assert.ok(source.includes("isApprovalApproved"), "Must calculate isApprovalApproved");
  assert.ok(source.includes("isApprovalRejected"), "Must calculate isApprovalRejected");

  // Awaiting approval message & fulfillment restrictions
  assert.ok(source.includes('id="service-request-awaiting-approval-message"'), "Must render awaiting approval message banner");
  assert.ok(source.includes("Awaiting Manager Approval"), "Must display Awaiting Manager Approval heading");
  assert.ok(source.includes("Fulfillment Locked"), "Must indicate fulfillment is locked while approval is pending");

  // Disabled/guarded action buttons
  assert.ok(source.includes('id="agent-update-status-action"'), "Must preserve agent-update-status-action");
  assert.ok(source.includes('id="agent-resolve-request-action"'), "Must preserve agent-resolve-request-action");
  assert.ok(source.includes("disabled"), "Must disable actions when pending approval");
});

test("3. Service Agent Request Detail page handles rejected requests and rejection reason display", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Rejection banner & reason display
  assert.ok(source.includes('id="service-request-rejected-message"'), "Must render rejected message banner");
  assert.ok(source.includes('id="request-detail-rejection-reason"'), "Must render rejection reason container");
  assert.ok(source.includes("rejection_reason"), "Must reference request.rejection_reason");
  assert.ok(source.includes("Cancelled"), "Must indicate ticket cancellation on rejection");
});

test("4. Service Agent Request Detail page restores fulfillment actions when approved and supports team assignment", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Approved banner
  assert.ok(source.includes('id="service-request-approved-message"'), "Must render approved message banner");
  assert.ok(source.includes("Manager Approval Granted"), "Must indicate approval granted");

  // Team assignment via AssignModal
  assert.ok(source.includes('id="agent-assign-request-action"'), "Must render agent-assign-request-action button");
  assert.ok(source.includes("<AssignModal"), "Must render AssignModal component");
  assert.ok(source.includes("/api/itsm/requests/"), "AssignModal must target /api/itsm/requests/.../assign endpoint");
});

test("5. Requester My Tickets page displays approval status separately from work status and shows rejection reason", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Incidents/tickets page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Table headers: Approval column separate from Status column
  assert.ok(source.includes("<th className=\"py-3.5 px-4\">Approval</th>"), "Must have separate Approval column header");
  assert.ok(source.includes("<th className=\"py-3.5 px-4\">Status</th>"), "Must have Status column header");

  // Approval badges
  assert.ok(source.includes("Pending"), "Must render Pending approval badge");
  assert.ok(source.includes("Approved"), "Must render Approved badge");
  assert.ok(source.includes("Rejected"), "Must render Rejected badge");

  // Rejection reason display
  assert.ok(source.includes("incident.rejection_reason"), "Must display rejection reason when present");
  assert.ok(source.includes("<IncidentStatusBadge"), "Must render IncidentStatusBadge for work status");
});

test("6. Service Agent Requests Workspace displays approval badges and rejection reasons on cards", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Requests workspace page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Card approval status
  assert.ok(source.includes("approval-badge-"), "Must render approval-badge- elements on cards");
  assert.ok(source.includes("Awaiting Approval"), "Must render Awaiting Approval label");
  assert.ok(source.includes("rejection-reason-"), "Must render rejection-reason- container on cards");
  assert.ok(source.includes("req.rejection_reason"), "Must bind req.rejection_reason");
});

test("7. Request Detail page renders IncidentStepper work progress tracking", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/requests/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="request-work-progress-card"'), "Must render #request-work-progress-card");
  assert.ok(source.includes("<IncidentStepper"), "Must render IncidentStepper component");
  assert.ok(source.includes("currentStatus={request.status}"), "IncidentStepper must receive currentStatus");
  assert.ok(source.includes("Request Resolved on"), "Must show resolution timestamp when resolved");
  assert.ok(source.includes("Request Closed on"), "Must show closed timestamp when closed");
});

test("8. Backend schemas and service include approval fields on ServiceRequestResponse", () => {
  const schemaPath = path.join(repoDir, "backend/app/schemas/itsm_requests.py");
  assert.ok(fs.existsSync(schemaPath), "itsm_requests.py schema must exist");
  const schemaSource = fs.readFileSync(schemaPath, "utf-8");

  assert.ok(schemaSource.includes("approval_required: bool = False"), "Schema must include approval_required");
  assert.ok(schemaSource.includes("approval_status: Optional[str] = None"), "Schema must include approval_status");
  assert.ok(schemaSource.includes("rejection_reason: Optional[str] = None"), "Schema must include rejection_reason");

  const servicePath = path.join(repoDir, "backend/app/services/itsm_request_service.py");
  assert.ok(fs.existsSync(servicePath), "itsm_request_service.py must exist");
  const serviceSource = fs.readFileSync(servicePath, "utf-8");

  assert.ok(serviceSource.includes("approval_status=approval_status"), "Service must pass approval_status");
  assert.ok(serviceSource.includes("approval_required=is_approval_required"), "Service must pass approval_required");
  assert.ok(serviceSource.includes("rejection_reason=rejection_reason"), "Service must pass rejection_reason");
});
