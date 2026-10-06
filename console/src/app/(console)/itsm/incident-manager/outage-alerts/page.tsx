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
import { AlertDetail, EmptyDetail, StatusBadge, Notice } from "@/components/itsm/alert-detail-ui";
import { CreateAlertForm } from "@/components/itsm/create-alert-form";

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
  const [canMutate, setCanMutate] = useState(false);
  const [canReadDrafts, setCanReadDrafts] = useState(false);
  const [publicationMessage, setPublicationMessage] = useState("");
  const [linkTarget, setLinkTarget] = useState("");
  const [linking, setLinking] = useState(false);
  const requestedMajorIncidentId = searchParams.get("major_incident");
  const requestedAlertId = searchParams.get("alert");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [alertResponse, referenceResponse, meResponse] = await Promise.all([
        fetch("/api/itsm/alerts", { cache: "no-store" }),
        fetch("/api/itsm/incidents/operations/reference-data", { cache: "no-store" }).catch(() => null),
        fetch("/api/auth/me", { cache: "no-store" }).catch(() => null),
      ]);
      const alertBody = await alertResponse.json().catch(() => ({}));
      if (!alertResponse.ok) throw new Error(apiErrorMessage(alertBody, "Unable to load Outage & Alerts"));
      
      const me = meResponse?.ok ? await meResponse.json() : null;
      const role = me?.itsm_role;
      setCanMutate(role === "INCIDENT_MANAGER");
      setCanReadDrafts(role === "INCIDENT_MANAGER" || role === "AUDITOR");
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

  const handleCreateSuccess = async (created: OutageAlert, noticeMessage: string) => {
    setNotice(noticeMessage);
    setShowCreate(false);
    await load();
    setSelectedId(created.id);
    setTab("DRAFT");
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
          {canMutate ? <button type="button" onClick={() => setShowCreate((current) => !current)} className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[#5B21B6]"><Plus className="h-3.5 w-3.5" />Create alert draft</button> : null}
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-[#E6E9F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#475069] shadow-sm transition hover:border-[#DDD6FE] hover:bg-[#F5F7FA]"><RefreshCw className={`h-3.5 w-3.5 text-[#6D28D9] ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
      </header>

      {error ? <Notice tone="error" message={error} /> : null}
      {notice ? <Notice tone="success" message={notice} /> : null}

      {showCreate ? (
        <CreateAlertForm 
          services={referenceData?.services || []} 
          linkable={linkable} 
          onLoadLinkable={() => void loadLinkable()} 
          requestedMajorIncidentId={requestedMajorIncidentId} 
          onCancel={() => setShowCreate(false)} 
          onSuccess={handleCreateSuccess} 
        />
      ) : null}

      <section className="overflow-hidden rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#E6E9F0] px-4 py-3">{STATUS_TABS.filter(item => canReadDrafts || item.key !== "DRAFT").map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} aria-pressed={tab === item.key} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${tab === item.key ? "bg-[#F1ECFE] text-[#5B21B6]" : "text-[#6B7488] hover:bg-[#F5F7FA] hover:text-[#475069]"}`}>{item.label}<span className="ml-1.5 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px]">{alerts.filter((alert) => alert.status === item.key).length}</span></button>)}</div>
        <div className="grid min-h-[470px] xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="border-b border-[#E6E9F0] bg-[#FBFAF9] xl:border-b-0 xl:border-r">{loading ? <LoadingList /> : visibleAlerts.length ? <div className="divide-y divide-[#EEF1F5]">{visibleAlerts.map((alert) => <button type="button" key={alert.id} onClick={() => setSelectedId(alert.id)} className={`w-full border-l-2 px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6D28D9] ${selectedId === alert.id ? "border-[#6D28D9] bg-[#F1ECFE]" : "border-transparent hover:bg-white"}`}><div className="flex items-center justify-between gap-2"><StatusBadge status={alert.status} /><span className="text-[10px] text-[#8A93A5]">{formatDateTime(alert.updated_at)}</span></div><p className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-[#0E1726]">{alert.title}</p><p className="mt-1 truncate text-[11px] text-[#6B7488]">{alert.affected_services.map((service) => service.name).join(", ") || "No affected service recorded"}</p></button>)}</div> : <EmptyList status={tab} canMutate={canMutate} />}</aside>
          <div className="min-w-0 p-5 sm:p-6">{selected ? <AlertDetail alert={selected} saving={saving} linkable={linkable} linking={linking} linkTarget={linkTarget} publicationMessage={publicationMessage} canMutate={canMutate} onDraftChange={replaceAlert} onDraftSave={() => void updateDraft()} onLoadLinkable={() => void loadLinkable()} onLinkTarget={setLinkTarget} onLink={() => void createLink()} onPublicationMessage={setPublicationMessage} onPublication={requestPublication} /> : <EmptyDetail />}</div>
        </div>
      </section>
    </div>
  );
}

function EmptyList({ status, canMutate }: { status: OutageAlertStatus, canMutate: boolean }) { return <div className="px-6 py-14 text-center"><BellRing className="mx-auto h-7 w-7 text-[#6D28D9]" /><p className="mt-3 text-sm font-bold text-[#0E1726]">No {status.toLowerCase()} Alerts</p>{canMutate ? <p className="mt-1 text-xs leading-5 text-[#6B7488]">Create a standalone Alert draft when an outage needs communication before an operational ticket exists.</p> : null}</div>; }
function LoadingList() { return <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-[#EEF1F5]" />)}</div>; }

