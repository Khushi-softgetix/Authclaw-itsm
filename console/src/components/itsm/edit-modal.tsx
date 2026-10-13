"use client";

import React, { useState } from "react";
import ModalShell from "@/components/modal-shell";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { Incident } from "@/lib/itsm-types";

interface EditModalProps {
  incident: Incident;
  onClose: () => void;
  onSuccess: (updated: Incident) => void;
}

const IMPACTS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const URGENCIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;

export default function EditModal({ incident, onClose, onSuccess }: EditModalProps) {
  const [title, setTitle] = useState<string>(incident.title || "");
  const [description, setDescription] = useState<string>(incident.description || "");
  const [impact, setImpact] = useState<string>(incident.impact || "MEDIUM");
  const [urgency, setUrgency] = useState<string>(incident.urgency || "MEDIUM");
  const [priority, setPriority] = useState<string>(incident.priority || "P3");
  const [category, setCategory] = useState<string>(incident.category || "GENERAL");
  const [subcategory, setSubcategory] = useState<string>(incident.subcategory || "");
  const [isMajorIncident, setIsMajorIncident] = useState<boolean>(incident.is_major_incident || false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const payload = {
        title: title.trim(),
        description: description.trim(),
        impact,
        urgency,
        priority,
        category: category.trim() || "GENERAL",
        subcategory: subcategory.trim() ? subcategory.trim() : null,
        is_major_incident: isMajorIncident,
      };

      const res = await fetch(
        `/api/itsm/incidents/${incident.id}`,
        jsonRequest("PATCH", payload, { "If-Match": String(incident.version) }),
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to update incident"));
      }

      const updated = await res.json();
      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update incident details");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title={`Edit Incident · ${incident.ticket_number}`}
      onClose={onClose}
      error={error}
      maxWidthClass="max-w-[560px]"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="edit-title" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
            Title *
          </label>
          <input
            id="edit-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            required
          />
        </div>

        <div>
          <label htmlFor="edit-desc" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
            Description *
          </label>
          <textarea
            id="edit-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full bg-white border border-[#E6E9F0] rounded-lg p-2.5 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            required
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="edit-impact" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
              Impact
            </label>
            <select
              id="edit-impact"
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              className="w-full bg-white border border-[#E6E9F0] rounded-lg px-2.5 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            >
              {IMPACTS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="edit-urgency" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
              Urgency
            </label>
            <select
              id="edit-urgency"
              value={urgency}
              onChange={(e) => setUrgency(e.target.value)}
              className="w-full bg-white border border-[#E6E9F0] rounded-lg px-2.5 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            >
              {URGENCIES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="edit-priority" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
              Priority
            </label>
            <select
              id="edit-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full bg-white border border-[#E6E9F0] rounded-lg px-2.5 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-cat" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
              Category
            </label>
            <input
              id="edit-cat"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="edit-subcat" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
              Subcategory
            </label>
            <input
              id="edit-subcat"
              type="text"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              placeholder="e.g. VPN, SSO..."
              className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            id="edit-major"
            type="checkbox"
            checked={isMajorIncident}
            onChange={(e) => setIsMajorIncident(e.target.checked)}
            className="w-4 h-4 rounded border-[#E6E9F0] text-[#6D28D9] focus:ring-[#6D28D9]"
          />
          <label htmlFor="edit-major" className="text-xs font-medium text-[#0E1726] cursor-pointer">
            Flag as Major Incident
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E9F0]">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50"
          >
            {loading ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
