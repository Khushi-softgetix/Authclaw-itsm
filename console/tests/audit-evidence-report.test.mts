import assert from "node:assert/strict";
import test from "node:test";

import { buildReadableAuditEvidenceReport } from "../src/lib/audit-evidence-report.ts";

const artifact = {
  format: "authclaw.audit.export.v2",
  manifest: {
    format_version: "authclaw.audit.export.v2",
    export_id: "export-123",
    generated_at: "2026-09-23T13:01:47.422Z",
    tenant_id: "tenant-123",
    requested_by: "auditor-123",
    sequence_range: { start: 1, end: 2 },
    record_count: 2,
    selection: {
      filters: { action: "", framework: "", start: "", end: "" },
      selected_record_ids: ["event-1", "event-2"],
      proof_records_retained: 0,
    },
    proof: {
      algorithm: "SHA-256",
      records_sha256: "records-hash",
      chain_valid_at_export: true,
      chain_errors: [],
    },
    signing: { trusted_key_id: "key-123", algorithm: "Ed25519" },
  },
  records: [
    {
      record_id: "event-1",
      tenant_sequence: 1,
      timestamp: "2026-09-23T12:00:00Z",
      actor_id: "auditor@example.test",
      actor_type: "user",
      action: "itsm.audit.searched",
      reason: "Auditor searched tenant evidence",
      request_id: "workflow-123",
      response_status: 200,
      integrity_hash: "hash-1",
    },
    {
      record_id: "event-2",
      tenant_sequence: 2,
      timestamp: "2026-09-23T12:01:00Z",
      actor_id: "agent-123",
      actor_type: "agent",
      action: "agent.tool.invoked",
      reason: "Evidence tool invoked",
      request_id: "workflow-123",
      response_status: 200,
      integrity_hash: "hash-2",
    },
  ],
  digest: { algorithm: "SHA-256", value: "artifact-digest" },
  signature: { algorithm: "Ed25519", key_id: "key-123", value: "signature-value" },
};

test("readable evidence export presents signed audit data for people", () => {
  const report = buildReadableAuditEvidenceReport(artifact);

  for (const text of [
    "AuthClaw ITSM",
    "Audit Evidence Report",
    "Signed evidence package",
    "Integrity verified",
    "Itsm Audit Searched",
    "Agent Tool Invoked",
    "Event reference",
    "Workflow reference",
    "Print / Save as PDF",
    "Download signed JSON",
  ]) {
    assert.match(report, new RegExp(text.replaceAll("/", "\\/")));
  }

  assert.match(report, /2 records/);
  assert.match(report, /auditor@example\.test/);
  assert.match(report, /workflow-123/);
});

test("readable report embeds the exact signed artifact for verification", () => {
  const report = buildReadableAuditEvidenceReport(artifact);
  const encoded = report.match(/data-signed-evidence="([A-Za-z0-9+/=]+)"/)?.[1];

  assert.ok(encoded);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  assert.deepEqual(JSON.parse(decoded), artifact);
  assert.match(report, /The signed JSON remains unchanged/);
});
