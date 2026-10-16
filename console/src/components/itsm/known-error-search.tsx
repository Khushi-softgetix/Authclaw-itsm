"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  Info,
  Layers,
  Link2,
  Link2Off,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import type { KnownErrorLookupItem, LinkIncidentProblemResponse } from "@/lib/itsm-types";

interface KnownErrorSearchProps {
  incidentId: string;
  incidentTicketNumber?: string;
  incidentTitle?: string;
  incidentServiceId?: string | null;
  incidentServiceName?: string | null;
  linkedProblemId?: string | null;
  linkedProblemTicketNumber?: string | null;
  onIncidentUpdated: () => void;
  canLink?: boolean;
}

export default function KnownErrorSearch({
  incidentId,
  incidentTicketNumber,
  incidentTitle,
  incidentServiceId,
  incidentServiceName,
  linkedProblemId,
  linkedProblemTicketNumber,
  onIncidentUpdated,
  canLink = true,
}: KnownErrorSearchProps) {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterByService, setFilterByService] = useState<boolean>(false);
  const [items, setItems] = useState<KnownErrorLookupItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<boolean>(false);
  const [linkFeedback, setLinkFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  const fetchKnownErrors = useCallback(
    async (queryText?: string, serviceIdFilter?: string | null) => {
      try {
        setLoading(true);
        setError(null);
        setLinkFeedback(null);

        const params = new URLSearchParams();
        const activeQuery = queryText !== undefined ? queryText : searchQuery;
        if (activeQuery.trim()) {
          params.set("search", activeQuery.trim());
        }

        const activeService =
          serviceIdFilter !== undefined
            ? serviceIdFilter
            : filterByService && incidentServiceId
            ? incidentServiceId
            : null;

        if (activeService) {
          params.set("service_id", activeService);
        }

        params.set("limit", "25");

        const res = await fetch(`/api/itsm/problems/known-errors?${params.toString()}`);
        if (res.status === 401) {
          window.location.href = "/itsm/login";
          return;
        }

        if (res.status === 403) {
          setError("You do not have permission to search the Known Error Database.");
          setItems([]);
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || "Failed to search Known Errors");
        }

        const data = await res.json();
        const results = Array.isArray(data) ? data : [];
        setItems(results);
        setHasSearched(true);

        // Auto-expand first item if only 1-2 results returned
        if (results.length > 0 && results.length <= 2) {
          setExpandedCardId(results[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error searching Known Errors. Please try again.");
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [searchQuery, filterByService, incidentServiceId]
  );

  // Initialize search with service or general on mount
  useEffect(() => {
    fetchKnownErrors("", filterByService && incidentServiceId ? incidentServiceId : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchKnownErrors(searchQuery, filterByService && incidentServiceId ? incidentServiceId : null);
  };

  const handleUseIncidentSymptoms = () => {
    if (!incidentTitle) return;
    setSearchQuery(incidentTitle);
    fetchKnownErrors(incidentTitle, filterByService && incidentServiceId ? incidentServiceId : null);
  };

  const handleToggleServiceFilter = () => {
    const nextVal = !filterByService;
    setFilterByService(nextVal);
    fetchKnownErrors(searchQuery, nextVal && incidentServiceId ? incidentServiceId : null);
  };

  const handleLinkProblem = async (problemId: string, problemNumber: string) => {
    if (!canLink) return;
    try {
      setLinkingId(problemId);
      setLinkFeedback(null);

      const res = await fetch(`/api/itsm/incidents/${incidentId}/link-problem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem_id: problemId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to link incident to Problem");
      }

      const data: LinkIncidentProblemResponse = await res.json();
      setLinkFeedback({
        type: "success",
        message: data.message || `Incident linked to Problem ${problemNumber} successfully.`,
      });
      onIncidentUpdated();
    } catch (err) {
      setLinkFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to link problem.",
      });
    } finally {
      setLinkingId(null);
    }
  };

  const handleUnlinkProblem = async () => {
    if (!canLink) return;
    try {
      setUnlinking(true);
      setLinkFeedback(null);

      const res = await fetch(`/api/itsm/incidents/${incidentId}/unlink-problem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to unlink problem");
      }

      const data: LinkIncidentProblemResponse = await res.json();
      setLinkFeedback({
        type: "success",
        message: data.message || "Incident unlinked successfully.",
      });
      onIncidentUpdated();
    } catch (err) {
      setLinkFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to unlink problem.",
      });
    } finally {
      setUnlinking(false);
    }
  };

  const handleCopyWorkaround = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div
      className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-6"
      id="known-error-triage-section"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E6E9F0] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-[#6D28D9] flex items-center justify-center font-bold">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#0E1726]">Known Error &amp; Workaround Search</h2>
              <p className="text-[11px] text-[#6B7488]">
                Search vetted, approved temporary mitigations for incident triage.
              </p>
            </div>
          </div>
        </div>

        {linkedProblemId && (
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-purple-50 border border-purple-200 text-xs text-[#6D28D9] font-medium"
            id="active-linked-problem-banner"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Linked to:</span>
            <Link
              href={`/itsm/problem-change-manager/problems/${linkedProblemId}`}
              className="font-mono font-bold hover:underline"
              id="active-linked-problem-link"
            >
              {linkedProblemTicketNumber || "Problem Ticket"}
            </Link>
            {canLink && (
              <button
                type="button"
                onClick={handleUnlinkProblem}
                disabled={unlinking}
                id="active-unlink-problem-btn"
                className="ml-2 text-rose-600 hover:text-rose-700 text-[11px] font-semibold hover:underline inline-flex items-center gap-1"
                title="Unlink this problem"
              >
                {unlinking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Link2Off className="w-3 h-3" />}
                Unlink
              </button>
            )}
          </div>
        )}
      </div>

      {/* Triage Guidance Disclaimer */}
      <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-[11px] leading-relaxed">
          <span className="font-semibold text-amber-950">Governance Policy:</span> Approved workarounds provide temporary mitigation to unblock users.
          Viewing or applying a workaround <span className="font-semibold underline">does not</span> automatically resolve the incident. Confirm mitigation with the requester, then perform resolution using &quot;Resolve Incident&quot;.
        </div>
      </div>

      {/* Feedback Alert */}
      {linkFeedback && (
        <div
          id="known-error-link-feedback"
          className={`p-3 rounded-xl text-xs flex items-center justify-between border ${
            linkFeedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-2">
            {linkFeedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{linkFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setLinkFeedback(null)}
            className="text-[#6B7488] hover:text-[#0E1726] p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search Input Bar & Filters */}
      <form onSubmit={handleSearchSubmit} className="space-y-3" id="known-error-search-form">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input
              type="text"
              id="known-error-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by symptom, error message, MTU, timeout, keywords..."
              className="w-full pl-9 pr-3.5 py-2 text-xs border border-[#E6E9F0] rounded-xl bg-white placeholder-[#94A3B8] text-[#0E1726] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
            />
          </div>

          <button
            type="submit"
            id="known-error-search-submit"
            disabled={loading}
            className="px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition shadow-xs flex items-center justify-center gap-1.5 shrink-0"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>Search</span>
          </button>
        </div>

        {/* Quick Filters */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {incidentServiceId && (
            <button
              type="button"
              id="known-error-service-filter-btn"
              onClick={handleToggleServiceFilter}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-medium border transition ${
                filterByService
                  ? "bg-purple-50 border-purple-300 text-[#6D28D9]"
                  : "bg-white border-[#E6E9F0] text-[#6B7488] hover:bg-[#F5F7FA]"
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Service: {incidentServiceName || "This Service"}</span>
              {filterByService && <Check className="w-3 h-3 text-[#6D28D9]" />}
            </button>
          )}

          {incidentTitle && (
            <button
              type="button"
              id="known-error-prefill-title-btn"
              onClick={handleUseIncidentSymptoms}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-medium border border-[#E6E9F0] bg-white text-[#6B7488] hover:bg-[#F5F7FA] transition"
              title="Search with incident title as keywords"
            >
              <Sparkles className="w-3 h-3 text-amber-500" />
              <span>Use Incident Title</span>
            </button>
          )}

          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                fetchKnownErrors("", filterByService && incidentServiceId ? incidentServiceId : null);
              }}
              className="text-[11px] text-[#6B7488] hover:text-[#0E1726] underline ml-auto"
            >
              Clear filters
            </button>
          )}
        </div>
      </form>

      {/* Results Section */}
      <div className="space-y-3" id="known-error-results-container">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-10 space-y-2.5" id="known-error-loading">
            <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin" />
            <span className="text-xs text-[#6B7488]">Searching Known Error Database...</span>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="p-4 rounded-xl border border-red-200 bg-red-50/50 text-xs text-red-900 space-y-2" id="known-error-error">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchKnownErrors()}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[11px] font-semibold transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && hasSearched && items.length === 0 && (
          <div className="text-center py-10 px-4 rounded-xl border border-dashed border-[#E6E9F0] space-y-2" id="known-error-empty">
            <BookOpen className="w-8 h-8 text-[#94A3B8] mx-auto" />
            <h4 className="text-xs font-bold text-[#0E1726]">No Approved Known Errors Found</h4>
            <p className="text-[11px] text-[#6B7488] max-w-sm mx-auto">
              No matching workarounds found. Unapproved drafts, retired, expired, or overdue-review workarounds are strictly excluded.
            </p>
          </div>
        )}

        {/* List of Results */}
        {!loading && !error && items.length > 0 && (
          <div className="space-y-3" id="known-error-results-list">
            <div className="flex items-center justify-between text-[11px] text-[#6B7488] px-1">
              <span>Found {items.length} approved Known Error{items.length === 1 ? "" : "s"}</span>
              <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-semibold border border-emerald-200 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" /> Only Approved Workarounds
              </span>
            </div>

            {items.map((item) => {
              const isLinked = linkedProblemId === item.id;
              const isExpanded = expandedCardId === item.id;

              return (
                <div
                  key={item.id}
                  id={`known-error-card-${item.id}`}
                  className={`rounded-xl border transition p-4 space-y-3 ${
                    isLinked
                      ? "border-[#6D28D9] bg-purple-50/20 shadow-xs"
                      : "border-[#E6E9F0] hover:border-[#D1D5DB] bg-white"
                  }`}
                >
                  {/* Top Bar of Card */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-purple-50 text-[#6D28D9] border border-purple-200">
                          {item.ticket_number}
                        </span>

                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Approved Workaround
                        </span>

                        {item.service_name && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#F1F5F9] text-[#475569]">
                            <Layers className="w-3 h-3" />
                            {item.service_name}
                          </span>
                        )}

                        <span className="text-[10px] text-[#6B7488] px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200">
                          Status: {item.status}
                        </span>

                        {isLinked && (
                          <span
                            id={`linked-badge-${item.id}`}
                            className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-300"
                          >
                            Currently Linked
                          </span>
                        )}
                      </div>

                      <h3 className="text-xs font-bold text-[#0E1726] pt-0.5">
                        {item.title}
                      </h3>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                      {canLink && (
                        <>
                          {isLinked ? (
                            <button
                              type="button"
                              id={`unlink-problem-action-${item.id}`}
                              disabled={unlinking}
                              onClick={handleUnlinkProblem}
                              className="px-3 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold transition flex items-center gap-1"
                            >
                              {unlinking ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Link2Off className="w-3.5 h-3.5" />
                              )}
                              <span>Unlink Problem</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              id={`link-problem-action-${item.id}`}
                              disabled={linkingId === item.id}
                              onClick={() => handleLinkProblem(item.id, item.ticket_number)}
                              className="px-3 py-1.5 rounded-lg bg-[#6D28D9] hover:bg-[#5B21B6] disabled:opacity-50 text-white text-xs font-semibold transition flex items-center gap-1 shadow-xs"
                            >
                              {linkingId === item.id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Link2 className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {linkedProblemId ? "Switch to this Problem" : "Link to Incident"}
                              </span>
                            </button>
                          )}
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => setExpandedCardId(isExpanded ? null : item.id)}
                        className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
                        title={isExpanded ? "Collapse details" : "Expand details"}
                        id={`toggle-expand-${item.id}`}
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Workaround Highlight Box */}
                  <div className="bg-[#FAF8FF] border border-[#DDD6FE] rounded-xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#6D28D9] flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Approved Workaround Steps
                      </span>
                      <button
                        type="button"
                        id={`copy-workaround-${item.id}`}
                        onClick={() => handleCopyWorkaround(item.id, item.workaround_summary)}
                        className="text-[11px] font-semibold text-[#6D28D9] hover:text-[#5B21B6] inline-flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-[#DDD6FE] hover:bg-[#F5F7FA] transition"
                        title="Copy workaround instructions"
                      >
                        {copiedId === item.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Steps</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="text-xs text-[#0E1726] whitespace-pre-wrap leading-relaxed font-sans bg-white p-3 rounded-lg border border-[#EDE9FE]">
                      {item.workaround_summary}
                    </div>
                  </div>

                  {/* Collapsible Extended Details (Symptoms, Root Cause, Permanent Fix) */}
                  {isExpanded && (
                    <div className="pt-2 border-t border-[#F1F5F9] space-y-3 text-xs text-[#475069]">
                      {item.symptoms && (
                        <div>
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488] mb-0.5">
                            Reported Symptoms &amp; Error Pattern
                          </span>
                          <p className="bg-[#F8FAFC] p-2.5 rounded-lg border border-[#E2E8F0] text-xs text-[#1E293B]">
                            {item.symptoms}
                          </p>
                        </div>
                      )}

                      {item.root_cause_summary && (
                        <div>
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488] mb-0.5">
                            Underlying Root Cause
                          </span>
                          <p className="text-xs text-[#475069]">{item.root_cause_summary}</p>
                        </div>
                      )}

                      {item.permanent_solution && (
                        <div>
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488] mb-0.5">
                            Permanent Solution / Fix Status
                          </span>
                          <p className="text-xs text-emerald-900 bg-emerald-50/50 p-2 rounded-lg border border-emerald-100">
                            {item.permanent_solution}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[11px] text-[#94A3B8] pt-1">
                        <div className="flex items-center gap-3">
                          {item.workaround_approved_at && (
                            <span>Approved: {formatDateTime(item.workaround_approved_at)}</span>
                          )}
                          {item.review_due_at && (
                            <span>Next Review: {formatDateTime(item.review_due_at)}</span>
                          )}
                        </div>
                        <Link
                          href={`/itsm/problem-change-manager/problems/${item.id}`}
                          className="font-medium text-[#6D28D9] hover:underline flex items-center gap-1"
                        >
                          <span>Full Problem Details</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
