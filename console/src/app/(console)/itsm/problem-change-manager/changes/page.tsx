"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  GitPullRequest,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  Users,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { ChangeStats, ChangeSummary } from "@/lib/itsm-types";

type FilterStatus = "ALL" | "OPEN" | "IN_PROGRESS" | "SCHEDULED" | "COMPLETED";

function ChangeStatusBadge({ status }: { status: string }) {
  const upper = status.toUpperCase();
  if (upper === "SCHEDULED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
        Scheduled
      </span>
    );
  }
  if (upper === "IN_PROGRESS" || upper === "IMPLEMENTING") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
        {upper === "IMPLEMENTING" ? "Implementing" : "In Progress"}
      </span>
    );
  }
  if (upper === "COMPLETED" || upper === "CLOSED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        Completed
      </span>
    );
  }
  if (upper === "CAB_REVIEW" || upper === "AWAITING_APPROVAL") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        CAB Review
      </span>
    );
  }
  if (upper === "APPROVED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        Approved
      </span>
    );
  }
  if (upper === "FAILED" || upper === "CANCELLED" || upper === "ROLLED_BACK") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
        {upper.replace(/_/g, " ")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      {upper}
    </span>
  );
}

function ChangeTypeBadge({ type }: { type?: string | null }) {
  if (!type) return <span className="text-[#94A3B8]">—</span>;
  const upper = type.toUpperCase();
  if (upper === "EMERGENCY") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        Emergency
      </span>
    );
  }
  if (upper === "NORMAL") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
        Normal
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      Standard
    </span>
  );
}

function RiskBadge({ risk }: { risk?: string | null }) {
  if (!risk) return <span className="text-[#94A3B8]">—</span>;
  const upper = risk.toUpperCase();
  if (upper === "CRITICAL" || upper === "HIGH") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">
        {upper}
      </span>
    );
  }
  if (upper === "MEDIUM") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
        Medium
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      Low
    </span>
  );
}

export default function ChangeManagementQueuePage() {
  const [changes, setChanges] = useState<ChangeSummary[]>([]);
  const [stats, setStats] = useState<ChangeStats>({
    total: 0,
    open: 0,
    in_progress: 0,
    scheduled: 0,
    completed: 0,
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
      const statsRes = await fetch("/api/itsm/changes/stats");
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      // Fetch changes with filters
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "ALL") params.set("status", statusFilter);

      const changesRes = await fetch(`/api/itsm/changes?${params.toString()}`);
      if (changesRes.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (!changesRes.ok) {
        throw new Error(`Failed to load changes (${changesRes.status})`);
      }

      const changesData = await changesRes.json();
      setChanges(Array.isArray(changesData) ? changesData : []);
    } catch (err: any) {
      setError(err?.message || "An error occurred while loading changes queue");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto" id="pcm-changes-page">
      {/* Top Header Banner matching Problem / Knowledge Banner */}
      <div
        className="bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] rounded-2xl p-6 sm:p-8 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
        id="pcm-changes-header"
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/itsm/problem-change-manager"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm hover:bg-white/25 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Dashboard</span>
            </Link>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
              <GitPullRequest className="w-3.5 h-3.5 text-purple-200" />
              <span>Change Governance</span>
            </span>
          </div>

          <h1
            id="pcm-changes-title"
            className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white"
          >
            Changes
          </h1>
          <p id="pcm-changes-subtitle" className="text-sm text-blue-100 max-w-xl">
            Review and manage planned changes to IT services.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold border border-white/20 backdrop-blur-sm transition disabled:opacity-60"
            title="Refresh changes"
            id="pcm-change-refresh-button"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Total */}
        <div
          onClick={() => setStatusFilter("ALL")}
          className={`p-5 rounded-[20px] border bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] cursor-pointer transition-all duration-150 ${
            statusFilter === "ALL"
              ? "border-[#6D28D9] ring-2 ring-[#6D28D9]/10 shadow-[0_4px_16px_-4px_rgba(109,40,217,.12)]"
              : "border-[#E6E9F0] hover:border-[#DDD6FE]"
          }`}
          id="stat-card-total"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6B7488]">Total Changes</span>
            <GitPullRequest className="w-4 h-4 text-[#6D28D9]" />
          </div>
          <p className="text-2xl font-bold text-[#0E1726] mt-2" id="count-total">
            {stats.total}
          </p>
          <span className="text-[11px] text-[#6B7488] mt-1 block">All registered changes</span>
        </div>

        {/* Open */}
        <div
          onClick={() => setStatusFilter("OPEN")}
          className={`p-5 rounded-[20px] border bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] cursor-pointer transition-all duration-150 ${
            statusFilter === "OPEN"
              ? "border-[#2563EB] ring-2 ring-[#2563EB]/10 shadow-[0_4px_16px_-4px_rgba(37,99,235,.12)]"
              : "border-[#E6E9F0] hover:border-[#BFDBFE]"
          }`}
          id="stat-card-open"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6B7488]">Open</span>
            <Clock className="w-4 h-4 text-[#2563EB]" />
          </div>
          <p className="text-2xl font-bold text-[#2563EB] mt-2" id="count-open">
            {stats.open}
          </p>
          <span className="text-[11px] text-[#6B7488] mt-1 block">Draft &amp; CAB review</span>
        </div>

        {/* In Progress */}
        <div
          onClick={() => setStatusFilter("IN_PROGRESS")}
          className={`p-5 rounded-[20px] border bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] cursor-pointer transition-all duration-150 ${
            statusFilter === "IN_PROGRESS"
              ? "border-[#7C3AED] ring-2 ring-[#7C3AED]/10 shadow-[0_4px_16px_-4px_rgba(124,58,237,.12)]"
              : "border-[#E6E9F0] hover:border-[#DDD6FE]"
          }`}
          id="stat-card-in-progress"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6B7488]">In Progress</span>
            <RefreshCw className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <p className="text-2xl font-bold text-[#7C3AED] mt-2" id="count-in-progress">
            {stats.in_progress}
          </p>
          <span className="text-[11px] text-[#6B7488] mt-1 block">Actively implementing</span>
        </div>

        {/* Scheduled */}
        <div
          onClick={() => setStatusFilter("SCHEDULED")}
          className={`p-5 rounded-[20px] border bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] cursor-pointer transition-all duration-150 ${
            statusFilter === "SCHEDULED"
              ? "border-[#0284C7] ring-2 ring-[#0284C7]/10 shadow-[0_4px_16px_-4px_rgba(2,132,199,.12)]"
              : "border-[#E6E9F0] hover:border-[#BAE6FD]"
          }`}
          id="stat-card-scheduled"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6B7488]">Scheduled</span>
            <Calendar className="w-4 h-4 text-[#0284C7]" />
          </div>
          <p className="text-2xl font-bold text-[#0284C7] mt-2" id="count-scheduled">
            {stats.scheduled}
          </p>
          <span className="text-[11px] text-[#6B7488] mt-1 block">Pending change window</span>
        </div>

        {/* Completed */}
        <div
          onClick={() => setStatusFilter("COMPLETED")}
          className={`p-5 rounded-[20px] border bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] cursor-pointer transition-all duration-150 ${
            statusFilter === "COMPLETED"
              ? "border-[#059669] ring-2 ring-[#059669]/10 shadow-[0_4px_16px_-4px_rgba(5,150,105,.12)]"
              : "border-[#E6E9F0] hover:border-[#A7F3D0]"
          }`}
          id="stat-card-completed"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6B7488]">Completed</span>
            <CheckCircle2 className="w-4 h-4 text-[#059669]" />
          </div>
          <p className="text-2xl font-bold text-[#059669] mt-2" id="count-completed">
            {stats.completed}
          </p>
          <span className="text-[11px] text-[#6B7488] mt-1 block">Closed &amp; concluded</span>
        </div>
      </div>

      {/* Controls Bar: Filter Tabs & Search */}
      <div className="p-4 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0" id="pcm-change-status-filters">
          <button
            onClick={() => setStatusFilter("ALL")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap ${
              statusFilter === "ALL"
                ? "bg-[#6D28D9] text-white shadow-xs"
                : "text-[#6B7488] hover:bg-[#F1F5F9] hover:text-[#0E1726]"
            }`}
            id="filter-all"
          >
            All Changes ({stats.total})
          </button>
          <button
            onClick={() => setStatusFilter("OPEN")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap ${
              statusFilter === "OPEN"
                ? "bg-[#2563EB] text-white shadow-xs"
                : "text-[#6B7488] hover:bg-[#F1F5F9] hover:text-[#0E1726]"
            }`}
            id="filter-open"
          >
            Open ({stats.open})
          </button>
          <button
            onClick={() => setStatusFilter("IN_PROGRESS")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap ${
              statusFilter === "IN_PROGRESS"
                ? "bg-[#7C3AED] text-white shadow-xs"
                : "text-[#6B7488] hover:bg-[#F1F5F9] hover:text-[#0E1726]"
            }`}
            id="filter-in_progress"
          >
            In Progress ({stats.in_progress})
          </button>
          <button
            onClick={() => setStatusFilter("SCHEDULED")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap ${
              statusFilter === "SCHEDULED"
                ? "bg-[#0284C7] text-white shadow-xs"
                : "text-[#6B7488] hover:bg-[#F1F5F9] hover:text-[#0E1726]"
            }`}
            id="filter-scheduled"
          >
            Scheduled ({stats.scheduled})
          </button>
          <button
            onClick={() => setStatusFilter("COMPLETED")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap ${
              statusFilter === "COMPLETED"
                ? "bg-[#059669] text-white shadow-xs"
                : "text-[#6B7488] hover:bg-[#F1F5F9] hover:text-[#0E1726]"
            }`}
            id="filter-completed"
          >
            Completed ({stats.completed})
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative shrink-0 sm:w-80">
          <Search className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search changes by number or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-xs text-[#0E1726] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
            id="pcm-search-input"
          />
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Changes Queue Table */}
      <div
        className="rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] overflow-hidden"
        id="pcm-changes-table-container"
      >
        {loading ? (
          <div className="p-16 text-center text-[#6B7488] space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-[#6D28D9]" />
            <p className="text-xs font-medium">Loading Change Management queue...</p>
          </div>
        ) : changes.length === 0 ? (
          <div className="p-16 text-center space-y-3 max-w-sm mx-auto" id="pcm-changes-empty-state">
            <div className="w-12 h-12 rounded-2xl bg-[#F8FAFC] border border-[#E6E9F0] flex items-center justify-center mx-auto text-[#94A3B8]">
              <GitPullRequest className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-[#0E1726]">No Changes found</h3>
            <p className="text-xs text-[#6B7488] leading-relaxed">
              Planned and controlled changes will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E6E9F0] bg-[#F8FAFC] text-[#6B7488] font-semibold">
                  <th className="py-3 px-4">Change #</th>
                  <th className="py-3 px-4 min-w-[220px]">Short Description</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Risk / Impact</th>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Assigned Team</th>
                  <th className="py-3 px-4">Assignee</th>
                  <th className="py-3 px-4">Planned Window</th>
                  <th className="py-3 px-4">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E9F0]" id="pcm-changes-tbody">
                {changes.map((chg) => (
                  <tr
                    key={chg.id}
                    className="hover:bg-[#F8FAFC] transition group"
                  >
                    <td className="py-3.5 px-4 font-semibold text-[#6D28D9] whitespace-nowrap">
                      <Link
                        href={`/itsm/problem-change-manager/changes/${chg.id}`}
                        className="hover:underline inline-flex items-center gap-1"
                      >
                        <span>{chg.change_number}</span>
                        <ExternalLink className="w-3 h-3 text-[#94A3B8] opacity-0 group-hover:opacity-100 transition" />
                      </Link>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-[#0E1726]">{chg.title}</div>
                      {chg.description && (
                        <p className="text-[#64748B] text-[11px] truncate max-w-xs mt-0.5">
                          {chg.description}
                        </p>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <ChangeStatusBadge status={chg.status} />
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <ChangeTypeBadge type={chg.change_type} />
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <RiskBadge risk={chg.risk_level} />
                        {chg.impact_level && chg.impact_level !== chg.risk_level && (
                          <span className="text-[10px] text-[#94A3B8]">
                            Imp: {chg.impact_level}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {chg.service_name ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-[#0E1726]">
                          <Layers className="w-3.5 h-3.5 text-[#6D28D9]" />
                          <span>{chg.service_name}</span>
                        </span>
                      ) : (
                        <span className="text-[#94A3B8]">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-[#475569]">
                      {chg.assigned_team || "—"}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-[#475569]">
                      {chg.assignee_email ? (
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3 h-3 text-[#94A3B8]" />
                          <span className="truncate max-w-[140px]">{chg.assignee_email}</span>
                        </span>
                      ) : (
                        <span className="text-[#94A3B8]">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-[#64748B] text-[11px]">
                      {chg.earliest_start_at ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 text-[#0E1726] font-medium">
                            <Calendar className="w-3 h-3 text-[#2563EB]" />
                            <span>{formatDateTime(chg.earliest_start_at)}</span>
                          </div>
                          {chg.latest_finish_at && (
                            <div className="text-[#64748B] text-[10px] pl-4">
                              until {formatDateTime(chg.latest_finish_at)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[#94A3B8]">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-[#6B7488]">
                      {formatDateTime(chg.updated_at)}
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
