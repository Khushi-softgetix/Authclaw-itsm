"use client";

import React, { useEffect, useState, useMemo } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Layers,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

export interface CIRelatedCIDetails {
  id: string;
  name: string;
  ci_type: string;
  status: string;
  environment: string;
}

export interface CIRelationshipItem {
  id: string;
  tenant_id: string;
  parent_ci_id: string;
  child_ci_id: string;
  relationship_type: string;
  source: string;
  confidence: number;
  status: string;
  created_at: string;
  direction?: "upstream" | "downstream";
  relationship_label?: string;
  related_ci?: CIRelatedCIDetails;
}

export interface ConfigurationItemOption {
  id: string;
  name: string;
  ci_type: string;
  environment: string;
  status: string;
  service_name?: string | null;
}

export interface CIRelationshipsModalProps {
  isOpen: boolean;
  onClose: () => void;
  ci: ConfigurationItemOption | null;
  availableCIs: ConfigurationItemOption[];
}

export const SUPPORTED_RELATIONSHIP_TYPES = [
  { value: "DEPENDS_ON", label: "Depends On (relies on component)" },
  { value: "RUNS_ON", label: "Runs On (executes on host/platform)" },
  { value: "HOSTED_ON", label: "Hosted On (hosted in cloud/provider)" },
  { value: "CONNECTS_TO", label: "Connects To (network/integration link)" },
  { value: "OWNED_BY", label: "Owned By (team/lead ownership)" },
  { value: "SUPPORTS", label: "Supports (underlying support provider)" },
  { value: "PART_OF", label: "Part Of (component of larger system)" },
];

export function CIRelationshipsModal({
  isOpen,
  onClose,
  ci,
  availableCIs,
}: CIRelationshipsModalProps) {
  const [relationships, setRelationships] = useState<CIRelationshipItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filter tabs: "all" | "upstream" | "downstream"
  const [directionTab, setDirectionTab] = useState<"all" | "upstream" | "downstream">("all");

  // Add Relationship Form
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTargetCiId, setSelectedTargetCiId] = useState("");
  const [selectedType, setSelectedType] = useState("DEPENDS_ON");
  const [directionMode, setDirectionMode] = useState<"current_is_parent" | "target_is_parent">(
    "current_is_parent"
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRelationships = async () => {
    if (!ci) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/itsm/admin/configuration-items/${ci.id}/relationships?direction=${directionTab}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to load relationships (${res.status})`);
      }
      const data = await res.json();
      setRelationships(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load relationships");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && ci) {
      void fetchRelationships();
      setShowAddForm(false);
      setFormError(null);
      setSuccessMessage(null);
    } else {
      setRelationships([]);
    }
  }, [isOpen, ci, directionTab]);

  // Eligible targets: all CIs in same tenant except the current CI
  const eligibleTargets = useMemo(() => {
    if (!ci) return [];
    return availableCIs.filter((item) => item.id !== ci.id);
  }, [ci, availableCIs]);

  const handleCreateRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ci) return;
    if (!selectedTargetCiId) {
      setFormError("Please select a target Configuration Item.");
      return;
    }

    setSaving(true);
    setFormError(null);

    const parentCiId = directionMode === "current_is_parent" ? ci.id : selectedTargetCiId;
    const childCiId = directionMode === "current_is_parent" ? selectedTargetCiId : ci.id;

    try {
      const res = await fetch("/api/itsm/admin/configuration-items/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_ci_id: parentCiId,
          child_ci_id: childCiId,
          relationship_type: selectedType,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to create relationship (${res.status})`);
      }

      setSuccessMessage("Relationship established successfully.");
      setShowAddForm(false);
      setSelectedTargetCiId("");
      void fetchRelationships();
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to create relationship");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRelationship = async (relId: string) => {
    if (!confirm("Are you sure you want to remove this relationship?")) return;
    setDeletingId(relId);
    setError(null);
    try {
      const res = await fetch(`/api/itsm/admin/configuration-items/relationships/${relId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to delete relationship (${res.status})`);
      }
      setRelationships((prev) => prev.filter((r) => r.id !== relId));
      setSuccessMessage("Relationship deleted.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete relationship");
    } finally {
      setDeletingId(null);
    }
  };

  if (!isOpen || !ci) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
      <div className="w-full max-w-3xl rounded-[20px] border border-[#E6E9F0] bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#E6E9F0] flex items-center justify-between bg-[#FAFAFA]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#F1ECFE] flex items-center justify-center text-[#6D28D9]">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#0E1726]">{ci.name}</h3>
                <span className="px-2 py-0.5 rounded-md bg-[#F1ECFE] text-[#6D28D9] font-mono text-[10px] font-semibold">
                  {ci.ci_type}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-[#F3F4F6] text-[#4B5563] text-[10px] font-medium">
                  {ci.environment}
                </span>
              </div>
              <p className="text-xs text-[#6B7488] mt-0.5">
                Inspect and manage upstream and downstream dependencies for this CI.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8E97A8] hover:text-[#0E1726] p-1 rounded-lg hover:bg-black/5 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Alerts */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-center justify-between text-xs text-red-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 font-bold">
              ×
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center gap-2 text-xs text-emerald-800">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Action Bar & Direction Tabs */}
        <div className="px-6 py-3 border-b border-[#E6E9F0] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white">
          <div className="flex items-center gap-1.5 p-1 bg-[#F5F7FA] rounded-xl">
            <button
              onClick={() => setDirectionTab("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                directionTab === "all"
                  ? "bg-white text-[#0E1726] shadow-xs"
                  : "text-[#6B7488] hover:text-[#0E1726]"
              }`}
            >
              All Dependencies
            </button>
            <button
              onClick={() => setDirectionTab("upstream")}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                directionTab === "upstream"
                  ? "bg-white text-[#0E1726] shadow-xs"
                  : "text-[#6B7488] hover:text-[#0E1726]"
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-indigo-600" />
              <span>Upstream (Dependents)</span>
            </button>
            <button
              onClick={() => setDirectionTab("downstream")}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                directionTab === "downstream"
                  ? "bg-white text-[#0E1726] shadow-xs"
                  : "text-[#6B7488] hover:text-[#0E1726]"
              }`}
            >
              <ArrowDownRight className="w-3.5 h-3.5 text-cyan-600" />
              <span>Downstream (Dependencies)</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchRelationships}
              disabled={loading}
              className="p-2 rounded-lg border border-[#E6E9F0] text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
              title="Refresh relationships"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition shadow-xs"
            >
              {showAddForm ? <ChevronUp className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{showAddForm ? "Hide Form" : "Add Relationship"}</span>
            </button>
          </div>
        </div>

        {/* Add Relationship Expandable Form */}
        {showAddForm && (
          <form
            onSubmit={handleCreateRelationship}
            className="px-6 py-4 bg-[#F9FAFB] border-b border-[#E6E9F0] space-y-3 text-xs animate-in slide-in-from-top-2 duration-150"
          >
            <div className="font-semibold text-[#0E1726] flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-[#6D28D9]" />
              <span>Link Configuration Item</span>
            </div>

            {formError && (
              <div className="p-2.5 rounded-lg bg-[#FEF2F2] border border-[#FCA5A5] text-red-800 text-[11px] flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Target CI */}
              <div>
                <label className="block text-[11px] font-semibold text-[#475069] mb-1">
                  Target CI <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedTargetCiId}
                  onChange={(e) => setSelectedTargetCiId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
                  required
                >
                  <option value="">Select target CI...</option>
                  {eligibleTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name} ({target.ci_type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Relationship Type */}
              <div>
                <label className="block text-[11px] font-semibold text-[#475069] mb-1">
                  Relationship Type <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
                >
                  {SUPPORTED_RELATIONSHIP_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Direction Semantics */}
              <div>
                <label className="block text-[11px] font-semibold text-[#475069] mb-1">
                  Direction Semantics <span className="text-red-500">*</span>
                </label>
                <select
                  value={directionMode}
                  onChange={(e) => setDirectionMode(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
                >
                  <option value="current_is_parent">
                    {ci.name} → Target CI (Current is Parent)
                  </option>
                  <option value="target_is_parent">
                    Target CI → {ci.name} (Target is Parent)
                  </option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-[11px] text-[#6B7488]">
                {directionMode === "current_is_parent"
                  ? `${ci.name} [${selectedType}] ${
                      eligibleTargets.find((t) => t.id === selectedTargetCiId)?.name || "Target"
                    }`
                  : `${
                      eligibleTargets.find((t) => t.id === selectedTargetCiId)?.name || "Target"
                    } [${selectedType}] ${ci.name}`}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#475069] hover:bg-[#F5F7FA]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !selectedTargetCiId}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{saving ? "Saving..." : "Create Link"}</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Relationships List Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-[#6B7488]">
              <Loader2 className="w-5 h-5 animate-spin text-[#6D28D9]" />
              <span>Loading relationships...</span>
            </div>
          ) : relationships.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <Layers className="w-8 h-8 text-[#8E97A8] mx-auto opacity-40" />
              <p className="text-xs font-semibold text-[#0E1726]">No relationships found</p>
              <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
                {directionTab === "upstream"
                  ? "No upstream dependents found. No other component depends directly on this CI."
                  : directionTab === "downstream"
                  ? "No downstream dependencies found. This CI does not depend directly on any other component."
                  : "No relationships have been defined for this Configuration Item yet."}
              </p>
              {!showAddForm && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Link another CI</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {relationships.map((rel) => {
                const isCurrentParent = rel.parent_ci_id === ci.id;
                const isUpstream = rel.direction === "upstream";

                return (
                  <div
                    key={rel.id}
                    className="p-3.5 rounded-xl border border-[#E6E9F0] bg-white hover:border-[#D1D5DB] transition flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          isUpstream
                            ? "bg-indigo-50 text-indigo-600"
                            : "bg-cyan-50 text-cyan-700"
                        }`}
                      >
                        {isUpstream ? (
                          <ArrowUpRight className="w-4 h-4" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4" />
                        )}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-xs text-[#0E1726]">
                            {rel.related_ci?.name || "Target CI"}
                          </span>
                          {rel.related_ci?.ci_type && (
                            <span className="px-1.5 py-0.5 rounded-md bg-[#F1ECFE] text-[#6D28D9] font-mono text-[10px] font-semibold">
                              {rel.related_ci.ci_type}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              isUpstream
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-cyan-100 text-cyan-800"
                            }`}
                          >
                            {isUpstream ? "Upstream Dependent" : "Downstream Dependency"}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-[#F3F4F6] text-[#475069] font-mono text-[10px] font-medium">
                            {rel.relationship_type}
                          </span>
                        </div>

                        <p className="text-[11px] text-[#6B7488] mt-1">
                          {rel.relationship_label ||
                            (isCurrentParent
                              ? `${ci.name} ${rel.relationship_type.toLowerCase().replace(/_/g, " ")} ${rel.related_ci?.name}`
                              : `${rel.related_ci?.name} ${rel.relationship_type.toLowerCase().replace(/_/g, " ")} ${ci.name}`)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        onClick={() => handleDeleteRelationship(rel.id)}
                        disabled={deletingId === rel.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] text-xs text-red-600 hover:bg-red-50 hover:border-red-200 transition disabled:opacity-50"
                        title="Remove relationship"
                      >
                        {deletingId === rel.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-[#E6E9F0] bg-[#FAFAFA] flex items-center justify-between text-xs text-[#6B7488]">
          <span>
            {relationships.length} relationship{relationships.length === 1 ? "" : "s"} shown
          </span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA] transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
