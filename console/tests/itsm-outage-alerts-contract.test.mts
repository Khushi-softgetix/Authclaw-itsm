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
  assert.equal(resolveBffRoute("GET", "itsm/outage-alerts/delivery-health")?.backendPath, "/v1/itsm/outage-alerts/delivery-health");
  assert.equal(resolveBffRoute("GET", "itsm/outage-alerts/alert-id/recipients")?.backendPath, "/v1/itsm/outage-alerts/alert-id/recipients");
  assert.equal(resolveBffRoute("POST", "itsm/outage-alerts/alert-id/links")?.backendPath, "/v1/itsm/outage-alerts/alert-id/links");
  assert.equal(resolveBffRoute("DELETE", "itsm/outage-alerts/alert-id/links/INCIDENT/record-id")?.backendPath, "/v1/itsm/outage-alerts/alert-id/links/INCIDENT/record-id");
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
  assert.doesNotMatch(create, /How should the resolution work be tracked\?/);
  assert.match(create, /Related records and internal notes/);
  assert.match(create, /Incident needed/);
  assert.match(create, /Choose how resolution work will be tracked/);
  assert.match(create, /const drawerSummaryClass/);
  assert.match(create, /\[&::-webkit-details-marker\]:hidden/);
  assert.match(create, /openDrawer === "IMPACT"/);
  assert.match(create, /openDrawer === "CIS"/);
  assert.match(create, /openDrawer === "RECIPIENTS"/);
  assert.match(create, /openDrawer === "RECORDS"/);
  assert.doesNotMatch(create, /bg-\[#FFF9ED\]/);
  assert.match(create, /Creating an Incident saves this Alert as a private draft/);
  assert.match(create, /Resolution work is tracked in/);
  assert.match(create, /Link existing Incident/);
  assert.match(create, /Create new Incident/);
  assert.match(create, /Visible only to authorized Incident Managers and Auditors/);
  assert.match(create, /save_action/);
  assert.match(create, /outage_alert_id/);
  assert.doesNotMatch(create, /disabled=\{value === "SOLVE"/);
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

test("company-wide portal alerts are explicit, service-optional, and confirmed before publication", () => {
  const create = read("../src/app/(console)/itsm/incident-manager/outage-alerts/create/page.tsx");
  const detail = read("../src/app/(console)/itsm/incident-manager/outage-alerts/[alertId]/page.tsx");
  const banner = read("../src/components/itsm/outage-alert-banner.tsx");
  const evidence = read("../src/components/itsm/alert-recipient-evidence-dialog.tsx");

  assert.match(create, /ALL_PORTAL_USERS/);
  assert.match(create, /Everyone in the organization/);
  assert.match(create, /Notify all active employee-facing portal users in this organization/);
  assert.match(create, /Affected services are optional for this audience/);
  assert.match(detail, /confirm_tenant_wide/);
  assert.match(detail, /I confirm this organization-wide publication/);
  assert.match(detail, /preview\.total_recipients/);
  assert.match(banner, /PROBLEM_CHANGE_MANAGER/);
  assert.match(banner, /SERVICE_LEAD/);
  assert.match(evidence, /Everyone in the organization/);
});

test("alert composer keeps draft feedback and recipient eligibility guidance in context", () => {
  const create = read("../src/app/(console)/itsm/incident-manager/outage-alerts/create/page.tsx");
  assert.match(create, /Draft readiness/);
  assert.match(create, /Saved successfully/);
  assert.match(create, /aria-live="polite"/);
  assert.match(create, /This person is not eligible for the selected services or linked records/);
  assert.match(create, /open=\{openDrawer === "RECIPIENTS"\}/);
  assert.match(create, /Publishing remains a separate, intentional action on the alert detail page/);
  assert.match(create, /sticky bottom-3/);
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

test("Requester alert links remain reachable and non-recipient roles do not get the business banner", () => {
  const itsmLayout = read("../src/app/(console)/itsm/layout.tsx");
  const shell = read("../src/components/console-shell.tsx");
  const banner = read("../src/components/itsm/outage-alert-banner.tsx");

  assert.match(itsmLayout, /currentPath === "\/itsm\/outage-alerts"/);
  assert.match(itsmLayout, /currentPath\.startsWith\("\/itsm\/outage-alerts\/"\)/);
  assert.match(shell, /<OutageAlertBanner itsmRole=\{effectiveItsmRole\}/);
  assert.match(banner, /receivesBusinessAlerts/);
  assert.match(banner, /window\.setInterval\(load, 45_000\)/);
  assert.match(banner, /\\u00B7/);
  assert.doesNotMatch(banner, /"AUDITOR"/);
  assert.doesNotMatch(banner, /"PLATFORM_ADMINISTRATOR"/);
});

test("Incident Manager publishes explicit customer status through the protected workflow", () => {
  const detail = read("../src/app/(console)/itsm/incident-manager/outage-alerts/[alertId]/page.tsx");
  assert.match(detail, /projection_type/);
  assert.match(detail, /projection_type\.replaceAll/);
  assert.match(detail, /INVESTIGATING/);
  assert.match(detail, /IDENTIFIED/);
  assert.match(detail, /MONITORING/);
  assert.match(detail, /public_status/);
  assert.match(detail, /operation === "RECOVERY" \? "RECOVERED"/);
  assert.match(detail, /Last public update/);
  assert.doesNotMatch(detail, /label="Last published"/);
});

test("Incident Manager can inspect large recipient sets without rendering every user at once", () => {
  const detail = read("../src/app/(console)/itsm/incident-manager/outage-alerts/[alertId]/page.tsx");
  const dialog = read("../src/components/itsm/alert-recipient-evidence-dialog.tsx");

  assert.match(detail, /Recipient delivery records/);
  assert.match(detail, /View recipients/);
  assert.match(detail, /AlertRecipientEvidenceDialog/);
  assert.match(dialog, /PAGE_SIZE = 25/);
  assert.match(dialog, /Search by recipient email/);
  assert.match(dialog, /audience_type/);
  assert.match(dialog, /delivery_status/);
  assert.match(dialog, /acknowledgement/);
  assert.match(dialog, /Why included/);
  assert.match(dialog, /Authorized information and actions/);
  assert.match(dialog, /Published version/);
  assert.match(dialog, /Showing \{firstResult\.toLocaleString\(\)\}/);
});

test("Incident Manager can manage audited operational links after publication", () => {
  const detail = read("../src/app/(console)/itsm/incident-manager/outage-alerts/[alertId]/page.tsx");
  const linkManager = read("../src/components/itsm/alert-link-manager.tsx");

  assert.match(detail, /AlertLinkManager/);
  assert.match(detail, /allowed_actions\.includes\("LINK_RECORD"\)/);
  assert.match(linkManager, /kind: "RELATED_RECORD"/);
  assert.match(linkManager, /Existing publication snapshots are never rewritten/);
  assert.match(linkManager, /method: "POST"/);
  assert.match(linkManager, /method: "DELETE"/);
  assert.match(linkManager, /future updates may change/);
});

test("Auditor has a discoverable read-only Outage Alert evidence experience", () => {
  const shell = read("../src/components/console-shell.tsx");
  const layout = read("../src/app/(console)/itsm/dashboard/auditor/layout.tsx");
  const list = read("../src/app/(console)/itsm/dashboard/auditor/outage-alerts/page.tsx");
  const detail = read("../src/app/(console)/itsm/outage-alerts/[alertId]/page.tsx");
  assert.match(shell, /Outage Evidence/);
  assert.match(layout, /!== "AUDITOR"/);
  assert.match(list, /Read-only workspace/);
  assert.match(list, /More filters/);
  assert.match(list, /Search alert number, title, or service/);
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
  assert.match(detail, /alert\.projection_type === "AUDITOR"[\s\S]*?"\/itsm\/dashboard\/auditor\/outage-alerts"/);
  assert.match(detail, /alert\.projection_type === "AUDITOR"[\s\S]*?"Back to outage evidence"/);

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

test("Platform Administrator: Broadcast health monitoring, delivery telemetry, and segregation of duties", () => {
  const shell = read("../src/components/admin-portal-shell.tsx");
  const dashboard = read("../src/app/(console)/itsm/dashboard/platform-admin/page.tsx");
  const healthPage = read("../src/app/(console)/itsm/admin-portal/broadcast-health/page.tsx");
  const detail = read("../src/app/(console)/itsm/outage-alerts/[alertId]/page.tsx");

  // 1. Navigation Shell includes Broadcast Health
  assert.match(shell, /\/itsm\/admin-portal\/broadcast-health/);
  assert.match(shell, /Broadcast Health/);

  // 2. Platform Admin Dashboard includes Broadcast Delivery & Diagnostics card
  assert.match(dashboard, /\/itsm\/admin-portal\/broadcast-health/);
  assert.match(dashboard, /Broadcast Delivery (?:&|&amp;) Diagnostics/);
  assert.doesNotMatch(dashboard, /\/api\/itsm\/incidents/);
  assert.doesNotMatch(dashboard, /href="\/itsm\/incidents"/);

  // 3. Broadcast Health page implements delivery telemetry & diagnostic controls
  assert.match(healthPage, /alertApi<AlertDeliveryHealthPage>/);
  assert.match(healthPage, /\/delivery-health/);
  assert.match(healthPage, /total_broadcasts/);
  assert.match(healthPage, /total_delivered/);
  assert.match(healthPage, /total_retrying/);
  assert.match(healthPage, /total_failed/);
  assert.match(healthPage, /Notification Channel (?:&|&amp;) Delivery Connectors/);
  assert.match(healthPage, /Broadcast Delivery Telemetry (?:&|&amp;) Diagnostics/);
  assert.match(healthPage, /Segregation of Duties/);

  // Does not allow authoring or publishing business alerts
  assert.doesNotMatch(healthPage, /method[=:]\s*["']POST/);
  assert.doesNotMatch(healthPage, /\/publish/);
  assert.doesNotMatch(healthPage, /Create alert/i);

  // 4. Detail page projection handles DELIVERY_OPERATOR
  assert.match(detail, /alert\.projection_type === "DELIVERY_OPERATOR"/);
  assert.match(detail, /\/itsm\/admin-portal\/broadcast-health/);
  assert.match(detail, /Back to broadcast delivery health/);
  assert.match(detail, /DeliveryOperatorDiagnostics/);
  assert.match(detail, /Broadcasting delivery diagnostics/);
  assert.match(detail, /Dispatched recipients/);
  assert.match(detail, /Retrying in queue/);
  assert.match(detail, /Notification transport channels/);
});


