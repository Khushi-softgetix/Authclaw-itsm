import React from "react";
import {
  BellRing,
  Check,
  CircleAlert,
  Link2,
  Send,
  ShieldAlert,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import type {
  OutageAlert,
  OutageAlertLinkableRecords,
  OutageAlertStatus,
} from "@/lib/outage-alert-types";

const inputClass = "w-full rounded-lg border border-[#DDE1E8] bg-white px-3 py-2.5 text-sm text-[#0E1726] outline-none transition placeholder:text-[#8A93A5] focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10";

export function humanize(value: string) { 
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); 
}

export function StatusBadge({ status }: { status: OutageAlertStatus }) {
  const labels: Record<OutageAlertStatus, string> = { DRAFT: "Draft", ACTIVE: "Active", RECOVERED: "Recovered" };
  const tone: Record<OutageAlertStatus, string> = { DRAFT: "border-[#E6E9F0] bg-[#F5F7FA] text-[#475069]", ACTIVE: "border-[#DDD6FE] bg-[#F1ECFE] text-[#5B21B6]", RECOVERED: "border-[#DDD6FE] bg-[#F8F5FF] text-[#6D28D9]" };
  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${tone[status]}`}>{labels[status]}</span>;
}

export function Notice({ tone, message }: { tone: "success" | "error"; message: string }) {
  const isError = tone === "error";
  return <div role={isError ? "alert" : "status"} className={`flex gap-2 rounded-xl border p-3 text-xs ${isError ? "border-[#F1C7C1] bg-[#FFF7F6] text-[#8A241B]" : "border-[#DDD6FE] bg-[#F8F5FF] text-[#5B21B6]"}`}>{isError ? <CircleAlert className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}<span>{message}</span></div>;
}

export function EmptyDetail() { 
  return <div className="flex min-h-[360px] items-center justify-center text-center"><div><span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#F1ECFE]"><BellRing className="h-5 w-5 text-[#6D28D9]" /></span><h2 className="mt-3 text-base font-bold text-[#0E1726]">Select an Alert</h2><p className="mt-1 max-w-sm text-sm leading-6 text-[#6B7488]">Choose an Alert to review its public lifecycle, related operational record, and immutable history.</p></div></div>; 
}

export function AlertDetail({ 
  alert, saving = false, linkable = null, linking = false, linkTarget = "", publicationMessage = "", canMutate = false, 
  onDraftChange = () => {}, 
  onDraftSave = () => {}, 
  onLoadLinkable = () => {}, 
  onLinkTarget = () => {}, 
  onLink = () => {}, 
  onPublicationMessage = () => {}, 
  onPublication = () => {} 
}: {
  alert: OutageAlert; saving?: boolean; linkable?: OutageAlertLinkableRecords | null; linking?: boolean; linkTarget?: string; publicationMessage?: string; canMutate?: boolean;
  onDraftChange?: (alert: OutageAlert) => void; onDraftSave?: () => void; onLoadLinkable?: () => void; onLinkTarget?: (value: string) => void; onLink?: () => void; onPublicationMessage?: (value: string) => void; onPublication?: (action: "publish" | "updates" | "recover") => void;
}) {
  const canPublish = alert.readiness?.ready ?? false;
  const links = alert.links || [];
  const stateHistory = alert.state_history || [];
  const publications = alert.publications || [];
  
  const linkOptions = linkable ? [
    ...linkable.incidents.map((incident) => ({ value: `INCIDENT:${incident.id}`, label: `${incident.ticket_number} · ${incident.title}` })),
    ...linkable.major_incidents.map((major) => ({ value: `MAJOR_INCIDENT:${major.id}`, label: `${major.ticket_number} · Major Incident · ${major.title}` })),
  ] : [];
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 border-b border-[#E6E9F0] pb-5 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={alert.status} /><span className="font-mono text-[11px] font-semibold text-[#6D28D9]">{alert.id.slice(0, 8)}</span></div><h2 className="mt-3 break-words text-xl font-bold tracking-tight text-[#0E1726]">{alert.title}</h2><p className="mt-2 text-xs text-[#6B7488]">Created {formatDateTime(alert.created_at)} · {alert.affected_services.map((service) => service.name).join(", ") || "No affected service recorded"}</p></div><div className="shrink-0 rounded-xl border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-2 text-right"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6D28D9]">Public lifecycle</p><p className="mt-1 text-xs font-semibold text-[#475069]">{alert.status === "DRAFT" ? "Not published" : alert.status === "ACTIVE" ? "Active communication" : "Recovery published"}</p></div></div>

    {!canPublish && alert.readiness ? <div className="flex gap-3 rounded-xl border border-[#DDD6FE] bg-[#F8F5FF] p-4"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#6D28D9]" /><div><p className="text-xs font-bold text-[#0E1726]">Publication is intentionally pending</p><p className="mt-1 text-xs leading-5 text-[#475069]">{alert.readiness.detail} No public message or notification is sent by this workspace until that policy exists.</p></div></div> : null}

    {alert.status === "DRAFT" && alert.draft_message !== undefined ? <section className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-[#0E1726]">Draft content</h3><p className="mt-1 text-xs text-[#6B7488]">Draft content can be refined before its immutable initial publication.</p></div>{canMutate ? <button type="button" disabled={saving} onClick={onDraftSave} className="rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-bold text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-50">Save draft</button> : null}</div><label className="mt-4 block text-xs font-semibold text-[#0E1726]">Title<input disabled={!canMutate} value={alert.title} onChange={(event) => onDraftChange({ ...alert, title: event.target.value })} className={`${inputClass} mt-1.5`} /></label><label className="mt-4 block text-xs font-semibold text-[#0E1726]">Initial message<textarea disabled={!canMutate} value={alert.draft_message} onChange={(event) => onDraftChange({ ...alert, draft_message: event.target.value })} rows={5} className={`${inputClass} mt-1.5 resize-y`} /></label>{canMutate ? <button type="button" title={alert.readiness?.detail} disabled={!canPublish || saving} onClick={() => onPublication("publish")} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-3.5 w-3.5" />Publish alert</button> : null}</section> : null}

    {alert.status === "ACTIVE" && canMutate ? <section className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-4"><h3 className="text-sm font-bold text-[#0E1726]">Continue the public communication</h3><p className="mt-1 text-xs text-[#6B7488]">Each action adds a new immutable message. Recovery is a single action that publishes recovery and completes the Alert lifecycle.</p><textarea value={publicationMessage} onChange={(event) => onPublicationMessage(event.target.value)} placeholder="Customer-safe public update or recovery message" rows={4} className={`${inputClass} mt-4 resize-y`} /><div className="mt-3 flex flex-wrap gap-2"><button type="button" title={alert.readiness?.detail} disabled={!canPublish || saving || !(publicationMessage || "").trim()} onClick={() => onPublication("updates")} className="inline-flex items-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-3.5 py-2 text-xs font-bold text-[#5B21B6] disabled:opacity-50"><Send className="h-3.5 w-3.5" />Publish update</button><button type="button" title={alert.readiness?.detail} disabled={!canPublish || saving || !(publicationMessage || "").trim()} onClick={() => onPublication("recover")} className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" />Publish recovery</button></div></section> : null}

    {alert.links !== undefined ? <section className="rounded-xl border border-[#E6E9F0] bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-[#0E1726]">Related operational record</h3><p className="mt-1 text-xs leading-5 text-[#6B7488]">Optional and explicit. An Alert remains independent from its linked Incident or Major Incident.</p></div><Link2 className="h-4 w-4 shrink-0 text-[#6D28D9]" /></div>{links.length ? <div className="mt-3 rounded-lg bg-[#F8F5FF] px-3 py-2 text-xs text-[#475069]">{links.map((link) => link.major_incident_id ? `Major Incident ${link.major_incident_id.slice(0, 8)}` : `Incident ${link.incident_id?.slice(0, 8)}`).join(", ")}</div> : canMutate ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onLoadLinkable} disabled={linking} className="rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-bold text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-50">{linking ? "Loading records…" : "Create / link alert"}</button>{linkable ? <><select value={linkTarget} onChange={(event) => onLinkTarget(event.target.value)} className="min-w-[230px] flex-1 rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-xs text-[#475069]"><option value="">Select existing record</option>{linkOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="button" disabled={!linkTarget || linking} onClick={onLink} className="rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Link record</button></> : null}</div> : <div className="mt-3 text-xs text-[#6B7488]">No related operational record</div>}</section> : null}

    {alert.publications !== undefined || alert.state_history !== undefined ? <section><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-[#0E1726]">Alert history</h3><p className="mt-1 text-xs text-[#6B7488]">Published messages and lifecycle actions are append-only evidence.</p></div><span className="text-[11px] font-semibold text-[#6B7488]">{publications.length} publication{publications.length === 1 ? "" : "s"}</span></div><div className="mt-4 space-y-3 border-l border-[#DDD6FE] pl-4">{stateHistory.map((entry) => <div key={entry.id} className="relative"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#6D28D9]" /><p className="text-xs font-bold text-[#0E1726]">{humanize(entry.action)}</p><p className="mt-1 text-[11px] text-[#6B7488]">{formatDateTime(entry.occurred_at)} · {entry.from_state || "—"} → {entry.to_state}</p></div>)}{publications.map((publication) => <article key={publication.id} className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-[#F1ECFE] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#5B21B6]">{publication.publication_type}</span><span className="text-[10px] text-[#8A93A5]">{formatDateTime(publication.published_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#475069]">{publication.message}</p></article>)}</div></section> : null}

    {alert.deliveries !== undefined && alert.deliveries.length > 0 ? <section><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-[#0E1726]">Delivery Status</h3><p className="mt-1 text-xs text-[#6B7488]">Provider delivery attempts and statuses.</p></div><span className="text-[11px] font-semibold text-[#6B7488]">{alert.deliveries.length} delivery{alert.deliveries.length === 1 ? "" : "s"}</span></div><div className="mt-4 space-y-3">{alert.deliveries.map(delivery => <div key={delivery.id} className="rounded-xl border border-[#E6E9F0] bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wide text-[#475069]">{delivery.status}</span><span className="text-[10px] text-[#8A93A5]">{formatDateTime(delivery.updated_at)}</span></div>{delivery.attempts.length > 0 && <div className="mt-2 space-y-1">{delivery.attempts.map(attempt => <div key={attempt.id} className="flex justify-between text-[11px] text-[#6B7488]"><span>Attempt {attempt.attempt_number} ({attempt.status})</span><span>{formatDateTime(attempt.attempted_at)}</span></div>)}</div>}</div>)}</div></section> : null}
  </div>;
}
