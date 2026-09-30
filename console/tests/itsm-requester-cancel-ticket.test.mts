import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";

test("CancelTicketModal component exists and enforces reason before cancellation", () => {
  const modalPath = new URL("../src/components/itsm/cancel-ticket-modal.tsx", import.meta.url);
  assert.ok(existsSync(modalPath), "cancel-ticket-modal.tsx must exist");

  const modalSrc = readFileSync(modalPath, "utf8");
  assert.ok(modalSrc.includes('status: "CANCELLED"'), "Modal must set status to CANCELLED");
  assert.ok(modalSrc.includes("status_reason: reason.trim()"), "Modal must pass status_reason");
  assert.ok(modalSrc.includes("Please provide a reason"), "Modal must require cancellation reason");
  assert.ok(modalSrc.includes("onSuccess"), "Modal must invoke onSuccess callback");
});

test("Requester Incident Detail page provides Cancel Ticket button for open tickets only", () => {
  const pageSrc = readFileSync(
    new URL("../src/app/(console)/itsm/incidents/[id]/page.tsx", import.meta.url),
    "utf8"
  );

  assert.ok(
    pageSrc.includes('id="requester-cancel-ticket-button"'),
    "Incident detail page must have requester-cancel-ticket-button"
  );
  assert.ok(
    pageSrc.includes('["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"].includes(incident.status)'),
    "Cancel Ticket button must be restricted to open ticket statuses"
  );
  assert.ok(
    pageSrc.includes("<CancelTicketModal"),
    "Incident detail page must mount CancelTicketModal"
  );
});

test("Requester Service Request Detail page provides Cancel Request button for open requests only", () => {
  const pageSrc = readFileSync(
    new URL("../src/app/(console)/itsm/requests/[id]/page.tsx", import.meta.url),
    "utf8"
  );

  assert.ok(
    pageSrc.includes('id="requester-cancel-request-action"'),
    "Request detail page must have requester-cancel-request-action"
  );
  assert.ok(
    pageSrc.includes('userRole === "REQUESTER" && ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"].includes(request.status)'),
    "Cancel Request button must be restricted to requesters with open requests"
  );
  assert.ok(
    pageSrc.includes("<CancelTicketModal"),
    "Request detail page must mount CancelTicketModal"
  );
});

test("Backend Incidents endpoint enforces requester cancellation rules", () => {
  const endpointSrc = readFileSync(
    new URL("../../backend/app/api/v1/endpoints/itsm_incidents.py", import.meta.url),
    "utf8"
  );

  assert.ok(
    endpointSrc.includes('target_status == "CANCELLED"'),
    "itsm_incidents.py must handle CANCELLED target_status for requesters"
  );
  assert.ok(
    endpointSrc.includes("str(ticket.requester_id) != str(actor_id)"),
    "itsm_incidents.py must reject cancellation if caller is not the ticket requester"
  );
  assert.ok(
    endpointSrc.includes('ticket.status in {"CLOSED", "CANCELLED"}'),
    "itsm_incidents.py must reject cancellation on terminal tickets"
  );
  assert.ok(
    endpointSrc.includes('ticket.status == "RESOLVED"'),
    "itsm_incidents.py must reject cancellation on resolved tickets"
  );
  assert.ok(
    endpointSrc.includes("A reason is required to cancel the ticket"),
    "itsm_incidents.py must require a cancellation reason"
  );
});

test("Backend Requests endpoint enforces requester cancellation rules", () => {
  const endpointSrc = readFileSync(
    new URL("../../backend/app/api/v1/endpoints/itsm_requests.py", import.meta.url),
    "utf8"
  );

  assert.ok(
    endpointSrc.includes('target_status == "CANCELLED"'),
    "itsm_requests.py must handle CANCELLED target_status for requesters"
  );
  assert.ok(
    endpointSrc.includes("str(ticket.requester_id) != str(actor_id)"),
    "itsm_requests.py must reject cancellation if caller is not the request requester"
  );
  assert.ok(
    endpointSrc.includes('ticket.status in {"CLOSED", "CANCELLED"}'),
    "itsm_requests.py must reject cancellation on terminal requests"
  );
  assert.ok(
    endpointSrc.includes('ticket.status == "RESOLVED"'),
    "itsm_requests.py must reject cancellation on resolved requests"
  );
  assert.ok(
    endpointSrc.includes("A reason is required to cancel the ticket"),
    "itsm_requests.py must require a cancellation reason"
  );
});

test("Backend Services support CANCELLED transition and activity/audit recording", () => {
  const incidentServiceSrc = readFileSync(
    new URL("../../backend/app/services/itsm_incident_service.py", import.meta.url),
    "utf8"
  );
  assert.ok(
    incidentServiceSrc.includes('"NEW": {"ASSIGNED", "IN_PROGRESS", "CANCELLED"}'),
    "ALLOWED_TRANSITIONS must allow NEW -> CANCELLED"
  );
  assert.ok(
    incidentServiceSrc.includes('"ASSIGNED": {"IN_PROGRESS", "CANCELLED"}'),
    "ALLOWED_TRANSITIONS must allow ASSIGNED -> CANCELLED"
  );
  assert.ok(
    incidentServiceSrc.includes('"IN_PROGRESS": {"PENDING", "RESOLVED", "CANCELLED"}'),
    "ALLOWED_TRANSITIONS must allow IN_PROGRESS -> CANCELLED"
  );
  assert.ok(
    incidentServiceSrc.includes('"PENDING": {"IN_PROGRESS", "RESOLVED", "CANCELLED"}'),
    "ALLOWED_TRANSITIONS must allow PENDING -> CANCELLED"
  );
  assert.ok(
    incidentServiceSrc.includes('_record_activity'),
    "IncidentService must record activity for status changes"
  );
  assert.ok(
    incidentServiceSrc.includes('_emit_audit_event'),
    "IncidentService must emit audit events for status changes"
  );

  const requestServiceSrc = readFileSync(
    new URL("../../backend/app/services/itsm_request_service.py", import.meta.url),
    "utf8"
  );
  assert.ok(
    requestServiceSrc.includes('"NEW": {"ASSIGNED", "IN_PROGRESS", "CANCELLED"}'),
    "ALLOWED_REQUEST_TRANSITIONS must allow NEW -> CANCELLED"
  );
  assert.ok(
    requestServiceSrc.includes('_record_activity'),
    "RequestService must record activity for status changes"
  );
  assert.ok(
    requestServiceSrc.includes('append_audit_event'),
    "RequestService must append audit events for status changes"
  );
});
