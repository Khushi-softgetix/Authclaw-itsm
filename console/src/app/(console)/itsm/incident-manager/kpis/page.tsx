"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, BarChart3, CheckCircle2, ChevronRight, Clock3, RefreshCw, ShieldCheck, TimerReset } from "lucide-react";
import type { IncidentOperationsReferenceData, OperationalKPIDashboard, OperationalKPIIncidentRecord } from "@/lib/itsm-types";

type DrilldownKey = "mtta" | "mttr" | "sla_response" | "sla_resolution" | "backlog";

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

  useEffect(() => { void load(); }, [load]);

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
    <div className="mx-auto max-w-[1500px] space-y-6">
      <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6D28D9]">Operational intelligence</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0E1726] sm:text-3xl">Incident Manager KPI Dashboard</h1>
          <p className="mt-2 max-w-3xl text-sm text-[#6B7488]">Authoritative incident performance metrics. All calculations and qualifying records are scoped to your tenant on the server.</p>
        </div>
        <Link href={queueHref} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-sm font-semibold text-[#6D28D9] transition hover:bg-[#F4F0FF]">
          Open incident queue <ChevronRight className="h-4 w-4" />
        </Link>
      </section>

      <section className="rounded-2xl border border-[#E6E9F0] bg-white p-4 shadow-[0_1px_2px_rgba(11,31,63,.05)]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-semibold text-[#475069]">Reporting period
            <select value={periodDays} onChange={(event) => setPeriodDays(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-sm font-medium text-[#0E1726]">
              {reportingPeriods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#475069]">Service
            <select value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-sm font-medium text-[#0E1726]">
              <option value="">All services</option>
              {(references?.services || []).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#475069]">Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-sm font-medium text-[#0E1726]">
              {priorities.map((value) => <option key={value} value={value}>{value || "All priorities"}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-[#475069]">Incident status
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-sm font-medium text-[#0E1726]">
              {statuses.map((value) => <option key={value} value={value}>{value || "All statuses"}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void load()} disabled={loading} className="self-end inline-flex items-center justify-center gap-2 rounded-lg bg-[#6D28D9] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
        <p className="mt-3 text-xs text-[#6B7488]"><span className="font-semibold text-[#475069]">Reporting period:</span> {currentPeriod}. Backlog aging is an active, as-of-end-time view; it is not filtered down to incidents created during the reporting period.</p>
      </section>

      {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />{error}</div>}
      {loading && !dashboard && <div className="rounded-2xl border border-[#E6E9F0] bg-white p-10 text-center text-sm text-[#6B7488]">Loading tenant-scoped operational KPIs…</div>}

      {dashboard && <>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<TimerReset className="h-5 w-5" />} title="MTTA" value={duration(dashboard.mtta.mean_seconds)} detail={`${dashboard.mtta.count} acknowledged · ${dashboard.mtta.unacknowledged_count} not yet acknowledged`} onClick={() => setSelected("mtta")} active={selected === "mtta"} />
          <MetricCard icon={<Clock3 className="h-5 w-5" />} title="MTTR" value={duration(dashboard.mttr.mean_seconds)} detail={`${dashboard.mttr.count} resolved incidents`} onClick={() => setSelected("mttr")} active={selected === "mttr"} />
          <MetricCard icon={<ShieldCheck className="h-5 w-5" />} title="SLA adherence" value={rate(dashboard.sla_resolution.compliance_rate_pct)} detail={`Response ${rate(dashboard.sla_response.compliance_rate_pct)} · Resolution ${dashboard.sla_resolution.met_count}/${dashboard.sla_resolution.evaluated_count} evaluated`} onClick={() => setSelected("sla_resolution")} active={selected === "sla_response" || selected === "sla_resolution"} />
          <MetricCard icon={<BarChart3 className="h-5 w-5" />} title="Backlog aging" value={`${dashboard.backlog_age.total_open} active`} detail={`${olderThanSeven} older than 7 days · ${distribution.over_30d || 0} older than 30 days`} onClick={() => setSelected("backlog")} active={selected === "backlog"} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <div className="rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-[0_1px_2px_rgba(11,31,63,.05)]">
            <h2 className="text-base font-bold text-[#0E1726]">Current backlog age distribution</h2>
            <p className="mt-1 text-xs text-[#6B7488]">Every unresolved incident belongs to exactly one established operational bucket.</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["under_24h", "Under 24h"], ["days_1_to_7", "1–7 days"], ["days_8_to_30", "8–30 days"], ["over_30d", "30+ days"]].map(([key, label]) => <div key={key} className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-3"><p className="text-xs font-medium text-[#6B7488]">{label}</p><p className="mt-1 text-xl font-bold text-[#0E1726]">{distribution[key] || 0}</p></div>)}
            </div>
          </div>
          <div className="rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-[0_1px_2px_rgba(11,31,63,.05)]">
            <h2 className="text-base font-bold text-[#0E1726]">SLA evaluation detail</h2>
            <p className="mt-1 text-xs text-[#6B7488]">Pending commitments are not reported as met. A rate appears only after an outcome is evaluable.</p>
            <div className="mt-4 space-y-3">
              <SlaRow label="Response" data={dashboard.sla_response} onClick={() => setSelected("sla_response")} selected={selected === "sla_response"} />
              <SlaRow label="Resolution" data={dashboard.sla_resolution} onClick={() => setSelected("sla_resolution")} selected={selected === "sla_resolution"} />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)]">
          <div className="flex flex-col gap-1 border-b border-[#E6E9F0] p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-bold text-[#0E1726]">{selected ? selectedTitle : "KPI drill-down"}</h2><p className="mt-1 text-xs text-[#6B7488]">{selected ? `Showing up to ${dashboard.drilldown_limit} source incidents used by this calculation.` : "Select a KPI card to review the exact incidents behind it."}</p></div>{selected && <button type="button" onClick={() => setSelected(null)} className="text-sm font-semibold text-[#6D28D9] hover:text-[#5B21B6]">Close drill-down</button>}</div>
          {selected ? <DrilldownTable records={records} selected={selected} /> : <div className="p-8 text-center text-sm text-[#6B7488]">Select MTTA, MTTR, SLA adherence, or Backlog aging above.</div>}
        </section>
      </>}
    </div>
  );
}

function MetricCard({ icon, title, value, detail, onClick, active }: { icon: React.ReactNode; title: string; value: string; detail: string; onClick: () => void; active: boolean }) {
  return <button type="button" onClick={onClick} className={`rounded-2xl border bg-white p-5 text-left shadow-[0_1px_2px_rgba(11,31,63,.05)] transition hover:border-[#A78BFA] ${active ? "border-[#6D28D9] ring-2 ring-[#EDE9FE]" : "border-[#E6E9F0]"}`}><div className="flex items-center justify-between"><span className="font-semibold text-[#475069]">{title}</span><span className="rounded-lg bg-[#F4F0FF] p-2 text-[#6D28D9]">{icon}</span></div><p className="mt-5 text-2xl font-bold tracking-tight text-[#0E1726]">{value}</p><p className="mt-2 min-h-9 text-xs leading-4 text-[#6B7488]">{detail}</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#6D28D9]">View qualifying incidents <ChevronRight className="h-3.5 w-3.5" /></span></button>;
}

function SlaRow({ label, data, onClick, selected }: { label: string; data: OperationalKPIDashboard["sla_response"]; onClick: () => void; selected: boolean }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition hover:border-[#A78BFA] ${selected ? "border-[#6D28D9] bg-[#F9F7FF]" : "border-[#E6E9F0]"}`}><span><span className="block text-sm font-semibold text-[#0E1726]">{label}</span><span className="mt-0.5 block text-xs text-[#6B7488]">{data.met_count} met · {data.breached_count} breached · {data.pending_count} pending</span></span><span className="text-sm font-bold text-[#6D28D9]">{rate(data.compliance_rate_pct)}</span></button>;
}

function DrilldownTable({ records, selected }: { records: OperationalKPIIncidentRecord[]; selected: DrilldownKey }) {
  if (!records.length) return <div className="p-8 text-center text-sm text-[#6B7488]">No qualifying incidents are available for this selection.</div>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#F8F9FB] text-xs font-semibold uppercase tracking-wide text-[#6B7488]"><tr><th className="px-5 py-3">Incident</th><th className="px-5 py-3">Priority</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Measure</th><th className="px-5 py-3">Outcome</th></tr></thead><tbody className="divide-y divide-[#EEF0F4]">{records.map((record) => <tr key={record.id} className="text-[#475069]"><td className="px-5 py-3"><p className="font-semibold text-[#0E1726]">{record.ticket_number}</p><p className="max-w-md truncate text-xs text-[#6B7488]">{record.title}</p></td><td className="px-5 py-3">{record.priority}</td><td className="px-5 py-3">{record.status}</td><td className="px-5 py-3">{selected === "backlog" ? `${duration(record.duration_seconds)} · ${bucketLabel(record.age_bucket)}` : selected.startsWith("sla_") ? timestamp(record.measured_at) : duration(record.duration_seconds)}</td><td className="px-5 py-3 font-medium text-[#0E1726]">{record.sla_outcome || "Qualified"}</td></tr>)}</tbody></table></div>;
}
