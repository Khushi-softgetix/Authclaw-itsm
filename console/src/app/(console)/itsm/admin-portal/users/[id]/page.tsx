"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  Shield,
  ShieldAlert,
  Sparkles,
  User,
  UserCheck,
  UserX,
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

const ITSM_ROLES = [
  {
    value: "REQUESTER",
    label: "Requester",
    desc: "Submit incidents and view personal tickets.",
  },
  {
    value: "SERVICE_AGENT",
    label: "Service Agent",
    desc: "Manage and resolve assigned ITSM work.",
  },
  {
    value: "INCIDENT_MANAGER",
    label: "Incident Manager",
    desc: "Oversee incidents, queue distribution, and major incident triage.",
  },
  {
    value: "PROCESS_CHANGE_MANAGER",
    label: "Process & Change Manager",
    desc: "Manage problems, changes, and knowledge governance.",
  },
  {
    value: "PLATFORM_ADMINISTRATOR",
    label: "Platform Administrator",
    desc: "Manage ITSM platform access and configuration.",
  },
  {
    value: "AUDITOR",
    label: "Auditor",
    desc: "Read-only governance and audit review.",
  },
  {
    value: "CATALOG_MANAGER",
    label: "Catalog Manager",
    desc: "Manage Service Catalog offerings and intake forms.",
  },
  {
    value: "CMDB_ADMIN",
    label: "CMDB Admin",
    desc: "Maintain configuration items, relationships, schema, and imports.",
  },
];

export default function UserAccessDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.id as string;

  const [user, setUser] = useState<ITSMUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Current authenticated user session (for self-deletion protection)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Delete User Dialog state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Form state
  const [itsmAccess, setItsmAccess] = useState<boolean>(true);
  const [itsmRole, setItsmRole] = useState<string>("REQUESTER");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // Retrieve current session to prevent self-deletion
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

  useEffect(() => {
    async function loadUser() {
      if (!userId) return;
      setLoading(true);
      setError(null);
      try {
        let found: ITSMUser | null = null;
        // Try single user endpoint first
        const singleRes = await fetch(`/api/itsm/admin/users/${userId}`, { cache: "no-store" });
        if (singleRes.ok) {
          found = await singleRes.json();
        } else {
          // Fallback to querying user list (including inactive if needed)
          const listRes = await fetch("/api/itsm/admin/users?include_inactive=true", { cache: "no-store" });
          if (listRes.ok) {
            const users: ITSMUser[] = await listRes.json();
            found = users.find((u) => u.id === userId) || null;
          }
        }

        if (!found) {
          throw new Error("User not found or does not belong to your tenant.");
        }
        setUser(found);
        setItsmAccess(found.itsm_access);
        const initialRole =
          found.itsm_role === "SERVICE_LEAD"
            ? "INCIDENT_MANAGER"
            : found.itsm_role || "REQUESTER";
        setItsmRole(initialRole);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load user access details");
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, [userId]);

  const handleApplyNormalEmployeePreset = () => {
    setItsmAccess(true);
    setItsmRole("REQUESTER");
    setSaveSuccess(false);
    setSaveError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    try {
      const res = await fetch(`/api/itsm/admin/users/${user.id}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          has_itsm_access: itsmAccess,
          itsm_role: itsmRole,
          has_governance_access: user.governance_access,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || `Failed to update user access (${res.status})`);
      }

      const updated = await res.json();
      setUser((prev) =>
        prev
          ? {
              ...prev,
              itsm_access: updated.itsm_access,
              itsm_role: updated.itsm_role,
              governance_access: updated.governance_access,
            }
          : null
      );
      setItsmAccess(updated.itsm_access);
      setItsmRole(updated.itsm_role);
      setSaveSuccess(true);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Failed to save user access");
    } finally {
      setSaving(false);
    }
  };

  const isCurrentAdmin =
    Boolean(user) &&
    (user?.id === currentUserId ||
      (Boolean(currentUserEmail) && user?.email.toLowerCase() === currentUserEmail));

  const handleDeleteUser = async () => {
    if (!user) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/itsm/admin/users/${user.id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Failed to delete user (${res.status})`);
      }
      // Redirect back to users list
      router.push("/itsm/admin-portal/users");
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete user");
      setDeleting(false);
    }
  };

  const selectedRoleMeta = ITSM_ROLES.find((r) => r.value === itsmRole);

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-12">
      {/* Top Navigation & Breadcrumbs */}
      <div>
        <div className="flex items-center justify-between gap-4 mb-2">
          <Link
            href="/itsm/admin-portal/users"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B7488] hover:text-[#0E1726] transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Users</span>
          </Link>
          <div className="flex items-center gap-1.5 text-[11px] text-[#8E97A8]">
            <Link href="/itsm/admin-portal" className="hover:text-[#0E1726]">
              Platform Administration
            </Link>
            <span>/</span>
            <Link href="/itsm/admin-portal/users" className="hover:text-[#0E1726]">
              Users
            </Link>
            <span>/</span>
            <span className="text-[#0E1726] font-medium">User Access</span>
          </div>
        </div>

        <div>
          <h1 className="text-xl font-bold text-[#0E1726] tracking-tight">Edit ITSM Access</h1>
          <p className="text-xs text-[#6B7488] mt-0.5">
            Configure product entitlements and service management role for this tenant member.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-[#6D28D9]" />
          <p className="text-xs font-medium text-[#6B7488]">Loading user access details...</p>
        </div>
      ) : error || !user ? (
        <div className="p-6 rounded-[20px] border border-[#FCA5A5] bg-[#FEF2F2] flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-bold text-red-900">User Not Accessible</h2>
            <p className="text-xs text-red-700 mt-1">{error || "User record could not be loaded."}</p>
            <div className="mt-4">
              <Link
                href="/itsm/admin-portal/users"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-800 text-white text-xs font-medium hover:bg-red-900 transition"
              >
                Return to Users List
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Success Notification */}
          {saveSuccess && (
            <div className="p-3.5 rounded-[16px] bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-between text-xs text-[#065F46] animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[#059669]" />
                <span className="font-semibold">ITSM access changes saved successfully.</span>
              </div>
              <Link
                href="/itsm/admin-portal/users"
                className="text-[11px] font-semibold text-[#059669] hover:underline"
              >
                Return to Users →
              </Link>
            </div>
          )}

          {/* Error Notification */}
          {saveError && (
            <div className="p-3.5 rounded-[16px] bg-[#FEF2F2] border border-[#FCA5A5] flex items-center gap-2 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

      <form onSubmit={handleSave} className="space-y-4">
        {/* Section 1: User Identity */}
        <div className="p-5 rounded-xl border border-[#E5E7EB] bg-white shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#4B5565]">
              <User className="w-3.5 h-3.5 text-[#6B7280]" />
              <span>User</span>
            </div>
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
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE] flex items-center justify-center font-bold text-sm shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#111827]">{user.name}</p>
              <p className="text-[13px] font-normal text-[#374151] mt-0.5">{user.email}</p>
            </div>
          </div>

          <p className="mt-3 text-xs text-[#6B7280] border-t border-[#F3F4F6] pt-3">
            Authentication and passwords are managed by AuthClaw.
          </p>
        </div>

        {/* Section 2: ITSM Product Access */}
        <div className="p-5 rounded-xl border border-[#E5E7EB] bg-white shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#4B5565]">
                ITSM Product Access
              </label>
              <p className="text-xs text-[#6B7280] mt-0.5">
                Controls whether this user can access AuthClaw ITSM.
              </p>
            </div>

            {/* Segmented Control */}
            <div className="inline-flex rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setItsmAccess(true);
                  setSaveSuccess(false);
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold transition ${
                  itsmAccess
                    ? "bg-white text-[#6D28D9] shadow-xs"
                    : "text-[#4B5565] hover:text-[#111827]"
                }`}
              >
                <Check className="w-3 h-3" />
                <span>Enabled</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setItsmAccess(false);
                  setSaveSuccess(false);
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold transition ${
                  !itsmAccess
                    ? "bg-white text-[#DC2626] shadow-xs"
                    : "text-[#4B5565] hover:text-[#111827]"
                }`}
              >
                <span>Disabled</span>
              </button>
            </div>
          </div>
        </div>

        {/* Section 3: ITSM Role Assignment */}
        <div
          className={`p-5 rounded-xl border border-[#E5E7EB] bg-white shadow-xs transition-opacity ${
            !itsmAccess ? "opacity-60" : "opacity-100"
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div>
              <label htmlFor="itsm-role" className="block text-xs font-semibold uppercase tracking-wider text-[#4B5565]">
                ITSM Role
              </label>
              <p className="text-xs text-[#6B7280] mt-0.5">
                Assigns the specific operational or administrative responsibility.
              </p>
            </div>

            {/* Employee Preset Button */}
            <button
              type="button"
              onClick={handleApplyNormalEmployeePreset}
              className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border border-[#DDD6FE] bg-[#F5F3FF] text-xs font-semibold text-[#6D28D9] hover:bg-[#EDE9FE] transition self-start sm:self-auto shadow-xs"
              title="Quickly set as normal employee (REQUESTER role with ITSM access enabled)"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Configure as Normal Employee</span>
            </button>
          </div>

          <div className="space-y-2">
            <select
              id="itsm-role"
              disabled={!itsmAccess}
              value={itsmRole}
              onChange={(e) => {
                setItsmRole(e.target.value);
                setSaveSuccess(false);
              }}
              className="w-full h-10 px-3.5 rounded-lg border border-[#D1D5DB] bg-white text-xs font-medium text-[#111827] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {ITSM_ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label} ({role.value})
                </option>
              ))}
            </select>

            {selectedRoleMeta && (
              <div className="p-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-[#111827]">{selectedRoleMeta.label}: </span>
                  <span className="text-[#4B5565]">{selectedRoleMeta.desc}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 4: Governance Access State (Informational) */}
        <div className="p-5 rounded-xl border border-[#E5E7EB] bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#4B5565]">
                Governance Access
              </label>
              <p className="text-xs text-[#6B7280] mt-0.5">
                Governance access is managed separately from ITSM access.
              </p>
            </div>
            <div>
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
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          {/* Delete User Button */}
          <div>
            {isCurrentAdmin ? (
              <span
                className="inline-flex items-center justify-center h-9 px-3.5 rounded-lg text-xs font-medium text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] cursor-not-allowed"
                title="You cannot delete your own administrator account"
              >
                Cannot delete your own account
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setShowDeleteModal(true);
                }}
                className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-[#FCA5A5] bg-white text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] hover:border-[#DC2626] transition shadow-xs"
              >
                <UserX className="w-3.5 h-3.5" />
                <span>Delete User</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/itsm/admin-portal/users"
              className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-[#D1D5DB] bg-white text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB] hover:text-[#111827] transition shadow-xs"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold shadow-xs hover:bg-[#5B21B6] transition disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </div>
      </form>
      </>
      )}

      {/* Delete User Confirmation Dialog */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-[#DC2626]" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-[#111827]">
                  Delete User?
                </h2>
                <p className="text-xs text-[#4B5565] mt-1 leading-relaxed">
                  This will permanently remove this employee from the organization. They will no longer be able to log in or access ITSM.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="p-1 rounded-lg text-[#9CA3AF] hover:text-[#111827] hover:bg-[#F9FAFB] transition disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target User Summary Card */}
            {user && (
              <div className="p-3.5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-[#6B7280]">User:</span>
                  <span className="font-semibold text-[#111827]">{user.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#6B7280]">Email:</span>
                  <span className="text-[#374151] font-medium">{user.email}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#6B7280]">ITSM Role:</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]">
                    {user.itsm_role.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            )}

            {deleteError && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-start gap-2.5 text-red-800 text-xs">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <p className="flex-1">{deleteError}</p>
              </div>
            )}

            {/* Dialog Buttons: Cancel and Delete User */}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-[#D1D5DB] bg-white text-xs font-semibold text-[#374151] hover:bg-[#F9FAFB] transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={deleting}
                className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg border border-[#FCA5A5] bg-white text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] hover:border-[#DC2626] transition disabled:opacity-50 shadow-xs"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <UserX className="w-3.5 h-3.5" />
                    <span>Delete User</span>
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
