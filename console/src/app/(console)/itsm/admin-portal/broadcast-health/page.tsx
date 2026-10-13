"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  alertApi,
  formatAlertDate,
  type AlertDeliveryHealthPage,
  type AlertDeliveryHealthSummary,
} from "@/lib/outage-alerts";

export default function BroadcastHealthPage() {
  const [data, setData] = useState<AlertDeliveryHealthPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [deliveryFilter, setDeliveryFilter] = useState<string>("ALL");

  const loadHealthData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (deliveryFilter !== "ALL") params.set("delivery_status", deliveryFilter);

      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await alertApi<AlertDeliveryHealthPage>(`/delivery-health${qs}`);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load broadcast delivery health");
    } finally {
      setLoading(false);
    }
  }, [searchTerm, statusFilter, deliveryFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHealthData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadHealthData]);

  const metrics = data?.metrics || {
    total_broadcasts: 0,
    active_broadcasts: 0,
    total_recipients: 0,
    total_delivered: 0,
    total_retrying: 0,
    total_failed: 0,
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-[#1E1B4B] to-[#312E81] rounded-2xl p-6 sm:p-8 text-white shadow-sm">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <Radio className="w-3.5 h-3.5" />
            <span>Broadcasting Infrastructure Diagnostics</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Outage Broadcast &amp; Delivery Health
          </h1>
          <p className="text-sm text-indigo-200 max-w-xl">
            Monitor broadcasting delivery traces, channel health, retry queues, and audience resolution configuration.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/itsm/admin-portal/services"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#1E1B4B] font-bold text-xs hover:bg-indigo-50 transition shadow-sm"
          >
            <Server className="w-3.5 h-3.5" />
            <span>Configure Services</span>
          </Link>
          <button
            type="button"
            onClick={() => void loadHealthData()}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium text-xs transition"
            title="Refresh diagnostics"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Segregation of Duties Boundary Callout */}
      <div className="rounded-xl border border-[#C7D2FE] bg-[#EEF2FF] p-4 text-xs text-[#312E81] flex items-start gap-3 shadow-xs">
        <ShieldCheck className="w-5 h-5 text-[#4338CA] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-[#1E1B4B]">
            Segregation of Duties Enforced (Least-Privilege Platform Administration)
          </p>
          <p className="leading-relaxed text-[#3730A3]">
            Platform Administrators govern the technical broadcasting pipeline, delivery telemetry, and service audience boundaries.
            Business outage alert drafting, customer impact communication, and broadcast publication are restricted to authorized Incident Managers.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Broadcasts</span>
            <Radio className="w-4 h-4 text-[#4F46E5]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">{metrics.total_broadcasts}</div>
          <p className="text-xs text-[#6B7488] mt-1">{metrics.active_broadcasts} currently active</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Recipient Dispatches</span>
            <Users className="w-4 h-4 text-[#059669]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">{metrics.total_recipients}</div>
          <p className="text-xs text-[#059669] mt-1 font-medium">{metrics.total_delivered} delivered available</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Retries &amp; Issues</span>
            <Activity className="w-4 h-4 text-[#D97706]" />
          </div>
          <div className="text-2xl font-bold text-[#0E1726]">
            {metrics.total_retrying + metrics.total_failed}
          </div>
          <p className="text-xs text-[#6B7488] mt-1">
            {metrics.total_retrying} retrying, {metrics.total_failed} failed
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#E6E9F0] shadow-sm">
          <div className="flex items-center justify-between text-[#6B7488] mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Channel Status</span>
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
          </div>
          <div className="text-2xl font-bold text-[#10B981]">Operational</div>
          <p className="text-xs text-[#6B7488] mt-1">In-App &amp; Portal Banners active</p>
        </div>
      </div>

      {/* Channels Overview */}
      <div className="bg-white rounded-xl border border-[#E6E9F0] p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#4F46E5]" />
          <span>Notification Channel &amp; Delivery Connectors</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {(data?.channels || [
            { channel: "IN_APP", status: "OPERATIONAL", name: "In-App Notifications", description: "Persistent tenant in-app notification feed" },
            { channel: "PORTAL", status: "OPERATIONAL", name: "Employee Portal Banner", description: "Real-time self-service portal outage banners" },
          ]).map((ch) => (
            <div key={ch.channel} className="p-3.5 rounded-lg border border-[#E6E9F0] bg-[#F8FAFC] flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#0E1726]">{ch.name}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                    {ch.status}
                  </span>
                </div>
                <p className="text-[11px] text-[#6B7488]">{ch.description}</p>
              </div>
              <span className="text-xs font-mono text-[#4F46E5] bg-indigo-50 px-2 py-1 rounded">
                {ch.channel}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-white rounded-xl border border-[#E6E9F0] p-4 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex flex-1 items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#A8B0C0] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter by alert number or service..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-[#E6E9F0] focus:outline-none focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto shrink-0 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[#6B7488] font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by lifecycle status"
              className="px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-[#0E1726] text-xs focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
            >
              <option value="ALL">All Lifecycles</option>
              <option value="ACTIVE">Active</option>
              <option value="RECOVERED">Recovered</option>
              <option value="DRAFT">Draft</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[#6B7488] font-medium">Delivery:</span>
            <select
              value={deliveryFilter}
              onChange={(e) => setDeliveryFilter(e.target.value)}
              aria-label="Filter by delivery status"
              className="px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-[#0E1726] text-xs focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
            >
              <option value="ALL">All Delivery States</option>
              <option value="AVAILABLE">Delivered (Available)</option>
              <option value="QUEUED">Queued</option>
              <option value="RETRYING">Retrying</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Diagnostics Table */}
      <div className="bg-white rounded-xl border border-[#E6E9F0] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E6E9F0] flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#0E1726]">
            Broadcast Delivery Telemetry &amp; Diagnostics
          </h2>
          <span className="text-xs text-[#6B7488]">
            {data?.total ?? 0} {data?.total === 1 ? "alert record" : "alert records"} found
          </span>
        </div>

        {error ? (
          <div className="p-8 text-center text-xs text-red-600 space-y-2">
            <AlertTriangle className="w-6 h-6 mx-auto text-red-500" />
            <p className="font-semibold">{error}</p>
            <button
              type="button"
              onClick={() => void loadHealthData()}
              className="mt-2 text-indigo-600 font-bold hover:underline"
            >
              Retry loading
            </button>
          </div>
        ) : loading && !data ? (
          <div className="p-12 text-center text-xs text-[#6B7488] space-y-2">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin text-[#4F46E5]" />
            <p>Loading broadcasting telemetry...</p>
          </div>
        ) : !data?.items.length ? (
          <div className="p-12 text-center text-xs text-[#6B7488] space-y-3">
            <Radio className="w-8 h-8 mx-auto text-[#A8B0C0]" />
            <p className="font-medium text-[#0E1726]">No broadcast delivery records match the current filters</p>
            <p className="max-w-md mx-auto text-[11px]">
              When Incident Managers publish business outage alerts, delivery dispatch traces and retry counts will appear here for operational health monitoring.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F8FAFC] border-b border-[#E6E9F0] text-[#6B7488] font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Alert Ref</th>
                  <th className="px-4 py-3">Affected Services</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Published At</th>
                  <th className="px-4 py-3">Dispatched</th>
                  <th className="px-4 py-3">Delivery Trace</th>
                  <th className="px-4 py-3">Health</th>
                  <th className="px-5 py-3 text-right">Diagnostics</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E9F0]">
                {data.items.map((item: AlertDeliveryHealthSummary) => {
                  const hasFailures = item.failed_recipient_count > 0;
                  const isRetrying = item.retrying_recipient_count > 0;
                  return (
                    <tr key={item.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="px-5 py-3.5 font-mono font-bold text-[#0E1726]">
                        {item.alert_number}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {item.affected_services.length ? (
                            item.affected_services.map((s) => (
                              <span
                                key={s.id}
                                className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#F1F5F9] text-[#334155]"
                              >
                                {s.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-[#94A3B8] italic text-[11px]">None assigned</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.status === "ACTIVE"
                              ? "bg-amber-100 text-amber-800"
                              : item.status === "RECOVERED"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-[#6B7488]">
                        {formatAlertDate(item.latest_publication_at || item.published_at)}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-[#0E1726]">
                        {item.recipient_count}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-[#059669] font-medium" title="Delivered available">
                            ✓ {item.delivery_summary?.AVAILABLE ?? 0}
                          </span>
                          {item.delivery_summary?.QUEUED ? (
                            <span className="text-[#6B7488]" title="Queued">
                              • {item.delivery_summary.QUEUED} q
                            </span>
                          ) : null}
                          {isRetrying ? (
                            <span className="text-[#D97706] font-bold" title="Retrying">
                              ↻ {item.retrying_recipient_count}
                            </span>
                          ) : null}
                          {hasFailures ? (
                            <span className="text-[#DC2626] font-bold" title="Failed">
                              ✕ {item.failed_recipient_count}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            hasFailures
                              ? "bg-red-100 text-red-800"
                              : isRetrying
                              ? "bg-amber-100 text-amber-800"
                              : item.recipient_count > 0
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {item.delivery_health_status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={`/itsm/outage-alerts/${item.id}`}
                          className="inline-flex items-center gap-1 font-semibold text-xs text-[#4F46E5] hover:text-[#3730A3]"
                        >
                          <span>Diagnostics</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Service Audience Targeting Rule card */}
      <div className="rounded-2xl border border-[#E6E9F0] bg-white p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-bold text-[#0E1726]">
            <Server className="w-4 h-4 text-[#4F46E5]" />
            <span>Service Audience Targeting Configuration</span>
          </div>
          <p className="text-xs text-[#6B7488] max-w-2xl leading-relaxed">
            Platform Administrators configure whether each service reaches all active tenant requesters (Company-wide) or only entitled consumers (Access-controlled), and link support teams for targeted escalation.
          </p>
        </div>
        <Link
          href="/itsm/admin-portal/services"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] hover:bg-[#F1F5F9] font-bold text-xs text-[#0E1726] transition shrink-0"
        >
          <span>Open Service Management</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
