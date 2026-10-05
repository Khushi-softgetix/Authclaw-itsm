"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BellRing,
  Check,
  CircleAlert,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
} from "lucide-react";
import { apiErrorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/itsm-format";
import { jsonRequest } from "@/lib/client-fetch";
import type { IncidentOperationsReferenceData } from "@/lib/itsm-types";
import type {
  OutageAlert,
  OutageAlertLinkableRecords,
  OutageAlertList,
  OutageAlertStatus,
} from "@/lib/outage-alert-types";

const STATUS_TABS: Array<{ key: OutageAlertStatus; label: string }> = [
  { key: "ACTIVE", label: "Active Alerts" },
  { key: "DRAFT", label: "Draft Alerts" },
  { key: "RECOVERED", label: "Recovered" },
];

const inputClass = "w-full rounded-lg border border-[#DDE1E8] bg-white px-3 py-2.5 text-sm text-[#0E1726] outline-none transition placeholder:text-[#8A93A5] focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10";

export default function OutageAlertsPage() {
  const searchParams = useSearchParams();
  const [alerts, setAlerts] = useState<OutageAlert[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [referenceData, setReferenceData] = useState<IncidentOperationsReferenceData | null>(null);
  const [linkable, setLinkable] = useState<OutageAlertLinkableRecords | null>(null);
  const [tab, setTab] = useState<OutageAlertStatus>("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [publicationMessage, setPublicationMessage] = useState("");
  const [linkTarget, setLinkTarget] = useState("");
  const [linking, setLinking] = useState(false);
  const requestedMajorIncidentId = searchParams.get("major_incident");
  const requestedAlertId = searchParams.get("alert");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [alertResponse, referenceResponse] = await Promise.all([
        fetch("/api/itsm/alerts", { cache: "no-store" }),
        fetch("/api/itsm/incidents/operations/reference-data", { cache: "no-store" }).catch(() => null),
      ]);
      const alertBody = await alertResponse.json().catch(() => ({}));
      if (!alertResponse.ok) throw new Error(apiErrorMessage(alertBody, "Unable to load Outage & Alerts"));
      const list = alertBody as OutageAlertList;
      const nextAlerts = Array.isArray(list.items) ? list.items : [];
      setAlerts(nextAlerts);
      setSelectedId((current) => requestedAlertId && nextAlerts.some((alert) => alert.id === requestedAlertId)
        ? requestedAlertId
        : current && nextAlerts.some((alert) => alert.id === current) ? current : nextAlerts[0]?.id || null);
      if (referenceResponse?.ok) setReferenceData(await referenceResponse.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Outage & Alerts");
    } finally {
      setLoading(false);
    }
  }, [requestedAlertId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = alerts.find((alert) => alert.id === selectedId) || null;
  const visibleAlerts = useMemo(() => alerts.filter((alert) => alert.status === tab), [alerts, tab]);

  const replaceAlert = (next: OutageAlert) => {
    setAlerts((current) => current.some((alert) => alert.id === next.id)
      ? current.map((alert) => alert.id === next.id ? next : alert)
      : [next, ...current]);
    setSelectedId(next.id);
  };

  const createDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !draftMessage.trim()) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/itsm/alerts", jsonRequest("POST", {
        title: title.trim(),
        draft_message: draftMessage.trim(),
        affected_service_ids: serviceIds,
      }));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(body, "Unable to create Alert draft"));
      const created = body as OutageAlert;
      if (requestedMajorIncidentId) {
        const linkResponse = await fetch(`/api/itsm/alerts/${created.id}/links`, jsonRequest("POST", {
          target_type: "MAJOR_INCIDENT",
          target_id: requestedMajorIncidentId,
        }));
        if (!linkResponse.ok) {
          const linkBody = await linkResponse.json().catch(() => ({}));
          throw new Error(apiErrorMessage(linkBody, "Alert was created, but Major Incident linking needs attention"));
        }
        setNotice("Alert draft created and linked to the Major Incident.");
      } else {
        setNotice("Alert draft created. Publishing remains pending the approved audience and approval policy.");
      }
      setTitle(""); setDraftMessage(""); setServiceIds([]); setShowCreate(false);
      await load();
      setSelectedId(created.id);
      setTab("DRAFT");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create Alert draft");
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = async () => {
    if (!selected || selected.status !== "DRAFT") return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/itsm/alerts/${selected.id}/draft`, jsonRequest("PATCH", {
        title: selected.title,
        draft_message: selected.draft_message,
        affected_service_ids: selected.affected_services.map((service) => service.id),
      }));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(body, "Unable to save Alert draft"));
      replaceAlert(body as OutageAlert);
      setNotice("Alert draft saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save Alert draft");
    } finally {
      setSaving(false);
    }
  };

  const loadLinkable = async () => {
    if (linkable) return;
    setLinking(true); setError(null);
    try {
      const response = await fetch("/api/itsm/alerts/linkable-records", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(body, "Unable to load linkable records"));
      setLinkable(body as OutageAlertLinkableRecords);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load linkable records");
    } finally {
      setLinking(false);
    }
  };

  const createLink = async () => {
    if (!selected || !linkTarget) return;
    const [targetType, targetId] = linkTarget.split(":");
    setLinking(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/itsm/alerts/${selected.id}/links`, jsonRequest("POST", {
        target_type: targetType,
        target_id: targetId,
      }));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(body, "Unable to link operational record"));
      await load();
      setLinkTarget("");
      setNotice("Operational record linked. The link is retained as Alert evidence.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to link operational record");
    } finally {
      setLinking(false);
    }
  };

  const requestPublication = async (action: "publish" | "updates" | "recover") => {
    if (!selected) return;
    const message = action === "publish" ? selected.draft_message : publicationMessage;
    if (!message.trim()) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/itsm/alerts/${selected.id}/${action}`, jsonRequest("POST", { message: message.trim() }));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(body, "Publication is not available"));
      replaceAlert(body as OutageAlert);
      setPublicationMessage("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Publication is not available");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#6D28D9]"><BellRing className="h-3.5 w-3.5" />Incident operations</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0E1726]">Outage &amp; Alerts</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#6B7488]">Manage the public outage communication lifecycle independently from operational tickets.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowCreate((current) => !current)} className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[#5B21B6]"><Plus className="h-3.5 w-3.5" />Create alert draft</button>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-[#E6E9F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#475069] shadow-sm transition hover:border-[#DDD6FE] hover:bg-[#F5F7FA]"><RefreshCw className={`h-3.5 w-3.5 text-[#6D28D9] ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
      </header>

      {error ? <Notice tone="error" message={error} /> : null}
      {notice ? <Notice tone="success" message={notice} /> : null}

      {showCreate ? <section className="rounded-[20px] border border-[#DDD6FE] bg-white p-5 shadow-[0_1px_2px_rgba(11,31,63,.05)]">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-bold text-[#0E1726]">Create Alert draft</h2><p className="mt-1 text-xs leading-5 text-[#6B7488]">A draft is not public and does not create an Incident. Publish remains unavailable until audience and approval policy are configured.</p></div><span className="rounded-full bg-[#F1ECFE] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#5B21B6]">Draft</span></div>
        <form onSubmit={createDraft} className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4"><label className="block text-xs font-semibold text-[#0E1726]">Alert title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What is affected?" className={`${inputClass} mt-1.5`} /></label><label className="block text-xs font-semibold text-[#0E1726]">Draft message<textarea value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} placeholder="State the current customer-safe impact and known next step." rows={5} className={`${inputClass} mt-1.5 resize-y`} /></label></div>
          <fieldset className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-4"><legend className="px-1 text-xs font-bold text-[#0E1726]">Affected services</legend><p className="mt-1 text-[11px] leading-5 text-[#6B7488]">Optional operational scope. Audience resolution is not inferred from this selection.</p><div className="mt-3 max-h-44 space-y-1 overflow-y-auto">{referenceData?.services.length ? referenceData.services.map((service) => <label key={service.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[#475069] hover:bg-white"><input type="checkbox" checked={serviceIds.includes(service.id)} onChange={(event) => setServiceIds((current) => event.target.checked ? [...current, service.id] : current.filter((id) => id !== service.id))} className="h-3.5 w-3.5 accent-[#6D28D9]" /><span className="truncate">{service.name}</span></label>) : <p className="text-xs text-[#8A93A5]">No service reference data available.</p>}</div></fieldset>
          <div className="lg:col-span-2 flex justify-end gap-2 border-t border-[#EEF1F5] pt-4"><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-[#E6E9F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#475069]">Cancel</button><button disabled={saving || !title.trim() || !draftMessage.trim()} className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Save draft</button></div>
        </form>
      </section> : null}

      <section className="overflow-hidden rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#E6E9F0] px-4 py-3">{STATUS_TABS.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} aria-pressed={tab === item.key} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${tab === item.key ? "bg-[#F1ECFE] text-[#5B21B6]" : "text-[#6B7488] hover:bg-[#F5F7FA] hover:text-[#475069]"}`}>{item.label}<span className="ml-1.5 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px]">{alerts.filter((alert) => alert.status === item.key).length}</span></button>)}</div>
        <div className="grid min-h-[470px] xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="border-b border-[#E6E9F0] bg-[#FBFAF9] xl:border-b-0 xl:border-r">{loading ? <LoadingList /> : visibleAlerts.length ? <div className="divide-y divide-[#EEF1F5]">{visibleAlerts.map((alert) => <button type="button" key={alert.id} onClick={() => setSelectedId(alert.id)} className={`w-full border-l-2 px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6D28D9] ${selectedId === alert.id ? "border-[#6D28D9] bg-[#F1ECFE]" : "border-transparent hover:bg-white"}`}><div className="flex items-center justify-between gap-2"><StatusBadge status={alert.status} /><span className="text-[10px] text-[#8A93A5]">{formatDateTime(alert.updated_at)}</span></div><p className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-[#0E1726]">{alert.title}</p><p className="mt-1 truncate text-[11px] text-[#6B7488]">{alert.affected_services.map((service) => service.name).join(", ") || "No affected service recorded"}</p></button>)}</div> : <EmptyList status={tab} />}</aside>
          <div className="min-w-0 p-5 sm:p-6">{selected ? <AlertDetail alert={selected} saving={saving} linkable={linkable} linking={linking} linkTarget={linkTarget} publicationMessage={publicationMessage} onDraftChange={replaceAlert} onDraftSave={() => void updateDraft()} onLoadLinkable={() => void loadLinkable()} onLinkTarget={setLinkTarget} onLink={() => void createLink()} onPublicationMessage={setPublicationMessage} onPublication={requestPublication} /> : <EmptyDetail />}</div>
        </div>
      </section>
    </div>
  );
}

function AlertDetail({ alert, saving, linkable, linking, linkTarget, publicationMessage, onDraftChange, onDraftSave, onLoadLinkable, onLinkTarget, onLink, onPublicationMessage, onPublication }: {
  alert: OutageAlert; saving: boolean; linkable: OutageAlertLinkableRecords | null; linking: boolean; linkTarget: string; publicationMessage: string;
  onDraftChange: (alert: OutageAlert) => void; onDraftSave: () => void; onLoadLinkable: () => void; onLinkTarget: (value: string) => void; onLink: () => void; onPublicationMessage: (value: string) => void; onPublication: (action: "publish" | "updates" | "recover") => void;
}) {
  const canPublish = alert.readiness.ready;
  const linkOptions = linkable ? [
    ...linkable.incidents.map((incident) => ({ value: `INCIDENT:${incident.id}`, label: `${incident.ticket_number} · ${incident.title}` })),
    ...linkable.major_incidents.map((major) => ({ value: `MAJOR_INCIDENT:${major.id}`, label: `${major.ticket_number} · Major Incident · ${major.title}` })),
  ] : [];
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 border-b border-[#E6E9F0] pb-5 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={alert.status} /><span className="font-mono text-[11px] font-semibold text-[#6D28D9]">{alert.id.slice(0, 8)}</span></div><h2 className="mt-3 break-words text-xl font-bold tracking-tight text-[#0E1726]">{alert.title}</h2><p className="mt-2 text-xs text-[#6B7488]">Created {formatDateTime(alert.created_at)} · {alert.affected_services.map((service) => service.name).join(", ") || "No affected service recorded"}</p></div><div className="shrink-0 rounded-xl border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-2 text-right"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6D28D9]">Public lifecycle</p><p className="mt-1 text-xs font-semibold text-[#475069]">{alert.status === "DRAFT" ? "Not published" : alert.status === "ACTIVE" ? "Active communication" : "Recovery published"}</p></div></div>

    {!canPublish ? <div className="flex gap-3 rounded-xl border border-[#DDD6FE] bg-[#F8F5FF] p-4"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#6D28D9]" /><div><p className="text-xs font-bold text-[#0E1726]">Publication is intentionally pending</p><p className="mt-1 text-xs leading-5 text-[#475069]">{alert.readiness.detail} No public message or notification is sent by this workspace until that policy exists.</p></div></div> : null}

    {alert.status === "DRAFT" ? <section className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-[#0E1726]">Draft content</h3><p className="mt-1 text-xs text-[#6B7488]">Draft content can be refined before its immutable initial publication.</p></div><button type="button" disabled={saving} onClick={onDraftSave} className="rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-bold text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-50">Save draft</button></div><label className="mt-4 block text-xs font-semibold text-[#0E1726]">Title<input value={alert.title} onChange={(event) => onDraftChange({ ...alert, title: event.target.value })} className={`${inputClass} mt-1.5`} /></label><label className="mt-4 block text-xs font-semibold text-[#0E1726]">Initial message<textarea value={alert.draft_message} onChange={(event) => onDraftChange({ ...alert, draft_message: event.target.value })} rows={5} className={`${inputClass} mt-1.5 resize-y`} /></label><button type="button" title={alert.readiness.detail} disabled={!canPublish || saving} onClick={() => onPublication("publish")} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-3.5 w-3.5" />Publish alert</button></section> : null}

    {alert.status === "ACTIVE" ? <section className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-4"><h3 className="text-sm font-bold text-[#0E1726]">Continue the public communication</h3><p className="mt-1 text-xs text-[#6B7488]">Each action adds a new immutable message. Recovery is a single action that publishes recovery and completes the Alert lifecycle.</p><textarea value={publicationMessage} onChange={(event) => onPublicationMessage(event.target.value)} placeholder="Customer-safe public update or recovery message" rows={4} className={`${inputClass} mt-4 resize-y`} /><div className="mt-3 flex flex-wrap gap-2"><button type="button" title={alert.readiness.detail} disabled={!canPublish || saving || !publicationMessage.trim()} onClick={() => onPublication("updates")} className="inline-flex items-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-3.5 py-2 text-xs font-bold text-[#5B21B6] disabled:opacity-50"><Send className="h-3.5 w-3.5" />Publish update</button><button type="button" title={alert.readiness.detail} disabled={!canPublish || saving || !publicationMessage.trim()} onClick={() => onPublication("recover")} className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" />Publish recovery</button></div></section> : null}

    <section className="rounded-xl border border-[#E6E9F0] bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-[#0E1726]">Related operational record</h3><p className="mt-1 text-xs leading-5 text-[#6B7488]">Optional and explicit. An Alert remains independent from its linked Incident or Major Incident.</p></div><Link2 className="h-4 w-4 shrink-0 text-[#6D28D9]" /></div>{alert.links.length ? <div className="mt-3 rounded-lg bg-[#F8F5FF] px-3 py-2 text-xs text-[#475069]">{alert.links.map((link) => link.major_incident_id ? `Major Incident ${link.major_incident_id.slice(0, 8)}` : `Incident ${link.incident_id?.slice(0, 8)}`).join(", ")}</div> : <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onLoadLinkable} disabled={linking} className="rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-bold text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-50">{linking ? "Loading records…" : "Create / link alert"}</button>{linkable ? <><select value={linkTarget} onChange={(event) => onLinkTarget(event.target.value)} className="min-w-[230px] flex-1 rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-xs text-[#475069]"><option value="">Select existing record</option>{linkOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="button" disabled={!linkTarget || linking} onClick={onLink} className="rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Link record</button></> : null}</div>}</section>

    <section><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-[#0E1726]">Alert history</h3><p className="mt-1 text-xs text-[#6B7488]">Published messages and lifecycle actions are append-only evidence.</p></div><span className="text-[11px] font-semibold text-[#6B7488]">{alert.publications.length} publication{alert.publications.length === 1 ? "" : "s"}</span></div><div className="mt-4 space-y-3 border-l border-[#DDD6FE] pl-4">{alert.state_history.map((entry) => <div key={entry.id} className="relative"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#6D28D9]" /><p className="text-xs font-bold text-[#0E1726]">{humanize(entry.action)}</p><p className="mt-1 text-[11px] text-[#6B7488]">{formatDateTime(entry.occurred_at)} · {entry.from_state || "—"} → {entry.to_state}</p></div>)}{alert.publications.map((publication) => <article key={publication.id} className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-[#F1ECFE] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#5B21B6]">{publication.publication_type}</span><span className="text-[10px] text-[#8A93A5]">{formatDateTime(publication.published_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#475069]">{publication.message}</p></article>)}</div></section>
  </div>;
}

function StatusBadge({ status }: { status: OutageAlertStatus }) {
  const labels: Record<OutageAlertStatus, string> = { DRAFT: "Draft", ACTIVE: "Active", RECOVERED: "Recovered" };
  const tone: Record<OutageAlertStatus, string> = { DRAFT: "border-[#E6E9F0] bg-[#F5F7FA] text-[#475069]", ACTIVE: "border-[#DDD6FE] bg-[#F1ECFE] text-[#5B21B6]", RECOVERED: "border-[#DDD6FE] bg-[#F8F5FF] text-[#6D28D9]" };
  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${tone[status]}`}>{labels[status]}</span>;
}

function Notice({ tone, message }: { tone: "success" | "error"; message: string }) {
  const isError = tone === "error";
  return <div role={isError ? "alert" : "status"} className={`flex gap-2 rounded-xl border p-3 text-xs ${isError ? "border-[#F1C7C1] bg-[#FFF7F6] text-[#8A241B]" : "border-[#DDD6FE] bg-[#F8F5FF] text-[#5B21B6]"}`}>{isError ? <CircleAlert className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}<span>{message}</span></div>;
}

function EmptyList({ status }: { status: OutageAlertStatus }) { return <div className="px-6 py-14 text-center"><BellRing className="mx-auto h-7 w-7 text-[#6D28D9]" /><p className="mt-3 text-sm font-bold text-[#0E1726]">No {status.toLowerCase()} Alerts</p><p className="mt-1 text-xs leading-5 text-[#6B7488]">Create a standalone Alert draft when an outage needs communication before an operational ticket exists.</p></div>; }
function LoadingList() { return <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-[#EEF1F5]" />)}</div>; }
function EmptyDetail() { return <div className="flex min-h-[360px] items-center justify-center text-center"><div><span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#F1ECFE]"><BellRing className="h-5 w-5 text-[#6D28D9]" /></span><h2 className="mt-3 text-base font-bold text-[#0E1726]">Select an Alert</h2><p className="mt-1 max-w-sm text-sm leading-6 text-[#6B7488]">Choose an Alert to review its public lifecycle, related operational record, and immutable history.</p></div></div>; }
function humanize(value: string) { return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
