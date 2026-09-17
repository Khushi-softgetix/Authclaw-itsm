"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Calendar,
  Clock,
  Edit2,
  Filter,
  Layers,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Search,
  Shield,
  Timer,
  Zap,
} from "lucide-react";

interface SLAPolicy {
  id: string;
  name: string;
  description: string | null;
  ticket_type: string;
  priority: string;
  service_id: string | null;
  service_name: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  response_target_minutes: number;
  resolution_target_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BusinessCalendar {
  id: string;
  name: string;
  timezone: string;
  weekly_hours: Record<string, any>;
  holidays: any[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

export default function SLAConfigAdminPage() {
  const [activeTab, setActiveTab] = useState<"policies" | "calendars">("policies");

  // Policies state
  const [policies, setPolicies] = useState<SLAPolicy[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [policyPriorityFilter, setPolicyPriorityFilter] = useState("ALL");
  const [policySearch, setPolicySearch] = useState("");
  const [togglingPolicyId, setTogglingPolicyId] = useState<string | null>(null);

  // Calendars state
  const [calendars, setCalendars] = useState<BusinessCalendar[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(true);
  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  const [calendarSearch, setCalendarSearch] = useState("");

  const fetchPolicies = async () => {
    setLoadingPolicies(true);
    setPoliciesError(null);
    try {
      const res = await fetch("/api/itsm/admin/sla-policies", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load SLA policies (${res.status})`);
      const data = await res.json();
      setPolicies(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setPoliciesError(err instanceof Error ? err.message : "Failed to load SLA policies");
    } finally {
      setLoadingPolicies(false);
    }
  };

  const fetchCalendars = async () => {
    setLoadingCalendars(true);
    setCalendarsError(null);
    try {
      const res = await fetch("/api/itsm/admin/business-calendars", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load business calendars (${res.status})`);
      const data = await res.json();
      setCalendars(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setCalendarsError(err instanceof Error ? err.message : "Failed to load business calendars");
    } finally {
      setLoadingCalendars(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
    fetchCalendars();
  }, []);

  const handleTogglePolicyStatus = async (policy: SLAPolicy) => {
    setTogglingPolicyId(policy.id);
    try {
      const res = await fetch(`/api/itsm/admin/sla-policies/${policy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !policy.is_active }),
      });
      if (!res.ok) throw new Error(`Failed to toggle policy status (${res.status})`);
      const updated = await res.json();
      setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to toggle status");
    } finally {
      setTogglingPolicyId(null);
    }
  };

  // Filtered Policies
  const filteredPolicies = useMemo(() => {
    return policies.filter((p) => {
      if (policyPriorityFilter !== "ALL" && p.priority !== policyPriorityFilter) {
        return false;
      }
      if (!policySearch) return true;
      const q = policySearch.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.service_name && p.service_name.toLowerCase().includes(q)) ||
        (p.calendar_name && p.calendar_name.toLowerCase().includes(q))
      );
    });
  }, [policies, policyPriorityFilter, policySearch]);

  // Filtered Calendars
  const filteredCalendars = useMemo(() => {
    if (!calendarSearch) return calendars;
    const q = calendarSearch.toLowerCase();
    return calendars.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.timezone.toLowerCase().includes(q)
    );
  }, [calendars, calendarSearch]);

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case "P1":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "P2":
        return "bg-orange-50 text-orange-700 border-orange-200";
      case "P3":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "P4":
        return "bg-blue-50 text-blue-700 border-blue-200";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F1523]">
            SLA Configuration
          </h1>
          <p className="text-sm text-[#475069] mt-1">
            Define service level agreements, response and resolution targets by priority, and business operating calendars.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === "policies" ? (
            <Link
              href="/itsm/admin-portal/sla/policies/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6D28D9] text-white text-sm font-medium shadow-sm hover:bg-[#5B21B6] transition"
            >
              <Plus className="w-4 h-4" />
              Create SLA Policy
            </Link>
          ) : (
            <Link
              href="/itsm/admin-portal/sla/calendars/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6D28D9] text-white text-sm font-medium shadow-sm hover:bg-[#5B21B6] transition"
            >
              <Plus className="w-4 h-4" />
              Create Business Calendar
            </Link>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#E6E9F0]">
        <button
          onClick={() => setActiveTab("policies")}
          className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
            activeTab === "policies"
              ? "border-[#6D28D9] text-[#6D28D9]"
              : "border-transparent text-[#6B7488] hover:text-[#0F1523]"
          }`}
        >
          <Timer className="w-4 h-4" />
          SLA Policies
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs bg-[#F1ECFE] text-[#6D28D9] font-semibold">
            {policies.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("calendars")}
          className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
            activeTab === "calendars"
              ? "border-[#6D28D9] text-[#6D28D9]"
              : "border-transparent text-[#6B7488] hover:text-[#0F1523]"
          }`}
        >
          <Calendar className="w-4 h-4" />
          Business Calendars
          <span className="ml-1.5 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700 font-semibold">
            {calendars.length}
          </span>
        </button>
      </div>

      {/* SLA Policies View */}
      {activeTab === "policies" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-[#E6E9F0]">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-[#8C95A8]" />
              <input
                type="text"
                value={policySearch}
                onChange={(e) => setPolicySearch(e.target.value)}
                placeholder="Search policies, services, calendars..."
                className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-[#D5D9E2] bg-white text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={policyPriorityFilter}
                onChange={(e) => setPolicyPriorityFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl border border-[#D5D9E2] bg-white text-[#0F1523] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 transition"
              >
                <option value="ALL">All Priorities</option>
                <option value="P1">P1 - Critical</option>
                <option value="P2">P2 - High</option>
                <option value="P3">P3 - Medium</option>
                <option value="P4">P4 - Low</option>
              </select>

              <button
                onClick={fetchPolicies}
                className="p-2 rounded-xl border border-[#D5D9E2] text-[#6B7488] hover:text-[#0F1523] hover:bg-[#F8FAFC] transition"
                title="Refresh Policies"
              >
                <RefreshCw className={`w-4 h-4 ${loadingPolicies ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {policiesError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <div className="text-sm font-medium">{policiesError}</div>
            </div>
          )}

          {/* Table / Empty State */}
          {loadingPolicies ? (
            <div className="bg-white border border-[#E6E9F0] rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
              <Loader2 className="w-8 h-8 text-[#6D28D9] animate-spin mb-3" />
              <p className="text-sm text-[#6B7488]">Loading SLA policies...</p>
            </div>
          ) : filteredPolicies.length === 0 ? (
            <div className="bg-white border border-[#E6E9F0] rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[320px]">
              <div className="w-12 h-12 rounded-2xl bg-[#F1ECFE] flex items-center justify-center text-[#6D28D9] mb-4">
                <Timer className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[#0F1523] mb-1">
                No SLA policies yet
              </h3>
              <p className="text-sm text-[#6B7488] max-w-sm mb-6">
                Create SLA policies to establish clear response and resolution commitments for your ITSM team.
              </p>
              <Link
                href="/itsm/admin-portal/sla/policies/new"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6D28D9] text-white text-sm font-medium shadow-sm hover:bg-[#5B21B6] transition"
              >
                <Plus className="w-4 h-4" />
                Create SLA Policy
              </Link>
            </div>
          ) : (
            <div className="bg-white border border-[#E6E9F0] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs text-[#0F1523]">
                <thead className="bg-[#F8FAFC] border-b border-[#E6E9F0] text-[#6B7488] font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">Policy Name</th>
                    <th className="py-3.5 px-4">Priority</th>
                    <th className="py-3.5 px-4">Response Target</th>
                    <th className="py-3.5 px-4">Resolution Target</th>
                    <th className="py-3.5 px-4">Service Scope</th>
                    <th className="py-3.5 px-4">Business Calendar</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E9F0]">
                  {filteredPolicies.map((p) => (
                    <tr key={p.id} className="hover:bg-[#F8FAFC] transition">
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-sm text-[#0F1523]">{p.name}</div>
                        {p.description && (
                          <div className="text-[11px] text-[#6B7488] truncate max-w-xs">
                            {p.description}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${getPriorityBadge(
                            p.priority
                          )}`}
                        >
                          {p.priority}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[#0F1523]">
                        {formatMinutes(p.response_target_minutes)}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[#0F1523]">
                        {formatMinutes(p.resolution_target_minutes)}
                      </td>
                      <td className="py-3.5 px-4 text-[#475069]">
                        {p.service_name ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                            {p.service_name}
                          </span>
                        ) : (
                          <span className="text-[#8C95A8]">All Services</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-[#475069]">
                        {p.calendar_name ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                            <Clock className="w-3 h-3" />
                            {p.calendar_name}
                          </span>
                        ) : (
                          <span className="text-[#8C95A8]">24x7 Default</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {p.is_active ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#6B7488] bg-[#F1F3F7] border border-[#E6E9F0] px-2.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#8C95A8]" />
                            Disabled
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <Link
                            href={`/itsm/admin-portal/sla/policies/${p.id}`}
                            className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#475069] hover:text-[#6D28D9] hover:bg-[#F1ECFE] hover:border-[#DDD6FE] transition"
                            title="Edit SLA Policy"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Link>
                          <button
                            onClick={() => handleTogglePolicyStatus(p)}
                            disabled={togglingPolicyId === p.id}
                            className={`p-1.5 rounded-lg border transition ${
                              p.is_active
                                ? "border-[#E6E9F0] text-[#6B7488] hover:text-amber-700 hover:bg-amber-50 hover:border-amber-200"
                                : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            }`}
                            title={p.is_active ? "Disable Policy" : "Enable Policy"}
                          >
                            {togglingPolicyId === p.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Power className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Business Calendars View */}
      {activeTab === "calendars" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-[#E6E9F0]">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-[#8C95A8]" />
              <input
                type="text"
                value={calendarSearch}
                onChange={(e) => setCalendarSearch(e.target.value)}
                placeholder="Search calendars by name or timezone..."
                className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-[#D5D9E2] bg-white text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
            </div>

            <button
              onClick={fetchCalendars}
              className="p-2 rounded-xl border border-[#D5D9E2] text-[#6B7488] hover:text-[#0F1523] hover:bg-[#F8FAFC] transition"
              title="Refresh Calendars"
            >
              <RefreshCw className={`w-4 h-4 ${loadingCalendars ? "animate-spin" : ""}`} />
            </button>
          </div>

          {calendarsError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <div className="text-sm font-medium">{calendarsError}</div>
            </div>
          )}

          {/* Table / Empty State */}
          {loadingCalendars ? (
            <div className="bg-white border border-[#E6E9F0] rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
              <Loader2 className="w-8 h-8 text-[#6D28D9] animate-spin mb-3" />
              <p className="text-sm text-[#6B7488]">Loading business calendars...</p>
            </div>
          ) : filteredCalendars.length === 0 ? (
            <div className="bg-white border border-[#E6E9F0] rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[320px]">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-4">
                <Calendar className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[#0F1523] mb-1">
                No business calendars yet
              </h3>
              <p className="text-sm text-[#6B7488] max-w-sm mb-6">
                Define business operating hours and holidays so SLA clocks only count active working hours.
              </p>
              <Link
                href="/itsm/admin-portal/sla/calendars/new"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6D28D9] text-white text-sm font-medium shadow-sm hover:bg-[#5B21B6] transition"
              >
                <Plus className="w-4 h-4" />
                Create Business Calendar
              </Link>
            </div>
          ) : (
            <div className="bg-white border border-[#E6E9F0] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs text-[#0F1523]">
                <thead className="bg-[#F8FAFC] border-b border-[#E6E9F0] text-[#6B7488] font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">Calendar Name</th>
                    <th className="py-3.5 px-4">Timezone</th>
                    <th className="py-3.5 px-4">Operating Hours</th>
                    <th className="py-3.5 px-4">Default Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E9F0]">
                  {filteredCalendars.map((c) => (
                    <tr key={c.id} className="hover:bg-[#F8FAFC] transition">
                      <td className="py-3.5 px-4 font-medium text-sm text-[#0F1523]">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-[#6D28D9]" />
                          {c.name}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[#475069]">
                        {c.timezone}
                      </td>
                      <td className="py-3.5 px-4 text-[#475069]">
                        {Object.keys(c.weekly_hours || {}).length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-md">
                            <Clock className="w-3 h-3 text-gray-500" />
                            {Object.keys(c.weekly_hours).length} configured day(s)
                          </span>
                        ) : (
                          <span className="text-[#8C95A8]">24x7 Unrestricted</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {c.is_default ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                            Default Calendar
                          </span>
                        ) : (
                          <span className="text-xs text-[#8C95A8]">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <Link
                          href={`/itsm/admin-portal/sla/calendars/${c.id}`}
                          className="inline-flex items-center p-1.5 rounded-lg border border-[#E6E9F0] text-[#475069] hover:text-[#6D28D9] hover:bg-[#F1ECFE] hover:border-[#DDD6FE] transition"
                          title="Edit Business Calendar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
