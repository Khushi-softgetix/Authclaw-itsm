import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("Service Agent workspace page exists at /itsm/dashboard/agent/page.tsx", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/agent/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Workspace page must exist at /itsm/dashboard/agent/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Verify headers and titles
  assert.ok(source.includes("Service Agent Workspace"), "Must display Service Agent Workspace badge");
  assert.ok(source.includes("My Work"), "Must display My Work title");

  // Verify small summary metrics
  assert.ok(source.includes("Assigned to me"), "Must display Assigned to me metric card");
  assert.ok(source.includes("Needs attention"), "Must display Needs attention metric card");
  assert.ok(source.includes("SLA at risk"), "Must display SLA at risk metric card");

  // Verify filters
  assert.ok(source.includes('"all"'), "Must support All filter");
  assert.ok(source.includes('"assigned_to_me"'), "Must support Assigned to me filter");
  assert.ok(source.includes('"high_priority"'), "Must support High priority filter");
  assert.ok(source.includes('"sla_risk"'), "Must support SLA at risk filter");

  // Verify sorting
  assert.ok(source.includes('"recently_updated"'), "Must support recently_updated sorting");
  assert.ok(source.includes('"priority"'), "Must support priority sorting");

  // Verify queue table headers
  assert.ok(source.includes("Ticket #"), "Table must include Ticket # header");
  assert.ok(source.includes("Description"), "Table must include Description header");
  assert.ok(source.includes("Priority"), "Table must include Priority header");
  assert.ok(source.includes("Status"), "Table must include Status header");
  assert.ok(source.includes("Service"), "Table must include Service header");
  assert.ok(source.includes("Assigned Team"), "Table must include Assigned Team header");
  assert.ok(source.includes("Updated"), "Table must include Updated header");
  assert.ok(source.includes("SLA Risk"), "Table must include SLA Risk header");

  // Verify empty & error states
  assert.ok(source.includes("No work assigned"), "Must include No work assigned empty state");
  assert.ok(source.includes("caught up"), "Must include caught up text");
  assert.ok(source.includes("Retry"), "Must provide a Retry button in error state");

  // Verify API endpoint call
  assert.ok(source.includes("/api/itsm/incidents/queue"), "Must fetch from /api/itsm/incidents/queue");
});

test("Service Agent server-side layout guard exists at /itsm/dashboard/agent/layout.tsx", () => {
  const layoutPath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/agent/layout.tsx");
  assert.ok(fs.existsSync(layoutPath), "Layout guard must exist at /itsm/dashboard/agent/layout.tsx");
  const source = fs.readFileSync(layoutPath, "utf-8");

  // Enforce session check
  assert.ok(source.includes("authclaw_session"), "Must inspect authclaw_session cookie");

  // Enforce ITSM product access
  assert.ok(source.includes("principal.product_access?.itsm"), "Must verify ITSM product access");
  assert.ok(source.includes('redirect("/itsm/login?error=access_denied")'), "Must redirect on missing product access");

  // Enforce SERVICE_AGENT role
  assert.ok(source.includes('itsmRole !== "SERVICE_AGENT"'), "Must enforce SERVICE_AGENT role check");
  assert.ok(source.includes('redirect("/itsm/dashboard?error=service_agent_required")'), "Must redirect non-agents");
});

test("ConsoleShell configures serviceAgentNavigation with isolated operational routes", () => {
  const shellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  const rawSource = fs.readFileSync(shellPath, "utf-8");
  const source = rawSource.replace(/\r\n/g, "\n");

  // Verify dedicated nav items
  assert.ok(source.includes("serviceAgentNavigation"), "Must define serviceAgentNavigation array");
  assert.ok(source.includes('href: "/itsm/dashboard/agent"'), "Must link My Work to /itsm/dashboard/agent");
  assert.ok(source.includes('href: "/itsm/incidents"'), "Must link Incidents to /itsm/incidents");
  assert.ok(source.includes('href: "/itsm/requests"'), "Must link Requests to /itsm/requests");
  assert.ok(source.includes('href: "/itsm/knowledge"'), "Must link Knowledge to /itsm/knowledge");
  assert.ok(source.includes('href: "/itsm/services"'), "Must link Services to /itsm/services");

  // Verify role switching in ConsoleShell
  assert.ok(
    source.includes('effectiveItsmRole === "SERVICE_AGENT"\n      ? serviceAgentNavigation'),
    "ConsoleShell must activate serviceAgentNavigation for SERVICE_AGENT"
  );

  // Verify page title resolution
  assert.ok(
    source.includes('pathname === "/itsm/dashboard/agent"\n      ? "My Work"'),
    "ConsoleShell must resolve /itsm/dashboard/agent to My Work"
  );
});

test("Login page routes SERVICE_AGENT directly to /itsm/dashboard/agent", () => {
  const loginPath = path.join(consoleDir, "src/app/itsm/login/page.tsx");
  const source = fs.readFileSync(loginPath, "utf-8");

  assert.ok(
    source.includes('case "SERVICE_AGENT":\n          defaultRoute = "/itsm/dashboard/agent";'),
    "Login must route SERVICE_AGENT to /itsm/dashboard/agent"
  );
});

test("Dashboard root redirects SERVICE_AGENT to /itsm/dashboard/agent", () => {
  const rootPath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/page.tsx");
  const source = fs.readFileSync(rootPath, "utf-8");

  assert.ok(
    source.includes('case "SERVICE_AGENT":\n      redirect("/itsm/dashboard/agent");'),
    "Dashboard root must redirect SERVICE_AGENT to /itsm/dashboard/agent"
  );
});

test("Legacy /itsm/dashboard/service-agent redirects to /itsm/dashboard/agent", () => {
  const legacyPath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/service-agent/page.tsx");
  const source = fs.readFileSync(legacyPath, "utf-8");

  assert.ok(
    source.includes('redirect("/itsm/dashboard/agent")'),
    "Legacy service-agent page must redirect to /itsm/dashboard/agent"
  );
});

test("itsm-format.ts provides itsmSlaConfig helper", () => {
  const formatPath = path.join(consoleDir, "src/lib/itsm-format.ts");
  const source = fs.readFileSync(formatPath, "utf-8");

  assert.ok(source.includes("export function itsmSlaConfig"), "Must export itsmSlaConfig");
  assert.ok(source.includes('"On track"'), "Must include On track label");
  assert.ok(source.includes('"At risk"'), "Must include At risk label");
  assert.ok(source.includes('"Breached"'), "Must include Breached label");
});
