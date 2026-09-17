"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Edit2,
  Layers,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";

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

export default function ServiceCatalogAdminPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/itsm/admin/service-catalog", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load service catalog (${res.status})`);
      }
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load service catalog");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleToggleStatus = async (item: CatalogItem) => {
    setTogglingId(item.id);
    try {
      const res = await fetch(`/api/itsm/admin/service-catalog/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      if (!res.ok) {
        throw new Error(`Failed to toggle catalog item status (${res.status})`);
      }
      const updated = await res.json();
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to toggle status");
    } finally {
      setTogglingId(null);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        item.name.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.service_name && item.service_name.toLowerCase().includes(q)) ||
        (item.fulfillment_group && item.fulfillment_group.toLowerCase().includes(q));

      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" && item.is_active) ||
        (statusFilter === "INACTIVE" && !item.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [items, searchQuery, statusFilter]);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#6B7488] mb-1">
            <Link href="/itsm/admin-portal" className="hover:text-[#0E1726]">
              Platform Administration
            </Link>
            <span>/</span>
            <span className="text-[#0E1726] font-medium">Service Catalog</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#EEF2FF] border border-[#C7D2FE] flex items-center justify-center text-[#4F46E5]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#0E1726]">Service Catalog Administration</h1>
              <p className="text-xs text-[#6B7488]">
                Manage services, intake templates, and approval requirements available in the employee portal.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchItems}
            disabled={loading}
            className="p-2 rounded-lg border border-[#E6E9F0] bg-white text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition disabled:opacity-50"
            title="Refresh catalog list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <Link
            href="/itsm/admin-portal/service-catalog/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Catalog Item</span>
          </Link>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] flex items-center gap-3 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p className="flex-1 font-medium">{error}</p>
          <button
            onClick={fetchItems}
            className="underline text-xs font-bold hover:text-red-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-2xl border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)]">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#A8B0C0]" />
          <input
            type="text"
            placeholder="Search items, services, fulfillment groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[#E6E9F0] bg-[#F9FAFB] text-xs text-[#0E1726] placeholder-[#A8B0C0] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <span className="text-[11px] font-semibold text-[#6B7488] uppercase tracking-wider">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#475069] focus:outline-none focus:border-[#6D28D9]"
          >
            <option value="ALL">All Items</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </select>
        </div>
      </div>

      {/* Table Container */}
      <div className="rounded-2xl border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-[#6B7488]">
            <Loader2 className="w-6 h-6 animate-spin text-[#6D28D9]" />
            <p className="text-xs font-medium">Loading catalog items...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-20 px-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#EEF2FF] border border-[#C7D2FE] flex items-center justify-center mx-auto text-[#4F46E5]">
              <Layers className="w-6 h-6" />
            </div>
            <div className="max-w-md mx-auto">
              <h3 className="text-base font-bold text-[#0E1726]">No catalog items yet</h3>
              <p className="text-xs text-[#6B7488] mt-1">
                {items.length === 0
                  ? "Define items in your service catalog that employees can request."
                  : "No catalog items matched your filter criteria."}
              </p>
            </div>
            {items.length === 0 && (
              <Link
                href="/itsm/admin-portal/service-catalog/new"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Create Catalog Item</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#0E1726]">
              <thead className="bg-[#F8FAFC] border-b border-[#E6E9F0] text-[11px] font-semibold text-[#6B7488] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Related Service</th>
                  <th className="py-3 px-4">Approval</th>
                  <th className="py-3 px-4">Fulfillment Group</th>
                  <th className="py-3 px-4">Estimated Delivery</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F2F6]">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-[#F9FAFB] transition">
                    <td className="py-3 px-4 font-semibold text-[#0E1726]">
                      <div className="flex flex-col">
                        <span>{item.name}</span>
                        <span className="text-[10px] text-[#8C95A8] font-mono">{item.slug}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 max-w-xs text-[#475069] truncate">
                      {item.description || "—"}
                    </td>
                    <td className="py-3 px-4">
                      {item.service_name ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                          {item.service_name}
                        </span>
                      ) : (
                        <span className="text-[#8C95A8]">None</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {item.approval_required ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                          Required
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#6B7488]">Auto-Approved</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[#475069]">
                      {item.fulfillment_group || "—"}
                    </td>
                    <td className="py-3 px-4 text-[#475069]">
                      {item.estimated_delivery_hours}h
                    </td>
                    <td className="py-3 px-4">
                      {item.is_active ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 bg-gray-100 border border-gray-300 px-2 py-0.5 rounded-full">
                          <XCircle className="w-3 h-3" />
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          href={`/itsm/admin-portal/service-catalog/${item.id}`}
                          className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#475069] hover:text-[#6D28D9] hover:bg-[#F1ECFE] hover:border-[#DDD6FE] transition"
                          title="Edit Catalog Item"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          onClick={() => handleToggleStatus(item)}
                          disabled={togglingId === item.id}
                          className={`p-1.5 rounded-lg border transition ${
                            item.is_active
                              ? "border-[#E6E9F0] text-[#6B7488] hover:text-amber-700 hover:bg-amber-50 hover:border-amber-200"
                              : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          }`}
                          title={item.is_active ? "Disable Item" : "Enable Item"}
                        >
                          {togglingId === item.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Power className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
