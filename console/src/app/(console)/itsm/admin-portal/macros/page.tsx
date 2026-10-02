"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  Edit2,
  Filter,
  Plus,
  Power,
  RotateCcw,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { ITSMProductivityMacro } from "@/lib/itsm-types";

export default function AdminMacrosPage() {
  const [macros, setMacros] = useState<ITSMProductivityMacro[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Modal State
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingMacro, setEditingMacro] = useState<ITSMProductivityMacro | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // Form Fields
  const [formName, setFormName] = useState<string>("");
  const [formDescription, setFormDescription] = useState<string>("");
  const [formApplicableType, setFormApplicableType] = useState<string>("ALL");
  const [formResponseTemplate, setFormResponseTemplate] = useState<string>("");
  const [formStatusChange, setFormStatusChange] = useState<string>("");
  const [formStatusReason, setFormStatusReason] = useState<string>("");
  const [formPriorityChange, setFormPriorityChange] = useState<string>("");
  const [formFollowUpHours, setFormFollowUpHours] = useState<string>("");
  const [formIsActive, setFormIsActive] = useState<boolean>(true);

  const fetchMacros = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/itsm/macros?active_only=false", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to load macros"));
      }
      const data = await res.json();
      setMacros(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load macros");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMacros();
  }, []);

  const openCreateModal = () => {
    setEditingMacro(null);
    setFormName("");
    setFormDescription("");
    setFormApplicableType("ALL");
    setFormResponseTemplate("");
    setFormStatusChange("PENDING");
    setFormStatusReason("Pending Requester");
    setFormPriorityChange("");
    setFormFollowUpHours("24");
    setFormIsActive(true);
    setModalOpen(true);
  };

  const openEditModal = (macro: ITSMProductivityMacro) => {
    setEditingMacro(macro);
    setFormName(macro.name);
    setFormDescription(macro.description || "");
    setFormApplicableType(macro.applicable_ticket_type || "ALL");
    setFormResponseTemplate(macro.response_template);
    setFormStatusChange(macro.status_change || "");
    setFormStatusReason(macro.status_reason || "");
    setFormPriorityChange(macro.priority_change || "");
    setFormFollowUpHours(macro.follow_up_hours ? String(macro.follow_up_hours) : "");
    setFormIsActive(macro.is_active);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formResponseTemplate.trim()) {
      setError("Name and response template are required.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || null,
        applicable_ticket_type: formApplicableType,
        response_template: formResponseTemplate.trim(),
        status_change: formStatusChange || null,
        status_reason: formStatusReason.trim() || null,
        priority_change: formPriorityChange || null,
        follow_up_hours: formFollowUpHours ? parseInt(formFollowUpHours, 10) : null,
        is_active: formIsActive,
      };

      if (editingMacro) {
        const res = await fetch(`/api/itsm/macros/${editingMacro.id}`, jsonRequest("PATCH", payload));
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(apiErrorMessage(data, "Failed to update macro"));
        }
        setSuccessMessage(`Macro "${formName}" updated successfully.`);
      } else {
        const res = await fetch("/api/itsm/macros", jsonRequest("POST", payload));
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(apiErrorMessage(data, "Failed to create macro"));
        }
        setSuccessMessage(`Macro "${formName}" created successfully.`);
      }

      setModalOpen(false);
      fetchMacros();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save macro");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (macro: ITSMProductivityMacro) => {
    try {
      setError(null);
      const res = await fetch(`/api/itsm/macros/${macro.id}`, jsonRequest("PATCH", {
        is_active: !macro.is_active,
      }));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to toggle macro status"));
      }
      setSuccessMessage(`Macro "${macro.name}" is now ${!macro.is_active ? "active" : "deactivated"}.`);
      fetchMacros();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to toggle status");
    }
  };

  const handleDelete = async (macro: ITSMProductivityMacro) => {
    if (!confirm(`Are you sure you want to delete macro "${macro.name}"?`)) return;

    try {
      setError(null);
      const res = await fetch(`/api/itsm/macros/${macro.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to delete macro"));
      }
      setSuccessMessage(`Macro "${macro.name}" deleted.`);
      fetchMacros();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete macro");
    }
  };

  const filteredMacros = macros.filter((m) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = m.name.toLowerCase().includes(q);
      const matchDesc = (m.description || "").toLowerCase().includes(q);
      const matchText = m.response_template.toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchText) return false;
    }
    if (typeFilter !== "ALL") {
      if (m.applicable_ticket_type !== typeFilter && m.applicable_ticket_type !== "ALL") return false;
    }
    if (statusFilter === "ACTIVE" && !m.is_active) return false;
    if (statusFilter === "INACTIVE" && m.is_active) return false;
    return true;
  });

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-[#6B7488] mb-1">
          <Link href="/itsm/admin-portal" className="hover:text-[#0E1726]">
            Platform Administration
          </Link>
          <span>/</span>
          <span className="text-[#0E1726] font-medium">Macros &amp; Templates</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-[#0E1726] flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500 fill-amber-500" />
              Productivity Macros &amp; Response Templates
            </h1>
            <p className="text-xs text-[#6B7488]">
              Manage 1-click canned responses, automatic status transitions, and follow-up reminders for Service Agents.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            id="create-macro-button"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Create Macro
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-950 font-bold ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-[#8C95A8] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search macros by name, response text, or description..."
              className="w-full pl-9 pr-3 py-1.5 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] placeholder-[#8C95A8] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:outline-none"
            >
              <option value="ALL">All Ticket Types</option>
              <option value="INCIDENT">Incidents Only</option>
              <option value="SERVICE_REQUEST">Service Requests Only</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Deactivated Only</option>
            </select>

            <button
              type="button"
              onClick={fetchMacros}
              className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F8FAFC] transition"
              title="Refresh macros"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Macros List */}
      <div className="space-y-3">
        {loading ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-[#E6E9F0]">
            <p className="text-xs text-[#6B7488]">Loading macros...</p>
          </div>
        ) : filteredMacros.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-[#E6E9F0] space-y-2">
            <Zap className="w-8 h-8 text-[#8C95A8] mx-auto opacity-50" />
            <p className="text-xs font-semibold text-[#0E1726]">No macros found</p>
            <p className="text-[11px] text-[#6B7488]">Try changing your search terms or create a new macro.</p>
          </div>
        ) : (
          filteredMacros.map((macro) => (
            <div
              key={macro.id}
              className={`p-4 rounded-2xl border transition shadow-2xs space-y-2.5 ${
                macro.is_active ? "bg-white border-[#E6E9F0]" : "bg-gray-50 border-gray-200 opacity-75"
              }`}
              id={`admin-macro-card-${macro.slug}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600 border border-amber-200">
                    <Zap className="w-4 h-4" />
                  </span>
                  <div>
                    <h3 className="text-xs font-bold text-[#0E1726]">{macro.name}</h3>
                    <span className="text-[10px] font-mono text-[#8C95A8]">{macro.slug}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      macro.is_active
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-gray-100 text-gray-600 border-gray-300"
                    }`}
                  >
                    {macro.is_active ? "Active" : "Deactivated"}
                  </span>

                  <span className="text-[10px] font-medium bg-[#F1ECFE] text-[#6D28D9] border border-purple-200 px-2 py-0.5 rounded-full">
                    {macro.applicable_ticket_type === "ALL" ? "All Tickets" : macro.applicable_ticket_type}
                  </span>

                  {macro.status_change && (
                    <span className="text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full">
                      Status: {macro.status_change.replace(/_/g, " ")}
                    </span>
                  )}

                  {macro.follow_up_hours && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-full">
                      <Clock className="w-2.5 h-2.5" /> Follow-up: {macro.follow_up_hours}h
                    </span>
                  )}

                  <div className="flex items-center gap-1 ml-2 border-l border-[#E6E9F0] pl-2">
                    <button
                      type="button"
                      onClick={() => openEditModal(macro)}
                      className="p-1 rounded-lg text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F8FAFC] transition"
                      title="Edit macro"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(macro)}
                      className={`p-1 rounded-lg transition ${
                        macro.is_active
                          ? "text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                          : "text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50"
                      }`}
                      title={macro.is_active ? "Deactivate macro" : "Activate macro"}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(macro)}
                      className="p-1 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 transition"
                      title="Delete macro"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {macro.description && (
                <p className="text-xs text-[#6B7488]">{macro.description}</p>
              )}

              <div className="bg-[#F8FAFC] border border-[#E6E9F0] rounded-xl p-2.5">
                <span className="block text-[10px] font-bold text-[#8C95A8] uppercase tracking-wider mb-1">
                  Response Template
                </span>
                <p className="text-xs text-[#0E1726] whitespace-pre-wrap font-sans">
                  {macro.response_template}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-[#E6E9F0]">
              <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
                {editingMacro ? "Edit Macro" : "Create Productivity Macro"}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-[#6B7488] hover:text-[#0E1726] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  Macro Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Laptop Troubleshooting"
                  required
                  className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">Description</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Short note on when agents should use this macro"
                  className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1">Ticket Type</label>
                  <select
                    value={formApplicableType}
                    onChange={(e) => setFormApplicableType(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  >
                    <option value="ALL">All Ticket Types</option>
                    <option value="INCIDENT">Incidents Only</option>
                    <option value="SERVICE_REQUEST">Service Requests Only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1">Status Transition</label>
                  <select
                    value={formStatusChange}
                    onChange={(e) => setFormStatusChange(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  >
                    <option value="">No Status Change</option>
                    <option value="PENDING">Pending (Requester Response)</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="RESOLVED">Resolved</option>
                  </select>
                </div>
              </div>

              {formStatusChange === "PENDING" && (
                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1">Status Reason</label>
                  <input
                    type="text"
                    value={formStatusReason}
                    onChange={(e) => setFormStatusReason(e.target.value)}
                    placeholder="e.g. Pending Requester"
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1">Follow-up Reminder (Hours)</label>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={formFollowUpHours}
                    onChange={(e) => setFormFollowUpHours(e.target.value)}
                    placeholder="e.g. 24"
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  />
                  <span className="text-[10px] text-[#8C95A8]">e.g. 24 for a 24-hour reminder</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1">Priority Change</label>
                  <select
                    value={formPriorityChange}
                    onChange={(e) => setFormPriorityChange(e.target.value)}
                    className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  >
                    <option value="">No Priority Change</option>
                    <option value="P1">P1 - Critical</option>
                    <option value="P2">P2 - High</option>
                    <option value="P3">P3 - Medium</option>
                    <option value="P4">P4 - Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  Response Template <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formResponseTemplate}
                  onChange={(e) => setFormResponseTemplate(e.target.value)}
                  placeholder="Predefined message inserted into comment box when agent applies this macro..."
                  rows={4}
                  required
                  className="w-full px-3 py-2 bg-[#F8FAFC] border border-[#E6E9F0] rounded-lg text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none resize-y"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="form-is-active"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded border-[#E6E9F0] text-[#6D28D9] focus:ring-[#6D28D9]"
                />
                <label htmlFor="form-is-active" className="text-xs font-medium text-[#0E1726]">
                  Active (selectable by Service Agents in comment composer)
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E6E9F0]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[#E6E9F0] text-xs font-semibold text-[#6B7488] hover:text-[#0E1726] transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition shadow-xs disabled:opacity-50"
                >
                  {saving ? "Saving..." : editingMacro ? "Update Macro" : "Create Macro"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
