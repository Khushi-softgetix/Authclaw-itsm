"use client";

import React, { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  Edit2,
  Eye,
  FileCheck,
  Layers,
  Loader2,
  Plus,
  Power,
  RotateCcw,
  Save,
  Send,
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

interface ValidationCheck {
  category: string;
  name: string;
  passed: boolean;
  message?: string;
}

interface ValidationResponse {
  is_valid: boolean;
  status: string;
  errors: string[];
  checks: ValidationCheck[];
}

interface FormQuestion {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  description?: string;
  placeholder?: string;
  options?: string[];
  default_value?: any;
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
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

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

  // Validation State (Prompt 6)
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResponse | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);

  // Preview State (Prompt 6)
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, any>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewSimulationSuccess, setPreviewSimulationSuccess] = useState<string | null>(null);

  // Publish / Deactivate State (Prompt 6)
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);

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
          setError("You do not have permission to view catalog offerings.");
          setLoading(false);
          return;
        }
        if (!res.ok) {
          throw new Error("Catalog item not found or could not be loaded.");
        }

        const data: CatalogItem = await res.json();
        setItem(data);
        setName(data.name);
        setDescription(data.description || "");
        setServiceId(data.service_id);
        setFulfillmentGroup(data.fulfillment_group || "");
        setEstimatedDeliveryHours(data.estimated_delivery_hours);
        setApprovalRequired(Boolean(data.approval_required));
        setIsActive(data.is_active);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load catalog item");
      } finally {
        setLoading(false);
      }
    }

    loadItem();
  }, [itemId, router]);

  // Load Parent Services for edit dropdown
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
      setActionSuccessMsg("Catalog offering saved successfully.");
      setTimeout(() => setActionSuccessMsg(null), 4000);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update catalog item");
    } finally {
      setSaving(false);
    }
  };

  // Safe extraction of questions list and counts
  const questionsList: FormQuestion[] = (() => {
    if (!item?.intake_schema) return [];
    const schema = item.intake_schema;
    if (Array.isArray(schema.questions)) return schema.questions;
    if (Array.isArray(schema.fields)) return schema.fields;
    if (schema.properties && typeof schema.properties === "object") {
      return Object.entries(schema.properties).map(([k, v]: [string, any]) => ({
        id: k,
        label: v.title || k,
        type: v.type === "integer" || v.type === "number" ? "number" : "text",
        required: Array.isArray(schema.required) ? schema.required.includes(k) : false,
        description: v.description,
        options: Array.isArray(v.enum) ? v.enum : undefined,
      }));
    }
    return [];
  })();

  const questionCount = questionsList.length;
  const requiredCount = questionsList.filter((q) => q.required).length;

  // Validation Action
  const handleValidate = async () => {
    if (isEditing) {
      setError("Please save your pending changes before validating.");
      return;
    }
    setError(null);
    setIsValidating(true);
    try {
      const res = await fetch(`/api/itsm/admin/service-catalog/${itemId}/validate`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Validation request failed.");
      }
      const data: ValidationResponse = await res.json();
      setValidationResult(data);
      setShowValidationModal(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Validation failed.");
    } finally {
      setIsValidating(false);
    }
  };

  // Preview Action
  const handleOpenPreview = () => {
    if (isEditing) {
      setError("Please save your pending changes before previewing.");
      return;
    }
    setPreviewAnswers({});
    setPreviewError(null);
    setPreviewSimulationSuccess(null);
    setShowPreviewModal(true);
  };

  // Publish Action
  const handleOpenPublish = async () => {
    if (isEditing) {
      setError("Please save your pending changes before publishing.");
      return;
    }
    setError(null);
    setIsValidating(true);
    try {
      const res = await fetch(`/api/itsm/admin/service-catalog/${itemId}/validate`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Unable to run publish pre-validation.");
      }
      const valData: ValidationResponse = await res.json();
      setValidationResult(valData);
      if (!valData.is_valid) {
        // Show validation errors modal
        setShowValidationModal(true);
      } else {
        // Validation succeeded -> Open Publish Confirmation
        setShowPublishModal(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Publish pre-check failed.");
    } finally {
      setIsValidating(false);
    }
  };

  // Confirm Publish
  const handleConfirmPublish = async () => {
    setIsPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/itsm/admin/service-catalog/${itemId}/publish`, {
        method: "POST",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = typeof errData.detail === "object" ? errData.detail.message : errData.detail;
        throw new Error(msg || "Failed to publish offering.");
      }
      const updated: CatalogItem = await res.json();
      setItem(updated);
      setIsActive(updated.is_active);
      setShowPublishModal(false);
      setActionSuccessMsg(`Offering "${updated.name}" is now Published and live for Requesters.`);
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Publish action failed.");
    } finally {
      setIsPublishing(false);
    }
  };

  // Deactivate Action
  const handleOpenDeactivate = () => {
    setShowDeactivateModal(true);
  };

  // Confirm Deactivate
  const handleConfirmDeactivate = async () => {
    setIsDeactivating(true);
    setError(null);
    try {
      const res = await fetch(`/api/itsm/admin/service-catalog/${itemId}/deactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to deactivate offering.");
      }
      const updated: CatalogItem = await res.json();
      setItem(updated);
      setIsActive(updated.is_active);
      setShowDeactivateModal(false);
      setActionSuccessMsg(`Offering "${updated.name}" has been Deactivated. New requests are blocked while historical requests remain intact.`);
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deactivation failed.");
    } finally {
      setIsDeactivating(false);
    }
  };

  // Preview Simulation Submit (Safe, Read-Only Simulation)
  const handlePreviewSimulationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPreviewError(null);
    setPreviewSimulationSuccess(null);

    // Validate required questions
    for (const q of questionsList) {
      if (q.required) {
        const val = previewAnswers[q.id];
        const isEmpty =
          val === undefined ||
          val === null ||
          (typeof val === "string" && !val.trim()) ||
          (Array.isArray(val) && val.length === 0);
        if (isEmpty) {
          setPreviewError(`"${q.label}" is required.`);
          return;
        }
      }
    }

    setPreviewSimulationSuccess(
      `Simulation Successful! In production, this request would be created with ${Object.keys(previewAnswers).length} dynamic response(s). No database records, approval tickets, or notifications were created.`
    );
  };

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

      {/* Global Success / Error Banners */}
      {actionSuccessMsg && (
        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex items-center gap-3 text-emerald-800 text-xs shadow-xs" id="catalog-action-success-banner">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="font-semibold flex-1">{actionSuccessMsg}</p>
          <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 flex items-center gap-3 text-red-700 text-xs shadow-xs" id="catalog-action-error-banner">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <p className="font-semibold flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header Banner with Lifecycle Controls (Prompt 6) */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6" id="catalog-header-banner">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#6B7488]">
            <Link href="/itsm/catalog-manager/studio" className="hover:text-[#0E1726]">
              Catalog Studio
            </Link>
            <span className="text-[#A8B0C0]">/</span>
            <span className="text-[#0E1726] font-medium">{item.name}</span>
          </div>

          <div className="flex items-center flex-wrap gap-3">
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight" id="catalog-item-detail-title">
              {item.name}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]">
              v{item.version}
            </span>
            {/* Status Badge */}
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                item.is_active
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-100 text-slate-700 border-slate-200"
              }`}
              id="catalog-item-status-badge"
            >
              <Power className={`w-3.5 h-3.5 ${item.is_active ? "text-emerald-600" : "text-slate-400"}`} />
              <span>{item.is_active ? "Active / Published" : "Draft / Inactive"}</span>
            </span>
          </div>

          {/* Metadata Chips Summary */}
          <div className="flex items-center flex-wrap gap-2 text-[11px] pt-1">
            <span className="px-2.5 py-0.5 rounded-lg bg-[#F9FAFB] border border-[#E6E9F0] text-[#475069] font-medium">
              Questions: <strong className="text-[#0E1726]">{questionCount}</strong> ({requiredCount} req)
            </span>
            <span className="px-2.5 py-0.5 rounded-lg bg-[#F9FAFB] border border-[#E6E9F0] text-[#475069] font-medium">
              Approval: <strong className="text-[#0E1726]">{item.approval_required ? "Required" : "Not Required"}</strong>
            </span>
            <span className="px-2.5 py-0.5 rounded-lg bg-[#F9FAFB] border border-[#E6E9F0] text-[#475069] font-medium">
              Fulfillment: <strong className="text-[#0E1726]">{item.fulfillment_group || "General IT"}</strong>
            </span>
            <span className="text-xs text-[#6B7488] font-mono">
              /{item.slug}
            </span>
          </div>
        </div>

        {/* Action Toolbar (Prompt 6) */}
        <div className="flex items-center flex-wrap gap-2 shrink-0" id="catalog-action-toolbar">
          {/* Validate Button */}
          <button
            onClick={handleValidate}
            disabled={isValidating}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#E6E9F0] text-xs font-bold text-[#0E1726] hover:bg-[#F9FAFB] hover:border-purple-300 transition shadow-2xs disabled:opacity-50"
            id="validate-catalog-item-btn"
            title="Run deterministic readiness validation"
          >
            {isValidating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#6D28D9]" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-[#6D28D9]" />
            )}
            <span>Validate</span>
          </button>

          {/* Preview Button */}
          <button
            onClick={handleOpenPreview}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#E6E9F0] text-xs font-bold text-[#0E1726] hover:bg-[#F9FAFB] hover:border-purple-300 transition shadow-2xs"
            id="preview-catalog-item-btn"
            title="Preview offering as seen by requesters"
          >
            <Eye className="w-3.5 h-3.5 text-[#6D28D9]" />
            <span>Preview</span>
          </button>

          {/* Form Builder Link */}
          <Link
            href={`/itsm/catalog-manager/form-builder?item=${item.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA] text-xs font-bold hover:bg-purple-100 transition shadow-2xs"
            id="configure-form-btn"
          >
            <FileCheck className="w-3.5 h-3.5" />
            <span>Configure Form</span>
          </Link>

          {/* Lifecycle: Publish or Deactivate */}
          {!item.is_active ? (
            <button
              onClick={handleOpenPublish}
              disabled={isValidating || isPublishing}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition shadow-xs disabled:opacity-50"
              id="publish-catalog-item-btn"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Publish</span>
            </button>
          ) : (
            <button
              onClick={handleOpenDeactivate}
              disabled={isDeactivating}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 text-xs font-bold hover:bg-amber-100 transition shadow-2xs"
              id="deactivate-catalog-item-btn"
            >
              <Power className="w-3.5 h-3.5 text-amber-700" />
              <span>Deactivate</span>
            </button>
          )}

          {/* Edit / Cancel Toggle */}
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs"
              id="edit-offering-btn"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>Edit</span>
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
              id="cancel-edit-btn"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content: Edit Mode or Detail View */}
      {isEditing ? (
        <form onSubmit={handleSave} className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
            <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-[#6D28D9]" />
              <span>Edit Offering Information</span>
            </h2>
            <span className="text-[11px] text-[#6B7488]">Remember to save before publishing</span>
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
                    {teams.map((tm) => (
                      <option key={tm.id} value={tm.name}>
                        {tm.name} {tm.member_count ? `(${tm.member_count} members)` : ""}
                      </option>
                    ))}
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
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
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
                  <span>{questionCount} Form Questions Configured ({requiredCount} required)</span>
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

      {/* ========================================================================= */}
      {/* MODAL 1: VALIDATION RESULT (Prompt 6 - Section 4) */}
      {/* ========================================================================= */}
      {showValidationModal && validationResult && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4" id="catalog-validation-modal">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
            {/* Header */}
            <div className="p-5 border-b border-[#E6E9F0] flex items-center justify-between">
              <div className="space-y-0.5">
                <h3 className="text-base font-bold text-[#0E1726] flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-[#6D28D9]" />
                  <span>Catalog Validation</span>
                </h3>
                <p className="text-xs text-[#6B7488]">
                  Readiness checks for offering <strong className="text-[#0E1726]">{item.name}</strong>
                </p>
              </div>
              <button
                onClick={() => setShowValidationModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6B7488] hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              {/* Overall Status Banner */}
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  validationResult.is_valid
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-rose-50 border-rose-200 text-rose-800"
                }`}
                id="validation-status-result"
              >
                {validationResult.is_valid ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold uppercase tracking-wide text-xs">
                      Status:
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        validationResult.is_valid
                          ? "bg-emerald-200/60 text-emerald-900"
                          : "bg-rose-200/60 text-rose-900"
                      }`}
                      id="validation-status-label"
                    >
                      {validationResult.status || (validationResult.is_valid ? "READY TO PUBLISH" : "VALIDATION FAILED")}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {validationResult.is_valid
                      ? "All configuration checks passed. Offering is ready for publication."
                      : "Blocking validation issues must be resolved before this offering can be published."}
                  </p>
                </div>
              </div>

              {/* Categorized Checks List */}
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#6B7488]">
                  Configuration Checks
                </h4>
                <div className="space-y-2 border border-[#E6E9F0] rounded-xl p-3 bg-[#FBFAF9]">
                  {validationResult.checks.map((chk, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2.5 py-1 text-xs"
                      id={`validation-check-${chk.category}`}
                    >
                      {chk.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <span className="font-semibold text-[#0E1726]">{chk.name}</span>
                        {chk.message && (
                          <p className={`text-[11px] leading-tight ${chk.passed ? "text-[#6B7488]" : "text-rose-600 font-medium"}`}>
                            {chk.message}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actionable Errors List */}
              {validationResult.errors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
                    Actionable Errors ({validationResult.errors.length})
                  </h4>
                  <div className="space-y-2">
                    {validationResult.errors.map((err, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2 font-medium"
                      >
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[#E6E9F0] flex items-center justify-end gap-3 bg-[#FAF9FD]">
              <button
                type="button"
                onClick={() => setShowValidationModal(false)}
                className="px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#475069] hover:bg-slate-50 transition"
              >
                Close
              </button>
              {validationResult.is_valid && !item.is_active && (
                <button
                  type="button"
                  onClick={() => {
                    setShowValidationModal(false);
                    setShowPublishModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition shadow-xs"
                  id="proceed-to-publish-btn"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Proceed to Publish</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: REQUESTER LIVE PREVIEW (Prompt 6 - Sections 6, 7 & 8) */}
      {/* ========================================================================= */}
      {showPreviewModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4" id="requester-preview-modal">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
            {/* Header */}
            <div className="p-5 border-b border-[#E6E9F0] flex items-center justify-between bg-[#FAF9FD]">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-purple-100 text-[#6D28D9] border border-[#A78BFA]">
                    REQUESTER PREVIEW
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    Simulation Only
                  </span>
                </div>
                <h3 className="text-base font-bold text-[#0E1726]">{item.name}</h3>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6B7488] hover:bg-slate-100 transition"
                id="close-preview-modal-btn"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Read-only Simulation Notice */}
            <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-[11px] flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>
                <strong>Read-Only Simulation:</strong> Testing inputs does NOT create a real Service Request or approval record.
              </span>
            </div>

            {/* Form Body */}
            <form onSubmit={handlePreviewSimulationSubmit} className="p-6 overflow-y-auto space-y-5 text-xs">
              {/* Offering Overview Card */}
              <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F9FAFB] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#0E1726]">{item.service_name || "General Service"}</span>
                  <span className="text-[#6B7488] flex items-center gap-1 font-medium text-[11px]">
                    <Clock className="w-3 h-3 text-[#6D28D9]" />
                    <span>{item.estimated_delivery_hours}h SLA</span>
                  </span>
                </div>
                {item.description && (
                  <p className="text-[11px] text-[#475069] leading-relaxed">
                    {item.description}
                  </p>
                )}
                <div className="pt-2 border-t border-[#E6E9F0] flex items-center gap-2 text-[10px] font-semibold text-[#6B7488]">
                  <span>Approval: {item.approval_required ? "Required" : "Direct Fulfillment"}</span>
                  <span>•</span>
                  <span>Team: {item.fulfillment_group || "IT Operations"}</span>
                </div>
              </div>

              {/* Dynamic Questions (PLT-006 Engine Simulation) */}
              {questionsList.length > 0 ? (
                <div className="space-y-4" id="preview-questions-container">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#6B7488] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#6D28D9]" />
                    <span>Dynamic Request Questions</span>
                  </h4>

                  {questionsList.map((q) => {
                    const qId = q.id;
                    return (
                      <div key={qId} className="space-y-1.5" id={`preview-question-${qId}`}>
                        <label className="block text-xs font-bold text-[#0E1726]">
                          {q.label} {q.required && <span className="text-red-500">*</span>}
                        </label>
                        {q.description && (
                          <p className="text-[11px] text-[#6B7488] leading-tight mb-1">
                            {q.description}
                          </p>
                        )}

                        {/* Short Text */}
                        {q.type === "text" && (
                          <input
                            type="text"
                            placeholder={q.placeholder || `Enter ${q.label}...`}
                            value={previewAnswers[qId] || ""}
                            onChange={(e) => setPreviewAnswers({ ...previewAnswers, [qId]: e.target.value })}
                            className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                          />
                        )}

                        {/* Long Text */}
                        {q.type === "textarea" && (
                          <textarea
                            rows={3}
                            placeholder={q.placeholder || `Enter ${q.label}...`}
                            value={previewAnswers[qId] || ""}
                            onChange={(e) => setPreviewAnswers({ ...previewAnswers, [qId]: e.target.value })}
                            className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                          />
                        )}

                        {/* Number */}
                        {q.type === "number" && (
                          <input
                            type="number"
                            placeholder={q.placeholder || "0"}
                            value={previewAnswers[qId] || ""}
                            onChange={(e) => setPreviewAnswers({ ...previewAnswers, [qId]: e.target.value })}
                            className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                          />
                        )}

                        {/* Dropdown */}
                        {q.type === "dropdown" && (
                          <select
                            value={previewAnswers[qId] || ""}
                            onChange={(e) => setPreviewAnswers({ ...previewAnswers, [qId]: e.target.value })}
                            className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs text-[#0E1726] font-medium focus:outline-none focus:border-[#6D28D9] transition"
                          >
                            <option value="">Select an option ▼</option>
                            {(q.options || []).map((opt, optIdx) => (
                              <option key={optIdx} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}

                        {/* Radio */}
                        {q.type === "radio" && (
                          <div className="space-y-1.5 pt-0.5">
                            {(q.options || []).map((opt, optIdx) => (
                              <label key={optIdx} className="flex items-center gap-2 text-xs text-[#0E1726] cursor-pointer">
                                <input
                                  type="radio"
                                  name={`preview-${qId}`}
                                  value={opt}
                                  checked={previewAnswers[qId] === opt}
                                  onChange={() => setPreviewAnswers({ ...previewAnswers, [qId]: opt })}
                                  className="w-3.5 h-3.5 text-[#6D28D9] focus:ring-[#6D28D9]"
                                />
                                <span>{opt}</span>
                              </label>
                            ))}
                          </div>
                        )}

                        {/* Multi-Select */}
                        {q.type === "multiselect" && (
                          <div className="space-y-1.5 pt-0.5">
                            {(q.options || []).map((opt, optIdx) => {
                              const currentSelected: string[] = Array.isArray(previewAnswers[qId]) ? previewAnswers[qId] : [];
                              const isChecked = currentSelected.includes(opt);
                              return (
                                <label key={optIdx} className="flex items-center gap-2 text-xs text-[#0E1726] cursor-pointer">
                                  <input
                                    type="checkbox"
                                    value={opt}
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setPreviewAnswers({ ...previewAnswers, [qId]: [...currentSelected, opt] });
                                      } else {
                                        setPreviewAnswers({ ...previewAnswers, [qId]: currentSelected.filter((o) => o !== opt) });
                                      }
                                    }}
                                    className="w-3.5 h-3.5 rounded text-[#6D28D9] focus:ring-[#6D28D9]"
                                  />
                                  <span>{opt}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-[#E6E9F0] text-center text-xs text-[#6B7488] space-y-1">
                  <p className="font-semibold text-[#0E1726]">Standard Service Request Form</p>
                  <p className="text-[11px]">This offering uses default summary and justification fields without custom questions.</p>
                </div>
              )}

              {/* In-Preview Feedback */}
              {previewError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{previewError}</span>
                </div>
              )}

              {previewSimulationSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{previewSimulationSuccess}</span>
                </div>
              )}

              {/* Simulation Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs flex items-center justify-center gap-2"
                  id="preview-submit-btn"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit Request (Simulation)</span>
                </button>
              </div>
            </form>

            {/* Footer */}
            <div className="p-4 border-t border-[#E6E9F0] flex items-center justify-between text-[11px] text-[#6B7488] bg-[#FAF9FD]">
              <span>Read-only simulation preview</span>
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs font-bold text-[#475069] hover:bg-slate-50 transition"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: PUBLISH CONFIRMATION (Prompt 6 - Section 10) */}
      {/* ========================================================================= */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4" id="publish-confirm-modal">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-2xl max-w-md w-full p-6 space-y-5 animate-in fade-in duration-150">
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#0E1726] flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-600" />
                <span>Publish Catalog Item?</span>
              </h3>
              <p className="text-xs text-[#6B7488]">
                <strong>{item.name}</strong> will become immediately available to Requesters in the Service Catalog.
              </p>
            </div>

            {/* Configuration Summary */}
            <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F9FAFB] space-y-2 text-xs">
              <div className="flex justify-between py-0.5 border-b border-[#E6E9F0]">
                <span className="text-[#6B7488]">Offering Title</span>
                <span className="font-bold text-[#0E1726]">{item.name}</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#E6E9F0]">
                <span className="text-[#6B7488]">Form Questions</span>
                <span className="font-bold text-[#0E1726]">{questionCount} ({requiredCount} required)</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#E6E9F0]">
                <span className="text-[#6B7488]">Approval Gate</span>
                <span className="font-bold text-[#0E1726]">
                  {item.approval_required ? "Required before fulfillment" : "Direct Fulfillment"}
                </span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[#6B7488]">Fulfillment Team</span>
                <span className="font-bold text-[#0E1726]">{item.fulfillment_group || "General IT Triage"}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowPublishModal(false)}
                disabled={isPublishing}
                className="px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#475069] hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPublish}
                disabled={isPublishing}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition shadow-xs disabled:opacity-50"
                id="confirm-publish-btn"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Publishing...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Confirm &amp; Publish</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: DEACTIVATE CONFIRMATION (Prompt 6 - Section 13 & 14) */}
      {/* ========================================================================= */}
      {showDeactivateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4" id="deactivate-confirm-modal">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-2xl max-w-md w-full p-6 space-y-5 animate-in fade-in duration-150">
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#0E1726] flex items-center gap-2">
                <Power className="w-5 h-5 text-amber-600" />
                <span>Deactivate Catalog Offering?</span>
              </h3>
              <p className="text-xs text-[#6B7488]">
                <strong>{item.name}</strong> will no longer be offered for new Requester submissions.
              </p>
            </div>

            {/* Preservation Safety Note */}
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-amber-700" />
                <span>Historical Requests Protected</span>
              </p>
              <p className="text-[11px] leading-relaxed text-amber-800">
                All existing tickets previously created under this offering remain 100% accessible. Their dynamic form answers, approval states, and fulfillment assignments remain intact.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeactivateModal(false)}
                disabled={isDeactivating}
                className="px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#475069] hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeactivate}
                disabled={isDeactivating}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition shadow-xs disabled:opacity-50"
                id="confirm-deactivate-btn"
              >
                {isDeactivating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deactivating...</span>
                  </>
                ) : (
                  <>
                    <Power className="w-3.5 h-3.5" />
                    <span>Deactivate Offering</span>
                  </>
                )}
              </button>
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
