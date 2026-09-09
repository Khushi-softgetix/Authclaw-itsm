"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  GitPullRequest,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  Zap,
  Layers,
} from "lucide-react";
import { Incident } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import { formatDateTime } from "@/lib/itsm-format";

export default function ProcessChangeDashboardPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/api/itsm/incidents?limit=10");
        if (res.ok) {
          const data = await res.json();
          setIncidents(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        // non-blocking
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-[#B45309] to-[#D97706] rounded-2xl p-6 sm:p-8 text-white shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <GitPullRequest className="w-3.5 h-3.5" />
            <span>Change Advisory Board (CAB) &amp; Stability Governance</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Change &amp; Problem Governance
          </h1>
          <p className="text-sm text-amber-100 max-w-xl">
            Evaluate production change risk, detect deployment collisions, and investigate recurring incident root causes.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/itsm/incidents"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#B45309] font-bold text-xs hover:bg-amber-50 transition shadow-sm"
          >
            <span>Linked Incidents</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending CAB Approvals</span>
            <Clock className="w-4 h-4 text-[#D97706]" />
          </div>
          <div className="text-2xl font-bold text-[#D97706]">3</div>
          <p className="text-xs text-[#6B7488] mt-1">Scheduled for next review window</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Emergency Changes (7d)</span>
            <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">1</div>
          <p className="text-xs text-[#6B7488] mt-1">Fast-track authorization verified</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Problem Clusters</span>
            <Layers className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#7C3AED]">2</div>
          <p className="text-xs text-[#6B7488] mt-1">Repeat incident root-cause investigations</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Change Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
          </div>
          <div className="text-2xl font-bold text-[#10B981]">99.4%</div>
          <p className="text-xs text-[#6B7488] mt-1">Zero rollback failures in 30 days</p>
        </div>
      </div>

      {/* Main Grid: Pending Changes & Problem Investigation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: CAB Review Queue */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#0E1726]">Pending Change Advisory Queue</h2>
            <span className="text-xs font-semibold text-[#D97706] bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
              CAB Session: Thursday 14:00 UTC
            </span>
          </div>

          <div className="space-y-3">
            {[
              {
                id: "CHG-000482",
                title: "Upgrade Production Postgres Read Replica to v16.4",
                service: "Database Cluster",
                risk: "Low",
                riskColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
                schedule: "Saturday 02:00 UTC (15m window)",
                conflict: "Zero collisions detected",
              },
              {
                id: "CHG-000483",
                title: "Ingress Gateway Envoy Mesh TLS Cipher Suite Refresh",
                service: "API Gateway",
                risk: "Medium",
                riskColor: "bg-amber-50 text-amber-700 border-amber-200",
                schedule: "Sunday 01:00 UTC (30m window)",
                conflict: "Non-disruptive rolling restart",
              },
              {
                id: "CHG-000484",
                title: "Kafka Event Broker Retention Tiering Configuration",
                service: "Event Streaming",
                risk: "High",
                riskColor: "bg-red-50 text-red-700 border-red-200",
                schedule: "Sunday 04:00 UTC (45m window)",
                conflict: "Peer review required by Cloud Ops",
              },
            ].map((chg) => (
              <div
                key={chg.id}
                className="p-4 rounded-xl border border-[#E6E9F0] hover:border-[#CBD5E1] transition space-y-2 bg-[#FAFBFD]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-[#D97706]">{chg.id}</span>
                    <span className="text-xs text-[#6B7488]">· {chg.service}</span>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border ${chg.riskColor}`}
                  >
                    Risk: {chg.risk}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-[#0E1726]">{chg.title}</h4>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[#6B7488] pt-1">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {chg.schedule}
                  </span>
                  <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {chg.conflict}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Col: Problem Clusters & Linked Incidents */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0E1726]">
              Problem Root Cause Clusters
            </h3>
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl border border-purple-100 bg-purple-50/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[11px] text-purple-700">PRB-00012</span>
                  <span className="text-[10px] font-bold bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">
                    Under RCA
                  </span>
                </div>
                <div className="font-semibold text-[#0E1726]">Redis Connection Pool Throttling</div>
                <p className="text-[11px] text-[#6B7488]">Linked to 3 repeat P2 incidents this month.</p>
              </div>

              <div className="p-3 rounded-xl border border-blue-100 bg-blue-50/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[11px] text-blue-700">PRB-00013</span>
                  <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
                    Fix Ready
                  </span>
                </div>
                <div className="font-semibold text-[#0E1726]">OIDC Token Clock-Skew Margin</div>
                <p className="text-[11px] text-[#6B7488]">Patch included in release candidate 2.4.1.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
