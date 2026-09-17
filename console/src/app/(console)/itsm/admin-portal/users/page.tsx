"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Key,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  Search,
  Send,
  Shield,
  UserPlus,
  Users,
  UserX,
  X,
} from "lucide-react";

interface EmployeeActionResult {
  mode: "manual" | "invite";
  status: "created" | "invited" | "already_exists";
  message: string;
  email: string;
  itsm_role: string;
  user_id?: string;
  has_itsm_access?: boolean;
  delivery?: string;
}

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

// Unified AuthClaw enterprise badge styling for all ITSM roles
const ROLE_BADGE_CLASS = "inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]";


export default function AdminPortalUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<ITSMUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [accessFilter, setAccessFilter] = useState<"ALL" | "ENABLED" | "DISABLED">("ALL");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");

  // Create / Invite Employee Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalMode, setModalMode] = useState<"manual" | "invite">("manual");

  // Option 1: Create Manually Fields
  const [manualEmail, setManualEmail] = useState("");
  const [manualRole, setManualRole] = useState("REQUESTER");
  const [manualPassword, setManualPassword] = useState("");
  const [manualConfirmPassword, setManualConfirmPassword] = useState("");
  const [manualEmailCredentials, setManualEmailCredentials] = useState(false);

  // Option 2: Invite by Email Fields
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("REQUESTER");
  const [inviteSendEmail, setInviteSendEmail] = useState(true);

  // Modal Execution State
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalResult, setModalResult] = useState<EmployeeActionResult | null>(null);
  const [assignRoleLoading, setAssignRoleLoading] = useState(false);
  const [assignRoleSuccess, setAssignRoleSuccess] = useState<string | null>(null);

  // Current authenticated user (for self-deactivation protection)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Deactivate User Modal State
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [userToDeactivate, setUserToDeactivate] = useState<ITSMUser | null>(null);
  const [deactivateLoading, setDeactivateLoading] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [deactivateSuccess, setDeactivateSuccess] = useState<string | null>(null);

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
    // Retrieve current session to prevent self-deactivation
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setCurrentUserId(data.userId || null);
          setCurrentUserEmail(data.email ? data.email.toLowerCase() : null);
        }
      })
      .catch(() => {});
  }, []);

  const openDeactivateModal = (user: ITSMUser) => {
    setUserToDeactivate(user);
    setDeactivateError(null);
    setShowDeactivateModal(true);
  };

  const closeDeactivateModal = () => {
    setShowDeactivateModal(false);
    setUserToDeactivate(null);
    setDeactivateError(null);
    setDeactivateLoading(false);
  };

  const handleConfirmDeactivate = async () => {
    if (!userToDeactivate) return;
    setDeactivateLoading(true);
    setDeactivateError(null);
    try {
      const res = await fetch(`/api/itsm/admin/users/${userToDeactivate.id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Deactivation failed (${res.status})`);
      }
      // Remove deleted/deactivated user from list immediately so they are completely hidden
      setUsers((prev) => prev.filter((u) => u.id !== userToDeactivate.id));
      setDeactivateSuccess(
        `User ${userToDeactivate.email} has been deleted. Their login and ITSM access are disabled.`
      );
      closeDeactivateModal();
    } catch (err: unknown) {
      setDeactivateError(err instanceof Error ? err.message : "Failed to deactivate user");
    } finally {
      setDeactivateLoading(false);
    }
  };

  const handleGrantAccessClick = () => {
    // Navigate to the first candidate without ITSM access, or first user
    const candidate = users.find((u) => !u.itsm_access) || users[0];
    if (candidate) {
      router.push(`/itsm/admin-portal/users/${candidate.id}`);
    }
  };

  // Option 1: Manual Employee Creation
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setAssignRoleSuccess(null);
    const emailClean = manualEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailClean || !emailRegex.test(emailClean)) {
      setModalError("Please enter a valid corporate email address.");
      return;
    }
    if (!manualPassword || manualPassword.length < 12) {
      setModalError("Password must be at least 12 characters.");
      return;
    }
    if (manualPassword !== manualConfirmPassword) {
      setModalError("Password and confirmation do not match.");
      return;
    }

    setModalLoading(true);
    try {
      const res = await fetch("/api/itsm/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailClean,
          itsm_role: manualRole,
          password: manualPassword,
          confirm_password: manualConfirmPassword,
          email_credentials: manualEmailCredentials,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Creation failed (${res.status})`);
      }
      setModalResult({
        mode: "manual",
        status: data.status,
        message: data.message,
        email: data.email,
        itsm_role: data.itsm_role,
        user_id: data.user_id,
        has_itsm_access: data.has_itsm_access,
        delivery: data.delivery,
      });
      fetchUsers();
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Failed to create employee");
    } finally {
      setModalLoading(false);
    }
  };

  // Option 2: Email Invitation
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setAssignRoleSuccess(null);
    const emailClean = inviteEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailClean || !emailRegex.test(emailClean)) {
      setModalError("Please enter a valid corporate email address.");
      return;
    }

    setModalLoading(true);
    try {
      const res = await fetch("/api/itsm/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailClean,
          itsm_role: inviteRole,
          send_email: inviteSendEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Invitation failed (${res.status})`);
      }
      setModalResult({
        mode: "invite",
        status: data.status,
        message: data.message,
        email: data.email,
        itsm_role: data.itsm_role,
        user_id: data.user_id,
        delivery: data.delivery,
      });
      fetchUsers();
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Failed to invite employee");
    } finally {
      setModalLoading(false);
    }
  };

  // Existing user role assignment
  const handleGrantExistingUserAccess = async () => {
    if (!modalResult?.user_id) return;
    setAssignRoleLoading(true);
    setModalError(null);
    try {
      const selectedRole = modalResult.mode === "manual" ? manualRole : inviteRole;
      const res = await fetch(`/api/itsm/admin/users/${modalResult.user_id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          has_itsm_access: true,
          itsm_role: selectedRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Failed to update ITSM access");
      }
      setAssignRoleSuccess(`ITSM access granted with role ${selectedRole.replace(/_/g, " ")}.`);
      setModalResult((prev) =>
        prev
          ? {
              ...prev,
              itsm_role: selectedRole,
              has_itsm_access: true,
            }
          : null
      );
      fetchUsers();
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Failed to update user access");
    } finally {
      setAssignRoleLoading(false);
    }
  };

  const closeModal = () => {
    setShowAddModal(false);
    setModalMode("manual");
    setManualEmail("");
    setManualRole("REQUESTER");
    setManualPassword("");
    setManualConfirmPassword("");
    setManualEmailCredentials(false);
    setInviteEmail("");
    setInviteRole("REQUESTER");
    setInviteSendEmail(true);
    setModalLoading(false);
    setModalError(null);
    setModalResult(null);
    setAssignRoleLoading(false);
    setAssignRoleSuccess(null);
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // The deleted user must NOT appear in the normal Users list anymore
      if (u.status !== "active") return false;

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
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-[#D1D5DB] bg-white text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB] hover:text-[#111827] transition disabled:opacity-50 shadow-xs"
              title="Refresh users"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={handleGrantAccessClick}
              disabled={users.length === 0}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-[#D1D5DB] bg-white text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB] hover:text-[#111827] transition disabled:opacity-50 shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#6D28D9]" />
              <span>Grant ITSM Access</span>
            </button>
            <button
              onClick={() => {
                closeModal();
                setShowAddModal(true);
              }}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold shadow-xs hover:bg-[#5B21B6] transition"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>+ Add Employee</span>
            </button>
          </div>
        </div>
      </div>

      {/* Deactivation Success Alert */}
      {deactivateSuccess && (
        <div className="p-4 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-start justify-between gap-3 text-emerald-900 text-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="font-medium">{deactivateSuccess}</p>
          </div>
          <button
            onClick={() => setDeactivateSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-start gap-3 text-red-800 text-xs">
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
      <div className="p-3.5 rounded-xl border border-[#E5E7EB] bg-white shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 h-9 rounded-lg border border-[#D1D5DB] bg-white text-xs text-[#111827] placeholder-[#8E97A8] focus:bg-white focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
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
            <span className="text-xs font-semibold text-[#4B5565]">Access:</span>
            <select
              value={accessFilter}
              onChange={(e) => setAccessFilter(e.target.value as any)}
              className="h-9 px-3 rounded-lg border border-[#D1D5DB] bg-white text-xs font-medium text-[#374151] focus:outline-none focus:border-[#6D28D9] transition"
            >
              <option value="ALL">All Access</option>
              <option value="ENABLED">ITSM Enabled</option>
              <option value="DISABLED">ITSM Disabled</option>
            </select>
          </div>

          {/* Role Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-[#4B5565]">Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-[#D1D5DB] bg-white text-xs font-medium text-[#374151] focus:outline-none focus:border-[#6D28D9] transition"
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
      <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-xs overflow-hidden">
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
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-xs font-semibold text-[#4B5565] uppercase tracking-wider">
                  <th className="py-3.5 px-5">User</th>
                  <th className="py-3.5 px-5">Email</th>
                  <th className="py-3.5 px-5">ITSM Access</th>
                  <th className="py-3.5 px-5">ITSM Role</th>
                  <th className="py-3.5 px-5">Governance Access</th>
                  <th className="py-3.5 px-5">Status</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {filteredUsers.map((user) => {
                  const roleLabel =
                    user.itsm_role === "INCIDENT_MANAGER" || user.itsm_role === "SERVICE_LEAD"
                      ? "Incident Manager"
                      : user.itsm_role
                      ? user.itsm_role.replace(/_/g, " ")
                      : "None";

                  return (
                    <tr
                      key={user.id}
                      className="hover:bg-[#F9FAFB]/70 transition-colors"
                    >
                      {/* Name */}
                      <td className="py-4 px-5">
                        <Link
                          href={`/itsm/admin-portal/users/${user.id}`}
                          className="text-sm font-semibold text-[#111827] hover:text-[#6D28D9] hover:underline transition"
                        >
                          {user.name}
                        </Link>
                      </td>

                      {/* Email */}
                      <td className="py-4 px-5 text-[13px] font-normal text-[#374151]">
                        {user.email}
                      </td>

                      {/* ITSM Access */}
                      <td className="py-4 px-5">
                        {user.itsm_access ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
                            <Check className="w-3 h-3 text-[#059669]" />
                            Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#F9FAFB] text-[#6B7280] border border-[#E5E7EB]">
                            <X className="w-3 h-3 text-[#9CA3AF]" />
                            Disabled
                          </span>
                        )}
                      </td>

                      {/* ITSM Role - Unified AuthClaw Purple Badge */}
                      <td className="py-4 px-5">
                        {user.itsm_access ? (
                          <span className={ROLE_BADGE_CLASS}>
                            {roleLabel}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#F9FAFB] text-[#6B7280] border border-[#E5E7EB]">
                            Unassigned
                          </span>
                        )}
                      </td>

                      {/* Governance Access - Neutral Badge */}
                      <td className="py-4 px-5">
                        {user.governance_access ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#F8FAFC] text-[#334155] border border-[#CBD5E1]">
                            <Shield className="w-3.5 h-3.5 text-[#64748B]" />
                            Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#F9FAFB] text-[#6B7280] border border-[#E5E7EB]">
                            Disabled
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-4 px-5">
                        {user.status === "active" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                            Inactive / Deactivated
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-5 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <Link
                            href={`/itsm/admin-portal/users/${user.id}`}
                            className="inline-flex items-center justify-center h-8 px-3 rounded-lg border border-[#D1D5DB] bg-white text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB] hover:text-[#111827] transition shadow-2xs"
                          >
                            {user.itsm_access ? "Edit Access" : "Grant Access"}
                          </Link>

                          {user.id === currentUserId || (currentUserEmail && user.email.toLowerCase() === currentUserEmail) ? (
                            <span
                              className="inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-medium text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] cursor-not-allowed"
                              title="You cannot deactivate your own administrator account"
                            >
                              Current Admin
                            </span>
                          ) : user.status !== "active" ? (
                            <span
                              className="inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-medium text-[#9CA3AF] bg-[#F9FAFB] border border-[#E5E7EB]"
                            >
                              Deactivated
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openDeactivateModal(user)}
                              className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg border border-[#FCA5A5] bg-white text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] hover:border-[#DC2626] transition shadow-2xs"
                              title="Deactivate this user account"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              <span>Deactivate</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Invite Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-[20px] border border-[#E6E9F0] bg-white p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-[#0E1726]">
                  Create / Invite Employee
                </h2>
                <p className="text-xs text-[#6B7488] mt-0.5">
                  Add an employee to the workspace with an assigned ITSM business role.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-1 rounded-lg text-[#8E97A8] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Selector (When not viewing a result) */}
            {!modalResult && (
              <div className="grid grid-cols-2 p-1 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-medium text-[#475069]">
                <button
                  type="button"
                  onClick={() => {
                    setModalMode("manual");
                    setModalError(null);
                  }}
                  className={`py-1.5 px-3 rounded-lg transition text-center flex items-center justify-center gap-1.5 ${
                    modalMode === "manual"
                      ? "bg-white text-[#6D28D9] font-semibold shadow-xs"
                      : "hover:text-[#0E1726]"
                  }`}
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Create Manually</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModalMode("invite");
                    setModalError(null);
                  }}
                  className={`py-1.5 px-3 rounded-lg transition text-center flex items-center justify-center gap-1.5 ${
                    modalMode === "invite"
                      ? "bg-white text-[#6D28D9] font-semibold shadow-xs"
                      : "hover:text-[#0E1726]"
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Invite by Email</span>
                </button>
              </div>
            )}

            {/* Error Alert */}
            {modalError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-start gap-2.5 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span className="flex-1">{modalError}</span>
              </div>
            )}

            {/* Result State */}
            {modalResult ? (
              <div className="space-y-4">
                {modalResult.status === "already_exists" ? (
                  /* Existing User State */
                  <>
                    <div className="p-4 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-[#92400E]">
                          This employee already has an AuthClaw account.
                        </p>
                        <p className="text-[#B45309]">
                          Existing user credentials were not modified. You can grant ITSM access or update their assigned ITSM role below.
                        </p>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] space-y-2 text-xs">
                      <div className="flex justify-between items-center py-1 border-b border-[#E6E9F0]">
                        <span className="text-[#6B7488]">Email Address:</span>
                        <span className="font-mono font-semibold text-[#0E1726]">{modalResult.email}</span>
                      </div>
                      <div className="flex justify-between items-center py-1">
                        <span className="text-[#6B7488]">Current ITSM Role:</span>
                        <span className="font-semibold text-[#6D28D9]">
                          {modalResult.itsm_role.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>

                    {assignRoleSuccess && (
                      <div className="p-3 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-center gap-2 text-xs text-[#15803D]">
                        <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
                        <span>{assignRoleSuccess}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-2">
                      {!assignRoleSuccess && (
                        <button
                          type="button"
                          onClick={handleGrantExistingUserAccess}
                          disabled={assignRoleLoading}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition disabled:opacity-50"
                        >
                          {assignRoleLoading ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Updating...</span>
                            </>
                          ) : (
                            <>
                              <Shield className="w-3.5 h-3.5" />
                              <span>Grant ITSM Access & Assign Role</span>
                            </>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={closeModal}
                        className="px-4 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition"
                      >
                        Done
                      </button>
                    </div>
                  </>
                ) : modalResult.status === "created" ? (
                  /* Created Successfully (Manual Mode) */
                  <>
                    <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-[#166534]">
                          Employee created successfully.
                        </p>
                        <p className="text-[#15803D]">
                          The employee can now sign in at the ITSM portal. The Platform Administrator can communicate the password separately if required.
                        </p>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] space-y-2 text-xs">
                      <div className="flex justify-between items-center py-1 border-b border-[#E6E9F0]">
                        <span className="text-[#6B7488]">Email:</span>
                        <span className="font-mono font-semibold text-[#0E1726]">{modalResult.email}</span>
                      </div>
                      <div className="flex justify-between items-center py-1">
                        <span className="text-[#6B7488]">ITSM Role:</span>
                        <span className="font-semibold text-[#6D28D9]">
                          {modalResult.itsm_role.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setModalResult(null);
                          setManualEmail("");
                          setManualPassword("");
                          setManualConfirmPassword("");
                          setManualEmailCredentials(false);
                          setModalError(null);
                        }}
                        className="px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition"
                      >
                        Create Another
                      </button>
                      <button
                        type="button"
                        onClick={closeModal}
                        className="px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
                      >
                        Done
                      </button>
                    </div>
                  </>
                ) : (
                  /* Invited Successfully (Invite Mode) */
                  <>
                    <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-[#166534]">
                          Invitation sent successfully.
                        </p>
                        <p className="text-[#15803D]">
                          The invitation email contains the onboarding link to complete setup and sign in.
                        </p>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] space-y-2 text-xs">
                      <div className="flex justify-between items-center py-1 border-b border-[#E6E9F0]">
                        <span className="text-[#6B7488]">Email:</span>
                        <span className="font-mono font-semibold text-[#0E1726]">{modalResult.email}</span>
                      </div>
                      <div className="flex justify-between items-center py-1">
                        <span className="text-[#6B7488]">ITSM Role:</span>
                        <span className="font-semibold text-[#6D28D9]">
                          {modalResult.itsm_role.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setModalResult(null);
                          setInviteEmail("");
                          setModalError(null);
                        }}
                        className="px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition"
                      >
                        Invite Another
                      </button>
                      <button
                        type="button"
                        onClick={closeModal}
                        className="px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
                      >
                        Done
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : modalMode === "manual" ? (
              /* OPTION 1: CREATE MANUALLY FORM */
              <form onSubmit={handleManualSubmit} className="space-y-3.5">
                {/* Email Field */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[#0E1726]">
                    Employee Email <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      placeholder="employee@company.com"
                      value={manualEmail}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setManualEmail(e.target.value)}
                      disabled={modalLoading}
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] placeholder-[#8E97A8] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
                    />
                  </div>
                </div>

                {/* ITSM Role Field */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[#0E1726]">
                    ITSM Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={manualRole}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setManualRole(e.target.value)}
                    disabled={modalLoading}
                    className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
                  >
                    <option value="REQUESTER">Requester (Self-service ticketing & portal)</option>
                    <option value="SERVICE_AGENT">Service Agent (Service desk & incident triage)</option>
                    <option value="INCIDENT_MANAGER">Incident Manager (Major incident response & war rooms)</option>
                    <option value="PROCESS_CHANGE_MANAGER">Process & Change Manager (Change enablement & CAB)</option>
                    <option value="PLATFORM_ADMINISTRATOR">Platform Administrator (Full ITSM administration)</option>
                    <option value="AUDITOR">Auditor (Read-only compliance & audit logging)</option>
                  </select>
                </div>

                {/* Password Field */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[#0E1726]">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={12}
                      placeholder="Minimum 12 characters"
                      value={manualPassword}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setManualPassword(e.target.value)}
                      disabled={modalLoading}
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] placeholder-[#8E97A8] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
                    />
                  </div>
                </div>

                {/* Confirm Password Field */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[#0E1726]">
                    Confirm Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={12}
                      placeholder="Confirm password"
                      value={manualConfirmPassword}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setManualConfirmPassword(e.target.value)}
                      disabled={modalLoading}
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] placeholder-[#8E97A8] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
                    />
                  </div>
                </div>

                {/* Optional Email Credentials Checkbox */}
                <div className="pt-1">
                  <label className="flex items-center gap-2 text-xs text-[#475069] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={manualEmailCredentials}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setManualEmailCredentials(e.target.checked)}
                      disabled={modalLoading}
                      className="w-3.5 h-3.5 rounded border-[#D1D5DB] text-[#6D28D9] focus:ring-[#6D28D9]"
                    />
                    <span>Email these login credentials to the employee</span>
                  </label>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#F0F2F5]">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={modalLoading}
                    className="px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modalLoading || !manualEmail.trim() || !manualPassword}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition disabled:opacity-50 shadow-xs"
                  >
                    {modalLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Creating...</span>
                      </>
                    ) : (
                      <>
                        <Key className="w-3.5 h-3.5" />
                        <span>Create Employee</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* OPTION 2: INVITE BY EMAIL FORM */
              <form onSubmit={handleInviteSubmit} className="space-y-3.5">
                {/* Email Field */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[#0E1726]">
                    Employee Email <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      placeholder="employee@company.com"
                      value={inviteEmail}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInviteEmail(e.target.value)}
                      disabled={modalLoading}
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] placeholder-[#8E97A8] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
                    />
                  </div>
                  <p className="text-[11px] text-[#6B7488]">
                    Must be a valid corporate email address.
                  </p>
                </div>

                {/* ITSM Role Field */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[#0E1726]">
                    ITSM Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setInviteRole(e.target.value)}
                    disabled={modalLoading}
                    className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
                  >
                    <option value="REQUESTER">Requester (Self-service ticketing & portal)</option>
                    <option value="SERVICE_AGENT">Service Agent (Service desk & incident triage)</option>
                    <option value="INCIDENT_MANAGER">Incident Manager (Major incident response & war rooms)</option>
                    <option value="PROCESS_CHANGE_MANAGER">Process & Change Manager (Change enablement & CAB)</option>
                    <option value="PLATFORM_ADMINISTRATOR">Platform Administrator (Full ITSM administration)</option>
                    <option value="AUDITOR">Auditor (Read-only compliance & audit logging)</option>
                  </select>
                  <p className="text-[11px] text-[#6B7488]">
                    Defines permissions and initial workspace experience.
                  </p>
                </div>

                {/* Optional Send Invitation Email Checkbox */}
                <div className="pt-1">
                  <label className="flex items-center gap-2 text-xs text-[#475069] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inviteSendEmail}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInviteSendEmail(e.target.checked)}
                      disabled={modalLoading}
                      className="w-3.5 h-3.5 rounded border-[#D1D5DB] text-[#6D28D9] focus:ring-[#6D28D9]"
                    />
                    <span>Send invitation email</span>
                  </label>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#F0F2F5]">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={modalLoading}
                    className="px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modalLoading || !inviteEmail.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition disabled:opacity-50 shadow-xs"
                  >
                    {modalLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Send Invitation</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {/* Deactivate User Confirmation Modal */}
      {showDeactivateModal && userToDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-xl space-y-5 animate-in zoom-in-95 duration-200">
            {/* Header with Danger Icon */}
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-[#DC2626]" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-[#111827]">
                  Deactivate User
                </h2>
                <p className="text-xs text-[#4B5565] mt-1 leading-relaxed">
                  Are you sure you want to deactivate this user? They will no longer be able to log in or access ITSM.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDeactivateModal}
                disabled={deactivateLoading}
                className="p-1 rounded-lg text-[#9CA3AF] hover:text-[#111827] hover:bg-[#F9FAFB] transition disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target User Summary Card */}
            <div className="p-3.5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-[#6B7280]">User:</span>
                <span className="font-semibold text-[#111827]">{userToDeactivate.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#6B7280]">Email:</span>
                <span className="text-[13px] font-normal text-[#374151]">{userToDeactivate.email}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#6B7280]">ITSM Role:</span>
                <span className={ROLE_BADGE_CLASS}>{userToDeactivate.itsm_role.replace(/_/g, " ")}</span>
              </div>
            </div>

            {deactivateError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-start gap-2.5 text-red-800 text-xs">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <p className="flex-1">{deactivateError}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={closeDeactivateModal}
                disabled={deactivateLoading}
                className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-[#D1D5DB] bg-white text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB] transition disabled:opacity-50 shadow-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeactivate}
                disabled={deactivateLoading}
                className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg border border-[#FCA5A5] bg-white text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] hover:border-[#DC2626] transition disabled:opacity-50 shadow-xs"
              >
                {deactivateLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deactivating...</span>
                  </>
                ) : (
                  <>
                    <UserX className="w-3.5 h-3.5" />
                    <span>Deactivate User</span>
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
