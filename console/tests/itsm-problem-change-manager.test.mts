import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. Problem and Change Manager Portal foundation page exists with required header and subtitle", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Portal page must exist at /itsm/problem-change-manager/page.tsx");

  const content = fs.readFileSync(pagePath, "utf-8");
  assert.match(content, /Problem and Change Manager/, "Must render header 'Problem and Change Manager'");
  assert.match(content, /Problem and Change Management Workspace/, "Must render subtitle 'Problem and Change Management Workspace'");
  assert.match(content, /id="pcm-portal-title"/, "Must have pcm-portal-title test id");
  assert.match(content, /id="pcm-portal-subtitle"/, "Must have pcm-portal-subtitle test id");
  assert.match(content, /id="pcm-problems-card"/, "Must have problems overview card");
  assert.match(content, /id="pcm-changes-card"/, "Must have changes overview card");
  assert.match(content, /id="pcm-knowledge-card"/, "Must have knowledge overview card");
  assert.doesNotMatch(content, />PROCESS_CHANGE_MANAGER</, "Must not display raw role enum in standard UI");
});

test("2. Server-side layout guard enforces authentication, product access, PROCESS_CHANGE_MANAGER role, and tenant context", () => {
  const layoutPath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/layout.tsx");
  assert.ok(fs.existsSync(layoutPath), "Layout guard must exist at /itsm/problem-change-manager/layout.tsx");

  const content = fs.readFileSync(layoutPath, "utf-8");
  assert.match(content, /cookies\(\)/, "Must read session cookie");
  assert.match(content, /authclaw_session/, "Must look for authclaw_session cookie");
  assert.match(content, /\/v1\/auth\/me/, "Must query backend /v1/auth/me for principal");
  assert.match(content, /product_access\?\.itsm/, "Must verify ITSM product access");
  assert.match(content, /PROCESS_CHANGE_MANAGER/, "Must verify PROCESS_CHANGE_MANAGER role");
  assert.match(content, /tenant_id/, "Must verify tenant context");
  assert.match(content, /redirect\("\/itsm\/login"\)/, "Must redirect unauthenticated users to /itsm/login");
});

test("3. Role-aware ConsoleShell provides user-facing title and contains ONLY the 4 planned sections", () => {
  const shellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  assert.ok(fs.existsSync(shellPath), "ConsoleShell must exist");

  const content = fs.readFileSync(shellPath, "utf-8");
  assert.match(content, /PROCESS_CHANGE_MANAGER:\s*"Problem and Change Manager"/, "Role label must be 'Problem and Change Manager'");
  assert.match(content, /const problemChangeNavigation:\s*NavItem\[\]/, "Must define problemChangeNavigation");
  assert.match(content, /href:\s*"\/itsm\/problem-change-manager"/, "Must contain Dashboard link");
  assert.match(content, /href:\s*"\/itsm\/problem-change-manager\/problems"/, "Must contain Problems link");
  assert.match(content, /href:\s*"\/itsm\/problem-change-manager\/changes"/, "Must contain Changes link");
  assert.match(content, /href:\s*"\/itsm\/knowledge"/, "Must contain Knowledge link");
  assert.match(content, /effectiveItsmRole === "PROCESS_CHANGE_MANAGER"\s*\?\s*problemChangeNavigation/, "Must map PROCESS_CHANGE_MANAGER to problemChangeNavigation");
});

test("4. Problem Management Queue page exists with summary counts, filters, search, and empty state", () => {
  const problemsPath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/problems/page.tsx");
  assert.ok(fs.existsSync(problemsPath), "Problems page must exist");
  const content = fs.readFileSync(problemsPath, "utf-8");

  // Title and subtitle
  assert.match(content, /id="pcm-problems-title"/, "Must render pcm-problems-title");
  assert.match(content, /Problems/, "Must render Problems header");
  assert.match(content, /Track recurring issues and investigate their root causes\./, "Must render subtitle");
  assert.match(content, /\/itsm\/problem-change-manager/, "Must link back to dashboard");

  // Summary counts
  assert.match(content, /id="count-open"/, "Must render Open count");
  assert.match(content, /id="count-in-progress"/, "Must render In Progress count");
  assert.match(content, /id="count-resolved"/, "Must render Resolved count");
  assert.match(content, /id="count-total"/, "Must render Total count");

  // Filter tabs
  assert.match(content, /filter-all/, "Must have All filter");
  assert.match(content, /filter-open/, "Must have Open filter");
  assert.match(content, /filter-in_progress/, "Must have In Progress filter");
  assert.match(content, /filter-resolved/, "Must have Resolved filter");
  assert.match(content, /filter-closed/, "Must have Closed filter");

  // Search input
  assert.match(content, /id="pcm-search-input"/, "Must have search input");

  // Empty state
  assert.match(content, /No Problems found/, "Must have 'No Problems found' empty state text");
  assert.match(content, /Problems raised for recurring or root-cause issues will appear here\./, "Must have empty state description");

  // Navigation to detail
  assert.ok(
    content.includes("/itsm/problem-change-manager/problems/") && content.includes("prob.id"),
    "Must link to problem detail"
  );
});

test("5. Problem Detail page exists with metadata, related incidents, and problem details", () => {
  const detailPath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx");
  assert.ok(fs.existsSync(detailPath), "Problem detail page must exist");
  const content = fs.readFileSync(detailPath, "utf-8");

  // Header & back link
  assert.match(content, /id="back-to-problems-link"/, "Must link back to problems queue");
  assert.match(content, /detail-ticket-number/, "Must display ticket number");
  assert.match(content, /detail-title/, "Must display problem title");

  // Related Incidents section
  assert.match(content, /id="pcm-related-incidents-section"/, "Must have related incidents section");
  assert.match(content, /Related Incidents/, "Must have Related Incidents header");
  assert.match(content, /\/itsm\/incidents\/\$\{inc\.id\}/, "Must link to incident detail");

  // Problem details / KEDB section
  assert.match(content, /id="pcm-problem-details-section"/, "Must have problem details section");
});

test("6. BFF routes safely proxy GET /api/itsm/problems", () => {
  const bffPath = path.join(consoleDir, "src/lib/bff-routes.ts");
  const content = fs.readFileSync(bffPath, "utf-8");
  assert.match(content, /itsm\\\/problems/, "BFF must allow itsm/problems in GET regex");
});

test("7. ITSM Login and Dashboard router redirect PROCESS_CHANGE_MANAGER to /itsm/problem-change-manager", () => {
  const loginPath = path.join(consoleDir, "src/app/itsm/login/page.tsx");
  const loginContent = fs.readFileSync(loginPath, "utf-8");
  assert.match(
    loginContent,
    /case "PROCESS_CHANGE_MANAGER":\s*defaultRoute = "\/itsm\/problem-change-manager";/,
    "Login must route PROCESS_CHANGE_MANAGER to /itsm/problem-change-manager"
  );

  const dashboardPath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/page.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8");
  assert.match(
    dashboardContent,
    /case "PROCESS_CHANGE_MANAGER":\s*redirect\("\/itsm\/problem-change-manager"\);/,
    "Dashboard router must redirect PROCESS_CHANGE_MANAGER to /itsm/problem-change-manager"
  );
});

test("8. Step 3: Problem Investigation & Root Cause workspace elements and form exist", () => {
  const detailPath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx");
  assert.ok(fs.existsSync(detailPath), "Problem detail page must exist");
  const content = fs.readFileSync(detailPath, "utf-8");

  // Investigation Section and Elements
  assert.match(content, /id="pcm-investigation-section"/, "Must have pcm-investigation-section");
  assert.match(content, /id="investigation-status-select"/, "Must have lifecycle status selector");
  assert.match(content, /id="known-error-checkbox"/, "Must have Known Error KEDB checkbox");
  assert.match(content, /id="root-cause-summary-input"/, "Must have root cause summary textarea");
  assert.match(content, /id="workaround-summary-input"/, "Must have workaround summary textarea");
  assert.match(content, /id="permanent-solution-input"/, "Must have permanent solution textarea");
  assert.match(content, /id="rca-document-url-input"/, "Must have RCA document URL input");
  assert.match(content, /id="investigation-notes-input"/, "Must have investigation notes textarea");
  assert.match(content, /id="save-investigation-button"/, "Must have Save Investigation button");

  // Activity History Section
  assert.match(content, /id="pcm-activities-section"/, "Must have activities timeline section");
  assert.match(content, /Activity (&amp;|&) Investigation History/, "Must have Activity & Investigation History header");
});

test("9. Step 3: BFF routes allow PATCH /api/itsm/problems/[problem_id]/investigation and GET /api/itsm/problems/[problem_id]/activities", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  // Test PATCH investigation allowed
  const patchInv = resolveBffRoute("PATCH", "itsm/problems/00000000-0000-0000-0000-000000000001/investigation");
  assert.ok(patchInv, "BFF must resolve PATCH itsm/problems/.../investigation");
  assert.equal(patchInv.backendPath, "/v1/itsm/problems/00000000-0000-0000-0000-000000000001/investigation");
  assert.equal(patchInv.body, "json");

  // Test GET activities allowed
  const getAct = resolveBffRoute("GET", "itsm/problems/00000000-0000-0000-0000-000000000001/activities");
  assert.ok(getAct, "BFF must resolve GET itsm/problems/.../activities");
  assert.equal(getAct.backendPath, "/v1/itsm/problems/00000000-0000-0000-0000-000000000001/activities");
  assert.equal(getAct.body, "none");
});

test("10. Step 3: itsm-types.ts exports ProblemInvestigationPayload and ProblemActivity", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  const content = fs.readFileSync(typesPath, "utf-8");

  assert.match(content, /export interface ProblemInvestigationPayload/, "Must export ProblemInvestigationPayload");
  assert.match(content, /root_cause_summary\?: string \| null;/, "Must contain root_cause_summary");
  assert.match(content, /workaround_summary\?: string \| null;/, "Must contain workaround_summary");
  assert.match(content, /known_error\?: boolean;/, "Must contain known_error");
  assert.match(content, /export interface ProblemActivity/, "Must export ProblemActivity");
  assert.match(content, /activity_type: string;/, "Must contain activity_type");
});

test("11. Step 4: Problem Resolution & Closure section, action buttons, and modals exist", () => {
  const detailPath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx");
  assert.ok(fs.existsSync(detailPath), "Problem detail page must exist");
  const content = fs.readFileSync(detailPath, "utf-8");

  // Resolution Section
  assert.match(content, /id="pcm-resolution-section"/, "Must have pcm-resolution-section");
  assert.match(content, /Resolution &amp; Closure/, "Must have Resolution & Closure header");

  // Action Buttons
  assert.match(content, /id="open-resolve-modal-button"/, "Must have open-resolve-modal-button");
  assert.match(content, /id="open-close-modal-button"/, "Must have open-close-modal-button");

  // Resolve Modal & Inputs
  assert.match(content, /id="resolve-problem-modal"/, "Must have resolve-problem-modal");
  assert.match(content, /id="resolve-summary-input"/, "Must have resolve-summary-input");
  assert.match(content, /id="resolve-permanent-solution-input"/, "Must have resolve-permanent-solution-input");
  assert.match(content, /id="resolve-workaround-input"/, "Must have resolve-workaround-input");
  assert.match(content, /id="resolve-root-cause-input"/, "Must have resolve-root-cause-input");
  assert.match(content, /id="resolve-notes-input"/, "Must have resolve-notes-input");
  assert.match(content, /id="cancel-resolve-button"/, "Must have cancel-resolve-button");
  assert.match(content, /id="confirm-resolve-button"/, "Must have confirm-resolve-button");

  // Close Modal & Inputs
  assert.match(content, /id="close-problem-modal"/, "Must have close-problem-modal");
  assert.match(content, /id="close-notes-input"/, "Must have close-notes-input");
  assert.match(content, /id="cancel-close-button"/, "Must have cancel-close-button");
  assert.match(content, /id="confirm-close-button"/, "Must have confirm-close-button");

  // Display Fields
  assert.match(content, /id="resolution-summary-display"/, "Must have resolution-summary-display");
  assert.match(content, /id="permanent-solution-display"/, "Must have permanent-solution-display");
  assert.match(content, /id="workaround-display"/, "Must have workaround-display");
  assert.match(content, /id="root-cause-display"/, "Must have root-cause-display");
});

test("12. Step 4: BFF routes allow POST /api/itsm/problems/[problem_id]/resolve and POST /api/itsm/problems/[problem_id]/close", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  // Test POST resolve allowed
  const postResolve = resolveBffRoute("POST", "itsm/problems/00000000-0000-0000-0000-000000000001/resolve");
  assert.ok(postResolve, "BFF must resolve POST itsm/problems/.../resolve");
  assert.equal(postResolve.backendPath, "/v1/itsm/problems/00000000-0000-0000-0000-000000000001/resolve");
  assert.equal(postResolve.body, "json");

  // Test POST close allowed with optional-json body
  const postClose = resolveBffRoute("POST", "itsm/problems/00000000-0000-0000-0000-000000000001/close");
  assert.ok(postClose, "BFF must resolve POST itsm/problems/.../close");
  assert.equal(postClose.backendPath, "/v1/itsm/problems/00000000-0000-0000-0000-000000000001/close");
  assert.equal(postClose.body, "optional-json");
});

test("13. Step 4: itsm-types.ts exports ProblemResolvePayload, ProblemClosePayload, and updated ProblemDetail", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  const content = fs.readFileSync(typesPath, "utf-8");

  assert.match(content, /export interface ProblemResolvePayload/, "Must export ProblemResolvePayload");
  assert.match(content, /resolution_summary: string;/, "ProblemResolvePayload must have resolution_summary");
  assert.match(content, /export interface ProblemClosePayload/, "Must export ProblemClosePayload");
  assert.match(content, /closure_notes\?: string \| null;/, "ProblemClosePayload must have closure_notes");
  assert.match(content, /resolution_summary\?: string \| null;/, "ProblemDetail must include resolution_summary");
  assert.match(content, /resolved_at\?: string \| null;/, "ProblemDetail must include resolved_at");
  assert.match(content, /closed_at\?: string \| null;/, "ProblemDetail must include closed_at");
});

test("14. Step 5: Change Management Queue page exists with header, subtitle, count cards, filters, search, and empty state", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/changes/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Changes page must exist at /itsm/problem-change-manager/changes/page.tsx");

  const content = fs.readFileSync(pagePath, "utf-8");

  // Header & subtitle
  assert.match(content, /id="pcm-changes-title"/, "Must render pcm-changes-title");
  assert.match(content, /Changes/, "Must render Changes header");
  assert.match(content, /id="pcm-changes-subtitle"/, "Must render pcm-changes-subtitle");
  assert.match(content, /Review and manage planned changes to IT services\./, "Must render exact subtitle");

  // Stat count cards
  assert.match(content, /id="count-total"/, "Must render total count");
  assert.match(content, /id="count-open"/, "Must render open count");
  assert.match(content, /id="count-in-progress"/, "Must render in_progress count");
  assert.match(content, /id="count-scheduled"/, "Must render scheduled count");
  assert.match(content, /id="count-completed"/, "Must render completed count");

  // Filter tabs
  assert.match(content, /id="filter-all"/, "Must render filter-all");
  assert.match(content, /id="filter-open"/, "Must render filter-open");
  assert.match(content, /id="filter-in_progress"/, "Must render filter-in_progress");
  assert.match(content, /id="filter-scheduled"/, "Must render filter-scheduled");
  assert.match(content, /id="filter-completed"/, "Must render filter-completed");

  // Search
  assert.match(content, /id="pcm-search-input"/, "Must render search input");

  // Table
  assert.match(content, /id="pcm-changes-table-container"/, "Must render table container");
  assert.match(content, /Change #/, "Must have Change # column");
  assert.match(content, /Short Description/, "Must have Short Description column");
  assert.match(content, /Type/, "Must have Type column");
  assert.match(content, /Risk \/ Impact/, "Must have Risk / Impact column");
  assert.match(content, /Service/, "Must have Service column");
  assert.match(content, /Assigned Team/, "Must have Assigned Team column");
  assert.match(content, /Planned Window/, "Must have Planned Window column");

  // Empty state
  assert.match(content, /No Changes found/, "Must have 'No Changes found' text");
  assert.match(content, /Planned and controlled changes will appear here\./, "Must have empty state description");

  // Navigation to detail
  assert.ok(
    content.includes("/itsm/problem-change-manager/changes/") && content.includes("chg.id"),
    "Must link to change detail entry point"
  );
});

test("15. Step 5: BFF routes allow GET /api/itsm/changes and GET /api/itsm/changes/stats", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  const getChanges = resolveBffRoute("GET", "itsm/changes");
  assert.ok(getChanges, "BFF must resolve GET itsm/changes");
  assert.equal(getChanges.backendPath, "/v1/itsm/changes");
  assert.equal(getChanges.body, "none");

  const getStats = resolveBffRoute("GET", "itsm/changes/stats");
  assert.ok(getStats, "BFF must resolve GET itsm/changes/stats");
  assert.equal(getStats.backendPath, "/v1/itsm/changes/stats");
  assert.equal(getStats.body, "none");

  const getDetail = resolveBffRoute("GET", "itsm/changes/00000000-0000-0000-0000-000000000001");
  assert.ok(getDetail, "BFF must resolve GET itsm/changes/{id}");
  assert.equal(getDetail.backendPath, "/v1/itsm/changes/00000000-0000-0000-0000-000000000001");
  assert.equal(getDetail.body, "none");
});

test("16. Step 5: itsm-types.ts exports ChangeSummary and ChangeStats", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  const content = fs.readFileSync(typesPath, "utf-8");

  assert.match(content, /export interface ChangeSummary/, "Must export ChangeSummary");
  assert.match(content, /change_number: string;/, "ChangeSummary must contain change_number");
  assert.match(content, /status: string;/, "ChangeSummary must contain status");
  assert.match(content, /change_type\?: string \| null;/, "ChangeSummary must contain change_type");
  assert.match(content, /risk_level\?: string \| null;/, "ChangeSummary must contain risk_level");
  assert.match(content, /export interface ChangeStats/, "Must export ChangeStats");
  assert.match(content, /scheduled: number;/, "ChangeStats must contain scheduled");
  assert.match(content, /completed: number;/, "ChangeStats must contain completed");
});

test("17. Step 5: Minimal Change Detail entry point exists at /itsm/problem-change-manager/changes/[change_id]/page.tsx", () => {
  const detailPath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/changes/[change_id]/page.tsx");
  assert.ok(fs.existsSync(detailPath), "Change detail page must exist");

  const content = fs.readFileSync(detailPath, "utf-8");
  assert.match(content, /id="back-to-changes-link"/, "Must link back to changes queue");
  assert.match(content, /id="detail-change-number"/, "Must display change number");
  assert.match(content, /id="detail-change-title"/, "Must display change title");
  assert.match(content, /Change Information/, "Must display Change Information");
});

test("18. Step 6: Change Detail & Assessment page contains information, assessment form, and save button", () => {
  const detailPath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/changes/[change_id]/page.tsx");
  const content = fs.readFileSync(detailPath, "utf-8");

  // Sections
  assert.match(content, /id="pcm-change-detail-page"/, "Must have pcm-change-detail-page");
  assert.match(content, /id="pcm-change-info-section"/, "Must have pcm-change-info-section");
  assert.match(content, /id="pcm-assessment-section"/, "Must have pcm-assessment-section");
  assert.match(content, /id="pcm-metadata-sidebar"/, "Must have pcm-metadata-sidebar");
  assert.match(content, /id="pcm-activity-history-section"/, "Must have pcm-activity-history-section");
  assert.match(content, /id="pcm-related-problem-card"/, "Must have pcm-related-problem-card");

  // Assessment Inputs
  assert.match(content, /id="assessment-type-select"/, "Must have assessment-type-select");
  assert.match(content, /id="assessment-risk-select"/, "Must have assessment-risk-select");
  assert.match(content, /id="assessment-impact-select"/, "Must have assessment-impact-select");
  assert.match(content, /id="assessment-reason-input"/, "Must have assessment-reason-input");
  assert.match(content, /id="assessment-impl-notes-input"/, "Must have assessment-impl-notes-input");
  assert.match(content, /id="assessment-val-notes-input"/, "Must have assessment-val-notes-input");
  assert.match(content, /id="assessment-backout-notes-input"/, "Must have assessment-backout-notes-input");
  assert.match(content, /id="save-assessment-button"/, "Must have save-assessment-button");
});

test("19. Step 6: Affected Configuration Items section displays CIs and handles empty state", () => {
  const detailPath = path.join(consoleDir, "src/app/(console)/itsm/problem-change-manager/changes/[change_id]/page.tsx");
  const content = fs.readFileSync(detailPath, "utf-8");

  assert.match(content, /id="pcm-affected-cis-section"/, "Must have pcm-affected-cis-section");
  assert.match(content, /Affected Configuration Items/, "Must display Affected Configuration Items title");
  assert.match(content, /id="no-cis-message"/, "Must have no-cis-message for empty state");
  assert.match(content, /No configuration items linked\./, "Must display empty state text");
});

test("20. Step 6: BFF routes safely allow PATCH /api/itsm/changes/[change_id]/assessment", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  const patchAssessment = resolveBffRoute("PATCH", "itsm/changes/00000000-0000-0000-0000-000000000001/assessment");
  assert.ok(patchAssessment, "BFF must resolve PATCH itsm/changes/.../assessment");
  assert.equal(patchAssessment.backendPath, "/v1/itsm/changes/00000000-0000-0000-0000-000000000001/assessment");
  assert.equal(patchAssessment.body, "json");

  const patchChange = resolveBffRoute("PATCH", "itsm/changes/00000000-0000-0000-0000-000000000001");
  assert.ok(patchChange, "BFF must resolve PATCH itsm/changes/...");
  assert.equal(patchChange.backendPath, "/v1/itsm/changes/00000000-0000-0000-0000-000000000001");
  assert.equal(patchChange.body, "json");
});

test("21. Step 6: itsm-types.ts exports ChangeDetail, ChangeAffectedCI, and ChangeAssessmentUpdatePayload", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  const content = fs.readFileSync(typesPath, "utf-8");

  assert.match(content, /export interface ChangeAffectedCI/, "Must export ChangeAffectedCI");
  assert.match(content, /ci_id: string;/, "ChangeAffectedCI must have ci_id");
  assert.match(content, /impact_type: string;/, "ChangeAffectedCI must have impact_type");
  assert.match(content, /export interface ChangeDetail extends ChangeSummary/, "Must export ChangeDetail extending ChangeSummary");
  assert.match(content, /implementation_plan\?: string \| null;/, "ChangeDetail must have implementation_plan");
  assert.match(content, /test_plan\?: string \| null;/, "ChangeDetail must have test_plan");
  assert.match(content, /backout_plan\?: string \| null;/, "ChangeDetail must have backout_plan");
  assert.match(content, /affected_cis: ChangeAffectedCI\[\];/, "ChangeDetail must have affected_cis");
  assert.match(content, /export interface ChangeAssessmentUpdatePayload/, "Must export ChangeAssessmentUpdatePayload");
});




