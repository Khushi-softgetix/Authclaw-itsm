"use client";

import React, { useEffect, useState } from "react";
import ModalShell from "@/components/modal-shell";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { Incident, TenantUser } from "@/lib/itsm-types";

interface AssignModalProps {
  incident: Incident;
  onClose: () => void;
  onSuccess: (updated: Incident) => void;
}

const COMMON_GROUPS = [
  "Service Desk",
  "Infrastructure",
  "Identity & Access",
  "Security Operations",
  "Network Engineering",
  "Application Support",
  "Database Operations",
];

export default function AssignModal({ incident, onClose, onSuccess }: AssignModalProps) {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [assigneeId, setAssigneeId] = useState<string>(incident.assignee_id || "");
  const [assignmentGroup, setAssignmentGroup] = useState<string>(incident.assignment_group || "");
  const [loadingUsers, setLoadingUsers] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadUsers = async () => {
      try {
        setLoadingUsers(true);
        const res = await fetch("/api/users");
        if (res.ok) {
          const data = await res.json();
          if (mounted && Array.isArray(data)) {
            setUsers(data);
          }
        }
      } catch (err: unknown) {
        console.warn("Failed to load tenant users:", err);
      } finally {
        if (mounted) setLoadingUsers(false);
      }
    };
    loadUsers();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        assignee_id: assigneeId ? assigneeId : null,
        assignment_group: assignmentGroup.trim() ? assignmentGroup.trim() : null,
      };

      const res = await fetch(`/api/itsm/incidents/${incident.id}/assign`, jsonRequest("POST", payload));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to assign incident"));
      }

      const updated = await res.json();
      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to assign incident");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={`Assign Incident · ${incident.ticket_number}`}
      onClose={onClose}
      error={error}
      maxWidthClass="max-w-[440px]"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="assignee-select" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
            Assignee (Tenant User)
          </label>
          <select
            id="assignee-select"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            disabled={loadingUsers}
            className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email} {u.role ? `(${u.role})` : ""}
              </option>
            ))}
          </select>
          {loadingUsers && (
            <p className="text-[10px] text-[#6B7488] mt-1">Loading tenant members...</p>
          )}
        </div>

        <div>
          <label htmlFor="group-select" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
            Assignment Group
          </label>
          <input
            id="group-select"
            type="text"
            list="common-groups"
            value={assignmentGroup}
            onChange={(e) => setAssignmentGroup(e.target.value)}
            placeholder="e.g. Service Desk, Infrastructure..."
            className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
          />
          <datalist id="common-groups">
            {COMMON_GROUPS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <p className="text-[10px] text-[#6B7488] mt-1">
            Choose a common operational group or enter a custom team name.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E9F0]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save Assignment"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
