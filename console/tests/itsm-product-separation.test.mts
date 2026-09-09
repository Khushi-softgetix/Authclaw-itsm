import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marketingRoutes } from "../src/marketing/config.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("marketingRoutes exposes itsmLogin pointing to /itsm/login", () => {
  assert.equal(marketingRoutes.itsmLogin, "/itsm/login");
  assert.equal(marketingRoutes.login, "/login");
  assert.equal(marketingRoutes.itsm, "/itsm");
});

test("ConsoleShell source has zero product switchers or cross-product links", () => {
  const shellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  const shellSource = fs.readFileSync(shellPath, "utf-8");

  // Verify switchers are removed
  assert.ok(
    !shellSource.includes('href="/overview"\n                className={`flex-1 text-center py-1 px-2 rounded-md text-[11px]'),
    "ConsoleShell must not have desktop product switcher"
  );
  assert.ok(
    !shellSource.includes('href="/overview"\n                    onClick={() => setMobileMenuOpen(false)}\n                    className={`flex-1 text-center'),
    "ConsoleShell must not have mobile product switcher"
  );

  // Verify cross-product links are removed
  assert.ok(
    !shellSource.includes("Return to AI Governance"),
    "ConsoleShell must not contain 'Return to AI Governance' link"
  );
  assert.ok(
    !shellSource.includes("Platform Products"),
    "ConsoleShell must not contain 'Platform Products' link"
  );

  // Verify distinct branding based on isItsm
  assert.ok(
    shellSource.includes('isItsm ? "AuthClaw ITSM" : "AuthClaw"'),
    "ConsoleShell must render distinct product title"
  );
  assert.ok(
    shellSource.includes('isItsm ? "/itsm/login" : "/login"'),
    "ConsoleShell logout must redirect to the respective product login"
  );
});

test("Proxy middleware isolates /itsm/login and /login redirects", () => {
  const proxyPath = path.join(consoleDir, "src/proxy.ts");
  const proxySource = fs.readFileSync(proxyPath, "utf-8");

  // /itsm/login must be recognized as a public path
  assert.ok(
    proxySource.includes('path === "/itsm/login"'),
    "Proxy must include /itsm/login in public paths"
  );

  // /itsm/login session redirect
  assert.ok(
    proxySource.includes('if (session && path === "/itsm/login")'),
    "Proxy must handle session redirect on /itsm/login"
  );
  assert.ok(
    proxySource.includes('"/itsm/incidents"'),
    "Proxy must redirect authenticated /itsm/login to /itsm/incidents"
  );

  // /login session redirect
  assert.ok(
    proxySource.includes('if (session && path === "/login")'),
    "Proxy must handle session redirect on /login"
  );
  assert.ok(
    proxySource.includes('"/overview"'),
    "Proxy must redirect authenticated /login to /overview"
  );
});

test("ITSM Landing page CTA routes unauthenticated visitors to /itsm/login", () => {
  const landingPath = path.join(consoleDir, "src/app/(marketing)/itsm/page.tsx");
  const landingSource = fs.readFileSync(landingPath, "utf-8");

  assert.ok(
    landingSource.includes('const primaryCtaHref = isAuthenticated ? "/itsm/incidents" : "/itsm/login";'),
    "ITSM landing page must direct unauthenticated visitors to /itsm/login"
  );
});

test("Dedicated ITSM login page reuses /api/auth/login and routes to /itsm/incidents", () => {
  const loginPath = path.join(consoleDir, "src/app/itsm/login/page.tsx");
  const loginSource = fs.readFileSync(loginPath, "utf-8");

  assert.ok(
    loginSource.includes('fetch("/api/auth/login"'),
    "ITSM login page must reuse existing AuthClaw /api/auth/login"
  );
  assert.ok(
    loginSource.includes("AuthClaw ITSM"),
    "ITSM login page must be branded as AuthClaw ITSM"
  );
  assert.ok(
    loginSource.includes('router.push(safeRedirect)'),
    "ITSM login page must route post-login using safeRedirect"
  );
  assert.ok(
    loginSource.includes('returnTo.startsWith("/itsm")'),
    "ITSM login page must enforce /itsm route boundary"
  );
});
