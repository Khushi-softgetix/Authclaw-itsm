import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. Activity & Collaboration section is integrated into Service Agent incident workspace", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes('id="service-agent-activity-collaboration"') || source.includes("<ActivityTimeline"),
    "Service Agent workspace must integrate ActivityTimeline"
  );
  assert.ok(
    source.includes("ActivityTimeline"),
    "Must import and render ActivityTimeline"
  );
});

test("2. Public comment capability is configured in ActivityTimeline", () => {
  const timelinePath = path.join(consoleDir, "src/components/itsm/activity-timeline.tsx");
  const source = fs.readFileSync(timelinePath, "utf-8");

  assert.ok(
    source.includes("Public Comment"),
    "Must provide Public Comment action"
  );
  assert.ok(
    source.includes('id="composer-public-tab"'),
    "Must render #composer-public-tab selector"
  );
  assert.ok(
    source.includes("/activities"),
    "Must submit to /activities endpoint"
  );
});

test("3. Internal note capability is configured with distinct protection indicators", () => {
  const timelinePath = path.join(consoleDir, "src/components/itsm/activity-timeline.tsx");
  const source = fs.readFileSync(timelinePath, "utf-8");

  assert.ok(
    source.includes("Internal Note"),
    "Must support Internal Note activity"
  );
  assert.ok(
    source.includes('id="composer-internal-tab"'),
    "Must render #composer-internal-tab selector"
  );
  assert.ok(
    source.includes("Never exposed to Requester") || source.includes("Hidden from Requester") || source.includes("Visible to IT staff only"),
    "Must prominently inform agent of internal note protection"
  );
});

test("4. Status update action is integrated using existing status modal and endpoint", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/incidents/[id]/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(
    source.includes("Update Status"),
    "Must provide an Update Status action button"
  );
  assert.ok(
    source.includes("StatusModal"),
    "Must integrate existing StatusModal"
  );
  assert.ok(
    source.includes('id="agent-update-status-action"'),
    "Must render #agent-update-status-action button"
  );
});

test("5. Activity stream renders actor identity and status transition diffs", () => {
  const timelinePath = path.join(consoleDir, "src/components/itsm/activity-timeline.tsx");
  const source = fs.readFileSync(timelinePath, "utf-8");

  assert.ok(
    source.includes("formatActor"),
    "Must format actor identity (name/email)"
  );
  assert.ok(
    source.includes("formatDateTime"),
    "Must format activity timestamps"
  );
  assert.ok(
    source.includes("old_status") || source.includes("old_value"),
    "Must render status transition diffs when available"
  );
});

test("6. Composer error state and empty activity state are handled cleanly", () => {
  const timelinePath = path.join(consoleDir, "src/components/itsm/activity-timeline.tsx");
  const source = fs.readFileSync(timelinePath, "utf-8");

  assert.ok(
    source.includes('id="activity-composer-error"') || source.includes('role="alert"'),
    "Must provide error alert for failed submissions"
  );
  assert.ok(
    source.includes("No activity records found.") || source.includes("No activities yet"),
    "Must provide empty activity state copy"
  );
});

test("7. BFF routes include incident activities and status updates", () => {
  const bffPath = path.join(consoleDir, "src/lib/bff-routes.ts");
  const source = fs.readFileSync(bffPath, "utf-8");

  assert.ok(
    source.includes("activities"),
    "BFF routes must include activities"
  );
  assert.ok(
    source.includes("status"),
    "BFF routes must include status"
  );
});
