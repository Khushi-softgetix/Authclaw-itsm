"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, BellRing, CheckCircle2, Eye, RefreshCw, Send, ShieldCheck, XCircle } from "lucide-react";
import { alertApi, type AlertDetail, formatAlertDate, formatPublicStatus } from "@/lib/outage-alerts";
import AlertLinkManager from "@/components/itsm/alert-link-manager";
import AlertRecipientEvidenceDialog from "@/components/itsm/alert-recipient-evidence-dialog";

type Preview = { alert_id: string; preview_token: string; total_recipients: number; groups: Array<{ audience_type: string; projection_type: string; recipient_count: number; included_because: string; projection_fields: string[]; allowed_actions: string[] }>; exclusions: Array<{ audience_type: string; reason: string; count: number }> };
type Operation = "INITIAL" | "UPDATE" | "RECOVERY";
type PublicStatus = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RECOVERED";
type RecipientView = { title: string; publicationId?: string; audienceType?: string; projectionType?: string };
const activePublicStatuses: PublicStatus[] = ["INVESTIGATING", "IDENTIFIED", "MONITORING"];

export default function OutageAlertDetailPage() {
  const { alertId } = useParams<{ alertId: string }>();
  const router = useRouter();
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [operation, setOperation] = useState<Operation>("INITIAL");
  const [publicStatus, setPublicStatus] = useState<PublicStatus>("INVESTIGATING");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recipientView, setRecipientView] = useState<RecipientView | null>(null);
  const [tenantWideConfirmed, setTenantWideConfirmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await alertApi<AlertDetail>(`/${alertId}`);
      setAlert(data);
      setMessage(String(data.content.public_summary || ""));
      setOperation(data.status === "DRAFT" ? "INITIAL" : "UPDATE");
      setPublicStatus((data.content.public_status as PublicStatus) || "INVESTIGATING");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Alert unavailable"); }
    finally { setLoading(false); }
  }, [alertId]);
  useEffect(() => { const request = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(request); }, [load]);

  const isTenantWideAudience = useMemo(() => {
    const audiences = alert?.content?.audiences;
    return Array.isArray(audiences) && audiences.some((audience) =>
      typeof audience === "object" && audience !== null && "type" in audience && audience.type === "ALL_PORTAL_USERS",
    );
  }, [alert]);

  const changes = useMemo(() => ({
    publication_type: operation,
    public_summary: message || undefined,
    public_status: operation === "RECOVERY" ? "RECOVERED" : publicStatus,
  }), [operation, message, publicStatus]);
  async function runPreview(nextOperation: Operation = operation) {
    setBusy(true); setError(""); setPreview(null); setTenantWideConfirmed(false); setOperation(nextOperation);
    try { setPreview(await alertApi<Preview>(`/${alertId}/preview`, { method: "POST", body: JSON.stringify({ ...changes, publication_type: nextOperation }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Preview unavailable"); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!preview) return;
    if (isTenantWideAudience && !tenantWideConfirmed) {
      setError("Confirm the organization-wide recipient preview before publishing.");
      return;
    }
    setBusy(true); setError("");
    const endpoint = operation === "INITIAL" ? "publish" : operation === "RECOVERY" ? "recovery" : "updates";
    try {
      await alertApi(`/${alertId}/${endpoint}`, { method: "POST", body: JSON.stringify({ preview_token: preview.preview_token, idempotency_key: crypto.randomUUID(), confirm_tenant_wide: isTenantWideAudience && tenantWideConfirmed, public_summary: message, public_status: operation === "RECOVERY" ? "RECOVERED" : publicStatus }) });
      setPreview(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Publication failed"); }
    finally { setBusy(false); }
  }
  async function cancelDraft() {
    if (!window.confirm("Cancel this unpublished draft? Its audit evidence remains available.")) return;
    setBusy(true);
    try { await alertApi(`/${alertId}`, { method: "DELETE" }); router.push("/itsm/incident-manager/outage-alerts"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Draft could not be cancelled"); setBusy(false); }
  }

  if (loading) return <div className="mx-auto max-w-6xl space-y-4"><div className="h-8 w-44 animate-pulse rounded bg-[#EEF1F5]" /><div className="h-72 animate-pulse rounded-2xl bg-white" /></div>;
  if (!alert) return <div className="mx-auto max-w-4xl"><Link href="/itsm/incident-manager/outage-alerts" className="inline-flex items-center gap-2 text-sm font-semibold text-[#5B21B6]"><ArrowLeft className="h-4 w-4" /> Back to alerts</Link><div className="mt-6 rounded-2xl border border-[#E6E9F0] bg-white p-8 text-center"><AlertTriangle className="mx-auto h-7 w-7 text-[#8A5A2B]" /><p className="mt-3 font-semibold">{error || "Alert not found"}</p></div></div>;
  const c = alert.content;
  const canPublish = alert.allowed_actions.includes("PUBLISH") || alert.allowed_actions.includes("PUBLISH_UPDATE");
  return <div className="mx-auto w-full max-w-6xl space-y-5">
    <div className="flex items-center justify-between gap-3"><Link href="/itsm/incident-manager/outage-alerts" className="inline-flex items-center gap-2 text-sm font-semibold text-[#5B21B6] hover:text-[#6D28D9]"><ArrowLeft className="h-4 w-4" /> Back to alert list</Link><div className="flex items-center gap-2">{alert.status === "DRAFT" && alert.allowed_actions.includes("EDIT_DRAFT") ? <Link href={`/itsm/incident-manager/outage-alerts/create?edit=${alert.id}`} className="rounded-xl border border-[#DDD6FE] bg-white px-3.5 py-2 text-sm font-semibold text-[#5B21B6] hover:bg-[#F8F5FF]">Edit draft</Link> : null}<button onClick={() => void load()} className="rounded-xl border border-[#E6E9F0] bg-white p-2.5 text-[#5B21B6]" aria-label="Refresh alert"><RefreshCw className="h-4 w-4" /></button></div></div>
    {error ? <div role="alert" className="flex gap-3 rounded-xl border border-[#E7D9CF] bg-[#FFF9F5] p-4 text-sm text-[#704C3B]"><AlertTriangle className="h-5 w-5 shrink-0" />{error}</div> : null}
    <header className="rounded-2xl border border-[#E6E9F0] bg-white p-6 shadow-[0_12px_30px_-24px_rgba(14,23,38,.35)]">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start"><div><div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide"><span className="rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-2.5 py-1 text-[#5B21B6]">{alert.status}</span><span className="text-[#6B7488]">{alert.alert_number}</span><span className="text-[#6B7488]">{String(c.alert_type || "Alert")}</span></div><h1 className="text-3xl font-bold tracking-tight">{String(c.title || alert.alert_number)}</h1><p className="mt-2 max-w-3xl text-[#475069]">{String(c.public_summary || "")}</p></div><div className="rounded-xl bg-[#F8F5FF] px-4 py-3 text-right"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#6D28D9]">Authorized view</p><p className="mt-1 text-sm font-semibold">{alert.projection_type.replaceAll("_", " ")}</p></div></div>
      <div className="mt-5 flex flex-wrap gap-2">{alert.affected_services.map((service) => <span key={service.id} className="rounded-full border border-[#E6E9F0] bg-[#FBFAF9] px-3 py-1.5 text-xs font-semibold">{service.name}</span>)}</div>
    </header>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-[#E6E9F0] bg-white p-6"><h2 className="text-lg font-semibold">Current communication</h2><dl className="mt-5 grid gap-5 sm:grid-cols-2"><Info label="Severity" value={c.severity} /><Info label="Intent" value={String(c.intent || "").replaceAll("_", " ")} /><Info label="Customer status" value={formatPublicStatus(c.public_status)} /><Info label="Outage started" value={c.outage_started_at ? formatAlertDate(String(c.outage_started_at)) : "Not announced"} /><Info label="Business impact" value={c.impact_summary} wide /><Info label="Recommended action" value={c.recommended_action || "No action requested"} wide /><Info label="Next update" value={c.next_update_at ? formatAlertDate(String(c.next_update_at)) : "Not scheduled"} /><Info label="Last public update" value={c.latest_publication_at ? formatAlertDate(String(c.latest_publication_at)) : "Not yet published"} />{alert.status === "RECOVERED" ? <Info label="Recovered at" value={c.recovered_at ? formatAlertDate(String(c.recovered_at)) : "Not recorded"} /> : null}</dl></section>

        {canPublish && alert.status !== "RECOVERED" ? <section className="rounded-2xl border border-[#DDD6FE] bg-[#F8F5FF] p-6"><h2 className="text-lg font-semibold">{alert.status === "DRAFT" ? "Preview and publish" : "Continue the public communication"}</h2><p className="mt-1 text-sm text-[#475069]">Preview and publication use the same backend resolver and field policy. Any scope change makes the preview expire.</p>
          {alert.status === "ACTIVE" ? <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => { setOperation("UPDATE"); setPreview(null); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${operation === "UPDATE" ? "bg-[#6D28D9] text-white" : "border border-[#DDD6FE] bg-white text-[#5B21B6]"}`}>Publish update</button><button onClick={() => { setOperation("RECOVERY"); setPreview(null); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${operation === "RECOVERY" ? "bg-[#6D28D9] text-white" : "border border-[#DDD6FE] bg-white text-[#5B21B6]"}`}>Publish recovery</button></div> : null}
          <label className="mt-4 block text-sm font-semibold">Customer status{operation === "RECOVERY" ? <span className="mt-1.5 block rounded-xl border border-[#CDE5D7] bg-[#EDF7F1] px-3.5 py-2.5 text-sm text-[#2F6B4F]">Recovered</span> : <select value={publicStatus} onChange={(event) => { setPublicStatus(event.target.value as PublicStatus); setPreview(null); }} className="mt-1.5 w-full rounded-xl border border-[#D6C9FD] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10">{activePublicStatuses.map((status) => <option key={status} value={status}>{formatPublicStatus(status)}</option>)}</select>}</label>
          <label className="mt-4 block text-sm font-semibold">{operation === "RECOVERY" ? "Recovery message" : operation === "UPDATE" ? "Public update" : "Public message"}<textarea value={message} onChange={(event) => { setMessage(event.target.value); setPreview(null); }} rows={4} className="mt-1.5 w-full rounded-xl border border-[#D6C9FD] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10" /></label>
          {preview && isTenantWideAudience ? <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-[#DDD6FE] bg-white p-4 text-sm text-[#4C1D95]"><input type="checkbox" checked={tenantWideConfirmed} onChange={(event) => { setTenantWideConfirmed(event.target.checked); setError(""); }} className="mt-0.5 h-4 w-4 accent-[#6D28D9]" /><span><strong className="block text-[#3B1678]">I confirm this organization-wide publication</strong>This will notify {preview.total_recipients.toLocaleString()} active employee-facing portal account{preview.total_recipients === 1 ? "" : "s"}. Auditor and Platform Administrator accounts are excluded from business-alert delivery.</span></label> : null}
          <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || !message.trim()} onClick={() => void runPreview()} className="inline-flex items-center gap-2 rounded-xl border border-[#8B5CF6] bg-white px-4 py-2.5 text-sm font-semibold text-[#5B21B6] disabled:opacity-50"><Eye className="h-4 w-4" /> {busy ? "Checking…" : "Preview recipients"}</button>{preview && preview.total_recipients > 0 ? <button disabled={busy || (isTenantWideAudience && !tenantWideConfirmed)} onClick={() => void publish()} className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" /> {operation === "RECOVERY" ? "Publish recovery" : operation === "UPDATE" ? "Publish update" : "Broadcast alert"}</button> : null}{alert.status === "DRAFT" ? <button disabled={busy} onClick={() => void cancelDraft()} className="ml-auto inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-[#7B405C]"><XCircle className="h-4 w-4" /> Cancel draft</button> : null}</div>
          {preview ? <PreviewPanel preview={preview} onViewRecipients={(group) => setRecipientView({ title: `${audienceLabel(group.audience_type)} recipients`, audienceType: group.audience_type, projectionType: group.projection_type })} /> : null}
        </section> : null}

        <section className="rounded-2xl border border-[#E6E9F0] bg-white p-6"><h2 className="text-lg font-semibold">Immutable communication history</h2><p className="mt-1 text-sm text-[#6B7488]">Published messages remain preserved as evidence and cannot be edited or deleted.</p>{alert.publications.length ? <ol className="mt-5 space-y-3">{[...alert.publications].reverse().map((publication, index) => <li key={String(publication.id || publication.version || index)} className="flex gap-3 rounded-xl bg-[#FBFAF9] p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F1ECFE] text-[#6D28D9]"><CheckCircle2 className="h-4 w-4" /></span><div><p className="font-semibold">{String(publication.type || "Publication").replaceAll("_", " ")} · Version {String(publication.version || "")}</p><p className="mt-1 text-xs text-[#6B7488]">{formatAlertDate(String(publication.published_at || ""))} · {String(publication.recipient_count ?? "Authorized")} recipients</p></div></li>)}</ol> : <p className="mt-5 rounded-xl bg-[#FBFAF9] p-4 text-sm text-[#6B7488]">No publication has been made yet.</p>}</section>
        {alert.publications.length ? <section className="rounded-2xl border border-[#E6E9F0] bg-white p-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h2 className="text-lg font-semibold">Recipient delivery records</h2><p className="mt-1 text-sm text-[#6B7488]">Review exactly who was targeted for each immutable publication and why.</p></div><span className="rounded-full bg-[#F1ECFE] px-3 py-1.5 text-xs font-bold text-[#5B21B6]">{alert.publications.length} version{alert.publications.length === 1 ? "" : "s"}</span></div><div className="mt-5 divide-y divide-[#EEF1F5] rounded-xl border border-[#E6E9F0]">{[...alert.publications].reverse().map((publication, index) => <div key={`recipients-${String(publication.id || publication.version || index)}`} className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold text-[#172033]">{String(publication.type || "Publication").replaceAll("_", " ")} · Version {String(publication.version || "")}</p><p className="mt-1 text-xs text-[#667085]">{String(publication.recipient_count ?? 0)} recipients · {formatAlertDate(String(publication.published_at || ""))}</p></div><button type="button" onClick={() => setRecipientView({ title: `Version ${String(publication.version || "")} delivery recipients`, publicationId: String(publication.id) })} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#D6C9FD] bg-white px-3.5 py-2 text-sm font-semibold text-[#5B21B6] hover:bg-[#F8F5FF] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20"><Eye className="h-4 w-4" /> View recipients</button></div>)}</div></section> : null}
      </div>
      <aside className="space-y-5"><section className="rounded-2xl border border-[#E6E9F0] bg-white p-5"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-[#6D28D9]" /> Access and evidence</h2><div className="mt-4 space-y-3 text-sm"><p className="flex justify-between gap-3"><span className="text-[#6B7488]">Allowed actions</span><span className="text-right font-semibold">{alert.allowed_actions.map((value) => value.replaceAll("_", " ")).join(", ") || "Read only"}</span></p><p className="flex justify-between gap-3"><span className="text-[#6B7488]">Related records</span><span className="font-semibold">{alert.links.length}</span></p><p className="flex justify-between gap-3"><span className="text-[#6B7488]">Versions</span><span className="font-semibold">{alert.publications.length}</span></p></div></section>
        {alert.delivery_summary ? <section className="rounded-2xl border border-[#E6E9F0] bg-white p-5"><h2 className="flex items-center gap-2 font-semibold"><BellRing className="h-5 w-5 text-[#6D28D9]" /> Delivery evidence</h2><div className="mt-4 space-y-2">{Object.entries(alert.delivery_summary).map(([key,value]) => <div key={key} className="flex justify-between rounded-lg bg-[#FBFAF9] px-3 py-2 text-sm"><span>{key.replaceAll("_", " ")}</span><strong>{value}</strong></div>)}{!Object.keys(alert.delivery_summary).length ? <p className="text-sm text-[#6B7488]">No delivery attempts yet.</p> : null}</div></section> : null}
        <AlertLinkManager alertId={alert.id} serviceIds={alert.affected_services.map((service) => service.id)} links={alert.links} canManage={alert.allowed_actions.includes("LINK_RECORD")} status={alert.status} onChanged={async () => { setPreview(null); await load(); }} />
      </aside>
    </div>
    {recipientView ? <AlertRecipientEvidenceDialog alertId={alert.id} publicationId={recipientView.publicationId} audienceType={recipientView.audienceType} projectionType={recipientView.projectionType} title={recipientView.title} onClose={() => setRecipientView(null)} /> : null}
  </div>;
}

function Info({ label, value, wide = false }: { label: string; value: unknown; wide?: boolean }) { return <div className={wide ? "sm:col-span-2" : ""}><dt className="text-xs font-semibold uppercase tracking-wide text-[#8A93A5]">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm font-medium text-[#0E1726]">{String(value || "Not provided")}</dd></div>; }
function PreviewPanel({ preview, onViewRecipients }: { preview: Preview; onViewRecipients: (group: Preview["groups"][number]) => void }) {
  return <div className="mt-5 rounded-xl border border-[#D6C9FD] bg-white p-4"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><h3 className="font-semibold">Recipient &amp; information preview</h3><p className="mt-0.5 text-xs text-[#667085]">Counts are resolved now; open a group to verify individual eligibility.</p></div><span className="self-start rounded-full bg-[#F1ECFE] px-2.5 py-1 text-xs font-bold text-[#5B21B6]">{preview.total_recipients} unique recipients</span></div><div className="mt-4 space-y-3">{preview.groups.map((group) => <div key={`${group.audience_type}-${group.projection_type}`} className="rounded-xl bg-[#FBFAF9] p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="font-semibold">{audienceLabel(group.audience_type)}</p><p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#8A93A5]">{group.projection_type.replaceAll("_", " ")} view</p></div><div className="flex items-center gap-3"><strong className="text-[#5B21B6]">{group.recipient_count}</strong><button type="button" onClick={() => onViewRecipients(group)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6C9FD] bg-white px-3 py-1.5 text-xs font-semibold text-[#5B21B6] hover:bg-[#F8F5FF]"><Eye className="h-3.5 w-3.5" /> View recipients</button></div></div><p className="mt-2 text-xs text-[#6B7488]">Included because: {group.included_because}.</p><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-[#5B21B6]">Information and actions</summary><p className="mt-2 text-xs"><strong>They can see:</strong> {group.projection_fields.map((field) => field.replaceAll("_", " ")).join(", ")}</p><p className="mt-1 text-xs"><strong>Actions:</strong> {group.allowed_actions.map((action) => action.replaceAll("_", " ")).join(", ")}</p></details></div>)}{preview.exclusions.map((item,index) => <div key={`${item.audience_type}-${index}`} className="rounded-xl bg-[#F6F7F9] p-3 text-xs text-[#6B7488]"><strong>{audienceLabel(item.audience_type)}:</strong> {item.reason}</div>)}</div></div>;
}

function audienceLabel(value: string) {
  if (value === "ALL_PORTAL_USERS") return "Everyone in the organization";
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
