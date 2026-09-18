import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Test suite for Step 5: Service Agent Knowledge
test("1. Knowledge Page exists at /itsm/knowledge/page.tsx and connects to knowledge API", () => {
  const pagePath = path.join(process.cwd(), "src/app/(console)/itsm/knowledge/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Knowledge page must exist at /itsm/knowledge/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="service-agent-knowledge-page"'), "Must render service-agent-knowledge-page container");
  assert.ok(source.includes('/api/itsm/knowledge'), "Must query the /api/itsm/knowledge BFF endpoint");
  assert.ok(source.includes('useSearchParams'), "Must read URL search parameters (incident/search context)");
});

test("2. Keyword search and category filtering are configured on Knowledge Page", () => {
  const pagePath = path.join(process.cwd(), "src/app/(console)/itsm/knowledge/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="knowledge-search-input"'), "Must provide search input with id knowledge-search-input");
  assert.ok(source.includes('id="knowledge-search-button"'), "Must provide search action button");
  assert.ok(source.includes('Networking'), "Must include Networking category");
  assert.ok(source.includes('Authentication'), "Must include Authentication category");
  assert.ok(source.includes('Troubleshooting'), "Must include Troubleshooting category");
});

test("3. Article detail view renders readable content, metadata badges, and back navigation", () => {
  const pagePath = path.join(process.cwd(), "src/app/(console)/itsm/knowledge/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="article-detail-modal"'), "Must render article detail modal/view");
  assert.ok(source.includes('id="article-markdown-body"'), "Must render article markdown body container");
  assert.ok(source.includes('id="back-to-knowledge-btn"'), "Must provide Back to Knowledge button");
  assert.ok(source.includes('id="close-article-detail-btn"'), "Must provide close article detail button");
});

test("4. Loading, empty, search-empty, and error states are handled with user-friendly copy", () => {
  const pagePath = path.join(process.cwd(), "src/app/(console)/itsm/knowledge/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('id="knowledge-loading-state"'), "Must provide knowledge-loading-state");
  assert.ok(source.includes('id="knowledge-empty-state"'), "Must provide knowledge-empty-state");
  assert.ok(source.includes('id="knowledge-search-empty-state"'), "Must provide knowledge-search-empty-state");
  assert.ok(source.includes('id="knowledge-error-state"'), "Must provide knowledge-error-state");
  assert.ok(source.includes('id="retry-knowledge-btn"'), "Must provide retry button on error");
  assert.ok(source.includes('id="clear-search-btn"'), "Must provide clear search button");
});

test("5. Incident Detail page has Search Knowledge action linking to /itsm/knowledge", () => {
  const incidentPagePath = path.join(process.cwd(), "src/app/(console)/itsm/incidents/[id]/page.tsx");
  assert.ok(fs.existsSync(incidentPagePath), "Incident detail page must exist");
  const source = fs.readFileSync(incidentPagePath, "utf-8");

  assert.ok(source.includes('id="agent-knowledge-search-action"'), "Must provide #agent-knowledge-search-action button");
  assert.ok(source.includes('/itsm/knowledge?incident='), "Action must link to /itsm/knowledge?incident= context");
  assert.ok(source.includes('Search Knowledge'), "Must render user-friendly text 'Search Knowledge'");
});

test("6. BFF routes configuration allows itsm/knowledge in ALLOWED.GET", () => {
  const bffPath = path.join(process.cwd(), "src/lib/bff-routes.ts");
  assert.ok(fs.existsSync(bffPath), "bff-routes.ts must exist");
  const source = fs.readFileSync(bffPath, "utf-8");

  assert.ok(source.includes("itsm\\/knowledge"), "Must include itsm/knowledge in allowed GET routes");
});

test("7. Service Agent navigation sidebar configures Knowledge link", () => {
  const shellPath = path.join(process.cwd(), "src/components/console-shell.tsx");
  assert.ok(fs.existsSync(shellPath), "console-shell.tsx must exist");
  const source = fs.readFileSync(shellPath, "utf-8");

  assert.ok(source.includes('href: "/itsm/knowledge"'), "Sidebar must link to /itsm/knowledge");
  assert.ok(source.includes('name: "Knowledge"'), "Sidebar must include Knowledge item");
});

test("8. Article cards and modal render required metadata: title, category, status, summary, author, updated time", () => {
  const pagePath = path.join(process.cwd(), "src/app/(console)/itsm/knowledge/page.tsx");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes("article.title"), "Article card must render title");
  assert.ok(source.includes("article.category"), "Article card must render category");
  assert.ok(source.includes("article.status"), "Article card must render status badge");
  assert.ok(source.includes("article.summary"), "Article card must render summary");
  assert.ok(source.includes("article.updated_at"), "Article card must render updated timestamp");
  assert.ok(source.includes("article.author_email"), "Article card must render author if available");

  assert.ok(source.includes("articleDetail.title"), "Modal must render article title");
  assert.ok(source.includes("articleDetail.category"), "Modal must render article category");
  assert.ok(source.includes("articleDetail.status"), "Modal must render article status badge");
  assert.ok(source.includes("articleDetail.content_markdown"), "Modal must render article content markdown");
  assert.ok(source.includes("articleDetail.version_number"), "Modal must render article version number");
  assert.ok(source.includes("articleDetail.author_email"), "Modal must render author if available");
});

test("9. Request Detail page has Search Knowledge action linking to /itsm/knowledge", () => {
  const requestPagePath = path.join(process.cwd(), "src/app/(console)/itsm/requests/[id]/page.tsx");
  assert.ok(fs.existsSync(requestPagePath), "Request detail page must exist");
  const source = fs.readFileSync(requestPagePath, "utf-8");

  assert.ok(source.includes('id="agent-request-knowledge-action"'), "Must provide #agent-request-knowledge-action button");
  assert.ok(source.includes('/itsm/knowledge?request='), "Action must link to /itsm/knowledge?request= context");
  assert.ok(source.includes('Search Knowledge'), "Must render user-friendly text 'Search Knowledge'");
});

