"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  Users,
  UsersRound,
  X,
} from "lucide-react";

interface TeamMember {
  id: string;
  user_id: string;
  name: string;
  email: string;
  created_at: string;
}

interface Team {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  member_count: number;
  created_at: string;
  updated_at: string;
}

interface TenantUser {
  id: string;
  name: string;
  email: string;
  itsm_access?: boolean;
  itsm_role?: string;
  status?: string;
}

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Create / Edit modal state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Members modal state
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedAddUserId, setSelectedAddUserId] = useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [memberActionLoading, setMemberActionLoading] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const fetchTeams = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/itsm/admin/teams", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load teams (${res.status})`);
      }
      const data = await res.json();
      setTeams(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  };

  const fetchTenantUsers = async () => {
    try {
      const res = await fetch("/api/itsm/admin/users", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setTenantUsers(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load tenant users for team membership:", err);
    }
  };

  useEffect(() => {
    const request = window.setTimeout(() => { void fetchTeams(); void fetchTenantUsers(); }, 0);
    return () => window.clearTimeout(request);
  }, []);

  const openCreateModal = () => {
    setEditingTeam(null);
    setFormName("");
    setFormDesc("");
    setFormActive(true);
    setFormError(null);
    setFormModalOpen(true);
  };

  const openEditModal = (team: Team) => {
    setEditingTeam(team);
    setFormName(team.name);
    setFormDesc(team.description || "");
    setFormActive(team.is_active);
    setFormError(null);
    setFormModalOpen(true);
  };

  const handleSaveTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError("Team name is required");
      return;
    }

    setFormSaving(true);
    setFormError(null);

    try {
      if (editingTeam) {
        // PATCH
        const res = await fetch(`/api/itsm/admin/teams/${editingTeam.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            description: formDesc.trim() || null,
            is_active: formActive,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Failed to update team (${res.status})`);
        }
        const updated = await res.json();
        setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } else {
        // POST
        const res = await fetch("/api/itsm/admin/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            description: formDesc.trim() || null,
            is_active: formActive,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Failed to create team (${res.status})`);
        }
        const created = await res.json();
        setTeams((prev) => [...prev, created]);
      }
      setFormModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save team");
    } finally {
      setFormSaving(false);
    }
  };

  const openMembersModal = async (team: Team) => {
    setActiveTeam(team);
    setMembersModalOpen(true);
    setLoadingMembers(true);
    setMemberError(null);
    setSelectedAddUserId("");
    setUserSearchQuery("");

    try {
      const [teamRes, usersRes] = await Promise.all([
        fetch(`/api/itsm/admin/teams/${team.id}`, { cache: "no-store" }),
        fetch("/api/itsm/admin/users", { cache: "no-store" }),
      ]);
      if (!teamRes.ok) throw new Error("Failed to load team members");
      const data = await teamRes.json();
      setTeamMembers(data.members || []);

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setTenantUsers(Array.isArray(usersData) ? usersData : []);
      }
    } catch (err: unknown) {
      setMemberError(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleAddMember = async (userIdToUse?: string) => {
    const targetUserId = userIdToUse || selectedAddUserId;
    if (!activeTeam || !targetUserId) return;
    setMemberActionLoading(true);
    setMemberError(null);

    try {
      const res = await fetch(`/api/itsm/admin/teams/${activeTeam.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: targetUserId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to add team member");
      }
      const newMember: TeamMember = await res.json();
      setTeamMembers((prev) => [...prev, newMember]);
      // Update team member count in state
      setTeams((prev) =>
        prev.map((t) => (t.id === activeTeam.id ? { ...t, member_count: t.member_count + 1 } : t))
      );
      setSelectedAddUserId("");
      setUserSearchQuery("");
    } catch (err: unknown) {
      setMemberError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setMemberActionLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!activeTeam) return;
    setMemberActionLoading(true);
    setMemberError(null);

    try {
      const res = await fetch(`/api/itsm/admin/teams/${activeTeam.id}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        throw new Error("Failed to remove member");
      }
      setTeamMembers((prev) => prev.filter((m) => m.user_id !== userId));
      // Update team member count in state
      setTeams((prev) =>
        prev.map((t) => (t.id === activeTeam.id ? { ...t, member_count: Math.max(0, t.member_count - 1) } : t))
      );
    } catch (err: unknown) {
      setMemberError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setMemberActionLoading(false);
    }
  };

  const handleToggleStatus = async (team: Team) => {
    try {
      const res = await fetch(`/api/itsm/admin/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !team.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      const updated = await res.json();
      setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      console.error("Failed to toggle status:", err);
    }
  };

  const filteredTeams = useMemo(() => {
    return teams.filter(
      (t) =>
        !searchQuery ||
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [teams, searchQuery]);

  // Active users with ITSM access who are not yet members of this team
  const availableUsersToAdd = useMemo(() => {
    const memberUserIds = new Set(teamMembers.map((m) => m.user_id));
    return tenantUsers.filter((u) => {
      const isActive = u.status ? u.status.toLowerCase() === "active" : true;
      const hasItsmAccess = u.itsm_access === true;
      const notMember = !memberUserIds.has(u.id);
      return isActive && hasItsmAccess && notMember;
    });
  }, [tenantUsers, teamMembers]);

  // Candidate users filtered by employee name or email search query
  const searchedUsersToAdd = useMemo(() => {
    if (!userSearchQuery.trim()) return availableUsersToAdd;
    const q = userSearchQuery.trim().toLowerCase();
    return availableUsersToAdd.filter(
      (u) =>
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q))
    );
  }, [availableUsersToAdd, userSearchQuery]);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Breadcrumb & Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-[#6B7488] mb-1">
          <Link href="/itsm/admin-portal" className="hover:text-[#0E1726]">
            Platform Administration
          </Link>
          <span>/</span>
          <span className="text-[#0E1726] font-medium">Teams</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#0E1726] tracking-tight">Teams & Groups</h1>
            <p className="text-xs text-[#6B7488] mt-0.5">
              Configure operational teams and member assignments across your ITSM workspace.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchTeams}
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
              <span>Create Team</span>
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
          <button onClick={fetchTeams} className="underline font-semibold">
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
            placeholder="Search teams..."
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

      {/* Teams Table */}
      <div className="rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#6D28D9]" />
            <p className="text-xs text-[#6B7488]">Loading teams...</p>
          </div>
        ) : filteredTeams.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <UsersRound className="w-8 h-8 text-[#8E97A8] mx-auto opacity-50" />
            <p className="text-xs font-semibold text-[#0E1726]">No teams yet</p>
            <p className="text-xs text-[#6B7488]">
              {searchQuery ? "No teams matched your query." : "Get started by creating your first operational team."}
            </p>
            {!searchQuery && (
              <button
                onClick={openCreateModal}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Team</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E6E9F0] bg-[#FBFAF9] text-[11px] font-bold text-[#6B7488] uppercase tracking-wider">
                  <th className="py-3 px-4">Team Name</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Member Count</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F2F5]">
                {filteredTeams.map((team) => (
                  <tr key={team.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-[#0E1726]">
                      {team.name}
                    </td>
                    <td className="py-3.5 px-4 text-[#6B7488] max-w-sm truncate">
                      {team.description || "—"}
                    </td>
                    <td className="py-3.5 px-4">
                      {team.is_active ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#059669]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#9CA3AF]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-[#475069] font-medium">
                      <button
                        onClick={() => openMembersModal(team)}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-[#F1ECFE] hover:text-[#6D28D9] transition"
                        title="Manage Members"
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>{team.member_count} members</span>
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => openMembersModal(team)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:text-[#6D28D9] hover:bg-[#F1ECFE]/30 transition"
                      >
                        Members
                      </button>
                      <button
                        onClick={() => openEditModal(team)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleStatus(team)}
                        className={`inline-flex items-center px-2.5 py-1 rounded-md border text-xs font-medium transition ${
                          team.is_active
                            ? "border-[#FCA5A5] text-red-700 hover:bg-red-50"
                            : "border-[#A7F3D0] text-[#059669] hover:bg-emerald-50"
                        }`}
                      >
                        {team.is_active ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Team Modal */}
      {formModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[20px] border border-[#E6E9F0] bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-[#E6E9F0] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0E1726]">
                {editingTeam ? "Edit Team" : "Create Team"}
              </h3>
              <button
                onClick={() => setFormModalOpen(false)}
                className="text-[#8E97A8] hover:text-[#0E1726]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTeam} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FCA5A5] text-red-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  Team Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Service Desk, Network Support"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Operational responsibilities and scope..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="team-active-toggle"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="rounded border-[#E6E9F0] text-[#6D28D9] focus:ring-[#6D28D9]"
                />
                <label htmlFor="team-active-toggle" className="text-xs text-[#0E1726] font-medium cursor-pointer">
                  Team is active and available for ticket assignment
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#F5F7FA]">
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] disabled:opacity-50"
                >
                  {formSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingTeam ? "Save Changes" : "Create Team"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Members Modal */}
      {membersModalOpen && activeTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-[20px] border border-[#E6E9F0] bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-[#E6E9F0] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#0E1726]">
                  Team Members: {activeTeam.name}
                </h3>
                <p className="text-[11px] text-[#6B7488]">
                  Add or remove existing AuthClaw users from this operational team.
                </p>
              </div>
              <button
                onClick={() => setMembersModalOpen(false)}
                className="text-[#8E97A8] hover:text-[#0E1726]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              {memberError && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FCA5A5] text-red-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{memberError}</span>
                </div>
              )}

              {/* Add Member Form with Search & Instant Selection */}
              <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-[#0E1726]">
                    Add User to Team
                  </label>
                  <span className="text-[11px] text-[#6B7488]">
                    {availableUsersToAdd.length} active ITSM candidate{availableUsersToAdd.length === 1 ? "" : "s"} available
                  </span>
                </div>

                {/* Real-time Search Input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    id="team-member-search-input"
                    placeholder="Search by employee name or email (e.g. khushiverma9111)..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    disabled={memberActionLoading || availableUsersToAdd.length === 0}
                    className="w-full pl-9 pr-8 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#0E1726] placeholder-[#8E97A8] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                  />
                  {userSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setUserSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8E97A8] hover:text-[#0E1726] p-0.5"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Candidate Selection & Results */}
                {availableUsersToAdd.length === 0 ? (
                  <p className="text-[11px] text-[#8E97A8] italic py-1">
                    All active users with ITSM access in this organization are already members.
                  </p>
                ) : searchedUsersToAdd.length === 0 ? (
                  <div className="py-2 text-center text-[11px] text-[#8E97A8] bg-white rounded-lg border border-[#E6E9F0] p-3">
                    No active ITSM users match &ldquo;{userSearchQuery}&rdquo;.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {userSearchQuery.trim() ? (
                      /* When search query is entered, display rich matching candidate cards */
                      <div className="max-h-44 overflow-y-auto divide-y divide-[#F0F2F5] border border-[#E6E9F0] rounded-lg bg-white">
                        {searchedUsersToAdd.map((u) => (
                          <div
                            key={u.id}
                            className="px-3 py-2 flex items-center justify-between hover:bg-[#F9FAFB] transition-colors"
                          >
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-xs text-[#0E1726] truncate">
                                  {u.name}
                                </span>
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]">
                                  {u.itsm_role || "ITSM USER"}
                                </span>
                              </div>
                              <p className="text-[11px] text-[#6B7488] font-mono truncate">
                                {u.email}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAddMember(u.id)}
                              disabled={memberActionLoading}
                              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] disabled:opacity-50 transition shadow-xs"
                            >
                              {memberActionLoading && selectedAddUserId === u.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <UserPlus className="w-3 h-3" />
                              )}
                              <span>Add</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      /* When no query is typed, display the dropdown selector and Add button */
                      <div className="flex gap-2">
                        <select
                          id="team-member-select"
                          value={selectedAddUserId}
                          onChange={(e) => setSelectedAddUserId(e.target.value)}
                          disabled={memberActionLoading || searchedUsersToAdd.length === 0}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9]"
                        >
                          <option value="">
                            Select an active employee ({searchedUsersToAdd.length} available)...
                          </option>
                          {searchedUsersToAdd.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.email}) — [{u.itsm_role || "ITSM"}]
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleAddMember()}
                          disabled={!selectedAddUserId || memberActionLoading}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] disabled:opacity-50 transition shadow-xs shrink-0"
                        >
                          {memberActionLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <UserPlus className="w-3.5 h-3.5" />
                          )}
                          <span>Add</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Members List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-[#6B7488] uppercase tracking-wider">
                  Current Members ({teamMembers.length})
                </h4>

                {loadingMembers ? (
                  <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#6B7488]">
                    <Loader2 className="w-4 h-4 animate-spin text-[#6D28D9]" />
                    <span>Loading members...</span>
                  </div>
                ) : teamMembers.length === 0 ? (
                  <p className="text-xs text-[#8E97A8] italic py-4 text-center">
                    No members assigned to this team yet.
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto divide-y divide-[#F0F2F5] border border-[#E6E9F0] rounded-xl">
                    {teamMembers.map((m) => (
                      <div
                        key={m.id}
                        className="px-3.5 py-2.5 flex items-center justify-between hover:bg-[#F9FAFB]"
                      >
                        <div>
                          <p className="text-xs font-semibold text-[#0E1726]">{m.name}</p>
                          <p className="text-[11px] text-[#6B7488] font-mono">{m.email}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveMember(m.user_id)}
                          disabled={memberActionLoading}
                          className="text-[#8E97A8] hover:text-red-600 p-1 rounded transition"
                          title="Remove from team"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-3 border-t border-[#F5F7FA]">
                <button
                  type="button"
                  onClick={() => setMembersModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
