"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Tag,
  User,
  Users,
} from "lucide-react";
import { formatDateTime, itsmSlaConfig } from "@/lib/itsm-format";
import { IncidentActivity, ServiceRequest } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import ActivityTimeline from "@/components/itsm/activity-timeline";
import StatusModal from "@/components/itsm/status-modal";
import AttachmentSection, { AttachmentItem } from "@/components/itsm/attachment-section";
import CancelTicketModal from "@/components/itsm/cancel-ticket-modal";

function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatFieldValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

export default function ServiceRequestDetailPage() {
  const params = useParams();
  const requestId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [activities, setActivities] = useState<IncidentActivity[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorType, setErrorType] = useState<"unauthorized" | "not_found" | "server_error" | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [showStatusModal, setShowStatusModal] = useState<boolean>(false);
  const [targetModalStatus, setTargetModalStatus] = useState<string | undefined>(undefined);
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);

  const fetchRequestData = useCallback(async () => {
    if (!requestId) return;

    try {
      setLoading(true);
      setErrorType(null);

      const [reqRes, actRes, attRes] = await Promise.all([
        fetch(`/api/itsm/requests/${requestId}`),
        fetch(`/api/itsm/requests/${requestId}/activities`),
        fetch(`/api/itsm/requests/${requestId}/attachments`),
      ]);

      if (reqRes.status === 401 || actRes.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }

      if (reqRes.status === 403) {
        setErrorType("unauthorized");
        return;
      }

      if (reqRes.status === 404) {
        setErrorType("not_found");
        return;
      }

      if (!reqRes.ok) {
        setErrorType("server_error");
        return;
      }

      const reqData = await reqRes.json();
      setRequest(reqData);

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
  }, [requestId]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        let detectedRole = "SERVICE_AGENT";
        if (session) {
          detectedRole = (
            session.itsmRole ||
            (session.platformRole === "SUPER_ADMIN" ? "PLATFORM_ADMINISTRATOR" : "SERVICE_AGENT")
          ).toUpperCase();
        }
        setUserRole(detectedRole);
      })
      .catch(() => {});

    fetchRequestData();
  }, [fetchRequestData]);

  // Loading State
  if (loading && !request) {
    return (
      <div className="flex items-center justify-center py-24" id="request-detail-loading">
        <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin" />
        <span className="ml-3 text-xs text-[#475069]">Loading service request...</span>
      </div>
    );
  }

  // Unauthorized State
  if (errorType === "unauthorized") {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4" id="request-detail-unauthorized">
        <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
        <h2 className="text-base font-bold text-[#0E1726]">Access Restricted</h2>
        <p className="text-xs text-[#6B7488]">You do not have permission to view this service request.</p>
        <div className="pt-2">
          <Link
            href={userRole === "REQUESTER" ? "/itsm/incidents" : "/itsm/requests"}
            className="px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-semibold hover:bg-[#5B21B6] transition"
          >
            {userRole === "REQUESTER" ? "Back to My Tickets" : "Back to Requests"}
          </Link>
        </div>
      </div>
    );
  }

  // Not Found State
  if (errorType === "not_found" || (!request && !loading && !errorType)) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4" id="request-detail-not-found">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-base font-bold text-[#0E1726]">Service Request Not Found</h2>
        <p className="text-xs text-[#6B7488]">The requested service request could not be found or belongs to another workspace.</p>
        <div className="pt-2">
          <Link
            href={userRole === "REQUESTER" ? "/itsm/incidents" : "/itsm/requests"}
            className="px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-semibold hover:bg-[#5B21B6] transition"
          >
            {userRole === "REQUESTER" ? "Back to My Tickets" : "Back to Requests"}
          </Link>
        </div>
      </div>
    );
  }

  // Server Error State
  if (errorType === "server_error" || !request) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4" id="request-detail-error">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-base font-bold text-[#0E1726]">Unable to load service request. Please try again.</h2>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href={userRole === "REQUESTER" ? "/itsm/incidents" : "/itsm/requests"}
            className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition"
          >
            {userRole === "REQUESTER" ? "Back to My Tickets" : "Back to Requests"}
          </Link>
          <button
            onClick={() => fetchRequestData()}
            className="px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-semibold hover:bg-[#5B21B6] transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const slaConfig = request.sla_status ? itsmSlaConfig(request.sla_status) : null;
  const isTerminal = request.status === "CLOSED" || request.status === "CANCELLED";
  const formData = request.request_detail?.submitted_form_data || {};
  const formEntries = Object.entries(formData);

  return (
    <div className="space-y-6 max-w-6xl mx-auto" id="service-agent-request-detail">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div>
            <Link
              href={userRole === "REQUESTER" ? "/itsm/incidents" : "/itsm/requests"}
              id="back-to-requests-link"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> {userRole === "REQUESTER" ? "Back to My Tickets" : "Back to Requests"}
            </Link>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
            <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded bg-purple-50 text-[#6D28D9] border border-purple-200">
              {request.ticket_number}
            </span>
            <IncidentPriorityBadge priority={request.priority} />
            <IncidentStatusBadge status={request.status} />
            {slaConfig && (
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${slaConfig.badge}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${slaConfig.dot}`} />
                {slaConfig.label}
              </span>
            )}
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-[#0E1726] tracking-tight">
            {request.title}
          </h1>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/itsm/knowledge?request=${request.id}`}
            id="agent-request-knowledge-action"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white hover:bg-[#F9FAFB] text-[#0E1726] text-xs font-semibold transition shadow-xs"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#6D28D9]" />
            Search Knowledge
          </Link>

          {userRole === "REQUESTER" && ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"].includes(request.status) && (
            <button
              onClick={() => setShowCancelModal(true)}
              id="requester-cancel-request-action"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold transition shadow-xs"
            >
              <Ban className="w-3.5 h-3.5" />
              Cancel Request
            </button>
          )}

          {!isTerminal && userRole !== "REQUESTER" && (
            <button
              onClick={() => {
                setTargetModalStatus(undefined);
                setShowStatusModal(true);
              }}
              id="agent-update-status-action"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white hover:bg-[#F9FAFB] text-[#0E1726] text-xs font-semibold transition shadow-xs"
            >
              Update Status
            </button>
          )}

          {(request.status === "IN_PROGRESS" || request.status === "PENDING") && (
            <button
              onClick={() => {
                setTargetModalStatus("RESOLVED");
                setShowStatusModal(true);
              }}
              id="agent-resolve-request-action"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition shadow-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Resolve Request
            </button>
          )}

          {request.status === "RESOLVED" && (
            <button
              onClick={() => {
                setTargetModalStatus("IN_PROGRESS");
                setShowStatusModal(true);
              }}
              id="agent-reopen-request-action"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reopen Request
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Left Details & Activities / Right Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Details, Variables, Activities (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Request Overview Card */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#0E1726] uppercase tracking-wider text-[11px]">
                Request Overview
              </h2>
              {request.category && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-gray-100 text-[#475069]">
                  {request.category}
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-[#475069] leading-relaxed whitespace-pre-wrap">
              {request.description || "No description provided."}
            </p>
          </div>

          {/* Submitted Request Details / Variables Card */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="request-variables-card">
            <div className="flex items-center justify-between border-b border-[#F1F3F9] pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#6D28D9]" />
                <h2 className="text-sm font-bold text-[#0E1726]">
                  Submitted Request Details
                </h2>
              </div>
              {request.request_detail?.catalog_item_name && (
                <span className="text-xs font-semibold text-[#6D28D9] bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-200">
                  {request.request_detail.catalog_item_name}
                </span>
              )}
            </div>

            {formEntries.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                {formEntries.map(([key, val]) => (
                  <div key={key} className="bg-[#F9FAFB] rounded-xl p-3 border border-[#E6E9F0]/60 space-y-1">
                    <span className="text-[10px] font-bold text-[#8C95A8] uppercase tracking-wider">
                      {formatFieldLabel(key)}
                    </span>
                    <p className="text-xs font-semibold text-[#0E1726] break-words">
                      {formatFieldValue(val)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#8C95A8] italic">
                No custom intake variables recorded for this request.
              </p>
            )}
          </div>

          {/* Attachments Section */}
          <AttachmentSection
            ticketId={request.id}
            ticketType="requests"
            attachments={attachments}
            onAttachmentUploaded={() => fetchRequestData()}
            canUpload={true}
          />

          {/* Activity & Collaboration Section */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="request-activity-section">
            <h2 className="text-sm font-bold text-[#0E1726] uppercase tracking-wider text-[11px]">
              Activity &amp; Collaboration
            </h2>
            <ActivityTimeline
              incidentId={request.id}
              ticketType="SERVICE_REQUEST"
              activities={activities}
              onActivityAdded={() => fetchRequestData()}
              apiEndpoint={`/api/itsm/requests/${request.id}/activities`}
            />
          </div>
        </div>

        {/* Right Column: Sidebar Metadata (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Requester Info */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-3.5">
            <h3 className="text-[11px] font-bold text-[#8C95A8] uppercase tracking-wider">
              Requester Information
            </h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-[#8C95A8]" />
                <span className="font-semibold text-[#0E1726]">
                  {request.requester_email || "Requester"}
                </span>
              </div>
              <div className="flex items-center justify-between text-[#6B7488]">
                <span>Source Channel:</span>
                <span className="font-medium text-[#0E1726]">{request.source_channel || "PORTAL"}</span>
              </div>
              <div className="flex items-center justify-between text-[#6B7488]">
                <span>Submitted:</span>
                <span className="font-medium text-[#0E1726]">{formatDateTime(request.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Assignment & Routing */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-3.5">
            <h3 className="text-[11px] font-bold text-[#8C95A8] uppercase tracking-wider">
              Fulfillment Assignment
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[#8C95A8] block text-[11px]">Service</span>
                {request.service_id ? (
                  <Link
                    href={`/itsm/services/${request.service_id}`}
                    className="font-semibold text-[#6D28D9] hover:underline flex items-center gap-1.5 mt-0.5"
                    id="request-context-service-link"
                  >
                    <Layers className="w-3.5 h-3.5 text-[#6D28D9]" />
                    <span>{request.service_name || "View Service"}</span>
                  </Link>
                ) : (
                  <span className="font-semibold text-[#0E1726] flex items-center gap-1.5 mt-0.5">
                    <Layers className="w-3.5 h-3.5 text-[#6D28D9]" />
                    {request.service_name || "None / General"}
                  </span>
                )}
              </div>
              <div>
                <span className="text-[#8C95A8] block text-[11px]">Assigned Team</span>
                <span className="font-semibold text-[#0E1726] flex items-center gap-1.5 mt-0.5">
                  <Users className="w-3.5 h-3.5 text-[#8C95A8]" />
                  {request.assignment_group || "Unassigned Team"}
                </span>
              </div>
              <div>
                <span className="text-[#8C95A8] block text-[11px]">Assignee</span>
                <span className="font-semibold text-[#0E1726] flex items-center gap-1.5 mt-0.5">
                  <User className="w-3.5 h-3.5 text-[#8C95A8]" />
                  {request.assignee_email || "Unassigned"}
                </span>
              </div>
            </div>
          </div>

          {/* SLA Status & Target Milestones */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-3.5">
            <h3 className="text-[11px] font-bold text-[#8C95A8] uppercase tracking-wider">
              SLA Milestones
            </h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#6B7488]">SLA Status:</span>
                {slaConfig ? (
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${slaConfig.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${slaConfig.dot}`} />
                    {slaConfig.label}
                  </span>
                ) : (
                  <span className="text-[#8C95A8]">None</span>
                )}
              </div>
              {request.sla_resolution_due_at && (
                <div className="flex items-center justify-between text-[#6B7488]">
                  <span>Resolution Due:</span>
                  <span className="font-medium text-[#0E1726]">
                    {formatDateTime(request.sla_resolution_due_at)}
                  </span>
                </div>
              )}
              {request.resolved_at && (
                <div className="flex items-center justify-between text-[#6B7488]">
                  <span>Resolved At:</span>
                  <span className="font-medium text-emerald-600">
                    {formatDateTime(request.resolved_at)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status Modal */}
      {showStatusModal && (
        <StatusModal
          incident={request as any}
          initialStatus={targetModalStatus}
          statusEndpoint={`/api/itsm/requests/${request.id}/status`}
          onClose={() => setShowStatusModal(false)}
          onSuccess={() => {
            fetchRequestData();
          }}
        />
      )}

      {showCancelModal && request && (
        <CancelTicketModal
          ticketNumber={request.ticket_number}
          ticketId={request.id}
          statusEndpoint={`/api/itsm/requests/${request.id}/status`}
          onClose={() => setShowCancelModal(false)}
          onSuccess={() => {
            fetchRequestData();
          }}
        />
      )}
    </div>
  );
}
