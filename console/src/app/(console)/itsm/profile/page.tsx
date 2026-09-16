"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building,
  CheckCircle2,
  Clock,
  Key,
  LogOut,
  ShieldCheck,
  User,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";

interface SessionInfo {
  userId?: string;
  userEmail?: string;
  tenantId?: string;
  tenantName?: string;
  itsmRole?: string;
  platformRole?: string;
  authenticatedAt?: string;
}

export default function RequesterProfilePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);

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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#F3E8FF] text-[#6D28D9] flex items-center justify-center shrink-0 font-bold text-lg">
            {session?.userEmail ? session.userEmail.slice(0, 2).toUpperCase() : "RQ"}
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-[#0E1726] tracking-tight">
              Requester Profile
            </h1>
            <p className="text-xs text-[#6B7488] mt-1">
              Your authenticated AuthClaw user session and workspace entitlement details.
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
                {loading ? "Loading..." : session?.userEmail || "requester@authclaw.com"}
              </span>
            </div>

            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                ITSM Role
              </span>
              <div className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-[11px] font-bold border border-[#A78BFA]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{session?.itsmRole || "REQUESTER"}</span>
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
              <span className="text-xs font-medium text-[#0E1726] mt-0.5 block">
                AuthClaw ITSM Requester Self-Service
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
