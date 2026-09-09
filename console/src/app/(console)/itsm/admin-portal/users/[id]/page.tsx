"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  Shield,
  ShieldAlert,
  Sparkles,
  User,
  UserCheck,
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
];

export default function UserAccessDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.id as string;

  const [user, setUser] = useState<ITSMUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [itsmAccess, setItsmAccess] = useState<boolean>(true);
  const [itsmRole, setItsmRole] = useState<string>("REQUESTER");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function loadUser() {
      if (!userId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/itsm/admin/users", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Failed to load users (${res.status})`);
        }
        const users: ITSMUser[] = await res.json();
        const found = users.find((u) => u.id === userId);
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
        <div className="p-5 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#6B7488]">
              <User className="w-3.5 h-3.5 text-[#8E97A8]" />
              <span>User</span>
            </div>
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                user.status === "active" ? "text-[#059669]" : "text-[#9CA3AF]"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  user.status === "active" ? "bg-[#10B981]" : "bg-[#9CA3AF]"
                }`}
              />
              {user.status === "active" ? "Active" : "Inactive"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#F1ECFE] text-[#6D28D9] flex items-center justify-center font-bold text-sm">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-bold text-[#0E1726]">{user.name}</p>
              <p className="text-xs text-[#6B7488]">{user.email}</p>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-[#8E97A8] border-t border-[#F0F2F5] pt-2.5">
            Authentication and passwords are managed by AuthClaw.
          </p>
        </div>

        {/* Section 2: ITSM Product Access */}
        <div className="p-5 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#6B7488]">
                ITSM Product Access
              </label>
              <p className="text-xs text-[#6B7488] mt-1">
                Controls whether this user can access AuthClaw ITSM.
              </p>
            </div>

            {/* Segmented Control */}
            <div className="inline-flex rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] p-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setItsmAccess(true);
                  setSaveSuccess(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  itsmAccess
                    ? "bg-white text-[#6D28D9] shadow-xs"
                    : "text-[#6B7488] hover:text-[#0E1726]"
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  !itsmAccess
                    ? "bg-white text-[#DC2626] shadow-xs"
                    : "text-[#6B7488] hover:text-[#0E1726]"
                }`}
              >
                <span>Disabled</span>
              </button>
            </div>
          </div>
        </div>

        {/* Section 3: ITSM Role Assignment */}
        <div
          className={`p-5 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] transition-opacity ${
            !itsmAccess ? "opacity-60" : "opacity-100"
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <div>
              <label htmlFor="itsm-role" className="block text-xs font-bold uppercase tracking-wider text-[#6B7488]">
                ITSM Role
              </label>
              <p className="text-xs text-[#6B7488] mt-0.5">
                Assigns the specific operational or administrative responsibility.
              </p>
            </div>

            {/* Employee Preset Button */}
            <button
              type="button"
              onClick={handleApplyNormalEmployeePreset}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#DDD6FE] bg-[#F1ECFE] text-xs font-semibold text-[#6D28D9] hover:bg-[#E9E2FD] transition self-start sm:self-auto"
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
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs font-medium text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {ITSM_ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label} ({role.value})
                </option>
              ))}
            </select>

            {selectedRoleMeta && (
              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-[#0E1726]">{selectedRoleMeta.label}: </span>
                  <span className="text-[#475069]">{selectedRoleMeta.desc}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 4: Governance Access State (Informational) */}
        <div className="p-5 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)]">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#6B7488]">
                Governance Access
              </label>
              <p className="text-[11px] text-[#8E97A8] mt-1">
                Governance access is managed separately from ITSM access.
              </p>
            </div>
            <div>
              {user.governance_access ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
                  <Shield className="w-3.5 h-3.5 text-[#2563EB]" />
                  Enabled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]">
                  Disabled
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/itsm/admin-portal/users"
            className="px-4 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA] hover:text-[#0E1726] transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold shadow-xs hover:bg-[#5B21B6] transition disabled:opacity-50"
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
      </form>
      </>
      )}
    </div>
  );
}
