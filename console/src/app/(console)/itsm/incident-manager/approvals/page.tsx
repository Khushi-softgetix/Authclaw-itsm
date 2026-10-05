"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ExternalLink,
  Layers,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  User,
  UserRoundCog,
  Users,
  X,
  XCircle,
} from "lucide-react";
import ModalShell from "@/components/modal-shell";
import AssignModal from "@/components/itsm/assign-modal";
import { formatDateTime } from "@/lib/itsm-format";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";

export interface ApprovalItem {
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
  quantity?: number;
  priority?: string;
  urgency?: string;
  impact?: string;
  requester_id: string;
  requester_email: string | null;
  approver_id: string | null;
  approver_email: string | null;
  assignment_group?: string | null;
  assignee_id?: string | null;
  assignee_email?: string | null;
  form_data?: Record<string, any>;
  resolution_reason?: string | null;
  expires_at?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export default function IncidentManagerApprovalsPage() {
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

  // Rejection modal state
  const [rejectModalItem, setRejectModalItem] = useState<ApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // Assign modal state
  const [assignModalItem, setAssignModalItem] = useState<ApprovalItem | null>(null);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load approval requests");
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
      .then((data) => {
        if (data?.user) {
          setCurrentUser({
            id: data.user.id || data.user.sub || null,
            email: data.user.email || null,
            itsmRole: data.user.itsm_role || null,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Filter approvals based on tab and search
  const filteredApprovals = useMemo(() => {
    return approvals.filter((item) => {
      // Tab filter
      if (filterTab === "PENDING" && item.status !== "PENDING") return false;
      if (filterTab === "APPROVED" && item.status !== "APPROVED") return false;
      if (filterTab === "REJECTED" && item.status !== "REJECTED") return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesNumber = (item.ticket_number || "").toLowerCase().includes(query);
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesService = (item.catalog_item_name || item.service_name || "").toLowerCase().includes(query);
        const matchesRequester = (item.requester_email || item.requester_id || "").toLowerCase().includes(query);
        const matchesTeam = (item.assignment_group || "").toLowerCase().includes(query);
        if (!matchesNumber && !matchesTitle && !matchesService && !matchesRequester && !matchesTeam) {
          return false;
        }
      }
      return true;
    });
  }, [approvals, filterTab, searchQuery]);

  // Counts for tabs and metrics
  const counts = useMemo(() => {
    return {
      pending: approvals.filter((a) => a.status === "PENDING").length,
      approved: approvals.filter((a) => a.status === "APPROVED").length,
      rejected: approvals.filter((a) => a.status === "REJECTED").length,
      total: approvals.length,
    };
  }, [approvals]);

  // Handle Approve action
  const handleApprove = async (item: ApprovalItem) => {
    setActionLoadingId(item.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(
        `/api/itsm/approvals/${encodeURIComponent(item.id)}/approve`,
        jsonRequest("POST", { reason: "Approved by Incident Manager" })
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to approve service request"));
      }
      const updated: ApprovalItem = await res.json();
      setApprovals((prev) => prev.map((a) => (a.id === item.id ? { ...a, ...updated, status: "APPROVED", ticket_status: "IN_PROGRESS" } : a)));
      setSuccessMessage(`Service request ${item.ticket_number || item.title} has been approved and moved to fulfillment.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to approve request");
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handle Reject action submit
  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalItem) return;
    if (!rejectReason.trim()) {
      setRejectError("A rejection reason is required.");
      return;
    }

    setRejectSubmitting(true);
    setRejectError(null);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(
        `/api/itsm/approvals/${encodeURIComponent(rejectModalItem.id)}/reject`,
        jsonRequest("POST", { reason: rejectReason.trim() })
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to reject service request"));
      }
      const updated: ApprovalItem = await res.json();
      setApprovals((prev) =>
        prev.map((a) =>
          a.id === rejectModalItem.id
            ? { ...a, ...updated, status: "REJECTED", ticket_status: "CANCELLED", resolution_reason: rejectReason.trim() }
            : a
        )
      );
      setSuccessMessage(`Service request ${rejectModalItem.ticket_number || rejectModalItem.title} has been rejected.`);
      setRejectModalItem(null);
      setRejectReason("");
    } catch (err: unknown) {
      setRejectError(err instanceof Error ? err.message : "Failed to reject request");
    } finally {
      setRejectSubmitting(false);
    }
  };

  // Handle Team Assignment success
  const handleAssignSuccess = (updatedTicket: any) => {
    if (!assignModalItem) return;
    setApprovals((prev) =>
      prev.map((a) =>
        a.ticket_id === assignModalItem.ticket_id
          ? {
              ...a,
              assignment_group: updatedTicket.assignment_group,
              assignee_id: updatedTicket.assignee_id,
            }
          : a
      )
    );
    setSuccessMessage(`Assignment updated for ${assignModalItem.ticket_number || assignModalItem.title}.`);
    setAssignModalItem(null);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <header className="rounded-[20px] border border-[#E6E9F0] bg-white p-6 shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F4F0FF] text-[#6D28D9] shadow-xs">
              <ClipboardCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[#6D28D9]">Governance & Oversight</p>
              <h1 className="text-2xl font-extrabold tracking-tight text-[#0E1726]">Service Request Approvals</h1>
              <p className="mt-0.5 text-xs text-[#6B7488]">
                Review, govern, and assign supporting teams to service requests requiring manager sign-off.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchApprovals}
            disabled={loading}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] shadow-xs transition hover:border-[#A78BFA] hover:bg-[#F9FAFB] disabled:opacity-50"
            id="refresh-approvals-btn"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[#6D28D9] ${loading ? "animate-spin" : ""}`} />
            Refresh queue
          </button>
        </div>

        {/* Metrics Row */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 border-t border-[#EEF1F5] pt-5">
          <div className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">Pending Sign-Off</p>
            <p className="mt-1 text-2xl font-extrabold text-[#6D28D9]">{counts.pending}</p>
          </div>
          <div className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">Approved Requests</p>
            <p className="mt-1 text-2xl font-extrabold text-[#059669]">{counts.approved}</p>
          </div>
          <div className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">Rejected Requests</p>
            <p className="mt-1 text-2xl font-extrabold text-[#E11D48]">{counts.rejected}</p>
          </div>
          <div className="rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">Total In Pipeline</p>
            <p className="mt-1 text-2xl font-extrabold text-[#0E1726]">{counts.total}</p>
          </div>
        </div>
      </header>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}
      {successMessage && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800" role="status">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button type="button" onClick={() => setSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <section className="rounded-[20px] border border-[#E6E9F0] bg-white shadow-xs overflow-hidden">
        {/* Controls Toolbar: Tabs & Search */}
        <div className="flex flex-col gap-4 border-b border-[#EEF1F5] p-5 sm:flex-row sm:items-center sm:justify-between">
          {/* Tabs */}
          <div className="flex flex-wrap gap-1 rounded-xl bg-[#F4F5F8] p-1 text-xs font-semibold" role="tablist">
            {(
              [
                ["PENDING", "Pending", counts.pending],
                ["ALL", "All Requests", counts.total],
                ["APPROVED", "Approved", counts.approved],
                ["REJECTED", "Rejected", counts.rejected],
              ] as const
            ).map(([tabKey, label, count]) => {
              const active = filterTab === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilterTab(tabKey)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                    active ? "bg-white text-[#6D28D9] shadow-xs" : "text-[#6B7488] hover:text-[#0E1726]"
                  }`}
                  id={`tab-${tabKey.toLowerCase()}`}
                >
                  <span>{label}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-[#F4F0FF] text-[#6D28D9]" : "bg-[#E6E9F0] text-[#6B7488]"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search Bar */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#8A93A5]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search request, user, team..."
              className="w-full rounded-xl border border-[#D0D5DD] bg-[#FBFAF9] py-2 pl-9 pr-3 text-xs text-[#0E1726] placeholder-[#8A93A5] focus:border-[#A78BFA] focus:bg-white focus:outline-none"
              id="approvals-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-[#8A93A5] hover:text-[#0E1726]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Approvals Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="divide-y divide-[#EEF1F5] p-5 space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse flex items-center justify-between py-3">
                  <div className="space-y-2">
                    <div className="h-4 w-32 rounded bg-[#EEF1F5]" />
                    <div className="h-3 w-64 rounded bg-[#EEF1F5]" />
                  </div>
                  <div className="h-8 w-24 rounded bg-[#EEF1F5]" />
                </div>
              ))}
            </div>
          ) : filteredApprovals.length === 0 ? (
            <div className="py-16 text-center">
              <ClipboardCheck className="mx-auto h-10 w-10 text-[#C4B5FD]" />
              <p className="mt-3 text-sm font-bold text-[#0E1726]">
                {searchQuery ? "No matching approval requests found" : filterTab === "PENDING" ? "No pending approvals" : "No requests in this category"}
              </p>
              <p className="mt-1 text-xs text-[#6B7488]">
                {searchQuery ? "Try refining your search terms or clearing the filter." : "Requests requiring manager sign-off will appear here."}
              </p>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="mt-4 rounded-lg border border-[#DDD6FE] bg-white px-3 py-1.5 text-xs font-semibold text-[#6D28D9] hover:bg-[#F4F0FF]"
                >
                  Clear search filter
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-left border-collapse" aria-label="Service request approvals table">
              <thead>
                <tr className="border-b border-[#EEF1F5] bg-[#FBFAF9] text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">
                  <th className="px-5 py-3">Request</th>
                  <th className="px-5 py-3">Service</th>
                  <th className="px-5 py-3">Requester</th>
                  <th className="px-5 py-3">Submitted</th>
                  <th className="px-5 py-3">Approval</th>
                  <th className="px-5 py-3">Fulfillment</th>
                  <th className="px-5 py-3">Assigned Team</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1F5] text-xs">
                {filteredApprovals.map((item) => {
                  const isPending = item.status === "PENDING";
                  const isOwnRequest = Boolean(currentUser.id && currentUser.id === item.requester_id);
                  const isActionLoading = actionLoadingId === item.id;

                  return (
                    <tr key={item.id} className="transition hover:bg-[#FAF8FF]">
                      {/* Request details */}
                      <td className="px-5 py-4 min-w-[200px]">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#6D28D9]">
                            {item.ticket_number || "REQ"}
                          </span>
                        </div>
                        <p className="mt-1 font-semibold text-[#0E1726] line-clamp-1" title={item.title}>
                          {item.title}
                        </p>
                        {item.ticket_id && (
                          <Link
                            href={`/itsm/requests/${item.ticket_id}`}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#6D28D9] hover:underline"
                          >
                            <span>Open details</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </td>

                      {/* Service / Catalog item */}
                      <td className="px-5 py-4 text-[#475069]">
                        <p className="font-semibold text-[#0E1726]">
                          {item.catalog_item_name || item.service_name || "Catalog Item"}
                        </p>
                        {item.service_name && item.catalog_item_name && item.service_name !== item.catalog_item_name && (
                          <p className="text-[10px] text-[#8A93A5]">{item.service_name}</p>
                        )}
                      </td>

                      {/* Requester */}
                      <td className="px-5 py-4 text-[#475069]">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-[#8A93A5]" />
                          <span className="truncate max-w-[150px]" title={item.requester_email || item.requester_id}>
                            {item.requester_email || item.requester_id}
                          </span>
                        </div>
                      </td>

                      {/* Submission Date */}
                      <td className="px-5 py-4 whitespace-nowrap text-[#6B7488] text-[11px]">
                        {formatDateTime(item.created_at)}
                      </td>

                      {/* Approval Status */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <ApprovalStatusBadge status={item.status} />
                        {item.status === "REJECTED" && item.resolution_reason && (
                          <p className="mt-1 text-[10px] text-rose-600 line-clamp-2 max-w-[160px]" title={item.resolution_reason}>
                            Reason: {item.resolution_reason}
                          </p>
                        )}
                      </td>

                      {/* Fulfillment Status */}
                      <td className="px-5 py-4 whitespace-nowrap">
                        <TicketStatusBadge status={item.ticket_status || "PENDING"} />
                      </td>

                      {/* Assigned Team */}
                      <td className="px-5 py-4 text-[#475069]">
                        <p className="font-semibold text-[#0E1726] text-xs">
                          {item.assignment_group || "No team assigned"}
                        </p>
                        {item.assignee_email && (
                          <p className="text-[10px] text-[#8A93A5] truncate max-w-[140px]" title={item.assignee_email}>
                            {item.assignee_email}
                          </p>
                        )}
                      </td>

                      {/* Action buttons */}
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {isPending && item.ticket_id && (
                            <button
                              type="button"
                              onClick={() => setAssignModalItem(item)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#D0D5DD] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] shadow-xs transition hover:border-[#A78BFA] hover:bg-[#F9FAFB]"
                              title="Assign fulfillment team"
                              id={`assign-btn-${item.ticket_number || item.id}`}
                            >
                              <UserRoundCog className="h-3.5 w-3.5 text-[#6D28D9]" />
                              <span>Assign</span>
                            </button>
                          )}

                          {isPending ? (
                            isOwnRequest ? (
                              <span className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 border border-amber-200" title="Segregation of Duties: You cannot approve your own request">
                                SoD Protected
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleApprove(item)}
                                  disabled={isActionLoading}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#059669] px-2.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#047857] disabled:opacity-50"
                                  id={`approve-btn-${item.ticket_number || item.id}`}
                                >
                                  <ThumbsUp className="h-3.5 w-3.5" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRejectModalItem(item);
                                    setRejectReason("");
                                    setRejectError(null);
                                  }}
                                  disabled={isActionLoading}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-600 shadow-xs transition hover:bg-rose-50 disabled:opacity-50"
                                  id={`reject-btn-${item.ticket_number || item.id}`}
                                >
                                  <ThumbsDown className="h-3.5 w-3.5" />
                                  <span>Reject</span>
                                </button>
                              </>
                            )
                          ) : (
                            item.ticket_id && (
                              <Link
                                href={`/itsm/requests/${item.ticket_id}`}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-[#6D28D9] hover:underline"
                              >
                                <span>View</span>
                                <ArrowRight className="h-3 w-3" />
                              </Link>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Reject Reason Modal */}
      {rejectModalItem && (
        <ModalShell
          title={`Reject Service Request · ${rejectModalItem.ticket_number || "REQ"}`}
          onClose={() => setRejectModalItem(null)}
          error={rejectError}
          maxWidthClass="max-w-[480px]"
        >
          <form onSubmit={handleRejectSubmit} className="space-y-4">
            <div>
              <p className="text-xs text-[#475069]">
                You are rejecting <span className="font-semibold text-[#0E1726]">{rejectModalItem.title}</span>. This will transition the ticket status to <span className="font-semibold text-rose-600">CANCELLED</span> and permanently block fulfillment.
              </p>
            </div>
            <div>
              <label htmlFor="incident-manager-reject-reason" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                Rejection Reason <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="incident-manager-reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this request is being rejected (e.g. Budget limit exceeded, duplicate request, out of policy)..."
                rows={4}
                required
                className="w-full rounded-xl border border-[#D0D5DD] p-3 text-xs text-[#0E1726] placeholder-[#8A93A5] focus:border-rose-400 focus:outline-none"
              />
              <p className="mt-1 text-[10px] text-[#6B7488]">
                This reason will be recorded in the audit log and dispatched as an in-app notification to the requester.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EEF1F5]">
              <button
                type="button"
                onClick={() => setRejectModalItem(null)}
                disabled={rejectSubmitting}
                className="rounded-lg border border-[#D0D5DD] px-3.5 py-2 text-xs font-semibold text-[#344054] hover:bg-[#F9FAFB]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={rejectSubmitting || !rejectReason.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-rose-700 disabled:opacity-50"
                id="confirm-reject-btn"
              >
                {rejectSubmitting ? "Rejecting..." : "Confirm Rejection"}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Team Assignment Modal */}
      {assignModalItem && assignModalItem.ticket_id && (
        <AssignModal
          incident={{
            id: assignModalItem.ticket_id,
            ticket_number: assignModalItem.ticket_number || "REQ",
            assignee_id: assignModalItem.assignee_id || null,
            assignment_group: assignModalItem.assignment_group || null,
          } as any}
          assignEndpoint={`/api/itsm/requests/${assignModalItem.ticket_id}/assign`}
          title={`Assign Supporting Team · ${assignModalItem.ticket_number || "REQ"}`}
          referenceEndpoint="/api/itsm/incidents/operations/reference-data"
          onClose={() => setAssignModalItem(null)}
          onSuccess={handleAssignSuccess}
        />
      )}
    </div>
  );
}

function ApprovalStatusBadge({ status }: { status: string }) {
  switch (status.toUpperCase()) {
    case "PENDING":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F0FF] px-2.5 py-0.5 text-[11px] font-bold text-[#6D28D9] border border-[#DDD6FE]">
          <Clock className="h-3 w-3" />
          Pending
        </span>
      );
    case "APPROVED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="h-3 w-3" />
          Approved
        </span>
      );
    case "REJECTED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 border border-rose-200">
          <XCircle className="h-3 w-3" />
          Rejected
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-0.5 text-[11px] font-bold text-slate-700 border border-slate-200">
          {status}
        </span>
      );
  }
}

function TicketStatusBadge({ status }: { status: string }) {
  switch (status.toUpperCase()) {
    case "NEW":
    case "ASSIGNED":
    case "PENDING":
      return (
        <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
          {status}
        </span>
      );
    case "IN_PROGRESS":
      return (
        <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800 border border-blue-200">
          In Progress
        </span>
      );
    case "RESOLVED":
      return (
        <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 border border-emerald-200">
          Resolved
        </span>
      );
    case "CLOSED":
      return (
        <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-800 border border-gray-200">
          Closed
        </span>
      );
    case "CANCELLED":
      return (
        <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-800 border border-rose-200">
          Cancelled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-800 border border-slate-200">
          {status}
        </span>
      );
  }
}
