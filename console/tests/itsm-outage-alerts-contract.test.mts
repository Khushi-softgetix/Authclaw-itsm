import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("BFF exposes the protected alert lifecycle and targeting routes", () => {
  assert.equal(resolveBffRoute("GET", "itsm/outage-alerts")?.backendPath, "/v1/itsm/outage-alerts");
  assert.equal(resolveBffRoute("GET", "itsm/outage-alerts/reference-data")?.backendPath, "/v1/itsm/outage-alerts/reference-data");
  assert.equal(resolveBffRoute("GET", "itsm/outage-alerts/reference-options")?.backendPath, "/v1/itsm/outage-alerts/reference-options");
  assert.equal(resolveBffRoute("POST", "itsm/outage-alerts/alert-id/preview")?.backendPath, "/v1/itsm/outage-alerts/alert-id/preview");
  assert.equal(resolveBffRoute("POST", "itsm/outage-alerts/alert-id/recovery")?.backendPath, "/v1/itsm/outage-alerts/alert-id/recovery");
  assert.equal(resolveBffRoute("PUT", "itsm/outage-alerts/services/service-id/consumers/user-id")?.backendPath, "/v1/itsm/outage-alerts/services/service-id/consumers/user-id");
});

test("Incident Manager navigation and full-page alert routes remain authoritative", () => {
  const shell = read("../src/components/incident-manager-shell.tsx");
  const list = read("../src/app/(console)/itsm/incident-manager/outage-alerts/page.tsx");
  const detail = read("../src/app/(console)/itsm/incident-manager/outage-alerts/[alertId]/page.tsx");
  assert.match(shell, /\/itsm\/incident-manager\/outage-alerts/);
  assert.match(list, /Create alert/);
  assert.match(detail, /Back to alert list/);
  assert.doesNotMatch(detail, /split.panel/i);
});

test("create alert uses scalable authorized reference search instead of bulk choice grids", () => {
  const create = read("../src/app/(console)/itsm/incident-manager/outage-alerts/create/page.tsx");
  assert.match(create, /reference-options/);
  assert.match(create, /SearchableChoicePicker/);
  assert.match(create, /Showing \{page\.items\.length\} of \{page\.total\}/);
  assert.match(create, /recordType=\{relatedRecordType\}/);
  assert.match(create, /method: editingAlert \? "PUT" : "POST"/);
  assert.match(create, /This alert is not an editable draft/);
  assert.match(create, /PROBLEM_MANAGERS/);
  assert.match(create, /CHANGE_MANAGERS/);
  assert.match(create, /SPECIFIC_USER/);
  assert.match(create, /related_records/);
  assert.match(create, /const hasIncidentLink/);
  assert.match(create, /How should the resolution work be tracked\?/);
  assert.match(create, /Link existing Incident/);
  assert.match(create, /Create new Incident/);
  assert.match(create, /save_action/);
  assert.match(create, /outage_alert_id/);
  assert.doesNotMatch(create, /value === "SOLVE" && !hasIncidentLink/);
  assert.doesNotMatch(create, /function ChoiceGrid/);
});

test("explicit Incident creation returns to the preserved alert draft and links the record", () => {
  const incidentCreate = read("../src/app/(console)/itsm/incidents/new/page.tsx");
  assert.match(incidentCreate, /outage_alert_id/);
  assert.match(incidentCreate, /Create Incident for outage work/);
  assert.match(incidentCreate, /Return and link Incident/);
  assert.match(incidentCreate, /related_type=INCIDENT&related_id=/);
  assert.match(incidentCreate, /service_id: incidentServiceId/);
});

test("service administration uses scalable alert recipient rules", () => {
  const services = read("../src/app/(console)/itsm/admin-portal/services/page.tsx");
  assert.match(services, /Alert recipient sources/);
  assert.match(services, /Company-wide service/);
  assert.match(services, /Access-controlled service/);
  assert.match(services, /Search support teams/);
  assert.match(services, /apiErrorMessage/);
  assert.doesNotMatch(services, /targeting\.requesters\.map/);
  assert.doesNotMatch(services, /Who should receive alerts for this service\?/);
});

test("recipient page and banner consume only backend-projected alert data", () => {
  const detail = read("../src/app/(console)/itsm/outage-alerts/[alertId]/page.tsx");
  const list = read("../src/app/(console)/itsm/outage-alerts/page.tsx");
  const banner = read("../src/components/itsm/outage-alert-banner.tsx");
  assert.match(detail, /alertApi<AlertDetail>/);
  assert.match(detail, /allowed_actions\.includes\("ACKNOWLEDGE"\)/);
  assert.match(detail, /Outage started/);
  assert.match(detail, /Last public update/);
  assert.match(detail, /Recovered at/);
  assert.match(detail, /content\.latest_publication_at/);
  assert.match(detail, /HistoryField label="Impact"/);
  assert.match(detail, /HistoryField label="What to do"/);
  assert.match(detail, /Expected next update/);
  assert.match(banner, /alertApi<AlertSummary\[]>\("\/active"\)/);
  assert.match(banner, /primary\.latest_publication_at/);
  assert.match(banner, /formatPublicStatus\(primary\.public_status\)/);
  assert.match(list, /\?status=ACTIVE/);
  assert.match(list, /\?status=RECOVERED/);
  assert.match(list, /alert\.latest_publication_at/);
  assert.doesNotMatch(`${detail}\n${banner}\n${list}`, /Ã|Â|â€¦|â€¢/);
});

test("Incident Manager publishes explicit customer status through the protected workflow", () => {
  const detail = read("../src/app/(console)/itsm/incident-manager/outage-alerts/[alertId]/page.tsx");
  assert.match(detail, /INVESTIGATING/);
  assert.match(detail, /IDENTIFIED/);
  assert.match(detail, /MONITORING/);
  assert.match(detail, /public_status/);
  assert.match(detail, /operation === "RECOVERY" \? "RECOVERED"/);
  assert.match(detail, /Last public update/);
  assert.doesNotMatch(detail, /label="Last published"/);
});

test("Auditor has a discoverable read-only Outage Alert evidence experience", () => {
  const shell = read("../src/components/console-shell.tsx");
  const layout = read("../src/app/(console)/itsm/dashboard/auditor/layout.tsx");
  const list = read("../src/app/(console)/itsm/dashboard/auditor/outage-alerts/page.tsx");
  const detail = read("../src/app/(console)/itsm/outage-alerts/[alertId]/page.tsx");
  assert.match(shell, /Outage Evidence/);
  assert.match(layout, /!== "AUDITOR"/);
  assert.match(list, /Read-only evidence/);
  assert.match(list, /alertApi<AlertSummary\[]>/);
  assert.doesNotMatch(list, /method[=:]\s*["']POST|\/publish|\/recovery/);
  assert.match(detail, /projection_type === "AUDITOR"/);
  assert.match(detail, /Delivery results/);
});
