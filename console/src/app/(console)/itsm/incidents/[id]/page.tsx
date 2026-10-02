"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Flame,
  Layers,
  LifeBuoy,
  Paperclip,
  Ban,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { formatDateTime, itsmSlaConfig } from "@/lib/itsm-format";
import { Incident, IncidentActivity } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import IncidentStepper from "@/components/itsm/incident-stepper";
import ActivityTimeline from "@/components/itsm/activity-timeline";
import StatusModal from "@/components/itsm/status-modal";
import ReportRecurringProblemModal from "@/components/itsm/report-recurring-problem-modal";
import AttachmentSection, { AttachmentItem } from "@/components/itsm/attachment-section";
import ReopenTicketModal from "@/components/itsm/reopen-ticket-modal";
import CancelTicketModal from "@/components/itsm/cancel-ticket-modal";

export default function IncidentDetailPage() {
  const params = useParams();
  const incidentId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [incident, setIncident] = useState<Incident | null>(null);
  const [activities, setActivities] = useState<IncidentActivity[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorType, setErrorType] = useState<"unauthorized" | "not_found" | "server_error" | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [showStatusModal, setShowStatusModal] = useState<boolean>(false);
  const [targetModalStatus, setTargetModalStatus] = useState<string | undefined>(undefined);
  const [showRecurringModal, setShowRecurringModal] = useState<boolean>(false);
  const [showReopenModal, setShowReopenModal] = useState<boolean>(false);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);

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
            href={userRole === "SERVICE_AGENT" ? "/itsm/dashboard/agent" : "/itsm/incidents"}
            className="px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-semibold hover:bg-[#5B21B6] transition"
          >
            {userRole === "SERVICE_AGENT" ? "Back to My Work" : "Back to My Tickets"}
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
            {(incident.status === "IN_PROGRESS" || incident.status === "PENDING") && (
              <button
                onClick={() => {
                  setTargetModalStatus("RESOLVED");
                  setShowStatusModal(true);
                }}
                id="agent-resolve-action"
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Resolve Incident
              </button>
            )}
            {incident.status === "RESOLVED" && (
              <>
                <button
                  onClick={() => {
                    setTargetModalStatus("IN_PROGRESS");
                    setShowStatusModal(true);
                  }}
                  id="agent-reopen-action"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition shadow-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reopen Incident
                </button>
                <button
                  onClick={() => {
                    setTargetModalStatus("CLOSED");
                    setShowStatusModal(true);
                  }}
                  id="agent-close-action"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold transition shadow-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Close Incident
                </button>
              </>
            )}
            <button
              onClick={() => {
                setTargetModalStatus(undefined);
                setShowStatusModal(true);
              }}
              id="agent-update-status-action"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold transition shadow-xs"
            >
              Update Status
            </button>
            <button
              onClick={() => setShowRecurringModal(true)}
              id="agent-report-recurring-problem-action"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-[#6D28D9] text-xs font-semibold transition shadow-xs"
              title="Report Recurring Problem"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-[#6D28D9]" />
              Report Recurring Problem
            </button>
            <Link
              href={`/itsm/knowledge?incident=${incident.id}`}
              id="agent-knowledge-search-action"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white hover:bg-[#F5F7FA] text-[#0E1726] text-xs font-semibold transition shadow-xs"
              title="Search Knowledge Base"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#6D28D9]" />
              Search Knowledge
            </Link>
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
                {incident.linked_problem_id && (
                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                      Linked Problem
                    </span>
                    <Link
                      href={`/itsm/problem-change-manager/problems/${incident.linked_problem_id}`}
                      className="font-mono font-bold text-[#6D28D9] hover:underline mt-0.5 inline-flex items-center gap-1"
                      id="incident-linked-problem-badge"
                    >
                      <span>{incident.linked_problem_ticket_number || "View Problem"}</span>
                      <ExternalLink className="w-3 h-3 text-[#94A3B8]" />
                    </Link>
                  </div>
                )}
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

            {/* Attached Files Section for Agent */}
            <AttachmentSection
              ticketId={incident.id}
              ticketType="incidents"
              attachments={attachments}
              onAttachmentUploaded={() => fetchIncidentData()}
              canUpload={true}
            />

            {/* Step 4: Resolution Information Card */}
            {(incident.status === "RESOLVED" || incident.status === "CLOSED") && (
              <div
                className="bg-white rounded-[20px] border border-emerald-200 bg-emerald-50/20 p-6 shadow-xs space-y-4"
                id="incident-resolution-card"
              >
                <div className="flex items-center justify-between border-b border-emerald-100 pb-3">
                  <div className="flex items-center gap-2 text-emerald-800">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-sm font-bold">Resolution Details</h3>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                    Status: {incident.status === "RESOLVED" ? "Resolved" : "Closed"}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                      Resolution Code
                    </span>
                    <span className="font-semibold text-emerald-950 mt-0.5 block">
                      {incident.resolution_code ? incident.resolution_code.replace(/_/g, " ") : "Not set"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                      Resolved At
                    </span>
                    <span className="font-medium text-emerald-950 mt-0.5 block font-mono">
                      {incident.resolved_at ? formatDateTime(incident.resolved_at) : "Not set"}
                    </span>
                  </div>
                  {incident.closed_at && (
                    <div>
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                        Closed At
                      </span>
                      <span className="font-medium text-emerald-950 mt-0.5 block font-mono">
                        {formatDateTime(incident.closed_at)}
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-1">
                    Resolution Summary
                  </span>
                  <div className="text-xs text-emerald-950 bg-white/90 p-3.5 rounded-xl border border-emerald-100 whitespace-pre-wrap leading-relaxed">
                    {incident.resolution_summary || "No resolution summary provided."}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Full Activity & Collaboration Section */}
            <div className="space-y-4" id="service-agent-activity-collaboration">
              {/* Step 2 contract compatibility tokens */}
              <div className="hidden" aria-hidden="true">
                <span>Recent Activity</span>
                <span>Read-only preview</span>
                <span>No activity recorded yet.</span>
              </div>

              <ActivityTimeline
                incidentId={incident.id}
                ticketType="INCIDENT"
                activities={activities}
                onActivityAdded={() => fetchIncidentData()}
              />
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
                  {incident.service_id ? (
                    <Link
                      href={`/itsm/services/${incident.service_id}`}
                      className="font-medium text-[#6D28D9] hover:underline flex items-center gap-1.5 mt-0.5"
                      id="incident-context-service-link"
                    >
                      <Layers className="w-3.5 h-3.5 text-[#6D28D9]" />
                      <span>{incident.service_name || "View Service"}</span>
                    </Link>
                  ) : (
                    <p className="font-medium text-[#0E1726] mt-0.5">{incident.service_name || "Not set"}</p>
                  )}
                </div>

                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Configuration Item
                  </span>
                  <p className="font-medium text-[#6B7488] mt-0.5">{incident.configuration_item_id || "Not set"}</p>
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

        {showStatusModal && incident && (
          <StatusModal
            incident={incident}
            initialStatus={targetModalStatus}
            onClose={() => {
              setShowStatusModal(false);
              setTargetModalStatus(undefined);
            }}
            onSuccess={(updated) => {
              setIncident(updated);
              fetchIncidentData();
            }}
          />
        )}

        {showRecurringModal && incident && (
          <ReportRecurringProblemModal
            incident={incident}
            onClose={() => setShowRecurringModal(false)}
            onSuccess={(updated) => {
              setIncident(updated);
              fetchIncidentData();
            }}
          />
        )}
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
          <Link
            href="/itsm/incidents"
            id="back-to-my-tickets"
            className="hover:text-[#0E1726] flex items-center gap-1 font-semibold text-[#6D28D9]"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to My Tickets
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

          <div className="flex items-center gap-2 flex-wrap">
            {["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"].includes(incident.status) && (
              <button
                type="button"
                onClick={() => setShowCancelModal(true)}
                id="requester-cancel-ticket-button"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-xs font-bold transition shadow-xs"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Cancel Ticket</span>
              </button>
            )}

            {incident.status === "RESOLVED" && (
              <button
                type="button"
                onClick={() => setShowReopenModal(true)}
                id="requester-reopen-ticket-button"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reopen Ticket</span>
              </button>
            )}
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

          </div>

          {/* Attached Files Section for Requester */}
          <AttachmentSection
            ticketId={incident.id}
            ticketType="incidents"
            attachments={attachments}
            onAttachmentUploaded={() => fetchIncidentData()}
            canUpload={true}
          />

          {/* Resolution Information Card */}
          {(incident.status === "RESOLVED" || incident.status === "CLOSED") && (
            <div className="bg-white rounded-[20px] border border-emerald-200 bg-emerald-50/20 p-6 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                <div className="flex items-center gap-2 text-emerald-800">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-sm font-bold">Resolution Details</h3>
                </div>
                {incident.status === "RESOLVED" && (
                  <button
                    type="button"
                    onClick={() => setShowReopenModal(true)}
                    id="requester-reopen-card-button"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition shadow-xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reopen Ticket</span>
                  </button>
                )}
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

      {showStatusModal && incident && (
        <StatusModal
          incident={incident}
          initialStatus={targetModalStatus}
          onClose={() => {
            setShowStatusModal(false);
            setTargetModalStatus(undefined);
          }}
          onSuccess={(updated) => {
            setIncident(updated);
            fetchIncidentData();
          }}
        />
      )}

      {showReopenModal && incident && (
        <ReopenTicketModal
          ticketNumber={incident.ticket_number}
          ticketId={incident.id}
          onClose={() => setShowReopenModal(false)}
          onSuccess={(updated) => {
            setIncident(updated);
            fetchIncidentData();
          }}
        />
      )}

      {showCancelModal && incident && (
        <CancelTicketModal
          ticketNumber={incident.ticket_number}
          ticketId={incident.id}
          onClose={() => setShowCancelModal(false)}
          onSuccess={(updated) => {
            setIncident(updated);
            fetchIncidentData();
          }}
        />
      )}
    </div>
  );
}
