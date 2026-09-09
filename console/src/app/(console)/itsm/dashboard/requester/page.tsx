"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  User,
  Plus,
  Search,
  BookOpen,
  LifeBuoy,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  Laptop,
  Key,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Incident } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import { formatDateTime } from "@/lib/itsm-format";

export default function RequesterDashboardPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchKnowledge, setSearchKnowledge] = useState("");

  useEffect(() => {
    async function loadData() {
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
    loadData();
  }, []);

  const openTickets = incidents.filter(
    (i) => i.status !== "RESOLVED" && i.status !== "CLOSED" && i.status !== "CANCELLED"
  );
  const resolvedTickets = incidents.filter(
    (i) => i.status === "RESOLVED" || i.status === "CLOSED"
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] rounded-2xl p-6 sm:p-8 text-white shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <User className="w-3.5 h-3.5" />
            <span>Requester Self-Service Portal</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            How can IT Operations help you today?
          </h1>
          <p className="text-sm text-blue-100 max-w-xl">
            Submit issues, request access, or search our verified knowledge base for immediate solutions.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/itsm/incidents"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#1E40AF] font-bold text-xs hover:bg-blue-50 transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Report an Incident</span>
          </Link>
          <a
            href="#knowledge"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 text-white font-semibold text-xs hover:bg-white/20 transition border border-white/20"
          >
            <BookOpen className="w-4 h-4" />
            <span>Browse KB</span>
          </a>
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
            {loading ? "..." : openTickets.length}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Currently under investigation</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Resolved Tickets</span>
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">
            {loading ? "..." : resolvedTickets.length}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">Completed solutions</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending Action</span>
            <Clock className="w-4 h-4 text-[#D97706]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">0</div>
          <p className="text-xs text-[#6B7488] mt-1">Awaiting your feedback</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Avg Resolution Time</span>
            <Zap className="w-4 h-4 text-[#7C3AED]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">1.8 hrs</div>
          <p className="text-xs text-[#6B7488] mt-1">Within SLA targets</p>
        </div>
      </div>

      {/* Quick Catalog Actions */}
      <div className="bg-white p-6 rounded-2xl border border-[#E6E9F0] shadow-sm space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#0E1726]">
          Fast Service Catalog Requests
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link
            href="/itsm/incidents"
            className="flex items-start gap-3 p-4 rounded-xl border border-[#E6E9F0] hover:border-[#2563EB] hover:bg-[#F8FAFC] transition group"
          >
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition">
              <Laptop className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#0E1726]">Hardware &amp; Equipment</div>
              <div className="text-[11px] text-[#6B7488] mt-0.5">Monitors, laptops, and peripherals</div>
            </div>
          </Link>

          <Link
            href="/itsm/incidents"
            className="flex items-start gap-3 p-4 rounded-xl border border-[#E6E9F0] hover:border-[#7C3AED] hover:bg-[#F8FAFC] transition group"
          >
            <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition">
              <Key className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#0E1726]">Software Access &amp; SSO</div>
              <div className="text-[11px] text-[#6B7488] mt-0.5">GitHub, AWS, and SaaS licenses</div>
            </div>
          </Link>

          <Link
            href="/itsm/incidents"
            className="flex items-start gap-3 p-4 rounded-xl border border-[#E6E9F0] hover:border-[#10B981] hover:bg-[#F8FAFC] transition group"
          >
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition">
              <ShieldCheck className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#0E1726]">Security &amp; MFA Reset</div>
              <div className="text-[11px] text-[#6B7488] mt-0.5">Token lost or credentials locked</div>
            </div>
          </Link>

          <Link
            href="/itsm/incidents"
            className="flex items-start gap-3 p-4 rounded-xl border border-[#E6E9F0] hover:border-[#D97706] hover:bg-[#F8FAFC] transition group"
          >
            <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition">
              <LifeBuoy className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#0E1726]">General IT Assistance</div>
              <div className="text-[11px] text-[#6B7488] mt-0.5">WiFi, VPN, or conference systems</div>
            </div>
          </Link>
        </div>
      </div>

      {/* Main Grid: My Active Tickets & Knowledge Base */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: My Active Tickets */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#0E1726]">My Recent Incidents &amp; Tickets</h2>
            <Link
              href="/itsm/incidents"
              className="text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-[#6B7488]">Loading your tickets...</div>
          ) : incidents.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-[#2563EB] flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-[#0E1726]">You have no active incidents</p>
              <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
                Everything looks healthy. If you experience an issue, click &quot;Report an Incident&quot; above.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#F0F2F6] text-[#8C95A8] font-bold uppercase tracking-wider">
                    <th className="pb-3">Ticket ID</th>
                    <th className="pb-3">Title</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Priority</th>
                    <th className="pb-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2F6]">
                  {incidents.slice(0, 5).map((inc) => (
                    <tr key={inc.id} className="hover:bg-[#F9FAFB] transition">
                      <td className="py-3 font-mono font-bold text-[#2563EB]">
                        <Link href={`/itsm/incidents/${inc.id}`} className="hover:underline">
                          {inc.ticket_number}
                        </Link>
                      </td>
                      <td className="py-3 font-medium text-[#0E1726] max-w-[200px] truncate">
                        <Link href={`/itsm/incidents/${inc.id}`} className="hover:underline">
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
                        {formatDateTime(inc.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Col: Knowledge Base Suggestions */}
        <div id="knowledge" className="bg-white rounded-2xl border border-[#E6E9F0] shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#0E1726]">Self-Service Knowledge</h2>
            <BookOpen className="w-4 h-4 text-[#6B7488]" />
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8C95A8] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search guides, VPN, SSO..."
              value={searchKnowledge}
              onChange={(e) => setSearchKnowledge(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#E6E9F0] focus:outline-none focus:border-[#2563EB] bg-[#F9FAFB]"
            />
          </div>

          <div className="space-y-2.5 pt-2">
            {[
              {
                title: "Connecting to Global VPN with WireGuard",
                category: "Networking",
                views: "1.2k views",
              },
              {
                title: "Requesting Temporary Cloud Sandbox IAM Roles",
                category: "DevOps",
                views: "890 views",
              },
              {
                title: "Troubleshooting Okta Single Sign-On Cookies",
                category: "Authentication",
                views: "2.4k views",
              },
              {
                title: "Setting up Hardware Security Keys (YubiKey)",
                category: "Security",
                views: "640 views",
              },
            ]
              .filter(
                (item) =>
                  !searchKnowledge ||
                  item.title.toLowerCase().includes(searchKnowledge.toLowerCase())
              )
              .map((kb, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl border border-[#F0F2F6] hover:border-[#CBD5E1] hover:bg-[#F8FAFC] transition cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[10px] text-[#8C95A8] mb-1">
                    <span className="font-semibold text-[#2563EB]">{kb.category}</span>
                    <span>{kb.views}</span>
                  </div>
                  <h4 className="text-xs font-semibold text-[#0E1726]">{kb.title}</h4>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
