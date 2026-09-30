"use client";

import React, { useState } from "react";
import ModalShell from "@/components/modal-shell";
import { itsmAllowedTransitions } from "@/lib/itsm-format";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { Incident, ServiceRequest } from "@/lib/itsm-types";

interface StatusModalProps {
  incident: Incident | ServiceRequest;
  onClose: () => void;
  onSuccess: (updated: any) => void;
  initialStatus?: string;
  statusEndpoint?: string;
}

const RESOLUTION_CODES = [
  "PERMANENT_FIX",
  "WORKAROUND_APPLIED",
  "VENDOR_RESOLVED",
  "NOT_REPRODUCIBLE",
  "DUPLICATE",
  "USER_ERROR",
];

export default function StatusModal({ incident, onClose, onSuccess, initialStatus, statusEndpoint }: StatusModalProps) {
  const allowedTransitions = itsmAllowedTransitions(incident.status);
  const defaultTarget = (initialStatus && allowedTransitions.includes(initialStatus as Incident["status"]))
    ? initialStatus
    : (allowedTransitions[0] || "");
  const [targetStatus, setTargetStatus] = useState<string>(defaultTarget);
  const [statusReason, setStatusReason] = useState<string>("");
  const [resolutionCode, setResolutionCode] = useState<string>("PERMANENT_FIX");
  const [resolutionSummary, setResolutionSummary] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isTerminal = allowedTransitions.length === 0;
  const isResolving = targetStatus === "RESOLVED";
  const isReopening = targetStatus === "IN_PROGRESS" && incident.status === "RESOLVED";
  const isClosing = targetStatus === "CLOSED";
  const isPendingOrCancelled = targetStatus === "PENDING" || targetStatus === "CANCELLED";

  let modalTitle = `Change Status · ${incident.ticket_number}`;
  if (isResolving) {
    modalTitle = `Resolve Incident · ${incident.ticket_number}`;
  } else if (isReopening) {
    modalTitle = `Reopen Incident · ${incident.ticket_number}`;
  } else if (isClosing) {
    modalTitle = `Close Incident · ${incident.ticket_number}`;
  }

  let submitLabel = "Update Status";
  let submitBg = "bg-[#6D28D9] hover:bg-[#5B21B6]";
  if (isResolving) {
    submitLabel = loading ? "Resolving..." : "Resolve Incident";
    submitBg = "bg-emerald-600 hover:bg-emerald-700";
  } else if (isReopening) {
    submitLabel = loading ? "Reopening..." : "Reopen Incident";
    submitBg = "bg-amber-600 hover:bg-amber-700";
  } else if (isClosing) {
    submitLabel = loading ? "Closing..." : "Close Incident";
    submitBg = "bg-slate-700 hover:bg-slate-800";
  } else {
    submitLabel = loading ? "Updating..." : "Update Status";
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetStatus) return;

    if (isResolving) {
      if (!resolutionCode.trim()) {
        setError("Resolution code is required to resolve this incident.");
        return;
      }
      if (!resolutionSummary.trim()) {
        setError("Resolution summary is required to resolve this incident.");
        return;
      }
    }

    if (isPendingOrCancelled && !statusReason.trim()) {
      setError(`Status reason is required when transitioning to ${targetStatus}.`);
      return;
    }

    if (isReopening && !statusReason.trim()) {
      setError("Please explain why this issue is still not fixed.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const payload: Record<string, unknown> = {
        status: targetStatus,
      };

      if (statusReason.trim()) {
        payload.status_reason = statusReason.trim();
      }

      if (isResolving) {
        payload.resolution_code = resolutionCode.trim();
        payload.resolution_summary = resolutionSummary.trim();
      }

      const endpoint = statusEndpoint || `/api/itsm/incidents/${incident.id}/status`;
      const res = await fetch(endpoint, jsonRequest("POST", payload));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to update incident status"));
      }

      const updated = await res.json();
      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to change incident status");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={modalTitle}
      onClose={onClose}
      error={error}
      maxWidthClass="max-w-[480px]"
    >
      {isTerminal ? (
        <div className="py-4 text-center">
          <p className="text-sm text-[#475069]">
            This incident is currently <strong className="text-[#0E1726]">{incident.status}</strong>.
          </p>
          <p className="text-xs text-[#6B7488] mt-2">
            Terminal states cannot be transitioned to any other state.
          </p>
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA]"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#0E1726] mb-1.5">
              Current Status
            </label>
            <div className="text-xs font-mono bg-[#F5F7FA] px-3 py-2 rounded-lg border border-[#E6E9F0] text-[#475069]">
              {incident.status}
            </div>
          </div>

          <div>
            <label htmlFor="target-status" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
              New Status *
            </label>
            <select
              id="target-status"
              value={targetStatus}
              onChange={(e) => {
                setTargetStatus(e.target.value);
                setError(null);
              }}
              className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
              required
            >
              {allowedTransitions.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {isPendingOrCancelled && (
            <div>
              <label htmlFor="status-reason" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                Status Reason *
              </label>
              <textarea
                id="status-reason"
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder={
                  targetStatus === "PENDING"
                    ? "e.g. Awaiting customer verification, vendor diagnostic..."
                    : "e.g. Duplicate report, false alarm, requester cancelled..."
                }
                rows={3}
                className="w-full bg-white border border-[#E6E9F0] rounded-lg p-2.5 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                required
              />
            </div>
          )}

          {isReopening && (
            <div>
              <label htmlFor="status-reason" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                Why is the issue still not fixed? <span className="text-red-500">*</span>
              </label>
              <textarea
                id="status-reason"
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="Reason for reopening incident (e.g. issue recurred, customer verified problem persists)..."
                rows={3}
                className="w-full bg-white border border-[#E6E9F0] rounded-lg p-2.5 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                required
              />
            </div>
          )}

          {isResolving && (
            <>
              <div>
                <label htmlFor="resolution-code" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                  Resolution Code *
                </label>
                <select
                  id="resolution-code"
                  value={resolutionCode}
                  onChange={(e) => setResolutionCode(e.target.value)}
                  className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  required
                >
                  {RESOLUTION_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="resolution-summary" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                  Resolution Summary *
                </label>
                <textarea
                  id="resolution-summary"
                  value={resolutionSummary}
                  onChange={(e) => setResolutionSummary(e.target.value)}
                  placeholder="Describe the root cause fix, workaround, or corrective action applied..."
                  rows={3}
                  className="w-full bg-white border border-[#E6E9F0] rounded-lg p-2.5 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  required
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E9F0]">
            <button
              type="button"
              id="status-modal-cancel"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="status-modal-submit"
              disabled={loading}
              className={`px-4 py-2 text-white rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50 ${submitBg}`}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}
