"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiErrorMessage } from "@/lib/errors";
import {
  AlertCircle,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  UsersRound,
  X,
} from "lucide-react";

interface Service {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  tier: string;
  status: string;
  alert_recipient_scope: "SERVICE_ENTITLEMENTS" | "ALL_REQUESTERS";
  owner_user_id: string | null;
  escalation_team: string | null;
  created_at: string;
  updated_at: string;
}

interface AlertTargeting {
  service_id: string;
  alert_recipient_scope: "SERVICE_ENTITLEMENTS" | "ALL_REQUESTERS";
  active_requester_count: number;
  entitled_requester_count: number;
  eligible_requester_count: number;
  teams: Array<{ id: string; name: string; selected: boolean }>;
}

export default function AdminServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTier, setFormTier] = useState("TIER_2");
  const [formStatus, setFormStatus] = useState("OPERATIONAL");
  const [alertRecipientScope, setAlertRecipientScope] = useState<"SERVICE_ENTITLEMENTS" | "ALL_REQUESTERS">("SERVICE_ENTITLEMENTS");
  const [formEscalationTeam, setFormEscalationTeam] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [targeting, setTargeting] = useState<AlertTargeting | null>(null);
  const [supportTeamIds, setSupportTeamIds] = useState<string[]>([]);
  const [teamSearch, setTeamSearch] = useState("");

  const fetchServices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/itsm/admin/services", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load services (${res.status})`);
      }
      const data = await res.json();
      setServices(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load services");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const request = window.setTimeout(() => void fetchServices(), 0);
    return () => window.clearTimeout(request);
  }, []);

  const openCreateModal = () => {
    setEditingService(null);
    setFormName("");
    setFormSlug("");
    setFormDesc("");
    setFormTier("TIER_2");
    setFormStatus("OPERATIONAL");
    setAlertRecipientScope("SERVICE_ENTITLEMENTS");
    setFormEscalationTeam("");
    setModalError(null);
    setTargeting(null);
    setSupportTeamIds([]);
    setTeamSearch("");
    setModalOpen(true);
  };

  const openEditModal = (srv: Service) => {
    setEditingService(srv);
    setFormName(srv.name);
    setFormSlug(srv.slug);
    setFormDesc(srv.description || "");
    setFormTier(srv.tier || "TIER_2");
    setFormStatus(srv.status || "OPERATIONAL");
    setAlertRecipientScope(srv.alert_recipient_scope || "SERVICE_ENTITLEMENTS");
    setFormEscalationTeam(srv.escalation_team || "");
    setModalError(null);
    setTargeting(null);
    fetch(`/api/itsm/outage-alerts/services/${srv.id}/targeting`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Alert targeting could not be loaded");
        const data: AlertTargeting = await response.json();
        setTargeting(data);
        setAlertRecipientScope(data.alert_recipient_scope);
        setSupportTeamIds(data.teams.filter((item) => item.selected).map((item) => item.id));
      })
      .catch((reason) => setModalError(reason instanceof Error ? reason.message : "Alert targeting could not be loaded"));
    setModalOpen(true);
  };

  const syncAlertTargeting = async (serviceId: string) => {
    if (!targeting) return;
    const originalTeams = new Set(targeting.teams.filter((item) => item.selected).map((item) => item.id));
    const nextTeams = new Set(supportTeamIds);
    const requests: Promise<Response>[] = [];
    for (const teamId of new Set([...originalTeams, ...nextTeams])) {
      if (originalTeams.has(teamId) === nextTeams.has(teamId)) continue;
      requests.push(fetch(`/api/itsm/outage-alerts/services/${serviceId}/support-teams/${teamId}`, nextTeams.has(teamId) ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team_id: teamId }) } : { method: "DELETE" }));
    }
    const responses = await Promise.all(requests);
    if (responses.some((response) => !response.ok)) throw new Error("Service saved, but one or more alert audience relationships could not be updated");
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setModalError("Service name is required");
      return;
    }

    setSaving(true);
    setModalError(null);

    try {
      if (editingService) {
        const res = await fetch(`/api/itsm/admin/services/${editingService.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            description: formDesc.trim() || null,
            tier: formTier,
            status: formStatus,
            alert_recipient_scope: alertRecipientScope,
            escalation_team: formEscalationTeam.trim() || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(apiErrorMessage(err, `Failed to update service (${res.status})`));
        }
        const updated = await res.json();
        await syncAlertTargeting(editingService.id);
        setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        const res = await fetch("/api/itsm/admin/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            slug: formSlug.trim() || undefined,
            description: formDesc.trim() || null,
            tier: formTier,
            status: formStatus,
            alert_recipient_scope: alertRecipientScope,
            escalation_team: formEscalationTeam.trim() || null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(apiErrorMessage(err, `Failed to create service (${res.status})`));
        }
        const created = await res.json();
        setServices((prev) => [...prev, created]);
      }
      setModalOpen(false);
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Failed to save service");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (srv: Service) => {
    const newStatus = srv.status === "OPERATIONAL" ? "DEGRADED" : "OPERATIONAL";
    try {
      const res = await fetch(`/api/itsm/admin/services/${srv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      const updated = await res.json();
      setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      console.error("Failed to toggle service status:", err);
    }
  };

  const filteredServices = useMemo(() => {
    return services.filter(
      (s) =>
        !searchQuery ||
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [services, searchQuery]);

  const filteredTargetTeams = useMemo(() => {
    if (!targeting) return [];
    const normalized = teamSearch.trim().toLowerCase();
    if (!normalized) return targeting.teams;
    return targeting.teams.filter((team) => team.name.toLowerCase().includes(normalized));
  }, [targeting, teamSearch]);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Breadcrumb & Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-[#6B7488] mb-1">
          <Link href="/itsm/admin-portal" className="hover:text-[#0E1726]">
            Platform Administration
          </Link>
          <span>/</span>
          <span className="text-[#0E1726] font-medium">Services</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#0E1726] tracking-tight">Services</h1>
            <p className="text-xs text-[#6B7488] mt-0.5">
              Manage business and technical services for incident classification and routing.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchServices}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] hover:text-[#0E1726] transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold shadow-xs hover:bg-[#5B21B6] transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Service</span>
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
          <button onClick={fetchServices} className="underline font-semibold">
            Retry
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="p-4 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex items-center justify-between">
        <div className="relative w-full max-w-xs">
          <Search className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search services..."
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
      </div>

      {/* Services Table */}
      <div className="rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#6D28D9]" />
            <p className="text-xs text-[#6B7488]">Loading services...</p>
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Server className="w-8 h-8 text-[#8E97A8] mx-auto opacity-50" />
            <p className="text-xs font-semibold text-[#0E1726]">No services yet</p>
            <p className="text-xs text-[#6B7488]">
              {searchQuery ? "No services matched your query." : "Define your first service catalog entity."}
            </p>
            {!searchQuery && (
              <button
                onClick={openCreateModal}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Service</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E6E9F0] bg-[#FBFAF9] text-[11px] font-bold text-[#6B7488] uppercase tracking-wider">
                  <th className="py-3 px-4">Service Name</th>
                  <th className="py-3 px-4">Slug</th>
                  <th className="py-3 px-4">Tier</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Escalation Team</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F2F5]">
                {filteredServices.map((srv) => (
                  <tr key={srv.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-[#0E1726]">
                      {srv.name}
                    </td>
                    <td className="py-3.5 px-4 text-[#6B7488] font-mono text-[11px]">
                      {srv.slug}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#F1ECFE] text-[#6D28D9] border border-[#DDD6FE]">
                        {srv.tier}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {srv.status === "OPERATIONAL" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#059669]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                          Operational
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#D97706]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
                          {srv.status}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-[#475069]">
                      {srv.escalation_team || "—"}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => openEditModal(srv)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleStatus(srv)}
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

      {/* Create / Edit Service Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 backdrop-blur-xs sm:p-6">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[20px] border border-[#E6E9F0] bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex shrink-0 items-center justify-between border-b border-[#E6E9F0] px-5 py-4 sm:px-6">
              <h3 className="text-sm font-bold text-[#0E1726]">
                {editingService ? "Edit Service" : "Create Service"}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-[#8E97A8] hover:text-[#0E1726]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveService} className="flex min-h-0 flex-1 flex-col text-xs">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
              {modalError && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FCA5A5] text-red-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{modalError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  Service Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. User Authentication Service"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                />
              </div>

              {!editingService && (
                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                    Slug (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Auto-generated if empty"
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Service purpose and customer impact..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                    Tier
                  </label>
                  <select
                    value={formTier}
                    onChange={(e) => setFormTier(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                  >
                    <option value="TIER_1">Tier 1 (Mission-Critical)</option>
                    <option value="TIER_2">Tier 2 (Core Business)</option>
                    <option value="TIER_3">Tier 3 (Supporting)</option>
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
                    <option value="OPERATIONAL">OPERATIONAL</option>
                    <option value="DEGRADED">DEGRADED</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                    <option value="RETIRED">RETIRED</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  Escalation Team (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Infrastructure, Security Ops"
                  value={formEscalationTeam}
                  onChange={(e) => setFormEscalationTeam(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                />
              </div>

              <section className="overflow-hidden rounded-xl border border-[#E1E5ED] bg-white">
                <div className="flex items-start gap-3 border-b border-[#E6E9F0] bg-[#FAF9FF] px-4 py-3.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EDE9FE] text-[#6D28D9]">
                    <UsersRound className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-[#0E1726]">Alert recipient sources</h4>
                    <p className="mt-0.5 text-[11px] leading-4 text-[#6B7488]">
                      Define who uses and supports this service. Incident Managers choose the audience when publishing an alert.
                    </p>
                  </div>
                </div>

                <div className="space-y-5 p-4">
                  <fieldset>
                    <legend className="text-[11px] font-semibold text-[#303A50]">Service users</legend>
                    <p className="mt-0.5 text-[10px] leading-4 text-[#6B7488]">Choose how eligible users are identified for this service.</p>
                    <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
                      <label className={`flex h-full cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition ${alertRecipientScope === "ALL_REQUESTERS" ? "border-[#7C3AED] bg-[#FAF7FF] shadow-[0_0_0_1px_#7C3AED]" : "border-[#E1E5ED] bg-white hover:border-[#C4B5FD]"}`}>
                        <input type="radio" name="alert-recipient-scope" value="ALL_REQUESTERS" checked={alertRecipientScope === "ALL_REQUESTERS"} onChange={() => setAlertRecipientScope("ALL_REQUESTERS")} className="mt-0.5 h-4 w-4 shrink-0 accent-[#6D28D9]" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-xs font-semibold text-[#0E1726]">Company-wide service</span>
                          <span className="mt-1 text-[11px] leading-4 text-[#6B7488]">All active employee portal users are eligible. Best for shared services such as email or Wi-Fi.</span>
                          {targeting ? <span className="mt-3 inline-flex w-fit rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[10px] font-semibold text-[#6D28D9]">{targeting.active_requester_count} eligible users</span> : null}
                        </span>
                      </label>
                      <label className={`flex h-full cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition ${alertRecipientScope === "SERVICE_ENTITLEMENTS" ? "border-[#7C3AED] bg-[#FAF7FF] shadow-[0_0_0_1px_#7C3AED]" : "border-[#E1E5ED] bg-white hover:border-[#C4B5FD]"}`}>
                        <input type="radio" name="alert-recipient-scope" value="SERVICE_ENTITLEMENTS" checked={alertRecipientScope === "SERVICE_ENTITLEMENTS"} onChange={() => setAlertRecipientScope("SERVICE_ENTITLEMENTS")} className="mt-0.5 h-4 w-4 shrink-0 accent-[#6D28D9]" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-xs font-semibold text-[#0E1726]">Access-controlled service</span>
                          <span className="mt-1 text-[11px] leading-4 text-[#6B7488]">Only people with active access are eligible. Best for restricted business applications.</span>
                          {targeting ? <span className="mt-3 inline-flex w-fit rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[10px] font-semibold text-[#6D28D9]">{targeting.entitled_requester_count} linked users</span> : null}
                        </span>
                      </label>
                    </div>
                    {targeting && alertRecipientScope === "SERVICE_ENTITLEMENTS" && targeting.entitled_requester_count === 0 ? (
                      <p className="mt-3 rounded-lg border border-[#FED7AA] bg-[#FFF7ED] px-3 py-2 text-[11px] leading-4 text-[#9A3412]">
                        No users are linked yet. Service-user alerts will have no recipients until access records are available.
                      </p>
                    ) : null}
                  </fieldset>

                  {editingService ? (
                    !targeting ? <p className="border-t border-[#E6E9F0] pt-4 text-[11px] text-[#6B7488]">Loading service relationships…</p> : (
                      <fieldset className="border-t border-[#E6E9F0] pt-4">
                        <legend className="sr-only">Support teams</legend>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[11px] font-semibold text-[#303A50]">Support teams</p>
                            <p className="mt-0.5 text-[10px] leading-4 text-[#6B7488]">Agents in selected teams become eligible when the alert audience includes Service Agents.</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-[#EDE9FE] px-2 py-1 text-[10px] font-semibold text-[#6D28D9]">{supportTeamIds.length} selected</span>
                        </div>
                        <div className="relative mt-3">
                          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8E97A8]" />
                          <input type="search" value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Search support teams" className="h-9 w-full rounded-lg border border-[#DDE2EA] bg-white pl-9 pr-3 text-[11px] text-[#0E1726] outline-none transition focus:border-[#6D28D9] focus:ring-2 focus:ring-[#EDE9FE]" />
                        </div>
                        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-[#E6E9F0] bg-[#FBFCFE] p-1.5">
                          {filteredTargetTeams.length ? filteredTargetTeams.map((team) => (
                            <label key={team.id} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[11px] text-[#303A50] hover:bg-white">
                              <input type="checkbox" checked={supportTeamIds.includes(team.id)} onChange={(event) => setSupportTeamIds((current) => event.target.checked ? Array.from(new Set([...current, team.id])) : current.filter((id) => id !== team.id))} className="h-3.5 w-3.5 shrink-0 accent-[#6D28D9]" />
                              <span className="min-w-0 truncate">{team.name}</span>
                            </label>
                          )) : <p className="p-2 text-[11px] text-[#8A93A5]">No support teams match this search.</p>}
                        </div>
                      </fieldset>
                    )
                  ) : (
                    <p className="border-t border-[#E6E9F0] pt-4 text-[11px] text-[#6B7488]">Create the service first, then assign its support teams.</p>
                  )}
                </div>
              </section>
              </div>

              <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-[#E6E9F0] bg-[#FBFCFE] px-5 py-4 sm:px-6">
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
                  <span>{editingService ? "Save Changes" : "Create Service"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
