type JsonRecord = Record<string, unknown>;

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = "Not recorded"): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function escapeHtml(value: unknown): string {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayAction(value: unknown): string {
  const raw = text(value, "Audit event");
  return raw
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: unknown): string {
  const raw = text(value, "");
  if (!raw) return "Not recorded";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(parsed);
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function reportResult(record: JsonRecord): { label: string; className: string } {
  const status = Number(record.response_status ?? 0);
  if (status >= 200 && status < 400) return { label: "Successful", className: "success" };
  if (status === 403) return { label: "Denied", className: "warning" };
  if (status >= 400) return { label: "Failed", className: "danger" };
  return { label: "Not recorded", className: "neutral" };
}

function scopeLabel(filters: JsonRecord): string {
  const labels: string[] = [];
  const action = text(filters.action, "");
  const framework = text(filters.framework, "");
  const start = text(filters.start, "");
  const end = text(filters.end, "");
  if (action) labels.push(`Action: ${displayAction(action)}`);
  if (framework) labels.push(`Framework: ${framework}`);
  if (start || end) labels.push(`${start ? formatDate(start) : "Beginning"} to ${end ? formatDate(end) : "Present"}`);
  return labels.length ? labels.join(" · ") : "All tenant evidence";
}

function evidenceRows(records: unknown[]): string {
  if (!records.length) {
    return '<tr><td class="empty" colspan="7">No audit events were included in this export.</td></tr>';
  }

  return records.map((item, index) => {
    const record = asObject(item);
    const result = reportResult(record);
    const actorType = displayAction(record.actor_type || "system");
    return `
      <tr>
        <td class="sequence">${escapeHtml(record.tenant_sequence || index + 1)}</td>
        <td>
          <strong>${escapeHtml(displayAction(record.action))}</strong>
          <span>${escapeHtml(record.reason)}</span>
        </td>
        <td>
          <strong>${escapeHtml(actorType)}</strong>
          <span class="technical">${escapeHtml(record.actor_id)}</span>
        </td>
        <td><span class="technical">${escapeHtml(record.request_id)}</span></td>
        <td>${escapeHtml(formatDate(record.timestamp))}</td>
        <td><span class="status ${result.className}">${escapeHtml(result.label)}</span></td>
        <td><span class="technical">${escapeHtml(record.record_id)}</span></td>
      </tr>`;
  }).join("");
}

export function buildReadableAuditEvidenceReport(artifact: unknown): string {
  const root = asObject(artifact);
  const manifest = asObject(root.manifest);
  const proof = asObject(manifest.proof);
  const signing = asObject(manifest.signing);
  const signature = asObject(root.signature);
  const digest = asObject(root.digest);
  const selection = asObject(manifest.selection);
  const filters = asObject(selection.filters);
  const sequence = asObject(manifest.sequence_range);
  const records = asArray(root.records);
  const recordCount = Number(manifest.record_count ?? records.length);
  const chainVerified = proof.chain_valid_at_export === true;
  const integrityLabel = chainVerified ? "Integrity verified" : "Integrity needs review";
  const integrityClass = chainVerified ? "verified" : "review";
  const exportId = text(manifest.export_id, "audit-evidence");
  const safeExportId = exportId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const signedJson = JSON.stringify(artifact, null, 2) || "{}";
  const signedJsonBase64 = encodeBase64Utf8(signedJson);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AuthClaw ITSM — Audit Evidence Report</title>
  <style>
    :root { color-scheme: light; --ink: #0e1726; --muted: #657087; --line: #e6e9f0; --purple: #6d28d9; --purple-soft: #f4f0ff; --paper: #ffffff; --canvas: #f7f7fa; --green: #047857; --green-soft: #ecfdf5; --red: #b42318; --red-soft: #fff1f0; --amber: #a15c00; --amber-soft: #fff8e6; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--canvas); color: var(--ink); font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .page { width: min(1440px, calc(100% - 40px)); margin: 32px auto 56px; }
    .toolbar { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 14px; }
    button { border: 1px solid #ddd6fe; border-radius: 9px; background: white; color: #5b21b6; cursor: pointer; padding: 10px 14px; font: inherit; font-weight: 700; }
    button.primary { border-color: var(--purple); background: var(--purple); color: white; }
    .report { overflow: hidden; border: 1px solid #ddd6fe; border-radius: 18px; background: var(--paper); box-shadow: 0 18px 50px rgba(49, 35, 89, .08); }
    .hero { padding: 34px 38px 30px; background: linear-gradient(135deg, #faf8ff 0%, #ffffff 70%); border-bottom: 1px solid var(--line); }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--purple); font-size: 13px; font-weight: 800; }
    .mark { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: var(--purple); color: white; }
    .eyebrow { margin-top: 28px; color: var(--purple); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 7px 0 8px; font-size: clamp(30px, 4vw, 44px); line-height: 1.1; letter-spacing: -.03em; }
    .subtitle { max-width: 760px; margin: 0; color: var(--muted); font-size: 15px; }
    .badge { display: inline-flex; align-items: center; gap: 7px; margin-top: 20px; border-radius: 999px; padding: 7px 11px; background: var(--green-soft); color: var(--green); font-size: 12px; font-weight: 800; }
    .badge.review { background: var(--amber-soft); color: var(--amber); }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--line); }
    .metric { min-width: 0; padding: 22px 24px; border-right: 1px solid var(--line); }
    .metric:last-child { border-right: 0; }
    .label { color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .value { margin-top: 7px; font-size: 17px; font-weight: 800; overflow-wrap: anywhere; }
    .value.small { font-size: 13px; }
    .content { padding: 28px 30px 36px; }
    .notice { display: flex; gap: 12px; margin-bottom: 24px; border: 1px solid #ddd6fe; border-radius: 12px; background: var(--purple-soft); padding: 14px 16px; color: #4c1d95; }
    .notice strong { display: block; margin-bottom: 2px; }
    .section-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin: 28px 0 12px; }
    h2 { margin: 0; font-size: 19px; }
    .section-head p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
    .count { white-space: nowrap; color: var(--muted); font-size: 12px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 13px; }
    table { width: 100%; min-width: 1160px; border-collapse: collapse; }
    th { background: #fbfaff; color: var(--muted); padding: 12px 14px; text-align: left; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
    td { border-top: 1px solid var(--line); padding: 14px; vertical-align: top; }
    td strong { display: block; font-size: 12px; }
    td span:not(.status) { display: block; margin-top: 4px; color: var(--muted); font-size: 11px; }
    .sequence { color: var(--muted); font-variant-numeric: tabular-nums; }
    .technical { max-width: 230px; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .status { display: inline-flex; border-radius: 999px; padding: 4px 8px; font-size: 10px; font-weight: 800; }
    .status.success { background: var(--green-soft); color: var(--green); }
    .status.danger { background: var(--red-soft); color: var(--red); }
    .status.warning { background: var(--amber-soft); color: var(--amber); }
    .status.neutral { background: #f1f3f6; color: var(--muted); }
    .empty { padding: 38px; text-align: center; color: var(--muted); }
    details { margin-top: 22px; border: 1px solid var(--line); border-radius: 12px; }
    summary { cursor: pointer; padding: 15px 17px; font-weight: 800; }
    .technical-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; border-top: 1px solid var(--line); padding: 18px; }
    .technical-card { min-width: 0; border-radius: 9px; background: #fafbfc; padding: 13px; }
    .technical-card .value { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
    .footer { padding: 18px 30px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; text-align: center; }
    #signed-evidence { display: none; }
    @media (max-width: 900px) { .summary { grid-template-columns: repeat(2, 1fr); } .metric:nth-child(2) { border-right: 0; } .metric:nth-child(-n+2) { border-bottom: 1px solid var(--line); } .technical-grid { grid-template-columns: 1fr; } }
    @media (max-width: 600px) { .page { width: min(100% - 20px, 1440px); margin-top: 12px; } .toolbar { flex-direction: column; } .hero { padding: 26px 22px; } .summary { grid-template-columns: 1fr; } .metric { border-right: 0; border-bottom: 1px solid var(--line); } .metric:last-child { border-bottom: 0; } .content { padding: 22px 18px 28px; } }
    @media print { body { background: white; } .page { width: 100%; margin: 0; } .toolbar { display: none; } .report { border: 0; box-shadow: none; } .table-wrap { overflow: visible; } table { min-width: 0; font-size: 9px; } th, td { padding: 7px; } details { break-inside: avoid; } }
  </style>
</head>
<body>
  <main class="page">
    <div class="toolbar" aria-label="Report actions">
      <button type="button" onclick="window.print()">Print / Save as PDF</button>
      <button class="primary" id="download-json" type="button">Download signed JSON</button>
    </div>
    <article class="report">
      <header class="hero">
        <div class="brand"><span class="mark">AC</span>AuthClaw ITSM</div>
        <div class="eyebrow">Independent audit evidence</div>
        <h1>Audit Evidence Report</h1>
        <p class="subtitle">A readable view of the tenant audit trail, its integrity proof, and the workflow references needed to reconstruct recorded activity.</p>
        <span class="badge ${integrityClass}">✓ ${escapeHtml(integrityLabel)} · Signed evidence package</span>
      </header>

      <section class="summary" aria-label="Export summary">
        <div class="metric"><div class="label">Records included</div><div class="value">${escapeHtml(recordCount)} records</div></div>
        <div class="metric"><div class="label">Generated</div><div class="value small">${escapeHtml(formatDate(manifest.generated_at))}</div></div>
        <div class="metric"><div class="label">Sequence range</div><div class="value">${escapeHtml(sequence.start || 0)}–${escapeHtml(sequence.end || 0)}</div></div>
        <div class="metric"><div class="label">Export reference</div><div class="value small technical">${escapeHtml(exportId)}</div></div>
      </section>

      <div class="content">
        <div class="notice">
          <strong>Readable report with signed source included</strong>
          <div>The signed JSON remains unchanged and is embedded in this report. Use “Download signed JSON” when cryptographic verification or machine processing is required.</div>
        </div>

        <div class="section-head">
          <div><h2>Evidence scope</h2><p>${escapeHtml(scopeLabel(filters))}</p></div>
          <span class="count">Requested by ${escapeHtml(manifest.requested_by)}</span>
        </div>

        <div class="section-head">
          <div><h2>Audit events</h2><p>Events are ordered by tenant sequence so the activity can be followed from beginning to end.</p></div>
          <span class="count">${escapeHtml(recordCount)} included</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Event</th><th>Performed by</th><th>Workflow reference</th><th>Time</th><th>Result</th><th>Event reference</th></tr></thead>
            <tbody>${evidenceRows(records)}</tbody>
          </table>
        </div>

        <details>
          <summary>Technical verification details</summary>
          <div class="technical-grid">
            <div class="technical-card"><div class="label">Integrity proof</div><div class="value">${escapeHtml(proof.algorithm)} · ${escapeHtml(proof.records_sha256)}</div></div>
            <div class="technical-card"><div class="label">Final chain root</div><div class="value">${escapeHtml(manifest.final_chain_root)}</div></div>
            <div class="technical-card"><div class="label">Digital signature</div><div class="value">${escapeHtml(signature.algorithm || signing.algorithm)} · ${escapeHtml(signature.key_id || signing.trusted_key_id)}</div></div>
            <div class="technical-card"><div class="label">Package digest</div><div class="value">${escapeHtml(digest.algorithm)} · ${escapeHtml(digest.value)}</div></div>
          </div>
        </details>
      </div>
      <footer class="footer">Generated by AuthClaw ITSM · This report is read-only evidence and does not modify operational records.</footer>
    </article>
  </main>
  <div id="signed-evidence" data-signed-evidence="${signedJsonBase64}"></div>
  <script>
    document.getElementById("download-json").addEventListener("click", function () {
      const encoded = document.getElementById("signed-evidence").dataset.signedEvidence;
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
      const json = new TextDecoder().decode(bytes);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "itsm-signed-evidence-${safeExportId}.json";
      link.click();
      URL.revokeObjectURL(url);
    });
  </script>
</body>
</html>`;
}
