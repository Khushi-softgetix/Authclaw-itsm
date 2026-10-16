import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. itsm-types.ts exports Known Error governance fields and contracts", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  assert.ok(fs.existsSync(typesPath), "itsm-types.ts must exist");
  const source = fs.readFileSync(typesPath, "utf-8");

  assert.ok(source.includes("export interface ProblemDetailData"), "Must export ProblemDetailData");
  assert.ok(source.includes("symptoms?: string | null;"), "ProblemDetailData must include symptoms");
  assert.ok(source.includes("workaround_status?:"), "ProblemDetailData must include workaround_status");
  assert.ok(source.includes("workaround_approved_at?:"), "ProblemDetailData must include workaround_approved_at");
  assert.ok(source.includes("workaround_expires_at?:"), "ProblemDetailData must include workaround_expires_at");
  assert.ok(source.includes("review_due_at?:"), "ProblemDetailData must include review_due_at");

  assert.ok(source.includes("export interface ProblemInvestigationPayload"), "Must export ProblemInvestigationPayload");
  assert.ok(source.includes("export interface PublishWorkaroundRequest"), "Must export PublishWorkaroundRequest");
  assert.ok(source.includes("export interface RetireWorkaroundRequest"), "Must export RetireWorkaroundRequest");
  assert.ok(source.includes("export interface WorkaroundGovernanceResponse"), "Must export WorkaroundGovernanceResponse");
});

test("2. Problem Detail page renders Known Error Workaround Governance panel and lifecycle status badge", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx"
  );
  assert.ok(fs.existsSync(detailPath), "Problem detail page must exist");
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="workaround-lifecycle-status-badge"'), "Must render workaround lifecycle status badge");
  assert.ok(source.includes("APPROVED — Active in Triage"), "Must support APPROVED state text");
  assert.ok(source.includes("DRAFT — Internal Only"), "Must support DRAFT state text");
  assert.ok(source.includes("RETIRED — Inactive"), "Must support RETIRED state text");
  assert.ok(source.includes('id="workaround-governance-panel"'), "Must render workaround governance panel");
});

test("3. Problem Detail form supports Symptoms & Error Pattern textarea", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="symptoms-input"'), "Must provide symptoms textarea");
  assert.ok(source.includes("Reported Symptoms &amp; Error Pattern"), "Must render symptoms heading");
  assert.ok(source.includes("setSymptoms"), "Must bind symptoms state");
});

test("4. Problem Detail form supports Review Deadline and Workaround Expiration inputs", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="review-due-at-input"'), "Must provide review due date input");
  assert.ok(source.includes('id="workaround-expires-at-input"'), "Must provide workaround expires input");
  assert.ok(source.includes("setReviewDueAt"), "Must bind review due date state");
  assert.ok(source.includes("setWorkaroundExpiresAt"), "Must bind workaround expires date state");
});

test("5. Problem Detail page provides Publish Workaround action and modal", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="publish-workaround-button"'), "Must provide publish workaround button");
  assert.ok(source.includes('id="publish-workaround-modal"'), "Must provide publish workaround modal");
  assert.ok(source.includes("/publish-workaround"), "Must call publish-workaround API endpoint");
  assert.ok(source.includes('id="submit-publish-workaround-button"'), "Must provide submit publish button");
  assert.ok(source.includes('id="cancel-publish-workaround-button"'), "Must provide cancel publish button");
});

test("6. Problem Detail page provides Retire Workaround action and modal with non-closure notice", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="retire-workaround-button"'), "Must provide retire workaround button");
  assert.ok(source.includes('id="retire-workaround-modal"'), "Must provide retire workaround modal");
  assert.ok(source.includes("/retire-workaround"), "Must call retire-workaround API endpoint");
  assert.ok(source.includes('id="retire-reason-input"'), "Must provide retirement reason textarea");
  assert.ok(source.includes('id="submit-retire-workaround-button"'), "Must provide submit retire button");
  assert.ok(source.includes("Retiring a workaround does NOT resolve or close this Problem ticket"), "Must include explicit governance non-closure notice");
});

test("7. Problem Metadata sidebar displays Workaround Status indicator", () => {
  const detailPath = path.join(
    consoleDir,
    "src/app/(console)/itsm/problem-change-manager/problems/[problem_id]/page.tsx"
  );
  const source = fs.readFileSync(detailPath, "utf-8");

  assert.ok(source.includes('id="sidebar-workaround-status"'), "Must display Workaround Status in sidebar");
  assert.ok(source.includes("Workaround Status"), "Must label Workaround Status in metadata");
});
