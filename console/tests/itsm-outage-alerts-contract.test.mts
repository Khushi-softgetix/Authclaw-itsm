import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";
import {
  canOpenLinkedIncident,
  getAlertIncidentLinks,
  getAlertProcessLinks,
  getPrimaryIncidentLink,
  getProcessLinkHref,
  type AlertDetail,
} from "../src/lib/outage-alerts.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("BFF exposes the protected alert lifecycle and targeting routes", () => {
  assert.equal(resolveBffRoute("GET", "itsm/outage-alerts")?.backendPath, "/v1/itsm/outage-alerts");
  assert.equal(resolveBffRoute("GET", "itsm/outage-alerts/reference-data")?.backendPath, "/v1/itsm/outage-alerts/reference-data");
  assert.equal(resolveBffRoute("GET", "itsm/outage-alerts/reference-options")?.backendPath, "/v1/itsm/outage-alerts/reference-options");
  assert.equal(resolveBffRoute("GET", "itsm/outage-alerts/auditor-evidence")?.backendPath, "/v1/itsm/outage-alerts/auditor-evidence");
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

test("alert composer presents intent and audiences as accessible scalable decisions", () => {
  const create = read("../src/app/(console)/itsm/incident-manager/outage-alerts/create/page.tsx");
  assert.match(create, /<fieldset/);
  assert.match(create, /<legend className="sr-only">Communication intent<\/legend>/);
  assert.match(create, /Who should receive this alert\?/);
  assert.match(create, /Select audience groups—not individual people\./);
  assert.match(create, /Recipients are resolved automatically\./);
  assert.match(create, /service access, support-team coverage, and service ownership/);
  assert.match(create, /focus-within:ring-2/);
  assert.doesNotMatch(create, /lg:grid-cols-4/);
  assert.doesNotMatch(create, /Primary recipient audiences/);
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
  assert.match(list, /Independent, read-only review/);
  assert.match(list, /alertApi<AlertEvidencePage>/);
  assert.match(list, /\/auditor-evidence/);
  assert.match(list, /Apply filters/);
  assert.doesNotMatch(list, /method[=:]\s*["']POST|\/publish|\/recovery/);
  assert.match(detail, /projection_type === "AUDITOR"/);
  assert.match(detail, /Delivery evidence/);
});

test("SA-01 to SA-04: Service Agent visibility, guidance fallback, severity/intent, and incident link actions", () => {
  const detail = read("../src/app/(console)/itsm/outage-alerts/[alertId]/page.tsx");

  // 1. Component logic: Full Service Agent projection with guidance, links, and granted action
  const fullAgentAlert: AlertDetail = {
    id: "alert-sa-1",
    alert_number: "OUT-0001",
    status: "ACTIVE",
    projection_type: "SERVICE_AGENT",
    content: {
      title: "Core Payment Gateway Degraded",
      severity: "SEV1_CRITICAL",
      intent: "RESOLVE",
      service_agent_guidance: "Triage failed payment queues and route customers to fallback processor.",
      service_agent_handling: "SOLVE",
    },
    allowed_actions: ["VIEW", "ACKNOWLEDGE", "OPEN_LINKED_INCIDENT"],
    affected_services: [{ id: "srv-1", name: "Payment Services" }],
    links: [
      { type: "INCIDENT", id: "inc-101" },
      { type: "MAJOR_INCIDENT", id: "maj-202" },
    ],
    publications: [],
  };

  const incidentLinks = getAlertIncidentLinks(fullAgentAlert.links);
  assert.equal(incidentLinks.length, 2);
  assert.equal(incidentLinks[0].id, "inc-101");
  assert.equal(incidentLinks[1].id, "maj-202");

  const primaryLink = getPrimaryIncidentLink(fullAgentAlert.links);
  assert.equal(primaryLink?.id, "inc-101");
  assert.equal(primaryLink?.type, "INCIDENT");

  assert.equal(canOpenLinkedIncident(fullAgentAlert), true);

  // 2. Component logic: Sparse Service Agent projection (no guidance, no links, no granted action)
  const sparseAgentAlert: AlertDetail = {
    id: "alert-sa-2",
    alert_number: "OUT-0002",
    status: "ACTIVE",
    projection_type: "SERVICE_AGENT",
    content: {
      title: "DNS Cache Issue",
    },
    allowed_actions: ["VIEW", "ACKNOWLEDGE"],
    affected_services: [{ id: "srv-2", name: "Corporate DNS" }],
    links: [],
    publications: [],
  };

  assert.deepEqual(getAlertIncidentLinks(sparseAgentAlert.links), []);
  assert.equal(getPrimaryIncidentLink(sparseAgentAlert.links), null);
  assert.equal(canOpenLinkedIncident(sparseAgentAlert), false);

  // 3. Component logic: Links present but OPEN_LINKED_INCIDENT not granted
  const noActionAlert: AlertDetail = {
    ...fullAgentAlert,
    allowed_actions: ["VIEW", "ACKNOWLEDGE"],
  };
  assert.equal(canOpenLinkedIncident(noActionAlert), false);

  // 4. Component logic: OPEN_LINKED_INCIDENT granted but no incident links authorized
  const noLinksAlert: AlertDetail = {
    ...fullAgentAlert,
    links: [],
  };
  assert.equal(canOpenLinkedIncident(noLinksAlert), false);

  // 5. Source contracts in page.tsx
  // SA-01: Operational guidance block and fallback
  assert.match(detail, /alert\.projection_type === "SERVICE_AGENT"/);
  assert.match(detail, /Operational support guidance/);
  assert.match(detail, /content\.service_agent_guidance/);
  assert.match(detail, /No specific agent guidance was issued for this alert\./);
  assert.match(detail, /content\.service_agent_handling/);

  // SA-02: Open linked incident guarded by allowed_actions and link existence
  assert.match(detail, /canOpenLinkedIncident && primaryIncidentLink/);
  assert.match(detail, /href=\{`\/itsm\/incidents\/\$\{primaryIncidentLink\.id\}`\}/);
  assert.match(detail, /Open linked incident/);

  // SA-03: Severity and Intent rendered
  assert.match(detail, /content\.severity/);
  assert.match(detail, /content\.intent/);

  // SA-04: Mapping over every authorized incident link with fallback
  assert.match(detail, /incidentLinks\.map/);
  assert.match(detail, /href=\{`\/itsm\/incidents\/\$\{link\.id\}`\}/);
  assert.match(detail, /No authorized incidents are currently linked to this alert\./);
});

test("PCM-01 and PCM-02: Process Manager visibility for Problem and Change records, routes, and severity/intent", () => {
  const detail = read("../src/app/(console)/itsm/outage-alerts/[alertId]/page.tsx");

  // 1. Component logic: Process Manager with Problem links, Change links, multiple links
  const pcmAlert: AlertDetail = {
    id: "alert-pcm-1",
    alert_number: "OUT-0003",
    status: "ACTIVE",
    projection_type: "PROCESS_MANAGER",
    content: {
      title: "Database Cluster Failover",
      severity: "SEV2_HIGH",
      intent: "INVESTIGATE",
    },
    allowed_actions: ["VIEW", "ACKNOWLEDGE"],
    affected_services: [{ id: "srv-3", name: "Core Database" }],
    links: [
      { type: "PROBLEM", id: "prob-401" },
      { type: "CHANGE", id: "chg-502" },
      { type: "PROBLEM", id: "prob-403" },
      { type: "INCIDENT", id: "inc-unauthorized-for-pcm" },
    ],
    publications: [],
  };

  const processLinks = getAlertProcessLinks(pcmAlert.links);
  assert.equal(processLinks.length, 3);
  assert.deepEqual(processLinks.map((l) => l.id), ["prob-401", "chg-502", "prob-403"]);

  assert.equal(getProcessLinkHref({ type: "PROBLEM", id: "prob-401" }), "/itsm/problem-change-manager/problems/prob-401");
  assert.equal(getProcessLinkHref({ type: "CHANGE", id: "chg-502" }), "/itsm/problem-change-manager/changes/chg-502");
  assert.equal(getProcessLinkHref({ type: "INCIDENT", id: "inc-1" }), null);
  assert.equal(getProcessLinkHref(null), null);

  // 2. Component logic: Empty process links
  assert.deepEqual(getAlertProcessLinks([]), []);

  // 3. Source contracts in page.tsx
  assert.match(detail, /alert\.projection_type === "PROCESS_MANAGER"/);
  assert.match(detail, /Associated investigation records/);
  assert.match(detail, /Problem and Change records assigned to your queue for this outage\./);
  assert.match(detail, /processLinks\.length/);
  assert.match(detail, /processLinks\.map/);
  assert.match(detail, /isProblem \? "Problem Record" : "Change Request"/);
  assert.match(detail, /getProcessLinkHref\(link\)/);
  assert.match(detail, /No operational records are currently linked to your queue for this alert\./);
});

test("Requester projection remains strictly isolated from operational guidance, severity/intent, and internal links", () => {
  const detail = read("../src/app/(console)/itsm/outage-alerts/[alertId]/page.tsx");

  const requesterAlert: AlertDetail = {
    id: "alert-req-1",
    alert_number: "OUT-0004",
    status: "ACTIVE",
    projection_type: "REQUESTER",
    content: {
      title: "Email System Maintenance",
      public_status: "MONITORING",
      public_summary: "Email delivery delays are currently being monitored.",
      impact_summary: "Outbound emails may take up to 10 minutes to arrive.",
      recommended_action: "No user action required.",
    },
    allowed_actions: ["VIEW", "ACKNOWLEDGE"],
    affected_services: [{ id: "srv-4", name: "Corporate Email" }],
    links: [],
    publications: [],
  };

  // Logic: Requester has no operational links and cannot open incidents
  assert.deepEqual(getAlertIncidentLinks(requesterAlert.links), []);
  assert.deepEqual(getAlertProcessLinks(requesterAlert.links), []);
  assert.equal(canOpenLinkedIncident(requesterAlert), false);
  assert.equal(requesterAlert.content.severity, undefined);
  assert.equal(requesterAlert.content.intent, undefined);
  assert.equal(requesterAlert.content.service_agent_guidance, undefined);

  // Source contracts: Page guards operational sections by role projection
  assert.match(detail, /alert\.projection_type === "SERVICE_AGENT"/);
  assert.match(detail, /alert\.projection_type === "PROCESS_MANAGER"/);
  assert.match(detail, /alert\.projection_type === "AUDITOR"/);

  // None of the internal sections or links render without authorized backend role projections
  assert.doesNotMatch(detail, /alert\.projection_type === "REQUESTER"[\s\S]*?Operational support guidance/);
  assert.doesNotMatch(detail, /alert\.projection_type === "REQUESTER"[\s\S]*?Associated investigation records/);
});

test("Auditor evidence is structured, restricted, and read-only", () => {
  const detail = read("../src/app/(console)/itsm/outage-alerts/[alertId]/page.tsx");

  // Auditor navigation points to auditor dashboard evidence
  assert.match(detail, /alert\.projection_type === "AUDITOR" \? "\/itsm\/dashboard\/auditor\/outage-alerts" : "\/itsm\/outage-alerts"/);
  assert.match(detail, /alert\.projection_type === "AUDITOR" \? "Back to outage evidence" : "Back to service alerts"/);

  // Auditor evidence renders governance evidence without restricted notes.
  assert.match(detail, /alert\.projection_type === "AUDITOR"/);
  assert.match(detail, /Governance summary/);
  assert.match(detail, /Audience &amp; recipient resolution/);
  assert.match(detail, /Tamper-evident event timeline/);
  assert.doesNotMatch(detail, /Internal operational notes/);
  assert.match(detail, /Related records/);
  assert.match(detail, /Delivery evidence/);
});

test("Unauthorized links are never reconstructed, guessed, or fetched independently by the frontend", () => {
  const detail = read("../src/app/(console)/itsm/outage-alerts/[alertId]/page.tsx");

  // Recipient page only interacts with authorized alert APIs
  assert.match(detail, /alertApi<AlertDetail>\(`\/\$\{alertId\}`\)/);
  assert.match(detail, /alertApi\(`\/\$\{alertId\}\/acknowledge`/);

  // No unauthorized secondary fetches to bypass role scoping
  assert.doesNotMatch(detail, /fetch\(["'`]\/api\/itsm\/(?:incidents|problems|changes|tickets)/);
  assert.doesNotMatch(detail, /alertApi<[^>]*>\(["'`]\/(?:incidents|problems|changes)/);
});

