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
  XCircle,
} from "lucide-react";
import { formatDateTime, itsmSlaConfig } from "@/lib/itsm-format";
import { IncidentActivity, ServiceRequest } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import IncidentStepper from "@/components/itsm/incident-stepper";
import ActivityTimeline from "@/components/itsm/activity-timeline";
import StatusModal from "@/components/itsm/status-modal";
import AssignModal from "@/components/itsm/assign-modal";
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
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);

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

  const isApprovalPending =
    request.approval_status === "PENDING" ||
    (Boolean(request.approval_required) && request.status === "PENDING");
  const isApprovalApproved =
    request.approval_status === "APPROVED" ||
    (Boolean(request.approval_required) && ["IN_PROGRESS", "RESOLVED", "CLOSED"].includes(request.status));
  const isApprovalRejected =
    request.approval_status === "REJECTED" ||
    request.status === "CANCELLED";

  return (
    <div className="space-y-6 max-w-6xl mx-auto" id="service-agent-request-detail">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
            {userRole === "REQUESTER" ? (
              <Link
                href="/itsm/incidents"
                id="back-to-requests-link"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to My Tickets
              </Link>
            ) : (
              <Link
                href="/itsm/requests"
                id="back-to-requests-link"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Requests
              </Link>
            )}
          <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
            <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded bg-purple-50 text-[#6D28D9] border border-purple-200">
              {request.ticket_number}
            </span>
            <IncidentPriorityBadge priority={request.priority} />
            <IncidentStatusBadge status={request.status} />
            {/* Approval Status Badge */}
            {request.approval_required || request.approval_status ? (
              isApprovalApproved ? (
                <span id="approval-status-approved-badge" className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[11px]">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Approved
                </span>
              ) : isApprovalRejected ? (
                <span id="approval-status-rejected-badge" className="inline-flex items-center gap-1 font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded text-[11px]">
                  <XCircle className="w-3 h-3 text-rose-600" /> Rejected
                </span>
              ) : (
                <span id="approval-status-pending-badge" className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px]">
                  <Clock className="w-3 h-3 text-amber-600" /> Awaiting Approval
                </span>
              )
            ) : null}
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

          {/* Fulfillment actions for Service Agent: Locked when awaiting approval or rejected */}
          {userRole !== "REQUESTER" && (
            isApprovalPending ? (
              <button
                type="button"
                disabled
                id="agent-update-status-action"
                title="Fulfillment actions are disabled while awaiting approval"
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 text-xs font-semibold cursor-not-allowed shadow-xs"
              >
                Update Status
              </button>
            ) : !isTerminal && !isApprovalRejected ? (
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
            ) : null
          )}

          {/* Resolve Request: Disabled/hidden when approval is pending or rejected */}
          {userRole !== "REQUESTER" && (request.status === "IN_PROGRESS" || request.status === "PENDING") && (
            isApprovalPending ? (
              <button
                type="button"
                disabled
                id="agent-resolve-request-action"
                title="Cannot resolve request while awaiting approval"
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gray-100 text-gray-400 border border-gray-200 text-xs font-semibold cursor-not-allowed shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-gray-400" />
                Resolve Request
              </button>
            ) : !isApprovalRejected ? (
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
            ) : null
          )}

          {/* Reopen Request: Available when resolved and not rejected */}
          {userRole !== "REQUESTER" && request.status === "RESOLVED" && !isApprovalRejected && (
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

      {/* Approval & Fulfillment Status Banners */}
      {isApprovalPending && (
        <div id="service-request-awaiting-approval-message" className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4.5 shadow-xs flex items-start gap-3.5">
          <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Awaiting Manager Approval
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                Fulfillment Locked
              </span>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed">
              This service request requires manager sign-off before fulfillment can begin. Status changes and resolution actions are disabled until approval is granted. Team and agent assignment can still be managed.
            </p>
          </div>
        </div>
      )}

      {isApprovalRejected && (
        <div id="service-request-rejected-message" className="rounded-2xl border border-rose-200 bg-rose-50/90 p-4.5 shadow-xs flex items-start gap-3.5">
          <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-rose-900">
                Request Rejected
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                Cancelled
              </span>
            </div>
            <p className="text-xs text-rose-800 leading-relaxed">
              This service request was rejected during the approval review and has been cancelled. Fulfillment actions are prevented.
            </p>
            {(request.rejection_reason || request.status_reason) && (
              <div id="request-detail-rejection-reason" className="mt-2 text-xs font-semibold text-rose-950 bg-white/70 border border-rose-200 rounded-xl px-3 py-2">
                <span className="text-rose-600 font-bold uppercase tracking-wider text-[10px] block">Rejection Reason:</span>
                <span className="font-medium text-rose-900">{request.rejection_reason || request.status_reason}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {isApprovalApproved && request.approval_required && (
        <div id="service-request-approved-message" className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3.5 shadow-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="text-xs text-emerald-900">
              <span className="font-bold">Manager Approval Granted.</span> This request has been approved and moved to fulfillment.
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Left Details & Activities / Right Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Details, Variables, Activities (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Work Progress Stepper */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="request-work-progress-card">
            <div className="flex items-center justify-between border-b border-[#F1F3F9] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#0E1726]">Fulfillment Progress</h2>
                <p className="text-xs text-[#6B7488] mt-0.5">Live lifecycle progress and work status tracking</p>
              </div>
              {request.approval_required && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-[#8C95A8] font-medium text-[11px]">Approval:</span>
                  {isApprovalApproved ? (
                    <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-[11px]">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Approved
                    </span>
                  ) : isApprovalRejected ? (
                    <span className="inline-flex items-center gap-1 font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full text-[11px]">
                      <XCircle className="w-3 h-3 text-rose-600" /> Rejected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full text-[11px]">
                      <Clock className="w-3 h-3 text-amber-600" /> Pending Sign-Off
                    </span>
                  )}
                </div>
              )}
            </div>
            <IncidentStepper currentStatus={request.status} labels={{ RESOLVED: "Delivered" }} />
            {request.status === "RESOLVED" && request.resolved_at && (
              <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Request Resolved on {formatDateTime(request.resolved_at)}</span>
                  {request.resolution_summary && (
                    <p className="mt-1 text-emerald-900 font-normal leading-relaxed">{request.resolution_summary}</p>
                  )}
                </div>
              </div>
            )}
            {request.status === "CLOSED" && request.closed_at && (
              <div className="text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Request Closed on {formatDateTime(request.closed_at)}</span>
                </div>
              </div>
            )}
          </div>
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
              {userRole !== "REQUESTER" && (
                <button
                  type="button"
                  id="agent-assign-request-action"
                  onClick={() => setShowAssignModal(true)}
                  className="w-full mt-2 py-2 px-3 rounded-xl border border-[#E6E9F0] bg-white hover:bg-[#F9FAFB] text-[#0E1726] text-xs font-semibold transition shadow-xs flex items-center justify-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5 text-[#6D28D9]" />
                  <span>{request.assignment_group ? "Reassign Team" : "Assign Team"}</span>
                </button>
              )}
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

      {showAssignModal && request && (
        <AssignModal
          incident={request as any}
          title={`Assign Request · ${request.ticket_number}`}
          assignEndpoint={`/api/itsm/requests/${request.id}/assign`}
          onClose={() => setShowAssignModal(false)}
          onSuccess={(updated) => {
            setRequest((prev) =>
              prev
                ? {
                    ...prev,
                    assignment_group: updated.assignment_group,
                    assignee_id: updated.assignee_id,
                    assignee_email: updated.assignee_email,
                  }
                : null
            );
            setShowAssignModal(false);
            fetchRequestData();
          }}
        />
      )}
    </div>
  );
}
