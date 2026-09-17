"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

export default function CreateServiceCatalogItemPage() {
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);

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

  useEffect(() => {
    async function loadServices() {
      try {
        const res = await fetch("/api/itsm/admin/services", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load services");
        const data = await res.json();
        setServices(Array.isArray(data) ? data : []);
        if (data.length > 0) {
          setServiceId(data[0].id);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load services");
      } finally {
        setLoadingServices(false);
      }
    }
    loadServices();
  }, []);

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

    try {
      const res = await fetch("/api/itsm/admin/service-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          description: description.trim() || undefined,
          service_id: serviceId,
          approval_required: approvalRequired,
          fulfillment_group: fulfillmentGroup.trim() || undefined,
          estimated_delivery_hours: Number(estimatedDeliveryHours) || 24,
          is_active: isActive,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.message || `Failed to create catalog item (${res.status})`);
      }

      router.push("/itsm/admin-portal/service-catalog");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred while creating catalog item");
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Back Link */}
      <div>
        <Link
          href="/itsm/admin-portal/service-catalog"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] transition mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Service Catalog</span>
        </Link>
        <h1 className="text-2xl font-bold text-[#0E1726]">Create Catalog Item</h1>
        <p className="text-xs text-[#6B7488] mt-0.5">
          Configure a requestable service item for the employee service catalog.
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] flex items-center gap-3 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      {/* Form Card */}
      <form
        onSubmit={handleSubmit}
        className="p-6 rounded-2xl border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-5"
      >
        {/* Name */}
        <div>
          <label className="block text-xs font-bold text-[#0E1726] mb-1">
            Item Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Standard Developer Laptop Request"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
          />
        </div>

        {/* Slug */}
        <div>
          <label className="block text-xs font-bold text-[#0E1726] mb-1">
            Slug / URL Identifier
          </label>
          <input
            type="text"
            placeholder="auto-generated-if-empty"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] text-xs text-[#0E1726] font-mono focus:outline-none focus:border-[#6D28D9]"
          />
          <p className="text-[11px] text-[#8C95A8] mt-1">
            Unique machine identifier within your tenant. Leave blank to generate from name.
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-bold text-[#0E1726] mb-1">
            Description
          </label>
          <textarea
            rows={3}
            placeholder="Explain what this item provides, prerequisites, and fulfillment expectations..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
          />
        </div>

        {/* Related Service */}
        <div>
          <label className="block text-xs font-bold text-[#0E1726] mb-1">
            Related Service <span className="text-red-500">*</span>
          </label>
          {loadingServices ? (
            <div className="flex items-center gap-2 text-xs text-[#6B7488]">
              <Loader2 className="w-4 h-4 animate-spin text-[#6D28D9]" />
              <span>Loading services...</span>
            </div>
          ) : services.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
              No services found. Please create a service first under Platform Administration → Services.
            </p>
          ) : (
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] text-xs text-[#0E1726] bg-white focus:outline-none focus:border-[#6D28D9]"
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Fulfillment Group */}
          <div>
            <label className="block text-xs font-bold text-[#0E1726] mb-1">
              Fulfillment Group
            </label>
            <input
              type="text"
              placeholder="e.g. IT Operations / Workstation Team"
              value={fulfillmentGroup}
              onChange={(e) => setFulfillmentGroup(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
            />
          </div>

          {/* Estimated Delivery Time */}
          <div>
            <label className="block text-xs font-bold text-[#0E1726] mb-1">
              Estimated Delivery (Hours)
            </label>
            <input
              type="number"
              min={1}
              value={estimatedDeliveryHours}
              onChange={(e) => setEstimatedDeliveryHours(parseInt(e.target.value) || 24)}
              className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="pt-3 border-t border-[#F0F2F6] space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={approvalRequired}
              onChange={(e) => setApprovalRequired(e.target.checked)}
              className="w-4 h-4 rounded text-[#6D28D9] border-gray-300 focus:ring-[#6D28D9]"
            />
            <div>
              <span className="text-xs font-bold text-[#0E1726] block">Manager / Lead Approval Required</span>
              <span className="text-[11px] text-[#6B7488] block">
                If checked, service requests created from this item must be approved before fulfillment.
              </span>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded text-[#6D28D9] border-gray-300 focus:ring-[#6D28D9]"
            />
            <div>
              <span className="text-xs font-bold text-[#0E1726] block">Item Active</span>
              <span className="text-[11px] text-[#6B7488] block">
                Active items appear in the requester self-service catalog.
              </span>
            </div>
          </label>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-[#F0F2F6] flex items-center justify-end gap-3">
          <Link
            href="/itsm/admin-portal/service-catalog"
            className="px-4 py-2 rounded-lg border border-[#E6E9F0] text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA] transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving || loadingServices || services.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition shadow-sm disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Creating...</span>
              </>
            ) : (
              <span>Create Catalog Item</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
