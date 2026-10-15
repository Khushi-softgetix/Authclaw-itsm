"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldCheck,
  UserPlus,
  Users,
  UserX,
  X,
  XCircle,
} from "lucide-react";

interface EmployeeActionResult {
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
  invitation_status?: string;
  invite_id?: string;
  invite_expires_at?: string;
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
  const [accessFilter, setAccessFilter] = useState<"ALL" | "ACTIVE" | "PENDING" | "ENABLED" | "DISABLED">("ALL");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");

  // Create / Invite Employee Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("REQUESTER");
  const [inviteSendEmail, setInviteSendEmail] = useState(true);

  // Modal Execution State
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalResult, setModalResult] = useState<EmployeeActionResult | null>(null);
  const [assignRoleLoading, setAssignRoleLoading] = useState(false);
  const [assignRoleSuccess, setAssignRoleSuccess] = useState<string | null>(null);

  // Resend / Revoke Invitation State
  const [actionUser, setActionUser] = useState<ITSMUser | null>(null);
  const [actionType, setActionType] = useState<"resend" | "revoke" | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

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

  const handleDeactivateConfirm = async () => {
    if (!userToDeactivate) return;
    setDeactivateLoading(true);
    setDeactivateError(null);
    try {
      const res = await fetch(`/api/itsm/admin/users/${userToDeactivate.id}/deactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.message || `Deactivation failed (${res.status})`);
      }
      setDeactivateSuccess(`User ${userToDeactivate.email} has been deactivated and their ITSM access revoked.`);
      closeDeactivateModal();
      fetchUsers();
    } catch (err: unknown) {
      setDeactivateError(err instanceof Error ? err.message : "Failed to deactivate user");
    } finally {
      setDeactivateLoading(false);
    }
  };

  const handleUserRowClick = (userEmail: string) => {
    const candidate = users.find((u) => u.email.toLowerCase() === userEmail.toLowerCase());
    if (candidate) {
      router.push(`/itsm/admin-portal/users/${candidate.id}`);
    }
  };

  // Secure Employee Invitation Submission (Zero Temporary Passwords)
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
      const res = await fetch(`/api/itsm/admin/users/${modalResult.user_id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          has_itsm_access: true,
          itsm_role: inviteRole,
          has_governance_access: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Failed to update user access (${res.status})`);
      }
      setAssignRoleSuccess(`ITSM access granted with role ${inviteRole.replace(/_/g, " ")}.`);
      fetchUsers();
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Failed to update user access");
    } finally {
      setAssignRoleLoading(false);
    }
  };

  // Resend Invitation Action
  const handleResendConfirm = async () => {
    if (!actionUser) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const endpoint = actionUser.invite_id
        ? `/api/itsm/admin/users/invites/${actionUser.invite_id}/resend`
        : `/api/itsm/admin/users/${actionUser.id}/invite/resend`;

      const res = await fetch(endpoint, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Resend failed (${res.status})`);
      }
      setActionSuccess(`Activation invitation has been resent to ${actionUser.email}.`);
      setActionType(null);
      setActionUser(null);
      fetchUsers();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to resend activation invitation");
    } finally {
      setActionLoading(false);
    }
  };

  // Revoke Invitation Action
  const handleRevokeConfirm = async () => {
    if (!actionUser) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const endpoint = actionUser.invite_id
        ? `/api/itsm/admin/users/invites/${actionUser.invite_id}/revoke`
        : `/api/itsm/admin/users/${actionUser.id}/invite/revoke`;

      const res = await fetch(endpoint, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Revocation failed (${res.status})`);
      }
      setActionSuccess(`Activation invitation for ${actionUser.email} has been revoked.`);
      setActionType(null);
      setActionUser(null);
      fetchUsers();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to revoke invitation");
    } finally {
      setActionLoading(false);
    }
  };

  const closeModal = () => {
    setShowAddModal(false);
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
      // Do not filter out inactive or pending users
      if (u.status === "deleted") return false;

      const matchesSearch =
        !searchQuery ||
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase());

      const effectiveStatus = u.invitation_status || u.status;
      const matchesAccess =
        accessFilter === "ALL" ||
        (accessFilter === "ENABLED" && u.itsm_access) ||
        (accessFilter === "DISABLED" && !u.itsm_access) ||
        (accessFilter === "ACTIVE" && (effectiveStatus === "active" || u.status === "active")) ||
        (accessFilter === "PENDING" && (effectiveStatus === "pending_activation" || effectiveStatus === "pending"));

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
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-medium text-[#6B7488]">
        <span>AuthClaw ITSM</span>
        <span>/</span>
        <Link href="/itsm/admin-portal" className="hover:text-[#0E1726] transition">
          Platform Administration
        </Link>
        <span>/</span>
        <span className="text-[#0E1726] font-semibold">User Management</span>
      </nav>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#0E1726]">ITSM User Management</h1>
          <p className="text-xs text-[#6B7488] mt-1">
            Manage ITSM access permissions, view activation statuses, and invite employees to the workspace.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchUsers}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition disabled:opacity-50 shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setModalError(null);
              setModalResult(null);
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition shadow-xs"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Invite Employee</span>
          </button>
        </div>
      </div>

      {/* Global Success / Error Banners */}
      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-center justify-between gap-2.5 text-xs text-[#166534] animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="text-[#166534] hover:text-[#14532D] p-1 rounded transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {deactivateSuccess && (
        <div className="p-3.5 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-center justify-between gap-2.5 text-xs text-[#166534] animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
            <span>{deactivateSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setDeactivateSuccess(null)}
            className="text-[#166534] hover:text-[#14532D] p-1 rounded transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-center gap-2 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name or email address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#0E1726] placeholder-[#8E97A8] focus:outline-none focus:border-[#6D28D9] transition"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Status / Access Filter */}
          <select
            value={accessFilter}
            onChange={(e) => setAccessFilter(e.target.value as "ALL" | "ACTIVE" | "PENDING" | "ENABLED" | "DISABLED")}
            className="px-3 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#475069] focus:outline-none focus:border-[#6D28D9] transition"
          >
            <option value="ALL">All Statuses & Access</option>
            <option value="ACTIVE">Active Users</option>
            <option value="PENDING">Pending Activation</option>
            <option value="ENABLED">ITSM Enabled</option>
            <option value="DISABLED">ITSM Disabled</option>
          </select>

          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#475069] focus:outline-none focus:border-[#6D28D9] transition"
          >
            <option value="ALL">All Roles</option>
            <option value="REQUESTER">Requester</option>
            <option value="SERVICE_AGENT">Service Agent</option>
            <option value="INCIDENT_MANAGER">Incident Manager</option>
            <option value="PROCESS_CHANGE_MANAGER">Process & Change Manager</option>
            <option value="PLATFORM_ADMINISTRATOR">Platform Administrator</option>
            <option value="AUDITOR">Auditor</option>
            <option value="CATALOG_MANAGER">Catalog Manager</option>
            <option value="CMDB_ADMIN">CMDB Admin</option>
          </select>
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

                  const effectiveStatus = user.invitation_status || user.status;

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

                      {/* ITSM Role */}
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

                      {/* Governance Access */}
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

                      {/* Status Column */}
                      <td className="py-4 px-5">
                        {effectiveStatus === "active" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                            Active
                          </span>
                        ) : effectiveStatus === "pending_activation" || effectiveStatus === "pending" ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]"
                            title="Invitation sent. Awaiting employee account activation."
                          >
                            <Clock className="w-3 h-3 text-[#D97706]" />
                            Pending Activation
                          </span>
                        ) : effectiveStatus === "expired" ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]"
                            title="24-hour activation link has expired. Employee requires a new invitation."
                          >
                            <AlertTriangle className="w-3 h-3 text-[#DC2626]" />
                            Expired (Needs New Invite)
                          </span>
                        ) : effectiveStatus === "revoked" ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F1F5F9] text-[#475569] border border-[#CBD5E1]"
                            title="Invitation was revoked. Employee requires a new invitation."
                          >
                            <XCircle className="w-3 h-3 text-[#64748B]" />
                            Revoked (Needs New Invite)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                            Deactivated
                          </span>
                        )}
                      </td>

                      {/* Actions Column */}
                      <td className="py-4 px-5 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          {effectiveStatus === "pending_activation" || effectiveStatus === "pending" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setActionUser(user);
                                  setActionType("resend");
                                  setActionError(null);
                                }}
                                className="inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-lg border border-[#DDD6FE] bg-[#F5F3FF] text-xs font-semibold text-[#6D28D9] hover:bg-[#EDE9FE] transition shadow-2xs"
                                title="Resend secure activation invitation email"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Resend Invite</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActionUser(user);
                                  setActionType("revoke");
                                  setActionError(null);
                                }}
                                className="inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-lg border border-[#FCA5A5] bg-white text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] transition shadow-2xs"
                                title="Revoke pending activation invitation"
                              >
                                <UserX className="w-3 h-3" />
                                <span>Revoke</span>
                              </button>
                            </>
                          ) : effectiveStatus === "expired" ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActionUser(user);
                                setActionType("resend");
                                setActionError(null);
                              }}
                              className="inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] text-xs font-semibold text-[#B45309] hover:bg-[#FEF3C7] transition shadow-2xs"
                              title="Send a fresh 24-hour activation invitation"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Send New Invite</span>
                            </button>
                          ) : effectiveStatus === "revoked" ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActionUser(user);
                                setActionType("resend");
                                setActionError(null);
                              }}
                              className="inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold text-[#475569] hover:bg-[#F1F5F9] transition shadow-2xs"
                              title="Re-invite employee with a fresh activation link"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Re-invite</span>
                            </button>
                          ) : (
                            <>
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
                                <span className="inline-flex items-center justify-center h-8 px-3 rounded-lg text-xs font-medium text-[#9CA3AF] bg-[#F9FAFB] border border-[#E5E7EB]">
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
                            </>
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

      {/* Add / Invite Employee Modal (Zero Passwords) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-[20px] border border-[#E6E9F0] bg-white p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-[#0E1726]">
                  Invite Employee
                </h2>
                <p className="text-xs text-[#6B7488] mt-0.5">
                  Send a secure account activation link to add an employee with an assigned ITSM role.
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
                ) : (
                  /* Invited Successfully State */
                  <>
                    <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-[#166534]">
                          Activation invitation sent successfully!
                        </p>
                        <p className="text-[#15803D]">
                          A single-use activation link (valid for 24 hours) has been delivered to the employee. They will set their own password during setup.
                        </p>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] space-y-2 text-xs">
                      <div className="flex justify-between items-center py-1 border-b border-[#E6E9F0]">
                        <span className="text-[#6B7488]">Employee Email:</span>
                        <span className="font-mono font-semibold text-[#0E1726]">{modalResult.email}</span>
                      </div>
                      <div className="flex justify-between items-center py-1">
                        <span className="text-[#6B7488]">Assigned ITSM Role:</span>
                        <span className="font-semibold text-[#6D28D9]">
                          {modalResult.itsm_role.replace(/_/g, " ")}
                        </span>
                      </div>
                      {modalResult.delivery && (
                        <div className="flex justify-between items-center py-1 border-t border-[#E6E9F0]">
                          <span className="text-[#6B7488]">Delivery Channel:</span>
                          <span className="font-medium text-[#475069] capitalize">{modalResult.delivery}</span>
                        </div>
                      )}
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
            ) : (
              /* INVITATION FORM (Clean, Secure, Zero Passwords) */
              <form onSubmit={handleInviteSubmit} className="space-y-4">
                {/* Security Info Card */}
                <div className="p-3 rounded-xl bg-[#F5F3FF] border border-[#DDD6FE] flex items-start gap-2.5 text-xs text-[#5B21B6]">
                  <ShieldCheck className="w-4 h-4 text-[#6D28D9] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-semibold text-[#4C1D95]">Secure Account Activation</p>
                    <p className="text-[11px] text-[#6D28D9] leading-relaxed">
                      Zero temporary passwords: A single-use 24-hour activation link will be sent to the employee to set their own password securely.
                    </p>
                  </div>
                </div>

                {/* Email Field */}
                <div className="space-y-1">
                  <label htmlFor="invite-email" className="block text-xs font-semibold text-[#0E1726]">
                    Employee Email <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="invite-email"
                      type="email"
                      required
                      placeholder="employee@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      disabled={modalLoading}
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] placeholder-[#8E97A8] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
                    />
                  </div>
                </div>

                {/* ITSM Role Field */}
                <div className="space-y-1">
                  <label htmlFor="invite-role" className="block text-xs font-semibold text-[#0E1726]">
                    ITSM Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    disabled={modalLoading}
                    className="w-full px-3 py-2 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition"
                  >
                    <option value="REQUESTER">Requester (Self-service ticketing & portal)</option>
                    <option value="SERVICE_AGENT">Service Agent (Service desk & incident triage)</option>
                    <option value="INCIDENT_MANAGER">Incident Manager (Major incident response & war rooms)</option>
                    <option value="PROCESS_CHANGE_MANAGER">Process & Change Manager (Change enablement & CAB)</option>
                    <option value="PLATFORM_ADMINISTRATOR">Platform Administrator (Full ITSM administration)</option>
                    <option value="AUDITOR">Auditor (Read-only compliance & audit logging)</option>
                    <option value="CATALOG_MANAGER">Catalog Manager (Service catalog & intake forms)</option>
                    <option value="CMDB_ADMIN">CMDB Admin (Configuration items & CMDB)</option>
                  </select>
                </div>

                {/* Send Email Checkbox */}
                <div className="pt-1">
                  <label className="flex items-center gap-2 text-xs text-[#475069] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inviteSendEmail}
                      onChange={(e) => setInviteSendEmail(e.target.checked)}
                      disabled={modalLoading}
                      className="w-3.5 h-3.5 rounded border-[#D1D5DB] text-[#6D28D9] focus:ring-[#6D28D9]"
                    />
                    <span>Send activation email to the employee</span>
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
                        <span>Sending Invitation...</span>
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

      {/* Resend Confirmation Modal */}
      {actionType === "resend" && actionUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-[20px] border border-[#E6E9F0] bg-white p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#F5F3FF] border border-[#DDD6FE] flex items-center justify-center text-[#6D28D9] shrink-0">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#0E1726]">Resend Activation Invitation</h3>
                <p className="text-xs text-[#6B7488] leading-relaxed">
                  Are you sure you want to resend the activation invitation to{" "}
                  <strong className="text-[#0E1726]">{actionUser.email}</strong>?
                </p>
              </div>
            </div>

            <p className="text-[11px] text-[#6B7488] bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
              This will invalidate any previous activation link and issue a fresh 24-hour single-use activation email.
            </p>

            {actionError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-center gap-2 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#F0F2F5]">
              <button
                type="button"
                onClick={() => {
                  setActionType(null);
                  setActionUser(null);
                  setActionError(null);
                }}
                disabled={actionLoading}
                className="px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResendConfirm}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition disabled:opacity-50 shadow-xs"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Resending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Confirm Resend</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Confirmation Modal */}
      {actionType === "revoke" && actionUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-[20px] border border-[#E6E9F0] bg-white p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-center text-[#DC2626] shrink-0">
                <UserX className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#0E1726]">Revoke Activation Invitation</h3>
                <p className="text-xs text-[#6B7488] leading-relaxed">
                  Are you sure you want to revoke the pending invitation for{" "}
                  <strong className="text-[#0E1726]">{actionUser.email}</strong>?
                </p>
              </div>
            </div>

            <p className="text-[11px] text-[#991B1B] bg-[#FEF2F2] p-3 rounded-xl border border-[#FECACA]">
              The employee will immediately be prevented from activating their account using their existing link.
            </p>

            {actionError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-center gap-2 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#F0F2F5]">
              <button
                type="button"
                onClick={() => {
                  setActionType(null);
                  setActionUser(null);
                  setActionError(null);
                }}
                disabled={actionLoading}
                className="px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRevokeConfirm}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#DC2626] text-white text-xs font-semibold hover:bg-[#B91C1C] transition disabled:opacity-50 shadow-xs"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Revoking...</span>
                  </>
                ) : (
                  <>
                    <UserX className="w-3.5 h-3.5" />
                    <span>Confirm Revocation</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate User Modal */}
      {showDeactivateModal && userToDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-[20px] border border-[#E6E9F0] bg-white p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-center text-[#DC2626] shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#0E1726]">Deactivate User Account</h3>
                <p className="text-xs text-[#6B7488]">
                  Are you sure you want to deactivate{" "}
                  <strong className="text-[#0E1726]">{userToDeactivate.email}</strong>?
                </p>
              </div>
            </div>

            <p className="text-[11px] text-[#6B7488] leading-relaxed">
              This will revoke all active sessions and immediately disable their ITSM access.
            </p>

            {deactivateError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-center gap-2 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{deactivateError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#F0F2F5]">
              <button
                type="button"
                onClick={closeDeactivateModal}
                disabled={deactivateLoading}
                className="px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeactivateConfirm}
                disabled={deactivateLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#DC2626] text-white text-xs font-semibold hover:bg-[#B91C1C] transition disabled:opacity-50 shadow-xs"
              >
                {deactivateLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deactivating...</span>
                  </>
                ) : (
                  <span>Deactivate User</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
