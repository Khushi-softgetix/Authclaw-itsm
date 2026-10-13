"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Clock3, Flame,
  Gauge, Info, Radio, RefreshCw, ShieldAlert, TimerOff, UserRound, UsersRound,
} from "lucide-react";
import IncidentOversightDrawer from "@/components/itsm/incident-oversight-drawer";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import type { IncidentOperationsDashboard, IncidentOperationsItem, IncidentWorkloadEntry } from "@/lib/itsm-types";

type AttentionView = "all" | "priority" | "risk" | "breached" | "stuck";
const ATTENTION_PREVIEW_LIMIT = 8;
const WORKLOAD_PREVIEW_LIMIT = 5;

const emptyAttentionCopy: Record<AttentionView, { title: string; description: string }> = {
  all: {
    title: "No incidents require attention",
    description: "The active queue has no priority, SLA, or inactivity signals that need review.",
  },
  priority: {
    title: "No high-priority incidents",
    description: "There are no active P1 or P2 incidents in this workspace.",
  },
  risk: {
    title: "No incidents are at risk",
    description: "No active incident is currently inside the SLA risk threshold.",
  },
  breached: {
    title: "No SLA breaches",
    description: "No active incident has passed its SLA target.",
  },
  stuck: {
    title: "No stuck incidents",
    description: "Every active incident has meaningful activity inside the idle threshold.",
  },
};

function formatDuration(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "Not available";
  const absolute = Math.abs(Math.round(seconds));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const value = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return seconds < 0 ? `${value} overdue` : `${value} remaining`;
}

function attentionReasons(item: IncidentOperationsItem) {
  const labels = {
    HIGH_PRIORITY: { label: "High priority", tone: "border-[#E8D7CF] bg-[#FFF8F4] text-[#82503C]" },
    SLA_AT_RISK: { label: "SLA at risk", tone: "border-[#E7DDBC] bg-[#FFFBF0] text-[#735B28]" },
    SLA_BREACHED: { label: "SLA breached", tone: "border-[#E4D4DE] bg-[#FFF8FB] text-[#7B405C]" },
    STUCK_IDLE: { label: "Stuck / idle", tone: "border-[#DDE3EA] bg-[#F7F9FB] text-[#526075]" },
  } as const;
  return item.attention_reasons.map((reason) => labels[reason]);
}

function workloadPriority(left: IncidentWorkloadEntry, right: IncidentWorkloadEntry) {
  return right.p1_p2 - left.p1_p2
    || (right.sla_breached + right.sla_at_risk) - (left.sla_breached + left.sla_at_risk)
    || right.open_incidents - left.open_incidents;
}

const metricStyles = {
  violet: { icon: "text-[#7C3AED]" },
  indigo: { icon: "text-[#2563EB]" },
  rose: { icon: "text-[#E11D48]" },
  amber: { icon: "text-[#D97706]" },
  slate: { icon: "text-[#64748B]" },
  sand: { icon: "text-[#D97706]" },
} as const;

function MetricCard({ label, value, help, icon: Icon, tone = "violet", active = false, onClick, href }: {
  label: string;
  value: number;
  help: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone?: keyof typeof metricStyles;
  active?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const styles = metricStyles[tone];
  const className = `group relative flex min-h-[120px] min-w-0 flex-col justify-between rounded-xl border bg-white p-5 text-left shadow-sm transition duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 ${
    active
      ? "border-[#7C3AED] ring-2 ring-[#7C3AED]/20"
      : "border-[#E6E9F0] hover:border-[#CBD5E1]"
  }`;
  const content = (
    <>
      <div className="mb-2 flex items-center justify-between text-[#6B7488]">
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
        <Icon className={`h-4 w-4 shrink-0 ${styles.icon}`} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold text-[#0E1726]">{value}</div>
          {href ? <ArrowRight className="h-4 w-4 text-[#8C95A8] transition group-hover:translate-x-0.5" /> : null}
        </div>
        <p className="mt-1 text-xs text-[#6B7488]">{help}</p>
      </div>
    </>
  );
  if (href) return <Link href={href} className={className}>{content}</Link>;
  return <button type="button" onClick={onClick} aria-pressed={active} className={className}>{content}</button>;
}

function LoadingState() {
  return (
    <div className="space-y-5" aria-label="Loading Incident Manager operations">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="min-h-[120px] animate-pulse rounded-xl border border-[#E6E9F0] bg-white p-5 shadow-sm" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-2xl border border-[#E6E9F0] bg-white" />
    </div>
  );
}

export default function IncidentManagerPage() {
  const [dashboard, setDashboard] = useState<IncidentOperationsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [view, setView] = useState<AttentionView>("all");
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const response = await fetch("/api/itsm/incidents/operations/dashboard", { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign("/itsm/login?next=%2Fitsm%2Fincident-manager");
        return;
      }
      if (response.status === 403) { setForbidden(true); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.detail || "Unable to load operational data");
      }
      const data = await response.json();
      setDashboard(data);
      setLastRefreshed(new Date());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Unable to load operational data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const request = window.setTimeout(loadDashboard, 0);
    return () => window.clearTimeout(request);
  }, [loadDashboard]);

  const visibleItems = useMemo(() => {
    if (!dashboard) return [];
    if (view === "priority") return dashboard.priority_watch;
    if (view === "risk") return dashboard.sla_at_risk;
    if (view === "breached") return dashboard.sla_breached;
    if (view === "stuck") return dashboard.stuck;
    return dashboard.escalation_watch;
  }, [dashboard, view]);

  if (loading && !dashboard) return <LoadingState />;

  if (forbidden) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-[#DDD6FE] bg-white p-8 text-center shadow-sm shadow-[#6D28D9]/5">
        <ShieldAlert className="mx-auto h-8 w-8 text-[#6D28D9]" />
        <h1 className="mt-4 text-lg font-bold text-[#0E1726]">Incident Manager access required</h1>
        <p className="mt-2 text-sm text-[#6B7488]">Your authenticated ITSM role cannot access operational oversight data.</p>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-[#DDD6FE] bg-white p-8 text-center shadow-sm shadow-[#6D28D9]/5">
        <AlertCircle className="mx-auto h-8 w-8 text-[#6D28D9]" />
        <h1 className="mt-4 text-lg font-bold text-[#0E1726]">Operations data is unavailable</h1>
        <p className="mt-2 text-sm text-[#6B7488]">{error || "The dashboard returned no data."}</p>
        <button onClick={loadDashboard} className="mt-5 rounded-lg bg-[#6D28D9] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5B21B6]">Try again</button>
      </div>
    );
  }

  const summary = dashboard.summary;
  const allGroupWorkload = [...(dashboard.workload.assignment_groups || [])].sort(workloadPriority);
  const allAssigneeWorkload = [...(dashboard.workload.assignees || [])].sort(workloadPriority);
  const groupWorkload = allGroupWorkload.slice(0, WORKLOAD_PREVIEW_LIMIT);
  const assigneeWorkload = allAssigneeWorkload.slice(0, WORKLOAD_PREVIEW_LIMIT);
  const attentionPreview = visibleItems.slice(0, ATTENTION_PREVIEW_LIMIT);
  const maxGroup = Math.max(...allGroupWorkload.map((entry) => entry.open_incidents), 1);
  const maxAssignee = Math.max(...allAssigneeWorkload.map((entry) => entry.open_incidents), 1);
  const queueAttention = { all: "WATCH", priority: "PRIORITY", risk: "SLA_AT_RISK", breached: "SLA_BREACHED", stuck: "STUCK" }[view];

  return (
    <div className="role-portal mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[#6D28D9]">Incident operations</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[#0E1726] md:text-3xl">Incident Manager</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#6B7488]">Monitor urgent incidents, SLA health, and response ownership.</p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <button onClick={loadDashboard} disabled={loading} className="inline-flex w-fit items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] shadow-sm transition hover:border-[#C4B5FD] hover:bg-[#FAFAFF] hover:text-[#5B21B6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh operations
          </button>
          {lastRefreshed ? <p className="text-[10px] text-[#8A93A5]">Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p> : null}
        </div>
      </div>

      <section aria-label="Operational summary">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-[#667085]">An incident may match more than one attention reason.</p>
          <p className="text-[11px] text-[#667085]"><span className="font-semibold text-[#475467]">Focus attention:</span> select a reason to filter the worklist below.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Open incidents" value={summary.open_incidents} help="Active incident queue" icon={Gauge} tone="violet" href="/itsm/incident-manager/incidents" />
          <MetricCard label="Watch list" value={summary.escalation_watch} help="All incidents requiring review" icon={ShieldAlert} tone="indigo" active={view === "all"} onClick={() => setView("all")} />
          <MetricCard label="Critical or high priority" value={summary.p1_p2} help="P1 and P2 incidents" icon={Flame} tone="rose" active={view === "priority"} onClick={() => setView("priority")} />
          <MetricCard label="Deadline missed" value={summary.sla_breached} help="SLA target has passed" icon={TimerOff} tone="rose" active={view === "breached"} onClick={() => setView("breached")} />
          <MetricCard label="Deadline approaching" value={summary.sla_at_risk} help="25% or less SLA time remains" icon={Clock3} tone="amber" active={view === "risk"} onClick={() => setView("risk")} />
          <MetricCard label="No recent activity" value={summary.stuck} help={`${Math.round(dashboard.policy.idle_threshold_seconds / 3600)}+ hours without an update`} icon={AlertTriangle} tone="slate" active={view === "stuck"} onClick={() => setView("stuck")} />
          <MetricCard label="No owner" value={summary.unassigned} help="Assignment required" icon={UsersRound} tone="sand" href="/itsm/incident-manager/incidents?assignment_group=__UNASSIGNED__&unassigned=true" />
          <MetricCard label="Active majors" value={summary.active_major_incidents} help="Command currently in progress" icon={Radio} tone="violet" href="/itsm/incident-manager/major-incidents" />
        </div>
      </section>

      <div className="flex gap-3 rounded-xl border border-[#EAECF0] bg-[#F8FAFC] px-4 py-3 text-[11px] leading-5 text-[#667085]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#667085]" />
        <p><span className="font-semibold text-[#344054]">Attention policy:</span> SLA risk begins at {Math.round(dashboard.policy.risk_remaining_fraction * 100)}% remaining; an incident is marked stuck after {Math.round(dashboard.policy.idle_threshold_seconds / 3600)} hours without meaningful activity. {dashboard.policy.escalation_note}</p>
      </div>

      <div className="space-y-6">
        <section className="overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]" aria-labelledby="attention-heading">
          <div className="flex flex-col gap-3 border-b border-[#EAECF0] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 id="attention-heading" className="text-base font-bold text-[#101828]">Needs attention now</h2>
                <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 text-[10px] font-bold text-[#475467]">{visibleItems.length}</span>
              </div>
              <p className="mt-1 text-xs text-[#667085]">Prioritized incidents from the selected operational signal. Watch items are advisory, not automatic escalations.</p>
            </div>
            <Link href={`/itsm/incident-manager/incidents?attention=${queueAttention}`} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-[#6941C6] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2">Open filtered queue <ArrowRight className="h-3 w-3" /></Link>
          </div>

          {visibleItems.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center px-6 py-9 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ECFDF3]"><CheckCircle2 className="h-5 w-5 text-[#039855]" /></span>
              <h3 className="mt-3 text-sm font-bold text-[#0E1726]">{view === "all" ? "Operations stable" : emptyAttentionCopy[view].title}</h3>
              <p className="mt-1 max-w-sm text-xs leading-5 text-[#6B7488]">{emptyAttentionCopy[view].description}</p>
              <Link href="/itsm/incident-manager/incidents" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#6D28D9] hover:underline">Review the incident queue <ArrowRight className="h-3 w-3" /></Link>
            </div>
          ) : (
            <div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full table-fixed text-left">
                  <caption className="sr-only">Incidents that need operational attention</caption>
                  <colgroup><col className="w-[24%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[16%]" /><col className="w-[16%]" /><col className="w-[17%]" /><col className="w-[6%]" /></colgroup>
                  <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-[0.08em] text-[#667085]"><tr><th className="px-5 py-3">Incident</th><th className="px-3 py-3">State</th><th className="px-3 py-3">Priority</th><th className="px-3 py-3">Attention reason</th><th className="px-3 py-3">SLA</th><th className="px-3 py-3">Ownership</th><th className="px-3 py-3"><span className="sr-only">Action</span></th></tr></thead>
                  <tbody className="divide-y divide-[#EAECF0]">
                    {attentionPreview.map((item) => {
                      const reasons = attentionReasons(item);
                      const primaryReason = reasons[0];
                      return <tr key={`${view}-${item.incident_id}`} className="transition hover:bg-[#FAFAFF]">
                        <td className="px-5 py-4"><span className="font-mono text-[10px] font-bold text-[#6941C6]">{item.ticket_number}</span><p className="mt-1 truncate text-xs font-semibold text-[#101828]" title={item.title}>{item.title}</p></td>
                        <td className="px-3 py-4"><IncidentStatusBadge status={item.status} className="px-2 py-0 text-[10px]" /></td>
                        <td className="px-3 py-4"><IncidentPriorityBadge priority={item.priority} className="px-2 py-0 text-[10px]" showLabel={false} /></td>
                        <td className="px-3 py-4"><div className="flex items-center gap-1.5">{primaryReason ? <span className={`truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold ${primaryReason.tone}`}>{primaryReason.label}</span> : <span className="text-[10px] text-[#98A2B3]">No active signal</span>}{reasons.length > 1 ? <span className="shrink-0 text-[10px] font-semibold text-[#667085]">+{reasons.length - 1}</span> : null}</div></td>
                        <td className="px-3 py-4"><p className={`text-[11px] font-bold ${item.sla.status === "BREACHED" ? "text-[#7B405C]" : item.sla.status === "AT_RISK" ? "text-[#735B28]" : "text-[#475467]"}`}>{item.sla.status === "NO_SLA" ? "No SLA assigned" : item.sla.status === "BREACHED" ? "Breached" : item.sla.status === "AT_RISK" ? "At risk" : "Within target"}</p><p className="mt-1 text-[10px] text-[#8A93A5]">{item.sla.status === "NO_SLA" ? "No timer available" : formatDuration(item.sla.remaining_seconds)}</p></td>
                        <td className="px-3 py-4"><p className="truncate text-[11px] font-semibold text-[#344054]">{item.assignment_group || "No assignment group"}</p><p className="mt-1 truncate text-[10px] text-[#8A93A5]">{item.assignee_email || "No individual owner"}</p></td>
                        <td className="px-3 py-4 text-right"><button type="button" onClick={() => setSelectedIncident(item.incident_id)} aria-label={`Review ${item.ticket_number}: ${item.title}`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6941C6] transition hover:bg-[#F4F3FF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]"><ArrowRight className="h-4 w-4" /></button></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-[#EAECF0] lg:hidden">
                {attentionPreview.map((item) => {
                  const reasons = attentionReasons(item);
                  return <button type="button" key={`mobile-${view}-${item.incident_id}`} onClick={() => setSelectedIncident(item.incident_id)} className="block w-full px-5 py-4 text-left transition hover:bg-[#FAFAFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED]">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="font-mono text-[10px] font-bold text-[#6941C6]">{item.ticket_number}</span><p className="mt-1 truncate text-sm font-semibold text-[#101828]">{item.title}</p></div><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#6941C6]" /></div>
                    <div className="mt-3 flex flex-wrap items-center gap-2"><IncidentStatusBadge status={item.status} className="px-2 py-0 text-[10px]" /><IncidentPriorityBadge priority={item.priority} className="px-2 py-0 text-[10px]" showLabel={false} />{reasons[0] ? <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${reasons[0].tone}`}>{reasons[0].label}</span> : null}</div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]"><div><span className="text-[#98A2B3]">SLA</span><p className="mt-0.5 font-semibold text-[#475467]">{item.sla.status === "NO_SLA" ? "No SLA assigned" : formatDuration(item.sla.remaining_seconds)}</p></div><div><span className="text-[#98A2B3]">Ownership</span><p className="mt-0.5 truncate font-semibold text-[#475467]">{item.assignment_group || item.assignee_email || "Unassigned"}</p></div></div>
                  </button>;
                })}
              </div>
            </div>
          )}
          {visibleItems.length > ATTENTION_PREVIEW_LIMIT ? <div className="border-t border-[#EAECF0] bg-[#F9FAFB] px-5 py-3 text-right"><Link href={`/itsm/incident-manager/incidents?attention=${queueAttention}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#6941C6] hover:underline">View all {visibleItems.length} matching incidents <ArrowRight className="h-3.5 w-3.5"/></Link></div> : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <div className="border-b border-[#EAECF0] px-5 py-4">
              <h2 className="text-sm font-bold text-[#101828]">Current workload</h2>
              <p className="mt-1 text-xs text-[#667085]">A compact view of open work by team and individual owner.</p>
            </div>
            <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-[#E6E9F0]">
            <div className="px-5 py-4 lg:px-6 lg:py-5">
              <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold text-[#475069]">Assignment groups</h3><span className="text-[10px] text-[#8A93A5]">{allGroupWorkload.length > WORKLOAD_PREVIEW_LIMIT ? `Top ${WORKLOAD_PREVIEW_LIMIT} of ${allGroupWorkload.length}` : `${allGroupWorkload.length} groups`}</span></div>
              <div className="mt-3 space-y-3">
              {groupWorkload.length === 0 ? <p className="rounded-lg bg-[#F8FAFC] p-4 text-center text-xs leading-5 text-[#8A93A5]">No open incidents are assigned to a group yet.</p> : groupWorkload.map((entry) => (
                <Link key={entry.key} href={`/itsm/incident-manager/incidents?assignment_group=${encodeURIComponent(entry.key === "Unassigned" ? "__UNASSIGNED__" : entry.key)}`} className="block rounded-lg p-1.5 transition hover:bg-[#F9FAFB] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]"><div className="flex items-center justify-between gap-3 text-xs"><span className="truncate font-semibold text-[#475467]">{entry.key === "Unassigned" ? "No assignment group" : entry.label}</span><span className="font-bold text-[#101828]">{entry.open_incidents}</span></div><div className="mt-1 flex flex-wrap gap-1 text-[9px] text-[#667085]">{entry.p1_p2 > 0 && <span className="rounded bg-[#FFF8F4] px-1.5 py-0.5 font-bold text-[#82503C]">{entry.p1_p2} high priority</span>}{entry.sla_at_risk + entry.sla_breached > 0 && <span className="rounded bg-[#FFFBF0] px-1.5 py-0.5 font-bold text-[#735B28]">{entry.sla_at_risk + entry.sla_breached} SLA attention</span>}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EEF1F5]"><div className="h-full rounded-full bg-[#7F56D9]" style={{ width: `${Math.max((entry.open_incidents / maxGroup) * 100, 6)}%` }} /></div></Link>
              ))}
              </div>
              {allGroupWorkload.length > WORKLOAD_PREVIEW_LIMIT ? <Link href="/itsm/incident-manager/incidents" className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-[#6D28D9] hover:underline">View full queue <ArrowRight className="h-3 w-3"/></Link> : null}
            </div>
            <div className="border-t border-[#E6E9F0] px-5 py-4 lg:border-t-0 lg:px-6 lg:py-5">
              <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5 text-[#667085]" /><h3 className="text-xs font-bold text-[#475467]">Assignees</h3></div><span className="text-[10px] text-[#8A93A5]">{allAssigneeWorkload.length > WORKLOAD_PREVIEW_LIMIT ? `Top ${WORKLOAD_PREVIEW_LIMIT} of ${allAssigneeWorkload.length}` : `${allAssigneeWorkload.length} owners`}</span></div>
              <div className="mt-3 space-y-3">
              {assigneeWorkload.length === 0 ? <p className="rounded-lg bg-[#F8FAFC] p-4 text-center text-xs leading-5 text-[#8A93A5]">No open incidents are assigned to an individual yet.</p> : assigneeWorkload.map((entry) => (
                <AssigneeWorkloadRow key={entry.key} entry={entry} max={maxAssignee} />
              ))}
              </div>
              {allAssigneeWorkload.length > WORKLOAD_PREVIEW_LIMIT ? <Link href="/itsm/incident-manager/incidents" className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-[#6D28D9] hover:underline">View full queue <ArrowRight className="h-3 w-3"/></Link> : null}
            </div>
            </div>
        </section>
      </div>

      {selectedIncident && <IncidentOversightDrawer incidentId={selectedIncident} operations={dashboard.escalation_watch.find((item) => item.incident_id === selectedIncident)} onClose={() => setSelectedIncident(null)} onChanged={loadDashboard} />}
    </div>
  );
}

function AssigneeWorkloadRow({ entry, max }: { entry: IncidentWorkloadEntry; max: number }) {
  const displayLabel = entry.key === "Unassigned" ? "No assignee" : entry.label;
  const content = <>
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F1ECFE] text-[10px] font-bold text-[#6D28D9]">
      {entry.key === "Unassigned" ? "!" : entry.label.slice(0, 1).toUpperCase()}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-[#475069]" title={displayLabel}>{displayLabel}</span>
        <span className="font-bold text-[#0E1726]">{entry.open_incidents}</span>
      </div>
      <div className="mt-1 text-[9px] text-[#8A93A5]">
        {entry.p1_p2} high priority · {entry.sla_at_risk + entry.sla_breached} SLA attention
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#EEF1F5]">
        <div className="h-full rounded-full bg-[#7C3AED]" style={{ width: `${Math.max((entry.open_incidents / max) * 100, 6)}%` }} />
      </div>
    </div>
  </>;
  if (entry.key === "Unassigned") return <Link href="/itsm/incident-manager/incidents?unassigned=true" className="flex items-center gap-3 rounded-lg p-1.5 transition hover:bg-[#F8FAFC]">{content}</Link>;
  return <Link href={`/itsm/incident-manager/incidents?assignee_id=${encodeURIComponent(entry.key)}`} className="flex items-center gap-3 rounded-lg p-1.5 transition hover:bg-[#F8FAFC]">{content}</Link>;
}
