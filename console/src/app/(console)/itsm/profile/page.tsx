"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building,
  CheckCircle2,
  Clock,
  Key,
  Layers,
  LogOut,
  Server,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import type { SupportScopeResponse } from "@/lib/itsm-types";

interface SessionInfo {
  userId?: string;
  userEmail?: string;
  tenantId?: string;
  tenantName?: string;
  itsmRole?: string;
  platformRole?: string;
  productAccess?: { governance?: boolean; itsm?: boolean };
  authenticatedAt?: string;
}

function getRoleProfileTitle(role?: string): string {
  switch (role?.toUpperCase()) {
    case "REQUESTER":
      return "Requester Profile";
    case "SERVICE_AGENT":
      return "Service Agent Profile";
    case "INCIDENT_MANAGER":
      return "Incident Manager Profile";
    case "PROCESS_CHANGE_MANAGER":
      return "Problem and Change Manager Profile";
    case "PLATFORM_ADMINISTRATOR":
      return "Platform Administrator Profile";
    case "AUDITOR":
    case "ITSM_AUDITOR":
      return "Auditor Profile";
    case "CATALOG_MANAGER":
      return "Catalog Manager Profile";
    case "CMDB_ADMIN":
      return "CMDB Admin Profile";
    default:
      return "ITSM Profile";
  }
}

function getRoleSubtitle(role?: string): string {
  switch (role?.toUpperCase()) {
    case "REQUESTER":
      return "Your authenticated employee self-service session and workspace entitlement details.";
    case "SERVICE_AGENT":
      return "Your authenticated service agent session and operational queue entitlement details.";
    case "INCIDENT_MANAGER":
      return "Your authenticated incident management session and command center entitlement details.";
    case "PROCESS_CHANGE_MANAGER":
      return "Your authenticated problem and change governance session entitlement details.";
    case "PLATFORM_ADMINISTRATOR":
      return "Your authenticated platform administrator session and workspace management scope.";
    case "AUDITOR":
    case "ITSM_AUDITOR":
      return "Your authenticated compliance auditor session and audit trail inspection scope.";
    case "CATALOG_MANAGER":
      return "Your authenticated catalog management session for managing Service Catalog offerings and request intake forms.";
    case "CMDB_ADMIN":
      return "Your authenticated CMDB management session for managing Configuration Items, relationships, schemas, and imports.";
    default:
      return "Your authenticated AuthClaw user session and workspace entitlement details.";
  }
}

function getProductEntitlement(role?: string): string {
  if (role?.toUpperCase() === "REQUESTER") {
    return "AuthClaw ITSM Requester Self-Service";
  }
  return "AuthClaw ITSM";
}

function getRoleBadgeLabel(role?: string): string {
  switch (role?.toUpperCase()) {
    case "REQUESTER":
      return "Requester";
    case "SERVICE_AGENT":
      return "Service Agent";
    case "INCIDENT_MANAGER":
      return "Incident Manager";
    case "PROCESS_CHANGE_MANAGER":
      return "Problem and Change Manager";
    case "PLATFORM_ADMINISTRATOR":
      return "Platform Administrator";
    case "AUDITOR":
    case "ITSM_AUDITOR":
      return "Auditor";
    case "CATALOG_MANAGER":
      return "Catalog Manager";
    case "CMDB_ADMIN":
      return "CMDB Admin";
    default:
      return role || "REQUESTER";
  }
}

function getAvatarInitials(email?: string, role?: string): string {
  switch (role?.toUpperCase()) {
    case "SERVICE_AGENT":
      return "AG";
    case "INCIDENT_MANAGER":
      return "IM";
    case "PROCESS_CHANGE_MANAGER":
      return "PM";
    case "PLATFORM_ADMINISTRATOR":
      return "AD";
    case "AUDITOR":
    case "ITSM_AUDITOR":
      return "AU";
    case "CATALOG_MANAGER":
      return "CM";
    case "CMDB_ADMIN":
      return "CA";
    case "REQUESTER":
      return "RQ";
  }
  if (email && email.length >= 2) {
    return email.slice(0, 2).toUpperCase();
  }
  return "RQ";
}

export default function ITSMProfilePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);
  const [supportScope, setSupportScope] = useState<SupportScopeResponse | null>(null);
  const [scopeLoading, setScopeLoading] = useState<boolean>(false);

  useEffect(() => {
    async function loadSession() {
      try {
        setLoading(true);
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          setSession({
            userId: data.userId || data.id,
            userEmail: data.userEmail || data.email,
            tenantId: data.tenantId,
            tenantName: data.tenantName,
            itsmRole: data.itsmRole || "REQUESTER",
            platformRole: data.platformRole || "NONE",
            productAccess: data.productAccess,
            authenticatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        // Non-blocking fallback
      } finally {
        setLoading(false);
      }
    }
    loadSession();
  }, []);

  useEffect(() => {
    if (session?.itsmRole?.toUpperCase() === "SERVICE_AGENT") {
      setScopeLoading(true);
      fetch("/api/itsm/services/my-scope")
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load support scope");
          return res.json();
        })
        .then((data: SupportScopeResponse) => {
          setSupportScope(data);
        })
        .catch((err) => {
          console.error("Support scope fetch error:", err);
          setSupportScope({ teams: [], services: [], catalog_items: [] });
        })
        .finally(() => {
          setScopeLoading(false);
        });
    }
  }, [session?.itsmRole]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/itsm/login");
      router.refresh();
    } catch (error) {
      console.error("Failed to log out:", error);
    } finally {
      setLoggingOut(false);
    }
  };

  const role = session?.itsmRole;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#F3E8FF] text-[#6D28D9] flex items-center justify-center shrink-0 font-bold text-lg">
            {getAvatarInitials(session?.userEmail, role)}
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-[#0E1726] tracking-tight" id="profile-role-title">
              {getRoleProfileTitle(role)}
            </h1>
            <p className="text-xs text-[#6B7488] mt-1" id="profile-role-subtitle">
              {getRoleSubtitle(role)}
            </p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-bold border border-red-200 transition disabled:opacity-50"
        >
          <LogOut className="w-4 h-4" />
          <span>{loggingOut ? "Signing out..." : "Sign Out"}</span>
        </button>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profile Identity Card */}
        <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-[#E6E9F0] pb-3 text-[#0E1726]">
            <User className="w-4 h-4 text-[#6D28D9]" />
            <h2 className="text-sm font-bold">Account Identity</h2>
          </div>

          <div className="space-y-3.5 text-xs">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                Email Address
              </span>
              <span className="text-xs font-bold text-[#0E1726] mt-0.5 block">
                {loading ? "Loading..." : session?.userEmail || "user@authclaw.com"}
              </span>
            </div>

            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                ITSM Role
              </span>
              <div className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-[11px] font-bold border border-[#A78BFA]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span id="profile-role-badge">{getRoleBadgeLabel(role)}</span>
              </div>
            </div>

            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                Account Status
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 mt-0.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Active Session
              </span>
            </div>
          </div>
        </div>

        {/* Active Tenant / Workspace Card */}
        <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-[#E6E9F0] pb-3 text-[#0E1726]">
            <Building className="w-4 h-4 text-[#6D28D9]" />
            <h2 className="text-sm font-bold">Active Workspace</h2>
          </div>

          <div className="space-y-3.5 text-xs">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                Tenant Identifier
              </span>
              <span className="font-mono text-xs font-semibold text-[#475069] mt-0.5 block truncate">
                {loading ? "Loading..." : session?.tenantId || "Default Tenant"}
              </span>
            </div>

            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                Product Entitlement
              </span>
              <span className="text-xs font-medium text-[#0E1726] mt-0.5 block" id="profile-product-entitlement">
                {getProductEntitlement(role)}
              </span>
            </div>

            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                Authentication Protocol
              </span>
              <span className="text-xs font-medium text-[#0E1726] mt-0.5 block">
                AuthClaw Session Token Cookie (`authclaw_session`)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Role-Specific Support Scope (SERVICE_AGENT only) */}
      {role?.toUpperCase() === "SERVICE_AGENT" && (
        <div
          id="my-support-scope-card"
          className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-5"
        >
          <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3 text-[#0E1726]">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#6D28D9]" />
              <h2 className="text-sm font-bold">My Support Scope</h2>
            </div>
            <span className="text-[10px] font-bold text-[#6D28D9] bg-[#F1ECFE] border border-[#A78BFA] px-2.5 py-0.5 rounded-full">
              Read-Only
            </span>
          </div>

          <div className="space-y-4">
            {/* A. Assigned Team(s) */}
            <div className="space-y-1.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                Assigned Team(s)
              </span>
              {scopeLoading ? (
                <p className="text-xs text-[#6B7488]">Loading assigned teams...</p>
              ) : !supportScope || supportScope.teams.length === 0 ? (
                <p className="text-xs text-[#6B7488] italic">No team assigned</p>
              ) : (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {supportScope.teams.map((team) => (
                    <span
                      key={team.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 text-[#0E1726] text-xs font-semibold border border-[#E6E9F0] shadow-sm"
                      title={team.description || undefined}
                    >
                      <Users className="w-3.5 h-3.5 text-[#6D28D9]" />
                      <span>{team.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* B. Supported Services */}
            <div className="space-y-1.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                Supported Services
              </span>
              {scopeLoading ? (
                <p className="text-xs text-[#6B7488]">Loading supported services...</p>
              ) : !supportScope || supportScope.services.length === 0 ? (
                <p className="text-xs text-[#6B7488] italic">No supported services assigned</p>
              ) : (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {supportScope.services.map((svc) => (
                    <span
                      key={svc.id}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-purple-50/60 text-[#3B1261] text-xs font-medium border border-purple-100 shadow-sm"
                      title={svc.description || undefined}
                    >
                      <Server className="w-3.5 h-3.5 text-[#6D28D9]" />
                      <span className="font-semibold text-[#0E1726]">{svc.name}</span>
                      {svc.tier && (
                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-white text-[#6D28D9] border border-purple-200">
                          {svc.tier.replace(/_/g, " ")}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* C. Service Catalog Responsibilities */}
            <div className="space-y-1.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                Service Catalog Responsibilities
              </span>
              {scopeLoading ? (
                <p className="text-xs text-[#6B7488]">Loading service catalog responsibilities...</p>
              ) : !supportScope || supportScope.catalog_items.length === 0 ? (
                <p className="text-xs text-[#6B7488] italic">No service catalog responsibilities assigned</p>
              ) : (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {supportScope.catalog_items.map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50/60 text-emerald-950 text-xs font-medium border border-emerald-200/70 shadow-sm"
                      title={item.description || undefined}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="font-semibold text-[#0E1726]">{item.name}</span>
                      {item.service_name && (
                        <span className="text-[10px] text-emerald-700 bg-white/80 px-1.5 py-0.5 rounded border border-emerald-200">
                          {item.service_name}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Security & Logout Banner */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-[20px] border border-purple-100 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-xs font-bold text-[#0E1726] flex items-center gap-2">
            <Key className="w-4 h-4 text-[#6D28D9]" />
            <span>Session Protection &amp; Privacy</span>
          </h3>
          <p className="text-[11px] text-[#6B7488] max-w-xl">
            Your session is secured via AuthClaw RBAC and tenant isolation. When you log out, your authentication token will be cleared.
          </p>
        </div>

        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="shrink-0 px-5 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-50"
        >
          {loggingOut ? "Signing Out..." : "Sign Out Now"}
        </button>
      </div>
    </div>
  );
}
