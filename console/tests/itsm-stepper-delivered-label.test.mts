import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const consoleDir = path.resolve(__dirname, "..");

test("Service Request detail view overrides RESOLVED label to Delivered", () => {
  const reqDetailPath = path.join(consoleDir, "src/app/(console)/itsm/requests/[id]/page.tsx");
  const content = fs.readFileSync(reqDetailPath, "utf-8");

  assert.ok(
    content.includes('labels={{ RESOLVED: "Delivered" }}'),
    "requests/[id]/page.tsx must pass labels={{ RESOLVED: 'Delivered' }} to IncidentStepper"
  );
  assert.ok(
    content.includes("<IncidentStepper currentStatus={request.status}"),
    "Must preserve currentStatus on IncidentStepper"
  );
});

test("Incident detail view preserves default Resolved label without override", () => {
  const incDetailPath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const content = fs.readFileSync(incDetailPath, "utf-8");

  assert.ok(
    content.includes("<IncidentStepper currentStatus={incident.status} />"),
    "Incident detail page must keep default IncidentStepper without override"
  );
  assert.ok(
    !content.includes("Delivered"),
    "Incident detail page must NOT contain 'Delivered'"
  );
});

test("IncidentStepper component supports custom labels while defaulting to Resolved", () => {
  const stepperPath = path.join(consoleDir, "src/components/itsm/incident-stepper.tsx");
  const content = fs.readFileSync(stepperPath, "utf-8");

  assert.ok(
    content.includes('labels?: Partial<Record<string, string>>;'),
    "IncidentStepperProps must declare optional labels prop"
  );
  assert.ok(
    content.includes('RESOLVED: "Resolved"'),
    "STEP_LABELS must retain RESOLVED: 'Resolved' as default"
  );
  assert.ok(
    content.includes("const effectiveLabels = { ...STEP_LABELS, ...labels };"),
    "IncidentStepper must merge STEP_LABELS with optional labels prop"
  );
});

test("Simulate stepper labels rendering for Service Requests vs Incidents", () => {
  const ORDERED_STEPS = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
  const STEP_LABELS = {
    NEW: "New",
    ASSIGNED: "Assigned",
    IN_PROGRESS: "In Progress",
    PENDING: "Pending",
    RESOLVED: "Resolved",
    CLOSED: "Closed",
    CANCELLED: "Cancelled",
  };

  const computeLabels = (labels?: Record<string, string>) => {
    const effective: Record<string, string> = { ...STEP_LABELS, ...labels };
    return ORDERED_STEPS.map((step: string) => effective[step]);
  };

  // Case 1: Service Request with { RESOLVED: "Delivered" }
  const serviceRequestLabels = computeLabels({ RESOLVED: "Delivered" });
  assert.deepStrictEqual(serviceRequestLabels, [
    "New",
    "Assigned",
    "In Progress",
    "Delivered",
    "Closed",
  ]);

  // Case 2: Incident Request (default / no labels override)
  const incidentLabels = computeLabels(undefined);
  assert.deepStrictEqual(incidentLabels, [
    "New",
    "Assigned",
    "In Progress",
    "Resolved",
    "Closed",
  ]);
});
