"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sliders,
  Users,
  Clock,
  Shield,
  Server,
  Database,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Settings,
  Cpu,
  Layers,
  Key,
  Radio,
} from "lucide-react";
import { Incident } from "@/lib/itsm-types";

export default function PlatformAdminDashboardPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/api/itsm/incidents?limit=5");
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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-[#065F46] to-[#059669] rounded-2xl p-6 sm:p-8 text-white shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <Sliders className="w-3.5 h-3.5" />
            <span>Platform &amp; Systems Administration Workspace</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            ITSM System &amp; Policy Architecture
          </h1>
          <p className="text-sm text-emerald-100 max-w-xl">
            Configure multi-tenant assignment groups, SLA business hours, service catalog definitions, and AI copilot agents.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/itsm/incidents"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#065F46] font-bold text-xs hover:bg-emerald-50 transition shadow-sm"
          >
            <span>Incident Console</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active ITSM Agents</span>
            <Users className="w-4 h-4 text-[#059669]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">14</div>
          <p className="text-xs text-[#6B7488] mt-1">Across 4 assignment groups</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Configured Groups</span>
            <Layers className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">6</div>
          <p className="text-xs text-[#6B7488] mt-1">Tier 1, Cloud, DB, Security...</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">SLA Policies Active</span>
            <Clock className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">4</div>
          <p className="text-xs text-[#6B7488] mt-1">Default 24x7 + Business 8x5</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Postgres RLS Security</span>
            <Database className="w-4 h-4 text-[#10B981]" />
          </div>
          <div className="text-2xl font-bold text-[#10B981]">Enforced</div>
          <p className="text-xs text-[#6B7488] mt-1">100% tenant isolation</p>
        </div>
      </div>

      {/* Configuration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#059669] flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#0E1726]">Assignment Groups &amp; Triage Pools</h3>
            <p className="text-xs text-[#6B7488] mt-1 leading-relaxed">
              Define routing rules, agent membership, tier-escalation paths, and fallback owners for incoming incidents.
            </p>
          </div>
          <div className="pt-2 border-t border-[#F0F2F6] flex items-center justify-between text-xs">
            <span className="text-[#6B7488]">6 active pools</span>
            <span className="font-semibold text-[#059669]">Configured</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#2563EB] flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#0E1726]">SLA Policies &amp; Calendars</h3>
            <p className="text-xs text-[#6B7488] mt-1 leading-relaxed">
              Manage response targets, resolution countdowns, business calendar schedules, and pause condition policies.
            </p>
          </div>
          <div className="pt-2 border-t border-[#F0F2F6] flex items-center justify-between text-xs">
            <span className="text-[#6B7488]">P1–P4 Matrix</span>
            <span className="font-semibold text-[#2563EB]">Active</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-[#7C3AED] flex items-center justify-center">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#0E1726]">LangGraph AI Copilot Settings</h3>
            <p className="text-xs text-[#6B7488] mt-1 leading-relaxed">
              Configure triage reasoning models, autonomous runbook boundaries, human-in-the-loop approval thresholds.
            </p>
          </div>
          <div className="pt-2 border-t border-[#F0F2F6] flex items-center justify-between text-xs">
            <span className="text-[#6B7488]">HITL Required</span>
            <span className="font-semibold text-[#7C3AED]">Enabled</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-[#D97706] flex items-center justify-center">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#0E1726]">Broadcast Delivery &amp; Diagnostics</h3>
            <p className="text-xs text-[#6B7488] mt-1 leading-relaxed">
              Monitor outage notification dispatch, in-app/portal delivery trace, channel errors, and service audience targeting.
            </p>
          </div>
          <div className="pt-2 border-t border-[#F0F2F6] flex items-center justify-between text-xs">
            <Link
              href="/itsm/admin-portal/broadcast-health"
              className="font-semibold text-[#D97706] hover:underline inline-flex items-center gap-1"
            >
              <span>Broadcast Health</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
            <span className="font-semibold text-[#059669]">Operational</span>
          </div>
        </div>
      </div>
    </div>
  );
}
