"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Clock,
  ClipboardCheck,
  RefreshCw,
  Search,
  User,
  Users,
  Layers,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  X,
  XCircle,
  Filter,
} from "lucide-react";
import { formatDateTime, itsmSlaConfig } from "@/lib/itsm-format";
import { ServiceRequest } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";

type FilterTab = "ALL" | "ASSIGNED_TO_ME" | "OPEN" | "IN_PROGRESS" | "RESOLVED";

function ServiceRequestsContent() {
  const searchParams = useSearchParams();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<FilterTab>("ALL");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        if (session && session.id) {
          setCurrentUserId(session.id);
        }
      })
      .catch(() => {});
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }
      params.set("limit", "100");

      const res = await fetch(`/api/itsm/requests?${params.toString()}`);
      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "Failed to load service requests");
      }

      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load service requests");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedSearch(search);
  };

  const clearSearch = () => {
    setSearch("");
    setDebouncedSearch("");
  };

  const filteredRequests = requests.filter((req) => {
    if (activeFilter === "ALL") return true;
    if (activeFilter === "ASSIGNED_TO_ME") {
      return (
        (currentUserId && req.assignee_id === currentUserId) ||
        (req.assignee_email && req.assignee_email.toLowerCase().includes("agent"))
      );
    }
    if (activeFilter === "OPEN") {
      return req.status === "NEW" || req.status === "ASSIGNED";
    }
    if (activeFilter === "IN_PROGRESS") {
      return req.status === "IN_PROGRESS" || req.status === "PENDING";
    }
    if (activeFilter === "RESOLVED") {
      return req.status === "RESOLVED" || req.status === "CLOSED";
    }
    return true;
  });

  const filterTabs: { label: string; key: FilterTab; count: number }[] = [
    { label: "All Requests", key: "ALL", count: requests.length },
    {
      label: "Assigned to Me",
      key: "ASSIGNED_TO_ME",
      count: requests.filter((r) =>
        (currentUserId && r.assignee_id === currentUserId) ||
        (r.assignee_email && r.assignee_email.toLowerCase().includes("agent"))
      ).length,
    },
    {
      label: "Open",
      key: "OPEN",
      count: requests.filter((r) => r.status === "NEW" || r.status === "ASSIGNED").length,
    },
    {
      label: "In Progress",
      key: "IN_PROGRESS",
      count: requests.filter((r) => r.status === "IN_PROGRESS" || r.status === "PENDING").length,
    },
    {
      label: "Resolved",
      key: "RESOLVED",
      count: requests.filter((r) => r.status === "RESOLVED" || r.status === "CLOSED").length,
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto" id="service-agent-requests-page">
      {/* Top Banner / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-[#6D28D9] flex items-center justify-center shrink-0 shadow-xs border border-purple-100">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#0E1726] tracking-tight">Service Requests</h1>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-[#6D28D9] border border-purple-200">
                Fulfillment Workspace
              </span>
            </div>
            <p className="text-xs text-[#6B7488] mt-1">
              Fulfill, triage, and track service requests submitted across your organization.
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchRequests()}
          id="refresh-requests-btn"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs font-semibold text-[#475069] hover:bg-[#F9FAFB] hover:text-[#0E1726] transition shadow-xs self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#6D28D9]" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter Tabs & Search Controls */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none" id="request-filter-tabs">
          {filterTabs.map((tab) => {
            const isActive = activeFilter === tab.key;
            return (
              <button
                key={tab.key}
                id={`filter-tab-${tab.key.toLowerCase().replace(/_/g, "-")}`}
                onClick={() => setActiveFilter(tab.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition shrink-0 ${
                  isActive
                    ? "bg-[#6D28D9] text-white shadow-xs font-semibold"
                    : "bg-white border border-[#E6E9F0] text-[#475069] hover:bg-[#F9FAFB] hover:text-[#0E1726]"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isActive ? "bg-white/20 text-white" : "bg-[#F1F3F9] text-[#6B7488]"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#8C95A8] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="requests-search-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ticket #, description, requester..."
            className="w-full pl-9.5 pr-20 py-2 bg-white border border-[#E6E9F0] rounded-xl text-xs text-[#0E1726] placeholder-[#8C95A8] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {search && (
              <button
                type="button"
                id="clear-search-btn"
                onClick={clearSearch}
                className="p-1 rounded text-[#8C95A8] hover:text-[#0E1726] transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="submit"
              id="requests-search-button"
              className="px-2 py-1 bg-[#6D28D9] text-white rounded-lg text-[11px] font-semibold hover:bg-[#5B21B6] transition"
            >
              Search
            </button>
          </div>
        </form>
      </div>

      {/* Main Content Area */}
      {loading && requests.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center" id="requests-loading-state">
          <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin mx-auto mb-3" />
          <p className="text-xs text-[#475069]">Loading service requests...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-red-200 p-8 text-center space-y-3" id="requests-error-state">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
          <p className="text-sm font-bold text-[#0E1726]">Unable to load service requests</p>
          <p className="text-xs text-[#6B7488] max-w-md mx-auto">{error}</p>
          <button
            onClick={() => fetchRequests()}
            id="retry-requests-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6D28D9] text-white rounded-xl text-xs font-semibold hover:bg-[#5B21B6] transition shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </button>
        </div>
      ) : filteredRequests.length === 0 ? (
        <div
          className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center space-y-3"
          id={debouncedSearch ? "requests-search-empty-state" : "requests-empty-state"}
        >
          <div className="w-12 h-12 rounded-2xl bg-[#F5F7FA] text-[#6B7488] flex items-center justify-center mx-auto">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#0E1726]">
            {debouncedSearch ? `No requests matching "${debouncedSearch}"` : "No service requests found"}
          </h3>
          <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
            {debouncedSearch
              ? "Try adjusting your search terms or clearing filters to view requests."
              : activeFilter !== "ALL"
              ? "There are no requests matching the selected filter in your workspace."
              : "Standard service requests submitted through the catalog will appear here for fulfillment."}
          </p>
          {debouncedSearch && (
            <button
              onClick={clearSearch}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#F5F7FA] text-[#475069] rounded-xl text-xs font-semibold hover:bg-[#E6E9F0] transition"
            >
              Clear Search
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3" id="requests-list-container">
          {filteredRequests.map((req) => {
            const slaConfig = req.sla_status ? itsmSlaConfig(req.sla_status) : null;
            return (
              <Link
                key={req.id}
                href={`/itsm/requests/${req.id}`}
                id={`request-row-${req.ticket_number.toLowerCase()}`}
                className="block bg-white rounded-2xl border border-[#E6E9F0] hover:border-[#6D28D9]/40 hover:shadow-sm p-5 transition group"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left Column: Number, Title, Status, Priority, Description */}
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-purple-50 text-[#6D28D9] border border-purple-200">
                        {req.ticket_number}
                      </span>
                      <IncidentPriorityBadge priority={req.priority} />
                      <IncidentStatusBadge status={req.status} />
                      {/* Approval Status Badge */}
                      {req.approval_required || req.approval_status ? (
                        req.approval_status === "PENDING" || (!req.approval_status && req.status === "PENDING") ? (
                          <span id={`approval-badge-${req.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold">
                            <Clock className="w-3 h-3 text-amber-600" /> Awaiting Approval
                          </span>
                        ) : req.approval_status === "APPROVED" ? (
                          <span id={`approval-badge-${req.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Approved
                          </span>
                        ) : req.approval_status === "REJECTED" ? (
                          <span id={`approval-badge-${req.id}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-semibold">
                            <XCircle className="w-3 h-3 text-rose-600" /> Rejected
                          </span>
                        ) : null
                      ) : null}
                      {slaConfig && (
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${slaConfig.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${slaConfig.dot}`} />
                          {slaConfig.label}
                        </span>
                      )}
                    </div>

                    <h2 className="text-sm md:text-base font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition truncate">
                      {req.title}
                    </h2>

                    {req.description && (
                      <p className="text-xs text-[#6B7488] line-clamp-2 max-w-2xl leading-relaxed">
                        {req.description}
                      </p>
                    )}

                    {req.rejection_reason && (
                      <div id={`rejection-reason-${req.id}`} className="text-[11px] text-rose-700 bg-rose-50/90 border border-rose-200 rounded-xl px-3 py-1.5 font-medium max-w-2xl flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        <span><strong>Rejection Reason:</strong> {req.rejection_reason}</span>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Metadata Badges (Requester, Service, Team, Assignee, Updated) */}
                  <div className="flex flex-wrap lg:flex-col lg:items-end gap-x-4 gap-y-1.5 text-xs text-[#6B7488] shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-[#F1F3F9]">
                    {/* Requester */}
                    <div className="inline-flex items-center gap-1.5 text-[11px]" title="Requester">
                      <User className="w-3.5 h-3.5 text-[#8C95A8]" />
                      <span className="text-[#0E1726] font-medium">{req.requester_email || "Requester"}</span>
                    </div>

                    {/* Service */}
                    {req.service_name && (
                      <div className="inline-flex items-center gap-1.5 text-[11px]" title="Affected Service">
                        <Layers className="w-3.5 h-3.5 text-[#8C95A8]" />
                        <span>{req.service_name}</span>
                      </div>
                    )}

                    {/* Assigned Team & Assignee */}
                    <div className="inline-flex items-center gap-1.5 text-[11px]" title="Assignment">
                      <Users className="w-3.5 h-3.5 text-[#8C95A8]" />
                      <span>{req.assignment_group || "Unassigned Team"}</span>
                      {req.assignee_email && (
                        <span className="text-[#0E1726] font-medium">({req.assignee_email})</span>
                      )}
                    </div>

                    {/* Updated Time */}
                    <div className="inline-flex items-center gap-1 text-[11px] text-[#8C95A8]">
                      <Clock className="w-3 h-3" />
                      <span>Updated {formatDateTime(req.updated_at)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ServiceRequestsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 max-w-6xl mx-auto text-center">
          <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin mx-auto mb-2" />
          <span className="text-xs text-[#6B7488]">Loading workspace...</span>
        </div>
      }
    >
      <ServiceRequestsContent />
    </Suspense>
  );
}
