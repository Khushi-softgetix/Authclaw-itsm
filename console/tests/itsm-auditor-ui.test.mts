import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const page = fs.readFileSync(path.join(root, "src/app/(console)/itsm/dashboard/auditor/page.tsx"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/components/console-shell.tsx"), "utf8");
const consoleLayout = fs.readFileSync(path.join(root, "src/app/(console)/layout.tsx"), "utf8");

test("Auditor workspace uses the real audit search and signed export routes", () => {
  assert.match(page, /activeView === "audit" \? "events" : "traces"/);
  assert.match(page, /\/api\/itsm\/audit\/\$\{endpoint\}\?\$\{params\}/);
  assert.match(page, /\/api\/itsm\/audit\/overview/);
  assert.match(page, /\/api\/itsm\/audit\/exports/);
  assert.match(page, /\/api\/itsm\/audit\/export/);
  assert.match(page, /\/api\/itsm\/audit\/events\/\$\{encodeURIComponent\(recordId\)\}/);
  assert.match(page, /Verify evidence health, identify activity that needs review, and open the supporting record/);
  assert.match(page, /integrity_check: String\(activeView === "audit" && !search && !hasStructuredFilters\)/);
});

test("Auditor evidence never mislabels an audit record id as its target", () => {
  assert.match(page, /const target = event\.target_id;/);
  assert.doesNotMatch(page, /event\.target_id \|\| event\.record_id/);
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
  assert.match(page, /label="Platform evidence"/);
  assert.match(page, /label="AI activity evidence"/);
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

test("Auditor overview prioritizes evidence health and actionable review signals", () => {
  for (const text of [
    "Evidence chain verified",
    "Needs review",
    "Evidence coverage",
    "Search evidence",
    "A denial is evidence to inspect, not proof of misconduct",
  ]) assert.match(page, new RegExp(text));
  assert.match(page, /href="\/itsm\/dashboard\/auditor\?section=audit-log"/);
  assert.match(page, /href="\/itsm\/dashboard\/auditor\?section=evidence"/);
  assert.match(page, /href="\/itsm\/dashboard\/auditor\?section=exports"/);
});

test("Auditor overview bars disclose values and dates on hover or focus and open matching evidence", () => {
  assert.match(page, /function auditLogHref/);
  assert.match(page, /params\.set\("action", filters\.action\)/);
  assert.match(page, /params\.set\("start_date", filters\.startDate\)/);
  assert.match(page, /aria-label=\{`Review \$\{point\.count\} audit/);
  assert.match(page, /href=\{auditLogHref\(\{ startDate: point\.date, endDate: point\.date \}\)\}/);
  assert.match(page, /href=\{auditLogHref\(\{ action: item\.action \}\)\}/);
  assert.match(page, /\{item\.count\} \{item\.count === 1 \? "event" : "events"\}/);
  assert.match(page, /function formatChartDate/);
  assert.match(page, /group-hover\/bar:opacity-100 group-focus-visible\/bar:opacity-100/);
  assert.match(page, /peer-hover:opacity-100 peer-focus-visible:opacity-100/);
  assert.match(page, /group-hover\/bar:opacity-100 group-focus-visible:opacity-100/);
  assert.match(page, /h-2 overflow-hidden rounded-full/);
  assert.doesNotMatch(page, /className="max-w-full truncate">\{point\.count\}/);
});

test("Auditor page headers expose the read-only boundary without decorative clutter", () => {
  assert.match(page, /Read-only workspace/);
  assert.match(page, /children\?: React\.ReactNode/);
  assert.doesNotMatch(page, /Read-only Auditor workspace/);
});

test("Audit evidence exposes the documented reconstruction fields", () => {
  for (const field of ["Target", "Workflow reference", "Reason & context", "Actor role", "Policy & approval", "Decision", "Before and after", "Hash-chain evidence", "Evidence references"]) {
    assert.match(page, new RegExp(field.replace("/", "\\/")));
  }
});

test("Auditor UI provides functional evidence filters and clear inspection affordances", () => {
  for (const text of ["Event category", "Target type", "Result", "Actor", "From date", "Through date", "Inspect evidence"]) {
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
  assert.doesNotMatch(page, /label="Evidence source"/);
  assert.doesNotMatch(page, /sourceLabel/);
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
  assert.match(page, /hasRecords && Boolean\(overview\?\.integrity_valid\)/);
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
