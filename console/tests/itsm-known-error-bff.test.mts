import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const consoleDir = path.resolve(__dirname, "..");

test("1. BFF routes safely resolve GET /api/itsm/problems/known-errors", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  const route = resolveBffRoute("GET", "itsm/problems/known-errors");
  assert.ok(route, "BFF must resolve GET itsm/problems/known-errors");
  assert.equal(route.backendPath, "/v1/itsm/problems/known-errors");
  assert.equal(route.body, "none");
});

test("2. BFF routes safely resolve POST /api/itsm/incidents/[incident_id]/link-problem", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  const incidentId = "11111111-1111-1111-1111-111111111111";
  const route = resolveBffRoute("POST", `itsm/incidents/${incidentId}/link-problem`);
  assert.ok(route, "BFF must resolve POST itsm/incidents/.../link-problem");
  assert.equal(route.backendPath, `/v1/itsm/incidents/${incidentId}/link-problem`);
  assert.equal(route.body, "json");
});

test("3. BFF routes safely resolve POST /api/itsm/incidents/[incident_id]/unlink-problem with optional-json", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  const incidentId = "11111111-1111-1111-1111-111111111111";
  const route = resolveBffRoute("POST", `itsm/incidents/${incidentId}/unlink-problem`);
  assert.ok(route, "BFF must resolve POST itsm/incidents/.../unlink-problem");
  assert.equal(route.backendPath, `/v1/itsm/incidents/${incidentId}/unlink-problem`);
  assert.equal(route.body, "optional-json");
});

test("4. BFF routes disallow unauthorized methods on known-errors and linking endpoints", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  // DELETE and PUT must be null
  assert.equal(resolveBffRoute("DELETE", "itsm/problems/known-errors"), null);
  assert.equal(resolveBffRoute("PUT", "itsm/problems/known-errors"), null);
  assert.equal(resolveBffRoute("DELETE", "itsm/incidents/00000000-0000-0000-0000-000000000001/link-problem"), null);
  assert.equal(resolveBffRoute("GET", "itsm/incidents/00000000-0000-0000-0000-000000000001/link-problem"), null);
});

test("5. BFF routes safely resolve POST /api/itsm/problems/[problem_id]/publish-workaround", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  const problemId = "22222222-2222-2222-2222-222222222222";
  const route = resolveBffRoute("POST", `itsm/problems/${problemId}/publish-workaround`);
  assert.ok(route, "BFF must resolve POST itsm/problems/.../publish-workaround");
  assert.equal(route.backendPath, `/v1/itsm/problems/${problemId}/publish-workaround`);
  assert.equal(route.body, "optional-json");
});

test("6. BFF routes safely resolve POST /api/itsm/problems/[problem_id]/retire-workaround", async () => {
  const { resolveBffRoute } = await import("../src/lib/bff-routes.js").catch(async () => {
    return await import("../src/lib/bff-routes.ts");
  });

  const problemId = "22222222-2222-2222-2222-222222222222";
  const route = resolveBffRoute("POST", `itsm/problems/${problemId}/retire-workaround`);
  assert.ok(route, "BFF must resolve POST itsm/problems/.../retire-workaround");
  assert.equal(route.backendPath, `/v1/itsm/problems/${problemId}/retire-workaround`);
  assert.equal(route.body, "optional-json");
});

