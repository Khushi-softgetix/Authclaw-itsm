import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

test("developer layout requires an active tenantless platform profile", () => {
  const source = readFileSync(new URL("../src/app/developer/layout.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("principal.tenant_id === null"));
  assert.ok(source.includes('principal.role === "platform_admin"'));
  assert.ok(source.includes("principal.is_active === true"));
  assert.ok(source.includes('scopes.includes("platform.admin")'));
});

test("maps approved BFF routes and rejects broader proxy access", () => {
  assert.deepEqual(resolveBffRoute("GET", "users"), { backendPath: "/v1/users", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "red-team"), { backendPath: "/v1/red-team/runs", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("POST", "tenants"), { backendPath: "/v1/tenants", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("POST", "users/me/mfa/disable"), { backendPath: "/v1/users/me/mfa/disable", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "approvals/a-1/approve"), { backendPath: "/v1/workflows/approvals/a-1/approve", body: "optional-json", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "ephemeral-workers/tokens/t-1/revoke"), { backendPath: "/v1/ephemeral-workers/tokens/t-1/revoke", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "findings/summary/dashboard"), { backendPath: "/v1/findings/summary/dashboard", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "data-subject-requests/r-1/verify"), { backendPath: "/v1/data-subject-requests/r-1/verify", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "access-requests"), { backendPath: "/api/public/v1/access-requests", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("PATCH", "access-requests/AR-123/status"), { backendPath: "/api/public/v1/access-requests/AR-123/status", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("DELETE", "api-keys/k-1"), { backendPath: "/v1/api-keys/k-1", body: "none", status: 204 });
  assert.equal(resolveBffRoute("DELETE", "access-requests/AR-123"), null);
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents"), { backendPath: "/v1/itsm/incidents", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/audit/events"), { backendPath: "/v1/itsm/audit/events", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/audit/events/7f3355ea-2dc5-4a58-83de-a841a4f57fea"), { backendPath: "/v1/itsm/audit/events/7f3355ea-2dc5-4a58-83de-a841a4f57fea", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/audit/overview"), { backendPath: "/v1/itsm/audit/overview", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/audit/exports"), { backendPath: "/v1/itsm/audit/exports", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/audit/traces"), { backendPath: "/v1/itsm/audit/traces", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/audit/export"), { backendPath: "/v1/itsm/audit/export", body: "json", status: undefined });
  assert.equal(resolveBffRoute("PATCH", "itsm/audit/events"), null);
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents/inc-1"), { backendPath: "/v1/itsm/incidents/inc-1", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents/inc-1/activities"), { backendPath: "/v1/itsm/incidents/inc-1/activities", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents/inc-1/major-incident"), { backendPath: "/v1/itsm/incidents/inc-1/major-incident", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents/operations/dashboard"), { backendPath: "/v1/itsm/incidents/operations/dashboard", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents/operations/queue"), { backendPath: "/v1/itsm/incidents/operations/queue", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents/operations/participants"), { backendPath: "/v1/itsm/incidents/operations/participants", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents/operations/reference-data"), { backendPath: "/v1/itsm/incidents/operations/reference-data", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents/operations/saved-views"), { backendPath: "/v1/itsm/incidents/operations/saved-views", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/incidents"), { backendPath: "/v1/itsm/incidents", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("POST", "itsm/incidents/inc-1/status"), { backendPath: "/v1/itsm/incidents/inc-1/status", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/incidents/inc-1/assign"), { backendPath: "/v1/itsm/incidents/inc-1/assign", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/incidents/inc-1/activities"), { backendPath: "/v1/itsm/incidents/inc-1/activities", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("POST", "itsm/incidents/inc-1/major-incident"), { backendPath: "/v1/itsm/incidents/inc-1/major-incident", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/incidents/inc-1/major-incident/page"), {
    backendPath: "/v1/itsm/incidents/inc-1/major-incident/page",
    body: "none",
    status: undefined,
  });
  assert.deepEqual(resolveBffRoute("POST", "itsm/incidents/operations/saved-views"), { backendPath: "/v1/itsm/incidents/operations/saved-views", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("PATCH", "itsm/incidents/inc-1"), { backendPath: "/v1/itsm/incidents/inc-1", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("PATCH", "itsm/incidents/inc-1/major-incident"), { backendPath: "/v1/itsm/incidents/inc-1/major-incident", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("DELETE", "itsm/incidents/operations/saved-views/view-1"), { backendPath: "/v1/itsm/incidents/operations/saved-views/view-1", body: "none", status: 204 });
  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/users"), { backendPath: "/v1/itsm/admin/users", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/users/user-1"), { backendPath: "/v1/itsm/admin/users/user-1", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/users/invite"), { backendPath: "/v1/itsm/admin/users/invite", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/users/create"), { backendPath: "/v1/itsm/admin/users/create", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/users/user-1/access"), { backendPath: "/v1/itsm/admin/users/user-1/access", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("PUT", "itsm/admin/users/user-1/access"), { backendPath: "/v1/itsm/admin/users/user-1/access", body: "json", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/users/user-1/deactivate"), { backendPath: "/v1/itsm/admin/users/user-1/deactivate", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("DELETE", "itsm/admin/users/user-1"), { backendPath: "/v1/itsm/admin/users/user-1", body: "none", status: 204 });
  assert.equal(resolveBffRoute("DELETE", "itsm/incidents/inc-1"), null);
  assert.equal(resolveBffRoute("DELETE", "itsm/admin/users"), null);
  assert.equal(resolveBffRoute("DELETE", "users/me"), null);
  assert.equal(resolveBffRoute("POST", "auth/login"), null);
  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/teams"), { backendPath: "/v1/itsm/admin/teams", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/service-catalog"), { backendPath: "/v1/itsm/admin/service-catalog", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/service-catalog"), { backendPath: "/v1/itsm/admin/service-catalog", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/sla-policies"), { backendPath: "/v1/itsm/admin/sla-policies", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/sla-policies"), { backendPath: "/v1/itsm/admin/sla-policies", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("GET", "itsm/admin/business-calendars"), { backendPath: "/v1/itsm/admin/business-calendars", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/admin/business-calendars"), { backendPath: "/v1/itsm/admin/business-calendars", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("GET", "itsm/attachments/att-1/download"), { backendPath: "/v1/itsm/attachments/att-1/download", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("GET", "itsm/incidents/inc-1/attachments"), { backendPath: "/v1/itsm/incidents/inc-1/attachments", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/incidents/inc-1/attachments"), { backendPath: "/v1/itsm/incidents/inc-1/attachments", body: "json", status: 201 });
  assert.deepEqual(resolveBffRoute("GET", "itsm/requests/req-1/attachments"), { backendPath: "/v1/itsm/requests/req-1/attachments", body: "none", status: undefined });
  assert.deepEqual(resolveBffRoute("POST", "itsm/requests/req-1/attachments"), { backendPath: "/v1/itsm/requests/req-1/attachments", body: "json", status: 201 });
  assert.equal(resolveBffRoute("GET", "itsm/admin/slas"), null);
});
