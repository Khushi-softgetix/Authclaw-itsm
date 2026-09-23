"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  GitPullRequest,
  History,
  Layers,
  Link2,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Ticket,
  Trash2,
  Unlink,
  User,
  Users,
  X,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { ChangeSummary, ProblemActivity, ProblemDetail } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";

function ChangeStatusBadge({ status }: { status: string }) {
  const upper = (status || "").toUpperCase();
  if (upper === "SCHEDULED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
        Scheduled
      </span>
    );
  }
  if (upper === "IN_PROGRESS" || upper === "IMPLEMENTING") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
        {upper === "IMPLEMENTING" ? "Implementing" : "In Progress"}
      </span>
    );
  }
  if (upper === "COMPLETED" || upper === "CLOSED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        {upper === "CLOSED" ? "Closed" : "Completed"}
      </span>
    );
  }
  if (upper === "CAB_REVIEW" || upper === "AWAITING_APPROVAL") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        CAB Review
      </span>
    );
  }
  if (upper === "APPROVED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        Approved
      </span>
    );
  }
  if (upper === "FAILED" || upper === "CANCELLED" || upper === "REJECTED") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        {upper.replace(/_/g, " ")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      {upper || "DRAFT"}
    </span>
  );
}

export default function ProblemDetailPage() {
  const params = useParams();
  const problemId = params?.problem_id as string;

  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [activities, setActivities] = useState<ProblemActivity[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activitiesLoading, setActivitiesLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Investigation form state
  const [investigationStatus, setInvestigationStatus] = useState<string>("OPEN");
  const [rootCause, setRootCause] = useState<string>("");
  const [workaround, setWorkaround] = useState<string>("");
  const [knownError, setKnownError] = useState<boolean>(false);
  const [permanentSolution, setPermanentSolution] = useState<string>("");
  const [rcaDocumentUrl, setRcaDocumentUrl] = useState<string>("");
  const [investigationNote, setInvestigationNote] = useState<string>("");

  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Resolve modal state
  const [resolveModalOpen, setResolveModalOpen] = useState<boolean>(false);
  const [resolveSummary, setResolveSummary] = useState<string>("");
  const [resolvePermanentSolution, setResolvePermanentSolution] = useState<string>("");
  const [resolveWorkaround, setResolveWorkaround] = useState<string>("");
  const [resolveRootCause, setResolveRootCause] = useState<string>("");
  const [resolveNotes, setResolveNotes] = useState<string>("");
  const [resolveSubmitting, setResolveSubmitting] = useState<boolean>(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Close modal state
  const [closeModalOpen, setCloseModalOpen] = useState<boolean>(false);
  const [closeNotes, setCloseNotes] = useState<string>("");
  const [closeSubmitting, setCloseSubmitting] = useState<boolean>(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Related Changes state (Step 8)
  const [relatedChanges, setRelatedChanges] = useState<ChangeSummary[]>([]);
  const [changesLoading, setChangesLoading] = useState<boolean>(false);

  // Link Existing Change modal state
  const [linkModalOpen, setLinkModalOpen] = useState<boolean>(false);
  const [availableChanges, setAvailableChanges] = useState<ChangeSummary[]>([]);
  const [availableLoading, setAvailableLoading] = useState<boolean>(false);
  const [selectedChangeIdToLink, setSelectedChangeIdToLink] = useState<string>("");
  const [linkingSubmitting, setLinkingSubmitting] = useState<boolean>(false);
  const [linkModalError, setLinkModalError] = useState<string | null>(null);

  // Create Change from Problem modal state
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [createTitle, setCreateTitle] = useState<string>("");
  const [createDescription, setCreateDescription] = useState<string>("");
  const [createChangeType, setCreateChangeType] = useState<string>("NORMAL");
  const [createRiskLevel, setCreateRiskLevel] = useState<string>("LOW");
  const [createImpactLevel, setCreateImpactLevel] = useState<string>("LOW");
  const [createImplPlan, setCreateImplPlan] = useState<string>("");
  const [createBackoutPlan, setCreateBackoutPlan] = useState<string>("");
  const [createTestPlan, setCreateTestPlan] = useState<string>("");
  const [createSubmitting, setCreateSubmitting] = useState<boolean>(false);
  const [createModalError, setCreateModalError] = useState<string | null>(null);

  // Unlink Change confirmation state
  const [unlinkingChange, setUnlinkingChange] = useState<ChangeSummary | null>(null);
  const [unlinkingSubmitting, setUnlinkingSubmitting] = useState<boolean>(false);

  const fetchActivities = useCallback(async () => {
    if (!problemId) return;
    try {
      setActivitiesLoading(true);
      const res = await fetch(`/api/itsm/problems/${problemId}/activities`);
      if (res.ok) {
        const data = await res.json();
        setActivities(data);
      }
    } catch {
      // Activity fetch failure non-blocking
    } finally {
      setActivitiesLoading(false);
    }
  }, [problemId]);

  const fetchRelatedChanges = useCallback(async () => {
    if (!problemId) return;
    try {
      setChangesLoading(true);
      const res = await fetch(`/api/itsm/problems/${problemId}/changes`);
      if (res.ok) {
        const data = await res.json();
        setRelatedChanges(data || []);
      }
    } catch {
      // non-blocking
    } finally {
      setChangesLoading(false);
    }
  }, [problemId]);

  const fetchProblem = useCallback(async () => {
    if (!problemId) return;
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/itsm/problems/${problemId}`);
      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (res.status === 404) {
        throw new Error("Problem ticket not found");
      }
      if (!res.ok) {
        throw new Error(`Failed to load problem (${res.status})`);
      }

      const data: ProblemDetail = await res.json();
      setProblem(data);
      if (data.related_changes) {
        setRelatedChanges(data.related_changes);
      }

      // Populate form state
      setInvestigationStatus(data.status || "OPEN");
      setRootCause(data.problem_details?.root_cause_summary || "");
      setWorkaround(data.problem_details?.workaround_summary || "");
      setKnownError(Boolean(data.problem_details?.known_error));
      setPermanentSolution(data.problem_details?.permanent_solution || "");
      setRcaDocumentUrl(data.problem_details?.rca_document_url || "");
    } catch (err: any) {
      setError(err?.message || "Failed to load problem details");
    } finally {
      setLoading(false);
    }
  }, [problemId]);

  useEffect(() => {
    fetchProblem();
    fetchActivities();
    fetchRelatedChanges();
  }, [fetchProblem, fetchActivities, fetchRelatedChanges]);

  // Modal open handlers
  const openLinkModal = async () => {
    setLinkModalError(null);
    setSelectedChangeIdToLink("");
    setLinkModalOpen(true);
    try {
      setAvailableLoading(true);
      const res = await fetch("/api/itsm/changes?limit=50");
      if (res.ok) {
        const data = await res.json();
        const activeLinkedIds = new Set(relatedChanges.map((c) => c.id));
        setAvailableChanges((data || []).filter((c: ChangeSummary) => !activeLinkedIds.has(c.id)));
      } else {
        setLinkModalError("Failed to load available change requests");
      }
    } catch {
      setLinkModalError("Network error loading change requests");
    } finally {
      setAvailableLoading(false);
    }
  };

  const handleLinkChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChangeIdToLink) {
      setLinkModalError("Please select a Change Request to link");
      return;
    }
    setLinkingSubmitting(true);
    setLinkModalError(null);
    try {
      const res = await fetch(`/api/itsm/problems/${problemId}/link-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change_id: selectedChangeIdToLink }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to link change request");
      }
      const updated = await res.json();
      setRelatedChanges(updated);
      setLinkModalOpen(false);
      fetchActivities();
    } catch (err: unknown) {
      setLinkModalError(err instanceof Error ? err.message : "Error linking change");
    } finally {
      setLinkingSubmitting(false);
    }
  };

  const openCreateModal = () => {
    setCreateModalError(null);
    setCreateTitle(`Permanent fix: ${problem?.title || ""}`);
    let desc = problem?.description || "";
    if (problem?.problem_details?.root_cause_summary) {
      desc += `\n\nRoot Cause Summary:\n${problem.problem_details.root_cause_summary}`;
    }
    setCreateDescription(desc);
    setCreateImplPlan(problem?.problem_details?.permanent_solution || "");
    setCreateBackoutPlan("");
    setCreateTestPlan("");
    setCreateChangeType("NORMAL");
    setCreateRiskLevel("LOW");
    setCreateImpactLevel("LOW");
    setCreateModalOpen(true);
  };

  const handleCreateChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createTitle.trim()) {
      setCreateModalError("Change title is required");
      return;
    }
    setCreateSubmitting(true);
    setCreateModalError(null);
    try {
      const res = await fetch(`/api/itsm/problems/${problemId}/create-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTitle.trim(),
          description: createDescription.trim(),
          change_type: createChangeType,
          risk_level: createRiskLevel,
          impact_level: createImpactLevel,
          implementation_plan: createImplPlan.trim() || undefined,
          backout_plan: createBackoutPlan.trim() || undefined,
          test_plan: createTestPlan.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create change request");
      }
      setCreateModalOpen(false);
      await fetchRelatedChanges();
      fetchActivities();
    } catch (err: unknown) {
      setCreateModalError(err instanceof Error ? err.message : "Error creating change");
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleUnlinkChange = async () => {
    if (!unlinkingChange) return;
    setUnlinkingSubmitting(true);
    try {
      const res = await fetch(`/api/itsm/problems/${problemId}/unlink-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change_id: unlinkingChange.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to unlink change request");
      }
      const updated = await res.json();
      setRelatedChanges(updated);
      setUnlinkingChange(null);
      fetchActivities();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error unlinking change");
    } finally {
      setUnlinkingSubmitting(false);
    }
  };

  const handleSaveInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problemId) return;

    try {
      setSaving(true);
      setSaveSuccess(null);
      setSaveError(null);

      const payload = {
        status: investigationStatus,
        root_cause_summary: rootCause,
        workaround_summary: workaround,
        known_error: knownError,
        permanent_solution: permanentSolution,
        rca_document_url: rcaDocumentUrl || null,
        investigation_notes: investigationNote.trim() ? investigationNote.trim() : null,
      };

      const res = await fetch(`/api/itsm/problems/${problemId}/investigation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.detail || `Failed to update investigation (${res.status})`);
      }

      const updatedProblem: ProblemDetail = await res.json();
      setProblem(updatedProblem);
      setInvestigationNote("");
      setSaveSuccess("Investigation and root cause details recorded successfully.");
      await fetchActivities();

      setTimeout(() => {
        setSaveSuccess(null);
      }, 5000);
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save investigation");
    } finally {
      setSaving(false);
    }
  };

  const openResolveModal = () => {
    if (!problem) return;
    setResolveSummary(problem.resolution_summary || "");
    setResolvePermanentSolution(problem.problem_details?.permanent_solution || "");
    setResolveWorkaround(problem.problem_details?.workaround_summary || "");
    setResolveRootCause(problem.problem_details?.root_cause_summary || "");
    setResolveNotes("");
    setResolveError(null);
    setResolveModalOpen(true);
  };

  const handleResolveProblem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problemId || !resolveSummary.trim()) {
      setResolveError("Resolution summary is required.");
      return;
    }

    try {
      setResolveSubmitting(true);
      setResolveError(null);

      const payload = {
        resolution_summary: resolveSummary.trim(),
        resolution_notes: resolveNotes.trim() ? resolveNotes.trim() : null,
        permanent_solution: resolvePermanentSolution.trim() ? resolvePermanentSolution.trim() : null,
        workaround_summary: resolveWorkaround.trim() ? resolveWorkaround.trim() : null,
        root_cause_summary: resolveRootCause.trim() ? resolveRootCause.trim() : null,
      };

      const res = await fetch(`/api/itsm/problems/${problemId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.detail || `Failed to resolve problem (${res.status})`);
      }

      const updatedProblem: ProblemDetail = await res.json();
      setProblem(updatedProblem);
      setInvestigationStatus(updatedProblem.status);
      setResolveModalOpen(false);
      setSaveSuccess("Problem resolved successfully.");
      await fetchActivities();

      setTimeout(() => {
        setSaveSuccess(null);
      }, 5000);
    } catch (err: any) {
      setResolveError(err?.message || "Failed to resolve problem");
    } finally {
      setResolveSubmitting(false);
    }
  };

  const openCloseModal = () => {
    setCloseNotes("");
    setCloseError(null);
    setCloseModalOpen(true);
  };

  const handleCloseProblem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problemId) return;

    try {
      setCloseSubmitting(true);
      setCloseError(null);

      const payload = {
        closure_notes: closeNotes.trim() ? closeNotes.trim() : null,
      };

      const res = await fetch(`/api/itsm/problems/${problemId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.detail || `Failed to close problem (${res.status})`);
      }

      const updatedProblem: ProblemDetail = await res.json();
      setProblem(updatedProblem);
      setInvestigationStatus(updatedProblem.status);
      setCloseModalOpen(false);
      setSaveSuccess("Problem closed successfully.");
      await fetchActivities();

      setTimeout(() => {
        setSaveSuccess(null);
      }, 5000);
    } catch (err: any) {
      setCloseError(err?.message || "Failed to close problem");
    } finally {
      setCloseSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-[#6B7488] space-y-3 max-w-6xl mx-auto">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-[#6D28D9]" />
        <p className="text-xs font-medium">Loading problem details...</p>
      </div>
    );
  }

  if (error || !problem) {
    return (
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        <Link
          href="/itsm/problem-change-manager/problems"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Problems</span>
        </Link>
        <div className="p-8 rounded-[20px] border border-red-200 bg-red-50 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-red-900">
              {error || "Problem Not Found"}
            </h2>
            <p className="text-xs text-red-700">
              The requested problem record may not exist or belongs to another tenant.
            </p>
          </div>
          <Link
            href="/itsm/problem-change-manager/problems"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
          >
            Return to Problems Queue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto" id="pcm-problem-detail-page">
      {/* Blue Gradient Header matching Knowledge Banner */}
      <div
        className="bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] rounded-2xl p-6 sm:p-8 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
        id="pcm-problem-detail-header"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/itsm/problem-change-manager/problems"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm hover:bg-white/25 transition"
              id="back-to-problems-link"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Problems</span>
            </Link>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-mono font-semibold backdrop-blur-sm">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
              <span id="detail-ticket-number">{problem.ticket_number}</span>
            </span>
          </div>

          <h1
            className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white"
            id="detail-title"
          >
            {problem.title}
          </h1>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <IncidentStatusBadge status={problem.status} />
            <IncidentPriorityBadge priority={problem.priority} />
            {problem.service_name && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-white text-xs font-medium backdrop-blur-sm">
                <Layers className="w-3 h-3 text-blue-200" />
                <span>{problem.service_name}</span>
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-3">
          {(problem.status === "OPEN" || problem.status === "IN_PROGRESS") && (
            <button
              onClick={openResolveModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition"
              id="header-resolve-button"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Resolve</span>
            </button>
          )}
          {problem.status === "RESOLVED" && (
            <button
              onClick={openCloseModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-sm transition"
              id="header-close-button"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Close Problem</span>
            </button>
          )}
          <button
            onClick={() => fetchProblem()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold border border-white/20 backdrop-blur-sm transition"
            title="Refresh detail"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Left Column (Details, Investigation, Resolution & Timeline) | Right Column (Metadata) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description Card */}
          <div className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-4">
            <div className="flex items-center gap-2 border-b border-[#E6E9F0] pb-3">
              <FileText className="w-4 h-4 text-[#6D28D9]" />
              <h2 className="text-sm font-bold text-[#0E1726]">Problem Description</h2>
            </div>
            <div className="space-y-3 text-xs leading-relaxed text-[#334155] whitespace-pre-wrap font-sans">
              <p>{problem.description || "No description provided."}</p>
            </div>
          </div>

          {/* Investigation & Root Cause Form */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-5"
            id="pcm-investigation-section"
          >
            <div id="pcm-problem-details-section" className="hidden" />

            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#6D28D9]" />
                <h2 className="text-sm font-bold text-[#0E1726]">
                  Investigation &amp; Root Cause
                </h2>
              </div>
              {knownError && (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] text-xs font-semibold border border-[#FDE68A]"
                  id="known-error-badge"
                >
                  Known Error (KEDB)
                </span>
              )}
            </div>

            {saveSuccess && (
              <div
                className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2"
                id="investigation-save-success"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{saveSuccess}</span>
              </div>
            )}

            {saveError && (
              <div
                className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2"
                id="investigation-save-error"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            <form onSubmit={handleSaveInvestigation} className="space-y-4 text-xs">
              {/* Status and Known Error row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="investigation-status-select"
                    className="block font-semibold text-[#0E1726]"
                  >
                    Problem Lifecycle Status
                  </label>
                  <select
                    id="investigation-status-select"
                    value={investigationStatus}
                    onChange={(e) => setInvestigationStatus(e.target.value)}
                    disabled={problem.status === "CLOSED"}
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition disabled:opacity-60"
                  >
                    <option value="OPEN">OPEN — Investigation Pending</option>
                    <option value="IN_PROGRESS">IN_PROGRESS — Actively Investigating</option>
                    <option value="RESOLVED">RESOLVED — Root Cause / Solution Found</option>
                    <option value="CLOSED">CLOSED — Concluded</option>
                  </select>
                </div>

                <div className="flex items-center pt-5 sm:pt-6">
                  <label className="relative flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      id="known-error-checkbox"
                      checked={knownError}
                      onChange={(e) => setKnownError(e.target.checked)}
                      disabled={problem.status === "CLOSED"}
                      className="w-4 h-4 text-[#6D28D9] rounded border-[#CBD5E1] focus:ring-[#6D28D9] disabled:opacity-60"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-[#0E1726] block">
                        Mark as Known Error (KEDB)
                      </span>
                      <span className="text-[#64748B] text-[11px]">
                        Root cause is known and a temporary workaround is available
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Root Cause Textarea */}
              <div className="space-y-1.5">
                <label
                  htmlFor="root-cause-summary-input"
                  className="block font-semibold text-[#0E1726]"
                >
                  Root Cause Summary
                </label>
                <textarea
                  id="root-cause-summary-input"
                  rows={3}
                  value={rootCause}
                  onChange={(e) => setRootCause(e.target.value)}
                  disabled={problem.status === "CLOSED"}
                  placeholder="Detail the technical or systemic root cause identified..."
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition resize-y disabled:opacity-60"
                />
              </div>

              {/* Workaround Textarea */}
              <div className="space-y-1.5">
                <label
                  htmlFor="workaround-summary-input"
                  className="block font-semibold text-[#0E1726]"
                >
                  Workaround / Temporary Solution
                </label>
                <textarea
                  id="workaround-summary-input"
                  rows={3}
                  value={workaround}
                  onChange={(e) => setWorkaround(e.target.value)}
                  disabled={problem.status === "CLOSED"}
                  placeholder="Document immediate workaround steps for service agents to mitigate incidents..."
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition resize-y disabled:opacity-60"
                />
              </div>

              {/* Permanent Solution Textarea */}
              <div className="space-y-1.5">
                <label
                  htmlFor="permanent-solution-input"
                  className="block font-semibold text-[#0E1726]"
                >
                  Permanent Solution
                </label>
                <textarea
                  id="permanent-solution-input"
                  rows={2}
                  value={permanentSolution}
                  onChange={(e) => setPermanentSolution(e.target.value)}
                  disabled={problem.status === "CLOSED"}
                  placeholder="Long-term fix, permanent patch, or architecture enhancement..."
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition resize-y disabled:opacity-60"
                />
              </div>

              {/* RCA Document URL */}
              <div className="space-y-1.5">
                <label
                  htmlFor="rca-document-url-input"
                  className="block font-semibold text-[#0E1726]"
                >
                  RCA Document URL (Optional)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    id="rca-document-url-input"
                    value={rcaDocumentUrl}
                    onChange={(e) => setRcaDocumentUrl(e.target.value)}
                    disabled={problem.status === "CLOSED"}
                    placeholder="https://docs.example.com/postmortem/..."
                    className="flex-1 px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition disabled:opacity-60"
                  />
                  {rcaDocumentUrl && (
                    <a
                      href={rcaDocumentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 p-2 rounded-xl border border-[#E6E9F0] hover:bg-[#F1F5F9] text-[#2563EB] transition"
                      title="Open RCA URL"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>

              {/* Add Investigation Note to History */}
              {problem.status !== "CLOSED" && (
                <div className="space-y-1.5 pt-2 border-t border-[#E6E9F0]">
                  <label
                    htmlFor="investigation-notes-input"
                    className="block font-semibold text-[#0E1726]"
                  >
                    Add Investigation Note (Records to Activity Timeline)
                  </label>
                  <textarea
                    id="investigation-notes-input"
                    rows={2}
                    value={investigationNote}
                    onChange={(e) => setInvestigationNote(e.target.value)}
                    placeholder="Record an investigation update, diagnostic discovery, or meeting notes..."
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition resize-y"
                  />
                </div>
              )}

              {/* Submit Button */}
              {problem.status !== "CLOSED" && (
                <div className="flex items-center justify-end pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    id="save-investigation-button"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition"
                  >
                    {saving ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving Investigation...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Save Investigation</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </form>
          </div>

          {/* Resolution & Closure Section */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-5"
            id="pcm-resolution-section"
          >
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-bold text-[#0E1726]">
                  Resolution &amp; Closure
                </h2>
              </div>
              {problem.status === "RESOLVED" && (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200"
                  id="resolution-status-badge"
                >
                  Resolved
                </span>
              )}
              {problem.status === "CLOSED" && (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200"
                  id="closure-status-badge"
                >
                  Closed
                </span>
              )}
            </div>

            {/* Content depending on status */}
            {problem.status === "RESOLVED" ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900">
                      Problem Resolved
                    </span>
                    {problem.resolved_at && (
                      <span className="text-[11px] text-emerald-700 font-medium">
                        Resolved on {formatDateTime(problem.resolved_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-emerald-900 font-semibold" id="resolution-summary-display">
                    {problem.resolution_summary || "No resolution summary provided."}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] space-y-1">
                    <span className="font-semibold text-[#0E1726] block">Permanent Fix</span>
                    <p className="text-[#475569] leading-relaxed" id="permanent-solution-display">
                      {problem.problem_details?.permanent_solution || "—"}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] space-y-1">
                    <span className="font-semibold text-[#0E1726] block">Workaround</span>
                    <p className="text-[#475569] leading-relaxed" id="workaround-display">
                      {problem.problem_details?.workaround_summary || "—"}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] space-y-1 md:col-span-2">
                    <span className="font-semibold text-[#0E1726] block">Confirmed Root Cause</span>
                    <p className="text-[#475569] leading-relaxed" id="root-cause-display">
                      {problem.problem_details?.root_cause_summary || "—"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#E6E9F0]">
                  <p className="text-xs text-[#64748B]">
                    Root cause confirmed and permanent fix verified. Ready to conclude lifecycle.
                  </p>
                  <button
                    type="button"
                    onClick={openCloseModal}
                    id="open-close-modal-button"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-sm transition"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Close Problem</span>
                  </button>
                </div>
              </div>
            ) : problem.status === "CLOSED" ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      Problem Closed &amp; Concluded
                    </span>
                    {problem.closed_at && (
                      <span className="text-[11px] text-slate-600 font-medium">
                        Closed on {formatDateTime(problem.closed_at)}
                        {problem.closed_by_email && ` by ${problem.closed_by_email}`}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-700" id="resolution-summary-display">
                    <span className="font-semibold text-slate-900">Resolution: </span>
                    {problem.resolution_summary || "Resolved"}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] space-y-1">
                    <span className="font-semibold text-[#0E1726] block">Permanent Fix</span>
                    <p className="text-[#475569] leading-relaxed" id="permanent-solution-display">
                      {problem.problem_details?.permanent_solution || "—"}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] space-y-1">
                    <span className="font-semibold text-[#0E1726] block">Workaround</span>
                    <p className="text-[#475569] leading-relaxed" id="workaround-display">
                      {problem.problem_details?.workaround_summary || "—"}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] space-y-1 md:col-span-2">
                    <span className="font-semibold text-[#0E1726] block">Confirmed Root Cause</span>
                    <p className="text-[#475569] leading-relaxed" id="root-cause-display">
                      {problem.problem_details?.root_cause_summary || "—"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E6E9F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-semibold text-[#0E1726]">
                      Ready to resolve this problem?
                    </h4>
                    <p className="text-xs text-[#64748B]">
                      Document the resolution summary and permanent fix once root-cause analysis is complete.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openResolveModal}
                    id="open-resolve-modal-button"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition shrink-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Resolve Problem</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Related Incidents Section */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-4"
            id="pcm-related-incidents-section"
          >
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-[#2563EB]" />
                <h2 className="text-sm font-bold text-[#0E1726]">Related Incidents</h2>
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#EFF6FF] text-[#2563EB] text-xs font-semibold border border-[#DBEAFE]">
                {problem.related_incidents?.length || 0} Linked
              </span>
            </div>

            {(!problem.related_incidents || problem.related_incidents.length === 0) ? (
              <div className="p-8 text-center text-[#6B7488] space-y-2">
                <Ticket className="w-6 h-6 text-[#94A3B8] mx-auto" />
                <p className="text-xs">No related incidents linked to this problem.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#E6E9F0] text-[#6B7488] font-semibold">
                      <th className="py-2.5 px-3">Incident #</th>
                      <th className="py-2.5 px-3">Title</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Priority</th>
                      <th className="py-2.5 px-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E9F0]">
                    {problem.related_incidents.map((inc) => (
                      <tr key={inc.id} className="hover:bg-[#F8FAFC] transition">
                        <td className="py-3 px-3 font-semibold text-[#6D28D9]">
                          <Link
                            href={`/itsm/incidents/${inc.id}`}
                            className="hover:underline inline-flex items-center gap-1"
                          >
                            <span>{inc.ticket_number}</span>
                            <ExternalLink className="w-3 h-3 text-[#94A3B8]" />
                          </Link>
                        </td>
                        <td className="py-3 px-3 font-medium text-[#0E1726] max-w-xs truncate">
                          {inc.title}
                        </td>
                        <td className="py-3 px-3">
                          <IncidentStatusBadge status={inc.status} />
                        </td>
                        <td className="py-3 px-3">
                          <IncidentPriorityBadge priority={inc.priority} />
                        </td>
                        <td className="py-3 px-3 text-[#6B7488]">
                          {formatDateTime(inc.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Related Change Requests Section (Step 8) */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-4"
            id="pcm-related-changes-section"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <GitPullRequest className="w-4 h-4 text-[#6D28D9]" />
                <h2 className="text-sm font-bold text-[#0E1726]">Related Change Requests</h2>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#F3E8FF] text-[#7E22CE] text-xs font-semibold"
                  id="pcm-related-changes-count"
                >
                  {relatedChanges.length} Linked
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openLinkModal}
                  id="pcm-link-existing-change-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-[#0E1726] text-xs font-semibold shadow-sm transition cursor-pointer"
                >
                  <Link2 className="w-3.5 h-3.5 text-[#6B7488]" />
                  <span>Link Existing Change</span>
                </button>
                <button
                  type="button"
                  onClick={openCreateModal}
                  id="pcm-create-change-from-problem-btn"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold shadow-sm transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Change Request</span>
                </button>
              </div>
            </div>

            {changesLoading ? (
              <div className="p-8 text-center text-[#6B7488] space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#6D28D9]" />
                <p className="text-xs">Loading linked changes...</p>
              </div>
            ) : relatedChanges.length === 0 ? (
              <div
                className="p-8 rounded-xl bg-[#FAF5FF]/50 border border-[#E9D5FF] text-center space-y-3"
                id="pcm-no-related-changes"
              >
                <GitPullRequest className="w-8 h-8 text-[#A855F7] mx-auto opacity-75" />
                <div className="max-w-md mx-auto space-y-1">
                  <p className="text-xs font-semibold text-[#581C87]">
                    No change requests linked to this problem yet.
                  </p>
                  <p className="text-[11px] text-[#7E22CE]">
                    Link an existing change or create a new permanent fix to initiate CAB review and deployment.
                  </p>
                </div>
                <div className="pt-1 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-medium hover:bg-[#5B21B6] transition shadow-xs cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Create Permanent Fix Change</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#E6E9F0] text-[#6B7488] font-semibold">
                      <th className="py-2.5 px-3">Change #</th>
                      <th className="py-2.5 px-3">Title</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Risk</th>
                      <th className="py-2.5 px-3">Updated</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E9F0]">
                    {relatedChanges.map((chg) => (
                      <tr key={chg.id} className="hover:bg-[#F8FAFC] transition">
                        <td className="py-3 px-3 font-semibold text-[#6D28D9]">
                          <Link
                            href={`/itsm/problem-change-manager/changes/${chg.id}`}
                            className="hover:underline inline-flex items-center gap-1 font-mono"
                          >
                            <span>{chg.change_number}</span>
                            <ExternalLink className="w-3 h-3 text-[#94A3B8]" />
                          </Link>
                        </td>
                        <td className="py-3 px-3 font-medium text-[#0E1726] max-w-xs truncate">
                          {chg.title}
                        </td>
                        <td className="py-3 px-3">
                          <ChangeStatusBadge status={chg.status} />
                        </td>
                        <td className="py-3 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
                            {chg.change_type || "NORMAL"}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-50 text-slate-600 border border-slate-200">
                            {chg.risk_level || "LOW"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[#6B7488]">
                          {formatDateTime(chg.updated_at || chg.created_at)}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setUnlinkingChange(chg)}
                            id={`pcm-unlink-change-btn-${chg.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium transition cursor-pointer"
                            title="Unlink Change Request"
                          >
                            <Unlink className="w-3 h-3" />
                            <span>Unlink</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Activity / History Timeline */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-4"
            id="pcm-activities-section"
          >
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#6D28D9]" />
                <h2 className="text-sm font-bold text-[#0E1726]">
                  Activity &amp; Investigation History
                </h2>
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#F1F5F9] text-[#475569] text-xs font-semibold">
                {activities.length} Events
              </span>
            </div>

            {activitiesLoading ? (
              <div className="p-8 text-center text-[#6B7488] space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#6D28D9]" />
                <p className="text-xs">Loading activity history...</p>
              </div>
            ) : activities.length === 0 ? (
              <div className="p-8 text-center text-[#6B7488] space-y-2">
                <MessageSquare className="w-6 h-6 text-[#94A3B8] mx-auto" />
                <p className="text-xs">No investigation notes or activities recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                {activities.map((act) => (
                  <div
                    key={act.id}
                    className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {act.activity_type === "RESOLUTION" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-medium text-[11px]">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Resolution</span>
                          </span>
                        ) : act.activity_type === "INVESTIGATION" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EDE9FE] text-[#6D28D9] font-medium text-[11px]">
                            <MessageSquare className="w-3 h-3" />
                            <span>Investigation</span>
                          </span>
                        ) : act.activity_type === "STATUS_CHANGE" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#EFF6FF] text-[#2563EB] font-medium text-[11px]">
                            <Clock className="w-3 h-3" />
                            <span>Status Change</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#475569] font-medium text-[11px]">
                            <History className="w-3 h-3" />
                            <span>{act.activity_type}</span>
                          </span>
                        )}
                        <span className="font-semibold text-[#0E1726]">
                          {act.actor_email || "System"}
                        </span>
                      </div>
                      <span className="text-[#64748B] text-[11px]">
                        {formatDateTime(act.created_at)}
                      </span>
                    </div>

                    {act.content && (
                      <p className="text-[#334155] leading-relaxed whitespace-pre-wrap pl-1">
                        {act.content}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Metadata Sidebar */}
        <div className="space-y-6">
          <div className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-4">
            <h3 className="text-xs font-bold text-[#6B7488] uppercase tracking-wider border-b border-[#E6E9F0] pb-2">
              Problem Metadata
            </h3>

            <div className="space-y-3.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[#6B7488]">Lifecycle Status</span>
                <IncidentStatusBadge status={problem.status} />
              </div>

              <div className="flex items-start justify-between gap-2">
                <span className="text-[#6B7488]">Priority</span>
                <IncidentPriorityBadge priority={problem.priority} />
              </div>

              <div className="flex items-start justify-between gap-2">
                <span className="text-[#6B7488]">KEDB Status</span>
                {problem.problem_details?.known_error ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] text-[11px] font-semibold border border-[#FDE68A]">
                    Known Error
                  </span>
                ) : (
                  <span className="text-[#64748B] text-[11px]">Under Investigation</span>
                )}
              </div>

              <div className="flex items-start justify-between gap-2">
                <span className="text-[#6B7488]">Service</span>
                <span className="font-medium text-[#0E1726]">
                  {problem.service_name || "—"}
                </span>
              </div>

              {problem.configuration_item_id && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[#6B7488]">Configuration Item</span>
                  <span className="font-medium text-[#0E1726]">
                    {problem.configuration_item_id}
                  </span>
                </div>
              )}

              <div className="flex items-start justify-between gap-2">
                <span className="text-[#6B7488]">Assigned Team</span>
                <span className="font-medium text-[#0E1726]">
                  {problem.assignment_group || "—"}
                </span>
              </div>

              <div className="flex items-start justify-between gap-2">
                <span className="text-[#6B7488]">Assignee</span>
                <span className="font-medium text-[#0E1726] truncate max-w-[160px]">
                  {problem.assignee_email || "Unassigned"}
                </span>
              </div>

              <div className="border-t border-[#E6E9F0] pt-3 flex items-start justify-between gap-2">
                <span className="text-[#6B7488]">Created At</span>
                <span className="text-[#475569]">
                  {formatDateTime(problem.created_at)}
                </span>
              </div>

              <div className="flex items-start justify-between gap-2">
                <span className="text-[#6B7488]">Updated At</span>
                <span className="text-[#475569]">
                  {formatDateTime(problem.updated_at)}
                </span>
              </div>

              {problem.resolved_at && (
                <div className="border-t border-[#E6E9F0] pt-3 flex items-start justify-between gap-2">
                  <span className="text-[#6B7488]">Resolved At</span>
                  <span className="text-emerald-700 font-medium">
                    {formatDateTime(problem.resolved_at)}
                  </span>
                </div>
              )}

              {problem.closed_at && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[#6B7488]">Closed At</span>
                  <span className="text-slate-700 font-medium">
                    {formatDateTime(problem.closed_at)}
                  </span>
                </div>
              )}

              {problem.closed_by_email && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[#6B7488]">Closed By</span>
                  <span className="text-slate-700 font-medium truncate max-w-[160px]">
                    {problem.closed_by_email}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Resolve Problem Modal */}
      {resolveModalOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs"
          id="resolve-problem-modal"
        >
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-xl max-w-xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-[#0E1726]">
                  Resolve Problem {problem.ticket_number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setResolveModalOpen(false)}
                className="text-[#94A3B8] hover:text-[#0E1726] transition p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {resolveError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{resolveError}</span>
              </div>
            )}

            <form onSubmit={handleResolveProblem} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label
                  htmlFor="resolve-summary-input"
                  className="block font-semibold text-[#0E1726]"
                >
                  Resolution Summary <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="resolve-summary-input"
                  rows={2}
                  required
                  value={resolveSummary}
                  onChange={(e) => setResolveSummary(e.target.value)}
                  placeholder="Summarize the final resolution and permanent outcome..."
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition resize-y"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="resolve-permanent-solution-input"
                    className="block font-semibold text-[#0E1726]"
                  >
                    Permanent Fix / Solution
                  </label>
                  <textarea
                    id="resolve-permanent-solution-input"
                    rows={2}
                    value={resolvePermanentSolution}
                    onChange={(e) => setResolvePermanentSolution(e.target.value)}
                    placeholder="Code fix, config change, or patch applied..."
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition resize-y"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="resolve-workaround-input"
                    className="block font-semibold text-[#0E1726]"
                  >
                    Workaround Summary
                  </label>
                  <textarea
                    id="resolve-workaround-input"
                    rows={2}
                    value={resolveWorkaround}
                    onChange={(e) => setResolveWorkaround(e.target.value)}
                    placeholder="Workaround utilized prior to permanent fix..."
                    className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition resize-y"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="resolve-root-cause-input"
                  className="block font-semibold text-[#0E1726]"
                >
                  Confirmed Root Cause
                </label>
                <textarea
                  id="resolve-root-cause-input"
                  rows={2}
                  value={resolveRootCause}
                  onChange={(e) => setResolveRootCause(e.target.value)}
                  placeholder="Confirmed underlying cause of the problem..."
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="resolve-notes-input"
                  className="block font-semibold text-[#0E1726]"
                >
                  Resolution Notes (Optional)
                </label>
                <textarea
                  id="resolve-notes-input"
                  rows={2}
                  value={resolveNotes}
                  onChange={(e) => setResolveNotes(e.target.value)}
                  placeholder="Additional resolution remarks or sign-off notes recorded to timeline..."
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition resize-y"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E6E9F0]">
                <button
                  type="button"
                  onClick={() => setResolveModalOpen(false)}
                  disabled={resolveSubmitting}
                  id="cancel-resolve-button"
                  className="px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-[#475569] hover:bg-[#F8FAFC] text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resolveSubmitting}
                  id="confirm-resolve-button"
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition"
                >
                  {resolveSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Resolving...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Resolve Problem</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close Problem Modal */}
      {closeModalOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs"
          id="close-problem-modal"
        >
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-slate-800" />
                <h3 className="text-base font-bold text-[#0E1726]">
                  Close Problem {problem.ticket_number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCloseModalOpen(false)}
                className="text-[#94A3B8] hover:text-[#0E1726] transition p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#64748B] leading-relaxed">
              Are you sure you want to close this problem ticket? Closing concludes the Problem Management lifecycle for this record.
            </p>

            {closeError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{closeError}</span>
              </div>
            )}

            <form onSubmit={handleCloseProblem} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label
                  htmlFor="close-notes-input"
                  className="block font-semibold text-[#0E1726]"
                >
                  Closure Notes (Optional)
                </label>
                <textarea
                  id="close-notes-input"
                  rows={3}
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Document final closure remarks, lessons learned, or post-incident review status..."
                  className="w-full px-3 py-2 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] text-[#0E1726] text-xs placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 transition resize-y"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E6E9F0]">
                <button
                  type="button"
                  onClick={() => setCloseModalOpen(false)}
                  disabled={closeSubmitting}
                  id="cancel-close-button"
                  className="px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-[#475569] hover:bg-[#F8FAFC] text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={closeSubmitting}
                  id="confirm-close-button"
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition"
                >
                  {closeSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Closing...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Confirm Close</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Link Existing Change Modal */}
      {linkModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          id="pcm-link-change-modal"
        >
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <Link2 className="w-5 h-5 text-[#6D28D9]" />
                <h3 className="text-sm font-bold text-[#0E1726]">Link Existing Change Request</h3>
              </div>
              <button
                type="button"
                onClick={() => setLinkModalOpen(false)}
                className="text-[#64748B] hover:text-[#0E1726]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {linkModalError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{linkModalError}</span>
              </div>
            )}

            <form onSubmit={handleLinkChange} className="space-y-4 text-xs">
              <p className="text-[#64748B] leading-relaxed">
                Select an existing Change Request in this tenant to link as a resolution or permanent fix for Problem{" "}
                <span className="font-semibold text-[#0E1726]">{problem?.ticket_number}</span>.
              </p>

              <div className="space-y-1.5">
                <label htmlFor="pcm-select-change-to-link" className="block font-semibold text-[#0E1726]">
                  Select Change Request <span className="text-red-500">*</span>
                </label>
                {availableLoading ? (
                  <div className="p-3 text-center text-[#6B7488]">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto text-[#6D28D9]" />
                  </div>
                ) : availableChanges.length === 0 ? (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[#64748B] text-center">
                    No available unlinked changes found.
                  </div>
                ) : (
                  <select
                    id="pcm-select-change-to-link"
                    value={selectedChangeIdToLink}
                    onChange={(e) => setSelectedChangeIdToLink(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#0E1726] font-medium focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] text-xs"
                  >
                    <option value="">-- Choose a Change Request --</option>
                    {availableChanges.map((chg) => (
                      <option key={chg.id} value={chg.id}>
                        {chg.change_number} — {chg.title} ({chg.status})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E6E9F0]">
                <button
                  type="button"
                  onClick={() => setLinkModalOpen(false)}
                  disabled={linkingSubmitting}
                  className="px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] font-semibold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={linkingSubmitting || !selectedChangeIdToLink}
                  id="pcm-submit-link-change-btn"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] disabled:opacity-50 text-white font-semibold text-xs shadow-sm transition"
                >
                  {linkingSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Linking...</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="w-3.5 h-3.5" />
                      <span>Link Change</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Change Request Modal */}
      {createModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          id="pcm-create-change-modal"
        >
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <GitPullRequest className="w-5 h-5 text-[#6D28D9]" />
                <h3 className="text-sm font-bold text-[#0E1726]">Create Change Request from Problem</h3>
              </div>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="text-[#64748B] hover:text-[#0E1726]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createModalError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{createModalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateChange} className="space-y-3.5 text-xs">
              <div className="p-3 rounded-xl bg-purple-50/60 border border-purple-100 text-purple-900 text-[11px] leading-relaxed">
                This will create a new Change Request linked to Problem <strong>{problem?.ticket_number}</strong> with pre-populated root cause and solution details.
              </div>

              <div className="space-y-1">
                <label htmlFor="create-change-title-input" className="block font-semibold text-[#0E1726]">
                  Change Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="create-change-title-input"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  required
                  placeholder="e.g. Deploy permanent patch for session memory leak"
                  className="w-full px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#0E1726] text-xs focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label htmlFor="create-change-type-select" className="block font-semibold text-[#0E1726]">
                    Change Type
                  </label>
                  <select
                    id="create-change-type-select"
                    value={createChangeType}
                    onChange={(e) => setCreateChangeType(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#0E1726] text-xs font-medium focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                  >
                    <option value="NORMAL">NORMAL</option>
                    <option value="STANDARD">STANDARD</option>
                    <option value="EMERGENCY">EMERGENCY</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="create-change-risk-select" className="block font-semibold text-[#0E1726]">
                    Risk Level
                  </label>
                  <select
                    id="create-change-risk-select"
                    value={createRiskLevel}
                    onChange={(e) => setCreateRiskLevel(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#0E1726] text-xs font-medium focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="create-change-impact-select" className="block font-semibold text-[#0E1726]">
                    Impact Level
                  </label>
                  <select
                    id="create-change-impact-select"
                    value={createImpactLevel}
                    onChange={(e) => setCreateImpactLevel(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#0E1726] text-xs font-medium focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="create-change-description-input" className="block font-semibold text-[#0E1726]">
                  Description
                </label>
                <textarea
                  id="create-change-description-input"
                  rows={3}
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#0E1726] text-xs resize-y focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="create-change-implementation-input" className="block font-semibold text-[#0E1726]">
                  Implementation Plan
                </label>
                <textarea
                  id="create-change-implementation-input"
                  rows={3}
                  value={createImplPlan}
                  onChange={(e) => setCreateImplPlan(e.target.value)}
                  placeholder="Step-by-step rollout instructions..."
                  className="w-full px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#0E1726] text-xs resize-y focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="create-change-backout-input" className="block font-semibold text-[#0E1726]">
                    Backout Plan (Optional)
                  </label>
                  <textarea
                    id="create-change-backout-input"
                    rows={2}
                    value={createBackoutPlan}
                    onChange={(e) => setCreateBackoutPlan(e.target.value)}
                    placeholder="Steps to revert if implementation fails..."
                    className="w-full px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#0E1726] text-xs resize-y"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="create-change-test-input" className="block font-semibold text-[#0E1726]">
                    Test / Verification Plan (Optional)
                  </label>
                  <textarea
                    id="create-change-test-input"
                    rows={2}
                    value={createTestPlan}
                    onChange={(e) => setCreateTestPlan(e.target.value)}
                    placeholder="Verification steps to validate the fix..."
                    className="w-full px-3 py-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-[#0E1726] text-xs resize-y"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E6E9F0]">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  disabled={createSubmitting}
                  className="px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] font-semibold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting || !createTitle.trim()}
                  id="pcm-submit-create-change-btn"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] disabled:opacity-50 text-white font-semibold text-xs shadow-sm transition"
                >
                  {createSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create Change Request</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unlink Change Confirmation Modal */}
      {unlinkingChange && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          id="pcm-unlink-change-modal"
        >
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200">
                <Unlink className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#0E1726]">Unlink Change Request</h3>
                <p className="text-xs text-[#64748B]">Confirm decoupling from Problem</p>
              </div>
            </div>

            <p className="text-xs text-[#475569] leading-relaxed">
              Are you sure you want to unlink Change Request{" "}
              <strong className="text-[#0E1726]">{unlinkingChange.change_number}</strong> from Problem{" "}
              <strong className="text-[#0E1726]">{problem?.ticket_number}</strong>?
              <br />
              <span className="text-[11px] text-[#64748B] block mt-1">
                The Change Request will remain in the system and will not be deleted.
              </span>
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E6E9F0]">
              <button
                type="button"
                onClick={() => setUnlinkingChange(null)}
                disabled={unlinkingSubmitting}
                className="px-4 py-2 rounded-xl border border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC] font-semibold text-xs transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUnlinkChange}
                disabled={unlinkingSubmitting}
                id="pcm-confirm-unlink-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold text-xs shadow-sm transition"
              >
                {unlinkingSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Unlinking...</span>
                  </>
                ) : (
                  <>
                    <Unlink className="w-3.5 h-3.5" />
                    <span>Confirm Unlink</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
