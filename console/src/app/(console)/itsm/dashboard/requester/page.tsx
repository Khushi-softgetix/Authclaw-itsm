"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  User,
  Plus,
  BookOpen,
  Clock,
  CheckCircle2,
  AlertCircle,
  Zap,
} from "lucide-react";
import { Incident } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import { formatDateTime } from "@/lib/itsm-format";

interface DashboardStats {
  open_tickets_count: number;
  resolved_tickets_count: number;
  pending_action_count: number;
  avg_resolution_hours: number;
}

export default function RequesterDashboardPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    open_tickets_count: 0,
    resolved_tickets_count: 0,
    pending_action_count: 0,
    avg_resolution_hours: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [incRes, statsRes] = await Promise.all([
          fetch("/api/itsm/incidents?limit=10"),
          fetch("/api/itsm/incidents/summary"),
        ]);
        if (incRes.ok) {
          const data = await incRes.json();
          setIncidents(Array.isArray(data) ? data : []);
        }
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }
      } catch (e) {
        // non-blocking
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
        <div className="flex items-start sm:items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#DDCEFB] text-[#6D28D9] flex items-center justify-center shrink-0">
            <User className="w-6 h-6" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-[11px] font-semibold mb-1 border border-[#DDD6FE]">
              <span>Requester Self-Service Portal</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight">
              How can IT Operations help you today?
            </h1>
            <p className="text-xs text-[#6B7488] mt-1 max-w-xl">
              Submit issues, request access, or search our verified knowledge base for immediate solutions.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/itsm/incidents/new"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Report an Issue</span>
          </Link>
          <Link
            href="/itsm/knowledge"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#F1ECFE] hover:bg-[#E9DFFC] text-[#6D28D9] border border-[#DDD6FE] rounded-xl text-xs font-semibold shadow-xs transition"
          >
            <BookOpen className="w-4 h-4" />
            <span>Browse KB</span>
          </Link>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">My Active Tickets</span>
            <AlertCircle className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">
            {loading ? "..." : stats.open_tickets_count}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Currently under investigation</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Resolved Tickets</span>
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">
            {loading ? "..." : stats.resolved_tickets_count}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Completed solutions</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending Action</span>
            <Clock className="w-4 h-4 text-[#D97706]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">
            {loading ? "..." : stats.pending_action_count}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Awaiting your feedback</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Avg Resolution Time</span>
            <Zap className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">
            {loading ? "..." : `${stats.avg_resolution_hours} hrs`}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Within SLA targets</p>
        </div>
      </div>

      {/* My Incidents */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#0E1726]">My Incidents</h2>
          <div className="flex items-center gap-3">
            <Link
              href="/itsm/incidents"
              className="text-xs font-semibold text-[#475069] hover:text-[#0E1726]"
            >
              View All
            </Link>
            <Link
              href="/itsm/incidents/new"
              className="text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Report an Issue</span>
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-[#6B7488]">Loading your incidents...</div>
        ) : incidents.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-purple-50 text-[#6D28D9] flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-[#0E1726]">You have no active incidents</p>
            <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
              Everything looks healthy. If you experience an issue, click &quot;Report an Issue&quot; above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#F0F2F6] text-[#8C95A8] font-bold uppercase tracking-wider">
                  <th className="pb-3">Incident #</th>
                  <th className="pb-3">Title / Problem</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Priority</th>
                  <th className="pb-3">Created / Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F2F6]">
                {incidents.map((inc) => (
                  <tr key={inc.id} className="hover:bg-[#F9FAFB] transition">
                    <td className="py-3 font-mono font-bold text-[#6D28D9]">
                      <Link href={`/itsm/incidents/${inc.id}`} className="hover:underline">
                        {inc.ticket_number}
                      </Link>
                    </td>
                    <td className="py-3 font-medium text-[#0E1726] max-w-[240px] truncate">
                      <Link href={`/itsm/incidents/${inc.id}`} className="hover:text-[#6D28D9]">
                        {inc.title}
                      </Link>
                    </td>
                    <td className="py-3">
                      <IncidentStatusBadge status={inc.status} />
                    </td>
                    <td className="py-3">
                      <IncidentPriorityBadge priority={inc.priority} />
                    </td>
                    <td className="py-3 text-[#6B7488]">
                      {formatDateTime(inc.updated_at || inc.created_at)}
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
