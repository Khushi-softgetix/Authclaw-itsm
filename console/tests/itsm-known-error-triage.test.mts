import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. KnownErrorSearch component exists in console components directory", () => {
  const componentPath = path.join(consoleDir, "src/components/itsm/known-error-search.tsx");
  assert.ok(
    fs.existsSync(componentPath),
    "Component must exist at src/components/itsm/known-error-search.tsx"
  );
});

test("2. itsm-types.ts exports KnownErrorLookupItem and linking interfaces", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  const source = fs.readFileSync(typesPath, "utf-8");

  assert.ok(source.includes("export interface KnownErrorLookupItem"), "Must export KnownErrorLookupItem");
  assert.ok(source.includes("workaround_status:"), "Must include workaround_status field");
  assert.ok(source.includes("workaround_summary: string"), "Must include workaround_summary field");
  assert.ok(source.includes("symptoms?: string | null"), "Must include optional symptoms field");
  assert.ok(source.includes("permanent_solution?: string | null"), "Must include optional permanent_solution field");
  assert.ok(source.includes("export interface LinkIncidentProblemRequest"), "Must export LinkIncidentProblemRequest");
  assert.ok(source.includes("export interface LinkIncidentProblemResponse"), "Must export LinkIncidentProblemResponse");
});

test("3. KnownErrorSearch integrates keyword/symptoms search and affected service filter", () => {
  const componentPath = path.join(consoleDir, "src/components/itsm/known-error-search.tsx");
  const source = fs.readFileSync(componentPath, "utf-8");

  assert.ok(source.includes('id="known-error-search-input"'), "Must provide search input with id known-error-search-input");
  assert.ok(source.includes('id="known-error-search-submit"'), "Must provide search submit button with id known-error-search-submit");
  assert.ok(source.includes('id="known-error-service-filter-btn"'), "Must provide service filter toggle with id known-error-service-filter-btn");
  assert.ok(source.includes('id="known-error-prefill-title-btn"'), "Must provide quick prefill button using incident title");
  assert.ok(source.includes("/api/itsm/problems/known-errors"), "Must query /api/itsm/problems/known-errors endpoint");
});

test("4. KnownErrorSearch renders loading, empty, and error states with clear user-facing copy", () => {
  const componentPath = path.join(consoleDir, "src/components/itsm/known-error-search.tsx");
  const source = fs.readFileSync(componentPath, "utf-8");

  // Loading state
  assert.ok(source.includes('id="known-error-loading"'), "Must provide loading container id");
  assert.ok(source.includes("Searching Known Error Database..."), "Must display exact searching copy");

  // Empty state
  assert.ok(source.includes('id="known-error-empty"'), "Must provide empty container id");
  assert.ok(source.includes("No Approved Known Errors Found"), "Must display exact empty state title");
  assert.ok(source.includes("Unapproved drafts, retired, expired, or overdue-review workarounds are strictly excluded"), "Must explain fail-closed policy");

  // Error state
  assert.ok(source.includes('id="known-error-error"'), "Must provide error container id");
  assert.ok(source.includes("Retry"), "Must provide retry button");
});

test("5. Results display approved workaround steps, symptoms, root-cause, permanent fix, and copy action", () => {
  const componentPath = path.join(consoleDir, "src/components/itsm/known-error-search.tsx");
  const source = fs.readFileSync(componentPath, "utf-8");

  assert.ok(source.includes('id="known-error-results-list"'), "Must provide results list container");
  assert.ok(source.includes("Approved Workaround Steps"), "Must display Approved Workaround Steps heading");
  assert.ok(source.includes("item.workaround_summary"), "Must display workaround summary text");
  assert.ok(source.includes("copy-workaround-"), "Must provide copy workaround action");
  assert.ok(source.includes("Reported Symptoms"), "Must display symptoms heading when present");
  assert.ok(source.includes("Underlying Root Cause"), "Must display root cause heading when present");
  assert.ok(source.includes("Permanent Solution / Fix Status"), "Must display permanent fix heading when present");
});

test("6. Link and unlink actions are provided with duplicate-link prevention", () => {
  const componentPath = path.join(consoleDir, "src/components/itsm/known-error-search.tsx");
  const source = fs.readFileSync(componentPath, "utf-8");

  // Link and unlink endpoints
  assert.ok(source.includes("/link-problem"), "Must call incident link-problem endpoint");
  assert.ok(source.includes("/unlink-problem"), "Must call incident unlink-problem endpoint");

  // Link button ids
  assert.ok(source.includes("link-problem-action-"), "Must have link-problem-action button id");
  assert.ok(source.includes("unlink-problem-action-"), "Must have unlink-problem-action button id");

  // Prevention of duplicate link and display of current link
  assert.ok(source.includes("Currently Linked"), "Must display Currently Linked badge");
  assert.ok(source.includes("Switch to this Problem"), "Must offer switch when another problem is already linked");
  assert.ok(source.includes('id="active-linked-problem-banner"'), "Must render active linked problem banner");
});

test("7. Explicit governance policy clarifies that workaround display does NOT auto-resolve incident", () => {
  const componentPath = path.join(consoleDir, "src/components/itsm/known-error-search.tsx");
  const source = fs.readFileSync(componentPath, "utf-8");

  assert.ok(
    source.includes("does not"),
    "Must explicitly state that applying a workaround does not auto-resolve the incident"
  );
  assert.ok(
    source.includes("Confirm mitigation with the requester"),
    "Must instruct agent to confirm mitigation before resolution"
  );
});

test("8. Incident detail page mounts KnownErrorSearch directly into Service Agent triage workspace", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes("import KnownErrorSearch from"),
    "Must import KnownErrorSearch in incident detail page"
  );
  assert.ok(
    source.includes("<KnownErrorSearch"),
    "Must render <KnownErrorSearch /> component"
  );
  assert.ok(
    source.includes('id="agent-kedb-search-action"'),
    "Must provide #agent-kedb-search-action button to search KEDB within page"
  );
  assert.ok(
    source.includes("Find Workarounds (KEDB)"),
    "Must label action as Find Workarounds (KEDB)"
  );
});
