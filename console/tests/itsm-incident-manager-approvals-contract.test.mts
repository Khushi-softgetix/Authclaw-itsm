import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

test("Incident Manager shell navigation includes Service Request Approvals tab", () => {
  const shellSrc = readFileSync(new URL("../src/components/incident-manager-shell.tsx", import.meta.url), "utf8");
  assert.ok(
    shellSrc.includes('{ href: "/itsm/incident-manager/approvals", label: "Service Request Approvals"'),
    "incident-manager-shell.tsx must include Service Request Approvals in navItems"
  );
  assert.ok(
    shellSrc.includes('pathname.startsWith("/itsm/incident-manager/approvals")'),
    "incident-manager-shell.tsx must map /itsm/incident-manager/approvals to page title"
  );
  assert.ok(
    shellSrc.includes('{ href: "/itsm/incident-manager", label: "Overview"'),
    "Existing Overview navItem must be preserved"
  );
  assert.ok(
    shellSrc.includes('{ href: "/itsm/incident-manager/incidents", label: "Incidents"'),
    "Existing Incidents navItem must be preserved"
  );
  assert.ok(
    shellSrc.includes('{ href: "/itsm/incident-manager/major-incidents", label: "Major Incidents"'),
    "Existing Major Incidents navItem must be preserved"
  );
});

test("BFF routes whitelist and forward ITSM approvals and request assignment endpoints", () => {
  const getRoute = resolveBffRoute("GET", "itsm/approvals");
  assert.deepEqual(getRoute, { backendPath: "/v1/itsm/approvals", body: "none", status: undefined });

  const approveRoute = resolveBffRoute("POST", "itsm/approvals/app-123/approve");
  assert.deepEqual(approveRoute, { backendPath: "/v1/itsm/approvals/app-123/approve", body: "optional-json", status: undefined });

  const rejectRoute = resolveBffRoute("POST", "itsm/approvals/app-123/reject");
  assert.deepEqual(rejectRoute, { backendPath: "/v1/itsm/approvals/app-123/reject", body: "optional-json", status: undefined });

  const assignRoute = resolveBffRoute("POST", "itsm/requests/req-123/assign");
  assert.deepEqual(assignRoute, { backendPath: "/v1/itsm/requests/req-123/assign", body: "json", status: undefined });
});

test("AssignModal supports configurable assignEndpoint and custom title", () => {
  const modalSrc = readFileSync(new URL("../src/components/itsm/assign-modal.tsx", import.meta.url), "utf8");
  assert.ok(
    modalSrc.includes("assignEndpoint?: string"),
    "AssignModalProps must accept optional assignEndpoint"
  );
  assert.ok(
    modalSrc.includes("const endpoint = assignEndpoint || `/api/itsm/incidents/${incident.id}/assign`"),
    "AssignModal must use assignEndpoint when provided"
  );
  assert.ok(
    modalSrc.includes("title?: string"),
    "AssignModalProps must accept optional title"
  );
});

test("Incident Manager Approvals page UI exists and implements required workflow", () => {
  const pageUrl = new URL("../src/app/(console)/itsm/incident-manager/approvals/page.tsx", import.meta.url);
  assert.ok(existsSync(pageUrl), "Approvals page component must exist at /itsm/incident-manager/approvals/page.tsx");

  const pageSrc = readFileSync(pageUrl, "utf8");

  // 1. Fetching approvals from existing API
  assert.ok(pageSrc.includes("/api/itsm/approvals"), "Page must fetch approvals from BFF route");

  // 2. Tab filters
  assert.ok(pageSrc.includes('"PENDING"'), "Page must provide PENDING filter/tab");
  assert.ok(pageSrc.includes('"ALL"'), "Page must provide ALL filter/tab");
  assert.ok(pageSrc.includes('"APPROVED"'), "Page must provide APPROVED filter/tab");
  assert.ok(pageSrc.includes('"REJECTED"'), "Page must provide REJECTED filter/tab");

  // 3. Approval and Rejection actions
  assert.ok(pageSrc.includes("/approve"), "Page must support approving requests");
  assert.ok(pageSrc.includes("/reject"), "Page must support rejecting requests");
  assert.ok(pageSrc.includes("rejection reason") || pageSrc.includes("Rejection Reason"), "Page must provide rejection reason prompt");

  // 4. Team Assignment integration
  assert.ok(pageSrc.includes("<AssignModal"), "Page must reuse AssignModal component");
  assert.ok(
    pageSrc.includes("/api/itsm/requests/") && pageSrc.includes("/assign"),
    "Page must target /api/itsm/requests/{id}/assign for team assignment"
  );

  // 5. Segregation of Duties (SoD) protection in UI
  assert.ok(
    pageSrc.includes("isOwnRequest") || pageSrc.includes("currentUser.id === item.requester_id"),
    "Page must check if current user is the requester"
  );
  assert.ok(
    pageSrc.includes("SoD Protected") || pageSrc.includes("Self-request"),
    "Page must indicate SoD protection when user views own request"
  );

  // 6. Navigation and states
  assert.ok(pageSrc.includes("/itsm/requests/"), "Page must link to request detail view");
  assert.ok(pageSrc.includes("Refresh queue") || pageSrc.includes("refresh"), "Page must include refresh capability");
  assert.ok(pageSrc.includes("Search request"), "Page must include search filter");
});
