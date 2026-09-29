import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("ItsmPublicHeader provides isolated ITSM navigation and branding", () => {
  const headerPath = path.join(consoleDir, "src/itsm/components/itsm-public-header.tsx");
  assert.ok(fs.existsSync(headerPath), "ItsmPublicHeader component must exist");
  const source = fs.readFileSync(headerPath, "utf-8");

  // Verify dedicated branding
  assert.ok(source.includes("AuthClaw"), "Must include AuthClaw");
  assert.ok(source.includes("ITSM"), "Must include ITSM badge");
  assert.ok(source.includes("Ticket"), "Must use Ticket brand icon");

  // Verify dedicated nav links
  assert.ok(source.includes('href: "/itsm"'), "Must link to /itsm Home");
  assert.ok(source.includes('href: "/itsm#capabilities"'), "Must link to /itsm#capabilities");
  assert.ok(source.includes('href: "/itsm/roles"'), "Must link to /itsm/roles");
  assert.ok(source.includes('href: "/itsm#trust"'), "Must link to /itsm#trust");
  assert.ok(!source.includes('href: "/itsm#pricing"'), "Must not advertise unverified pricing");

  // Verify CTAs
  assert.ok(source.includes('href="/itsm/login"'), "Must have ITSM Login CTA");
  assert.ok(source.includes('href="/demo"'), "Must have Book a Demo CTA");

  // Verify zero Governance nav links
  assert.ok(!source.includes('href="/overview"'), "Header must not link to /overview");
  assert.ok(!source.includes('href="/compliance"'), "Header must not link to /compliance");
  assert.ok(!source.includes('href="/policies"'), "Header must not link to /policies");
});

test("ItsmPublicFooter provides dedicated ITSM footer columns and copyright", () => {
  const footerPath = path.join(consoleDir, "src/itsm/components/itsm-public-footer.tsx");
  assert.ok(fs.existsSync(footerPath), "ItsmPublicFooter component must exist");
  const source = fs.readFileSync(footerPath, "utf-8");

  assert.ok(source.includes("AuthClaw"), "Must include AuthClaw");
  assert.ok(source.includes("ITSM"), "Must include ITSM");
  assert.ok(source.includes("/itsm/roles"), "Must link to /itsm/roles");
  assert.ok(source.includes("/itsm/login"), "Must link to /itsm/login");
  assert.ok(source.includes("AgentsArchitects.ai"), "Must credit AgentsArchitects.ai");
  assert.ok(source.includes('heading: "Explore"'), "Must provide compact product navigation");
  assert.ok(source.includes('heading: "Access"'), "Must provide ITSM access links");
  assert.ok(source.includes('heading: "Trust"'), "Must provide trust and legal links");
  assert.ok(source.includes('href: "/cookies"'), "Must link to the cookie notice");
  assert.ok(!source.includes("/itsm/roles#"), "Must not duplicate every role in the footer");
  assert.ok(!source.includes('href: "/login"'), "Must not mix the Governance portal into ITSM navigation");
});

test("MarketingHeader and MarketingFooter isolate /itsm routes", () => {
  const mHeaderPath = path.join(consoleDir, "src/marketing/header.tsx");
  const mFooterPath = path.join(consoleDir, "src/marketing/footer.tsx");
  const mHeaderSource = fs.readFileSync(mHeaderPath, "utf-8");
  const mFooterSource = fs.readFileSync(mFooterPath, "utf-8");

  assert.ok(
    mHeaderSource.includes('pathname === "/itsm" || pathname?.startsWith("/itsm")'),
    "MarketingHeader must return null on /itsm routes"
  );
  assert.ok(
    mFooterSource.includes('pathname === "/itsm" || pathname?.startsWith("/itsm")'),
    "MarketingFooter must return null on /itsm routes"
  );
});

test("ITSM Public Layout mounts ItsmPublicHeader and ItsmPublicFooter", () => {
  const layoutPath = path.join(consoleDir, "src/app/(marketing)/itsm/layout.tsx");
  assert.ok(fs.existsSync(layoutPath), "ITSM Public layout must exist");
  const source = fs.readFileSync(layoutPath, "utf-8");

  assert.ok(source.includes("<ItsmPublicHeader />"), "Layout must render ItsmPublicHeader");
  assert.ok(source.includes("<ItsmPublicFooter />"), "Layout must render ItsmPublicFooter");
});

test("ITSM Roles Page defines all 6 approved roles with dashboard links", () => {
  const rolesPath = path.join(consoleDir, "src/app/(marketing)/itsm/roles/page.tsx");
  const directoryPath = path.join(consoleDir, "src/app/(marketing)/itsm/roles/role-directory.tsx");
  assert.ok(fs.existsSync(rolesPath), "Roles page must exist");
  assert.ok(fs.existsSync(directoryPath), "Role directory component must exist");
  const source = fs.readFileSync(rolesPath, "utf-8");
  const directory = fs.readFileSync(directoryPath, "utf-8");

  const requiredRoles = [
    "REQUESTER",
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "AUDITOR",
  ];

  for (const role of requiredRoles) {
    assert.ok(source.includes(role), `Roles page must define ${role}`);
  }

  const requiredDashboards = [
    "/itsm/dashboard/requester",
    "/itsm/dashboard/service-agent",
    "/itsm/incident-manager",
    "/itsm/dashboard/process-change",
    "/itsm/dashboard/platform-admin",
    "/itsm/dashboard/auditor",
  ];

  for (const dbPath of requiredDashboards) {
    assert.ok(source.includes(dbPath), `Roles page must link to ${dbPath}`);
  }

  assert.ok(directory.includes("md:grid-cols-2"), "Desktop role directory must show two roles per row");
  assert.ok(directory.includes("roles.slice(index,index+2)"), "Role directory must group roles into three pairs");
  assert.ok(directory.includes("current===id?null:id"), "Only one role detail must be selected at a time");
  assert.ok(directory.includes("<RoleDetails role={selectedRole}"), "Selected details must span beneath the role pair");
  assert.ok(source.includes("Choose your ITSM role"), "Roles page must lead with a clear selection task");
  assert.ok(source.includes("Your workspaces"), "Role access guidance must support accounts with multiple roles");
  assert.ok(source.includes("available for your assigned roles"), "Role access guidance must use plural-friendly language");
  assert.ok(source.includes("Sign in to ITSM"), "Role access guidance must provide a concise sign-in action");
  assert.ok(!source.includes("The right workspace, automatically"), "Role access guidance must avoid assuming one workspace");
  assert.ok(!source.includes("Access follows your assigned role"), "Role access guidance must avoid technical wording");
  assert.ok(!source.includes("lg:grid-cols-3") && !directory.includes("lg:grid-cols-3"), "Roles must not return to the card grid layout");
  assert.ok(!source.includes("Role-Based Operational Architecture"), "Roles must avoid decorative heading copy");
});

test("All 6 role dashboard pages exist and dashboard root handles role routing", () => {
  const rootPath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/page.tsx");
  assert.ok(fs.existsSync(rootPath), "Dashboard root page must exist");
  const rootSource = fs.readFileSync(rootPath, "utf-8");

  assert.ok(rootSource.includes("REQUESTER"), "Root must handle REQUESTER");
  assert.ok(rootSource.includes("SERVICE_AGENT"), "Root must handle SERVICE_AGENT");
  assert.ok(rootSource.includes("INCIDENT_MANAGER"), "Root must handle INCIDENT_MANAGER");
  assert.ok(rootSource.includes("SERVICE_LEAD"), "Root must handle SERVICE_LEAD");
  assert.ok(rootSource.includes("PROCESS_CHANGE_MANAGER"), "Root must handle PROCESS_CHANGE_MANAGER");
  assert.ok(rootSource.includes("PLATFORM_ADMINISTRATOR"), "Root must handle PLATFORM_ADMINISTRATOR");
  assert.ok(rootSource.includes("AUDITOR"), "Root must handle AUDITOR");

  const dashboards = [
    "requester",
    "service-agent",
    "service-lead",
    "process-change",
    "platform-admin",
    "auditor",
  ];

  for (const db of dashboards) {
    const pagePath = path.join(consoleDir, `src/app/(console)/itsm/dashboard/${db}/page.tsx`);
    assert.ok(fs.existsSync(pagePath), `Dashboard page for ${db} must exist`);
  }
});

test("ConsoleShell itsmNavigation contains all approved ITSM modules with zero Governance items", () => {
  const shellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  const source = fs.readFileSync(shellPath, "utf-8");

  const itsmNavItems = [
    "Dashboard",
    "Incidents",
    "Requests",
    "Knowledge",
    "Services",
    "Problems & Changes",
    "CMDB",
    "Reports & Audit",
  ];

  for (const item of itsmNavItems) {
    assert.ok(
      source.includes(`name: "${item}"`),
      `itsmNavigation must include ${item}`
    );
  }

  // Ensure operational portal has NO Administration menu
  assert.ok(
    !source.includes('name: "Administration"'),
    "ConsoleShell itsmNavigation must NOT include Administration"
  );
});
