import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

test("Incident Manager operational KPI dashboard stays inside the protected portal", () => {
  const pageUrl = new URL("../src/app/(console)/itsm/incident-manager/kpis/page.tsx", import.meta.url);
  const shellUrl = new URL("../src/components/incident-manager-shell.tsx", import.meta.url);
  assert.ok(existsSync(pageUrl));
  const page = readFileSync(pageUrl, "utf8");
  const shell = readFileSync(shellUrl, "utf8");
  assert.match(page, /\/api\/itsm\/analytics\/kpis\/operational-dashboard/);
  assert.match(page, /start_time/);
  assert.match(page, /service_id/);
  assert.match(page, /priority/);
  assert.match(page, /status/);
  assert.match(page, /Backlog aging is an active, as-of-end-time view/);
  assert.match(page, /MTTA/);
  assert.match(page, /MTTR/);
  assert.match(page, /SLA adherence/);
  assert.match(page, /Backlog aging/);
  assert.match(page, /Reporting scope/);
  assert.match(page, /Performance snapshot/);
  assert.match(page, /Operational breakdown/);
  assert.match(page, /Historical KPI snapshots/);
  assert.match(page, /kpis\/snapshots\?period_grain=/);
  assert.match(page, /No completed historical snapshots yet/);
  assert.match(page, /completed periods are missing/);
  assert.match(page, /Historical KPI snapshots are temporarily unavailable/);
  assert.match(page, /function BacklogDistribution/);
  assert.match(page, /aria-pressed=\{active\}/);
  assert.match(page, /Need the underlying records\?/);
  assert.match(page, /Showing up to \{dashboard\.drilldown_limit\} source incidents/);
  assert.match(shell, /href: "\/itsm\/incident-manager\/kpis", label: "Operational KPIs"/);
  assert.deepEqual(resolveBffRoute("GET", "itsm/analytics/kpis/operational-dashboard"), { backendPath: "/v1/itsm/analytics/kpis/operational-dashboard", body: "none", status: undefined });
});

test("immutable KPI history is available only through the explicit analytics BFF route", () => {
  const route = resolveBffRoute("GET", "itsm/analytics/kpis/snapshots");
  assert.ok(route, "Historical snapshot reads must be explicitly allowlisted");
  assert.equal(route?.backendPath, "/v1/itsm/analytics/kpis/snapshots");
  assert.equal(resolveBffRoute("POST", "itsm/analytics/kpis/snapshots"), null);
});
