"use client";

import React, { useState } from "react";
import ModalShell from "@/components/modal-shell";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { AlertCircle, RefreshCw } from "lucide-react";

interface ReopenTicketModalProps {
  ticketNumber: string;
  ticketId: string;
  version?: number;
  onClose: () => void;
  onSuccess: (updated: any) => void;
  statusEndpoint?: string;
}

export default function ReopenTicketModal({
  ticketNumber,
  ticketId,
  version,
  onClose,
  onSuccess,
  statusEndpoint,
}: ReopenTicketModalProps) {
  const [reason, setReason] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Please explain why the issue is still not fixed.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const endpoint = statusEndpoint || `/api/itsm/incidents/${ticketId}/status`;
      const payload = {
        status: "IN_PROGRESS",
        status_reason: reason.trim(),
      };

      const res = await fetch(
        endpoint,
        jsonRequest("POST", payload, version ? { "If-Match": String(version) } : {}),
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to reopen ticket"));
      }

      const updated = await res.json();
      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reopen ticket");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={`Reopen Ticket · ${ticketNumber}`}
      onClose={onClose}
      error={error}
      maxWidthClass="max-w-[460px]"
    >
      <form onSubmit={handleSubmit} className="space-y-4" id="reopen-ticket-form">
        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 leading-relaxed">
            This ticket was marked as resolved. If the issue is not fixed or has recurred, please explain why below to reopen the ticket.
          </p>
        </div>

        <div>
          <label htmlFor="reopen-reason-textarea" className="block text-xs font-bold text-[#0E1726] mb-1.5">
            Why is the issue still not fixed? <span className="text-red-500">*</span>
          </label>
          <textarea
            id="reopen-reason-textarea"
            rows={4}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Please provide details explaining why the solution did not work or what remains broken..."
            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl p-3 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none transition leading-relaxed placeholder:text-[#8C95A8]"
            required
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#F0F2F6]">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-xl text-xs font-semibold hover:bg-[#F5F7FA] transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            id="submit-reopen-ticket-button"
            disabled={loading || !reason.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{loading ? "Reopening..." : "Reopen Ticket"}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
