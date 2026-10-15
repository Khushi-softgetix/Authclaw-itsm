"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Database,
  Edit2,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  Upload,
  X,
} from "lucide-react";
import { CIImportModal } from "@/components/itsm/ci-import-modal";
import { CIRelationshipsModal } from "@/components/itsm/ci-relationships-modal";

interface ServiceOption {
  id: string;
  name: string;
}

interface ConfigurationItem {
  id: string;
  name: string;
  ci_type: string;
  service_id: string | null;
  service_name: string | null;
  environment: string;
  status: string;
  external_resource_id: string | null;
  created_at: string;
  updated_at: string;
}

const CI_TYPES = [
  "SERVER",
  "DATABASE",
  "APPLICATION",
  "CLOUD_SERVICE",
  "NETWORK_DEVICE",
  "STORAGE",
  "LOAD_BALANCER",
  "CONTAINER_CLUSTER",
];

const ENVIRONMENTS = ["PRODUCTION", "STAGING", "DEVELOPMENT", "DISASTER_RECOVERY"];

export default function AdminConfigurationItemsPage() {
  const [items, setItems] = useState<ConfigurationItem[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [isCmdbAdmin, setIsCmdbAdmin] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [relationshipsCi, setRelationshipsCi] = useState<ConfigurationItem | null>(null);
  const [editingItem, setEditingItem] = useState<ConfigurationItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("SERVER");
  const [formServiceId, setFormServiceId] = useState<string>("");
  const [formEnv, setFormEnv] = useState("PRODUCTION");
  const [formStatus, setFormStatus] = useState("ACTIVE");
  const [formExtId, setFormExtId] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/itsm/admin/configuration-items", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load configuration items (${res.status})`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load configuration items");
    } finally {
      setLoading(false);
    }
  };

  const fetchServices = async () => {
    try {
      const res = await fetch("/api/itsm/admin/services", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setServices(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load services for CI form:", err);
    }
  };

  useEffect(() => {
    const request = window.setTimeout(() => {
      void fetchItems();
      void fetchServices();
      fetch("/api/auth/session")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.itsmRole === "CMDB_ADMIN" || data?.itsm_role === "CMDB_ADMIN") {
            setIsCmdbAdmin(true);
          }
        })
        .catch(() => {});
    }, 0);
    return () => window.clearTimeout(request);
  }, []);

  const openCreateModal = () => {
    setEditingItem(null);
    setFormName("");
    setFormType("SERVER");
    setFormServiceId("");
    setFormEnv("PRODUCTION");
    setFormStatus("ACTIVE");
    setFormExtId("");
    setModalError(null);
    setModalOpen(true);
  };

  const openEditModal = (item: ConfigurationItem) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormType(item.ci_type);
    setFormServiceId(item.service_id || "");
    setFormEnv(item.environment);
    setFormStatus(item.status);
    setFormExtId(item.external_resource_id || "");
    setModalError(null);
    setModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setModalError("CI name is required");
      return;
    }

    setSaving(true);
    setModalError(null);

    try {
      if (editingItem) {
        const res = await fetch(`/api/itsm/admin/configuration-items/${editingItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            ci_type: formType,
            service_id: formServiceId || null,
            environment: formEnv,
            status: formStatus,
            external_resource_id: formExtId.trim() || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Failed to update CI (${res.status})`);
        }
        const updated = await res.json();
        setItems((prev) => prev.map((ci) => (ci.id === updated.id ? updated : ci)));
      } else {
        const res = await fetch("/api/itsm/admin/configuration-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            ci_type: formType,
            service_id: formServiceId || null,
            environment: formEnv,
            status: formStatus,
            external_resource_id: formExtId.trim() || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Failed to create CI (${res.status})`);
        }
        const created = await res.json();
        setItems((prev) => [...prev, created]);
      }
      setModalOpen(false);
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Failed to save configuration item");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (item: ConfigurationItem) => {
    const newStatus = item.status === "ACTIVE" ? "MAINTENANCE" : "ACTIVE";
    try {
      const res = await fetch(`/api/itsm/admin/configuration-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      const updated = await res.json();
      setItems((prev) => prev.map((ci) => (ci.id === updated.id ? updated : ci)));
    } catch (err) {
      console.error("Failed to toggle CI status:", err);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((ci) => {
      const matchesSearch =
        !searchQuery ||
        ci.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ci.ci_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ci.service_name && ci.service_name.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesType = typeFilter === "ALL" || ci.ci_type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [items, searchQuery, typeFilter]);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Breadcrumb & Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-[#6B7488] mb-1">
          <Link
            href={isCmdbAdmin ? "/itsm/admin-portal/configuration-items" : "/itsm/admin-portal"}
            className="hover:text-[#0E1726]"
          >
            {isCmdbAdmin ? "CMDB Administration" : "Platform Administration"}
          </Link>
          <span>/</span>
          <span className="text-[#0E1726] font-medium">Configuration Items</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#0E1726] tracking-tight">
              Configuration Items (CMDB)
            </h1>
            <p className="text-xs text-[#6B7488] mt-0.5">
              Maintain the core inventory of infrastructure, databases, and application resources.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchItems}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] hover:text-[#0E1726] transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA] hover:text-[#0E1726] transition shadow-xs"
            >
              <Upload className="w-3.5 h-3.5 text-[#6D28D9]" />
              <span>Import CIs</span>
            </button>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold shadow-xs hover:bg-[#5B21B6] transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Configuration Item</span>
            </button>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-[16px] bg-[#FEF2F2] border border-[#FCA5A5] flex items-center justify-between text-xs text-red-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={fetchItems} className="underline font-semibold">
            Retry
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="p-4 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search CIs by name, type, service..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] placeholder-[#8E97A8] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8E97A8] hover:text-[#0E1726]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-[11px] font-semibold text-[#6B7488]">Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
          >
            <option value="ALL">All CI Types</option>
            {CI_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Configuration Items Table */}
      <div className="rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#6D28D9]" />
            <p className="text-xs text-[#6B7488]">Loading configuration items...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Database className="w-8 h-8 text-[#8E97A8] mx-auto opacity-50" />
            <p className="text-xs font-semibold text-[#0E1726]">No configuration items yet</p>
            <p className="text-xs text-[#6B7488]">
              {searchQuery ? "No CIs matched your query." : "Add your first configuration item to the CMDB."}
            </p>
            {!searchQuery && (
              <button
                onClick={openCreateModal}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Configuration Item</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E6E9F0] bg-[#FBFAF9] text-[11px] font-bold text-[#6B7488] uppercase tracking-wider">
                  <th className="py-3 px-4">CI Name</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Environment</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F2F5]">
                {filteredItems.map((ci) => (
                  <tr key={ci.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-[#0E1726]">
                      {ci.name}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-[#475069]">
                      <span className="px-2 py-0.5 rounded-md bg-[#F1ECFE] text-[#6D28D9] font-medium">
                        {ci.ci_type}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-[#475069]">
                      {ci.service_name ? (
                        <span className="inline-flex items-center gap-1">
                          <Server className="w-3 h-3 text-[#6D28D9]" />
                          <span>{ci.service_name}</span>
                        </span>
                      ) : (
                        <span className="text-[#9CA3AF] italic">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-[11px] text-[#6B7488]">
                      {ci.environment}
                    </td>
                    <td className="py-3.5 px-4">
                      {ci.status === "ACTIVE" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#059669]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                          Active
                        </span>
                      ) : ci.status === "MAINTENANCE" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#D97706]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
                          Maintenance
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#9CA3AF]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />
                          {ci.status}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => setRelationshipsCi(ci)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:text-[#6D28D9] hover:bg-[#F1ECFE]/30 transition"
                        title="Manage upstream and downstream relationships"
                      >
                        <GitBranch className="w-3 h-3 text-[#6D28D9]" />
                        <span>Relationships</span>
                      </button>
                      <button
                        onClick={() => openEditModal(ci)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleStatus(ci)}
                        className="inline-flex items-center px-2.5 py-1 rounded-md border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:text-[#6D28D9] hover:bg-[#F1ECFE]/30 transition"
                      >
                        Toggle Status
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit CI Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[20px] border border-[#E6E9F0] bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-[#E6E9F0] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0E1726]">
                {editingItem ? "Edit Configuration Item" : "Add Configuration Item"}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-[#8E97A8] hover:text-[#0E1726]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="p-6 space-y-4 text-xs">
              {modalError && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FCA5A5] text-red-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{modalError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  CI Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. prod-db-primary, api-gateway-cluster"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                    CI Type *
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                  >
                    {CI_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                    Environment
                  </label>
                  <select
                    value={formEnv}
                    onChange={(e) => setFormEnv(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                  >
                    {ENVIRONMENTS.map((env) => (
                      <option key={env} value={env}>
                        {env}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  Associated Service (optional)
                </label>
                <select
                  value={formServiceId}
                  onChange={(e) => setFormServiceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                >
                  <option value="">No service associated</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  Status
                </label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="MAINTENANCE">MAINTENANCE</option>
                  <option value="RETIRED">RETIRED</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  External Resource Identifier (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. arn:aws:rds:us-east-1:..., i-0123456789abcdef0"
                  value={formExtId}
                  onChange={(e) => setFormExtId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#F5F7FA]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingItem ? "Save Changes" : "Add CI"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CI Import Modal (CMDB-005) */}
      <CIImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImportComplete={fetchItems}
      />

      {/* CI Relationships Modal (CMDB-002) */}
      <CIRelationshipsModal
        isOpen={!!relationshipsCi}
        onClose={() => setRelationshipsCi(null)}
        ci={relationshipsCi}
        availableCIs={items}
      />
    </div>
  );
}
