"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Ticket, Info } from "lucide-react";
import ModalShell from "@/components/modal-shell";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { Incident, ReportRecurringProblemResponse } from "@/lib/itsm-types";

interface ReportRecurringProblemModalProps {
  incident: Incident;
  onClose: () => void;
  onSuccess: (updatedIncident: Incident, response: ReportRecurringProblemResponse) => void;
}

const inputClass =
  "w-full rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-xs text-[#0E1726] outline-none transition focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10 placeholder:text-[#94A3B8]";

export default function ReportRecurringProblemModal({
  incident,
  onClose,
  onSuccess,
}: ReportRecurringProblemModalProps) {
  const [problemShortDescription, setProblemShortDescription] = useState<string>(
    incident.title ? `Recurring: ${incident.title}` : ""
  );
  const [recurringReason, setRecurringReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportRecurringProblemResponse | null>(null);

  // If problem is already linked to this incident from the start
  const isAlreadyLinked = Boolean(incident.linked_problem_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!problemShortDescription.trim()) {
      setError("Problem Short Description is required.");
      return;
    }
    if (!recurringReason.trim()) {
      setError("Reason / Recurring Issue explanation is required.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const res = await fetch(
        `/api/itsm/incidents/${incident.id}/report-recurring-problem`,
        jsonRequest("POST", {
          problem_short_description: problemShortDescription.trim(),
          recurring_reason: recurringReason.trim(),
          notes: notes.trim() ? notes.trim() : null,
        })
      );

      const data: ReportRecurringProblemResponse = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Failed to report recurring problem."));
      }

      setResult(data);

      const updatedIncident: Incident = {
        ...incident,
        linked_problem_id: data.problem_id,
        linked_problem_ticket_number: data.problem_ticket_number,
      };

      onSuccess(updatedIncident, data);
    } catch (err: any) {
      setError(err?.message || "Failed to report recurring problem.");
    } finally {
      setSubmitting(false);
    }
  };

  // 1. Case A: Incident was already linked prior to opening the modal
  if (isAlreadyLinked && !result) {
    return (
      <ModalShell
        title={
          <span className="flex items-center gap-2" id="report-recurring-problem-modal-title">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>Report Recurring Problem</span>
          </span>
        }
        onClose={onClose}
        maxWidthClass="max-w-[560px]"
      >
        <div className="space-y-4" id="duplicate-problem-notice">
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600 shrink-0" />
              <h4 className="text-xs font-bold" id="duplicate-problem-title">
                Recurring problem already reported.
              </h4>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed">
              This incident is already associated with Problem{" "}
              <span className="font-mono font-bold font-semibold text-purple-700">
                {incident.linked_problem_ticket_number || "record"}
              </span>
              . Additional problem tickets cannot be created for this same incident.
            </p>
          </div>

          <div className="bg-[#FBFAF9] rounded-xl border border-[#E6E9F0] p-4 space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-[#6B7488]">Originating Incident:</span>
              <span className="font-mono font-semibold text-[#0E1726]">
                {incident.ticket_number}
              </span>
            </div>
            {incident.linked_problem_ticket_number && (
              <div className="flex justify-between items-center">
                <span className="text-[#6B7488]">Linked Problem Number:</span>
                <span className="font-mono font-bold text-[#6D28D9]">
                  {incident.linked_problem_ticket_number}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6E9F0]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-[#DDE1E8] text-[#475069] rounded-lg text-xs font-semibold hover:bg-[#F5F7FA] transition"
            >
              Close
            </button>
            {incident.linked_problem_id && (
              <Link
                href={`/itsm/problem-change-manager/problems/${incident.linked_problem_id}`}
                id="open-linked-problem-link"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs"
              >
                <span>Open Problem</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      </ModalShell>
    );
  }

  // 2. Case B: Submission returned result (success or duplicate detected by backend)
  if (result) {
    const isDuplicate = result.already_reported;
    return (
      <ModalShell
        title={
          <span className="flex items-center gap-2" id="report-recurring-problem-modal-title">
            {isDuplicate ? (
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
            <span>Report Recurring Problem</span>
          </span>
        }
        onClose={onClose}
        maxWidthClass="max-w-[560px]"
      >
        <div className="space-y-4" id="report-problem-result">
          <div
            className={`p-4 rounded-xl border space-y-2 ${
              isDuplicate
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : "bg-emerald-50 border-emerald-200 text-emerald-900"
            }`}
          >
            <div className="flex items-center gap-2">
              {isDuplicate ? (
                <Info className="w-4 h-4 text-amber-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              )}
              <h4 className="text-xs font-bold" id="report-problem-status-message">
                {isDuplicate
                  ? "Recurring problem already reported."
                  : "Recurring problem reported successfully."}
              </h4>
            </div>
            <p className="text-xs leading-relaxed opacity-90">
              {isDuplicate
                ? "An existing Problem ticket is already linked to this incident."
                : "The problem has been recorded in the Problem & Change Manager queue for root-cause investigation."}
            </p>
          </div>

          <div className="bg-[#FBFAF9] rounded-xl border border-[#E6E9F0] p-4 space-y-2.5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-[#6B7488]">Originating Incident:</span>
              <span className="font-mono font-semibold text-[#0E1726]">
                {incident.ticket_number}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#6B7488]">Problem Number:</span>
              <span className="font-mono font-bold text-[#6D28D9] text-sm" id="result-problem-number">
                {result.problem_ticket_number}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6E9F0]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-[#DDE1E8] text-[#475069] rounded-lg text-xs font-semibold hover:bg-[#F5F7FA] transition"
            >
              Close
            </button>
            <Link
              href={`/itsm/problem-change-manager/problems/${result.problem_id}`}
              id="open-problem-action"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs"
            >
              <span>Open Problem</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </ModalShell>
    );
  }

  // 3. Case C: Initial Report Form
  return (
    <ModalShell
      title={
        <span className="flex items-center gap-2" id="report-recurring-problem-modal-title">
          <Ticket className="w-4 h-4 text-[#6D28D9]" />
          <span>Report Recurring Problem</span>
        </span>
      }
      onClose={onClose}
      error={error}
      maxWidthClass="max-w-[620px]"
    >
      <form onSubmit={handleSubmit} className="space-y-4" id="report-recurring-problem-form">
        {/* Brief explanation */}
        <p className="text-xs text-[#6B7488] leading-relaxed" id="report-recurring-problem-explanation">
          Use this when the same issue has occurred repeatedly and may require Problem Management investigation.
        </p>

        {/* Pre-filled / Read-only Context Card */}
        <div
          className="rounded-xl bg-[#FBFAF9] border border-[#E6E9F0] p-3.5 space-y-2 text-xs"
          id="incident-readonly-context"
        >
          <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">
              Incident Context (Read-only)
            </span>
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-purple-50 text-[#6D28D9] border border-purple-200">
              {incident.ticket_number}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="block text-[10px] text-[#6B7488]">Short Description:</span>
              <span className="font-medium text-[#0E1726] truncate block" title={incident.title}>
                {incident.title}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-[#6B7488]">Service:</span>
              <span className="font-medium text-[#0E1726] block">
                {incident.service_name || "None specified"}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-[#6B7488]">Priority:</span>
              <span className="font-medium text-[#0E1726] block">
                {incident.priority || "P3"}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-[#6B7488]">Requester:</span>
              <span className="font-mono text-[11px] text-[#0E1726] truncate block" title={incident.requester_id}>
                {incident.requester_id}
              </span>
            </div>
          </div>

          {incident.description && (
            <div>
              <span className="block text-[10px] text-[#6B7488] mb-0.5">Description:</span>
              <div className="max-h-20 overflow-y-auto rounded bg-white p-2 border border-[#E6E9F0] text-[11px] text-[#475069] leading-relaxed whitespace-pre-wrap">
                {incident.description}
              </div>
            </div>
          )}
        </div>

        {/* Editable Form Fields */}
        <div className="space-y-3">
          <div>
            <label
              htmlFor="problem-short-description"
              className="block text-xs font-semibold text-[#0E1726] mb-1"
            >
              Problem Short Description <span className="text-rose-500">*</span>
            </label>
            <input
              id="problem-short-description"
              type="text"
              required
              maxLength={512}
              value={problemShortDescription}
              onChange={(e) => setProblemShortDescription(e.target.value)}
              className={inputClass}
              placeholder="Brief summary of the recurring problem"
            />
          </div>

          <div>
            <label
              htmlFor="recurring-reason"
              className="block text-xs font-semibold text-[#0E1726] mb-1"
            >
              Reason / Recurring Issue <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="recurring-reason"
              required
              rows={3}
              value={recurringReason}
              onChange={(e) => setRecurringReason(e.target.value)}
              className={inputClass}
              placeholder="Describe the recurrence pattern, frequency, or underlying failure symptoms..."
            />
          </div>

          <div>
            <label htmlFor="problem-notes" className="block text-xs font-semibold text-[#0E1726] mb-1">
              Notes <span className="text-[#6B7488] font-normal">(Optional)</span>
            </label>
            <textarea
              id="problem-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
              placeholder="Additional operational observations or notes for the Problem Manager..."
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E6E9F0] sticky bottom-0 bg-white py-2 mt-3 z-10">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg border border-[#DDE1E8] bg-white text-[#475069] text-xs font-semibold hover:bg-[#F5F7FA] transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            id="report-problem-submit-button"
            disabled={submitting || !problemShortDescription.trim() || !recurringReason.trim()}
            className="px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition disabled:opacity-50 shadow-xs"
          >
            {submitting ? "Reporting..." : "Report Problem"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
