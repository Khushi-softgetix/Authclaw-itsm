"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

interface ServiceOption {
  id: string;
  name: string;
  tier?: string;
}

interface TeamOption {
  id: string;
  name: string;
  is_active: boolean;
  member_count?: number;
}

export default function CreateCatalogItemPage() {
  const router = useRouter();

  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [fulfillmentGroup, setFulfillmentGroup] = useState("");
  const [estimatedDeliveryHours, setEstimatedDeliveryHours] = useState(24);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available parent services from the existing tenant
  useEffect(() => {
    async function loadServices() {
      try {
        setLoadingServices(true);
        const res = await fetch("/api/itsm/services", { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Failed to load services");
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          setServices(data);
          if (data.length > 0) {
            setServiceId(data[0].id);
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load services");
      } finally {
        setLoadingServices(false);
      }
    }
    loadServices();
  }, []);

  // Load active ITSM operational teams
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Item name is required.");
      return;
    }
    if (!serviceId) {
      setError("Please select an associated parent service.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
        service_id: serviceId,
        fulfillment_group: fulfillmentGroup.trim() || undefined,
        estimated_delivery_hours: Number(estimatedDeliveryHours) || 24,
        approval_required: Boolean(approvalRequired),
        is_active: Boolean(isActive),
      };

      const res = await fetch("/api/itsm/admin/service-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        router.push("/itsm/login");
        return;
      }
      if (res.status === 403) {
        setError("You do not have permission to create catalog items.");
        setSaving(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || `Failed to create catalog item (${res.status})`);
      }

      const created = await res.json();
      router.push(`/itsm/catalog-manager/studio/${created.id}`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create catalog item");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6" id="create-catalog-item-container">
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

      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#6B7488]">
          <Link href="/itsm/catalog-manager/studio" className="hover:text-[#0E1726]">
            Catalog Studio
          </Link>
          <span className="text-[#A8B0C0]">/</span>
          <span className="text-[#0E1726] font-medium">New Offering</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight" id="create-catalog-item-title">
          Create Catalog Item
        </h1>
        <p className="text-xs text-[#6B7488]">
          Add a new self-service catalog item with approval and fulfillment configuration.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 flex items-center gap-3 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p className="flex-1 font-medium">{error}</p>
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs space-y-6">
        {/* Section 1: Basic Information */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-2 flex items-center gap-2">
            <Boxes className="w-4 h-4 text-[#6D28D9]" />
            <span>Basic Information</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Title */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-[#0E1726] mb-1">
                Offering Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Developer Laptop, AWS Sandbox Access, Ergonomic Chair"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] placeholder-[#A8B0C0] focus:outline-none focus:border-[#6D28D9] transition"
                id="catalog-item-name-input"
              />
            </div>

            {/* Custom Slug (Optional) */}
            <div>
              <label className="block text-xs font-bold text-[#0E1726] mb-1">
                URL Identifier / Slug <span className="text-xs font-normal text-[#6B7488]">(Optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. dev-laptop (auto-generated if left blank)"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] placeholder-[#A8B0C0] focus:outline-none focus:border-[#6D28D9] transition"
                id="catalog-item-slug-input"
              />
            </div>

            {/* Parent Service */}
            <div>
              <label className="block text-xs font-bold text-[#0E1726] mb-1">
                Parent Business Service <span className="text-red-500">*</span>
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
                  id="catalog-item-service-select"
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
                placeholder="Describe what the employee receives, prerequisite requirements, or standard kit specifications..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] placeholder-[#A8B0C0] focus:outline-none focus:border-[#6D28D9] transition"
                id="catalog-item-description-input"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Approval & Fulfillment */}
        <div className="space-y-4" id="new-approval-fulfillment-section">
          <div className="border-b border-[#E6E9F0] pb-2">
            <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#6D28D9]" />
              <span>Approval &amp; Fulfillment (Fulfillment &amp; Governance)</span>
            </h2>
            <p className="text-[11px] text-[#6B7488] mt-0.5">
              Configure approval requirement, responsible active fulfillment team, and delivery turnaround SLA.
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
                  >
                    {approvalRequired ? "ON" : "OFF"}
                  </span>
                </div>
                <p className="text-[11px] text-[#6B7488]">
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
                  id="new-approval-required-toggle-btn"
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
                  id="catalog-item-approval-checkbox"
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
                  id="catalog-item-fulfillment-input"
                >
                  <option value="">Select team ▼</option>
                  {teams.map((tm) => (
                    <option key={tm.id} value={tm.name}>
                      {tm.name} {tm.member_count ? `(${tm.member_count} members)` : ""}
                    </option>
                  ))}
                </select>
              )}
              <span className="text-[11px] text-[#6B7488] block mt-1">
                Responsible active ITSM team for fulfilling requests under this offering.
              </span>
            </div>

            {/* Delivery Hours */}
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
                id="catalog-item-delivery-input"
              />
              <span className="text-[11px] text-[#6B7488] block mt-1">
                Target turnaround SLA for request resolution from approval.
              </span>
            </div>

            {/* Active Status Toggle */}
            <div className="sm:col-span-2 p-4 rounded-xl border border-[#E6E9F0] bg-[#F9FAFB] flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-[#0E1726] block">Publish as Active</span>
                <span className="text-[11px] text-[#6B7488] block">
                  Immediately visible in the employee Requester Portal catalog.
                </span>
              </div>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded text-[#6D28D9] focus:ring-[#6D28D9]"
                id="catalog-item-active-checkbox"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-4 border-t border-[#E6E9F0] flex items-center justify-end gap-3">
          <Link
            href="/itsm/catalog-manager/studio"
            className="px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#475069] hover:bg-slate-50 transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs disabled:opacity-50"
            id="create-catalog-item-btn"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Creating Offering...</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Create Offering &amp; Open Studio</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
