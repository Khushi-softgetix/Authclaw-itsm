import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. Resolve Incident action button is integrated into Service Agent workspace", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes('id="agent-resolve-action"'),
    "Must render #agent-resolve-action button"
  );
  assert.ok(
    source.includes("Resolve Incident"),
    "Must display 'Resolve Incident' button label"
  );
  assert.ok(
    source.includes('setTargetModalStatus("RESOLVED")'),
    "Must pre-select RESOLVED status when clicking Resolve Incident"
  );
});

test("2. Resolution Details card is integrated for RESOLVED or CLOSED incidents", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes('id="incident-resolution-card"'),
    "Must render #incident-resolution-card container"
  );
  assert.ok(
    source.includes("Resolution Details"),
    "Must display 'Resolution Details' card header"
  );
  assert.ok(
    source.includes("Resolution Code"),
    "Must display Resolution Code field"
  );
  assert.ok(
    source.includes("Resolved At"),
    "Must display Resolved At field"
  );
  assert.ok(
    source.includes("Resolution Summary"),
    "Must display Resolution Summary field"
  );
});

test("3. Reopen and Close actions are provided when incident is RESOLVED", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes('id="agent-reopen-action"'),
    "Must render #agent-reopen-action button for resolved incidents"
  );
  assert.ok(
    source.includes("Reopen Incident"),
    "Must display 'Reopen Incident' button label"
  );
  assert.ok(
    source.includes('setTargetModalStatus("IN_PROGRESS")'),
    "Must pre-select IN_PROGRESS status when clicking Reopen Incident"
  );
  assert.ok(
    source.includes('id="agent-close-action"'),
    "Must render #agent-close-action button for resolved incidents"
  );
  assert.ok(
    source.includes("Close Incident"),
    "Must display 'Close Incident' button label"
  );
});

test("4. StatusModal supports pre-selected initialStatus and resolution validation", () => {
  const modalPath = path.join(consoleDir, "src/components/itsm/status-modal.tsx");
  const source = fs.readFileSync(modalPath, "utf-8");

  assert.ok(
    source.includes("initialStatus?: string"),
    "StatusModalProps must accept initialStatus prop"
  );
  assert.ok(
    source.includes('id="resolution-code"'),
    "Must render #resolution-code select"
  );
  assert.ok(
    source.includes('id="resolution-summary"'),
    "Must render #resolution-summary textarea"
  );
  assert.ok(
    source.includes('id="status-modal-submit"'),
    "Must render #status-modal-submit button"
  );
  assert.ok(
    source.includes('id="status-modal-cancel"'),
    "Must render #status-modal-cancel button"
  );
  assert.ok(
    source.includes("Resolve Incident"),
    "Must adapt title and submit label when resolving"
  );
  assert.ok(
    source.includes("Reopen Incident"),
    "Must adapt title and submit label when reopening"
  );
});

test("5. Service Agent incident page adheres to Step 2 Test 9 contract without direct textarea", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.strictEqual(
    source.includes("<textarea"),
    false,
    "Service Agent page must not contain direct textarea elements (keeping composers in modular components)"
  );
  assert.ok(
    source.includes("Recent Activity") && source.includes("Read-only preview"),
    "Must retain Step 2 contract compatibility tokens"
  );
});

test("6. StatusModal is rendered inside Service Agent workspace so Update Status button opens modal", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  const agentBlockStart = source.indexOf('userRole === "SERVICE_AGENT"');
  assert.ok(agentBlockStart !== -1, "Must have Service Agent block");
  const agentBlockEnd = source.indexOf('REQUESTER VIEW');
  assert.ok(agentBlockEnd !== -1, "Must have Requester view demarcation");

  const agentWorkspaceSource = source.slice(agentBlockStart, agentBlockEnd);
  assert.ok(
    agentWorkspaceSource.includes('id="agent-update-status-action"'),
    "Service Agent block must contain Update Status button"
  );
  assert.ok(
    agentWorkspaceSource.includes('<StatusModal'),
    "Service Agent block must render StatusModal so clicking Update Status opens modal"
  );
});
