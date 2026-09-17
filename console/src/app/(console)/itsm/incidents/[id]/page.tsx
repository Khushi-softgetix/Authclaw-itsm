"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  FileText,
  Flame,
  LifeBuoy,
  Paperclip,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { formatDateTime, itsmSlaConfig } from "@/lib/itsm-format";
import { Incident, IncidentActivity } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import IncidentStepper from "@/components/itsm/incident-stepper";
import ActivityTimeline from "@/components/itsm/activity-timeline";

interface AttachmentItem {
  id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  created_at: string;
}

export default function IncidentDetailPage() {
  const params = useParams();
  const incidentId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [incident, setIncident] = useState<Incident | null>(null);
  const [activities, setActivities] = useState<IncidentActivity[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorType, setErrorType] = useState<"unauthorized" | "not_found" | "server_error" | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const fetchIncidentData = useCallback(async (role?: string) => {
    if (!incidentId) return;

    try {
      setLoading(true);
      setErrorType(null);

      const effectiveRole = role || userRole;
      const isAgent = effectiveRole === "SERVICE_AGENT";
      const incidentUrl = isAgent
        ? `/api/itsm/incidents/${incidentId}?agent_view=true`
        : `/api/itsm/incidents/${incidentId}`;

      const [incRes, actRes, attRes] = await Promise.all([
        fetch(incidentUrl),
        fetch(`/api/itsm/incidents/${incidentId}/activities`),
        fetch(`/api/itsm/incidents/${incidentId}/attachments`),
      ]);

      if (incRes.status === 401 || actRes.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }

      if (incRes.status === 403) {
        setErrorType("unauthorized");
        return;
      }

      if (incRes.status === 404) {
        setErrorType("not_found");
        return;
      }

      if (!incRes.ok) {
        setErrorType("server_error");
        return;
      }

      const incData = await incRes.json();
      setIncident(incData);

      if (actRes.ok) {
        const actData = await actRes.json();
        setActivities(Array.isArray(actData) ? actData : []);
      }

      if (attRes.ok) {
        const attData = await attRes.json();
        setAttachments(Array.isArray(attData) ? attData : []);
      }
    } catch {
      setErrorType("server_error");
    } finally {
      setLoading(false);
    }
  }, [incidentId, userRole]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        let detectedRole = "REQUESTER";
        if (session) {
          detectedRole = (
            session.itsmRole ||
            (session.platformRole === "SUPER_ADMIN" ? "PLATFORM_ADMINISTRATOR" : "REQUESTER")
          ).toUpperCase();
        }
        setUserRole(detectedRole);
        fetchIncidentData(detectedRole);
      })
      .catch(() => {
        fetchIncidentData();
      });
  }, [fetchIncidentData]);

  // Loading state
  if (loading && !incident) {
    return (
      <div className="flex items-center justify-center py-24" id="agent-incident-loading">
        <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin" />
        <span className="ml-3 text-xs text-[#475069]">Loading incident...</span>
      </div>
    );
  }

  // Unauthorized state
  if (errorType === "unauthorized") {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4" id="agent-incident-unauthorized">
        <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
        <h2 className="text-base font-bold text-[#0E1726]">You do not have permission to view this incident.</h2>
        <p className="text-xs text-[#6B7488]">Access is restricted to authorized roles within this workspace.</p>
        <div className="pt-2">
          <Link
            href={userRole === "SERVICE_AGENT" ? "/itsm/dashboard/agent" : "/itsm/dashboard"}
            className="px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-semibold hover:bg-[#5B21B6] transition"
          >
            {userRole === "SERVICE_AGENT" ? "Back to My Work" : "Back to Dashboard"}
          </Link>
        </div>
      </div>
    );
  }

  // Not found state
  if (errorType === "not_found" || (!incident && !loading && !errorType)) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4" id="agent-incident-not-found">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-base font-bold text-[#0E1726]">Incident not found</h2>
        <p className="text-xs text-[#6B7488]">The requested incident could not be found or belongs to another workspace.</p>
        <div className="pt-2">
          <Link
            href={userRole === "SERVICE_AGENT" ? "/itsm/dashboard/agent" : "/itsm/incidents"}
            className="px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-semibold hover:bg-[#5B21B6] transition"
          >
            {userRole === "SERVICE_AGENT" ? "Back to My Work" : "Back to My Tickets"}
          </Link>
        </div>
      </div>
    );
  }

  // Server error state
  if (errorType === "server_error" || !incident) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4" id="agent-incident-error">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-base font-bold text-[#0E1726]">Unable to load incident. Please try again.</h2>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href={userRole === "SERVICE_AGENT" ? "/itsm/dashboard/agent" : "/itsm/incidents"}
            className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition"
          >
            {userRole === "SERVICE_AGENT" ? "Back to My Work" : "Back to My Tickets"}
          </Link>
          <button
            onClick={() => fetchIncidentData()}
            className="px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-semibold hover:bg-[#5B21B6] transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // SERVICE AGENT WORKSPACE (Clean, simple, information-dense incident detail)
  // =========================================================================
  if (userRole === "SERVICE_AGENT") {
    const slaConfig = itsmSlaConfig(incident.sla_status);

    return (
      <div className="space-y-6 max-w-6xl mx-auto" id="service-agent-incident-workspace">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div>
              <Link
                href="/itsm/dashboard/agent"
                id="back-to-my-work"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to My Work
              </Link>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
              <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded bg-purple-50 text-[#6D28D9] border border-purple-200">
                {incident.ticket_number}
              </span>
              <IncidentPriorityBadge priority={incident.priority} />
              <IncidentStatusBadge status={incident.status} />
              {incident.sla_status && (
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${slaConfig.badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${slaConfig.dot}`} />
                  {slaConfig.label}
                </span>
              )}
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-[#0E1726] tracking-tight">
              {incident.title}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchIncidentData()}
              id="refresh-incident"
              className="p-2 rounded-lg border border-[#E6E9F0] bg-white text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition shadow-xs"
              title="Refresh incident"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main Content Layout (2 Columns) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left / Main Area: Incident Overview & Recent Activity */}
          <div className="lg:col-span-2 space-y-6">
            {/* Incident Overview Card */}
            <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-5" id="incident-overview-card">
              <h2 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
                Incident Overview
              </h2>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Ticket #
                  </span>
                  <span className="font-mono font-bold text-[#0E1726] mt-0.5 block">
                    {incident.ticket_number || "Not set"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Priority
                  </span>
                  <span className="font-semibold text-[#0E1726] mt-0.5 block">
                    {incident.priority || "Not set"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Status
                  </span>
                  <span className="font-medium text-[#0E1726] mt-0.5 block">
                    {incident.status || "Not set"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Category
                  </span>
                  <span className="font-medium text-[#0E1726] mt-0.5 block">
                    {incident.category || "Not set"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Service
                  </span>
                  <span className="font-medium text-[#0E1726] mt-0.5 block">
                    {incident.service_name || "Not set"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Assigned Team
                  </span>
                  <span className="font-medium text-[#0E1726] mt-0.5 block">
                    {incident.assignment_group || "Not set"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Assignee
                  </span>
                  <span className="font-medium text-[#0E1726] mt-0.5 block truncate" title={incident.assignee_email || incident.assignee_id || ""}>
                    {incident.assignee_email || incident.assignee_id || "Not set"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Created Time
                  </span>
                  <span className="font-medium text-[#6B7488] mt-0.5 block">
                    {incident.created_at ? formatDateTime(incident.created_at) : "Not set"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Updated Time
                  </span>
                  <span className="font-medium text-[#6B7488] mt-0.5 block">
                    {incident.updated_at ? formatDateTime(incident.updated_at) : (incident.created_at ? formatDateTime(incident.created_at) : "Not set")}
                  </span>
                </div>
              </div>

              {/* Short description */}
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488] mb-1">
                  Short Description
                </span>
                <p className="text-xs font-semibold text-[#0E1726]">
                  {incident.title || "Not set"}
                </p>
              </div>

              {/* Full Description */}
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488] mb-1.5">
                  Description
                </span>
                <div className="text-xs text-[#475069] leading-relaxed bg-[#FBFAF9] p-4 rounded-xl border border-[#E6E9F0] whitespace-pre-wrap">
                  {incident.description && incident.description.trim()
                    ? incident.description
                    : "No description provided."}
                </div>
              </div>
            </div>

            {/* Recent Activity (Read-Only Preview - Step 2) */}
            <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="recent-activity-card">
              <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
                <h2 className="text-sm font-bold text-[#0E1726]">Recent Activity</h2>
                <span className="text-[11px] text-[#6B7488] font-medium">Read-only preview</span>
              </div>

              {activities.length === 0 ? (
                <p className="text-xs text-[#6B7488] py-4 text-center">No activity recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {activities.slice(0, 5).map((act) => (
                    <div
                      key={act.id}
                      className="flex items-start gap-3 p-3 rounded-xl bg-slate-50/50 border border-slate-100 text-xs"
                    >
                      <div className="w-2 h-2 rounded-full bg-[#6D28D9] mt-1.5 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#0E1726]">
                            {act.activity_type.replace(/_/g, " ")}
                          </span>
                          <span className="text-[10px] text-[#6B7488] shrink-0">
                            {formatDateTime(act.created_at)}
                          </span>
                        </div>
                        {act.content && (
                          <p className="text-[#475069] text-xs leading-relaxed truncate">
                            {act.content}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right / Secondary Area: Incident Context & SLA */}
          <div className="space-y-6">
            {/* Incident Context Card */}
            <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="incident-context-card">
              <h2 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
                Incident Context
              </h2>

              <div className="space-y-3.5 text-xs">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Service
                  </span>
                  <p className="font-medium text-[#0E1726] mt-0.5">{incident.service_name || "Not set"}</p>
                </div>

                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Configuration Item
                  </span>
                  <p className="font-medium text-[#6B7488] mt-0.5">Not set</p>
                </div>

                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Assignment Group
                  </span>
                  <p className="font-medium text-[#0E1726] mt-0.5">{incident.assignment_group || "Not set"}</p>
                </div>

                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Assignee
                  </span>
                  <p className="font-medium text-[#0E1726] mt-0.5 truncate" title={incident.assignee_email || incident.assignee_id || ""}>
                    {incident.assignee_email || incident.assignee_id || "Not set"}
                  </p>
                </div>

                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Priority
                  </span>
                  <div className="mt-1">
                    <IncidentPriorityBadge priority={incident.priority} />
                  </div>
                </div>
              </div>
            </div>

            {/* SLA Card */}
            <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="incident-sla-card">
              <h2 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
                SLA
              </h2>

              <div className="space-y-3 text-xs">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Status
                  </span>
                  {incident.sla_status ? (
                    <div className="mt-1">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${slaConfig.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${slaConfig.dot}`} />
                        {slaConfig.label}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-[#6B7488] mt-0.5">SLA information unavailable</p>
                  )}
                </div>

                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Resolution Due
                  </span>
                  <p className="font-medium text-[#0E1726] mt-0.5">
                    {incident.sla_resolution_due_at ? formatDateTime(incident.sla_resolution_due_at) : "Not set"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // REQUESTER VIEW (Preserved exactly as-is for Requester portal)
  // =========================================================================
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Navigation Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#6B7488]">
          <Link href="/itsm/incidents" className="hover:text-[#0E1726] flex items-center gap-1 font-semibold text-[#6D28D9]">
            <ArrowLeft className="w-3.5 h-3.5" /> My Tickets
          </Link>
          <span>/</span>
          <span className="font-mono text-[#0E1726] font-medium">{incident.ticket_number}</span>
        </div>

        <button
          onClick={() => fetchIncidentData()}
          className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
          title="Refresh ticket"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Record Header */}
      <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-sm font-extrabold text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-md border border-[#A78BFA]">
                {incident.ticket_number}
              </span>
              <IncidentStatusBadge status={incident.status} />
              <IncidentPriorityBadge priority={incident.priority} />
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-[#0E1726] tracking-tight">
              {incident.title}
            </h1>
          </div>
        </div>
      </div>

      {/* Lifecycle Stepper */}
      <IncidentStepper currentStatus={incident.status} />

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (Ticket Details & Public Timeline) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
              Ticket Details
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Category
                </span>
                <span className="text-xs font-medium text-[#0E1726] mt-0.5 block">
                  {incident.category || "General IT"}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Urgency
                </span>
                <span className="text-xs font-semibold text-[#0E1726] mt-0.5 block">
                  {incident.urgency || "MEDIUM"}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Ticket Type
                </span>
                <span className="text-xs font-medium text-[#0E1726] mt-0.5 block">
                  {incident.ticket_type || "Incident"}
                </span>
              </div>
            </div>

            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488] mb-1.5">
                Description &amp; Context
              </span>
              <p className="text-xs text-[#475069] leading-relaxed bg-[#FBFAF9] p-4 rounded-xl border border-[#E6E9F0] whitespace-pre-wrap">
                {incident.description}
              </p>
            </div>

            {/* Attached Files Card */}
            {attachments.length > 0 && (
              <div className="pt-2 border-t border-[#E6E9F0] space-y-2">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Attachments ({attachments.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {attachments.map((att) => (
                    <a
                      key={att.id}
                      href={`/api/itsm/attachments/${att.id}/download`}
                      download={att.file_name}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-3 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] hover:bg-[#F3E8FF]/30 hover:border-[#6D28D9] transition group"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Paperclip className="w-4 h-4 text-[#6D28D9] shrink-0" />
                        <div className="truncate">
                          <span className="text-xs font-semibold text-[#0E1726] group-hover:text-[#6D28D9] block truncate">
                            {att.file_name}
                          </span>
                          <span className="text-[10px] text-[#6B7488]">
                            {(att.file_size_bytes / 1024).toFixed(1)} KB
                          </span>
                        </div>
                      </div>
                      <Download className="w-4 h-4 text-[#8C95A8] group-hover:text-[#6D28D9] shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Resolution Information Card */}
          {(incident.status === "RESOLVED" || incident.status === "CLOSED") && (
            <div className="bg-white rounded-[20px] border border-emerald-200 bg-emerald-50/20 p-6 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-emerald-800 border-b border-emerald-100 pb-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold">Resolution Details</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    Resolution Status
                  </span>
                  <span className="text-xs font-bold text-emerald-900 mt-0.5 block">
                    {incident.status}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    Resolved At
                  </span>
                  <span className="text-xs font-mono text-emerald-900 mt-0.5 block">
                    {incident.resolved_at ? formatDateTime(incident.resolved_at) : "Completed"}
                  </span>
                </div>
              </div>
              {incident.resolution_summary && (
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-1">
                    Resolution Summary
                  </span>
                  <p className="text-xs text-emerald-950 bg-white p-3 rounded-lg border border-emerald-200 whitespace-pre-wrap">
                    {incident.resolution_summary}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Activity Timeline & Public Discussion */}
          <ActivityTimeline
            incidentId={incident.id}
            activities={activities}
            onActivityAdded={() => fetchIncidentData()}
          />
        </div>

        {/* Right Column (Requester Metadata Sidebar) */}
        <div className="space-y-6">
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
              Ticket Information
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Created Date
                </span>
                <p className="font-medium text-[#0E1726] mt-0.5">{formatDateTime(incident.created_at)}</p>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Last Updated
                </span>
                <p className="font-medium text-[#0E1726] mt-0.5">
                  {formatDateTime(incident.updated_at || incident.created_at)}
                </p>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Current Status
                </span>
                <div className="mt-1">
                  <IncidentStatusBadge status={incident.status} />
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Priority Level
                </span>
                <div className="mt-1">
                  <IncidentPriorityBadge priority={incident.priority} />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-[20px] border border-purple-100 p-5 space-y-3">
            <div className="flex items-center gap-2 text-[#6D28D9]">
              <LifeBuoy className="w-4 h-4" />
              <h4 className="text-xs font-bold">Need Urgent Support?</h4>
            </div>
            <p className="text-[11px] text-[#475069] leading-relaxed">
              Our IT Support team is investigating your request. You can add public comments or updates in the discussion timeline on the left.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
