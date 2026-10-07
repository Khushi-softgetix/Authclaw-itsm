"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  Edit2,
  FileCheck,
  Filter,
  Layers,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
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
  intake_schema?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ITSMServiceOption {
  id: string;
  name: string;
}

export default function CatalogStudioPage() {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [services, setServices] = useState<ITSMServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [serviceFilter, setServiceFilter] = useState("ALL");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("ALL");
  const [approvalFilter, setApprovalFilter] = useState("ALL");

  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Fetch Catalog Items using BFF
  const fetchCatalogItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (statusFilter === "ACTIVE") params.set("is_active", "true");
      if (statusFilter === "INACTIVE") params.set("is_active", "false");
      if (serviceFilter !== "ALL") params.set("service_id", serviceFilter);
      if (fulfillmentFilter !== "ALL") params.set("fulfillment_group", fulfillmentFilter);
      if (approvalFilter === "YES") params.set("approval_required", "true");
      if (approvalFilter === "NO") params.set("approval_required", "false");

      const queryStr = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/itsm/admin/service-catalog${queryStr}`, { cache: "no-store" });

      if (res.status === 401) {
        router.push("/itsm/login");
        return;
      }
      if (res.status === 403) {
        setError("You do not have permission to manage the Service Catalog.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || `Failed to load catalog offerings (${res.status})`);
      }

      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load catalog offerings");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, serviceFilter, fulfillmentFilter, approvalFilter, router]);

  // Fetch Parent Services for filter dropdown
  useEffect(() => {
    async function loadServices() {
      try {
        const res = await fetch("/api/itsm/services", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setServices(data.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
          }
        }
      } catch {
        // Non-blocking
      }
    }
    loadServices();
  }, []);

  useEffect(() => {
    fetchCatalogItems();
  }, [fetchCatalogItems]);

  // Toggle active status
  const handleToggleStatus = async (item: CatalogItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setTogglingId(item.id);
    try {
      const res = await fetch(`/api/itsm/admin/service-catalog/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      if (!res.ok) {
        throw new Error(`Failed to toggle offering status (${res.status})`);
      }
      const updated = await res.json();
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to toggle status");
    } finally {
      setTogglingId(null);
    }
  };

  // Extract unique fulfillment groups for filter dropdown
  const uniqueFulfillmentGroups = useMemo(() => {
    const groups = new Set<string>();
    items.forEach((it) => {
      if (it.fulfillment_group && it.fulfillment_group.trim()) {
        groups.add(it.fulfillment_group.trim());
      }
    });
    return Array.from(groups).sort();
  }, [items]);

  // Summary Metrics based solely on real database attributes
  const totalCount = items.length;
  const activeCount = items.filter((it) => it.is_active).length;
  const inactiveCount = items.filter((it) => !it.is_active).length;
  const needsAttentionCount = items.filter((it) => !it.fulfillment_group || !it.fulfillment_group.trim()).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6" id="catalog-studio-container">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#6B7488]">Catalog Management</span>
            <span className="text-[#A8B0C0]">/</span>
            <span className="text-xs font-bold text-[#6D28D9]">Catalog Studio</span>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <div className="w-10 h-10 rounded-xl bg-[#F1ECFE] text-[#6D28D9] flex items-center justify-center font-bold">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight" id="catalog-studio-title">
                Catalog Studio
              </h1>
              <p className="text-xs text-[#6B7488]">
                Manage the services, products, and request offerings available to employees.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => fetchCatalogItems()}
            disabled={loading}
            className="p-2.5 rounded-xl border border-[#E6E9F0] bg-white text-[#6B7488] hover:text-[#0E1726] hover:bg-slate-50 transition shadow-xs disabled:opacity-50"
            title="Refresh catalog list"
            id="refresh-catalog-btn"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <Link
            href="/itsm/catalog-manager/studio/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs"
            id="create-catalog-item-btn"
          >
            <Plus className="w-4 h-4" />
            <span>Create Catalog Item</span>
          </Link>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="catalog-metrics-grid">
        {/* Total Offerings */}
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-[#6B7488]">
            <span className="text-[10px] font-bold uppercase tracking-wider">Total Offerings</span>
            <Boxes className="w-4 h-4 text-[#6D28D9]" />
          </div>
          <div className="text-2xl font-extrabold text-[#0E1726]" id="metric-total-offerings">
            {totalCount}
          </div>
          <p className="text-[11px] text-[#6B7488]">Published and retired items</p>
        </div>

        {/* Active Offerings */}
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-emerald-600">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">Active</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-700" id="metric-active-offerings">
            {activeCount}
          </div>
          <p className="text-[11px] text-[#6B7488]">Available in requester portal</p>
        </div>

        {/* Inactive Offerings */}
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">Inactive / Disabled</span>
            <XCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-slate-700" id="metric-inactive-offerings">
            {inactiveCount}
          </div>
          <p className="text-[11px] text-[#6B7488]">Hidden from employee portal</p>
        </div>

        {/* Needs Attention */}
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-amber-600">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">Needs Attention</span>
            <AlertCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-amber-700" id="metric-needs-attention">
            {needsAttentionCount}
          </div>
          <p className="text-[11px] text-[#6B7488]">Missing fulfillment group</p>
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 flex items-center justify-between text-red-700 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => fetchCatalogItems()} className="font-bold underline hover:text-red-900">
            Retry
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-[#A8B0C0]" />
            <input
              type="text"
              placeholder="Search catalog items, descriptions, fulfillment groups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-[#E6E9F0] bg-[#F9FAFB] text-xs text-[#0E1726] placeholder-[#A8B0C0] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
              id="catalog-search-input"
            />
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-semibold text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
                id="catalog-status-filter"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>
            </div>

            {/* Service Filter */}
            {services.length > 0 && (
              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-semibold text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
                id="catalog-service-filter"
              >
                <option value="ALL">All Parent Services</option>
                {services.map((svc) => (
                  <option key={svc.id} value={svc.id}>
                    {svc.name}
                  </option>
                ))}
              </select>
            )}

            {/* Fulfillment Team Filter */}
            {uniqueFulfillmentGroups.length > 0 && (
              <select
                value={fulfillmentFilter}
                onChange={(e) => setFulfillmentFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-semibold text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
                id="catalog-fulfillment-filter"
              >
                <option value="ALL">All Fulfillment Teams</option>
                {uniqueFulfillmentGroups.map((grp) => (
                  <option key={grp} value={grp}>
                    {grp}
                  </option>
                ))}
              </select>
            )}

            {/* Approval Filter */}
            <select
              value={approvalFilter}
              onChange={(e) => setApprovalFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-semibold text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
              id="catalog-approval-filter"
            >
              <option value="ALL">All Approvals</option>
              <option value="YES">Approval Required</option>
              <option value="NO">No Approval Needed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Catalog Offerings Table */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-[#6B7488]">
            <Loader2 className="w-6 h-6 animate-spin text-[#6D28D9]" />
            <p className="text-xs font-semibold">Loading catalog offerings...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 px-6 text-center space-y-4" id="catalog-empty-state">
            <div className="w-14 h-14 rounded-2xl bg-[#F1ECFE] text-[#6D28D9] flex items-center justify-center mx-auto">
              <Boxes className="w-7 h-7" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h3 className="text-base font-extrabold text-[#0E1726]">
                {searchQuery || statusFilter !== "ALL" || serviceFilter !== "ALL" || fulfillmentFilter !== "ALL" || approvalFilter !== "ALL"
                  ? "No catalog items match your search"
                  : "No catalog offerings yet"}
              </h3>
              <p className="text-xs text-[#6B7488] leading-relaxed">
                {searchQuery || statusFilter !== "ALL" || serviceFilter !== "ALL" || fulfillmentFilter !== "ALL" || approvalFilter !== "ALL"
                  ? "Try adjusting your search terms or filters to find offerings."
                  : "Create your first offering to make it available for employee requests in the Requester Portal."}
              </p>
            </div>
            <div>
              {searchQuery || statusFilter !== "ALL" || serviceFilter !== "ALL" || fulfillmentFilter !== "ALL" || approvalFilter !== "ALL" ? (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("ALL");
                    setServiceFilter("ALL");
                    setFulfillmentFilter("ALL");
                    setApprovalFilter("ALL");
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#0E1726] hover:bg-slate-50 transition shadow-xs"
                >
                  Clear Filters
                </button>
              ) : (
                <Link
                  href="/itsm/catalog-manager/studio/new"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Catalog Item</span>
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs" id="catalog-items-table">
              <thead>
                <tr className="border-b border-[#E6E9F0] bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">
                  <th className="py-3 px-4">Catalog Item</th>
                  <th className="py-3 px-4">Parent Service</th>
                  <th className="py-3 px-4">Fulfillment Group</th>
                  <th className="py-3 px-4">Approval</th>
                  <th className="py-3 px-4">Est. Delivery</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E9F0]">
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-[#F9FAFB] transition cursor-pointer group"
                    onClick={() => router.push(`/itsm/catalog-manager/studio/${item.id}`)}
                  >
                    {/* Item Name & Slug */}
                    <td className="py-3.5 px-4">
                      <div className="space-y-0.5">
                        <span className="font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition-colors block text-xs">
                          {item.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-[#A8B0C0]">/{item.slug}</span>
                          <span className="text-[10px] text-[#6B7488]">v{item.version}</span>
                        </div>
                        {item.description && (
                          <p className="text-[11px] text-[#6B7488] line-clamp-1 max-w-sm mt-0.5">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Parent Service */}
                    <td className="py-3.5 px-4 text-[#475069] font-medium">
                      {item.service_name || "Unassigned"}
                    </td>

                    {/* Fulfillment Group */}
                    <td className="py-3.5 px-4">
                      {item.fulfillment_group ? (
                        <span className="font-medium text-[#0E1726]">{item.fulfillment_group}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          <AlertCircle className="w-3 h-3" />
                          <span>No team assigned</span>
                        </span>
                      )}
                    </td>

                    {/* Approval */}
                    <td className="py-3.5 px-4">
                      {item.approval_required ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-[#6D28D9] border border-purple-200 text-[10px] font-bold">
                          <ShieldAlert className="w-3 h-3" />
                          <span>Required</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200 text-[10px] font-medium">
                          <CheckCircle2 className="w-3 h-3 text-slate-400" />
                          <span>Standard</span>
                        </span>
                      )}
                    </td>

                    {/* Est Delivery */}
                    <td className="py-3.5 px-4 text-[#475069] font-medium">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#A8B0C0]" />
                        <span>{item.estimated_delivery_hours}h</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        onClick={(e) => handleToggleStatus(item, e)}
                        disabled={togglingId === item.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${
                          item.is_active
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                            : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
                        }`}
                        title="Click to toggle active status"
                      >
                        <Power className={`w-3 h-3 ${item.is_active ? "text-emerald-600" : "text-slate-400"}`} />
                        <span>{item.is_active ? "Active" : "Inactive"}</span>
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/itsm/catalog-manager/form-builder?item=${item.id}`}
                          className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#6D28D9] hover:bg-[#F1ECFE] hover:border-[#A78BFA] transition"
                          title="Configure Form"
                        >
                          <FileCheck className="w-3.5 h-3.5" />
                        </Link>
                        <Link
                          href={`/itsm/catalog-manager/studio/${item.id}?mode=edit`}
                          className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#475069] hover:text-[#0E1726] hover:bg-slate-100 transition"
                          title="Edit Offering"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Link>
                        <Link
                          href={`/itsm/catalog-manager/studio/${item.id}`}
                          className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#475069] hover:text-[#0E1726] hover:bg-slate-100 transition"
                          title="View Details"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
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
