import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. Catalog Studio main page exists and implements required layout and controls", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/studio/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Catalog Studio main page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Header & CTAs
  assert.ok(source.includes("Catalog Studio"), "Must display Catalog Studio title");
  assert.ok(source.includes("Manage the services, products, and request offerings"), "Must display standard description");
  assert.ok(source.includes("/itsm/catalog-manager/studio/new"), "Must link to Create Catalog Item page");

  // Summary KPI Cards (strictly supported data)
  assert.ok(source.includes("Total Offerings"), "Must include Total Offerings card");
  assert.ok(source.includes("Active"), "Must include Active card");
  assert.ok(source.includes("Inactive"), "Must include Inactive card");
  assert.ok(source.includes("Needs Attention"), "Must include Needs Attention card");

  // Search & Filter controls
  assert.ok(source.includes("catalog-search-input"), "Must include search input");
  assert.ok(source.includes("catalog-status-filter"), "Must include status filter");
  assert.ok(source.includes("catalog-service-filter"), "Must include parent service filter");
  assert.ok(source.includes("catalog-fulfillment-filter"), "Must include fulfillment team filter");
  assert.ok(source.includes("catalog-approval-filter"), "Must include approval filter");

  // Catalog Table & Columns
  assert.ok(source.includes("catalog-items-table"), "Must render catalog items table");
  assert.ok(source.includes("Offering"), "Must display Offering column");
  assert.ok(source.includes("Parent Service"), "Must display Parent Service column");
  assert.ok(source.includes("Fulfillment Group"), "Must display Fulfillment Group column");
  assert.ok(source.includes("Approval"), "Must display Approval column");
  assert.ok(source.includes("Est. Delivery"), "Must display Est. Delivery column");
  assert.ok(source.includes("Status"), "Must display Status column");
  assert.ok(source.includes("Actions"), "Must display Actions column");

  // Navigation to Form Builder
  assert.ok(source.includes("/itsm/catalog-manager/form-builder?item="), "Must connect to Form Builder with item id parameter");

  // Empty state handling
  assert.ok(source.includes("No catalog offerings yet"), "Must handle empty database state gracefully");
  assert.ok(source.includes("No catalog items match your search"), "Must handle empty search results gracefully");
});

test("2. Create Catalog Item page exists with standard form fields and API binding", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/studio/new/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Create Catalog Item page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Form Fields
  assert.ok(source.includes("catalog-item-name-input"), "Must have Name input");
  assert.ok(source.includes("catalog-item-slug-input"), "Must have Slug input");
  assert.ok(source.includes("catalog-item-description-input"), "Must have Description input");
  assert.ok(source.includes("catalog-item-service-select"), "Must have Parent Service selector");
  assert.ok(source.includes("catalog-item-fulfillment-input"), "Must have Fulfillment Group input");
  assert.ok(source.includes("catalog-item-delivery-input"), "Must have Estimated Delivery Hours input");
  assert.ok(source.includes("catalog-item-approval-checkbox"), "Must have Approval Required checkbox");
  assert.ok(source.includes("catalog-item-active-checkbox"), "Must have Is Active checkbox");

  // Standard API call
  assert.ok(source.includes("POST"), "Must submit via POST");
  assert.ok(source.includes("/api/itsm/admin/service-catalog"), "Must post to existing admin service-catalog endpoint");
  assert.ok(source.includes("Create Catalog Item"), "Must have Create Catalog Item title");
});

test("3. Catalog Item Detail / Edit page exists and renders basic info, governance, and question summary", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Catalog Item detail page must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  // Detail sections
  assert.ok(source.includes("Basic Information"), "Must have basic offering information section");
  assert.ok(source.includes("Fulfillment & Governance"), "Must have fulfillment & governance section");
  assert.ok(source.includes("Request Form Summary"), "Must have request intake form section");
  assert.ok(source.includes("Record Metadata"), "Must have record metadata section");
  assert.ok(source.includes("Created Timestamp"), "Must show creation timestamp");
  assert.ok(source.includes("Last Updated"), "Must show last updated timestamp");

  // Question summary & form builder link
  assert.ok(source.includes("Form Questions Configured"), "Must show configured questions count");
  assert.ok(source.includes("/itsm/catalog-manager/form-builder?item="), "Must connect to Form Builder via item ID");

  // Edit capability
  assert.ok(source.includes("isEditing"), "Must support edit mode");
  assert.ok(source.includes("PATCH"), "Must submit updates via PATCH");
  assert.ok(source.includes("/api/itsm/admin/service-catalog/"), "Must update existing item endpoint");

  // Suspense wrapper for useSearchParams
  assert.ok(source.includes("<Suspense"), "Must wrap component in Suspense boundary for Next.js app router");
});

test("4. Form Builder placeholder receives item parameter and renders offering context", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/form-builder/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Form builder placeholder must exist");
  const source = fs.readFileSync(pagePath, "utf-8");

  assert.ok(source.includes('searchParams.get("item")'), "Must read item query parameter");
  assert.ok(source.includes("Configuring Request Form For"), "Must display target offering context banner");
  assert.ok(source.includes("/itsm/catalog-manager/studio"), "Must link back to Catalog Studio");
  assert.ok(source.includes("No-Code Form Question Builder"), "Must clearly describe upcoming Prompt 3 capability");
  assert.ok(source.includes("<Suspense"), "Must wrap in Suspense boundary");
});

test("5. Console Shell navigation points Catalog Items to /itsm/catalog-manager/studio for CATALOG_MANAGER", () => {
  const shellPath = path.join(consoleDir, "src/components/console-shell.tsx");
  assert.ok(fs.existsSync(shellPath), "console-shell.tsx must exist");
  const source = fs.readFileSync(shellPath, "utf-8");

  assert.ok(
    source.includes('{ name: "Catalog Items", href: "/itsm/catalog-manager/studio", icon: Layers, roles: readRoles }'),
    "Catalog Items nav link must point to /itsm/catalog-manager/studio"
  );
  assert.ok(
    source.includes('pathname.startsWith("/itsm/catalog-manager/studio")'),
    "Active page detection must recognize Catalog Studio"
  );
});

test("6. Console Layout restricts /itsm/catalog-manager routes to CATALOG_MANAGER and PLATFORM_ADMINISTRATOR", () => {
  const layoutPath = path.join(consoleDir, "src/app/(console)/layout.tsx");
  assert.ok(fs.existsSync(layoutPath), "layout.tsx must exist");
  const source = fs.readFileSync(layoutPath, "utf-8");

  assert.ok(source.includes('currentPath.startsWith("/itsm/catalog-manager")'), "Must check /itsm/catalog-manager path");
  assert.ok(source.includes('itsmRole !== "CATALOG_MANAGER"'), "Must check CATALOG_MANAGER role");
  assert.ok(source.includes('itsmRole !== "PLATFORM_ADMINISTRATOR"'), "Must permit PLATFORM_ADMINISTRATOR");
  assert.ok(source.includes('redirect("/itsm/dashboard")'), "Must redirect unauthorized users");
});

test("7. ServicesPage smoothly transitions Catalog Managers to Catalog Studio", () => {
  const servicesPagePath = path.join(consoleDir, "src/app/(console)/itsm/services/page.tsx");
  assert.ok(fs.existsSync(servicesPagePath), "services/page.tsx must exist");
  const source = fs.readFileSync(servicesPagePath, "utf-8");

  assert.ok(
    source.includes('if (userRole === "CATALOG_MANAGER")'),
    "Must detect CATALOG_MANAGER role on /itsm/services"
  );
  assert.ok(
    source.includes('window.location.replace("/itsm/catalog-manager/studio")'),
    "Must forward CATALOG_MANAGER to Catalog Studio"
  );
});

test("8. Dashboard and Studio Create actions navigate to canonical /itsm/catalog-manager/studio/new", () => {
  const dashboardPath = path.join(consoleDir, "src/app/(console)/itsm/dashboard/catalog-manager/page.tsx");
  assert.ok(fs.existsSync(dashboardPath), "Dashboard catalog manager page must exist");
  const dashboardSource = fs.readFileSync(dashboardPath, "utf-8");

  const studioPath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/studio/page.tsx");
  assert.ok(fs.existsSync(studioPath), "Studio page must exist");
  const studioSource = fs.readFileSync(studioPath, "utf-8");

  assert.ok(
    dashboardSource.includes('href="/itsm/catalog-manager/studio/new"'),
    "Dashboard Create Item CTA must point to /itsm/catalog-manager/studio/new"
  );
  assert.ok(
    studioSource.includes('href="/itsm/catalog-manager/studio/new"'),
    "Studio Create Catalog Item button must point to /itsm/catalog-manager/studio/new"
  );
});

test("9. Catalog Studio Edit action navigates to canonical /itsm/catalog-manager/studio/[id]?mode=edit", () => {
  const studioPath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/studio/page.tsx");
  const studioSource = fs.readFileSync(studioPath, "utf-8");

  assert.ok(
    studioSource.includes('href={`/itsm/catalog-manager/studio/${item.id}?mode=edit`}'),
    "Studio item row Edit button must link to canonical edit mode URL"
  );
});

test("10. api-client handleApiError only deletes session cookie for actual 401 unauthenticated errors", () => {
  const apiClientPath = path.join(consoleDir, "src/lib/api-client.ts");
  const source = fs.readFileSync(apiClientPath, "utf-8");

  assert.ok(
    source.includes('if (status === 401 && isAuthSessionError)'),
    "Must only clear session cookie when status is 401 AND session error is true"
  );
  assert.ok(
    !source.includes('if (isUnauthorized) {\n    response.cookies.delete("authclaw_session");'),
    "Must not unconditionally clear cookies on generic Unauthorized text in 403 errors"
  );
});

test("11. Catalog Studio create and edit pages handle 403 Forbidden without redirecting to /itsm/login", () => {
  const newPagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/studio/new/page.tsx");
  const newSource = fs.readFileSync(newPagePath, "utf-8");
  assert.ok(newSource.includes('if (res.status === 403)'), "New page must handle 403 without login redirect");

  const idPagePath = path.join(consoleDir, "src/app/(console)/itsm/catalog-manager/studio/[id]/page.tsx");
  const idSource = fs.readFileSync(idPagePath, "utf-8");
  assert.ok(idSource.includes('if (res.status === 403)'), "ID detail/edit page must handle 403 without login redirect");
});

