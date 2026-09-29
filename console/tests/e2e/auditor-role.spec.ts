import { expect, test } from "@playwright/test";

const auditorEmail = process.env.E2E_AUDITOR_EMAIL || "auditor@authclaw-lite.demo";
const auditorPassword = process.env.E2E_LOGIN_PASSWORD || "AuthClawDemo!234";
const tenantName = process.env.E2E_LOGIN_TENANT || "AuthClaw Lite Demo";

async function loginAsAuditor(page: import("@playwright/test").Page) {
  await page.goto("/itsm/login");
  await page.locator('input[type="email"]').fill(auditorEmail);
  await page.locator('input[type="password"]').fill(auditorPassword);
  await page.getByPlaceholder("your-company (if shared email)").fill(tenantName);
  await page.getByRole("button", { name: "Login to ITSM", exact: true }).click();
  await page.waitForURL("/itsm/dashboard/auditor");
}

test("Auditor journeys use real tenant evidence and remain read-only", async ({ page }) => {
  test.setTimeout(90_000);
  await loginAsAuditor(page);

  for (const item of ["Overview", "Audit Log", "Evidence", "Reports", "Exports"]) {
    await expect(page.getByRole("link", { name: item, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Audit overview" })).toBeVisible();
  await expect(page.getByText("Total audit events", { exact: true })).toBeVisible();

  const overview = await page.request.get("/api/itsm/audit/overview");
  expect(overview.ok(), await overview.text()).toBeTruthy();
  const overviewBody = await overview.json() as { total_events: number; source: string };
  expect(overviewBody.total_events).toBeGreaterThanOrEqual(0);
  expect(overviewBody.source).toBe("postgres");

  const forbiddenOperationalRead = await page.request.get("/api/itsm/incidents?limit=1");
  expect(forbiddenOperationalRead.status()).toBe(403);
  const forbiddenGenericAuditRead = await page.request.get("/api/audit?limit=1");
  expect(forbiddenGenericAuditRead.status()).toBe(403);

  await page.getByRole("link", { name: "Audit Log", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();

  const searchResponse = page.waitForResponse((response) =>
    response.url().includes("/api/itsm/audit/events?") && response.url().includes("search="),
  );
  await page.getByPlaceholder(/Search action, actor, target/).fill("itsm.audit");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  expect((await searchResponse).ok()).toBeTruthy();

  await page.getByRole("button", { name: /clear search/i }).first().click().catch(() => undefined);
  const firstInspect = page.getByRole("button", { name: "Inspect evidence" }).first();
  if (await firstInspect.isVisible().catch(() => false)) {
    await firstInspect.click();
    await expect(page.getByRole("button", { name: "Back to Audit Trail" })).toBeVisible();
    await expect(page.getByText("Hash-chain evidence", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to Audit Trail" }).click();
  }

  await page.getByRole("link", { name: "Evidence", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evidence explorer" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Platform evidence" })).toBeVisible();
  await page.getByRole("tab", { name: "AI activity evidence" }).click();
  const traces = await page.request.get("/api/itsm/audit/traces?limit=25&offset=0&integrity_check=true");
  expect(traces.ok(), await traces.text()).toBeTruthy();

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Audit reports" })).toBeVisible();
  await expect(page.getByText("Counts are derived from the authoritative tenant audit chain.")).toBeVisible();

  await page.getByRole("link", { name: "Exports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evidence exports" })).toBeVisible();
  await expect(page.getByLabel("Exact action (optional)")).toBeVisible();
  await expect(page.getByText("Authorized export history", { exact: true })).toBeVisible();
});
