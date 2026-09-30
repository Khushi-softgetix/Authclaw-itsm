"use client";

import React, { useState } from "react";
import ModalShell from "@/components/modal-shell";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { AlertTriangle, Ban } from "lucide-react";

interface CancelTicketModalProps {
  ticketNumber: string;
  ticketId: string;
  onClose: () => void;
  onSuccess: (updated: any) => void;
  statusEndpoint?: string;
}

export default function CancelTicketModal({
  ticketNumber,
  ticketId,
  onClose,
  onSuccess,
  statusEndpoint,
}: CancelTicketModalProps) {
  const [reason, setReason] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Please provide a reason for cancelling this ticket.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const endpoint = statusEndpoint || `/api/itsm/incidents/${ticketId}/status`;
      const payload = {
        status: "CANCELLED",
        status_reason: reason.trim(),
      };

      const res = await fetch(endpoint, jsonRequest("POST", payload));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to cancel ticket"));
      }

      const updated = await res.json();
      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel ticket");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={`Cancel Ticket · ${ticketNumber}`}
      onClose={onClose}
      error={error}
      maxWidthClass="max-w-[460px]"
    >
      <form onSubmit={handleSubmit} className="space-y-4" id="cancel-ticket-form">
        <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3.5 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-900 leading-relaxed">
            Are you sure you want to withdraw or cancel this ticket? Once cancelled, the ticket will be closed and agents will stop working on it.
          </p>
        </div>

        <div>
          <label htmlFor="cancel-reason-textarea" className="block text-xs font-bold text-[#0E1726] mb-1.5">
            Reason for cancellation <span className="text-red-500">*</span>
          </label>
          <textarea
            id="cancel-reason-textarea"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Please explain why you are cancelling this ticket (e.g., resolved myself, logged in error, no longer needed)..."
            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl p-3 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-rose-500 focus:outline-none transition leading-relaxed placeholder:text-[#8C95A8]"
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
            Keep Ticket
          </button>
          <button
            type="submit"
            disabled={loading || !reason.trim()}
            id="confirm-cancel-ticket-button"
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-xs disabled:opacity-50 flex items-center gap-1.5"
          >
            <Ban className="w-3.5 h-3.5" />
            <span>{loading ? "Cancelling..." : "Confirm Cancellation"}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
