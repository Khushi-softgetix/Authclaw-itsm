"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Layers,
  Loader2,
  Server,
  X,
} from "lucide-react";

interface Service {
  id: string;
  name: string;
}

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
  created_at: string;
  updated_at: string;
}

export default function EditServiceCatalogItemPage() {
  const params = useParams();
  const router = useRouter();
  const itemId = params?.id as string;

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  // Form fields
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [fulfillmentGroup, setFulfillmentGroup] = useState("");
  const [estimatedDeliveryHours, setEstimatedDeliveryHours] = useState(24);
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    async function loadData() {
      if (!itemId) return;
      setLoading(true);
      setError(null);
      try {
        const [servicesRes, itemRes] = await Promise.all([
          fetch("/api/itsm/admin/services", { cache: "no-store" }),
          fetch(`/api/itsm/admin/service-catalog/${itemId}`, { cache: "no-store" }),
        ]);

        if (!servicesRes.ok) throw new Error("Failed to load services");
        if (!itemRes.ok) {
          if (itemRes.status === 404) throw new Error("Catalog item not found");
          throw new Error("Failed to load catalog item");
        }

        const servicesData = await servicesRes.json();
        const itemData: CatalogItem = await itemRes.json();

        setServices(Array.isArray(servicesData) ? servicesData : []);
        setName(itemData.name || "");
        setSlug(itemData.slug || "");
        setDescription(itemData.description || "");
        setServiceId(itemData.service_id || "");
        setApprovalRequired(itemData.approval_required ?? false);
        setFulfillmentGroup(itemData.fulfillment_group || "");
        setEstimatedDeliveryHours(itemData.estimated_delivery_hours ?? 24);
        setIsActive(itemData.is_active ?? true);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [itemId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Item name is required.");
      return;
    }
    if (!serviceId) {
      setError("Please select a related service.");
      return;
    }

    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/itsm/admin/service-catalog/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          description: description.trim() || null,
          service_id: serviceId,
          approval_required: approvalRequired,
          fulfillment_group: fulfillmentGroup.trim() || null,
          estimated_delivery_hours: Number(estimatedDeliveryHours) || 24,
          is_active: isActive,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.message || `Failed to update catalog item (${res.status})`);
      }

      setSaveSuccess(true);
      setTimeout(() => {
        router.push("/itsm/admin-portal/service-catalog");
        router.refresh();
      }, 700);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred while saving catalog item");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Loader2 className="w-8 h-8 text-[#6D28D9] animate-spin" />
        <p className="text-sm text-[#6B7488]">Loading catalog item details...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl pb-16">
      {/* Back link */}
      <div>
        <Link
          href="/itsm/admin-portal/service-catalog"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7488] hover:text-[#0F1523] transition group"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to Service Catalog
        </Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0F1523]">
          Edit Service Catalog Item
        </h1>
        <p className="text-sm text-[#475069] mt-1">
          Modify catalog offering parameters, linked service, approval requirements, and delivery SLA expectations.
        </p>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm font-medium">{error}</div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {saveSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-3 animate-in fade-in">
          <Check className="w-5 h-5 flex-shrink-0 text-emerald-600" />
          <div className="flex-1 text-sm font-medium">
            Service catalog item updated successfully! Redirecting...
          </div>
        </div>
      )}

      {/* Edit Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white border border-[#E6E9F0] rounded-2xl shadow-sm p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E6E9F0]">
            <div className="w-10 h-10 rounded-xl bg-[#F1ECFE] flex items-center justify-center text-[#6D28D9]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#0F1523]">Item Definition</h2>
              <p className="text-xs text-[#6B7488]">General service specification and metadata</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Item Name */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Item Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Developer Laptop Provisioning, AWS Sandbox Access"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
            </div>

            {/* URL Slug */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                URL Slug
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g., dev-laptop-provisioning"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
              <p className="text-[11px] text-[#6B7488]">Unique URL handle used for self-service requests</p>
            </div>

            {/* Related Service */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Related Service <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  required
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition appearance-none"
                >
                  <option value="" disabled>Select parent service</option>
                  {services.map((svc) => (
                    <option key={svc.id} value={svc.id}>
                      {svc.name}
                    </option>
                  ))}
                </select>
                <Server className="w-4 h-4 text-[#6B7488] absolute right-3.5 top-3 pointer-events-none" />
              </div>
              <p className="text-[11px] text-[#6B7488]">Binds catalog item to ITSM business service hierarchy</p>
            </div>

            {/* Description */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Description
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe who is eligible for this item, what is delivered, and prerequisites..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
            </div>
          </div>
        </div>

        {/* Fulfillment & Governance Section */}
        <div className="bg-white border border-[#E6E9F0] rounded-2xl shadow-sm p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E6E9F0]">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <Check className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#0F1523]">Fulfillment & Approvals</h2>
              <p className="text-xs text-[#6B7488]">Configure routing, SLA delivery targets, and approvals</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Fulfillment Group */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Fulfillment Group
              </label>
              <input
                type="text"
                value={fulfillmentGroup}
                onChange={(e) => setFulfillmentGroup(e.target.value)}
                placeholder="e.g., IT Operations, Cloud Engineering"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
              <p className="text-[11px] text-[#6B7488]">Team or queue tasked with provisioning this request</p>
            </div>

            {/* Estimated Delivery Hours */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Estimated Delivery (Hours)
              </label>
              <input
                type="number"
                min={1}
                max={720}
                value={estimatedDeliveryHours}
                onChange={(e) => setEstimatedDeliveryHours(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
              <p className="text-[11px] text-[#6B7488]">Standard resolution window shown to requesters</p>
            </div>

            {/* Approval Required Toggle */}
            <div className="flex items-start gap-3 p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
              <input
                id="approval-toggle"
                type="checkbox"
                checked={approvalRequired}
                onChange={(e) => setApprovalRequired(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-[#D5D9E2] text-[#6D28D9] focus:ring-[#6D28D9]"
              />
              <label htmlFor="approval-toggle" className="cursor-pointer">
                <span className="block text-sm font-semibold text-[#0F1523]">Approval Required</span>
                <span className="block text-xs text-[#6B7488] mt-0.5">
                  Require manager or process approval before request fulfillment begins
                </span>
              </label>
            </div>

            {/* Active Status Toggle */}
            <div className="flex items-start gap-3 p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
              <input
                id="active-toggle"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-[#D5D9E2] text-[#6D28D9] focus:ring-[#6D28D9]"
              />
              <label htmlFor="active-toggle" className="cursor-pointer">
                <span className="block text-sm font-semibold text-[#0F1523]">Publish in Catalog (Active)</span>
                <span className="block text-xs text-[#6B7488] mt-0.5">
                  Make item visible for users to request immediately
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E6E9F0]">
          <Link
            href="/itsm/admin-portal/service-catalog"
            className="px-5 py-2.5 rounded-xl border border-[#D5D9E2] text-sm font-medium text-[#475069] hover:bg-[#F8FAFC] hover:text-[#0F1523] transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#6D28D9] text-white text-sm font-medium shadow-sm hover:bg-[#5B21B6] transition disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving Changes...
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
