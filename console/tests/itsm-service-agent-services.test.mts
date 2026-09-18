import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SERVICES_PAGE_PATH = path.resolve(process.cwd(), "src/app/(console)/itsm/services/page.tsx");
const SERVICE_DETAIL_PAGE_PATH = path.resolve(process.cwd(), "src/app/(console)/itsm/services/[id]/page.tsx");
const INCIDENT_DETAIL_PATH = path.resolve(process.cwd(), "src/app/(console)/itsm/incidents/[id]/page.tsx");
const REQUEST_DETAIL_PATH = path.resolve(process.cwd(), "src/app/(console)/itsm/requests/[id]/page.tsx");
const BFF_ROUTES_PATH = path.resolve(process.cwd(), "src/lib/bff-routes.ts");
const SHELL_PATH = path.resolve(process.cwd(), "src/components/console-shell.tsx");

test("1. Services Page exists at /itsm/services/page.tsx and connects to services API", () => {
  assert.equal(fs.existsSync(SERVICES_PAGE_PATH), true, "Services page component must exist");
  const content = fs.readFileSync(SERVICES_PAGE_PATH, "utf-8");
  assert.match(content, /\/api\/itsm\/services/);
  assert.match(content, /service-agent-services-page/);
});

test("2. Keyword search and status/tier filtering are configured on Services Page", () => {
  const content = fs.readFileSync(SERVICES_PAGE_PATH, "utf-8");
  assert.match(content, /services-search-input/);
  assert.match(content, /statusFilter/);
  assert.match(content, /tierFilter/);
  assert.match(content, /OPERATIONAL/);
  assert.match(content, /TIER_1/);
});

test("3. Service Detail Page exists at /itsm/services/[id]/page.tsx and connects to service detail API", () => {
  assert.equal(fs.existsSync(SERVICE_DETAIL_PAGE_PATH), true, "Service detail page component must exist");
  const content = fs.readFileSync(SERVICE_DETAIL_PAGE_PATH, "utf-8");
  assert.match(content, /\/api\/itsm\/services\//);
  assert.match(content, /service-detail-page/);
  assert.match(content, /back-to-services-link/);
});

test("4. Service Detail renders required sections: CIs, related incidents, and related requests", () => {
  const content = fs.readFileSync(SERVICE_DETAIL_PAGE_PATH, "utf-8");
  assert.match(content, /service-ci-section/);
  assert.match(content, /service-incidents-section/);
  assert.match(content, /service-requests-section/);
  assert.match(content, /service-metadata-sidebar/);
  assert.match(content, /configuration_items/);
  assert.match(content, /recent_incidents/);
  assert.match(content, /recent_requests/);
});

test("5. Loading, empty, and error states are handled with user-friendly copy", () => {
  const content = fs.readFileSync(SERVICES_PAGE_PATH, "utf-8");
  assert.match(content, /services-loading-state|services-loading-spinner/);
  assert.match(content, /services-empty-state/);
  assert.match(content, /services-error-state/);
});

test("6. Incident Detail page has Service context linking to /itsm/services/[id]", () => {
  assert.equal(fs.existsSync(INCIDENT_DETAIL_PATH), true, "Incident detail page must exist");
  const content = fs.readFileSync(INCIDENT_DETAIL_PATH, "utf-8");
  assert.match(content, /incident-context-service-link/);
  assert.match(content, /\/itsm\/services\/\$\{incident\.service_id\}/);
});

test("7. Request Detail page has Service context linking to /itsm/services/[id]", () => {
  assert.equal(fs.existsSync(REQUEST_DETAIL_PATH), true, "Request detail page must exist");
  const content = fs.readFileSync(REQUEST_DETAIL_PATH, "utf-8");
  assert.match(content, /request-context-service-link/);
  assert.match(content, /\/itsm\/services\/\$\{request\.service_id\}/);
});

test("8. BFF routes configuration allows itsm/services in ALLOWED.GET", () => {
  assert.equal(fs.existsSync(BFF_ROUTES_PATH), true, "bff-routes.ts must exist");
  const content = fs.readFileSync(BFF_ROUTES_PATH, "utf-8");
  assert.match(content, /itsm\\\/services/);
});

test("9. Service Agent navigation sidebar configures Services link", () => {
  assert.equal(fs.existsSync(SHELL_PATH), true, "console-shell.tsx must exist");
  const content = fs.readFileSync(SHELL_PATH, "utf-8");
  assert.match(content, /name:\s*"Services",\s*href:\s*"\/itsm\/services"/);
});
