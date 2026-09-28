import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolveBffRoute } from "../src/lib/bff-routes.ts";

test("BFF routes properly permit ITSM attachments endpoints", () => {
  // Download route
  const downloadRoute = resolveBffRoute("GET", "itsm/attachments/11111111-1111-1111-1111-111111111111/download");
  assert.ok(downloadRoute, "Download route must be allowed in BFF");
  assert.equal(downloadRoute.backendPath, "/v1/itsm/attachments/11111111-1111-1111-1111-111111111111/download");

  // Incident attachments GET & POST
  const incGet = resolveBffRoute("GET", "itsm/incidents/11111111-1111-1111-1111-111111111111/attachments");
  assert.ok(incGet, "Incident attachments GET must be allowed");
  assert.equal(incGet.backendPath, "/v1/itsm/incidents/11111111-1111-1111-1111-111111111111/attachments");

  const incPost = resolveBffRoute("POST", "itsm/incidents/11111111-1111-1111-1111-111111111111/attachments");
  assert.ok(incPost, "Incident attachments POST must be allowed");
  assert.equal(incPost.status, 201);

  // Request attachments GET & POST
  const reqGet = resolveBffRoute("GET", "itsm/requests/11111111-1111-1111-1111-111111111111/attachments");
  assert.ok(reqGet, "Request attachments GET must be allowed");
  assert.equal(reqGet.backendPath, "/v1/itsm/requests/11111111-1111-1111-1111-111111111111/attachments");

  const reqPost = resolveBffRoute("POST", "itsm/requests/11111111-1111-1111-1111-111111111111/attachments");
  assert.ok(reqPost, "Request attachments POST must be allowed");
  assert.equal(reqPost.status, 201);
});

test("Dedicated Next.js BFF routes exist and stream properly", () => {
  const incRoutePath = new URL("../src/app/api/itsm/incidents/[id]/attachments/route.ts", import.meta.url);
  assert.ok(existsSync(incRoutePath), "Incident attachments dedicated BFF route must exist");
  const incRouteSource = readFileSync(incRoutePath, "utf8");
  assert.ok(incRouteSource.includes("formData"), "Must support multipart formData");
  assert.ok(incRouteSource.includes("/v1/itsm/incidents/${id}/attachments"), "Must target backend incident attachments endpoint");

  const reqRoutePath = new URL("../src/app/api/itsm/requests/[id]/attachments/route.ts", import.meta.url);
  assert.ok(existsSync(reqRoutePath), "Request attachments dedicated BFF route must exist");
  const reqRouteSource = readFileSync(reqRoutePath, "utf8");
  assert.ok(reqRouteSource.includes("formData"), "Must support multipart formData");
  assert.ok(reqRouteSource.includes("/v1/itsm/requests/${id}/attachments"), "Must target backend request attachments endpoint");

  const downloadRoutePath = new URL("../src/app/api/itsm/attachments/[id]/download/route.ts", import.meta.url);
  assert.ok(existsSync(downloadRoutePath), "Download attachment dedicated BFF route must exist");
  const dlSource = readFileSync(downloadRoutePath, "utf8");
  assert.ok(dlSource.includes("preview"), "Must support forwarding preview query param");
});

test("AttachmentSection UI component implements required features", () => {
  const compPath = new URL("../src/components/itsm/attachment-section.tsx", import.meta.url);
  assert.ok(existsSync(compPath), "AttachmentSection component must exist");
  const source = readFileSync(compPath, "utf8");

  assert.ok(source.includes("previewUrl"), "Must provide preview URL");
  assert.ok(source.includes("downloadUrl"), "Must provide download URL");
  assert.ok(source.includes("previewItem"), "Must support image preview lightbox");
  assert.ok(source.includes("uploaded_by_email"), "Must display uploader email");
  assert.ok(source.includes("formatFileSize"), "Must format file size");
  assert.ok(source.includes("Add Attachment"), "Must support adding attachments");
  assert.ok(source.includes("ALLOWED_EXTS"), "Must validate allowed extensions");
});

test("CreateIncidentPage implements drag & drop and attachment previews", () => {
  const pagePath = new URL("../src/app/(console)/itsm/incidents/new/page.tsx", import.meta.url);
  const source = readFileSync(pagePath, "utf8");

  assert.ok(source.includes("handleDragOver"), "Must support drag over");
  assert.ok(source.includes("handleDrop"), "Must support drop");
  assert.ok(source.includes("ALLOWED_EXTS"), "Must validate file extensions");
  assert.ok(source.includes("MAX_FILE_SIZE"), "Must validate max file size");
  assert.ok(source.includes("uploadProgress"), "Must show upload progress");
  assert.ok(source.includes("attachmentPreviews"), "Must generate attachment previews");
  assert.ok(source.includes("/attachments"), "Must upload attachments to ticket");
});

test("IncidentDetailPage integrates AttachmentSection for Agent and Requester", () => {
  const pagePath = new URL("../src/app/(console)/itsm/incidents/[id]/page.tsx", import.meta.url);
  const source = readFileSync(pagePath, "utf8");

  assert.ok(source.includes("AttachmentSection"), "Must import and use AttachmentSection");
  assert.ok(source.includes("fetchIncidentData()"), "Must refresh incident data after upload");
});
