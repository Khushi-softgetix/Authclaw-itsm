"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Layers,
  Link2,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { ProblemStats, ProblemSummary } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";

type FilterStatus = "ALL" | "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export default function ProblemManagementPage() {
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [stats, setStats] = useState<ProblemStats>({
    open: 0,
    in_progress: 0,
    resolved: 0,
    total: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("ALL");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch stats
      const statsRes = await fetch("/api/itsm/problems/stats");
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      // Fetch problems with filters
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "ALL") params.set("status", statusFilter);

      const problemsRes = await fetch(`/api/itsm/problems?${params.toString()}`);
      if (problemsRes.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (!problemsRes.ok) {
        throw new Error(`Failed to load problems (${problemsRes.status})`);
      }

      const problemsData = await problemsRes.json();
      setProblems(Array.isArray(problemsData) ? problemsData : []);
    } catch (err: any) {
      setError(err?.message || "An error occurred while loading problem queue");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto" id="pcm-problems-page">
      {/* Top Header Banner matching My Tickets header style */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm"
        id="pcm-problems-header"
      >
        <div className="flex items-start sm:items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#DDCEFB] text-[#6D28D9] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Link
                href="/itsm/problem-change-manager"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F5F7FA] text-[#475069] text-[11px] font-semibold hover:bg-[#E6E9F0] hover:text-[#0E1726] transition border border-[#E6E9F0]"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>Back to Dashboard</span>
              </Link>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-[11px] font-semibold border border-[#DDD6FE]">
                <span>Problem Management</span>
              </span>
            </div>

            <h1
              id="pcm-problems-title"
              className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight"
            >
              Problems
            </h1>
            <p id="pcm-problems-subtitle" className="text-xs text-[#6B7488] mt-1 max-w-xl">
              Track recurring issues and investigate their root causes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#F1ECFE] hover:bg-[#E9DFFC] text-[#6D28D9] border border-[#DDD6FE] rounded-xl text-xs font-semibold shadow-xs transition disabled:opacity-60"
            title="Refresh problems"
            id="pcm-refresh-button"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Summary Row with only useful counts: Open, In Progress, Resolved, Total */}
      <div
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        id="pcm-problems-summary-row"
      >
        <div className="p-5 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-[#6B7488] uppercase tracking-wider">
              Open
            </span>
            <p className="text-2xl font-bold text-[#0E1726]" id="count-open">
              {stats.open}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] border border-[#DBEAFE] flex items-center justify-center text-[#2563EB]">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-[#6B7488] uppercase tracking-wider">
              In Progress
            </span>
            <p className="text-2xl font-bold text-[#0E1726]" id="count-in-progress">
              {stats.in_progress}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#F5F3FF] border border-[#EDE9FE] flex items-center justify-center text-[#6D28D9]">
            <RefreshCw className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-[#6B7488] uppercase tracking-wider">
              Resolved
            </span>
            <p className="text-2xl font-bold text-[#0E1726]" id="count-resolved">
              {stats.resolved}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] border border-[#D1FAE5] flex items-center justify-center text-[#059669]">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="p-5 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-[#6B7488] uppercase tracking-wider">
              Total
            </span>
            <p className="text-2xl font-bold text-[#0E1726]" id="count-total">
              {stats.total}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-center text-[#475569]">
            <Layers className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="p-4 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center">
        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5" id="pcm-status-filters">
          {(
            [
              { key: "ALL", label: "All", id: "filter-all" },
              { key: "OPEN", label: "Open", id: "filter-open" },
              { key: "IN_PROGRESS", label: "In Progress", id: "filter-in_progress" },
              { key: "RESOLVED", label: "Resolved", id: "filter-resolved" },
              { key: "CLOSED", label: "Closed", id: "filter-closed" },
            ] as const
          ).map((tab) => {
            const active = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  active
                    ? "bg-[#6D28D9] text-white shadow-xs"
                    : "text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F8FAFC]"
                }`}
                id={tab.id}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[260px] sm:w-72">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by problem # or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#F8FAFC] border border-[#E6E9F0] rounded-xl focus:outline-none focus:border-[#6D28D9] focus:bg-white text-[#0E1726] placeholder-[#94A3B8] transition"
            id="pcm-search-input"
          />
        </div>
      </div>

      {/* Error Banner if any */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Problem List / Table or Empty State */}
      <div
        className="rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] overflow-hidden"
        id="pcm-problems-table-container"
      >
        {loading && problems.length === 0 ? (
          <div className="p-16 text-center text-[#6B7488] space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#6D28D9]" />
            <p className="text-xs">Loading problem queue...</p>
          </div>
        ) : problems.length === 0 ? (
          /* Empty State */
          <div className="p-16 text-center space-y-4" id="pcm-empty-state">
            <div className="w-12 h-12 rounded-2xl bg-[#F8FAFC] border border-[#E6E9F0] flex items-center justify-center text-[#94A3B8] mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h2 className="text-base font-semibold text-[#0E1726]">
                No Problems found
              </h2>
              <p className="text-xs text-[#6B7488] leading-relaxed">
                Problems raised for recurring or root-cause issues will appear here.
              </p>
            </div>
            {(search || statusFilter !== "ALL") && (
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("ALL");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E9F0] text-xs font-semibold text-[#6D28D9] hover:bg-[#F8FAFC] transition"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          /* Clean Problems Table */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E6E9F0] bg-[#F8FAFC] text-[#6B7488] font-semibold">
                  <th className="py-3 px-4">Problem #</th>
                  <th className="py-3 px-4">Short Description</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Assigned Team</th>
                  <th className="py-3 px-4">Assignee</th>
                  <th className="py-3 px-4">Incidents</th>
                  <th className="py-3 px-4">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E9F0]">
                {problems.map((prob) => (
                  <tr
                    key={prob.id}
                    className="hover:bg-[#F8FAFC] transition-colors group cursor-pointer"
                    onClick={() => {
                      window.location.href = `/itsm/problem-change-manager/problems/${prob.id}`;
                    }}
                  >
                    <td className="py-3.5 px-4 font-semibold text-[#6D28D9]">
                      <Link
                        href={`/itsm/problem-change-manager/problems/${prob.id}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {prob.ticket_number}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-[#0E1726] max-w-xs truncate">
                      {prob.title}
                    </td>
                    <td className="py-3.5 px-4">
                      <IncidentStatusBadge status={prob.status} />
                    </td>
                    <td className="py-3.5 px-4">
                      <IncidentPriorityBadge priority={prob.priority} />
                    </td>
                    <td className="py-3.5 px-4 text-[#475569]">
                      {prob.service_name || "—"}
                    </td>
                    <td className="py-3.5 px-4 text-[#475569]">
                      {prob.assignment_group || "—"}
                    </td>
                    <td className="py-3.5 px-4 text-[#475569]">
                      {prob.assignee_email || "Unassigned"}
                    </td>
                    <td className="py-3.5 px-4">
                      {prob.related_incidents_count > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE] text-[11px] font-medium">
                          <Link2 className="w-3 h-3" />
                          <span>{prob.related_incidents_count}</span>
                        </span>
                      ) : (
                        <span className="text-[#94A3B8]">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-[#6B7488]">
                      {formatDateTime(prob.updated_at || prob.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
