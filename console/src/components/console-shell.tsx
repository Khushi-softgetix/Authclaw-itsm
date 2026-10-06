"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart3,
  AlertTriangle,
  Bell,
  BellRing,
  BookOpen,
  Building,
  Cable,
  ChevronDown,
  ClipboardCheck,
  Cloud,
  Database,
  Download,
  FileCheck,
  FolderSearch,
  GitPullRequest,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  User,
  X,
} from "lucide-react";
import NotificationBell from "@/components/notification-bell";

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: string[];
  itsmRoles?: string[];
  children?: {
    name: string;
    href: string;
    icon?: React.ComponentType<{ className?: string }>;
  }[];
}

interface ConsoleShellProps {
  children: React.ReactNode;
  userEmail: string;
  tenantId: string;
  tenantName: string;
  userRole: string;
  platformRole?: string;
  itsmRole?: string | null;
}

const ITSM_ROLE_LABELS: Record<string, string> = {
  REQUESTER: "Requester",
  SERVICE_AGENT: "Service Agent",
  INCIDENT_MANAGER: "Incident Manager",
  SERVICE_LEAD: "Incident Manager",
  PROCESS_CHANGE_MANAGER: "Problem and Change Manager",
  PLATFORM_ADMINISTRATOR: "Platform Administrator",
  AUDITOR: "Auditor",
};

const readRoles = ["owner", "admin", "developer", "operator", "viewer"];

const navigation: NavItem[] = [
  { name: "Overview", href: "/overview", icon: LayoutDashboard, roles: readRoles },
  { name: "Compliance & Governance", href: "/compliance", icon: ShieldCheck, roles: readRoles },
  { name: "Approvals", href: "/approvals", icon: ClipboardCheck, roles: readRoles },
  { name: "Audit", href: "/audit", icon: ScrollText, roles: readRoles },
  { name: "Agent & Remediation", href: "/agent", icon: MessageSquare, roles: readRoles },
  { name: "Integrations", href: "/connect", icon: Cable, roles: ["owner", "admin"] },
  { name: "Policies & Guardrails", href: "/policies", icon: ShieldAlert, roles: ["owner", "admin"] },
  { name: "Risk & Red Teaming", href: "/risk", icon: ShieldAlert, roles: readRoles },
  { name: "Evidence", href: "/evidence", icon: ScrollText, roles: readRoles },
  { name: "Findings", href: "/findings", icon: ShieldAlert, roles: readRoles },
  { name: "Cloud", href: "/aws", icon: Cloud, roles: ["owner", "admin"] },
  { name: "Settings", href: "/settings", icon: Settings, roles: ["owner", "admin"] },
];

const itsmNavigation: NavItem[] = [
  { name: "Dashboard", href: "/itsm/dashboard", icon: LayoutDashboard, roles: readRoles },
  { 
    name: "Incident Management", 
    href: "/itsm/incidents-group", 
    icon: Ticket, 
    roles: readRoles,
    children: [
      { name: "Incidents", href: "/itsm/incidents" },
      { name: "Major Incidents", href: "/itsm/incident-manager/major-incidents" },
      { name: "Outage & Alerts", href: "/itsm/outage-alerts" },
    ]
  },
  { name: "Requests", href: "/itsm/requests", icon: ClipboardCheck, roles: readRoles },
  { name: "Knowledge", href: "/itsm/knowledge", icon: BookOpen, roles: readRoles },
  { name: "Services", href: "/itsm/services", icon: Layers, roles: readRoles },
  { name: "Problems & Changes", href: "/itsm/changes", icon: GitPullRequest, roles: readRoles },
  { name: "CMDB", href: "/itsm/cmdb", icon: Database, roles: readRoles },
  { name: "Reports & Audit", href: "/itsm/reports", icon: FileCheck, roles: readRoles },
];

const serviceAgentNavigation: NavItem[] = [
  { name: "My Work", href: "/itsm/dashboard/agent", icon: LayoutDashboard, roles: readRoles },
  { 
    name: "Incident Management", 
    href: "/itsm/incidents-group", 
    icon: Ticket, 
    roles: readRoles,
    children: [
      { name: "Incidents", href: "/itsm/incidents" },
    ]
  },
  { name: "Requests", href: "/itsm/requests", icon: ClipboardCheck, roles: readRoles },
  { name: "Knowledge", href: "/itsm/knowledge", icon: BookOpen, roles: readRoles },
  { name: "Services", href: "/itsm/services", icon: Layers, roles: readRoles },
];

const auditorNavigation: NavItem[] = [
  { name: "Overview", href: "/itsm/dashboard/auditor?section=overview", icon: LayoutDashboard, roles: readRoles },
  { name: "Audit Log", href: "/itsm/dashboard/auditor?section=audit-log", icon: ScrollText, roles: readRoles },
  { name: "Evidence", href: "/itsm/dashboard/auditor?section=evidence", icon: FolderSearch, roles: readRoles },
  { name: "Reports", href: "/itsm/dashboard/auditor?section=reports", icon: BarChart3, roles: readRoles },
  { name: "Exports", href: "/itsm/dashboard/auditor?section=exports", icon: Download, roles: readRoles },
];

const problemChangeNavigation: NavItem[] = [
  { name: "Dashboard", href: "/itsm/problem-change-manager", icon: LayoutDashboard, roles: readRoles },
  { name: "Problems", href: "/itsm/problem-change-manager/problems", icon: AlertTriangle, roles: readRoles },
  { name: "Changes", href: "/itsm/problem-change-manager/changes", icon: GitPullRequest, roles: readRoles },
  { name: "Knowledge", href: "/itsm/knowledge", icon: BookOpen, roles: readRoles },
];

export default function ConsoleShell({ children, userEmail, tenantId, tenantName, userRole, platformRole = "NONE", itsmRole }: ConsoleShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const normalizedRole = userRole?.toLowerCase() || "viewer";
  const hasPlatformAccess = platformRole.toUpperCase() === "ADMIN";
  const isItsm = pathname.startsWith("/itsm");
  const effectiveItsmRole = (
    itsmRole || (platformRole === "SUPER_ADMIN" ? "PLATFORM_ADMINISTRATOR" : "REQUESTER")
  ).toUpperCase();
  const displayedRole = isItsm
    ? (itsmRole && ITSM_ROLE_LABELS[itsmRole.toUpperCase()]) || itsmRole?.replace(/_/g, " ") || "Requester"
    : (hasPlatformAccess ? "platform admin" : normalizedRole);
  const auditorSection = searchParams.get("section") || "overview";

  const activeNavigationList = isItsm
    ? effectiveItsmRole === "REQUESTER"
      ? [
          { name: "Dashboard", href: "/itsm/dashboard", icon: LayoutDashboard, roles: readRoles },
          { 
            name: "Incident Management", 
            href: "/itsm/incidents-group", 
            icon: Ticket, 
            roles: readRoles,
            children: [
              { name: "My Tickets", href: "/itsm/incidents" },
              { name: "Report an Issue", href: "/itsm/incidents/new" },
            ]
          },
          { name: "Approvals", href: "/itsm/approvals", icon: FileCheck, roles: readRoles },
          { name: "Service Catalog", href: "/itsm/services", icon: Layers, roles: readRoles },
          { name: "Knowledge Base", href: "/itsm/knowledge", icon: BookOpen, roles: readRoles },
          { name: "Notifications", href: "/itsm/notifications", icon: Bell, roles: readRoles },
        ]
      : effectiveItsmRole === "SERVICE_AGENT"
      ? serviceAgentNavigation
      : effectiveItsmRole === "AUDITOR"
      ? auditorNavigation
      : effectiveItsmRole === "PROCESS_CHANGE_MANAGER"
      ? problemChangeNavigation
      : itsmNavigation
    : navigation;
  const allowedNavigation = activeNavigationList.filter((item) => item.roles.includes(normalizedRole));

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push(isItsm ? "/itsm/login" : "/login");
      router.refresh();
    } catch (error) {
      console.error("Failed to log out:", error);
    }
  };

  const currentPage = pathname === "/notifications"
    ? "Notifications"
    : isItsm
    ? pathname === "/itsm/dashboard/agent"
      ? "My Work"
      : pathname === "/itsm/dashboard/auditor"
      ? auditorNavigation.find((item) => item.href.includes(`section=${auditorSection}`))?.name || "Overview"
      : pathname.startsWith("/itsm/dashboard")
      ? "Dashboard"
      : pathname === "/itsm/incidents/new"
      ? "Report an Issue"
      : pathname.startsWith("/itsm/incidents/")
      ? "Incident Details"
      : pathname === "/itsm/approvals" || pathname.startsWith("/itsm/approvals/")
      ? "Approvals"
      : pathname === "/itsm/notifications"
      ? "Notifications"
      : pathname === "/itsm/profile"
      ? "Profile"
      : itsmNavigation.find((item) => pathname === item.href || pathname.startsWith(item.href))?.name || "ITSM"
    : navigation.find((item) => pathname === item.href)?.name || "Overview";

  const navLinks = (onClick?: () => void) => (
    <div className="space-y-1">
      {allowedNavigation.map((item) => {
        if (item.children) {
          const isGroupActive = pathname.startsWith("/itsm/incidents") || pathname.startsWith("/itsm/incident-manager") || pathname.startsWith("/itsm/incident-manager/outage-alerts");
          return (
            <div key={item.name} className="flex flex-col mb-2">
              <div className="flex items-center gap-3 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#8A93A5]">
                <item.icon className="w-4 h-4" />
                <span>{item.name}</span>
              </div>
              <div className="flex flex-col border-l-2 border-[#F1ECFE] ml-[21px] mt-1 pl-2 space-y-1">
                {item.children.map(child => {
                  const childActive = pathname === child.href || (child.href !== "/itsm/incidents" && child.href !== "/itsm/incidents/new" && pathname.startsWith(child.href + "/")) || (child.href === "/itsm/incidents" && pathname.startsWith("/itsm/incidents") && pathname !== "/itsm/incidents/new");
                  return (
                    <Link
                      key={child.name}
                      href={child.href}
                      onClick={onClick}
                      className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                        childActive
                          ? "bg-[#F8F5FF] text-[#6D28D9] font-bold"
                          : "text-[#475069] hover:text-[#0E1726] hover:bg-[#F5F7FA]"
                      }`}
                    >
                      {child.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        }

        const itemSection = item.href.includes("section=") ? item.href.split("section=")[1] : null;
        const itemPath = item.href.split("?")[0];
        const isExact = pathname === item.href;
        const isDashboard = item.href === "/itsm/dashboard" && pathname.startsWith("/itsm/dashboard");
        const isGenericPrefix =
          item.href !== "/overview" &&
          item.href !== "/itsm/dashboard" &&
          item.href !== "/itsm/incidents" &&
          pathname.startsWith(item.href + "/");

        const active = effectiveItsmRole === "AUDITOR" && itemSection
          ? pathname === itemPath && auditorSection === itemSection
          : isExact || isDashboard || isGenericPrefix;
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={onClick}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              active
                ? "bg-[#F1ECFE] text-[#6D28D9] border-l-2 border-[#6D28D9]"
                : "text-[#475069] hover:text-[#0E1726] hover:bg-[#F5F7FA]"
            }`}
          >
            <item.icon className={`w-4.5 h-4.5 ${active ? "text-[#6D28D9]" : "text-[#6B7488]"}`} />
            <span>{item.name}</span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="authclaw-console min-h-screen bg-[#FBFAF9] text-[#0E1726] flex flex-col font-sans">
      <header className="md:hidden m-3 flex items-center justify-between rounded-[20px] border border-[#E6E9F0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-[10px] bg-[#6D28D9] flex items-center justify-center">
            {isItsm ? effectiveItsmRole === "AUDITOR" ? <ScrollText className="w-4 h-4 text-white" /> : <Ticket className="w-4 h-4 text-white" /> : <ShieldCheck className="w-4 h-4 text-white" />}
          </div>
          <div>
            <span className="block font-bold text-sm text-[#0E1726]">
              {isItsm ? "AuthClaw ITSM" : "AuthClaw"}
            </span>
            <span className="block text-[10px] uppercase tracking-wider text-[#6B7488]">
              {isItsm ? effectiveItsmRole === "AUDITOR" ? "Audit & Evidence" : "ITSM" : "Governance Layer"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {effectiveItsmRole !== "AUDITOR" ? <NotificationBell /> : null}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-[#6B7488] hover:text-[#0E1726] focus:outline-none"
            aria-label="Toggle navigation"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      <div className="flex flex-1 relative">
        <aside className="sticky top-4 m-4 mr-0 hidden h-[calc(100vh-2rem)] w-64 flex-col overflow-hidden rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)] md:flex">
          <div className="h-16 flex items-center gap-2.5 px-6 border-b border-[#E6E9F0]">
            <div className="w-8 h-8 rounded-[10px] bg-[#6D28D9] flex items-center justify-center shadow-[0_8px_20px_-8px_rgba(109,40,217,.6)]">
              {isItsm ? effectiveItsmRole === "AUDITOR" ? <ScrollText className="w-4.5 h-4.5 text-white" /> : <Ticket className="w-4.5 h-4.5 text-white" /> : <ShieldCheck className="w-4.5 h-4.5 text-white" />}
            </div>
            <div>
              <span className="block font-bold text-base text-[#0E1726] tracking-wide">
                {isItsm ? "AuthClaw ITSM" : "AuthClaw"}
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                {isItsm ? effectiveItsmRole === "AUDITOR" ? "Audit & Evidence" : "ITSM" : "AI Governance Layer"}
              </span>
            </div>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pr-3 space-y-1.5">{navLinks()}</nav>

          <div className="p-4 border-t border-[#E6E9F0] bg-[#F5F7FA]">
            <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] bg-white border border-[#E6E9F0]">
              <Building className="w-4 h-4 text-[#6B7488] flex-shrink-0" />
              <div className="overflow-hidden">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-[#6B7488]">Active Tenant</p>
                <p className="text-xs font-medium text-[#475069] truncate">{tenantName || tenantId}</p>
              </div>
            </div>
          </div>
        </aside>

        <div
          className={`fixed inset-0 z-50 flex transition-all duration-200 md:hidden ${
            mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
        >
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
            <aside
              className={`relative m-3 flex h-[calc(100%-1.5rem)] w-64 max-w-xs flex-col rounded-[20px] border border-[#E6E9F0] bg-white shadow-2xl transition-all duration-200 ${
                mobileMenuOpen ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0"
              }`}
            >
              <div className="h-16 flex items-center justify-between px-6 border-b border-[#E6E9F0]">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-[10px] bg-[#6D28D9] flex items-center justify-center">
                    {isItsm ? effectiveItsmRole === "AUDITOR" ? <ScrollText className="w-4.5 h-4.5 text-white" /> : <Ticket className="w-4.5 h-4.5 text-white" /> : <ShieldCheck className="w-4.5 h-4.5 text-white" />}
                  </div>
                  <div>
                    <span className="block font-bold text-sm text-[#0E1726]">
                      {isItsm ? "AuthClaw ITSM" : "AuthClaw"}
                    </span>
                    <span className="block text-[10px] font-semibold text-[#6B7488]">
                      {isItsm ? effectiveItsmRole === "AUDITOR" ? "Audit & Evidence" : "ITSM" : "Governance"}
                    </span>
                  </div>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} className="text-[#6B7488] hover:text-[#0E1726]" aria-label="Close navigation">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pr-3 space-y-1">{navLinks(() => setMobileMenuOpen(false))}</nav>

              <div className="p-4 border-t border-[#E6E9F0]">
                <div className="flex items-center gap-2.5 px-2 py-1.5 rounded bg-[#F5F7FA] mb-4">
                  <Building className="w-4 h-4 text-[#6B7488]" />
                  <div className="overflow-hidden">
                    <p className="text-[10px] uppercase font-semibold text-[#6B7488]">Tenant</p>
                    <p className="text-xs font-medium text-[#475069] truncate">{tenantName || tenantId}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 text-sm font-medium transition"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </aside>
          </div>

        <div className="flex-1 flex flex-col min-w-0 bg-[#FBFAF9]">
          <header className="sticky top-4 z-30 mx-4 mt-4 hidden h-14 items-center justify-between rounded-[20px] border border-[#E6E9F0] bg-white/90 px-6 shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)] backdrop-blur-md md:flex">
            <div className="flex items-center gap-3">
              <span className="text-[#6B7488] text-sm">
                {isItsm ? "AuthClaw ITSM" : "Governance Layer"}
              </span>
              <span className="text-[#A8B0C0]">/</span>
              {effectiveItsmRole === "AUDITOR" ? <><span className="text-[#475069] text-sm">Audit &amp; Evidence</span><span className="text-[#A8B0C0]">/</span></> : null}
              <span className="text-[#0E1726] text-sm font-medium">{currentPage}</span>
            </div>

            <div className="flex items-center gap-2">
              {effectiveItsmRole !== "AUDITOR" ? <NotificationBell /> : null}
              <div className="relative">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-[10px] border border-[#E6E9F0] bg-white hover:bg-[#F5F7FA] hover:border-[#A78BFA] transition-all duration-150"
              >
                <div className="w-6 h-6 rounded-full bg-[#F1ECFE] border border-[#A78BFA] flex items-center justify-center text-[10px] font-bold text-[#6D28D9]">
                  {userEmail.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-xs font-medium text-[#475069]">{userEmail}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-[#6B7488] transition-transform duration-200 ${profileDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              <div
                className={`fixed inset-0 z-30 ${profileDropdownOpen ? "pointer-events-auto" : "pointer-events-none"}`}
                onClick={() => setProfileDropdownOpen(false)}
              />
              <div
                className={`absolute right-0 z-40 mt-2 w-48 origin-top-right rounded-[10px] border border-[#E6E9F0] bg-white py-1 shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)] transition-all duration-200 ${
                  profileDropdownOpen ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1 scale-95 opacity-0"
                }`}
              >
                    <div className="px-4 py-2 border-b border-[#E6E9F0]">
                      <p className="text-[10px] font-semibold uppercase text-[#6B7488] tracking-wider">Signed In As</p>
                      <p className="text-xs text-[#475069] truncate font-medium mt-0.5">{userEmail}</p>
                      <p className="text-[10px] text-[#6B7488] capitalize mt-0.5">{displayedRole}</p>
                    </div>
                    {isItsm && (
                      <Link
                        href="/itsm/profile"
                        onClick={() => setProfileDropdownOpen(false)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA] hover:text-[#0E1726] border-b border-[#E6E9F0] transition-colors duration-150"
                      >
                        <User className="w-3.5 h-3.5 text-[#6D28D9]" />
                        <span>My Profile</span>
                      </Link>
                    )}
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/5 hover:text-red-300 transition-colors duration-150"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-auto px-4 py-6 sm:px-6 md:px-8 md:py-8 xl:px-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
