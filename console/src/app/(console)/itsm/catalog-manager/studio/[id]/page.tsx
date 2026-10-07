"use client";

import React, { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Clock,
  Edit2,
  FileCheck,
  Layers,
  Loader2,
  Plus,
  Power,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
  X,
  XCircle,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";

interface CatalogItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  service_id: string;
  service_name: string | null;
  version: number;
  approval_required: boolean;
  fulfillment_group: string | null;
  estimated_delivery_hours: number;
  is_active: boolean;
  intake_schema?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface ServiceOption {
  id: string;
  name: string;
}

interface TeamOption {
  id: string;
  name: string;
  is_active: boolean;
  member_count?: number;
}

function CatalogItemDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const itemId = resolvedParams.id;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [item, setItem] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Mode state
  const [isEditing, setIsEditing] = useState(searchParams.get("mode") === "edit");
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);

  // Form Edit State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [fulfillmentGroup, setFulfillmentGroup] = useState("");
  const [estimatedDeliveryHours, setEstimatedDeliveryHours] = useState(24);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch Catalog Item Detail
  useEffect(() => {
    async function loadItem() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/itsm/admin/service-catalog/${itemId}`, { cache: "no-store" });
        if (res.status === 401) {
          router.push("/itsm/login");
          return;
        }
        if (res.status === 403) {
          setError("You do not have permission to view or manage this catalog item.");
          return;
        }
        if (res.status === 404) {
          throw new Error("Catalog item not found in this tenant.");
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || data.message || `Failed to load catalog item (${res.status})`);
        }

        const data: CatalogItem = await res.json();
        setItem(data);
        setName(data.name);
        setDescription(data.description || "");
        setServiceId(data.service_id);
        setFulfillmentGroup(data.fulfillment_group || "");
        setEstimatedDeliveryHours(data.estimated_delivery_hours || 24);
        setApprovalRequired(Boolean(data.approval_required));
        setIsActive(Boolean(data.is_active));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load catalog item");
      } finally {
        setLoading(false);
      }
    }

    if (itemId) {
      loadItem();
    }
  }, [itemId, router]);

  // Load Parent Services when entering edit mode
  useEffect(() => {
    if (isEditing && services.length === 0) {
      async function loadServices() {
        try {
          setLoadingServices(true);
          const res = await fetch("/api/itsm/services", { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              setServices(data.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
            }
          }
        } catch {
          // Non-blocking
        } finally {
          setLoadingServices(false);
        }
      }
      loadServices();
    }
  }, [isEditing, services.length]);

  // Load Active Fulfillment Teams
  useEffect(() => {
    async function loadTeams() {
      try {
        setLoadingTeams(true);
        const res = await fetch("/api/itsm/admin/service-catalog/fulfillment-teams", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setTeams(data);
          }
        }
      } catch {
        // Non-blocking
      } finally {
        setLoadingTeams(false);
      }
    }
    loadTeams();
  }, []);

  // Handle Save
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Item name is required.");
      return;
    }
    if (!serviceId) {
      setError("Please select a parent service.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        service_id: serviceId,
        fulfillment_group: fulfillmentGroup.trim() || null,
        estimated_delivery_hours: Number(estimatedDeliveryHours) || 24,
        approval_required: Boolean(approvalRequired),
        is_active: Boolean(isActive),
      };

      const res = await fetch(`/api/itsm/admin/service-catalog/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        router.push("/itsm/login");
        return;
      }
      if (res.status === 403) {
        setError("You do not have permission to update catalog items.");
        setSaving(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || `Failed to update catalog item (${res.status})`);
      }

      const updated = await res.json();
      setItem(updated);
      setIsEditing(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update catalog item");
    } finally {
      setSaving(false);
    }
  };

  // Safe inspection of intake_schema questions count
  const questionCount = (() => {
    if (!item?.intake_schema) return 0;
    const schema = item.intake_schema;
    if (schema.properties && typeof schema.properties === "object") {
      return Object.keys(schema.properties).length;
    }
    if (Array.isArray(schema.fields)) {
      return schema.fields.length;
    }
    if (Array.isArray(schema.questions)) {
      return schema.questions.length;
    }
    return 0;
  })();

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-[#6B7488]" id="catalog-detail-loading">
        <Loader2 className="w-6 h-6 animate-spin text-[#6D28D9]" />
        <p className="text-xs font-semibold">Loading catalog offering...</p>
      </div>
    );
  }

  if (error && !item) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Link
          href="/itsm/catalog-manager/studio"
          className="inline-flex items-center gap-2 text-xs font-bold text-[#6D28D9] hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Catalog Studio</span>
        </Link>
        <div className="p-6 rounded-2xl border border-red-200 bg-red-50 text-red-700 text-xs space-y-2">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>Offering Error</span>
          </div>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!item) return null;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6" id="catalog-item-detail-container">
      {/* Back Link */}
      <div>
        <Link
          href="/itsm/catalog-manager/studio"
          className="inline-flex items-center gap-2 text-xs font-bold text-[#6D28D9] hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Catalog Studio</span>
        </Link>
      </div>

      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#6B7488]">
            <Link href="/itsm/catalog-manager/studio" className="hover:text-[#0E1726]">
              Catalog Studio
            </Link>
            <span className="text-[#A8B0C0]">/</span>
            <span className="text-[#0E1726] font-medium">{item.name}</span>
          </div>

          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight" id="catalog-item-detail-title">
              {item.name}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]">
              v{item.version}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                item.is_active
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              }`}
              id="catalog-item-status-badge"
            >
              <Power className={`w-3 h-3 ${item.is_active ? "text-emerald-600" : "text-slate-400"}`} />
              <span>{item.is_active ? "Active" : "Inactive"}</span>
            </span>
          </div>

          <p className="text-xs text-[#6B7488]">
            URL Identifier: <span className="font-mono text-[#0E1726]">/{item.slug}</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            href={`/itsm/catalog-manager/form-builder?item=${item.id}`}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA] text-xs font-bold hover:bg-purple-100 transition shadow-xs"
            id="configure-form-btn"
          >
            <FileCheck className="w-4 h-4" />
            <span>Configure Form</span>
          </Link>

          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs"
              id="edit-offering-btn"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>Edit Offering</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setIsEditing(false);
                setName(item.name);
                setDescription(item.description || "");
                setServiceId(item.service_id);
                setFulfillmentGroup(item.fulfillment_group || "");
                setEstimatedDeliveryHours(item.estimated_delivery_hours);
                setApprovalRequired(item.approval_required);
                setIsActive(item.is_active);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#475069] hover:bg-slate-50 transition"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel Edit</span>
            </button>
          )}
        </div>
      </div>

      {/* Error alert during edit */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 flex items-center gap-3 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p className="flex-1 font-medium">{error}</p>
        </div>
      )}

      {/* Main Content: Edit Mode or Detail View */}
      {isEditing ? (
        <form onSubmit={handleSave} className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
            <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-[#6D28D9]" />
              <span>Edit Offering Information</span>
            </h2>
            <span className="text-[11px] text-[#6B7488]">Changes take effect immediately</span>
          </div>

          {/* Section 1: Basic Information */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#6B7488]">
              Basic Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Title */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-[#0E1726] mb-1">
                  Offering Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                  id="edit-catalog-name-input"
                />
              </div>

              {/* Parent Service */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-[#0E1726] mb-1">
                  Parent Service <span className="text-red-500">*</span>
                </label>
                {loadingServices ? (
                  <div className="flex items-center gap-2 text-xs text-[#6B7488] py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#6D28D9]" />
                    <span>Loading services...</span>
                  </div>
                ) : (
                  <select
                    required
                    value={serviceId}
                    onChange={(e) => setServiceId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-semibold text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                    id="edit-catalog-service-select"
                  >
                    {services.map((svc) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Description */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-[#0E1726] mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                  id="edit-catalog-description-input"
                />
              </div>

              {/* Active Status Toggle */}
              <div className="sm:col-span-2 p-4 rounded-xl border border-[#E6E9F0] bg-[#F9FAFB] flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-[#0E1726] block">Offering is Active</span>
                  <span className="text-[11px] text-[#6B7488] block">
                    Uncheck to retire or hide this offering from employees.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 rounded text-[#6D28D9] focus:ring-[#6D28D9]"
                  id="edit-catalog-active-checkbox"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Form Questions Link Notice */}
          <div className="p-4 rounded-xl border border-purple-200 bg-[#F1ECFE] flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#6D28D9]">
                <FileCheck className="w-4 h-4" />
                <span>Form Questions ({questionCount} configured)</span>
              </div>
              <p className="text-[11px] text-[#5B21B6] leading-relaxed">
                Intake questions and dynamic questionnaire fields are preserved and managed separately in the Form Builder.
              </p>
            </div>
            <Link
              href={`/itsm/catalog-manager/form-builder?item=${item.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shrink-0 shadow-xs"
            >
              <span>Open Form Builder</span>
            </Link>
          </div>

          {/* Section 3: Approval & Fulfillment */}
          <div className="space-y-4 pt-2 border-t border-[#E6E9F0]" id="approval-fulfillment-section">
            <div className="border-b border-[#E6E9F0] pb-2">
              <h3 className="text-sm font-bold text-[#0E1726] flex items-center gap-2" data-section="Fulfillment & Governance">
                <ShieldCheck className="w-4 h-4 text-[#6D28D9]" />
                <span>Approval &amp; Fulfillment ({"Fulfillment & Governance"})</span>
              </h3>
              <p className="text-[11px] text-[#6B7488] mt-0.5">
                Configure approval routing, responsible fulfillment group, and SLA commitments.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Approval Required Toggle */}
              <div className="sm:col-span-2 p-4 rounded-xl border border-[#E6E9F0] bg-[#F9FAFB] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#0E1726]">Approval Required</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${
                        approvalRequired
                          ? "bg-purple-100 text-[#6D28D9] border-[#A78BFA]"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                      id="approval-status-tag"
                    >
                      {approvalRequired ? "ON" : "OFF"}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#6B7488]" id="approval-description-text">
                    Requests for this catalog item require approval before fulfillment.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => setApprovalRequired(!approvalRequired)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      approvalRequired ? "bg-[#6D28D9]" : "bg-slate-300"
                    }`}
                    id="approval-required-toggle-btn"
                    aria-pressed={approvalRequired}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        approvalRequired ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <input
                    type="checkbox"
                    checked={approvalRequired}
                    onChange={(e) => setApprovalRequired(e.target.checked)}
                    className="sr-only"
                    id="edit-catalog-approval-checkbox"
                  />
                  <span className="text-xs font-bold text-[#0E1726] min-w-8">
                    {approvalRequired ? "ON" : "OFF"}
                  </span>
                </div>
              </div>

              {/* Fulfillment Team Selector */}
              <div>
                <label className="block text-xs font-bold text-[#0E1726] mb-1">
                  Fulfillment Team <span className="text-xs font-normal text-[#6B7488]">(Select team ▼)</span>
                </label>
                {loadingTeams ? (
                  <div className="flex items-center gap-2 text-xs text-[#6B7488] py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#6D28D9]" />
                    <span>Loading active ITSM teams...</span>
                  </div>
                ) : (
                  <select
                    value={fulfillmentGroup}
                    onChange={(e) => setFulfillmentGroup(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-semibold text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                    id="edit-catalog-fulfillment-select"
                  >
                    <option value="">Select team ▼</option>
                    {/* Active ITSM teams from database */}
                    {teams.map((tm) => (
                      <option key={tm.id} value={tm.name}>
                        {tm.name} {tm.member_count ? `(${tm.member_count} members)` : ""}
                      </option>
                    ))}
                    {/* Fallback option if currently saved team is not yet in active teams list */}
                    {fulfillmentGroup && !teams.some((t) => t.name.toLowerCase() === fulfillmentGroup.toLowerCase()) && (
                      <option value={fulfillmentGroup}>{fulfillmentGroup} (Current)</option>
                    )}
                  </select>
                )}
                <span className="text-[11px] text-[#6B7488] block mt-1">
                  Responsible active ITSM team for fulfilling requests under this offering.
                </span>
              </div>

              {/* Delivery / SLA */}
              <div>
                <label className="block text-xs font-bold text-[#0E1726] mb-1">
                  Delivery / SLA <span className="text-xs font-normal text-[#6B7488]">(Estimated hours)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={estimatedDeliveryHours}
                  onChange={(e) => setEstimatedDeliveryHours(Number(e.target.value))}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                  id="edit-catalog-delivery-input"
                />
                <span className="text-[11px] text-[#6B7488] block mt-1">
                  Target turnaround SLA for request resolution from approval.
                </span>
              </div>
            </div>
          </div>

          {/* Submit Actions */}
          <div className="pt-4 border-t border-[#E6E9F0] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#475069] hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs disabled:opacity-50"
              id="save-catalog-item-btn"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        /* Read-Only Detail View */
        <div className="space-y-6">
          {/* Grid Layout: Basic Info & Approval/Fulfillment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Card 1: Basic Information */}
            <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4">
              <h2 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-2 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-[#6D28D9]" />
                <span>Basic Information</span>
              </h2>

              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488] block">
                    Parent Service
                  </span>
                  <span className="font-semibold text-[#0E1726] text-xs mt-0.5 block" id="detail-service-name">
                    {item.service_name || "Unassigned"}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488] block">
                    Description
                  </span>
                  <p className="text-xs text-[#475069] mt-0.5 leading-relaxed" id="detail-description">
                    {item.description || "No description provided."}
                  </p>
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488] block">
                    Catalog Item Status
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                        item.is_active
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                    >
                      <Power className="w-3 h-3" />
                      <span>{item.is_active ? "Active for Requesters" : "Inactive / Draft"}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Approval & Fulfillment */}
            <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="detail-approval-fulfillment-card">
              <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-2">
                <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2" data-section="Fulfillment & Governance">
                  <ShieldCheck className="w-4 h-4 text-[#6D28D9]" />
                  <span>Approval &amp; Fulfillment ({"Fulfillment & Governance"})</span>
                </h2>
                <button
                  onClick={() => setIsEditing(true)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#6D28D9] hover:underline"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Configure</span>
                </button>
              </div>

              <div className="space-y-4 text-xs">
                {/* Approval */}
                <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F9FAFB] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">
                      Approval Required
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                        item.approval_required
                          ? "bg-purple-100 text-[#6D28D9] border-[#A78BFA]"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      }`}
                      id="detail-approval-status-badge"
                    >
                      {item.approval_required ? "ON" : "OFF"}
                    </span>
                  </div>
                  <p className="text-xs text-[#475069] leading-relaxed">
                    {item.approval_required
                      ? "Requests for this catalog item require approval before fulfillment."
                      : "Standard direct fulfillment without an approval gate."}
                  </p>
                </div>

                {/* Fulfillment Team */}
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488] block">
                    Fulfillment Team
                  </span>
                  {item.fulfillment_group ? (
                    <span className="font-semibold text-[#0E1726] text-xs mt-0.5 block" id="detail-fulfillment-group">
                      {item.fulfillment_group}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 mt-1" id="detail-fulfillment-group">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>No fulfillment team assigned. Requests route to general IT triage.</span>
                    </span>
                  )}
                </div>

                {/* Delivery / SLA */}
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488] block">
                    Delivery / SLA
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5 font-semibold text-[#0E1726]" id="detail-delivery-sla">
                    <Clock className="w-3.5 h-3.5 text-[#6D28D9]" />
                    <span>{item.estimated_delivery_hours} hours from approval</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Request Form Summary */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-[#6D28D9]" />
                <h2 className="text-sm font-bold text-[#0E1726]">Request Form Summary</h2>
              </div>
              <Link
                href={`/itsm/catalog-manager/form-builder?item=${item.id}`}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#6D28D9] hover:underline"
              >
                <span>Configure Form</span>
                <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
              </Link>
            </div>

            {questionCount > 0 ? (
              <div className="space-y-3" id="form-questions-summary">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{questionCount} Form Questions Configured</span>
                </div>
                <p className="text-xs text-[#6B7488]">
                  This offering includes customized intake questions stored in the JSON schema engine. Use the Form Builder to modify question types, required flags, or ordering.
                </p>
              </div>
            ) : (
              <div className="p-6 rounded-xl border border-dashed border-[#E6E9F0] text-center space-y-3 bg-[#F9FAFB]" id="no-form-empty-state">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-[#6D28D9] flex items-center justify-center mx-auto">
                  <FileCheck className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-bold text-[#0E1726]">No request form configured yet.</h3>
                  <p className="text-[11px] text-[#6B7488]">
                    Requesters will only be asked for standard issue summary and justification until custom questions are authored.
                  </p>
                </div>
                <Link
                  href={`/itsm/catalog-manager/form-builder?item=${item.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Configure Form</span>
                </Link>
              </div>
            )}
          </div>

          {/* Card 4: Audit & Record Details */}
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-3 text-xs text-[#6B7488]">
            <h2 className="text-sm font-bold text-[#0E1726]">Record Metadata</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#A8B0C0]">
                  Item Identifier
                </span>
                <span className="font-mono text-[11px] text-[#0E1726] mt-0.5 block">{item.id}</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#A8B0C0]">
                  Created Timestamp
                </span>
                <span className="text-[11px] text-[#0E1726] mt-0.5 block">
                  {formatDateTime(item.created_at)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#A8B0C0]">
                  Last Updated
                </span>
                <span className="text-[11px] text-[#0E1726] mt-0.5 block">
                  {formatDateTime(item.updated_at)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CatalogItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="p-8 max-w-5xl mx-auto text-center">
          <Loader2 className="w-6 h-6 text-[#6D28D9] animate-spin mx-auto mb-2" />
          <span className="text-xs text-[#6B7488]">Loading catalog offering details...</span>
        </div>
      }
    >
      <CatalogItemDetailContent params={params} />
    </Suspense>
  );
}
