"use client";

import { useEffect, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  CheckCircle2,
  KeyRound,
  Layers,
  LogOut,
  Mail,
  Server,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { SupportScopeResponse } from "@/lib/itsm-types";

interface SessionInfo {
  userEmail?: string;
  tenantId?: string;
  tenantName?: string;
  itsmRole?: string;
}

const ROLE_PROFILE: Record<string, { title: string; label: string; subtitle: string; access: string[] }> = {
  "REQUESTER": {
    title: "Requester Profile",
    label: "Requester",
    subtitle: "Your account and access to employee self-service.",
    access: ["Submit and follow your requests", "View services available to you", "Receive relevant service communications"],
  },
  "SERVICE_AGENT": {
    title: "Service Agent Profile",
    label: "Service Agent",
    subtitle: "Your account, support scope, and operational workspace access.",
    access: ["Work within assigned support teams", "Support authorized services", "Use approved operational guidance"],
  },
  "INCIDENT_MANAGER": {
    title: "Incident Manager Profile",
    label: "Incident Manager",
    subtitle: "Your account and access to incident command and service communication.",
    access: ["Coordinate incident operations", "Manage outage communications", "Review operational performance"],
  },
  "PROCESS_CHANGE_MANAGER": {
    title: "Problem and Change Manager Profile",
    label: "Problem and Change Manager",
    subtitle: "Your account and access to problem and change governance.",
    access: ["Manage authorized problems", "Coordinate approved changes", "Review related service impact"],
  },
  "PLATFORM_ADMINISTRATOR": {
    title: "Platform Administrator Profile",
    label: "Platform Administrator",
    subtitle: "Your account and access to ITSM platform configuration.",
    access: ["Configure authorized platform settings", "Manage service administration", "Review technical delivery health"],
  },
  "AUDITOR": {
    title: "Auditor Profile",
    label: "Auditor",
    subtitle: "Your account and read-only access to authorized audit evidence.",
    access: ["Review immutable audit evidence", "Inspect outage communication history", "Prepare authorized reports and exports"],
  },
  "ITSM_AUDITOR": {
    title: "Auditor Profile",
    label: "Auditor",
    subtitle: "Your account and read-only access to authorized audit evidence.",
    access: ["Review immutable audit evidence", "Inspect outage communication history", "Prepare authorized reports and exports"],
  },
  "CATALOG_MANAGER": {
    title: "Catalog Manager Profile",
    label: "Catalog Manager",
    subtitle: "Your account and access to service catalog management.",
    access: ["Manage catalog offerings", "Maintain request intake forms", "Review catalog responsibilities"],
  },
};

const DEFAULT_PROFILE = {
  title: "ITSM Profile",
  label: "ITSM User",
  subtitle: "Your AuthClaw account and workspace access.",
  access: ["Use your authorized workspace", "Access tenant-scoped records", "Work within assigned permissions"],
};

function getRoleProfile(role?: string) {
  return ROLE_PROFILE[String(role || "").toUpperCase()] || DEFAULT_PROFILE;
}

function getRoleProfileTitle(role?: string) {
  return getRoleProfile(role).title;
}

function getRoleSubtitle(role?: string) {
  return getRoleProfile(role).subtitle;
}

function getRoleBadgeLabel(role?: string) {
  return getRoleProfile(role).label;
}

function getProductEntitlement(role?: string) {
  return role?.toUpperCase() === "REQUESTER" ? "AuthClaw ITSM Requester Self-Service" : "AuthClaw ITSM";
}

function getAvatarInitials(email?: string, role?: string) {
  const words = getRoleBadgeLabel(role).split(" ").filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return email?.slice(0, 2).toUpperCase() || "IT";
}

function DetailRow({ icon: Icon, label, value, detail, mono = false }: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 py-4 first:pt-0 last:pb-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F4F0FF] text-[#6D28D9]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-[#667085]">{label}</p>
        <p className={`mt-1 break-words text-sm font-semibold text-[#172033] ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
        {detail ? <p className="mt-1 text-xs leading-5 text-[#667085]">{detail}</p> : null}
      </div>
    </div>
  );
}

export default function ITSMProfilePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [supportScope, setSupportScope] = useState<SupportScopeResponse | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session")
      .then((response) => {
        if (!response.ok) throw new Error("Profile details could not be loaded.");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        setSession({
          userEmail: data.userEmail || data.email,
          tenantId: data.tenantId || data.tenant_id,
          tenantName: data.tenantName || data.tenant_name,
          itsmRole: data.itsmRole || data.itsm_role || "REQUESTER",
        });
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : "Profile details could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (session?.itsmRole?.toUpperCase() !== "SERVICE_AGENT") return;
    let active = true;
    fetch("/api/itsm/services/my-scope")
      .then((response) => {
        if (!response.ok) throw new Error("Support scope could not be loaded.");
        return response.json();
      })
      .then((data: SupportScopeResponse) => {
        if (active) setSupportScope(data);
      })
      .catch(() => {
        if (active) setSupportScope({ teams: [], services: [], catalog_items: [] });
      });
    return () => { active = false; };
  }, [session?.itsmRole]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/itsm/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-5" aria-label="Loading profile">
        <div className="h-40 animate-pulse rounded-2xl border border-[#E6E9F0] bg-white" />
        <div className="grid gap-5 md:grid-cols-2"><div className="h-72 animate-pulse rounded-2xl bg-white" /><div className="h-72 animate-pulse rounded-2xl bg-white" /></div>
      </div>
    );
  }

  if (loadError || !session) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-[#FECACA] bg-white p-8 text-center shadow-sm" role="alert">
        <h1 className="text-xl font-bold text-[#172033]">Profile unavailable</h1>
        <p className="mt-2 text-sm text-[#667085]">{loadError || "Your profile details could not be loaded."}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-lg bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#5B21B6]">Try again</button>
      </div>
    );
  }

  const role = session.itsmRole;
  const profile = getRoleProfile(role);
  const isServiceAgent = role?.toUpperCase() === "SERVICE_AGENT";
  const scopeLoading = isServiceAgent && supportScope === null;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8">
      <section className="overflow-hidden rounded-2xl border border-[#E1E5EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#6D28D9] text-lg font-bold text-white shadow-[0_10px_24px_-12px_rgba(109,40,217,0.75)]">
              {getAvatarInitials(session.userEmail, role)}
            </div>
            <div className="min-w-0">
              <h1 id="profile-role-title" className="text-2xl font-bold tracking-tight text-[#172033]">{getRoleProfileTitle(role)}</h1>
              <p className="mt-1 truncate text-sm font-medium text-[#475467]">{session.userEmail}</p>
              <p id="profile-role-subtitle" className="mt-1 text-sm leading-5 text-[#667085]">{getRoleSubtitle(role)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-4 text-sm font-semibold text-[#344054] transition hover:border-[#FDA29B] hover:bg-[#FFF5F5] hover:text-[#B42318] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]/25 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {loggingOut ? "Signing out…" : "Sign Out"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#EAECF0] bg-[#FCFCFD] px-6 py-3 text-xs sm:px-7">
          <span id="profile-role-badge" className="inline-flex items-center gap-1.5 font-semibold text-[#5B21B6]"><ShieldCheck className="h-3.5 w-3.5" />{getRoleBadgeLabel(role)}</span>
          <span className="inline-flex items-center gap-1.5 font-medium text-[#027A48]"><CheckCircle2 className="h-3.5 w-3.5" />Active account</span>
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[#667085]"><Building2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{session.tenantName || "Current tenant"}</span></span>
        </div>
      </section>

      <section className="grid overflow-hidden rounded-2xl border border-[#E1E5EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] md:grid-cols-2 md:divide-x md:divide-[#EAECF0]">
        <div className="p-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-[#172033]">Account details</h2>
            <p className="mt-1 text-xs leading-5 text-[#667085]">Identity details used across your AuthClaw workspace.</p>
          </div>
          <div className="divide-y divide-[#EAECF0]">
            <DetailRow icon={Mail} label="Email Address" value={session.userEmail || "Not available"} />
            <DetailRow icon={ShieldCheck} label="ITSM Role" value={getRoleBadgeLabel(role)} detail="Your role and permissions are managed by your organization." />
            <DetailRow icon={CheckCircle2} label="Account Status" value="Active" detail="Your authenticated session is currently available." />
          </div>
        </div>

        <div className="border-t border-[#EAECF0] p-6 md:border-t-0">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-[#172033]">Workspace access</h2>
            <p className="mt-1 text-xs leading-5 text-[#667085]">The organization and product currently connected to your session.</p>
          </div>
          <div className="divide-y divide-[#EAECF0]">
            <DetailRow icon={Building2} label="Active tenant" value={session.tenantName || "Current tenant"} />
            <DetailRow icon={Layers} label="Tenant Identifier" value={session.tenantId || "Not available"} mono />
            <div id="profile-product-entitlement"><DetailRow icon={Server} label="Product access" value={getProductEntitlement(role)} /></div>
            <DetailRow icon={KeyRound} label="Authentication Protocol" value="Secure AuthClaw session" detail="Signing out securely ends this browser session." />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[#E1E5EC] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F4F0FF] text-[#6D28D9]"><UserRound className="h-4 w-4" /></span>
          <div><h2 className="text-base font-semibold text-[#172033]">Your workspace access</h2><p className="mt-1 text-xs leading-5 text-[#667085]">A simple summary of how this role is used. Record-level permissions and tenant scope still apply.</p></div>
        </div>
        <ul className="mt-5 grid gap-3 sm:grid-cols-3">
          {profile.access.map((item) => (
            <li key={item} className="flex items-start gap-2.5 rounded-xl border border-[#EAECF0] bg-[#FCFCFD] p-4 text-sm font-medium leading-5 text-[#344054]">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EDE9FE] text-[#6D28D9]"><Check className="h-3 w-3" /></span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      {isServiceAgent ? (
        <section id="my-support-scope-card" className="rounded-2xl border border-[#E1E5EC] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EAECF0] pb-4">
            <div><h2 className="text-base font-semibold text-[#172033]">My Support Scope</h2><p className="mt-1 text-xs leading-5 text-[#667085]">Teams and services currently assigned to your support role.</p></div>
            <span className="rounded-full bg-[#F1ECFE] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#5B21B6]">Read only</span>
          </div>
          {scopeLoading ? <p className="py-8 text-sm text-[#667085]">Loading support scope…</p> : (
            <div className="grid gap-6 pt-5 md:grid-cols-3">
              <ScopeList title="Assigned teams" icon={Users} items={(supportScope?.teams || []).map((item) => item.name)} empty="No team assigned" />
              <ScopeList title="Supported services" icon={Server} items={(supportScope?.services || []).map((item) => item.name)} empty="No supported service assigned" />
              <ScopeList title="Catalog responsibilities" icon={CheckCircle2} items={(supportScope?.catalog_items || []).map((item) => item.name)} empty="No catalog responsibility assigned" />
            </div>
          )}
        </section>
      ) : null}

      <p className="px-1 text-center text-xs leading-5 text-[#667085]">Profile details and role assignments are managed by your organization.</p>
    </div>
  );
}

function ScopeList({ title, icon: Icon, items, empty }: { title: string; icon: ComponentType<{ className?: string }>; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-xs font-semibold text-[#344054]"><Icon className="h-4 w-4 text-[#6D28D9]" />{title}</h3>
      {items.length ? <ul className="mt-3 space-y-2">{items.map((item) => <li key={item} className="rounded-lg border border-[#EAECF0] bg-[#FCFCFD] px-3 py-2 text-xs font-medium text-[#475467]">{item}</li>)}</ul> : <p className="mt-3 text-xs text-[#98A2B3]">{empty}</p>}
    </div>
  );
}
