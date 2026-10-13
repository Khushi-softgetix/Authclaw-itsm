"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BellRing, ChevronRight, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { alertApi, formatAlertDate, formatPublicStatus, type AlertSummary } from "@/lib/outage-alerts";

export default function AuditorOutageEvidencePage() {
  const [alerts, setAlerts] = useState<AlertSummary[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAlerts(await alertApi<AlertSummary[]>(""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Outage evidence could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return alerts.filter((alert) => {
      if (status !== "ALL" && alert.status !== status) return false;
      if (!term) return true;
      return [
        alert.alert_number,
        alert.title || "",
        ...alert.affected_services.map((service) => service.name),
      ].some((value) => value.toLowerCase().includes(term));
    });
  }, [alerts, query, status]);

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#6D28D9]"><ShieldCheck className="h-4 w-4" /> Read-only evidence</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-[#0E1726]">Outage & Alert evidence</h1><p className="mt-1 text-sm text-[#6B7488]">Review alert lifecycle, publication history, audience scope and delivery evidence. Operational actions are not available here.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-[#DDD6FE] bg-white px-4 py-2.5 text-sm font-semibold text-[#5B21B6] hover:bg-[#F8F5FF] disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
    </header>

    <section className="rounded-2xl border border-[#E6E9F0] bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <label className="relative"><span className="sr-only">Search outage evidence</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93A5]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search number, title or service" className="w-full rounded-xl border border-[#DCE1E8] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#6D28D9]/10" /></label>
        <label><span className="sr-only">Filter by lifecycle status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full rounded-xl border border-[#DCE1E8] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#8B5CF6]"><option value="ALL">All lifecycle states</option><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="RECOVERED">Recovered</option><option value="CANCELLED">Cancelled</option></select></label>
      </div>
    </section>

    {error ? <div role="alert" className="rounded-xl border border-[#E7D9CF] bg-[#FFF9F5] p-4 text-sm text-[#704C3B]">{error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button></div> : null}
    <section className="overflow-hidden rounded-2xl border border-[#E6E9F0] bg-white shadow-sm">
      {loading ? <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-[#F3F4F6]" />)}</div> : null}
      {!loading && !visible.length ? <div className="px-5 py-16 text-center"><BellRing className="mx-auto h-7 w-7 text-[#8B5CF6]" /><p className="mt-3 font-semibold text-[#0E1726]">No matching alert evidence</p><p className="mt-1 text-sm text-[#6B7488]">Adjust the search or lifecycle filter.</p></div> : null}
      {!loading ? <ul className="divide-y divide-[#EEF1F5]">{visible.map((alert) => <li key={alert.id}><Link href={`/itsm/outage-alerts/${alert.id}`} className="flex items-center justify-between gap-4 p-5 transition hover:bg-[#FCFAFF]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-[#6D28D9]">{alert.alert_number}</span><span className="rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-2 py-0.5 text-[10px] font-bold text-[#5B21B6]">{alert.status}</span><span className="text-[10px] font-bold uppercase text-[#6B7488]">{formatPublicStatus(alert.public_status)}</span></div><p className="mt-1 truncate font-semibold text-[#0E1726]">{alert.title || "Title not available"}</p><p className="mt-1 truncate text-xs text-[#6B7488]">{alert.affected_services.map((service) => service.name).join(", ") || "No affected service"} · Last public update {formatAlertDate(alert.latest_publication_at)}</p></div><ChevronRight className="h-5 w-5 shrink-0 text-[#8B5CF6]" /></Link></li>)}</ul> : null}
    </section>
  </div>;
}
