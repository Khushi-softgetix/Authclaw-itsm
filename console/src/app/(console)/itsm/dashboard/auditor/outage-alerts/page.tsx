"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BellRing, CalendarDays, ChevronLeft, ChevronRight, FilterX, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { alertApi, formatAlertDate, formatPublicStatus, type AlertEvidencePage, type AlertEvidenceSummary } from "@/lib/outage-alerts";

const PAGE_SIZE = 25;
type Filters = { query: string; status: string; severity: string; audience: string; delivery: string; actor: string; start: string; end: string };
const emptyFilters: Filters = { query: "", status: "", severity: "", audience: "", delivery: "", actor: "", start: "", end: "" };

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function evidenceTone(status: string) {
  if (status === "COMPLETE") return "border-[#B9DEC8] bg-[#F2FBF5] text-[#286044]";
  if (status === "INCOMPLETE") return "border-[#E7C7B8] bg-[#FFF8F4] text-[#8A472D]";
  return "border-[#DDD6FE] bg-[#F8F5FF] text-[#5B21B6]";
}

function deliveryLabel(alert: AlertEvidenceSummary) {
  if (!alert.publication_count) return "Not published";
  if (!alert.recipient_count) return "No resolved recipients";
  const failed = (alert.delivery_summary.FAILED || 0) + (alert.delivery_summary.PERMANENTLY_FAILED || 0);
  if (failed) return `${failed} failed`;
  const available = alert.delivery_summary.AVAILABLE || 0;
  return available ? `${available} available in app` : "Delivery pending";
}

export default function AuditorOutageEvidencePage() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState<AlertEvidencePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    const values = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
    if (applied.query.trim()) values.set("search", applied.query.trim());
    if (applied.status) values.set("status", applied.status);
    if (applied.severity) values.set("severity", applied.severity);
    if (applied.audience) values.set("audience", applied.audience);
    if (applied.delivery) values.set("delivery_status", applied.delivery);
    if (applied.actor.trim()) values.set("actor", applied.actor.trim());
    if (applied.start) values.set("start", new Date(`${applied.start}T00:00:00`).toISOString());
    if (applied.end) values.set("end", new Date(`${applied.end}T23:59:59.999`).toISOString());
    return values.toString();
  }, [applied, offset]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPage(await alertApi<AlertEvidencePage>(`/auditor-evidence?${params}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Outage evidence could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  function applyFilters() { setOffset(0); setApplied(filters); }
  function resetFilters() { setFilters(emptyFilters); setApplied(emptyFilters); setOffset(0); }

  const hasFilters = Object.values(applied).some(Boolean);
  const records = page?.items || [];

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#6D28D9]"><ShieldCheck className="h-4 w-4" /> Independent, read-only review</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#0E1726]">Outage &amp; Alert evidence</h1>
        <p className="mt-1 text-sm leading-6 text-[#6B7488]">Review what was published, who initiated it, its intended audience, delivery evidence and the tamper-evident event trail. Recipient identities and restricted operational notes are not exposed.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-[#DDD6FE] bg-white px-4 py-2.5 text-sm font-semibold text-[#5B21B6] hover:bg-[#F8F5FF] disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
    </header>

    <section className="rounded-2xl border border-[#E6E9F0] bg-white p-4 shadow-sm">
      <form onSubmit={(event) => { event.preventDefault(); applyFilters(); }} className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.5fr)_repeat(3,minmax(150px,1fr))]">
          <label className="relative"><span className="sr-only">Search outage evidence</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93A5]" /><input value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="Search alert, title or service" className="w-full rounded-xl border border-[#DCE1E8] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#6D28D9]/10" /></label>
          <Select selectLabel="Lifecycle state" value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} options={["DRAFT", "ACTIVE", "RECOVERED", "CANCELLED"]} />
          <Select selectLabel="Severity" value={filters.severity} onChange={(value) => setFilters((current) => ({ ...current, severity: value }))} options={["CRITICAL", "HIGH", "MEDIUM", "LOW"]} />
          <Select selectLabel="Audience" value={filters.audience} onChange={(value) => setFilters((current) => ({ ...current, audience: value }))} options={["SERVICE_USERS", "SERVICE_AGENTS", "SERVICE_OWNERS", "SELECTED_TEAM", "PROBLEM_MANAGERS", "CHANGE_MANAGERS", "SPECIFIC_USER"]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
          <Select selectLabel="Delivery outcome" value={filters.delivery} onChange={(value) => setFilters((current) => ({ ...current, delivery: value }))} options={["AVAILABLE", "QUEUED", "RETRYING", "FAILED", "PERMANENTLY_FAILED"]} />
          <label><span className="sr-only">Publisher or creator</span><input aria-label="Publisher or creator" value={filters.actor} onChange={(event) => setFilters((current) => ({ ...current, actor: event.target.value }))} placeholder="Creator or publisher" className="w-full rounded-xl border border-[#DCE1E8] px-3 py-2.5 text-sm outline-none focus:border-[#8B5CF6]" /></label>
          <DateFilter dateLabel="From date" value={filters.start} onChange={(value) => setFilters((current) => ({ ...current, start: value }))} />
          <DateFilter dateLabel="To date" value={filters.end} onChange={(value) => setFilters((current) => ({ ...current, end: value }))} />
          <button type="submit" className="rounded-xl bg-[#6D28D9] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B21B6]">Apply filters</button>
          <button type="button" onClick={resetFilters} disabled={!hasFilters && !Object.values(filters).some(Boolean)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#DCE1E8] bg-white px-4 py-2.5 text-sm font-semibold text-[#475069] hover:bg-[#F7F8FA] disabled:opacity-45"><FilterX className="h-4 w-4" /> Reset</button>
        </div>
      </form>
    </section>

    {error ? <div role="alert" className="rounded-xl border border-[#E7D9CF] bg-[#FFF9F5] p-4 text-sm text-[#704C3B]">{error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button></div> : null}

    <section className="overflow-hidden rounded-2xl border border-[#E6E9F0] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEF1F5] px-5 py-4">
        <div><h2 className="font-semibold text-[#0E1726]">Broadcast evidence</h2><p className="mt-0.5 text-xs text-[#6B7488]">{page ? `${page.total} matching record${page.total === 1 ? "" : "s"}` : "Loading records"}</p></div>
        {hasFilters ? <span className="rounded-full bg-[#F1ECFE] px-3 py-1 text-xs font-semibold text-[#5B21B6]">Filtered view</span> : null}
      </div>
      {loading ? <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-xl bg-[#F3F4F6]" />)}</div> : null}
      {!loading && !records.length ? <div className="px-5 py-16 text-center"><BellRing className="mx-auto h-7 w-7 text-[#8B5CF6]" /><p className="mt-3 font-semibold text-[#0E1726]">No matching alert evidence</p><p className="mt-1 text-sm text-[#6B7488]">No records match the current authorized scope and filters.</p>{hasFilters ? <button type="button" onClick={resetFilters} className="mt-4 text-sm font-semibold text-[#5B21B6]">Clear filters</button> : null}</div> : null}
      {!loading ? <ul className="divide-y divide-[#EEF1F5]">{records.map((alert) => <EvidenceRow key={alert.id} alert={alert} />)}</ul> : null}
      {page && page.total > PAGE_SIZE ? <div className="flex items-center justify-between border-t border-[#EEF1F5] px-5 py-4"><p className="text-xs text-[#6B7488]">Showing {page.offset + 1}–{Math.min(page.offset + page.items.length, page.total)} of {page.total}</p><div className="flex gap-2"><button type="button" onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))} disabled={page.offset === 0 || loading} className="inline-flex items-center gap-1 rounded-lg border border-[#DCE1E8] px-3 py-2 text-xs font-semibold disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button><button type="button" onClick={() => setOffset((current) => current + PAGE_SIZE)} disabled={!page.has_more || loading} className="inline-flex items-center gap-1 rounded-lg border border-[#DCE1E8] px-3 py-2 text-xs font-semibold disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button></div></div> : null}
    </section>
  </div>;
}

function EvidenceRow({ alert }: { alert: AlertEvidenceSummary }) {
  return <li><Link href={`/itsm/outage-alerts/${alert.id}`} className="group block p-5 transition hover:bg-[#FCFAFF]"><div className="flex items-start justify-between gap-5"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-[#6D28D9]">{alert.alert_number}</span><span className="rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-2 py-0.5 text-[10px] font-bold text-[#5B21B6]">{alert.status}</span><span className="rounded-full border border-[#E6E9F0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#475069]">{alert.severity || "Severity unavailable"}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${evidenceTone(alert.evidence_status)}`}>{label(alert.evidence_status)}</span></div><h3 className="mt-2 truncate text-base font-semibold text-[#0E1726]">{alert.title || "Title not available"}</h3><p className="mt-1 truncate text-xs text-[#6B7488]">{alert.affected_services.map((service) => service.name).join(", ") || "No affected service"} · {formatPublicStatus(alert.public_status)}</p></div><ChevronRight className="mt-1 h-5 w-5 shrink-0 text-[#8B5CF6] transition group-hover:translate-x-0.5" /></div><div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><EvidenceFact factLabel="Created" value={`${formatAlertDate(alert.created_at)} · ${alert.created_by_display || alert.created_by_id}`} /><EvidenceFact factLabel="Latest publication" value={alert.latest_publication_at ? `${formatAlertDate(alert.latest_publication_at)} · ${alert.published_by_display || alert.published_by_id || "Actor unavailable"}` : "Not published"} /><EvidenceFact factLabel="Audience" value={alert.intended_audiences.length ? alert.intended_audiences.map(label).join(", ") : "Not configured"} /><EvidenceFact factLabel="Outcome" value={`${label(alert.broadcast_outcome)} · ${deliveryLabel(alert)}`} /></div></Link></li>;
}

function EvidenceFact({ factLabel, value }: { factLabel: string; value: string }) {
  return <div className="min-w-0"><p className="font-semibold uppercase tracking-wide text-[#8A93A5]">{factLabel}</p><p className="mt-1 truncate font-medium text-[#354052]" title={value}>{value}</p></div>;
}

function Select({ selectLabel, value, onChange, options }: { selectLabel: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label><span className="sr-only">{selectLabel}</span><select aria-label={selectLabel} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-[#DCE1E8] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#8B5CF6]"><option value="">All {selectLabel.toLowerCase()}s</option>{options.map((option) => <option key={option} value={option}>{label(option)}</option>)}</select></label>;
}

function DateFilter({ dateLabel, value, onChange }: { dateLabel: string; value: string; onChange: (value: string) => void }) {
  return <label className="relative"><span className="sr-only">{dateLabel}</span><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93A5]" /><input aria-label={dateLabel} type="date" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-[#DCE1E8] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#8B5CF6]" /></label>;
}
