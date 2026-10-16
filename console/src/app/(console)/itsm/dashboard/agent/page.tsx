"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Inbox,
  Layers,
  RefreshCw,
  ShieldAlert,
  Ticket,
  UserCheck,
} from "lucide-react";
import { Incident } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import { SlaCountdownBadge } from "@/components/itsm/sla-countdown";
import { calculateSlaStatus } from "@/lib/itsm-sla";
import { formatDateTime, itsmSlaConfig } from "@/lib/itsm-format";

function formatCompactDateTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    const str = String(iso);
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(str) ? str : `${str}Z`;
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return str;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return String(iso || "—");
  }
}

type FilterMode = "all" | "assigned_to_me" | "team_queue" | "needs_attention" | "high_priority" | "sla_risk";
type SortBy = "recently_updated" | "priority" | "sla_risk";

export default function ServiceAgentWorkspacePage() {
  const [allIncidents, setAllIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Filters & sorting
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortBy, setSortBy] = useState<SortBy>("recently_updated");

  // Fetch session to determine current agent's user ID for metrics
  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          if (data?.userId) setCurrentUserId(data.userId);
        }
      } catch {
        // Non-blocking
      }
    }
    loadSession();
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        filter_mode: "all",
        sort_by: sortBy,
        limit: "100",
      });

      const res = await fetch(`/api/itsm/incidents/queue?${params.toString()}`);

      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }

      if (res.status === 403) {
        setError("Access denied. The Service Agent workspace is restricted to authorized Service Agents.");
        return;
      }

      if (!res.ok) {
        setError("Unable to load work queue. Please try again.");
        return;
      }

      const data = await res.json();
      setAllIncidents(Array.isArray(data) ? data : []);
    } catch {
      setError("Network or server connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [sortBy]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Helper classifiers for ticket grouping
  const isAssignedToMe = useCallback(
    (i: Incident) => Boolean(currentUserId && i.assignee_id === currentUserId),
    [currentUserId]
  );

  const isTeamQueue = useCallback(
    (i: Incident) => Boolean(!currentUserId || i.assignee_id !== currentUserId),
    [currentUserId]
  );

  const isNeedsAttention = useCallback((i: Incident) => {
    return (
      !i.assignee_id ||
      i.status === "NEW" ||
      i.status === "ASSIGNED" ||
      i.priority === "P1" ||
      i.priority === "P2"
    );
  }, []);

  const isSlaAtRisk = useCallback((i: Incident) => {
    const calc = calculateSlaStatus(i);
    return (
      calc.state === "AMBER" ||
      calc.state === "RED" ||
      i.sla_status === "AT_RISK" ||
      i.sla_status === "BREACHED"
    );
  }, []);

  // Small summary metrics calculated from visible workable incidents (always accurate across full queue)
  const assignedToMeCount = allIncidents.filter(isAssignedToMe).length;
  const teamQueueCount = allIncidents.filter(isTeamQueue).length;
  const needsAttentionCount = allIncidents.filter(isNeedsAttention).length;
  const slaAtRiskCount = allIncidents.filter(isSlaAtRisk).length;

  // Filtered and sorted incidents for display
  const incidents = React.useMemo(() => {
    let result = allIncidents;

    if (filterMode === "assigned_to_me") {
      result = result.filter(isAssignedToMe);
    } else if (filterMode === "team_queue") {
      result = result.filter(isTeamQueue);
    } else if (filterMode === "needs_attention") {
      result = result.filter(isNeedsAttention);
    } else if (filterMode === "high_priority") {
      result = result.filter((i) => i.priority === "P1" || i.priority === "P2");
    } else if (filterMode === "sla_risk") {
      result = result.filter(isSlaAtRisk);
    }

    if (sortBy === "priority") {
      const priorityOrder: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };
      result = [...result].sort((a, b) => {
        const pA = priorityOrder[a.priority?.toUpperCase()] || 5;
        const pB = priorityOrder[b.priority?.toUpperCase()] || 5;
        if (pA !== pB) return pA - pB;
        return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
      });
    } else if (sortBy === "sla_risk") {
      const statusOrder: Record<string, number> = { BREACHED: 1, AT_RISK: 2, WITHIN_SLA: 3 };
      result = [...result].sort((a, b) => {
        const sA = statusOrder[a.sla_status?.toUpperCase()] || 4;
        const sB = statusOrder[b.sla_status?.toUpperCase()] || 4;
        if (sA !== sB) return sA - sB;
        const dueA = a.sla_resolution_due_at ? new Date(a.sla_resolution_due_at).getTime() : Infinity;
        const dueB = b.sla_resolution_due_at ? new Date(b.sla_resolution_due_at).getTime() : Infinity;
        if (dueA !== dueB) return dueA - dueB;
        return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
      });
    } else {
      // recently_updated
      result = [...result].sort(
        (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      );
    }

    return result;
  }, [allIncidents, filterMode, sortBy, isAssignedToMe, isTeamQueue, isNeedsAttention, isSlaAtRisk]);

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white border border-[#E6E9F0] rounded-[20px] p-5 sm:p-6 shadow-[0_1px_2px_rgba(11,31,63,.05)]">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#6D28D9] uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#6D28D9]" />
            Service Agent Workspace
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#0E1726] tracking-tight">
            My Work
          </h1>
          <p className="text-xs sm:text-sm text-[#6B7488] mt-0.5">
            Manage your assigned incidents, monitor team queues, and track SLA targets.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={loadQueue}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#475069] bg-white border border-[#E6E9F0] rounded-xl hover:bg-slate-50 transition shadow-xs disabled:opacity-50"
            title="Refresh queue"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#6D28D9]" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Small Summary Metric Area - Clickable filter cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Assigned to me */}
        <button
          type="button"
          onClick={() => setFilterMode(filterMode === "assigned_to_me" ? "all" : "assigned_to_me")}
          className={`text-left w-full rounded-[20px] p-5 transition-all duration-200 cursor-pointer shadow-[0_1px_2px_rgba(11,31,63,.05)] hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] ${
            filterMode === "assigned_to_me"
              ? "bg-[#FBF9FE] border-2 border-[#6D28D9] shadow-sm"
              : "bg-white border border-[#E6E9F0] hover:border-[#6D28D9]/50"
          }`}
          title="Click to filter by tickets assigned to you"
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${filterMode === "assigned_to_me" ? "text-[#6D28D9]" : "text-[#6B7488]"}`}>
              Assigned to me
            </span>
            <UserCheck className="w-4 h-4 text-[#6D28D9]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726] mt-2">
            {loading ? "—" : assignedToMeCount}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Directly allocated tickets</p>
        </button>

        {/* Metric 2: Team Queue */}
        <button
          type="button"
          onClick={() => setFilterMode(filterMode === "team_queue" ? "all" : "team_queue")}
          className={`text-left w-full rounded-[20px] p-5 transition-all duration-200 cursor-pointer shadow-[0_1px_2px_rgba(11,31,63,.05)] hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
            filterMode === "team_queue"
              ? "bg-[#F8FAFF] border-2 border-[#2563EB] shadow-sm"
              : "bg-white border border-[#E6E9F0] hover:border-blue-400"
          }`}
          title="Click to filter by team queue tickets"
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${filterMode === "team_queue" ? "text-[#2563EB]" : "text-[#6B7488]"}`}>
              My Team Queue
            </span>
            <Layers className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726] mt-2">
            {loading ? "—" : teamQueueCount}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Workable team incidents</p>
        </button>

        {/* Metric 3: Needs attention */}
        <button
          type="button"
          onClick={() => setFilterMode(filterMode === "needs_attention" ? "all" : "needs_attention")}
          className={`text-left w-full rounded-[20px] p-5 transition-all duration-200 cursor-pointer shadow-[0_1px_2px_rgba(11,31,63,.05)] hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
            filterMode === "needs_attention"
              ? "bg-[#FFFDF7] border-2 border-[#D97706] shadow-sm"
              : "bg-white border border-[#E6E9F0] hover:border-amber-400"
          }`}
          title="Click to filter by unassigned or high-priority tickets"
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${filterMode === "needs_attention" ? "text-[#D97706]" : "text-[#6B7488]"}`}>
              Needs attention
            </span>
            <AlertCircle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726] mt-2">
            {loading ? "—" : needsAttentionCount}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Unassigned or high priority</p>
        </button>

        {/* Metric 4: SLA at risk */}
        <button
          type="button"
          onClick={() => setFilterMode(filterMode === "sla_risk" ? "all" : "sla_risk")}
          className={`text-left w-full rounded-[20px] p-5 transition-all duration-200 cursor-pointer shadow-[0_1px_2px_rgba(11,31,63,.05)] hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
            filterMode === "sla_risk"
              ? "bg-[#FFF8F8] border-2 border-[#DC2626] shadow-sm"
              : "bg-white border border-[#E6E9F0] hover:border-red-400"
          }`}
          title="Click to filter by breached or approaching SLA deadlines"
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${filterMode === "sla_risk" ? "text-[#DC2626]" : "text-[#6B7488]"}`}>
              SLA at risk
            </span>
            <Clock className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726] mt-2">
            {loading ? "—" : slaAtRiskCount}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Breached or approaching deadline</p>
        </button>
      </div>

      {/* Queue Filter & Sort Bar */}
      <div className="bg-white border border-[#E6E9F0] rounded-[20px] p-3.5 shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterMode("all")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition ${
              filterMode === "all"
                ? "bg-[#6D28D9] text-white shadow-xs"
                : "text-[#475069] hover:bg-slate-100"
            }`}
          >
            All Work
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("assigned_to_me")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition ${
              filterMode === "assigned_to_me"
                ? "bg-[#6D28D9] text-white shadow-xs"
                : "text-[#475069] hover:bg-slate-100"
            }`}
          >
            Assigned to me
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("team_queue")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition ${
              filterMode === "team_queue"
                ? "bg-[#6D28D9] text-white shadow-xs"
                : "text-[#475069] hover:bg-slate-100"
            }`}
          >
            My Team Queue
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("needs_attention")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition ${
              filterMode === "needs_attention"
                ? "bg-[#6D28D9] text-white shadow-xs"
                : "text-[#475069] hover:bg-slate-100"
            }`}
          >
            Needs attention
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("high_priority")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition ${
              filterMode === "high_priority"
                ? "bg-[#6D28D9] text-white shadow-xs"
                : "text-[#475069] hover:bg-slate-100"
            }`}
          >
            High priority
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("sla_risk")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition ${
              filterMode === "sla_risk"
                ? "bg-[#6D28D9] text-white shadow-xs"
                : "text-[#475069] hover:bg-slate-100"
            }`}
          >
            SLA at risk
          </button>
        </div>

        {/* Sort Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="sort-queue" className="text-xs font-medium text-[#6B7488] shrink-0">
            Sort by:
          </label>
          <select
            id="sort-queue"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="text-xs font-medium text-[#0E1726] bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#6D28D9]"
          >
            <option value="recently_updated">Recently updated</option>
            <option value="priority">Priority</option>
            <option value="sla_risk">SLA risk</option>
          </select>
        </div>
      </div>

      {/* Main Queue Table / Content */}
      <div className="bg-white border border-[#E6E9F0] rounded-[20px] shadow-[0_1px_2px_rgba(11,31,63,.05)] overflow-hidden flex flex-col">
        {/* Table Header / Queue Title */}
        <div className="px-5 py-3.5 border-b border-[#E6E9F0] bg-[#FBFAF9] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-[#6D28D9]" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#0E1726]">
              {filterMode === "assigned_to_me"
                ? "My Work · Assigned to Me"
                : filterMode === "team_queue"
                ? "My Team Queue"
                : "My Work & Team Queue"}
            </h2>
          </div>
          <span className="text-xs text-[#6B7488]">
            {loading ? "Loading..." : `${incidents.length} incident${incidents.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="p-12 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin mx-auto" />
            <p className="text-xs text-[#6B7488]">Loading active incidents from workspace queue...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="p-12 text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto border border-red-200">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#0E1726]">Unable to load work queue</h3>
              <p className="text-xs text-[#6B7488] mt-1 max-w-md mx-auto">{error}</p>
            </div>
            <button
              type="button"
              onClick={loadQueue}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#6D28D9] rounded-xl hover:bg-[#5B21B6] transition shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && incidents.length === 0 && (
          <div className="p-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#0E1726]">No work assigned</h3>
              <p className="text-xs text-[#6B7488] mt-1">You&apos;re all caught up.</p>
            </div>
            {filterMode !== "all" && (
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E9F0] text-xs font-semibold text-[#6D28D9] hover:bg-[#F8FAFC] transition mt-2"
              >
                Clear filter
              </button>
            )}
          </div>
        )}

        {/* Incidents Table */}
        {!loading && !error && incidents.length > 0 && (
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-21rem)] min-h-[350px]">
            <table className="w-full text-left text-xs border-collapse table-fixed min-w-[960px] lg:min-w-0">
              <colgroup>
                <col className="w-[155px]" />
                <col className="w-auto" />
                <col className="w-[120px]" />
                <col className="w-[115px]" />
                <col className="w-[120px]" />
                <col className="w-[125px]" />
                <col className="w-[125px]" />
                <col className="w-[125px]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-[#FBFAF9] shadow-[0_1px_0_0_#E6E9F0]">
                <tr className="border-b border-[#E6E9F0] bg-[#FBFAF9] text-[11px] font-bold text-[#6B7488] uppercase tracking-wider">
                  <th className="py-2.5 px-3 whitespace-nowrap">Ticket #</th>
                  <th className="py-2.5 px-3 min-w-[150px]">Description</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Priority</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Service</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Assigned Team</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Updated</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">SLA Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F2F5] text-xs">
                {incidents.map((incident) => {
                  return (
                    <tr
                      key={incident.id}
                      className="hover:bg-[#F9FAFB] transition-colors group cursor-pointer"
                      onClick={() => {
                        window.location.href = `/itsm/incidents/${incident.id}`;
                      }}
                    >
                      {/* Ticket Number */}
                      <td className="py-2.5 px-3 font-semibold font-mono text-[#0E1726] whitespace-nowrap text-xs">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/itsm/incidents/${incident.id}`}
                            className="text-[#6D28D9] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {incident.ticket_number}
                          </Link>
                          {currentUserId && incident.assignee_id === currentUserId ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-[#6D28D9] border border-purple-200">
                              My Work
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                              Team Queue
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Title / Description */}
                      <td className="py-2.5 px-3 min-w-0">
                        <Link
                          href={`/itsm/incidents/${incident.id}`}
                          className="hover:text-[#6D28D9] font-medium text-[#0E1726] line-clamp-2 leading-snug block"
                          title={incident.title}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {incident.title}
                        </Link>
                      </td>

                      {/* Priority */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <IncidentPriorityBadge priority={incident.priority} />
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <IncidentStatusBadge status={incident.status} />
                      </td>

                      {/* Service */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-[#475069] truncate" title={incident.service_name || incident.category || undefined}>
                        {incident.service_name || incident.category || "—"}
                      </td>

                      {/* Assigned Team */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-[#475069] truncate" title={incident.assignment_group || undefined}>
                        {incident.assignment_group || "—"}
                      </td>

                      {/* Updated time */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-[#6B7488] font-mono text-[11px]" title={formatDateTime(incident.updated_at)}>
                        {formatCompactDateTime(incident.updated_at)}
                      </td>

                      {/* SLA Status / Risk Countdown */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <SlaCountdownBadge ticket={incident} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
