import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("BFF login route forwards productAccess and itsmRole", () => {
  const routePath = path.join(consoleDir, "src/app/api/auth/login/route.ts");
  const source = fs.readFileSync(routePath, "utf-8");

  assert.ok(
    source.includes("productAccess: data.product_access || { governance: true, itsm: false }"),
    "Login BFF route must include productAccess in user object"
  );
  assert.ok(
    source.includes("itsmRole: data.itsm_role || null"),
    "Login BFF route must include itsmRole in user object"
  );
});

test("BFF session route forwards productAccess and itsmRole", () => {
  const routePath = path.join(consoleDir, "src/app/api/auth/session/route.ts");
  const source = fs.readFileSync(routePath, "utf-8");

  assert.ok(
    source.includes("productAccess: principal.product_access || { governance: true, itsm: false }"),
    "Session BFF route must include productAccess"
  );
  assert.ok(
    source.includes("itsmRole: principal.itsm_role || null"),
    "Session BFF route must include itsmRole"
  );
});

test("ITSM login page validates productAccess.itsm and handles error=access_denied", () => {
  const itsmPath = path.join(consoleDir, "src/app/itsm/login/page.tsx");
  const source = fs.readFileSync(itsmPath, "utf-8");

  assert.ok(
    source.includes('params.get("error") === "access_denied"'),
    "ITSM login page must inspect error=access_denied query parameter"
  );
  assert.ok(
    source.includes("data.user.productAccess.itsm === false"),
    "ITSM login page must check productAccess.itsm flag upon login"
  );
  assert.ok(
    source.includes("Your account does not have access to AuthClaw ITSM"),
    "ITSM login page must present clear access denied message"
  );
  assert.ok(
    source.includes("Go to AuthClaw AI Governance Console"),
    "ITSM login page must provide redirect option to Governance"
  );
});

test("Governance login page validates productAccess.governance and handles error=access_denied", () => {
  const govPath = path.join(consoleDir, "src/app/login/page.tsx");
  const source = fs.readFileSync(govPath, "utf-8");

  assert.ok(
    source.includes('params.get("error") === "access_denied"'),
    "Governance login page must inspect error=access_denied query parameter"
  );
  assert.ok(
    source.includes("data.user.productAccess.governance === false"),
    "Governance login page must check productAccess.governance flag upon login"
  );
  assert.ok(
    source.includes("Your account does not have access to AuthClaw AI Governance"),
    "Governance login page must present clear access denied message"
  );
  assert.ok(
    source.includes("Go to AuthClaw ITSM"),
    "Governance login page must provide redirect option to ITSM"
  );
});

test("Console layout guards enforce product boundaries", () => {
  const rootLayoutPath = path.join(consoleDir, "src/app/(console)/layout.tsx");
  const rootSource = fs.readFileSync(rootLayoutPath, "utf-8");
  assert.ok(
    rootSource.includes("isItsmPath && !productAccess.itsm"),
    "Root console layout must verify itsm product access"
  );
  assert.ok(
    rootSource.includes("!isItsmPath && currentPath && !productAccess.governance"),
    "Root console layout must verify governance product access"
  );

  const itsmLayoutPath = path.join(consoleDir, "src/app/(console)/itsm/layout.tsx");
  const itsmSource = fs.readFileSync(itsmLayoutPath, "utf-8");
  assert.ok(
    itsmSource.includes("principal.product_access?.itsm"),
    "Dedicated ITSM layout must check principal itsm product access"
  );
  assert.ok(
    itsmSource.includes('redirect("/itsm/login?error=access_denied")'),
    "Dedicated ITSM layout must redirect unauthorized users to /itsm/login?error=access_denied"
  );
});

test("ConsoleShell supports ITSM business roles", () => {
  const shellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  const shellSource = fs.readFileSync(shellPath, "utf-8");

  assert.ok(
    shellSource.includes("PLATFORM_ADMINISTRATOR: \"Platform Administrator\""),
    "ConsoleShell must support PLATFORM_ADMINISTRATOR"
  );
  assert.ok(
    shellSource.includes("SERVICE_AGENT: \"Service Agent\""),
    "ConsoleShell must support SERVICE_AGENT"
  );
  assert.ok(
    shellSource.includes("INCIDENT_MANAGER: \"Incident Manager\""),
    "ConsoleShell must support INCIDENT_MANAGER"
  );
  assert.ok(
    shellSource.includes("SERVICE_LEAD: \"Incident Manager\""),
    "ConsoleShell must support SERVICE_LEAD"
  );
  assert.ok(
    shellSource.includes("REQUESTER: \"Requester\""),
    "ConsoleShell must support REQUESTER"
  );
  assert.ok(
    shellSource.includes("displayedRole"),
    "ConsoleShell must compute displayedRole"
  );
});

test("Proxy middleware redirects unauthenticated /itsm routes to /itsm/login", () => {
  const proxyPath = path.join(consoleDir, "src/proxy.ts");
  const proxySource = fs.readFileSync(proxyPath, "utf-8").replace(/\r\n/g, "\n");

  assert.ok(
    proxySource.includes('if (path.startsWith("/itsm")) {\n      return NextResponse.redirect(new URL("/itsm/login", request.url));\n    }'),
    "Proxy middleware must route unauthenticated /itsm directly to /itsm/login"
  );
});
