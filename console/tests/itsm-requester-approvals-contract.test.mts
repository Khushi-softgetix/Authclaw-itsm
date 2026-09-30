import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

test("Requester shell navigation includes Approvals tab", () => {
  const shellSrc = readFileSync(new URL("../src/components/console-shell.tsx", import.meta.url), "utf8");
  assert.ok(
    shellSrc.includes('{ name: "Approvals", href: "/itsm/approvals"'),
    "console-shell.tsx must include Approvals link in requester navigation"
  );
  assert.ok(
    shellSrc.includes('pathname === "/itsm/approvals"'),
    "console-shell.tsx must map /itsm/approvals to page title"
  );
});

test("BFF routes whitelist and forward ITSM approvals endpoints", () => {
  const getRoute = resolveBffRoute("GET", "itsm/approvals");
  assert.deepEqual(getRoute, { backendPath: "/v1/itsm/approvals", body: "none", status: undefined });

  const approveRoute = resolveBffRoute("POST", "itsm/approvals/app-123/approve");
  assert.deepEqual(approveRoute, { backendPath: "/v1/itsm/approvals/app-123/approve", body: "optional-json", status: undefined });

  const rejectRoute = resolveBffRoute("POST", "itsm/approvals/app-123/reject");
  assert.deepEqual(rejectRoute, { backendPath: "/v1/itsm/approvals/app-123/reject", body: "optional-json", status: undefined });
});

test("Requester Approvals page UI exists and includes necessary actions", () => {
  const approvalsPageUrl = new URL("../src/app/(console)/itsm/approvals/page.tsx", import.meta.url);
  assert.ok(existsSync(approvalsPageUrl), "Approvals page component must exist at /itsm/approvals/page.tsx");

  const pageSrc = readFileSync(approvalsPageUrl, "utf8");
  assert.ok(pageSrc.includes("/api/itsm/approvals"), "Page must fetch approvals from BFF route");
  assert.ok(pageSrc.includes("/approve"), "Page must support approving requests");
  assert.ok(pageSrc.includes("/reject"), "Page must support rejecting requests");
  assert.ok(pageSrc.includes("reject-modal") || pageSrc.includes("Reject Service Request"), "Page must provide rejection reason prompt");
  assert.ok(pageSrc.includes("PENDING"), "Page must provide PENDING filter/tab");
  assert.ok(pageSrc.includes("APPROVED"), "Page must display APPROVED state");
  assert.ok(pageSrc.includes("REJECTED"), "Page must display REJECTED state");
  assert.ok(pageSrc.includes("refresh"), "Page must include refresh capability");
});

test("Requester Ticket Detail back navigation links to /itsm/incidents with 'Back to My Tickets'", () => {
  const incidentPageSrc = readFileSync(
    new URL("../src/app/(console)/itsm/incidents/[id]/page.tsx", import.meta.url),
    "utf8"
  );

  // Requester breadcrumb back button
  assert.ok(
    incidentPageSrc.includes('href="/itsm/incidents"'),
    "Requester ticket view must link to /itsm/incidents"
  );
  assert.ok(
    incidentPageSrc.includes("Back to My Tickets"),
    "Requester ticket view back button text must be 'Back to My Tickets'"
  );

  // Agent view must remain Back to My Work -> /itsm/dashboard/agent
  assert.ok(
    incidentPageSrc.includes('href="/itsm/dashboard/agent"'),
    "Agent view must preserve link to /itsm/dashboard/agent"
  );
  assert.ok(
    incidentPageSrc.includes("Back to My Work"),
    "Agent view back button text must remain 'Back to My Work'"
  );
});

test("Backend ITSM Approvals router and service integration", () => {
  const approvalsEndpointSrc = readFileSync(
    new URL("../../backend/app/api/v1/endpoints/itsm_approvals.py", import.meta.url),
    "utf8"
  );
  assert.ok(approvalsEndpointSrc.includes("def list_approvals"), "Endpoint must implement list_approvals");
  assert.ok(approvalsEndpointSrc.includes("def approve_request"), "Endpoint must implement approve_request");
  assert.ok(approvalsEndpointSrc.includes("def reject_request"), "Endpoint must implement reject_request");
  assert.ok(approvalsEndpointSrc.includes("PendingApproval"), "Endpoint must reuse PendingApproval model");

  const mainSrc = readFileSync(
    new URL("../../backend/main.py", import.meta.url),
    "utf8"
  );
  assert.ok(mainSrc.includes("itsm_approvals_router"), "main.py must register itsm_approvals_router");
  assert.ok(mainSrc.includes("/v1/itsm/approvals"), "main.py must expose /v1/itsm/approvals");

  const requestServiceSrc = readFileSync(
    new URL("../../backend/app/services/itsm_request_service.py", import.meta.url),
    "utf8"
  );
  assert.ok(requestServiceSrc.includes("catalog_item.approval_required"), "itsm_request_service must check approval_required");
  assert.ok(requestServiceSrc.includes("PendingApproval"), "itsm_request_service must create PendingApproval for approval-required items");
});
