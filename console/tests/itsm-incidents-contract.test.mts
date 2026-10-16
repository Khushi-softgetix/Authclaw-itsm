import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activityActor, activityContent, activityLabel, latestActivities } from "../src/lib/incident-activity-presentation.ts";
import type { IncidentActivity } from "../src/lib/itsm-types.ts";
import {
  itsmAllowedTransitions,
  itsmPriorityConfig,
  itsmStatusConfig,
} from "../src/lib/itsm-format.ts";

test("Major Incident keeps command ownership and delegates public communication to Outage & Alerts", () => {
  const page = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/major-incidents/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const commanders = references.commanders \|\| \[\]/);
  assert.match(page, /commanders.map/);
  assert.match(page, /Related Outage &amp; Alert/);
  assert.match(page, /linked_type=MAJOR_INCIDENT/);
  assert.match(page, /Public service communication is managed in Outage &amp; Alerts/);
  assert.doesNotMatch(page, /function CommunicationLog/);
  assert.match(page, /delete payload.postmortem_url/);
});

test("ITSM status transitions match approved Phase 3.2 lifecycle", () => {
  assert.deepEqual(itsmAllowedTransitions("NEW"), ["ASSIGNED", "IN_PROGRESS", "CANCELLED"]);
  assert.deepEqual(itsmAllowedTransitions("ASSIGNED"), ["IN_PROGRESS", "CANCELLED"]);
  assert.deepEqual(itsmAllowedTransitions("IN_PROGRESS"), ["PENDING", "RESOLVED", "CANCELLED"]);
  assert.deepEqual(itsmAllowedTransitions("PENDING"), ["IN_PROGRESS", "RESOLVED", "CANCELLED"]);
  assert.deepEqual(itsmAllowedTransitions("RESOLVED"), ["CLOSED", "IN_PROGRESS"]);
  assert.deepEqual(itsmAllowedTransitions("CLOSED"), []);
  assert.deepEqual(itsmAllowedTransitions("CANCELLED"), []);
  assert.deepEqual(itsmAllowedTransitions("UNKNOWN_STATE"), []);
});

test("ITSM priority config maps P1-P4 without inventing P5", () => {
  const p1 = itsmPriorityConfig("P1");
  assert.match(p1.label, /P1/);
  assert.match(p1.badge, /red/);

  const p2 = itsmPriorityConfig("P2");
  assert.match(p2.label, /P2/);
  assert.match(p2.badge, /orange/);

  const p3 = itsmPriorityConfig("P3");
  assert.match(p3.label, /P3/);
  assert.match(p3.badge, /yellow/);

  const p4 = itsmPriorityConfig("P4");
  assert.match(p4.label, /P4/);
  assert.match(p4.badge, /blue/);

  const normCritical = itsmPriorityConfig("P1_CRITICAL");
  assert.match(normCritical.label, /P1/);

  // Fallback for unknown
  const unknown = itsmPriorityConfig("P5");
  assert.equal(unknown.label, "P5");
  assert.match(unknown.badge, /slate/);
});

test("ITSM status config handles all approved lifecycle statuses", () => {
  const statuses = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED", "CANCELLED"];
  for (const st of statuses) {
    const config = itsmStatusConfig(st);
    assert.ok(config.label.length > 0);
    assert.ok(config.badge.length > 0);
    assert.ok(config.dot.length > 0);
  }
});

test("Major Incident command workspace preserves command work while public delivery uses Outage & Alerts", () => {
  const commandPage = readFileSync(
    new URL("../src/app/(console)/itsm/incident-manager/major-incidents/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(commandPage, /Command & coordination/);
  assert.match(commandPage, /Restoration checkpoints/);
  assert.match(commandPage, /Related Outage &amp; Alert/);
  assert.match(commandPage, /Create \/ link alert/);
  assert.doesNotMatch(commandPage, /Record communication/);
});

test("Incident Manager coordination uses tenant reference data for classification, assignment, and Major Incident scope", () => {
  const drawer = readFileSync(new URL("../src/components/itsm/incident-oversight-drawer.tsx", import.meta.url), "utf8");
  const assignment = readFileSync(new URL("../src/components/itsm/assign-modal.tsx", import.meta.url), "utf8");
  const classification = readFileSync(new URL("../src/components/itsm/incident-classification-modal.tsx", import.meta.url), "utf8");
  const commandPage = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/major-incidents/page.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/layout.tsx", import.meta.url), "utf8");

  assert.match(drawer, /operations\/reference-data/);
  assert.match(classification, /configuration_item_id/);
  assert.match(classification, /service_id: serviceId \|\| null/);
  assert.match(classification, /category_id: categoryId \|\| null/);
  assert.match(classification, /configuration_item_id: configurationItemId \|\| null/);
  assert.match(assignment, /Choose an active operational team/);
  assert.match(assignment, /No active operational teams are configured/);
  assert.match(assignment, /id="assignee-search"/);
  assert.match(assignment, /Search by email or role/);
  assert.match(assignment, /id="group-search"/);
  assert.match(assignment, /Search active teams/);
  assert.match(assignment, /role="combobox"/);
  assert.match(assignment, /role="listbox"/);
  assert.match(assignment, /filteredOptions\.map/);
  assert.match(assignment, /activeIndex/);
  assert.match(assignment, /referenceEndpoint \? \(/);
  assert.match(assignment, /COMMON_GROUPS/);
  assert.match(drawer, /referenceEndpoint="\/api\/itsm\/incidents\/operations\/reference-data"/);
  assert.match(commandPage, /affected_service_ids/);
  assert.match(commandPage, /affected_configuration_item_ids/);
  assert.match(layout, /itsmRole !== "INCIDENT_MANAGER"/);
  assert.doesNotMatch(layout, /itsmRole !== "SERVICE_LEAD"/);
});

test("Incident Manager MVP exposes governed priority, resolution evidence, and persisted queue views", () => {
  const drawer = readFileSync(new URL("../src/components/itsm/incident-oversight-drawer.tsx", import.meta.url), "utf8");
  const queue = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/incidents/page.tsx", import.meta.url), "utf8");
  assert.match(drawer, /Priority override reason/);
  assert.match(drawer, /Resolution code/);
  assert.match(drawer, /Resolution summary/);
  assert.match(queue, /operations\/saved-views/);
  assert.match(queue, /Saved views/);
});

test("Incident Manager navigation and overview expose the approved control-center signals", () => {
  const shell = readFileSync(new URL("../src/components/incident-manager-shell.tsx", import.meta.url), "utf8");
  const overview = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/page.tsx", import.meta.url), "utf8");
  assert.match(shell, /label: "Overview"/);
  assert.match(shell, /label: "Incidents"/);
  assert.match(shell, /label: "Major Incidents"/);
  assert.doesNotMatch(shell, /Incident Queue|Major incident command/);
  assert.match(overview, /summary\.unassigned/);
  assert.match(overview, /summary\.active_major_incidents/);
  assert.match(overview, /assignment_group=__UNASSIGNED__&unassigned=true/);
  assert.match(overview, /Queue overview/);
  assert.match(overview, /function QueueSummaryLink/);
  assert.match(overview, /function AttentionFilter/);
  assert.match(overview, /Focus attention/);
  assert.match(overview, /Filter worklist/);
  assert.match(overview, /Critical or high priority/);
  assert.match(overview, /Deadline missed/);
  assert.match(overview, /Deadline approaching/);
  assert.match(overview, /No recent activity/);
  assert.match(overview, />Attention reason</);
  assert.match(overview, />Ownership</);
  assert.match(overview, /How attention is calculated/);
  assert.match(overview, /role="button" aria-label=\{`Review \$\{item\.ticket_number\}: \$\{item\.title\}`\}/);
  assert.match(overview, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(overview, /aria-label=\{`Review \$\{item\.ticket_number\}: \$\{item\.title\}`\}/);
  assert.doesNotMatch(overview, /<NotificationBell/);
});

test("Incident queue connects service and category filters to backend query parameters", () => {
  const queue = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/incidents/page.tsx", import.meta.url), "utf8");
  assert.match(queue, /params\.set\("service_id", serviceId\)/);
  assert.match(queue, /params\.set\("category_id", categoryId\)/);
  assert.match(queue, /"All services"/);
  assert.match(queue, /"All categories"/);
});

test("Incident details use full width and return to the retained incident queue", () => {
  const details = readFileSync(new URL("../src/components/itsm/incident-oversight-drawer.tsx", import.meta.url), "utf8");
  const queue = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/incidents/page.tsx", import.meta.url), "utf8");
  assert.match(details, /fixed inset-0 z-50 flex/);
  assert.doesNotMatch(details, /max-w-2xl|justify-end|backdrop-blur/);
  assert.match(details, /<button onClick=\{onClose\}[^>]*><ArrowLeft[^>]*\/>\{backLabel\}<\/button>/);
  assert.match(queue, /backLabel="Back to Incident Queue" onClose=\{\(\)=>setSelected\(null\)\}/);
  assert.match(details, /break-words font-semibold/);
});

test("Incident response separates major mode, ownership and operational signals from its wide timeline", () => {
  const details = readFileSync(new URL("../src/components/itsm/incident-oversight-drawer.tsx", import.meta.url), "utf8");
  const timeline = readFileSync(new URL("../src/components/itsm/activity-timeline.tsx", import.meta.url), "utf8");
  assert.match(details, /incident.is_major_incident \? "Major Incident" : "Normal Incident"/);
  assert.match(details, /Open Command Workspace/);
  assert.match(details, /Responsible engineer/);
  assert.match(details, /Supporting team/);
  assert.match(details, /Recent Activity/);
  assert.match(details, /No SLA attached/);
  assert.match(details, /Classification & Priority/);
  assert.match(details, /Resolution Evidence/);
  assert.match(details, /reason !== "HIGH_PRIORITY"/);
  assert.doesNotMatch(details, /Current Progress|An engineer owns this incident/);
  assert.match(details, /No recent activity/);
  assert.doesNotMatch(details, /xl:grid-cols|aria-label="Close"|Stuck \/ idle/);
  assert.match(details, /onActivityAdded=\{load\} oversight users=/);
  assert.match(timeline, /Update visibility/);
  assert.match(timeline, /setActivityType\(internal \? "NOTE" : "COMMENT"\)/);
});

test("Activity presentation resolves real names without exposing generated UUIDs or changing user evidence", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const activity: IncidentActivity = {
    id: "activity", tenant_id: "tenant", ticket_id: "ticket", actor_type: "USER",
    actor_id: id, activity_type: "ASSIGNMENT_CHANGE", is_internal: false,
    created_at: "2026-01-01T12:00:00Z", content: `Assigned to user '${id}' / group 'None'`,
    new_value: { assignee_id: id, assignment_group: null },
  };
  const users = [{ id, email: "engineer@example.com", is_active: true }];
  assert.equal(activityActor(activity, users), "engineer@example.com");
  assert.match(activityActor(activity, []), /name unavailable/);
  assert.equal(activityContent(activity, users), "engineer@example.com · No assignment group selected");
  assert.doesNotMatch(activityContent(activity, []), /22222222/);
  assert.equal(activityLabel("MAJOR_INCIDENT_DECLARED"), "Major incident declared");
  const comment = { ...activity, activity_type: "COMMENT", content: `Investigate request ${id}` };
  assert.equal(activityContent(comment, users), comment.content);
  assert.equal(activity.content, `Assigned to user '${id}' / group 'None'`);
  const newer = { ...activity, id: "newer", created_at: "2026-01-02T12:00:00+00:00" };
  const input = [activity, newer];
  assert.deepEqual(latestActivities(input).map(item => item.id), ["newer", "activity"]);
  assert.deepEqual(input.map(item => item.id), ["activity", "newer"]);
});

test("Command queue distinguishes major incidents from candidates with clear selectable rows", () => {
  const page = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/major-incidents/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Declared Major Incident/);
  assert.match(page, /High-priority candidate/);
  assert.match(page, />State</);
  assert.match(page, />Ownership</);
  assert.match(page, />Impact and activity</);
  assert.match(page, /No assignment group/);
  assert.match(page, /No individual owner/);
  assert.match(page, /onClick=\{\(\)=>openCommand\(i\.id\)\}/);
  assert.match(page, /Back to Command Queue/);
  assert.match(page, /selected\?<div className="space-y-4"/);
  assert.match(page, /disabled=\{offset===0\|\|loading\}/);
  assert.match(page, /disabled=\{offset\+visible.length>=total\|\|loading\}/);
  assert.match(page, /\(offset>0\|\|total>COMMAND_PAGE_SIZE\)&&<div/);
  assert.match(page, /offset===0&&total<=COMMAND_PAGE_SIZE/);
  assert.doesNotMatch(page, /xl:grid-cols-\[248px_minmax\(0,1fr\)\]/);
  assert.match(page, /lg:grid-cols-\[minmax\(0,2fr\)_150px_minmax\(180px,1fr\)_minmax\(170px,1fr\)_32px\]/);
  assert.match(page, /Search title or incident number/);
  assert.match(page, /Command ownership/);
  assert.match(page, /Situation summary/);
  assert.match(page, /Edit command details/);
  assert.match(page, /Decision needed/);
  assert.match(page, /Review declaration details/);
  assert.doesNotMatch(page, /<details open=\{!record\}/);
  assert.doesNotMatch(page, />Edit details<|lg:grid-cols-3/);
  assert.match(page, /md:grid-cols-3/);
  assert.match(page, /Restoration checkpoints and response tasks become available after declaration/);
  assert.match(page, /Commander & communication lead/);
  assert.match(page, /record.incident_commander_id === record.communication_lead_id/);
  assert.match(page, /of \$\{record.restoration_checkpoints.length\} checkpoints complete/);
  assert.ok(page.indexOf('>Situation summary<') < page.indexOf('>Command ownership<'));
  assert.ok(page.indexOf('>Restore service<') < page.indexOf('title="Restoration checkpoints"'));
  assert.match(page, /type CommandSection = "details" \| "restore" \| "coordinate" \| "pir" \| "activity"/);
  assert.match(page, /setOpenSection\(current=>current===section\?null:section\)/);
  assert.match(page, /aria-expanded=\{open\}/);
  assert.match(page, /open=\{openSection==="restore"\}/);
  assert.match(page, /open=\{openSection==="activity"\}/);
  assert.doesNotMatch(page, /<details(?:\s|>)/);
  assert.match(page, /Decisions, stakeholders, and evidence-based communications/);
  assert.match(page, /Restoration and PIR/);
  assert.match(page, /Command & coordination/);
  assert.match(page, /Business impact/);
  assert.doesNotMatch(page, /label="Current state"|last-child\]:col-span-2/);
  assert.match(page, /break-words text-sm font-semibold text-\[#0E1726\]/);
});

test("Major Incident selection cannot render or save a stale command record", () => {
  const page = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/major-incidents/page.tsx", import.meta.url), "utf8");
  assert.match(page, /setRecord\(null\);setRecordLoading\(true\);setError\(null\);setSelectedId\(incidentId\)/);
  assert.match(page, /url\.searchParams\.set\("incident",incidentId\)/);
  assert.match(page, /url\.searchParams\.delete\("incident"\)/);
  assert.match(page, /record\?\.ticket_id===selectedId \? record : null/);
  assert.match(page, /saved\.ticket_id===selected\.id/);
});

test("Incident mutations carry idempotency and optimistic concurrency headers", () => {
  const clientFetch = readFileSync(new URL("../src/lib/client-fetch.ts", import.meta.url), "utf8");
  const apiClient = readFileSync(new URL("../src/lib/api-client.ts", import.meta.url), "utf8");
  const drawer = readFileSync(new URL("../src/components/itsm/incident-oversight-drawer.tsx", import.meta.url), "utf8");
  const commandPage = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/major-incidents/page.tsx", import.meta.url), "utf8");
  assert.match(clientFetch, /"Idempotency-Key": mutationKey/);
  assert.match(apiClient, /"Idempotency-Key", "If-Match", "X-Request-ID"/);
  assert.match(drawer, /"If-Match": String\(incident\.version\)/);
  assert.match(commandPage, /"If-Match":String\(incident\.version\)/);
});

test("Incident Manager optional UX keeps queue requests focused and mobile-friendly", () => {
  const queue = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/incidents/page.tsx", import.meta.url), "utf8");
  const overview = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/page.tsx", import.meta.url), "utf8");
  assert.match(queue, /setTimeout\(\(\) => \{\s*setSearch\(searchInput\)/);
  assert.match(queue, /const loadContext = useCallback/);
  assert.match(queue, /No individual assignee/);
  assert.match(queue, /\(offset>0\|\|total>PAGE_SIZE\)&&<div/);
  assert.match(queue, /offset===0&&total<=PAGE_SIZE/);
  assert.match(queue, /md:hidden/);
  assert.match(queue, /hidden overflow-x-auto md:block/);
  assert.match(overview, /ATTENTION_PREVIEW_LIMIT = 8/);
  assert.match(overview, /WORKLOAD_PREVIEW_LIMIT = 5/);
  assert.match(overview, /View full queue/);
});

test("Incident Manager workload bars disclose values on hover or focus and link to matching queues", () => {
  const overview = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/page.tsx", import.meta.url), "utf8");
  const queue = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/incidents/page.tsx", import.meta.url), "utf8");
  assert.match(overview, /\{entry\.open_incidents\} open \{entry\.open_incidents === 1 \? "incident" : "incidents"\}/);
  assert.match(overview, /assignment_group=\$\{encodeURIComponent/);
  assert.match(overview, /assignee_id=\$\{encodeURIComponent/);
  assert.match(overview, /aria-label=\{`View \$\{entry\.open_incidents\} open/);
  assert.match(overview, /group\/bar relative/);
  assert.match(overview, /h-2 overflow-hidden rounded-full/);
  assert.match(overview, /opacity-0 shadow-md transition-opacity group-hover\/bar:opacity-100 group-focus-visible:opacity-100/);
  assert.match(queue, /const \[filtersReady, setFiltersReady\] = useState\(false\)/);
  assert.match(queue, /setFiltersReady\(true\)/);
  assert.match(queue, /if \(!filtersReady\) return;/);
});

test("Major Incident activity uses the Incident Manager presentation", () => {
  const page = readFileSync(new URL("../src/app/(console)/itsm/incident-manager/major-incidents/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<CommandActivity incidentId=\{incident\.id\} users=\{users\}/);
  assert.match(page, /<ActivityTimeline incidentId=\{incidentId\} activities=\{activities\} onActivityAdded=\{load\} oversight embedded users=\{users\}/);
});
