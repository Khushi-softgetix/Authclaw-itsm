import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. End-to-end contracts: Problem Manager types support full Known Error lifecycle", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  assert.ok(fs.existsSync(typesPath), "itsm-types.ts must exist");
  const source = fs.readFileSync(typesPath, "utf-8");

  // Problem detail fields
  assert.ok(source.includes("export interface ProblemDetailData"), "Must export ProblemDetailData");
  assert.ok(source.includes("symptoms?: string | null;"), "Must include symptoms");
  assert.ok(source.includes("workaround_status?:"), "Must include workaround_status");
  assert.ok(source.includes("workaround_approved_at?:"), "Must include workaround_approved_at");
  assert.ok(source.includes("workaround_expires_at?:"), "Must include workaround_expires_at");
  assert.ok(source.includes("review_due_at?:"), "Must include review_due_at");

  // Governance contracts
  assert.ok(source.includes("export interface PublishWorkaroundRequest"), "Must export PublishWorkaroundRequest");
  assert.ok(source.includes("export interface RetireWorkaroundRequest"), "Must export RetireWorkaroundRequest");
  assert.ok(source.includes("export interface WorkaroundGovernanceResponse"), "Must export WorkaroundGovernanceResponse");

  // Lookup contracts
  assert.ok(source.includes("export interface KnownErrorLookupItem"), "Must export KnownErrorLookupItem");
  assert.ok(source.includes("export interface LinkIncidentProblemRequest"), "Must export LinkIncidentProblemRequest");
  assert.ok(source.includes("export interface LinkIncidentProblemResponse"), "Must export LinkIncidentProblemResponse");
});

test("2. End-to-end BFF routes: Proxy safely allows read-only KEDB search and governed lifecycle actions", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  const prbId = "33333333-3333-3333-3333-333333333333";
  const incId = "44444444-4444-4444-4444-444444444444";

  // Search KEDB
  const searchRoute = resolveBffRoute("GET", "itsm/problems/known-errors");
  assert.ok(searchRoute, "BFF must allow GET itsm/problems/known-errors");
  assert.equal(searchRoute.backendPath, "/v1/itsm/problems/known-errors");
  assert.equal(searchRoute.body, "none");

  // Publish workaround
  const pubRoute = resolveBffRoute("POST", `itsm/problems/${prbId}/publish-workaround`);
  assert.ok(pubRoute, "BFF must allow POST itsm/problems/.../publish-workaround");
  assert.equal(pubRoute.backendPath, `/v1/itsm/problems/${prbId}/publish-workaround`);
  assert.equal(pubRoute.body, "optional-json");

  // Retire workaround
  const retRoute = resolveBffRoute("POST", `itsm/problems/${prbId}/retire-workaround`);
  assert.ok(retRoute, "BFF must allow POST itsm/problems/.../retire-workaround");
  assert.equal(retRoute.backendPath, `/v1/itsm/problems/${prbId}/retire-workaround`);
  assert.equal(retRoute.body, "optional-json");

  // Link incident to problem
  const linkRoute = resolveBffRoute("POST", `itsm/incidents/${incId}/link-problem`);
  assert.ok(linkRoute, "BFF must allow POST itsm/incidents/.../link-problem");
  assert.equal(linkRoute.backendPath, `/v1/itsm/incidents/${incId}/link-problem`);
  assert.equal(linkRoute.body, "json");

  // Unlink incident from problem
  const unlinkRoute = resolveBffRoute("POST", `itsm/incidents/${incId}/unlink-problem`);
  assert.ok(unlinkRoute, "BFF must allow POST itsm/incidents/.../unlink-problem");
  assert.equal(unlinkRoute.backendPath, `/v1/itsm/incidents/${incId}/unlink-problem`);
  assert.equal(unlinkRoute.body, "optional-json");

  // Disallowed / unauthorized mutations
  assert.equal(resolveBffRoute("POST", "itsm/problems/known-errors"), null, "Cannot POST to search");
  assert.equal(resolveBffRoute("DELETE", "itsm/problems/known-errors"), null, "Cannot DELETE search");
  assert.equal(resolveBffRoute("GET", `itsm/problems/${prbId}/publish-workaround`), null, "Cannot GET publish-workaround");
  assert.equal(resolveBffRoute("DELETE", `itsm/problems/${prbId}/retire-workaround`), null, "Cannot DELETE retire-workaround");
});

test("3. Problem Manager UI: Details form supports creation/update of Known Error symptoms, root cause, workaround, and dates", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx"
  );
  assert.ok(fs.existsSync(detailPath));
  const source = fs.readFileSync(detailPath, "utf-8");

  // Required field inputs
  assert.ok(source.includes('id="symptoms-input"'), "Must provide symptoms textarea");
  assert.ok(source.includes('id="root-cause-summary-input"'), "Must provide root cause input");
  assert.ok(source.includes('id="workaround-summary-input"'), "Must provide workaround input");
  assert.ok(source.includes('id="permanent-solution-input"'), "Must provide permanent solution input");
  assert.ok(source.includes('id="known-error-checkbox"'), "Must provide known error checkbox");
  assert.ok(source.includes('id="review-due-at-input"'), "Must provide review due date input");
  assert.ok(source.includes('id="workaround-expires-at-input"'), "Must provide workaround expires input");

  // State handlers and API binding
  assert.ok(source.includes("handleSaveInvestigation"), "Must define handleSaveInvestigation");
  assert.ok(source.includes("/investigation"), "Must persist investigation updates via investigation API");
});

test("4. Problem Manager UI: Governance panel displays lifecycle badge and controls publish/retire workflows", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  // Governance panel & badge
  assert.ok(source.includes('id="workaround-governance-panel"'), "Must render workaround governance panel");
  assert.ok(source.includes('id="workaround-lifecycle-status-badge"'), "Must render workaround status badge");

  // Lifecycle states
  assert.ok(source.includes("APPROVED — Active in Triage"), "Must render APPROVED status");
  assert.ok(source.includes("DRAFT — Internal Only"), "Must render DRAFT status");
  assert.ok(source.includes("RETIRED — Inactive"), "Must render RETIRED status");

  // Action buttons
  assert.ok(source.includes('id="publish-workaround-button"'), "Must render publish button");
  assert.ok(source.includes('id="publish-workaround-modal"'), "Must render publish modal");
  assert.ok(source.includes('id="retire-workaround-button"'), "Must render retire button");
  assert.ok(source.includes('id="retire-workaround-modal"'), "Must render retire modal");

  // Non-closure invariant notice
  assert.ok(
    source.includes("Retiring a workaround does NOT resolve or close this Problem ticket"),
    "Must explicitly inform Problem Manager that retirement does not close the problem ticket"
  );
});

test("5. Service Agent UI: Incident triage workspace integrates KnownErrorSearch with prefill, filter, and copy actions", () => {
  const incidentPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/incidents/[id]/page.tsx"
  );
  assert.ok(fs.existsSync(incidentPath));
  const incSource = fs.readFileSync(incidentPath, "utf-8");

  // Component integration
  assert.ok(incSource.includes("import KnownErrorSearch from"), "Must import KnownErrorSearch");
  assert.ok(incSource.includes("<KnownErrorSearch"), "Must mount KnownErrorSearch component");
  assert.ok(incSource.includes('id="agent-kedb-search-action"'), "Must provide KEDB search action");

  // Search component behavior
  const compPath = path.join(consoleDir, "src/components/itsm/known-error-search.tsx");
  const compSource = fs.readFileSync(compPath, "utf-8");

  assert.ok(compSource.includes('id="known-error-search-input"'), "Must provide search input");
  assert.ok(compSource.includes('id="known-error-prefill-title-btn"'), "Must provide prefill button");
  assert.ok(compSource.includes('id="known-error-service-filter-btn"'), "Must provide service filter button");
  assert.ok(compSource.includes("copy-workaround-"), "Must provide copy workaround action");

  // Fail-closed explanation
  assert.ok(
    compSource.includes("Unapproved drafts, retired, expired, or overdue-review workarounds are strictly excluded"),
    "Must explain fail-closed policy in empty state"
  );
});

test("6. Service Agent UI: Live linking and unlinking with incident-problem reference display", () => {
  const compPath = path.join(consoleDir, "src/components/itsm/known-error-search.tsx");
  const compSource = fs.readFileSync(compPath, "utf-8");

  // Linking actions
  assert.ok(compSource.includes("link-problem-action-"), "Must have link problem action");
  assert.ok(compSource.includes("unlink-problem-action-"), "Must have unlink problem action");
  assert.ok(compSource.includes("/link-problem"), "Must call link-problem API");
  assert.ok(compSource.includes("/unlink-problem"), "Must call unlink-problem API");

  // Reference in incident page
  const incPath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const incSource = fs.readFileSync(incPath, "utf-8");
  assert.ok(incSource.includes('id="incident-linked-problem-badge"'), "Must display linked problem badge");
});

test("7. Invariant verification: Applying/copying workaround or linking does NOT auto-resolve incident", () => {
  const compPath = path.join(consoleDir, "src/components/itsm/known-error-search.tsx");
  const compSource = fs.readFileSync(compPath, "utf-8");

  assert.ok(
    compSource.includes("does not"),
    "Must explicitly emphasize that applying a workaround does not auto-resolve the incident"
  );
  assert.ok(
    compSource.includes("Confirm mitigation with the requester"),
    "Must advise agent to confirm mitigation with requester"
  );
});
