import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const consoleDir = path.resolve(__dirname, "..");

test("BFF routes whitelist CMDB-002 CI relationship endpoints with correct HTTP methods, bodies, and statuses", () => {
  // 1. List relationships for a CI (GET)
  const getRel = resolveBffRoute(
    "GET",
    "itsm/admin/configuration-items/11111111-2222-3333-4444-555555555555/relationships"
  );
  assert.deepEqual(getRel, {
    backendPath: "/v1/itsm/admin/configuration-items/11111111-2222-3333-4444-555555555555/relationships",
    body: "none",
    status: undefined,
  });

  // 2. Canonical List relationships endpoint (GET)
  const getCanonical = resolveBffRoute("GET", "itsm/admin/ci-relationships");
  assert.deepEqual(getCanonical, {
    backendPath: "/v1/itsm/admin/ci-relationships",
    body: "none",
    status: undefined,
  });

  // 3. Create relationship endpoint (POST) - returns 201
  const postRel = resolveBffRoute(
    "POST",
    "itsm/admin/configuration-items/relationships"
  );
  assert.deepEqual(postRel, {
    backendPath: "/v1/itsm/admin/configuration-items/relationships",
    body: "json",
    status: 201,
  });

  // 4. Nested Create relationship endpoint (POST) - returns 201
  const postNestedRel = resolveBffRoute(
    "POST",
    "itsm/admin/configuration-items/11111111-2222-3333-4444-555555555555/relationships"
  );
  assert.deepEqual(postNestedRel, {
    backendPath: "/v1/itsm/admin/configuration-items/11111111-2222-3333-4444-555555555555/relationships",
    body: "json",
    status: 201,
  });

  // 5. Canonical Create relationship endpoint (POST) - returns 201
  const postCanonical = resolveBffRoute("POST", "itsm/admin/ci-relationships");
  assert.deepEqual(postCanonical, {
    backendPath: "/v1/itsm/admin/ci-relationships",
    body: "json",
    status: 201,
  });

  // 6. Delete relationship by ID (DELETE) - returns 204
  const deleteRel = resolveBffRoute(
    "DELETE",
    "itsm/admin/configuration-items/relationships/99999999-8888-7777-6666-555555555555"
  );
  assert.deepEqual(deleteRel, {
    backendPath: "/v1/itsm/admin/configuration-items/relationships/99999999-8888-7777-6666-555555555555",
    body: "none",
    status: 204,
  });

  // 7. Canonical Delete relationship by ID (DELETE) - returns 204
  const deleteCanonical = resolveBffRoute(
    "DELETE",
    "itsm/admin/ci-relationships/99999999-8888-7777-6666-555555555555"
  );
  assert.deepEqual(deleteCanonical, {
    backendPath: "/v1/itsm/admin/ci-relationships/99999999-8888-7777-6666-555555555555",
    body: "none",
    status: 204,
  });

  // 8. Arbitrary unapproved paths remain blocked
  assert.equal(resolveBffRoute("GET", "itsm/admin/configuration-items/relationships/unknown/fake"), null);
  assert.equal(resolveBffRoute("POST", "itsm/admin/ci-relationships/unknown/fake"), null);
  assert.equal(resolveBffRoute("DELETE", "itsm/admin/configuration-items/unapproved-delete"), null);
});

test("Configuration Items workspace integrates relationship management action and modal", () => {
  const pagePath = path.join(consoleDir, "src/app/(console)/itsm/admin-portal/configuration-items/page.tsx");
  assert.ok(fs.existsSync(pagePath), "Configuration Items page file must exist");

  const source = fs.readFileSync(pagePath, "utf-8");
  assert.ok(source.includes("CIRelationshipsModal"), "Page must import and render CIRelationshipsModal");
  assert.ok(source.includes("setRelationshipsCi"), "Page must manage relationshipsCi selection state");
  assert.ok(source.includes("Relationships"), "Page must provide a 'Relationships' action button for CI rows");
});

test("CIRelationshipsModal component implements CMDB-002 requirements, types, directions, and states", () => {
  const modalPath = path.join(consoleDir, "src/components/itsm/ci-relationships-modal.tsx");
  assert.ok(fs.existsSync(modalPath), "CIRelationshipsModal component file must exist");

  const source = fs.readFileSync(modalPath, "utf-8");

  // Supported relationship types
  const expectedTypes = [
    "DEPENDS_ON",
    "RUNS_ON",
    "HOSTED_ON",
    "CONNECTS_TO",
    "OWNED_BY",
    "SUPPORTS",
    "PART_OF",
  ];
  for (const t of expectedTypes) {
    assert.ok(source.includes(t), `CIRelationshipsModal must support relationship type ${t}`);
  }

  // Direction query filters
  assert.ok(source.includes("upstream"), "Must support upstream direction querying");
  assert.ok(source.includes("downstream"), "Must support downstream direction querying");
  assert.ok(source.includes("directionTab"), "Must manage direction tabs (all / upstream / downstream)");

  // Direction semantics for creation
  assert.ok(source.includes("current_is_parent"), "Must support Current CI as parent");
  assert.ok(source.includes("target_is_parent"), "Must support Target CI as parent");

  // API calls
  assert.ok(
    source.includes("/api/itsm/admin/configuration-items/") && source.includes("/relationships"),
    "Must invoke relationships API endpoint"
  );

  // States
  assert.ok(source.includes("loading"), "Must handle loading state");
  assert.ok(source.includes("error"), "Must handle error state");
  assert.ok(source.includes("successMessage"), "Must display success state feedback");
  assert.ok(source.includes("handleDeleteRelationship"), "Must implement relationship deletion");
});
