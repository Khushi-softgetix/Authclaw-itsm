import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "src/app/(console)/itsm/dashboard/auditor/page.tsx"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/components/console-shell.tsx"), "utf8");
const globals = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const consoleLayout = fs.readFileSync(path.join(root, "src/app/(console)/layout.tsx"), "utf8");

test("Auditor workspace uses the real audit search and signed export routes", () => {
  assert.match(page, /activeView === "audit" \? "events" : "traces"/);
  assert.match(page, /\/api\/itsm\/audit\/\$\{endpoint\}\?\$\{params\}/);
  assert.match(page, /\/api\/itsm\/audit\/overview/);
  assert.match(page, /\/api\/itsm\/audit\/exports/);
  assert.match(page, /\/api\/itsm\/audit\/export/);
  assert.match(page, /\/api\/itsm\/audit\/events\/\$\{encodeURIComponent\(recordId\)\}/);
  assert.match(page, /Independent, read-only visibility into platform activity and evidence/);
  assert.match(page, /integrity_check: String\(activeView === "audit" && !search && !hasStructuredFilters\)/);
});

test("Auditor evidence never mislabels an audit record id as its target", () => {
  assert.match(page, /const target = event\.target_id;/);
  assert.doesNotMatch(page, /event\.target_id \|\| event\.record_id/);
});
test("Auditor results do not infer success when the backend result is unknown", () => {
  assert.match(page, /return \{ label: "Recorded", kind: "recorded"/);
  assert.match(page, /response_status >= 200 && event\.response_status < 400/);
  assert.match(page, /success\|succeeded\|completed/);
});

test("Auditor records respond to available content width", () => {
  assert.match(globals, /\.auditor-responsive-workspace[\s\S]*?container-type: inline-size/);
  assert.match(globals, /@container \(min-width: 860px\)/);
  assert.match(page, /auditor-table-layout/);
  assert.match(page, /auditor-record-list/);
  assert.doesNotMatch(page, /overflow-x-auto/);
});

test("Overview activity keeps identifiers in Review and avoids horizontal table scrolling", () => {
  const overviewActivity = page.match(/function RecentActivityModern[\s\S]*?function ActivityTrend/)?.[0] || "";
  assert.doesNotMatch(overviewActivity, /<table/);
  assert.doesNotMatch(overviewActivity, /actor\.secondary|target\.secondary/);
  assert.match(overviewActivity, /\["Event", "Actor", "Resource", "Result", "Integrity", "Time", "Review"\]/);
  assert.match(page, /function RecentResultStatus/);
  assert.match(page, /function RecentIntegrityStatus/);
  assert.match(page, /function RecentActivityTime/);
  assert.match(page, /function RecentEventTitle/);
  assert.match(page, /whitespace-nowrap/);
  assert.match(page, /Event reference/);
});

test("Recent activity changes layout before its evidence fields become cramped", () => {
  assert.match(globals, /@container \(min-width: 1040px\)[\s\S]*?auditor-recent-grid/);
  assert.match(page, /auditor-recent-cards/);
  assert.match(page, /auditor-recent-grid/);
});

test("Audit trend uses the restrained AuthClaw lavender palette", () => {
  const trend = page.match(/function ActivityTrend[\s\S]*?function TopActions/)?.[0] || "";
  assert.match(trend, /bg-\[#A78BFA\]/);
  assert.match(trend, /bg-\[#5B21B6\]/);
  assert.match(trend, /group-hover:bg-\[#6D28D9\]/);
  assert.doesNotMatch(page, /bg-\[#7C3AED\]/);
});

test("Audit trend offers an accessible selected-day drill-down into the filtered Audit Log", () => {
  const trend = page.match(/function ActivityTrend[\s\S]*?function TopActions/)?.[0] || "";
  assert.match(trend, /aria-pressed=\{selected\}/);
  assert.match(trend, /onDoubleClick=\{\(\) => investigateDay\(point\.date\)\}/);
  assert.match(trend, /Investigate these events/);
  assert.match(trend, /Double-click is a shortcut/);
  assert.match(page, /function auditLogDayHref/);
  assert.match(page, /start: date/);
  assert.match(page, /end: date/);
  assert.match(page, /source: "trend"/);
});

test("Trend investigations hydrate and explain the Audit Log date filter", () => {
  assert.match(page, /auditDateParam\(searchParams\.get\("start"\)\)/);
  assert.match(page, /setFilterDraft\(requestedDateFilters\)/);
  assert.match(page, /setFilters\(requestedDateFilters\)/);
  assert.match(page, /Recorded date: \$\{formatAuditDay\(filters\.startDate\)\}/);
  assert.match(page, /Opening this investigation is itself audited/);
  assert.match(page, /router\.replace\("\/itsm\/dashboard\/auditor\?section=audit-log"/);
});


test("Auditor UI avoids undocumented compliance claims and operational access", () => {
  assert.doesNotMatch(page, /SOC 2|ISO\/IEC|Policy Overrides|Read-Only Incident Explorer|Compliance Readiness/);
  assert.doesNotMatch(page, /href="\/itsm\/incidents"/);
  assert.doesNotMatch(page, /approve|reject|retry agent|tenant settings/i);
});

test("Auditor receives the five focused MVP navigation destinations", () => {
  assert.match(shell, /const auditorNavigation:/);
  for (const item of ["Overview", "Audit Log", "Evidence", "Reports", "Exports"]) {
    assert.match(shell, new RegExp(`name: "${item}"`));
  }
  for (const section of ["overview", "audit-log", "evidence", "reports", "exports"]) {
    assert.match(shell, new RegExp(`section=${section}`));
  }
  assert.match(shell, /effectiveItsmRole === "AUDITOR"[\s\S]*?auditorNavigation/);
});

test("Auditor is redirected away from unrelated ITSM page routes", () => {
  assert.match(consoleLayout, /itsmRole === "AUDITOR"/);
  assert.match(consoleLayout, /currentPath !== "\/itsm\/dashboard\/auditor"/);
  assert.match(consoleLayout, /redirect\("\/itsm\/dashboard\/auditor"\)/);
});

test("Auditor workspace keeps AI activity inside Evidence instead of adding an unsupported workspace", () => {
  assert.match(page, /title="Platform Evidence"/);
  assert.match(page, /title="AI Activity Evidence"/);
  assert.match(page, /task_goal/);
  assert.match(page, /evidence_refs/);
  assert.match(page, /tool_calls/);
  assert.match(page, /approval_evidence/);
  assert.match(page, /model_version/);
  assert.match(page, /cost_usd/);
  assert.match(page, /\$\{value\.toFixed\(4\)\} USD/);
  assert.match(page, /outcome/);
  assert.match(page, /failures/);
});

test("Auditor MVP views cover overview, investigation, evidence, reports, and export history", () => {
  for (const text of [
    "Audit overview",
    "Audit log",
    "Evidence explorer",
    "Audit reports",
    "Evidence exports",
    "Recent activity",
    "Authorized export history",
  ]) assert.match(page, new RegExp(text));
  assert.match(page, /Total audit events/);
  assert.match(page, /Privileged actions/);
  assert.match(page, /Denied actions/);
  assert.match(page, /Administrative changes/);
});

test("Audit evidence exposes the documented reconstruction fields", () => {
  for (const field of ["Target", "Workflow reference", "Reason & context", "Actor role", "Policy & approval", "Decision", "Before and after", "Hash-chain evidence", "Evidence references"]) {
    assert.match(page, new RegExp(field.replace("/", "\\/")));
  }
});

test("Auditor UI provides functional evidence filters and clear inspection affordances", () => {
  for (const text of ["Event category", "Target type", "Result", "Actor", "From date", "Through date", "Review"]) {
    assert.match(page, new RegExp(text));
  }
  assert.match(page, /params\.set\("action_prefix", filters\.category\)/);
  assert.match(page, /params\.set\("target_type", filters\.targetType\)/);
  assert.match(page, /params\.set\("outcome", filters\.outcome\)/);
  assert.match(page, /Filters apply to the complete tenant evidence set/);
});

test("Auditor summaries explain every trace state and avoid database implementation details", () => {
  assert.match(page, /label="In progress"/);
  assert.match(page, /traceOutcomeKind/);
  assert.match(page, /label="Integrity exceptions"/);
  assert.match(page, /function IntegrityDetails/);
  assert.match(page, /label="Evidence source"/);
  assert.doesNotMatch(page, /function IntegrityPanel/);
});

test("Auditor export makes the signed evidence scope explicit", () => {
  assert.match(page, /Create signed evidence report/);
  assert.match(page, /All tenant evidence/);
  assert.match(page, /Selected date range/);
  assert.match(page, /tenant-scoped evidence packages/);
  assert.match(page, /buildReadableAuditEvidenceReport/);
  assert.match(page, /itsm-audit-evidence-report-/);
  assert.match(page, /Create evidence report/);
  assert.match(page, /Exact action \(optional\)/);
  assert.match(page, /action: exportAction\.trim\(\)/);
  assert.match(page, /exports\?limit=\$\{PAGE_SIZE\}&offset=\$\{requestedOffset\}/);
  assert.match(page, /noun="exports"/);
});

test("Auditor UI reads both structured and legacy key-value evidence traces", () => {
  assert.match(page, /Array\.isArray\(value\)/);
  assert.match(page, /Object\.fromEntries\(entries\)/);
  assert.match(page, /action_filter/);
  assert.match(page, /record_count/);
});

test("Auditor overview does not call an empty chain verified", () => {
  assert.match(page, /No evidence to verify/);
  assert.match(page, /hasOverviewRecords && Boolean\(overview\?\.integrity_valid\)/);
  assert.match(page, /overviewIntegrityNeedsReview/);
  assert.match(page, /integrityExpanded \|\| overviewIntegrityNeedsReview/);
});

test("Auditor shell does not show the generic notification control", () => {
  assert.match(shell, /effectiveItsmRole !== "AUDITOR" \? <NotificationBell \/> : null/);
});

test("Auditor records open as a full-width detail view and return to the preserved list", () => {
  assert.match(page, /Back to Audit Trail/);
  assert.match(page, /Back to Agent Traces/);
  assert.match(page, /listScrollPosition/);
  assert.match(page, /window\.scrollTo\(\{ top: listScrollPosition\.current/);
  assert.doesNotMatch(page, /xl:grid-cols-\[minmax\(0,1fr\)_380px\]/);
  assert.match(page, /function DetailLoading/);
  assert.match(page, /function DetailFailure/);
  assert.match(page, /loadEventDetail/);
});

test("Auditor can identify actors and follow a complete workflow chain", () => {
  assert.match(page, /actor_display\?: string/);
  assert.match(page, /Copy actor ID/);
  assert.match(page, /Copy workflow reference/);
  assert.match(page, /View workflow events/);
  assert.match(page, /setSearchInput\(correlationId\)/);
  assert.match(page, /setSearch\(correlationId\)/);
  assert.doesNotMatch(page, /value=\{shorten\(event\.request_id/);
  assert.doesNotMatch(page, /value=\{shorten\(trace\.event\.request_id/);
});

test("Agent trace detail prioritizes audit questions and defers technical identifiers", () => {
  for (const text of [
    "Audit summary",
    "What happened",
    "Why it happened",
    "Outcome",
    "Evidence and approvals",
    "Technical details",
    "Integrity",
    "Approval status",
  ]) {
    assert.match(page, new RegExp(text));
  }
  assert.match(page, /<details[^>]*className="group/);
  assert.match(page, /trace\.failures\.length > 0 \?/);
  assert.doesNotMatch(page, /<DetailSummary label="Trace"/);
  assert.doesNotMatch(page, /<DetailSummary label="Model"/);
});

test("Evidence and approval references are useful read-only audit actions", () => {
  assert.match(page, /Find in audit trail/);
  assert.match(page, /Copy reference/);
  assert.match(page, /function EvidenceReferenceList/);
  assert.match(page, /function ApprovalReferenceList/);
  assert.match(page, /onFind\(item\)/);
  assert.match(page, /Technical details for investigation/);
  assert.match(page, /Matches this action to the immutable actor record/);
  assert.match(page, /Identifies this exact execution in an evidence export/);
  assert.match(page, /Connects actions from the same workflow/);
  assert.match(page, /modelRecorded \?/);
});

test("Auditor UI uses user-friendly names for audit references", () => {
  for (const label of ["Event reference", "Agent run reference", "Workflow reference"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /Search action, actor, target, workflow reference, or reason/);
  assert.match(page, /Copy event reference/);
  assert.match(page, /Copy agent run reference/);
  assert.match(page, /Copy workflow reference/);
  assert.doesNotMatch(page, /label="Trace ID"/);
  assert.doesNotMatch(page, /label="Correlation ID"/);
});
