import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. Report Recurring Problem modal component exists with required fields and states", () => {
  const modalPath = path.join(consoleDir, "src/components/itsm/report-recurring-problem-modal.tsx");
  assert.ok(fs.existsSync(modalPath), "Modal component must exist");
  const source = fs.readFileSync(modalPath, "utf-8");

  // Read-only context fields
  assert.ok(source.includes("Originating Incident"), "Must display Originating Incident context");
  assert.ok(source.includes("incident.ticket_number"), "Must display incident ticket number");
  assert.ok(source.includes("incident.title"), "Must display incident title");
  assert.ok(source.includes("incident.priority"), "Must display incident priority");
  assert.ok(source.includes("incident.service_name"), "Must display incident service name");

  // Editable inputs
  assert.ok(source.includes("Problem Short Description"), "Must have Problem Short Description input");
  assert.ok(source.includes("Reason / Recurring Issue"), "Must have Reason / Recurring Issue input");
  assert.ok(source.includes("Notes"), "Must have Notes input");

  // Action buttons
  assert.ok(source.includes("Report Problem"), "Must have Report Problem button");
  assert.ok(source.includes('id="report-problem-submit-button"'), "Must have #report-problem-submit-button");
  assert.ok(source.includes("Cancel"), "Must have Cancel button");

  // Duplicate problem protection handling
  assert.ok(
    source.includes("Recurring problem already reported.") || source.includes("already has a linked problem"),
    "Must handle duplicate problem reporting"
  );

  // Success view with link to PCM problems
  assert.ok(source.includes("Recurring problem reported successfully."), "Must have success confirmation");
  assert.ok(source.includes("/itsm/problem-change-manager/problems"), "Must link to PCM problems view");
});

test("2. Incident detail page includes Report Recurring Problem button for Service Agent only", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Action button with required id in Service Agent workspace
  assert.ok(
    source.includes('id="agent-report-recurring-problem-action"'),
    "Must render #agent-report-recurring-problem-action button"
  );
  assert.ok(
    source.includes("Report Recurring Problem"),
    "Button must have text 'Report Recurring Problem'"
  );

  // Modal integration
  assert.ok(
    source.includes("ReportRecurringProblemModal"),
    "Must import and render ReportRecurringProblemModal"
  );
  assert.ok(
    source.includes("showRecurringModal"),
    "Must have state controlling ReportRecurringProblemModal"
  );

  // Linked Problem badge/display in overview
  assert.ok(
    source.includes("Linked Problem"),
    "Must display Linked Problem section in Incident Overview"
  );
  assert.ok(
    source.includes("linked_problem_ticket_number") || source.includes("linked_problem_id"),
    "Must reference linked problem fields"
  );

  // Verify button is within userRole === SERVICE_AGENT block
  const agentBlockStart = source.indexOf('userRole === "SERVICE_AGENT"');
  const buttonIdx = source.indexOf('id="agent-report-recurring-problem-action"');
  assert.ok(agentBlockStart !== -1, "Must have SERVICE_AGENT role condition");
  assert.ok(buttonIdx > agentBlockStart, "Report Recurring Problem button must be inside Service Agent block");
});

test("3. BFF route proxy allows report-recurring-problem and report-problem endpoints", () => {
  const bffPath = path.join(consoleDir, "src/lib/bff-routes.ts");
  const source = fs.readFileSync(bffPath, "utf-8");

  assert.ok(
    source.includes("report-recurring-problem"),
    "BFF ALLOWED.POST must permit report-recurring-problem"
  );
  assert.ok(
    source.includes("report-problem"),
    "BFF ALLOWED.POST must permit report-problem alias"
  );
});

test("4. TypeScript types define linked_problem fields and payload interfaces", () => {
  const typesPath = path.join(consoleDir, "src/lib/itsm-types.ts");
  const source = fs.readFileSync(typesPath, "utf-8");

  assert.ok(source.includes("linked_problem_id"), "Incident type must include linked_problem_id");
  assert.ok(source.includes("linked_problem_ticket_number"), "Incident type must include linked_problem_ticket_number");
  assert.ok(source.includes("ReportRecurringProblemPayload"), "Must export ReportRecurringProblemPayload");
  assert.ok(source.includes("ReportRecurringProblemResponse"), "Must export ReportRecurringProblemResponse");
});
