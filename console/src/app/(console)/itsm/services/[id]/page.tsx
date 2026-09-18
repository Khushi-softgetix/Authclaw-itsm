"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Database,
  ExternalLink,
  Layers,
  RefreshCw,
  Server,
  ShieldCheck,
  Ticket,
  User,
  Users,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { ITSMServiceDetail } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";

export default function ServiceDetailPage() {
  const params = useParams();
  const serviceId = params?.id as string;

  const [service, setService] = useState<ITSMServiceDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchServiceDetail = useCallback(async () => {
    if (!serviceId) return;
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/itsm/services/${encodeURIComponent(serviceId)}`);
      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (res.status === 404) {
        setError("Service not found or you do not have permission to view it.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to load service detail");
      }

      const data = await res.json();
      setService(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load service detail");
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    fetchServiceDetail();
  }, [fetchServiceDetail]);

  const getStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case "OPERATIONAL":
      case "ACTIVE":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            OPERATIONAL
          </span>
        );
      case "DEGRADED":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            DEGRADED
          </span>
        );
      case "OUTAGE":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            OUTAGE
          </span>
        );
      case "MAINTENANCE":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            MAINTENANCE
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-50 text-slate-700 border border-slate-200">
            {status || "UNKNOWN"}
          </span>
        );
    }
  };

  const getTierBadge = (tier: string) => {
    switch (tier?.toUpperCase()) {
      case "TIER_1":
        return (
          <span className="text-xs font-extrabold uppercase px-2.5 py-1 rounded-lg bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]">
            Tier 1 · Mission Critical
          </span>
        );
      case "TIER_2":
        return (
          <span className="text-xs font-extrabold uppercase px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
            Tier 2 · Business Core
          </span>
        );
      default:
        return (
          <span className="text-xs font-extrabold uppercase px-2.5 py-1 rounded-lg bg-slate-50 text-slate-700 border border-slate-200">
            {tier || "Standard"}
          </span>
        );
    }
  };

  if (loading && !service) {
    return (
      <div className="flex items-center justify-center py-24" id="service-detail-loading">
        <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin" />
        <span className="ml-3 text-xs text-[#475069]">Loading service detail...</span>
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4" id="service-detail-error">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <h2 className="text-base font-bold text-[#0E1726]">{error || "Service Not Found"}</h2>
        <p className="text-xs text-[#6B7488]">
          The requested service could not be loaded or is in a different tenant.
        </p>
        <Link
          href="/itsm/services"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Services</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto" id="service-detail-page">
      {/* Top Back Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/itsm/services"
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#6D28D9] hover:underline"
          id="back-to-services-link"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Services</span>
        </Link>

        <button
          onClick={() => fetchServiceDetail()}
          className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="service-header-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              {getTierBadge(service.tier)}
              {getStatusBadge(service.status)}
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-[#0E1726] tracking-tight" id="service-detail-name">
              {service.name}
            </h1>
          </div>
        </div>

        <p className="text-xs text-[#475069] leading-relaxed max-w-3xl" id="service-detail-description">
          {service.description || "No description provided for this service."}
        </p>
      </div>

      {/* Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: CIs and Related Records */}
        <div className="lg:col-span-2 space-y-6">
          {/* Related Configuration Items (CMDB) Section */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="service-ci-section">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#6D28D9]" />
                <h2 className="text-sm font-bold text-[#0E1726]">
                  Configuration Items ({service.configuration_items?.length || 0})
                </h2>
              </div>
              <span className="text-[11px] text-[#6B7488]">Linked Infrastructure</span>
            </div>

            {!service.configuration_items || service.configuration_items.length === 0 ? (
              <p className="text-xs text-[#8C95A8] py-4 text-center">
                No configuration items (CIs) currently mapped to this service.
              </p>
            ) : (
              <div className="divide-y divide-[#F0F2F6]">
                {service.configuration_items.map((ci) => (
                  <div key={ci.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#0E1726]">{ci.name}</span>
                        <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                          {ci.ci_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-[#8C95A8]">
                        <span>Environment: <strong className="text-[#475069]">{ci.environment}</strong></span>
                        <span>Status: <strong className="text-emerald-700">{ci.status}</strong></span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Related Incidents Section */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="service-incidents-section">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <Ticket className="w-4 h-4 text-[#6D28D9]" />
                <h2 className="text-sm font-bold text-[#0E1726]">
                  Recent Incidents ({service.recent_incidents?.length || 0})
                </h2>
              </div>
              <span className="text-[11px] text-[#6B7488]">Service Impact History</span>
            </div>

            {!service.recent_incidents || service.recent_incidents.length === 0 ? (
              <p className="text-xs text-[#8C95A8] py-4 text-center">
                No recent incidents logged against this service.
              </p>
            ) : (
              <div className="divide-y divide-[#F0F2F6]">
                {service.recent_incidents.map((inc) => (
                  <Link
                    key={inc.id}
                    href={`/itsm/incidents/${inc.id}`}
                    className="py-3 flex items-center justify-between gap-4 hover:bg-[#F9FAFB] rounded-xl px-2 transition group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#6D28D9] group-hover:underline">
                          {inc.ticket_number}
                        </span>
                        <IncidentPriorityBadge priority={inc.priority} />
                        <IncidentStatusBadge status={inc.status} />
                      </div>
                      <p className="text-xs text-[#0E1726] font-medium">{inc.title}</p>
                    </div>
                    <span className="text-[11px] text-[#8C95A8] shrink-0">
                      {formatDateTime(inc.created_at)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Related Requests Section */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="service-requests-section">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#6D28D9]" />
                <h2 className="text-sm font-bold text-[#0E1726]">
                  Recent Service Requests ({service.recent_requests?.length || 0})
                </h2>
              </div>
              <span className="text-[11px] text-[#6B7488]">Fulfillment History</span>
            </div>

            {!service.recent_requests || service.recent_requests.length === 0 ? (
              <p className="text-xs text-[#8C95A8] py-4 text-center">
                No recent service requests logged against this service.
              </p>
            ) : (
              <div className="divide-y divide-[#F0F2F6]">
                {service.recent_requests.map((req) => (
                  <Link
                    key={req.id}
                    href={`/itsm/requests/${req.id}`}
                    className="py-3 flex items-center justify-between gap-4 hover:bg-[#F9FAFB] rounded-xl px-2 transition group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#6D28D9] group-hover:underline">
                          {req.ticket_number}
                        </span>
                        <IncidentPriorityBadge priority={req.priority} />
                        <IncidentStatusBadge status={req.status} />
                      </div>
                      <p className="text-xs text-[#0E1726] font-medium">{req.title}</p>
                    </div>
                    <span className="text-[11px] text-[#8C95A8] shrink-0">
                      {formatDateTime(req.created_at)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Service Metadata Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-4" id="service-metadata-sidebar">
            <h2 className="text-xs font-bold text-[#8C95A8] uppercase tracking-wider border-b border-[#E6E9F0] pb-3">
              Service Metadata
            </h2>

            <div className="space-y-3.5 text-xs">
              <div>
                <span className="text-[#8C95A8] block text-[10px] uppercase font-semibold">
                  Escalation Team
                </span>
                <span className="font-semibold text-[#0E1726] flex items-center gap-1.5 mt-0.5">
                  <Users className="w-3.5 h-3.5 text-[#8C95A8]" />
                  {service.escalation_team || "Unassigned"}
                </span>
              </div>

              <div>
                <span className="text-[#8C95A8] block text-[10px] uppercase font-semibold">
                  Service Owner
                </span>
                <span className="font-semibold text-[#0E1726] flex items-center gap-1.5 mt-0.5">
                  <User className="w-3.5 h-3.5 text-[#8C95A8]" />
                  {service.owner_email || "Not designated"}
                </span>
              </div>

              <div>
                <span className="text-[#8C95A8] block text-[10px] uppercase font-semibold">
                  Tier Classification
                </span>
                <span className="font-medium text-[#0E1726] mt-0.5 block">
                  {service.tier}
                </span>
              </div>

              <div className="pt-2 border-t border-[#F0F2F6] space-y-2 text-[11px] text-[#8C95A8]">
                <div>
                  <span>Created: </span>
                  <span className="font-medium text-[#475069]">
                    {formatDateTime(service.created_at)}
                  </span>
                </div>
                <div>
                  <span>Last Updated: </span>
                  <span className="font-medium text-[#475069]">
                    {formatDateTime(service.updated_at)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
