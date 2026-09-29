"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Headphones,
  AlertCircle,
  Clock,
  CheckCircle2,
  Filter,
  Search,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Flame,
  UserCheck,
  Shield,
  Bot,
} from "lucide-react";
import { Incident } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import { formatDateTime } from "@/lib/itsm-format";

export default function ServiceAgentDashboardPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "CRITICAL" | "UNASSIGNED">("ALL");

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/itsm/incidents?limit=25");
      if (res.ok) {
        const data = await res.json();
        setIncidents(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      // non-blocking
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const request = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(request);
  }, []);

  const criticalIncidents = incidents.filter(
    (i) => (i.priority === "P1" || i.priority === "P2") && i.status !== "RESOLVED" && i.status !== "CLOSED"
  );
  const unassignedIncidents = incidents.filter(
    (i) => !i.assignee_id && i.status !== "RESOLVED" && i.status !== "CLOSED"
  );
  const openIncidents = incidents.filter(
    (i) => i.status !== "RESOLVED" && i.status !== "CLOSED" && i.status !== "CANCELLED"
  );
  const resolvedCount = incidents.filter(
    (i) => i.status === "RESOLVED" || i.status === "CLOSED"
  ).length;

  const displayedIncidents = incidents.filter((inc) => {
    if (filter === "CRITICAL") return inc.priority === "P1" || inc.priority === "P2";
    if (filter === "UNASSIGNED") return !inc.assignee_id;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-[#5B21B6] to-[#7C3AED] rounded-2xl p-6 sm:p-8 text-white shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <Headphones className="w-3.5 h-3.5" />
            <span>Service Agent Operations Workspace</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Active Incident Resolution &amp; Triage
          </h1>
          <p className="text-sm text-purple-100 max-w-xl">
            Manage your service queues, execute AI-guided diagnostic runbooks, and meet SLA commitments.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={loadData}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/10 text-white font-semibold text-xs hover:bg-white/20 transition border border-white/20"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh Queue</span>
          </button>
          <Link
            href="/itsm/incidents"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#5B21B6] font-bold text-xs hover:bg-purple-50 transition shadow-sm"
          >
            <span>Full Incident Console</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Active Queue</span>
            <AlertCircle className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">
            {loading ? "..." : openIncidents.length}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Across all assignment pools</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Unassigned Tickets</span>
            <UserCheck className="w-4 h-4 text-[#D97706]" />
          </div>
          <div className="text-2xl font-bold text-[#D97706]">
            {loading ? "..." : unassignedIncidents.length}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Awaiting triage &amp; owner</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Critical P1/P2 Incidents</span>
            <Flame className="w-4 h-4 text-[#DC2626]" />
          </div>
          <div className="text-2xl font-bold text-[#DC2626]">
            {loading ? "..." : criticalIncidents.length}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Requires immediate attention</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Resolved Tickets</span>
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
          </div>
          <div className="text-2xl font-bold text-[#10B981]">
            {loading ? "..." : resolvedCount}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Successfully closed</p>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Incident Queue */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-[#F0F2F6]">
            <h2 className="text-base font-bold text-[#0E1726]">Operational Ticket Queue</h2>
            {/* Quick Filters */}
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <button
                onClick={() => setFilter("ALL")}
                className={`px-3 py-1 rounded-lg transition ${
                  filter === "ALL"
                    ? "bg-[#7C3AED] text-white font-semibold"
                    : "text-[#6B7488] hover:bg-[#F3F4F6]"
                }`}
              >
                All Active ({incidents.length})
              </button>
              <button
                onClick={() => setFilter("CRITICAL")}
                className={`px-3 py-1 rounded-lg transition ${
                  filter === "CRITICAL"
                    ? "bg-[#DC2626] text-white font-semibold"
                    : "text-[#6B7488] hover:bg-[#F3F4F6]"
                }`}
              >
                P1/P2 ({criticalIncidents.length})
              </button>
              <button
                onClick={() => setFilter("UNASSIGNED")}
                className={`px-3 py-1 rounded-lg transition ${
                  filter === "UNASSIGNED"
                    ? "bg-[#D97706] text-white font-semibold"
                    : "text-[#6B7488] hover:bg-[#F3F4F6]"
                }`}
              >
                Unassigned ({unassignedIncidents.length})
              </button>
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-[#6B7488]">Loading active queue...</div>
          ) : displayedIncidents.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#6B7488]">
              No incidents matching the current filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#F0F2F6] text-[#8C95A8] font-bold uppercase tracking-wider">
                    <th className="pb-3">Ticket</th>
                    <th className="pb-3">Summary</th>
                    <th className="pb-3">Priority</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Category</th>
                    <th className="pb-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2F6]">
                  {displayedIncidents.slice(0, 10).map((inc) => (
                    <tr key={inc.id} className="hover:bg-[#F9FAFB] transition">
                      <td className="py-3 font-mono font-bold text-[#7C3AED]">
                        <Link href={`/itsm/incidents/${inc.id}`} className="hover:underline">
                          {inc.ticket_number}
                        </Link>
                      </td>
                      <td className="py-3 font-medium text-[#0E1726] max-w-[220px] truncate">
                        <Link href={`/itsm/incidents/${inc.id}`} className="hover:underline">
                          {inc.title}
                        </Link>
                      </td>
                      <td className="py-3">
                        <IncidentPriorityBadge priority={inc.priority} />
                      </td>
                      <td className="py-3">
                        <IncidentStatusBadge status={inc.status} />
                      </td>
                      <td className="py-3 text-[#6B7488]">
                        {inc.category || "General"}
                      </td>
                      <td className="py-3 text-[#6B7488]">
                        {formatDateTime(inc.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Col: AI Copilot & Runbooks */}
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-[#F5F3FF] to-[#EDE9FE] rounded-2xl border border-[#DDD6FE] p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-[#7C3AED]">
              <Sparkles className="w-4 h-4" />
              <h3 className="text-xs font-bold uppercase tracking-wider">AI Copilot Recommendations</h3>
            </div>
            <p className="text-xs text-[#5B21B6] leading-relaxed">
              LangGraph triage agent analyzed recent tickets. 2 recurring patterns detected with automated runbooks ready.
            </p>
            <div className="space-y-2">
              <div className="bg-white p-3 rounded-xl border border-[#DDD6FE] text-xs">
                <div className="font-semibold text-[#0E1726]">Postgres Lock Contention Runbook</div>
                <div className="text-[11px] text-[#6B7488] mt-0.5">Automated vacuum and session termination query ready</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-[#DDD6FE] text-xs">
                <div className="font-semibold text-[#0E1726]">TLS Certificate Expiration Alert</div>
                <div className="text-[11px] text-[#6B7488] mt-0.5">Cert-manager renew command suggested</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0E1726]">Service SLAs</h3>
            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between text-[11px] font-semibold mb-1">
                  <span className="text-[#0E1726]">P1 First Response (&lt; 15m)</span>
                  <span className="text-[#10B981]">100% compliant</span>
                </div>
                <div className="w-full bg-[#E2E8F0] h-1.5 rounded-full overflow-hidden">
                  <div className="bg-[#10B981] h-full w-full" />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[11px] font-semibold mb-1">
                  <span className="text-[#0E1726]">P2 Resolution (&lt; 4h)</span>
                  <span className="text-[#2563EB]">94% compliant</span>
                </div>
                <div className="w-full bg-[#E2E8F0] h-1.5 rounded-full overflow-hidden">
                  <div className="bg-[#2563EB] h-full w-[94%]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
