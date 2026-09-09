"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  UserPlus,
  Users,
  X,
} from "lucide-react";

interface ITSMUser {
  id: string;
  name: string;
  email: string;
  itsm_access: boolean;
  itsm_role: string;
  governance_access: boolean;
  status: string;
  created_at: string;
}

const ROLE_BADGES: Record<string, { bg: string; text: string; border: string }> = {
  PLATFORM_ADMINISTRATOR: { bg: "bg-[#F1ECFE]", text: "text-[#6D28D9]", border: "border-[#DDD6FE]" },
  INCIDENT_MANAGER: { bg: "bg-[#FEF2F2]", text: "text-[#DC2626]", border: "border-[#FECACA]" },
  SERVICE_LEAD: { bg: "bg-[#FEF2F2]", text: "text-[#DC2626]", border: "border-[#FECACA]" },
  SERVICE_AGENT: { bg: "bg-[#F0FDF4]", text: "text-[#15803D]", border: "border-[#BBF7D0]" },
  PROCESS_CHANGE_MANAGER: { bg: "bg-[#FFF7ED]", text: "text-[#C2410C]", border: "border-[#FED7AA]" },
  AUDITOR: { bg: "bg-[#F8FAFC]", text: "text-[#475569]", border: "border-[#CBD5E1]" },
  REQUESTER: { bg: "bg-[#F5F3FF]", text: "text-[#5B21B6]", border: "border-[#DDD6FE]" },
};

export default function AdminPortalUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<ITSMUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [accessFilter, setAccessFilter] = useState<"ALL" | "ENABLED" | "DISABLED">("ALL");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/itsm/admin/users", { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.message || `Failed to fetch users (${res.status})`);
      }
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleGrantAccessClick = () => {
    // Navigate to the first candidate without ITSM access, or first user
    const candidate = users.find((u) => !u.itsm_access) || users[0];
    if (candidate) {
      router.push(`/itsm/admin-portal/users/${candidate.id}`);
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        !searchQuery ||
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesAccess =
        accessFilter === "ALL" ||
        (accessFilter === "ENABLED" && u.itsm_access) ||
        (accessFilter === "DISABLED" && !u.itsm_access);

      const normalizedUserRole =
        u.itsm_role.toUpperCase() === "SERVICE_LEAD"
          ? "INCIDENT_MANAGER"
          : u.itsm_role.toUpperCase();
      const matchesRole =
        roleFilter === "ALL" ||
        normalizedUserRole === roleFilter.toUpperCase() ||
        u.itsm_role.toUpperCase() === roleFilter.toUpperCase();

      return matchesSearch && matchesAccess && matchesRole;
    });
  }, [users, searchQuery, accessFilter, roleFilter]);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Breadcrumb & Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-[#6B7488] mb-1">
          <Link href="/itsm/admin-portal" className="hover:text-[#0E1726]">
            Platform Administration
          </Link>
          <span>/</span>
          <span className="text-[#0E1726] font-medium">Users</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#0E1726] tracking-tight">ITSM User Management</h1>
            <p className="text-xs text-[#6B7488] mt-0.5">
              Manage ITSM access permissions, business roles, and governance status for tenant users.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] hover:text-[#0E1726] transition disabled:opacity-50"
              title="Refresh users"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={handleGrantAccessClick}
              disabled={users.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold shadow-xs hover:bg-[#5B21B6] transition disabled:opacity-50"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Grant ITSM Access</span>
            </button>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-[16px] bg-[#FEF2F2] border border-[#FCA5A5] flex items-start gap-3 text-red-800 text-xs">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Unable to load users</p>
            <p className="mt-0.5 text-red-700">{error}</p>
          </div>
          <button
            onClick={fetchUsers}
            className="text-xs font-medium underline text-red-800 hover:text-red-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="p-4 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col md:flex-row gap-3 items-center justify-between">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name or email..."
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

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Access Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[#6B7488]">Access:</span>
            <select
              value={accessFilter}
              onChange={(e) => setAccessFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
            >
              <option value="ALL">All Access</option>
              <option value="ENABLED">ITSM Enabled</option>
              <option value="DISABLED">ITSM Disabled</option>
            </select>
          </div>

          {/* Role Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[#6B7488]">Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
            >
              <option value="ALL">All Roles</option>
              <option value="REQUESTER">Requester</option>
              <option value="SERVICE_AGENT">Service Agent</option>
              <option value="INCIDENT_MANAGER">Incident Manager</option>
              <option value="PROCESS_CHANGE_MANAGER">Process & Change Manager</option>
              <option value="PLATFORM_ADMINISTRATOR">Platform Administrator</option>
              <option value="AUDITOR">Auditor</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.12)] overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#6D28D9]" />
            <p className="text-xs text-[#6B7488]">Loading tenant users...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Users className="w-8 h-8 text-[#8E97A8] mx-auto opacity-50" />
            <p className="text-xs font-semibold text-[#0E1726]">No users found</p>
            <p className="text-xs text-[#6B7488]">
              {searchQuery || accessFilter !== "ALL" || roleFilter !== "ALL"
                ? "Try adjusting your search or filter settings."
                : "There are no members in this tenant."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E6E9F0] bg-[#FBFAF9] text-[11px] font-bold text-[#6B7488] uppercase tracking-wider">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">ITSM Access</th>
                  <th className="py-3 px-4">ITSM Role</th>
                  <th className="py-3 px-4">Governance Access</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F2F5]">
                {filteredUsers.map((user) => {
                  const roleBadge = ROLE_BADGES[user.itsm_role] || {
                    bg: "bg-gray-100",
                    text: "text-gray-700",
                    border: "border-gray-200",
                  };
                  const roleLabel =
                    user.itsm_role === "INCIDENT_MANAGER" || user.itsm_role === "SERVICE_LEAD"
                      ? "Incident Manager"
                      : user.itsm_role
                      ? user.itsm_role.replace(/_/g, " ")
                      : "None";

                  return (
                    <tr
                      key={user.id}
                      className="hover:bg-[#F9FAFB] transition-colors"
                    >
                      {/* Name */}
                      <td className="py-3.5 px-4 font-semibold text-[#0E1726]">
                        <Link
                          href={`/itsm/admin-portal/users/${user.id}`}
                          className="hover:text-[#6D28D9] hover:underline"
                        >
                          {user.name}
                        </Link>
                      </td>

                      {/* Email */}
                      <td className="py-3.5 px-4 text-[#6B7488] font-mono text-[11px]">
                        {user.email}
                      </td>

                      {/* ITSM Access */}
                      <td className="py-3.5 px-4">
                        {user.itsm_access ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
                            <Check className="w-3 h-3" />
                            Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]">
                            <X className="w-3 h-3" />
                            Disabled
                          </span>
                        )}
                      </td>

                      {/* ITSM Role */}
                      <td className="py-3.5 px-4">
                        {user.itsm_access ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${roleBadge.bg} ${roleBadge.text} ${roleBadge.border}`}
                          >
                            {roleLabel}
                          </span>
                        ) : (
                          <span className="text-[#9CA3AF] text-[11px] italic">Unassigned</span>
                        )}
                      </td>

                      {/* Governance Access */}
                      <td className="py-3.5 px-4">
                        {user.governance_access ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
                            <Shield className="w-3 h-3 text-[#2563EB]" />
                            Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]">
                            Disabled
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        {user.status === "active" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#059669]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#9CA3AF]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />
                            Inactive
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <Link
                          href={`/itsm/admin-portal/users/${user.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:text-[#6D28D9] hover:border-[#DDD6FE] hover:bg-[#F1ECFE]/30 transition"
                        >
                          {user.itsm_access ? "Edit Access" : "Grant Access"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
