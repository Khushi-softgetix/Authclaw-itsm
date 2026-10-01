"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck,
  Layers,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  User,
  X,
  XCircle,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";

interface ApprovalItem {
  id: string;
  tenant_id: string;
  ticket_id: string | null;
  ticket_number: string | null;
  title: string;
  description: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | string;
  ticket_status: string | null;
  action_type: string;
  action_description: string | null;
  catalog_item_name: string | null;
  service_name: string | null;
  quantity: number;
  priority: string;
  urgency: string;
  impact: string;
  requester_id: string;
  requester_email: string | null;
  approver_id: string | null;
  approver_email: string | null;
  form_data: Record<string, any>;
  resolution_reason: string | null;
  expires_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export default function RequesterApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"PENDING" | "ALL" | "APPROVED" | "REJECTED">("PENDING");
  const [currentUser, setCurrentUser] = useState<{
    id: string | null;
    email: string | null;
    itsmRole: string | null;
  }>({
    id: null,
    email: null,
    itsmRole: null,
  });

  // Reject modal state
  const [rejectModalItem, setRejectModalItem] = useState<ApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/itsm/approvals", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load approvals: ${res.statusText}`);
      }
      const data: ApprovalItem[] = await res.json();
      setApprovals(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || "Failed to load approval requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        if (session) {
          setCurrentUser({
            id: session.userId || null,
            email: session.email || null,
            itsmRole: session.itsmRole || null,
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleApprove = async (item: ApprovalItem) => {
    setActionLoadingId(item.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`/api/itsm/approvals/${item.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Approved via Requester Portal" }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Failed to approve: ${res.statusText}`);
      }
      setSuccessMessage(`Request ${item.ticket_number || item.title} has been approved.`);
      await fetchApprovals();
    } catch (err: any) {
      setError(err.message || "Approval action failed");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenRejectModal = (item: ApprovalItem) => {
    setRejectModalItem(item);
    setRejectReason("");
    setRejectError(null);
  };

  const handleConfirmReject = async () => {
    if (!rejectModalItem) return;
    setActionLoadingId(rejectModalItem.id);
    setRejectError(null);
    try {
      const res = await fetch(`/api/itsm/approvals/${rejectModalItem.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() || "Rejected via Requester Portal" }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Failed to reject: ${res.statusText}`);
      }
      setSuccessMessage(`Request ${rejectModalItem.ticket_number || rejectModalItem.title} has been rejected.`);
      setRejectModalItem(null);
      await fetchApprovals();
    } catch (err: any) {
      setRejectError(err.message || "Rejection action failed");
    } finally {
      setActionLoadingId(null);
    }
  };

  const pendingCount = approvals.filter((a) => a.status === "PENDING").length;

  const filteredApprovals = approvals.filter((item) => {
    if (filterTab !== "ALL" && item.status !== filterTab) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (item.ticket_number && item.ticket_number.toLowerCase().includes(q)) ||
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.catalog_item_name && item.catalog_item_name.toLowerCase().includes(q)) ||
      (item.service_name && item.service_name.toLowerCase().includes(q)) ||
      (item.description && item.description.toLowerCase().includes(q)) ||
      (item.requester_email && item.requester_email.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto" id="requester-approvals-page">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
        <div className="flex items-start sm:items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#DDCEFB] text-[#6D28D9] flex items-center justify-center shrink-0">
            <FileCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-[11px] font-semibold mb-1 border border-[#DDD6FE]">
              <span>Review &amp; Governance</span>
            </div>
            <h1 className="text-xl font-extrabold text-[#0E1726] tracking-tight">
              My Approvals
            </h1>
            <p className="text-xs text-[#6B7488] mt-1 max-w-xl">
              Review, approve, or reject catalog service requests requiring manager verification and authorization.
            </p>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-3">
          <div className="bg-[#FAF8FF] rounded-xl px-5 py-2.5 border border-[#E6E9F0] text-center min-w-[120px] shadow-xs">
            <div className="text-2xl font-black text-[#0E1726]">{pendingCount}</div>
            <div className="text-[11px] text-[#6D28D9] font-bold">Pending Review</div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchApprovals}
            className="text-xs font-bold text-rose-800 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b sm:border-b-0 border-[#F0F2F6] flex-1">
            {[
              { id: "PENDING", label: "Pending", count: pendingCount },
              { id: "ALL", label: "All Requests", count: approvals.length },
              { id: "APPROVED", label: "Approved", count: approvals.filter((a) => a.status === "APPROVED").length },
              { id: "REJECTED", label: "Rejected", count: approvals.filter((a) => a.status === "REJECTED").length },
            ].map((tab) => {
              const active = filterTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setFilterTab(tab.id as any)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-2 ${
                    active
                      ? "bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE]"
                      : "text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA]"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      active ? "bg-[#4F46E5] text-white" : "bg-[#F0F2F6] text-[#6B7488]"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            onClick={fetchApprovals}
            className="p-2 text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-xl border border-[#E6E9F0] transition shrink-0 self-end sm:self-auto"
            title="Refresh approvals"
            id="refresh-approvals-btn"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-[#4F46E5]" : ""}`} />
          </button>
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by ticket #, catalog item, requester, or keyword..."
            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl pl-9 pr-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#4F46E5] focus:outline-none"
          />
        </div>
      </div>

      {/* List of Approvals */}
      {loading && approvals.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#E6E9F0]">
          <RefreshCw className="w-6 h-6 animate-spin text-[#4F46E5] mx-auto mb-3" />
          <p className="text-xs text-[#6B7488] font-medium">Loading approval requests...</p>
        </div>
      ) : filteredApprovals.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#E6E9F0] space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#0E1726]">No Approvals Found</h3>
          <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
            {filterTab === "PENDING"
              ? "All catalog requests requiring your approval have been processed. Great job!"
              : "No requests match the selected tab and search criteria."}
          </p>
        </div>
      ) : (
        <div className="space-y-4" id="approvals-list">
          {filteredApprovals.map((item) => {
            const isPending = item.status === "PENDING";
            const isApproved = item.status === "APPROVED";
            const isRejected = item.status === "REJECTED";
            const isActionLoading = actionLoadingId === item.id;
            const isOwnRequest = Boolean(
              (currentUser.id && item.requester_id && currentUser.id.toLowerCase() === item.requester_id.toLowerCase()) ||
              (currentUser.email && item.requester_email && currentUser.email.toLowerCase() === item.requester_email.toLowerCase())
            );

            return (
              <div
                key={item.id}
                className="bg-white rounded-2xl border border-[#E6E9F0] p-5 sm:p-6 shadow-sm hover:shadow-md transition space-y-4"
                id={`approval-card-${item.id}`}
              >
                {/* Top Row: Ticket Number, Badges, Dates */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0F2F6] pb-3">
                  <div className="flex items-center gap-3">
                    {item.ticket_id ? (
                      <Link
                        href={`/itsm/requests/${item.ticket_id}`}
                        className="text-xs font-bold text-[#4F46E5] hover:underline flex items-center gap-1"
                        id={`ticket-link-${item.id}`}
                      >
                        <span>{item.ticket_number || "REQ-VIEW"}</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    ) : (
                      <span className="text-xs font-bold text-[#4F46E5]">
                        {item.ticket_number || "REQ"}
                      </span>
                    )}

                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                        isPending
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : isApproved
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : isRejected
                          ? "bg-rose-50 text-rose-800 border-rose-200"
                          : "bg-slate-50 text-slate-700 border-slate-200"
                      }`}
                      id={`approval-status-${item.id}`}
                    >
                      {isPending && <Clock className="w-3 h-3 text-amber-600" />}
                      {isApproved && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                      {isRejected && <XCircle className="w-3 h-3 text-rose-600" />}
                      <span>{item.status}</span>
                    </span>

                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#F0F2F6] text-[#6B7488]">
                      {item.priority || "P3"}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-[#6B7488]">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#9DA4B4]" />
                      <span>Requested {formatDateTime(item.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Main Content Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left 2 Cols: Title, Description, Catalog Item */}
                  <div className="lg:col-span-2 space-y-3">
                    <div>
                      <h3 className="text-base font-bold text-[#0E1726]">{item.title}</h3>
                      {item.catalog_item_name && item.catalog_item_name !== item.title && (
                        <div className="inline-flex items-center gap-1.5 text-xs text-[#4F46E5] font-medium mt-0.5">
                          <Package className="w-3.5 h-3.5" />
                          <span>Catalog Item: {item.catalog_item_name}</span>
                        </div>
                      )}
                    </div>

                    {item.description && (
                      <p className="text-xs text-[#4A5568] leading-relaxed bg-[#F9FAFB] p-3 rounded-xl border border-[#EDF2F7]">
                        {item.description}
                      </p>
                    )}

                    {/* Metadata tags */}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                      {item.service_name && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F5F7FA] text-[#4A5568] border border-[#E6E9F0]">
                          <Layers className="w-3 h-3 text-[#6B7488]" />
                          <span>Service: {item.service_name}</span>
                        </span>
                      )}

                      {item.quantity && item.quantity > 1 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F5F7FA] text-[#4A5568] border border-[#E6E9F0]">
                          <Package className="w-3 h-3 text-[#6B7488]" />
                          <span>Qty: {item.quantity}</span>
                        </span>
                      )}

                      {item.requester_email && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F5F7FA] text-[#4A5568] border border-[#E6E9F0]">
                          <User className="w-3 h-3 text-[#6B7488]" />
                          <span>Requester: {item.requester_email}</span>
                        </span>
                      )}
                    </div>

                    {/* Form Data Fields snapshot */}
                    {item.form_data && Object.keys(item.form_data).length > 0 && (
                      <div className="pt-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#6B7488] mb-1.5">
                          Intake Details
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-[#F9FAFB] p-3 rounded-xl border border-[#EDF2F7] text-xs">
                          {Object.entries(item.form_data).map(([k, v]) => {
                            if (k === "quantity" || k === "reason") return null;
                            return (
                              <div key={k} className="space-y-0.5">
                                <div className="text-[10px] text-[#8C95A6] font-medium capitalize">
                                  {k.replace(/_/g, " ")}
                                </div>
                                <div className="font-semibold text-[#0E1726] truncate">
                                  {String(v)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Col: Actions or Decision Summary */}
                  <div className="flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-[#F0F2F6] lg:pl-6 pt-4 lg:pt-0 space-y-4">
                    {isPending ? (
                      <div className="space-y-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#6B7488]">
                          Action Required
                        </div>
                        {isOwnRequest ? (
                          <div
                            className="space-y-2 bg-[#FAF8FF] p-4 rounded-xl border border-[#DDD6FE]"
                            id={`self-approval-notice-${item.id}`}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-bold text-[#6D28D9]">
                              <ShieldAlert className="w-4 h-4 shrink-0 text-[#6D28D9]" />
                              <span>Awaiting Manager Approval</span>
                            </div>
                            <p className="text-xs text-[#6B7488]">
                              Segregation of Duties: You cannot approve or reject your own request. Another authorized manager must review this request.
                            </p>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs text-[#6B7488]">
                              Please evaluate this request. Approving will transition the ticket to active fulfillment.
                            </p>

                            <div className="flex flex-col sm:flex-row lg:flex-col gap-2 pt-2">
                              <button
                                onClick={() => handleApprove(item)}
                                disabled={isActionLoading}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition shadow-sm disabled:opacity-50"
                                id={`approve-btn-${item.id}`}
                              >
                                <ThumbsUp className="w-3.5 h-3.5" />
                                <span>{isActionLoading ? "Processing..." : "Approve Request"}</span>
                              </button>

                              <button
                                onClick={() => handleOpenRejectModal(item)}
                                disabled={isActionLoading}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 font-semibold text-xs transition shadow-sm disabled:opacity-50"
                                id={`reject-btn-${item.id}`}
                              >
                                <ThumbsDown className="w-3.5 h-3.5" />
                                <span>Reject Request</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3 bg-[#F9FAFB] p-4 rounded-xl border border-[#EDF2F7]">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-[#6B7488]">
                          Decision Summary
                        </div>
                        <div className="space-y-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-[#8C95A6]">Decision:</span>
                            <span
                              className={`font-bold ${
                                isApproved ? "text-emerald-700" : "text-rose-700"
                              }`}
                            >
                              {item.status}
                            </span>
                          </div>

                          {item.approved_at && (
                            <div className="flex items-center gap-2">
                              <span className="text-[#8C95A6]">Resolved At:</span>
                              <span className="text-[#0E1726] font-medium">
                                {formatDateTime(item.approved_at)}
                              </span>
                            </div>
                          )}

                          {item.approver_email && (
                            <div className="flex items-center gap-2">
                              <span className="text-[#8C95A6]">Approver:</span>
                              <span className="text-[#0E1726] font-medium truncate">
                                {item.approver_email}
                              </span>
                            </div>
                          )}

                          {item.resolution_reason && (
                            <div className="space-y-1 pt-1 border-t border-[#EDF2F7]">
                              <span className="text-[#8C95A6]">Resolution Reason:</span>
                              <p className="text-xs text-[#0E1726] italic bg-white p-2 rounded-lg border border-[#E2E8F0]">
                                {item.resolution_reason}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Confirmation Modal */}
      {rejectModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E6E9F0] space-y-4 animate-scaleUp"
            id="reject-modal"
          >
            <div className="flex items-center justify-between border-b border-[#F0F2F6] pb-3">
              <div className="flex items-center gap-2 text-rose-600 font-bold text-sm">
                <ShieldAlert className="w-4 h-4" />
                <span>Reject Service Request</span>
              </div>
              <button
                onClick={() => setRejectModalItem(null)}
                className="text-[#6B7488] hover:text-[#0E1726] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#6B7488]">
              Are you sure you want to reject request{" "}
              <strong className="text-[#0E1726]">
                {rejectModalItem.ticket_number || rejectModalItem.title}
              </strong>
              ? This will cancel the request and notify the requester.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#0E1726]">
                Rejection Reason (Optional)
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Provide details on why this request is being rejected..."
                rows={3}
                className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl p-3 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-rose-500 focus:outline-none"
                id="reject-reason-textarea"
              />
            </div>

            {rejectError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                {rejectError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setRejectModalItem(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#6B7488] hover:bg-[#F5F7FA] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReject}
                disabled={actionLoadingId === rejectModalItem.id}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-sm disabled:opacity-50"
                id="confirm-reject-btn"
              >
                {actionLoadingId === rejectModalItem.id ? "Rejecting..." : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
