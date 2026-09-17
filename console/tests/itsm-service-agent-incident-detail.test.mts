import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. /itsm/incidents/[id] route exists in console app directory", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Page must exist at src/app/(console)/itsm/incidents/[id]/page.tsx");
});

test("2. Service Agent workspace container and ID are defined for SERVICE_AGENT role", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes('userRole === "SERVICE_AGENT"'),
    "Must have dedicated branch for userRole === SERVICE_AGENT"
  );
  assert.ok(
    source.includes('id="service-agent-incident-workspace"'),
    "Must render #service-agent-incident-workspace container"
  );
  assert.ok(
    source.includes("?agent_view=true"),
    "Must fetch incident with agent_view=true for Service Agent"
  );
});

test("3. Unauthorized users are denied with permission error message", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes("You do not have permission to view this incident."),
    "Must display exact unauthorized copy"
  );
  assert.ok(
    source.includes('id="agent-incident-unauthorized"'),
    "Must render #agent-incident-unauthorized container"
  );
  assert.ok(
    source.includes('incRes.status === 403'),
    "Must handle HTTP 403 response as unauthorized"
  );
});

test("4. Incident overview and context fields render correctly with fallback states", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Overview headers and fields
  assert.ok(source.includes("Incident Overview"), "Must render Incident Overview section");
  assert.ok(source.includes("Ticket #"), "Must display Ticket # label");
  assert.ok(source.includes("Priority"), "Must display Priority label");
  assert.ok(source.includes("Status"), "Must display Status label");
  assert.ok(source.includes("Category"), "Must display Category label");
  assert.ok(source.includes("Service"), "Must display Service label");
  assert.ok(source.includes("Assigned Team"), "Must display Assigned Team label");
  assert.ok(source.includes("Assignee"), "Must display Assignee label");
  assert.ok(source.includes("Created Time"), "Must display Created Time label");
  assert.ok(source.includes("Updated Time"), "Must display Updated Time label");
  assert.ok(source.includes("Short Description"), "Must display Short Description label");
  assert.ok(source.includes("Description"), "Must display Description label");

  // Fallback state
  assert.ok(source.includes('"Not set"'), "Must display Not set fallback for empty fields");
  assert.ok(
    source.includes('"No description provided."'),
    "Must display 'No description provided.' if description is blank"
  );

  // Context card
  assert.ok(source.includes("Incident Context"), "Must render Incident Context card");
  assert.ok(source.includes("Configuration Item"), "Must display Configuration Item");
  assert.ok(source.includes("Assignment Group"), "Must display Assignment Group");
});

test("5. Loading state exists with exact user-facing copy", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes("Loading incident..."),
    "Must display exact 'Loading incident...' text"
  );
  assert.ok(
    source.includes('id="agent-incident-loading"'),
    "Must render #agent-incident-loading container"
  );
});

test("6. Not-found state exists with exact user-facing copy", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes("Incident not found"),
    "Must display exact 'Incident not found' text"
  );
  assert.ok(
    source.includes('id="agent-incident-not-found"'),
    "Must render #agent-incident-not-found container"
  );
});

test("7. Server error and retry state exists with exact user-facing copy", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes("Unable to load incident. Please try again."),
    "Must display exact 'Unable to load incident. Please try again.' text"
  );
  assert.ok(
    source.includes("Retry"),
    "Must provide a Retry button"
  );
  assert.ok(
    source.includes('id="agent-incident-error"'),
    "Must render #agent-incident-error container"
  );
});

test("8. Navigation links Back to My Work at /itsm/dashboard/agent", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes('href="/itsm/dashboard/agent"'),
    "Must link back to /itsm/dashboard/agent"
  );
  assert.ok(
    source.includes("Back to My Work"),
    "Must label back button as 'Back to My Work'"
  );
  assert.ok(
    source.includes('id="back-to-my-work"'),
    "Must have id back-to-my-work"
  );
});

test("9. Recent activity section is read-only without composers or attachments", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("Recent Activity"), "Must render Recent Activity heading");
  assert.ok(source.includes("Read-only preview"), "Must label as Read-only preview");
  assert.ok(source.includes("No activity recorded yet."), "Must display empty activity state");

  // Verify no composers in Service Agent view
  assert.ok(
    !source.includes("<textarea") && !source.includes("add-comment"),
    "Must not include comments or internal notes composer"
  );
});

test("10. SLA card displays reliable status and resolution due timestamp", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="incident-sla-card"'), "Must render #incident-sla-card");
  assert.ok(source.includes("Resolution Due"), "Must display Resolution Due label");
  assert.ok(source.includes("SLA information unavailable"), "Must display unavailable fallback");
  assert.ok(source.includes("itsmSlaConfig"), "Must use itsmSlaConfig helper");
});
