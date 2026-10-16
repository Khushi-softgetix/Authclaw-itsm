"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, BarChart3, CalendarDays, ChevronRight, Clock3, Filter, RefreshCw, ShieldCheck, TimerReset } from "lucide-react";
import type { IncidentOperationsReferenceData, MetricSnapshot, MetricSnapshotList, OperationalKPIDashboard, OperationalKPIIncidentRecord } from "@/lib/itsm-types";

type DrilldownKey = "mtta" | "mttr" | "sla_response" | "sla_resolution" | "backlog";
type HistoryGrain = "DAILY" | "WEEKLY" | "MONTHLY";

const priorities = ["", "P1", "P2", "P3", "P4"];
const statuses = ["", "NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED", "CANCELLED"];
const reportingPeriods = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function duration(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "No qualifying data";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function timestamp(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function rate(value?: number | null) {
  return value == null ? "Not yet measurable" : `${value.toFixed(1)}%`;
}

function bucketLabel(bucket?: string | null) {
  return ({ under_24h: "Under 24 hours", days_1_to_7: "1–7 days", days_8_to_30: "8–30 days", over_30d: "Over 30 days" } as Record<string, string>)[bucket || ""] || "—";
}

export default function IncidentManagerKPIPage() {
  const [periodDays, setPeriodDays] = useState("30");
  const [serviceId, setServiceId] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [dashboard, setDashboard] = useState<OperationalKPIDashboard | null>(null);
  const [references, setReferences] = useState<IncidentOperationsReferenceData | null>(null);
  const [selected, setSelected] = useState<DrilldownKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyGrain, setHistoryGrain] = useState<HistoryGrain>("DAILY");
  const [snapshots, setSnapshots] = useState<MetricSnapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const end = new Date();
    const start = new Date(end.getTime() - Number(periodDays) * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({ start_time: start.toISOString(), end_time: end.toISOString() });
    if (serviceId) params.set("service_id", serviceId);
    if (priority) params.set("priority", priority);
    if (status) params.set("status", status);
    try {
      const [kpiResponse, referenceResponse] = await Promise.all([
        fetch(`/api/itsm/analytics/kpis/operational-dashboard?${params}`, { cache: "no-store" }),
        fetch("/api/itsm/incidents/operations/reference-data", { cache: "no-store" }),
      ]);
      if (kpiResponse.status === 401) {
        window.location.assign("/itsm/login?next=%2Fitsm%2Fincident-manager%2Fkpis");
        return;
      }
      if (kpiResponse.status === 403) throw new Error("Your Incident Manager access is required to view operational KPIs.");
      if (!kpiResponse.ok) throw new Error("Operational KPIs are temporarily unavailable.");
      setDashboard(await kpiResponse.json());
      if (referenceResponse.ok) setReferences(await referenceResponse.json());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Operational KPIs are temporarily unavailable.");
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [periodDays, priority, serviceId, status]);

  // Loading is an external API synchronization triggered by the selected reporting scope.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const response = await fetch(`/api/itsm/analytics/kpis/snapshots?period_grain=${historyGrain}&limit=240`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Historical KPI snapshots are temporarily unavailable.");
        const payload = await response.json() as MetricSnapshotList;
        setSnapshots(payload.items);
      } catch (reason: unknown) {
        if (controller.signal.aborted) return;
        setSnapshots([]);
        setHistoryError(reason instanceof Error ? reason.message : "Historical KPI snapshots are temporarily unavailable.");
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [historyGrain]);

  const records = useMemo<OperationalKPIIncidentRecord[]>(() => selected && dashboard ? dashboard.drilldowns[selected] || [] : [], [dashboard, selected]);
  const selectedTitle = ({ mtta: "MTTA qualifying incidents", mttr: "MTTR qualifying incidents", sla_response: "Response SLA commitments", sla_resolution: "Resolution SLA commitments", backlog: "Current active backlog" } as Record<DrilldownKey, string>)[selected || "mtta"];
  const distribution = dashboard?.backlog_age.distribution || {};
  const olderThanSeven = (distribution.days_8_to_30 || 0) + (distribution.over_30d || 0);
  const currentPeriod = dashboard ? `${timestamp(dashboard.date_range.start_time)} – ${timestamp(dashboard.date_range.end_time)}` : "Loading reporting period…";

  const queueHref = (() => {
    const params = new URLSearchParams();
    if (serviceId) params.set("service_id", serviceId);
    if (priority) params.set("priority", priority);
    if (status) params.set("status", status);
    const value = params.toString();
    return `/itsm/incident-manager/incidents${value ? `?${value}` : ""}`;
  })();

  return (
    <div className="role-portal mx-auto max-w-[1440px] space-y-6">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[#6D28D9]">Operational intelligence</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[#0E1726]">Operational KPIs</h1>
          <p className="mt-1 max-w-3xl text-sm text-[#667085]">Track acknowledgement speed, resolution performance, SLA outcomes, and the age of unresolved work.</p>
        </div>
        <Link href={queueHref} className="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] shadow-sm transition hover:border-[#C4B5FD] hover:bg-[#FAFAFF] hover:text-[#5B21B6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2">
          Open incident queue <ChevronRight className="h-4 w-4" />
        </Link>
      </header>

      <section className="overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]" aria-labelledby="reporting-scope-heading">
        <div className="flex flex-col gap-3 border-b border-[#EAECF0] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><Filter className="h-4 w-4 text-[#6941C6]" /><h2 id="reporting-scope-heading" className="text-base font-bold text-[#101828]">Reporting scope</h2></div>
            <p className="mt-1 text-xs text-[#667085]">Filters apply automatically to every metric and qualifying record below.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] shadow-sm transition hover:border-[#C4B5FD] hover:bg-[#FAFAFF] hover:text-[#5B21B6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 text-[#6D28D9] ${loading ? "animate-spin" : ""}`} />Refresh data</button>
        </div>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Reporting period"><select value={periodDays} onChange={(event) => setPeriodDays(event.target.value)} className="block w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm font-medium text-[#101828] shadow-sm transition focus:border-[#7C3AED] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20">{reportingPeriods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}</select></FilterField>
          <FilterField label="Service"><select value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="block w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm font-medium text-[#101828] shadow-sm transition focus:border-[#7C3AED] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20"><option value="">All services</option>{(references?.services || []).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></FilterField>
          <FilterField label="Priority"><select value={priority} onChange={(event) => setPriority(event.target.value)} className="block w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm font-medium text-[#101828] shadow-sm transition focus:border-[#7C3AED] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20">{priorities.map((value) => <option key={value} value={value}>{value || "All priorities"}</option>)}</select></FilterField>
          <FilterField label="Incident status"><select value={status} onChange={(event) => setStatus(event.target.value)} className="block w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-sm font-medium text-[#101828] shadow-sm transition focus:border-[#7C3AED] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20">{statuses.map((value) => <option key={value} value={value}>{value ? value.replaceAll("_", " ") : "All statuses"}</option>)}</select></FilterField>
        </div>
        <div className="flex items-start gap-2 border-t border-[#EAECF0] bg-[#FAFAFF] px-5 py-3 text-xs leading-5 text-[#667085]"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6941C6]" /><p><span className="font-semibold text-[#475467]">{currentPeriod}</span><span className="mx-2 text-[#D0D5DD]">•</span>Backlog aging is an active, as-of-end-time view; it is not filtered down to incidents created during the reporting period.</p></div>
      </section>

      {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />{error}</div>}
      {loading && !dashboard ? <KpiLoadingState /> : null}

      {dashboard ? <>
        <section aria-labelledby="performance-snapshot-heading">
          <div className="mb-3">
            <h2 id="performance-snapshot-heading" className="text-base font-bold text-[#101828]">Performance snapshot</h2>
            <p className="mt-1 text-xs text-[#667085]">Select a KPI to inspect the incidents and commitments behind the result.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={<TimerReset className="h-5 w-5" />} title="MTTA" definition="Average time to acknowledge" value={duration(dashboard.mtta.mean_seconds)} detail={`${dashboard.mtta.count} acknowledged · ${dashboard.mtta.unacknowledged_count} not yet acknowledged`} onClick={() => setSelected("mtta")} active={selected === "mtta"} />
            <MetricCard icon={<Clock3 className="h-5 w-5" />} title="MTTR" definition="Average time to resolve" value={duration(dashboard.mttr.mean_seconds)} detail={`${dashboard.mttr.count} resolved incidents`} onClick={() => setSelected("mttr")} active={selected === "mttr"} />
            <MetricCard icon={<ShieldCheck className="h-5 w-5" />} title="SLA adherence" definition="Completed commitments met" value={rate(dashboard.sla_resolution.compliance_rate_pct)} detail={`Response ${rate(dashboard.sla_response.compliance_rate_pct)} · Resolution ${dashboard.sla_resolution.met_count}/${dashboard.sla_resolution.evaluated_count} evaluated`} onClick={() => setSelected("sla_resolution")} active={selected === "sla_response" || selected === "sla_resolution"} />
            <MetricCard icon={<BarChart3 className="h-5 w-5" />} title="Backlog aging" definition="Currently unresolved incidents" value={`${dashboard.backlog_age.total_open} active`} detail={`${olderThanSeven} older than 7 days · ${distribution.over_30d || 0} older than 30 days`} onClick={() => setSelected("backlog")} active={selected === "backlog"} />
          </div>
        </section>

        <section aria-labelledby="operational-breakdown-heading">
          <div className="mb-3">
            <h2 id="operational-breakdown-heading" className="text-base font-bold text-[#101828]">Operational breakdown</h2>
            <p className="mt-1 text-xs text-[#667085]">Understand where unresolved work is accumulating and how SLA commitments are performing.</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
            <BacklogDistribution distribution={distribution} total={dashboard.backlog_age.total_open} />
            <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
              <h3 className="text-sm font-bold text-[#101828]">SLA outcomes</h3>
              <p className="mt-1 text-xs leading-5 text-[#667085]">Only completed commitments contribute to adherence. Pending work is shown separately.</p>
              <div className="mt-4 space-y-3">
                <SlaRow label="Response" data={dashboard.sla_response} onClick={() => setSelected("sla_response")} selected={selected === "sla_response"} />
                <SlaRow label="Resolution" data={dashboard.sla_resolution} onClick={() => setSelected("sla_resolution")} selected={selected === "sla_resolution"} />
              </div>
            </div>
          </div>
        </section>

        <HistoricalSnapshots
          grain={historyGrain}
          onGrainChange={setHistoryGrain}
          snapshots={snapshots}
          loading={historyLoading}
          error={historyError}
        />

        {selected ? <section id="kpi-drilldown" aria-live="polite" className="overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <div className="flex flex-col gap-3 border-b border-[#EAECF0] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-bold text-[#101828]">{selectedTitle}</h2><p className="mt-1 text-xs text-[#667085]">Showing up to {dashboard.drilldown_limit} source incidents used by this calculation.</p></div><button type="button" onClick={() => setSelected(null)} className="w-fit text-xs font-semibold text-[#6941C6] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2">Close drill-down</button></div>
          <DrilldownTable records={records} selected={selected} />
        </section> : <div className="flex items-center gap-3 rounded-xl border border-dashed border-[#D8DDE6] bg-white px-4 py-3 text-xs text-[#667085]"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F4F0FF] text-[#6D28D9]"><BarChart3 className="h-4 w-4" /></span><p><span className="font-semibold text-[#344054]">Need the underlying records?</span> Select any KPI or SLA outcome to open its drill-down.</p></div>}
      </> : null}
    </div>
  );
}

function snapshotValue(snapshot: MetricSnapshot) {
  const value = snapshot.value;
  if (snapshot.metric_key === "MTTA" || snapshot.metric_key === "MTTR") {
    return duration(typeof value.mean_seconds === "number" ? value.mean_seconds : null);
  }
  if (snapshot.metric_key === "SLA_PERFORMANCE") {
    return rate(typeof value.compliance_rate_pct === "number" ? value.compliance_rate_pct : null);
  }
  if (snapshot.metric_key === "BACKLOG_AGE") {
    return `${typeof value.total_open === "number" ? value.total_open : 0} active`;
  }
  return "Recorded";
}

function expectedGap(previous: MetricSnapshot, next: MetricSnapshot, grain: HistoryGrain) {
  const previousEnd = new Date(previous.period_end);
  const nextStart = new Date(next.period_start);
  if (grain === "MONTHLY") {
    return previousEnd.getUTCFullYear() !== nextStart.getUTCFullYear() || previousEnd.getUTCMonth() !== nextStart.getUTCMonth();
  }
  return Math.abs(nextStart.getTime() - previousEnd.getTime()) > 60_000;
}

function HistoricalSnapshots({ grain, onGrainChange, snapshots, loading, error }: {
  grain: HistoryGrain;
  onGrainChange: (grain: HistoryGrain) => void;
  snapshots: MetricSnapshot[];
  loading: boolean;
  error: string | null;
}) {
  const relevant = snapshots.filter((item) => ["MTTA", "MTTR", "SLA_PERFORMANCE", "BACKLOG_AGE"].includes(item.metric_key));
  const periods = Array.from(new Set(relevant.map((item) => item.period_start)))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
    .slice(0, 6);
  const representative = periods.map((period) => relevant.find((item) => item.period_start === period)).filter(Boolean) as MetricSnapshot[];
  const chronological = [...representative].sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());
  const hasGap = chronological.some((item, index) => index > 0 && expectedGap(chronological[index - 1], item, grain));

  return <section aria-labelledby="historical-kpi-heading" className="overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]">
    <div className="flex flex-col gap-3 border-b border-[#EAECF0] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 id="historical-kpi-heading" className="text-base font-bold text-[#101828]">Historical KPI snapshots</h2><p className="mt-1 text-xs text-[#667085]">Persisted tenant-wide results remain unchanged after later incident or change edits.</p></div>
      <div className="inline-flex w-fit rounded-lg bg-[#F2F4F7] p-1" aria-label="Historical reporting interval">
        {(["DAILY", "WEEKLY", "MONTHLY"] as HistoryGrain[]).map((item) => <button key={item} type="button" onClick={() => onGrainChange(item)} aria-pressed={grain === item} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${grain === item ? "bg-white text-[#5B21B6] shadow-sm" : "text-[#667085] hover:text-[#344054]"}`}>{item[0]}{item.slice(1).toLowerCase()}</button>)}
      </div>
    </div>
    {loading ? <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-xl bg-[#F2F4F7]" />)}</div> : null}
    {!loading && error ? <div role="alert" className="m-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
    {!loading && !error && periods.length === 0 ? <div className="px-5 py-10 text-center"><p className="text-sm font-semibold text-[#344054]">No completed historical snapshots yet.</p><p className="mt-1 text-xs text-[#667085]">The background worker will fill eligible completed periods and recover missed runs.</p></div> : null}
    {!loading && !error && periods.length > 0 ? <>
      {hasGap ? <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />One or more completed periods are missing. Catch-up generation is pending or requires attention.</div> : null}
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#F8F9FB] text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr><th className="px-5 py-3">Completed period</th><th className="px-5 py-3">MTTA</th><th className="px-5 py-3">MTTR</th><th className="px-5 py-3">SLA</th><th className="px-5 py-3">Backlog</th><th className="px-5 py-3">Definition</th></tr></thead><tbody className="divide-y divide-[#EAECF0]">{periods.map((period) => {
        const rows = relevant.filter((item) => item.period_start === period);
        const byKey = Object.fromEntries(rows.map((item) => [item.metric_key, item]));
        const reference = rows[0];
        return <tr key={period}><td className="px-5 py-3"><p className="font-semibold text-[#101828]">{new Date(reference.period_start).toLocaleDateString()} {" – "} {new Date(reference.period_end).toLocaleDateString()}</p><p className="mt-0.5 text-xs text-[#667085]">{reference.dimensions.reporting_timezone || "UTC"}</p></td>{["MTTA", "MTTR", "SLA_PERFORMANCE", "BACKLOG_AGE"].map((key) => <td key={key} className="px-5 py-3 font-semibold text-[#344054]">{byKey[key] ? snapshotValue(byKey[key]) : <span className="text-amber-700">Missing</span>}</td>)}<td className="px-5 py-3 text-xs text-[#667085]">{reference.definition_version}</td></tr>;
      })}</tbody></table></div>
    </> : null}
  </section>;
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs font-semibold text-[#475467]"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function KpiLoadingState() {
  return <div className="space-y-5" aria-label="Loading tenant-scoped operational KPIs">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-48 animate-pulse rounded-2xl border border-[#E4E7EC] bg-white" />)}</div>
    <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]"><div className="h-64 animate-pulse rounded-2xl border border-[#E4E7EC] bg-white" /><div className="h-64 animate-pulse rounded-2xl border border-[#E4E7EC] bg-white" /></div>
  </div>;
}

function MetricCard({ icon, title, definition, value, detail, onClick, active }: { icon: React.ReactNode; title: string; definition: string; value: string; detail: string; onClick: () => void; active: boolean }) {
  return <button type="button" onClick={onClick} aria-pressed={active} aria-controls="kpi-drilldown" className={`group flex min-h-48 flex-col rounded-2xl border bg-white p-5 text-left shadow-[0_1px_2px_rgba(16,24,40,.04)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 ${active ? "border-[#7C3AED] bg-[#FCFAFF] shadow-[0_0_0_2px_rgba(124,58,237,.1)]" : "border-[#E4E7EC] hover:border-[#C4B5FD] hover:bg-[#FCFAFF]"}`}>
    <span className="flex items-start justify-between gap-3"><span><span className="block text-sm font-bold text-[#101828]">{title}</span><span className="mt-1 block text-xs leading-4 text-[#667085]">{definition}</span></span><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F4F0FF] text-[#6D28D9]">{icon}</span></span>
    <span className="mt-5 block text-2xl font-extrabold tracking-tight text-[#0E1726]">{value}</span>
    <span className="mt-2 block min-h-8 text-xs leading-4 text-[#667085]">{detail}</span>
    <span className={`mt-auto inline-flex items-center gap-1 pt-4 text-xs font-semibold ${active ? "text-[#5B21B6]" : "text-[#6941C6]"}`}>{active ? "Showing qualifying records" : "View qualifying records"}<ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
  </button>;
}

function BacklogDistribution({ distribution, total }: { distribution: Record<string, number>; total: number }) {
  const buckets = [
    { key: "under_24h", label: "Under 24h", color: "bg-[#A78BFA]" },
    { key: "days_1_to_7", label: "1–7 days", color: "bg-[#7C3AED]" },
    { key: "days_8_to_30", label: "8–30 days", color: "bg-[#F59E0B]" },
    { key: "over_30d", label: "30+ days", color: "bg-[#E11D48]" },
  ];
  return <div className="rounded-2xl border border-[#E4E7EC] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
    <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-bold text-[#101828]">Active backlog by age</h3><p className="mt-1 text-xs leading-5 text-[#667085]">Every unresolved incident appears in exactly one age bucket.</p></div><div className="text-right"><p className="text-2xl font-extrabold text-[#0E1726]">{total}</p><p className="text-[11px] font-semibold text-[#667085]">active incidents</p></div></div>
    <div role="img" aria-label={buckets.map((bucket) => `${bucket.label}: ${distribution[bucket.key] || 0}`).join(", ")} className="mt-5 flex h-3 overflow-hidden rounded-full bg-[#EEF1F5]">{total > 0 ? buckets.map((bucket) => <span key={bucket.key} className={bucket.color} style={{ width: `${((distribution[bucket.key] || 0) / total) * 100}%` }} />) : null}</div>
    <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">{buckets.map((bucket) => <div key={bucket.key}><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${bucket.color}`} /><span className="text-xs font-medium text-[#667085]">{bucket.label}</span></div><p className="mt-1 pl-[18px] text-lg font-bold text-[#101828]">{distribution[bucket.key] || 0}</p></div>)}</div>
  </div>;
}

function SlaRow({ label, data, onClick, selected }: { label: string; data: OperationalKPIDashboard["sla_response"]; onClick: () => void; selected: boolean }) {
  const progress = data.compliance_rate_pct == null ? 0 : Math.max(0, Math.min(100, data.compliance_rate_pct));
  return <button type="button" onClick={onClick} aria-pressed={selected} aria-controls="kpi-drilldown" className={`w-full rounded-xl border p-3.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 ${selected ? "border-[#7C3AED] bg-[#F9F7FF]" : "border-[#E4E7EC] hover:border-[#C4B5FD]"}`}>
    <span className="flex items-start justify-between gap-4"><span><span className="block text-sm font-bold text-[#101828]">{label}</span><span className="mt-1 block text-xs text-[#667085]">{data.met_count} met · {data.breached_count} breached · {data.pending_count} pending</span></span><span className="shrink-0 text-sm font-bold text-[#5B21B6]">{rate(data.compliance_rate_pct)}</span></span>
    <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[#EEF1F5]"><span className="block h-full rounded-full bg-[#7C3AED]" style={{ width: `${progress}%` }} /></span>
  </button>;
}

function DrilldownTable({ records, selected }: { records: OperationalKPIIncidentRecord[]; selected: DrilldownKey }) {
  if (!records.length) return <div className="p-8 text-center text-sm text-[#6B7488]">No qualifying incidents are available for this selection.</div>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#F8F9FB] text-xs font-semibold uppercase tracking-wide text-[#6B7488]"><tr><th className="px-5 py-3">Incident</th><th className="px-5 py-3">Priority</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Measure</th><th className="px-5 py-3">Outcome</th></tr></thead><tbody className="divide-y divide-[#EEF0F4]">{records.map((record) => <tr key={record.id} className="text-[#475069]"><td className="px-5 py-3"><p className="font-semibold text-[#0E1726]">{record.ticket_number}</p><p className="max-w-md truncate text-xs text-[#6B7488]">{record.title}</p></td><td className="px-5 py-3">{record.priority}</td><td className="px-5 py-3">{record.status}</td><td className="px-5 py-3">{selected === "backlog" ? `${duration(record.duration_seconds)} · ${bucketLabel(record.age_bucket)}` : selected.startsWith("sla_") ? timestamp(record.measured_at) : duration(record.duration_seconds)}</td><td className="px-5 py-3 font-medium text-[#0E1726]">{record.sla_outcome || "Qualified"}</td></tr>)}</tbody></table></div>;
}
