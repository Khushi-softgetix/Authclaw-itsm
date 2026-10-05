"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
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

type FilterMode = "all" | "assigned_to_me" | "team_queue" | "high_priority" | "sla_risk";
type SortBy = "recently_updated" | "priority" | "sla_risk";

export default function ServiceAgentWorkspacePage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
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
        filter_mode: filterMode,
        sort_by: sortBy,
        limit: "50",
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
      setIncidents(Array.isArray(data) ? data : []);
    } catch {
      setError("Network or server connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [filterMode, sortBy]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Small summary metrics calculated from visible workable incidents
  const assignedToMeCount = incidents.filter(
    (i) => currentUserId && i.assignee_id === currentUserId
  ).length;

  const teamQueueCount = incidents.filter(
    (i) => !currentUserId || i.assignee_id !== currentUserId
  ).length;

  const needsAttentionCount = incidents.filter(
    (i) =>
      i.status === "NEW" ||
      i.status === "ASSIGNED" ||
      i.priority === "P1" ||
      i.priority === "P2"
  ).length;

  const slaAtRiskCount = incidents.filter((i) => {
    const calc = calculateSlaStatus(i);
    return (
      calc.state === "AMBER" ||
      calc.state === "RED" ||
      i.sla_status === "AT_RISK" ||
      i.sla_status === "BREACHED"
    );
  }).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E6E9F0] pb-5">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#6D28D9] uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-[#6D28D9]" />
            Service Agent Workspace
          </div>
          <h1 className="text-2xl font-bold text-[#0E1726] tracking-tight">
            My Work
          </h1>
          <p className="text-sm text-[#6B7488] mt-0.5">
            Manage your assigned incidents, monitor team queues, and track SLA targets.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={loadQueue}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#475069] bg-white border border-[#E6E9F0] rounded-lg hover:bg-slate-50 transition shadow-sm disabled:opacity-50"
            title="Refresh queue"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#6D28D9]" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Small Summary Metric Area */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Assigned to me */}
        <div className="bg-white border border-[#E6E9F0] rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#6B7488]">Assigned to me</span>
            <UserCheck className="w-4 h-4 text-[#6D28D9]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726] mt-2">
            {loading ? "—" : assignedToMeCount}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Directly allocated tickets</p>
        </div>

        {/* Metric 2: Team Queue */}
        <div className="bg-white border border-[#E6E9F0] rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#6B7488]">My Team Queue</span>
            <Layers className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726] mt-2">
            {loading ? "—" : teamQueueCount}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Workable team incidents</p>
        </div>

        {/* Metric 3: Needs attention */}
        <div className="bg-white border border-[#E6E9F0] rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#6B7488]">Needs attention</span>
            <AlertCircle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726] mt-2">
            {loading ? "—" : needsAttentionCount}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Unassigned or high priority</p>
        </div>

        {/* Metric 4: SLA at risk */}
        <div className="bg-white border border-[#E6E9F0] rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#6B7488]">SLA at risk</span>
            <Clock className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726] mt-2">
            {loading ? "—" : slaAtRiskCount}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Breached or approaching deadline</p>
        </div>
      </div>

      {/* Queue Filter & Sort Bar */}
      <div className="bg-white border border-[#E6E9F0] rounded-xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterMode("all")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
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
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
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
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              filterMode === "team_queue"
                ? "bg-[#6D28D9] text-white shadow-xs"
                : "text-[#475069] hover:bg-slate-100"
            }`}
          >
            My Team Queue
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("high_priority")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
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
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
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
            className="text-xs font-medium text-[#0E1726] bg-slate-50 border border-[#E6E9F0] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#6D28D9]"
          >
            <option value="recently_updated">Recently updated</option>
            <option value="priority">Priority</option>
            <option value="sla_risk">SLA risk</option>
          </select>
        </div>
      </div>

      {/* Main Queue Table / Content */}
      <div className="bg-white border border-[#E6E9F0] rounded-xl shadow-sm overflow-hidden">
        {/* Table Header / Queue Title */}
        <div className="px-5 py-3.5 border-b border-[#E6E9F0] bg-slate-50/70 flex items-center justify-between">
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
          <div className="p-8 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin mx-auto" />
            <p className="text-xs text-[#6B7488]">Loading active incidents from workspace queue...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="p-8 text-center space-y-3">
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
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#6D28D9] rounded-lg hover:bg-[#5B21B6] transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && incidents.length === 0 && (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#0E1726]">No work assigned</h3>
              <p className="text-xs text-[#6B7488] mt-1">You&apos;re all caught up.</p>
            </div>
          </div>
        )}

        {/* Incidents Table */}
        {!loading && !error && incidents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E6E9F0] bg-slate-50/50 text-[11px] font-semibold text-[#6B7488] uppercase tracking-wider">
                  <th className="px-4 py-3">Ticket #</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">Assigned Team</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">SLA Risk</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E9F0] text-xs">
                {incidents.map((incident) => {
                  const slaConfig = itsmSlaConfig(incident.sla_status);
                  return (
                    <tr
                      key={incident.id}
                      className="hover:bg-purple-50/30 transition duration-100 group"
                    >
                      {/* Ticket Number */}
                      <td className="px-4 py-3 font-semibold font-mono text-[#0E1726] whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/itsm/incidents/${incident.id}`}
                            className="text-[#6D28D9] hover:underline"
                          >
                            {incident.ticket_number}
                          </Link>
                          {currentUserId && incident.assignee_id === currentUserId ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-[#6D28D9] border border-purple-200">
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
                      <td className="px-4 py-3 max-w-xs truncate font-medium text-[#0E1726]">
                        <Link
                          href={`/itsm/incidents/${incident.id}`}
                          className="hover:text-[#6D28D9] block truncate"
                          title={incident.title}
                        >
                          {incident.title}
                        </Link>
                      </td>

                      {/* Priority */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <IncidentPriorityBadge priority={incident.priority} />
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <IncidentStatusBadge status={incident.status} />
                      </td>

                      {/* Service */}
                      <td className="px-4 py-3 whitespace-nowrap text-[#475069]">
                        {incident.service_name || incident.category || "—"}
                      </td>

                      {/* Assigned Team */}
                      <td className="px-4 py-3 whitespace-nowrap text-[#475069]">
                        {incident.assignment_group || "—"}
                      </td>

                      {/* Updated time */}
                      <td className="px-4 py-3 whitespace-nowrap text-[#6B7488]">
                        {formatDateTime(incident.updated_at)}
                      </td>

                      {/* SLA Status / Risk Countdown */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <SlaCountdownBadge ticket={incident} />
                      </td>

                      {/* Open Action */}
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <Link
                          href={`/itsm/incidents/${incident.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] transition"
                        >
                          <span>Open</span>
                          <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition" />
                        </Link>
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
