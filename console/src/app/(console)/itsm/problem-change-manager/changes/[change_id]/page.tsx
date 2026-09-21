"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  GitPullRequest,
  History,
  Layers,
  RefreshCw,
  Save,
  Server,
  Shield,
  ShieldAlert,
  User,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { ChangeDetail } from "@/lib/itsm-types";

function getRiskBadge(risk?: string | null) {
  const norm = (risk || "LOW").toUpperCase();
  switch (norm) {
    case "CRITICAL":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "HIGH":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "MEDIUM":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "LOW":
    default:
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
}

function getImpactBadge(impact?: string | null) {
  const norm = (impact || "LOW").toUpperCase();
  switch (norm) {
    case "CRITICAL":
      return "bg-red-50 text-red-700 border-red-200";
    case "HIGH":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "MEDIUM":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "LOW":
    default:
      return "bg-blue-50 text-blue-700 border-blue-200";
  }
}

function getStatusBadge(status: string) {
  const norm = (status || "DRAFT").toUpperCase();
  switch (norm) {
    case "SCHEDULED":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "IN_PROGRESS":
    case "IMPLEMENTING":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "COMPLETED":
    case "CLOSED":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "APPROVED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    default:
      return "bg-purple-50 text-purple-700 border-purple-200";
  }
}

export default function ChangeDetailPage() {
  const params = useParams();
  const changeId = params?.change_id as string;

  const [change, setChange] = useState<ChangeDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Assessment form state
  const [reason, setReason] = useState<string>("");
  const [changeType, setChangeType] = useState<string>("STANDARD");
  const [riskLevel, setRiskLevel] = useState<string>("LOW");
  const [impactLevel, setImpactLevel] = useState<string>("LOW");
  const [implNotes, setImplNotes] = useState<string>("");
  const [valNotes, setValNotes] = useState<string>("");
  const [backoutNotes, setBackoutNotes] = useState<string>("");

  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchChange = useCallback(async () => {
    if (!changeId) return;

    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/itsm/changes/${changeId}`);
      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (res.status === 404) {
        throw new Error("Change request not found");
      }
      if (!res.ok) {
        throw new Error(`Failed to load change details (${res.status})`);
      }

      const data: ChangeDetail = await res.json();
      setChange(data);

      // Populate assessment state
      setReason(data.description || "");
      setChangeType(data.change_type || "STANDARD");
      setRiskLevel(data.risk_level || "LOW");
      setImpactLevel(data.impact_level || "LOW");
      setImplNotes(data.implementation_plan || "");
      setValNotes(data.test_plan || "");
      setBackoutNotes(data.backout_plan || "");
    } catch (err: any) {
      setError(err?.message || "Failed to load change details");
    } finally {
      setLoading(false);
    }
  }, [changeId]);

  useEffect(() => {
    fetchChange();
  }, [fetchChange]);

  const handleSaveAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeId) return;

    try {
      setSaving(true);
      setSaveSuccess(null);
      setSaveError(null);

      const payload = {
        description: reason,
        change_type: changeType,
        risk_level: riskLevel,
        impact_level: impactLevel,
        implementation_plan: implNotes,
        test_plan: valNotes,
        backout_plan: backoutNotes,
      };

      const res = await fetch(`/api/itsm/changes/${changeId}/assessment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.detail || `Failed to save assessment (${res.status})`);
      }

      const updated: ChangeDetail = await res.json();
      setChange(updated);
      setSaveSuccess("Assessment details recorded successfully.");

      setTimeout(() => {
        setSaveSuccess(null);
      }, 5000);
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save assessment");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-[#6B7488] space-y-3 max-w-6xl mx-auto">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-[#6D28D9]" />
        <p className="text-xs font-medium">Loading change record...</p>
      </div>
    );
  }

  if (error || !change) {
    return (
      <div className="max-w-4xl mx-auto p-8 space-y-6">
        <Link
          href="/itsm/problem-change-manager/changes"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Changes Queue</span>
        </Link>
        <div className="p-8 rounded-[20px] border border-red-200 bg-red-50 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-red-900">
              {error || "Change Request Not Found"}
            </h2>
            <p className="text-xs text-red-700">
              The requested change record does not exist or belongs to another tenant.
            </p>
          </div>
          <Link
            href="/itsm/problem-change-manager/changes"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
          >
            Return to Changes Queue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto" id="pcm-change-detail-page">
      {/* Top Breadcrumb & Header Banner */}
      <div
        className="bg-white rounded-2xl p-6 sm:p-8 border border-[#E6E9F0] shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col md:flex-row md:items-center justify-between gap-6"
        id="pcm-change-detail-header"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/itsm/problem-change-manager/changes"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F1F5F9] text-[#475569] text-xs font-semibold hover:bg-[#E2E8F0] transition"
              id="back-to-changes-link"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Changes Queue</span>
            </Link>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 text-[#6D28D9] border border-purple-200 text-xs font-mono font-semibold">
              <GitPullRequest className="w-3.5 h-3.5 text-[#6D28D9]" />
              <span id="detail-change-number">{change.change_number}</span>
            </span>
          </div>

          <h1
            className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0E1726]"
            id="detail-change-title"
          >
            {change.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusBadge(change.status)}`}
              id="detail-status-badge"
            >
              Status: {change.status}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${getRiskBadge(change.risk_level)}`}
              id="detail-risk-badge"
            >
              Risk: {change.risk_level || "LOW"}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${getImpactBadge(change.impact_level)}`}
              id="detail-impact-badge"
            >
              Impact: {change.impact_level || "LOW"}
            </span>
            {change.service_name && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 text-slate-700 border border-slate-200 text-xs font-medium"
                id="detail-service-badge"
              >
                <Layers className="w-3 h-3 text-slate-500" />
                <span>{change.service_name}</span>
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-3">
          <button
            onClick={() => fetchChange()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-[#475569] text-xs font-semibold border border-[#E6E9F0] shadow-sm transition"
            title="Refresh detail"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Info, CIs, Assessment, Activity */}
        <div className="lg:col-span-2 space-y-6">
          {/* Change Information Card */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-4"
            id="pcm-change-info-section"
          >
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#6D28D9]" />
                <span>Change Information</span>
              </h2>
              <span className="text-xs font-medium text-[#6B7488]">
                Type: {change.change_type || "STANDARD"}
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#6B7488] uppercase tracking-wider block mb-1">
                  Description
                </label>
                <p
                  className="text-xs leading-relaxed text-[#334155] whitespace-pre-wrap bg-slate-50 p-3.5 rounded-xl border border-slate-200/80"
                  id="detail-change-description"
                >
                  {change.description || "No detailed description provided."}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 space-y-1">
                  <span className="text-[11px] font-medium text-[#6B7488] block">Service</span>
                  <span className="text-xs font-semibold text-[#0E1726]">
                    {change.service_name || "—"}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 space-y-1">
                  <span className="text-[11px] font-medium text-[#6B7488] block">Assigned Team</span>
                  <span className="text-xs font-semibold text-[#0E1726]">
                    {change.assigned_team || "—"}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 space-y-1">
                  <span className="text-[11px] font-medium text-[#6B7488] block">Assignee</span>
                  <span className="text-xs font-semibold text-[#0E1726]">
                    {change.assignee_email || "Unassigned"}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 space-y-1">
                  <span className="text-[11px] font-medium text-[#6B7488] block">Planned Window</span>
                  <span className="text-xs font-semibold text-[#0E1726]">
                    {change.earliest_start_at
                      ? `${formatDateTime(change.earliest_start_at)} — ${change.latest_finish_at ? formatDateTime(change.latest_finish_at) : "Open"}`
                      : "Not scheduled yet"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Affected Configuration Items Section */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-4"
            id="pcm-affected-cis-section"
          >
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
                  <Server className="w-4 h-4 text-[#6D28D9]" />
                  <span>Affected Configuration Items</span>
                </h2>
                <p className="text-xs text-[#6B7488] mt-0.5">
                  CMDB infrastructure assets associated with this change.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {change.affected_cis?.length || 0} CIs
              </span>
            </div>

            {change.affected_cis && change.affected_cis.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#E6E9F0] text-[#6B7488] font-semibold">
                      <th className="pb-2.5">CI Name</th>
                      <th className="pb-2.5">Type</th>
                      <th className="pb-2.5">Environment</th>
                      <th className="pb-2.5">Status</th>
                      <th className="pb-2.5">Impact Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E9F0]/60">
                    {change.affected_cis.map((ci) => (
                      <tr key={ci.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 font-semibold text-[#0E1726] flex items-center gap-2">
                          <Database className="w-3.5 h-3.5 text-[#6D28D9]" />
                          <span>{ci.name}</span>
                        </td>
                        <td className="py-2.5 text-[#475569]">{ci.ci_type}</td>
                        <td className="py-2.5 text-[#475569]">{ci.environment}</td>
                        <td className="py-2.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {ci.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-[#475569] font-medium">
                          {ci.impact_type}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div
                className="p-6 rounded-xl border border-dashed border-[#E6E9F0] bg-slate-50/50 text-center space-y-1.5"
                id="no-cis-message"
              >
                <Server className="w-6 h-6 text-[#94A3B8] mx-auto" />
                <p className="text-xs font-semibold text-[#475569]">
                  No configuration items linked.
                </p>
                <p className="text-[11px] text-[#94A3B8]">
                  Planned changes without linked CIs operate at service-level scope.
                </p>
              </div>
            )}
          </div>

          {/* Assessment Section */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-5"
            id="pcm-assessment-section"
          >
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#6D28D9]" />
                  <span>Assessment</span>
                </h2>
                <p className="text-xs text-[#6B7488] mt-0.5">
                  What is changing, why is it changing, and what could be affected?
                </p>
              </div>
            </div>

            {saveSuccess && (
              <div
                className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-medium flex items-center gap-2"
                id="save-assessment-success"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{saveSuccess}</span>
              </div>
            )}

            {saveError && (
              <div
                className="p-3.5 rounded-xl border border-red-200 bg-red-50 text-red-800 text-xs font-medium flex items-center gap-2"
                id="save-assessment-error"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            <form onSubmit={handleSaveAssessment} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="assessment-type-select"
                    className="block text-xs font-semibold text-[#475569] mb-1"
                  >
                    Change Type
                  </label>
                  <select
                    id="assessment-type-select"
                    value={changeType}
                    onChange={(e) => setChangeType(e.target.value)}
                    className="w-full text-xs rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-[#0E1726] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                  >
                    <option value="STANDARD">STANDARD</option>
                    <option value="NORMAL">NORMAL</option>
                    <option value="EMERGENCY">EMERGENCY</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="assessment-risk-select"
                    className="block text-xs font-semibold text-[#475569] mb-1"
                  >
                    Risk Level
                  </label>
                  <select
                    id="assessment-risk-select"
                    value={riskLevel}
                    onChange={(e) => setRiskLevel(e.target.value)}
                    className="w-full text-xs rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-[#0E1726] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="assessment-impact-select"
                    className="block text-xs font-semibold text-[#475569] mb-1"
                  >
                    Impact Level
                  </label>
                  <select
                    id="assessment-impact-select"
                    value={impactLevel}
                    onChange={(e) => setImpactLevel(e.target.value)}
                    className="w-full text-xs rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-[#0E1726] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="assessment-reason-input"
                  className="block text-xs font-semibold text-[#475569] mb-1"
                >
                  Reason for Change
                </label>
                <textarea
                  id="assessment-reason-input"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain the business or technical justification for this change..."
                  className="w-full text-xs rounded-xl border border-[#CBD5E1] bg-white p-3 text-[#0E1726] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                />
              </div>

              <div>
                <label
                  htmlFor="assessment-impl-notes-input"
                  className="block text-xs font-semibold text-[#475569] mb-1"
                >
                  Implementation Notes
                </label>
                <textarea
                  id="assessment-impl-notes-input"
                  rows={3}
                  value={implNotes}
                  onChange={(e) => setImplNotes(e.target.value)}
                  placeholder="Detail step-by-step rollout actions, dependencies, and execution order..."
                  className="w-full text-xs rounded-xl border border-[#CBD5E1] bg-white p-3 text-[#0E1726] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="assessment-val-notes-input"
                    className="block text-xs font-semibold text-[#475569] mb-1"
                  >
                    Validation Notes
                  </label>
                  <textarea
                    id="assessment-val-notes-input"
                    rows={2}
                    value={valNotes}
                    onChange={(e) => setValNotes(e.target.value)}
                    placeholder="Verification steps to confirm normal service operation..."
                    className="w-full text-xs rounded-xl border border-[#CBD5E1] bg-white p-3 text-[#0E1726] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="assessment-backout-notes-input"
                    className="block text-xs font-semibold text-[#475569] mb-1"
                  >
                    Backout Plan
                  </label>
                  <textarea
                    id="assessment-backout-notes-input"
                    rows={2}
                    value={backoutNotes}
                    onChange={(e) => setBackoutNotes(e.target.value)}
                    placeholder="Steps to roll back if unexpected issues or errors arise..."
                    className="w-full text-xs rounded-xl border border-[#CBD5E1] bg-white p-3 text-[#0E1726] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9]"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
                  id="save-assessment-button"
                >
                  {saving ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>{saving ? "Saving..." : "Save Assessment"}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Activity & History Section */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-4"
            id="pcm-activity-history-section"
          >
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div>
                <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
                  <History className="w-4 h-4 text-[#6D28D9]" />
                  <span>Activity &amp; History</span>
                </h2>
                <p className="text-xs text-[#6B7488] mt-0.5">
                  Audit trail and change assessment history.
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-800">
                      Assessment Record
                    </span>
                    <span className="font-semibold text-[#0E1726]">
                      Change Assessment Recorded / Synchronized
                    </span>
                  </div>
                  <p className="text-[#475569] text-[11px]">
                    Current parameters: Risk={change.risk_level || "LOW"}, Impact={change.impact_level || "LOW"}, Type={change.change_type || "STANDARD"}.
                  </p>
                </div>
                <span className="text-[11px] text-[#6B7488] shrink-0 font-medium">
                  {formatDateTime(change.updated_at)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200/60 flex items-start gap-2.5 text-[11px] text-blue-900">
                <ShieldAlert className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>Compliance Audit Chain:</strong> All Change Request modifications and assessment updates emit tamper-evident audit events with actor attribution to AuthClaw&apos;s compliance audit store.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (1 Col): Metadata Sidebar & Related Problem Context */}
        <div className="space-y-6">
          {/* Metadata Card */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-3.5 text-xs"
            id="pcm-metadata-sidebar"
          >
            <h3 className="text-xs font-bold text-[#6B7488] uppercase tracking-wider border-b border-[#E6E9F0] pb-2">
              Change Metadata
            </h3>
            <div className="flex justify-between">
              <span className="text-[#6B7488]">Change Number</span>
              <span className="font-semibold text-[#0E1726]">{change.change_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7488]">Status</span>
              <span className="font-semibold text-[#0E1726]">{change.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7488]">Type</span>
              <span className="font-medium text-[#0E1726]">{change.change_type || "STANDARD"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7488]">Risk Level</span>
              <span className="font-medium text-[#0E1726]">{change.risk_level || "LOW"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7488]">Impact Level</span>
              <span className="font-medium text-[#0E1726]">{change.impact_level || "LOW"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7488]">Service</span>
              <span className="font-medium text-[#0E1726]">{change.service_name || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7488]">Assigned Team</span>
              <span className="font-medium text-[#0E1726]">{change.assigned_team || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7488]">Assignee</span>
              <span className="font-medium text-[#0E1726]">{change.assignee_email || "Unassigned"}</span>
            </div>
            <div className="border-t border-[#E6E9F0] pt-2 flex justify-between">
              <span className="text-[#6B7488]">Created At</span>
              <span className="text-[#475569]">{formatDateTime(change.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7488]">Updated At</span>
              <span className="text-[#475569]">{formatDateTime(change.updated_at)}</span>
            </div>
          </div>

          {/* Related Problem Context (Read-Only) */}
          <div
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-3"
            id="pcm-related-problem-card"
          >
            <h3 className="text-xs font-bold text-[#6B7488] uppercase tracking-wider border-b border-[#E6E9F0] pb-2">
              Related Problem
            </h3>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 text-center space-y-1">
              <p className="text-xs text-[#475569] font-medium">
                No linked Problem
              </p>
              <p className="text-[11px] text-[#94A3B8]">
                Problem-to-Change linking will be introduced in Step 8.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
