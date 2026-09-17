"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Clock3, Flame,
  Gauge, RefreshCw, ShieldAlert, TimerOff, UserRound, UsersRound,
} from "lucide-react";
import IncidentOversightDrawer from "@/components/itsm/incident-oversight-drawer";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import NotificationBell from "@/components/notification-bell";
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

const cardStyles = {
  neutral: { icon: "text-[#6D28D9]", value: "text-[#5B21B6]", iconBg: "bg-[#F1ECFE]" },
  critical: { icon: "text-[#6D28D9]", value: "text-[#5B21B6]", iconBg: "bg-[#F1ECFE]" },
  warning: { icon: "text-[#7C3AED]", value: "text-[#5B21B6]", iconBg: "bg-[#FAF8FF]" },
} as const;

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
    SLA_AT_RISK: { label: "SLA at risk", tone: "bg-[#FAF8FF] text-[#5B21B6] border-[#DDD6FE]" },
    SLA_BREACHED: { label: "SLA breached", tone: "bg-[#F1ECFE] text-[#5B21B6] border-[#A78BFA]" },
    STUCK_IDLE: { label: "Stuck / idle", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  } as const;
  return item.attention_reasons
    .filter((reason) => reason !== "HIGH_PRIORITY")
    .map((reason) => labels[reason]);
}

function workloadPriority(left: IncidentWorkloadEntry, right: IncidentWorkloadEntry) {
  return right.p1_p2 - left.p1_p2
    || (right.sla_breached + right.sla_at_risk) - (left.sla_breached + left.sla_at_risk)
    || right.open_incidents - left.open_incidents;
}

function SummaryCard({ label, value, help, icon: Icon, tone = "neutral", active = false, onClick }: {
  label: string;
  value: number;
  help: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof cardStyles;
  active?: boolean;
  onClick?: () => void;
}) {
  const styles = cardStyles[tone];
  const content = (
    <div className={`h-full p-4 text-left transition ${active ? "bg-[#F1ECFE] shadow-[inset_0_-2px_0_#6D28D9]" : "bg-white"} ${onClick && !active ? "hover:bg-[#FAF8FF]" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6B7488]">{label}</p>
          <p className={`mt-2 text-2xl font-extrabold tracking-tight ${styles.value}`}>{value}</p>
        </div>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${styles.iconBg}`}>
          <Icon className={`h-4 w-4 ${styles.icon}`} />
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-[#8A93A5]">{help}</p>
    </div>
  );
  return onClick ? <button type="button" onClick={onClick} aria-pressed={active} className="block h-full w-full">{content}</button> : content;
}

function LoadingState() {
  return (
    <div className="space-y-5" aria-label="Loading Incident Manager operations">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl border border-[#E6E9F0] bg-white p-4">
            <div className="h-3 w-20 rounded bg-[#EEF1F5]" />
            <div className="mt-4 h-7 w-10 rounded bg-[#EEF1F5]" />
          </div>
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
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#0E1726] md:text-3xl">Incident Manager</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#6B7488]">Monitor urgent incidents, SLA health, and response ownership.</p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <div className="flex items-center gap-2">
            <button onClick={loadDashboard} disabled={loading} className="inline-flex w-fit items-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-3.5 py-2 text-xs font-semibold text-[#5B21B6] shadow-sm transition hover:bg-[#F1ECFE] disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 text-[#6D28D9] ${loading ? "animate-spin" : ""}`} /> Refresh operations
            </button>
            <NotificationBell />
          </div>
          {lastRefreshed ? <p className="text-[10px] text-[#8A93A5]">Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-[#DDD6FE] bg-[#DDD6FE] shadow-[0_1px_2px_rgba(91,33,182,.06)] md:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Watch list" value={summary.escalation_watch} help="Requires review" icon={ShieldAlert} tone="critical" active={view === "all"} onClick={() => setView("all")} />
        <SummaryCard label="P1 / P2" value={summary.p1_p2} help="High priority" icon={Flame} tone="critical" active={view === "priority"} onClick={() => setView("priority")} />
        <SummaryCard label="Breached" value={summary.sla_breached} help="Past SLA target" icon={TimerOff} tone="critical" active={view === "breached"} onClick={() => setView("breached")} />
        <SummaryCard label="At risk" value={summary.sla_at_risk} help="SLA needs attention" icon={Clock3} tone="warning" active={view === "risk"} onClick={() => setView("risk")} />
        <SummaryCard label="Stuck" value={summary.stuck} help="No recent activity" icon={AlertTriangle} tone="warning" active={view === "stuck"} onClick={() => setView("stuck")} />
        <Link href="/itsm/incident-manager/incidents" className="block"><SummaryCard label="Open" value={summary.open_incidents} help="Open incident queue" icon={Gauge} /></Link>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border border-[#DDD6FE] bg-[#FAF8FF] px-4 py-3 text-[11px] leading-5 text-[#6B7488] sm:flex-row sm:items-center sm:justify-between">
        <p><span className="font-semibold text-[#5B21B6]">Active policy:</span> SLA risk begins at {Math.round(dashboard.policy.risk_remaining_fraction * 100)}% remaining; stuck after {Math.round(dashboard.policy.idle_threshold_seconds / 3600)} hours without meaningful activity.</p>
        <span className="shrink-0 font-medium text-[#7C3AED]">Applied to this view</span>
      </div>

      <div className="space-y-6">
        <section className="overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-[0_1px_2px_rgba(91,33,182,.05)]">
          <div className="border-b border-[#E8E1FB] bg-[#FCFAFF] px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#0E1726]">Needs attention now</h2>
                <span className="rounded-full bg-[#F1ECFE] px-2 py-0.5 text-[10px] font-bold text-[#6D28D9]">{visibleItems.length}</span>
              </div>
              <p className="mt-0.5 text-xs text-[#6B7488]">Select a summary above to focus this list. Watch items are advisory and do not mean an escalation was triggered.</p>
            </div>
            <Link href={`/itsm/incident-manager/incidents?attention=${queueAttention}`} className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-[#6D28D9] hover:underline">Open this view in the incident queue <ArrowRight className="h-3 w-3" /></Link>
            {visibleItems.length > 0 ? (
              <div className="mt-4 hidden grid-cols-[minmax(0,1fr)_160px_190px_100px] gap-4 border-t border-[#EEF1F5] pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8A93A5] lg:grid">
                <span>Incident</span><span>Why it needs attention</span><span>SLA / ownership</span><span aria-hidden="true" />
              </div>
            ) : null}
          </div>

          {visibleItems.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center px-6 py-9 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F1ECFE]"><CheckCircle2 className="h-5 w-5 text-[#6D28D9]" /></span>
              <h3 className="mt-3 text-sm font-bold text-[#0E1726]">{view === "all" ? "Operations stable" : emptyAttentionCopy[view].title}</h3>
              <p className="mt-1 max-w-sm text-xs leading-5 text-[#6B7488]">{emptyAttentionCopy[view].description}</p>
              <Link href="/itsm/incident-manager/incidents" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#6D28D9] hover:underline">Review the incident queue <ArrowRight className="h-3 w-3" /></Link>
            </div>
          ) : (
            <div className="divide-y divide-[#EEF1F5]">
              {attentionPreview.map((item) => {
                const reasons = attentionReasons(item);
                const isHighPriority = item.attention_reasons.includes("HIGH_PRIORITY");
                const primaryReason = reasons[0];
                const additionalReasonCount = Math.max(item.attention_reasons.length - 1, 0);
                return (
                  <button key={`${view}-${item.incident_id}`} onClick={() => setSelectedIncident(item.incident_id)} className="group grid w-full gap-3 px-5 py-4 text-left transition hover:bg-[#FAF8FF] lg:grid-cols-[minmax(0,1fr)_160px_190px_100px] lg:items-center lg:gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-bold text-[#6D28D9]">{item.ticket_number}</span>
                        <IncidentStatusBadge status={item.status} className="px-2 py-0 text-[10px]" tone="brand" />
                        {!isHighPriority ? <IncidentPriorityBadge priority={item.priority} className="px-2 py-0 text-[10px]" showLabel={false} tone="brand" /> : null}
                      </div>
                      <p className="mt-1.5 truncate text-sm font-semibold text-[#0E1726] group-hover:text-[#6D28D9]">{item.title}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {isHighPriority ? <IncidentPriorityBadge priority={item.priority} className="px-2 py-0 text-[10px]" tone="brand" /> : primaryReason ? <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${primaryReason.tone}`}>{primaryReason.label}</span> : null}
                      {additionalReasonCount > 0 ? <span className="rounded-md border border-[#E6E9F0] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-semibold text-[#6B7488]">+{additionalReasonCount} more</span> : null}
                    </div>
                    <div>
                      <p className={`text-xs font-semibold ${item.sla.status === "BREACHED" || item.sla.status === "AT_RISK" ? "text-[#5B21B6]" : "text-[#475069]"}`}>{item.sla.status === "NO_SLA" ? "No SLA" : formatDuration(item.sla.remaining_seconds)}</p>
                      <p className="mt-1 truncate text-[10px] text-[#8A93A5]">{item.assignment_group || "No assignment group"}</p>
                    </div>
                    <span className="inline-flex items-center justify-end gap-1 text-xs font-semibold text-[#6D28D9]">Review incident <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
                  </button>
                );
              })}
            </div>
          )}
          {visibleItems.length > ATTENTION_PREVIEW_LIMIT ? <div className="border-t border-[#E6E9F0] bg-[#FCFAFF] px-5 py-3 text-right"><Link href={`/itsm/incident-manager/incidents?attention=${queueAttention}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#6D28D9] hover:underline">View all {visibleItems.length} matching incidents <ArrowRight className="h-3.5 w-3.5"/></Link></div> : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-[0_1px_2px_rgba(91,33,182,.05)]">
            <div className="border-b border-[#E8E1FB] bg-[#FCFAFF] px-5 py-4">
              <div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-[#6D28D9]" /><h2 className="text-sm font-bold text-[#0E1726]">Current workload</h2></div>
              <p className="mt-1 text-xs text-[#6B7488]">Open incidents by team and assignee.</p>
            </div>
            <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-[#E6E9F0]">
            <div className="px-5 py-4 lg:px-6 lg:py-5">
              <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold text-[#475069]">Assignment groups</h3><span className="text-[10px] text-[#8A93A5]">{allGroupWorkload.length > WORKLOAD_PREVIEW_LIMIT ? `Top ${WORKLOAD_PREVIEW_LIMIT} of ${allGroupWorkload.length}` : `${allGroupWorkload.length} groups`}</span></div>
              <div className="mt-3 space-y-3">
              {groupWorkload.length === 0 ? <p className="rounded-lg bg-[#F8FAFC] p-4 text-center text-xs leading-5 text-[#8A93A5]">No open incidents are assigned to a group yet.</p> : groupWorkload.map((entry) => (
                <Link key={entry.key} href={`/itsm/incident-manager/incidents?assignment_group=${encodeURIComponent(entry.key === "Unassigned" ? "__UNASSIGNED__" : entry.key)}`} className="block rounded-lg p-1.5 transition hover:bg-[#FAF8FF]"><div className="flex items-center justify-between gap-3 text-xs"><span className="truncate font-semibold text-[#475069]">{entry.key === "Unassigned" ? "No assignment group" : entry.label}</span><span className="font-bold text-[#0E1726]">{entry.open_incidents}</span></div><div className="mt-1 flex flex-wrap gap-1 text-[9px] text-[#6B7488]">{entry.p1_p2 > 0 && <span className="rounded bg-[#F1ECFE] px-1.5 py-0.5 font-bold text-[#5B21B6]">{entry.p1_p2} high priority</span>}{entry.sla_at_risk + entry.sla_breached > 0 && <span className="rounded bg-[#FAF8FF] px-1.5 py-0.5 font-bold text-[#6D28D9]">{entry.sla_at_risk + entry.sla_breached} SLA attention</span>}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EEF1F5]"><div className="h-full rounded-full bg-[#6D28D9]" style={{ width: `${Math.max((entry.open_incidents / maxGroup) * 100, 6)}%` }} /></div></Link>
              ))}
              </div>
              {allGroupWorkload.length > WORKLOAD_PREVIEW_LIMIT ? <Link href="/itsm/incident-manager/incidents" className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-[#6D28D9] hover:underline">View full queue <ArrowRight className="h-3 w-3"/></Link> : null}
            </div>
            <div className="border-t border-[#E6E9F0] px-5 py-4 lg:border-t-0 lg:px-6 lg:py-5">
              <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5 text-[#6D28D9]" /><h3 className="text-xs font-bold text-[#475069]">Assignees</h3></div><span className="text-[10px] text-[#8A93A5]">{allAssigneeWorkload.length > WORKLOAD_PREVIEW_LIMIT ? `Top ${WORKLOAD_PREVIEW_LIMIT} of ${allAssigneeWorkload.length}` : `${allAssigneeWorkload.length} owners`}</span></div>
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
