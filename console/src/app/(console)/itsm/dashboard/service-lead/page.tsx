"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  Flame,
  Clock,
  CheckCircle2,
  Users,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Radio,
  ExternalLink,
  Layers,
  Activity,
} from "lucide-react";
import { Incident } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import { formatDateTime } from "@/lib/itsm-format";

export default function ServiceLeadDashboardPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/itsm/incidents?limit=50");
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

  const majorIncidents = incidents.filter(
    (i) => (i.priority === "P1" || i.priority === "P2") && i.status !== "RESOLVED" && i.status !== "CLOSED"
  );
  const totalOpen = incidents.filter(
    (i) => i.status !== "RESOLVED" && i.status !== "CLOSED" && i.status !== "CANCELLED"
  ).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-[#991B1B] to-[#DC2626] rounded-2xl p-6 sm:p-8 text-white shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Service Lead &amp; Major Incident Command</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Incident Operations &amp; Crisis Command
          </h1>
          <p className="text-sm text-red-100 max-w-xl">
            Unified visibility across all service queues, live major incident containment, and SLA performance governance.
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
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#991B1B] font-bold text-xs hover:bg-red-50 transition shadow-sm"
          >
            <span>All Incidents Console</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Major Incidents (P1/P2)</span>
            <Flame className="w-4 h-4 text-[#DC2626]" />
          </div>
          <div className="text-2xl font-bold text-[#DC2626]">
            {loading ? "..." : majorIncidents.length}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">High-impact active crisis</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Active Backlog</span>
            <Layers className="w-4 h-4 text-[#D97706]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">
            {loading ? "..." : totalOpen}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Open tickets awaiting closure</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Mean Time To Resolve</span>
            <Clock className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">42 min</div>
          <p className="text-xs text-[#6B7488] mt-1">-18% vs 30-day baseline</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Overall SLA Compliance</span>
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
          </div>
          <div className="text-2xl font-bold text-[#10B981]">98.2%</div>
          <p className="text-xs text-[#6B7488] mt-1">Target: &gt;= 95.0%</p>
        </div>
      </div>

      {/* Major Incident Command Alert Bar */}
      {majorIncidents.length > 0 && (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-700 font-bold text-sm">
              <Radio className="w-4 h-4 text-red-600 animate-pulse" />
              <span>ACTIVE MAJOR INCIDENT COMMAND ROOM</span>
            </div>
            <span className="px-2.5 py-1 bg-red-600 text-white text-[10px] font-extrabold uppercase rounded-full">
              War Room Open
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {majorIncidents.map((mi) => (
              <div
                key={mi.id}
                className="bg-white rounded-xl p-4 border border-red-200 shadow-sm space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-red-600 text-xs">
                    {mi.ticket_number}
                  </span>
                  <IncidentPriorityBadge priority={mi.priority} />
                </div>
                <h4 className="text-xs font-bold text-[#0E1726] line-clamp-1">{mi.title}</h4>
                <p className="text-[11px] text-[#6B7488]">
                  Impact: {mi.impact} · Urgency: {mi.urgency} · Status: {mi.status}
                </p>
                <div className="pt-2 flex items-center justify-between border-t border-[#F0F2F6]">
                  <span className="text-[11px] text-[#6B7488]">
                    Updated {formatDateTime(mi.updated_at)}
                  </span>
                  <Link
                    href={`/itsm/incidents/${mi.id}`}
                    className="text-xs font-bold text-red-600 hover:text-red-700 inline-flex items-center gap-1"
                  >
                    Open Bridge &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Queues & Backlog Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 cols: Queue Overview */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#0E1726]">Global Incident Stream</h2>
            <Link
              href="/itsm/incidents"
              className="text-xs font-semibold text-[#DC2626] hover:text-[#991B1B] flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-[#6B7488]">Loading queue stream...</div>
          ) : incidents.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#6B7488]">No incidents recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#F0F2F6] text-[#8C95A8] font-bold uppercase tracking-wider">
                    <th className="pb-3">Ticket</th>
                    <th className="pb-3">Title</th>
                    <th className="pb-3">Priority</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Category</th>
                    <th className="pb-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2F6]">
                  {incidents.slice(0, 10).map((inc) => (
                    <tr key={inc.id} className="hover:bg-[#F9FAFB] transition">
                      <td className="py-3 font-mono font-bold text-[#DC2626]">
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
                      <td className="py-3 text-[#6B7488]">{inc.category || "General"}</td>
                      <td className="py-3 text-[#6B7488]">{formatDateTime(inc.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Col: Team Queue Balancing */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0E1726]">
              Workload by Assignment Pool
            </h3>
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F8FAFC]">
                <div>
                  <span className="font-semibold text-[#0E1726]">Cloud Platform Ops</span>
                  <p className="text-[10px] text-[#6B7488]">4 active agents</p>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 font-bold text-xs">
                  8 tickets
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F8FAFC]">
                <div>
                  <span className="font-semibold text-[#0E1726]">Security &amp; IAM</span>
                  <p className="text-[10px] text-[#6B7488]">2 active agents</p>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 font-bold text-xs">
                  3 tickets
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F8FAFC]">
                <div>
                  <span className="font-semibold text-[#0E1726]">Database Core Tier</span>
                  <p className="text-[10px] text-[#6B7488]">3 active agents</p>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 font-bold text-xs">
                  5 tickets
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F8FAFC]">
                <div>
                  <span className="font-semibold text-[#0E1726]">Tier 1 Helpdesk</span>
                  <p className="text-[10px] text-[#6B7488]">5 active agents</p>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-bold text-xs">
                  12 tickets
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
