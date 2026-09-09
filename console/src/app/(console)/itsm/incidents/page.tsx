"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { Incident } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";

const STATUS_FILTER_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "New", value: "NEW" },
  { label: "Assigned", value: "ASSIGNED" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Pending", value: "PENDING" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
  { label: "Cancelled", value: "CANCELLED" },
];

const PRIORITY_FILTER_OPTIONS = [
  { label: "All Priorities", value: "" },
  { label: "P1 · Critical", value: "P1" },
  { label: "P2 · High", value: "P2" },
  { label: "P3 · Medium", value: "P3" },
  { label: "P4 · Low", value: "P4" },
];

const PAGE_SIZE = 20;

export default function IncidentListPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [offset, setOffset] = useState<number>(0);

  const fetchIncidents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      const res = await fetch(`/api/itsm/incidents?${params.toString()}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to load incidents");
      }

      const data = await res.json();
      setIncidents(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, priorityFilter, offset]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  // Derived metrics from loaded dataset
  const openCount = incidents.filter((i) => ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"].includes(i.status)).length;
  const p1Count = incidents.filter((i) => i.priority === "P1" && i.status !== "CLOSED" && i.status !== "CANCELLED").length;
  const inProgressCount = incidents.filter((i) => i.status === "IN_PROGRESS").length;
  const resolvedCount = incidents.filter((i) => i.status === "RESOLVED").length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#6D28D9] mb-1">
            AuthClaw ITSM · Service Operations
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-[#0E1726]">
            Incident Management
          </h1>
          <p className="text-[#6B7488] text-sm mt-1">
            Prioritize disruptions, restore services, and track operational responses.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/itsm/incidents/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Create Incident
          </Link>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-[16px] border border-[#E6E9F0] p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#6B7488] font-medium">
            <span>Open Incidents</span>
            <AlertCircle className="w-4 h-4 text-[#6B7488]" />
          </div>
          <div className="text-2xl font-extrabold text-[#0E1726] mt-2">{openCount}</div>
          <p className="text-[11px] text-[#6B7488] mt-1">Requiring active resolution</p>
        </div>

        <div className="bg-white rounded-[16px] border border-[#E6E9F0] p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#6B7488] font-medium">
            <span>Critical (P1)</span>
            <Flame className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-2xl font-extrabold text-red-600 mt-2">{p1Count}</div>
          <p className="text-[11px] text-[#6B7488] mt-1">Severe business impact</p>
        </div>

        <div className="bg-white rounded-[16px] border border-[#E6E9F0] p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#6B7488] font-medium">
            <span>In Progress</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-amber-600 mt-2">{inProgressCount}</div>
          <p className="text-[11px] text-[#6B7488] mt-1">Under active triage/fix</p>
        </div>

        <div className="bg-white rounded-[16px] border border-[#E6E9F0] p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#6B7488] font-medium">
            <span>Resolved</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-600 mt-2">{resolvedCount}</div>
          <p className="text-[11px] text-[#6B7488] mt-1">Pending closure verification</p>
        </div>
      </div>

      {/* Toolbar & Filters */}
      <div className="bg-white rounded-[16px] border border-[#E6E9F0] p-4 shadow-sm">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7488]" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder="Search by ticket number, summary, or description..."
              className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-lg pl-9 pr-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setOffset(0);
              }}
              className="bg-white border border-[#E6E9F0] text-[#475069] text-xs rounded-lg px-3 py-2 focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              value={priorityFilter}
              onChange={(e) => {
                setPriorityFilter(e.target.value);
                setOffset(0);
              }}
              className="bg-white border border-[#E6E9F0] text-[#475069] text-xs rounded-lg px-3 py-2 focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            >
              {PRIORITY_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              onClick={() => fetchIncidents()}
              disabled={loading}
              className="p-2 rounded-lg border border-[#E6E9F0] text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
              title="Refresh incidents"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => fetchIncidents()}
            className="font-semibold underline hover:text-red-900 ml-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Incidents Table */}
      <div className="bg-white rounded-[20px] border border-[#E6E9F0] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#F5F7FA] border-b border-[#E6E9F0]">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[#6B7488]">
                  Ticket #
                </th>
                <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[#6B7488]">
                  Summary
                </th>
                <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[#6B7488]">
                  Status
                </th>
                <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[#6B7488]">
                  Priority
                </th>
                <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[#6B7488]">
                  Impact / Urgency
                </th>
                <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[#6B7488]">
                  Assignee / Group
                </th>
                <th className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-[#6B7488]">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E9F0]">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="py-4 px-4"><div className="h-4 bg-slate-100 rounded w-20" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-100 rounded w-48" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-100 rounded w-20" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-100 rounded w-16" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-100 rounded w-24" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-100 rounded w-28" /></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-100 rounded w-24" /></td>
                  </tr>
                ))
              ) : incidents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <SlidersHorizontal className="w-8 h-8 text-[#A8B0C0] mx-auto mb-2" />
                    <p className="text-sm font-semibold text-[#0E1726]">No incidents found</p>
                    <p className="text-xs text-[#6B7488] mt-1">
                      Try adjusting your filters or create a new incident.
                    </p>
                  </td>
                </tr>
              ) : (
                incidents.map((t) => (
                  <tr
                    key={t.id}
                    className="hover:bg-[#F5F7FA]/70 transition-colors group cursor-pointer"
                  >
                    <td className="py-3.5 px-4">
                      <Link
                        href={`/itsm/incidents/${t.id}`}
                        className="font-mono text-xs font-bold text-[#6D28D9] hover:underline"
                      >
                        {t.ticket_number}
                      </Link>
                      {t.is_major_incident && (
                        <span className="block text-[9px] uppercase tracking-wider font-bold text-red-600 mt-0.5">
                          Major
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 max-w-xs">
                      <Link
                        href={`/itsm/incidents/${t.id}`}
                        className="text-xs font-semibold text-[#0E1726] hover:text-[#6D28D9] line-clamp-1"
                      >
                        {t.title}
                      </Link>
                      <span className="text-[11px] text-[#6B7488]">
                        {t.category} {t.subcategory ? `· ${t.subcategory}` : ""}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <IncidentStatusBadge status={t.status} />
                    </td>
                    <td className="py-3.5 px-4">
                      <IncidentPriorityBadge priority={t.priority} />
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#475069]">
                      <span>{t.impact}</span> / <span>{t.urgency}</span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#475069]">
                      <div className="font-medium text-[#0E1726]">
                        {t.assignment_group || "No Group"}
                      </div>
                      <span className="text-[11px] text-[#6B7488]">
                        {t.assignee_id ? "Assigned" : "Unassigned"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#6B7488] font-mono whitespace-nowrap">
                      {formatDateTime(t.updated_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer / Pagination */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#E6E9F0] bg-[#F5F7FA] text-xs text-[#6B7488]">
          <span>
            Showing {incidents.length} record{incidents.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-[#475069] hover:bg-[#F5F7FA] disabled:opacity-40 transition"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={incidents.length < PAGE_SIZE || loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-[#475069] hover:bg-[#F5F7FA] disabled:opacity-40 transition"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
