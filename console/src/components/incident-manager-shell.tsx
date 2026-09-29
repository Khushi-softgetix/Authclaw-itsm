"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building,
  ChevronDown,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  Radio,
  ShieldAlert,
  X,
} from "lucide-react";
import NotificationBell from "@/components/notification-bell";

interface IncidentManagerShellProps {
  children: React.ReactNode;
  userEmail: string;
  tenantId: string;
  tenantName: string;
  userRole: string;
  itsmRole?: string | null;
}

export default function IncidentManagerShell({
  children,
  userEmail,
  tenantId,
  tenantName,
}: IncidentManagerShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const navItems = [
    { href: "/itsm/incident-manager", label: "Overview", icon: LayoutDashboard, exact: true },
    { href: "/itsm/incident-manager/incidents", label: "Incident Queue", icon: ListFilter },
    { href: "/itsm/incident-manager/major-incidents", label: "Major Incident Command", icon: Radio },
  ];

  const currentPage =
    pathname === "/itsm/incident-manager"
      ? "Overview"
      : pathname.startsWith("/itsm/incident-manager/major-incidents")
        ? "Major Incident Command"
        : pathname.startsWith("/itsm/incident-manager/incidents")
          ? "Incident Queue"
          : "Workspace";

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/itsm/login");
      router.refresh();
    } catch (error) {
      console.error("Failed to log out:", error);
    }
  };

  const navLinks = (onClick?: () => void) => (
    <div className="space-y-4">
      <div>
        <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-[#6B7488] mb-1.5">
          Workspace
        </p>
        <div className="space-y-1">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} onClick={onClick} aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${active ? "border-l-2 border-[#6D28D9] bg-[#F1ECFE] text-[#6D28D9]" : "text-[#475069] hover:bg-[#F5F7FA] hover:text-[#0E1726]"}`}>
                <Icon className={`h-4 w-4 ${active ? "text-[#6D28D9]" : "text-[#6B7488]"}`} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div className="authclaw-console flex min-h-screen flex-col bg-[#FBFAF9] font-sans text-[#0E1726]">
      <header className="m-3 flex items-center justify-between rounded-[20px] border border-[#E6E9F0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)] md:hidden">
        <Link href="/itsm/incident-manager" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#6D28D9] shadow-[0_8px_20px_-8px_rgba(109,40,217,.6)]">
            <ShieldAlert className="h-4 w-4 text-white" />
          </span>
          <span>
            <span className="block text-sm font-bold">AuthClaw ITSM</span>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6D28D9]">Incident Management</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button type="button" onClick={() => setMobileMenuOpen(true)} className="rounded-lg p-2 text-[#475069] hover:bg-[#F5F7FA]" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="relative flex flex-1">
        {/* Desktop Left Sidebar */}
        <aside className="sticky top-4 z-30 m-4 mr-0 hidden h-[calc(100vh-2rem)] w-64 flex-col overflow-hidden rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)] md:flex">
          <div className="flex h-16 items-center gap-3 border-b border-[#E6E9F0] px-6">
            <Link href="/itsm/incident-manager" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#6D28D9] text-white shadow-[0_8px_20px_-8px_rgba(109,40,217,.6)]">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <div>
                <div className="text-base font-bold tracking-wide text-[#0E1726]">AuthClaw ITSM</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6D28D9]">Incident Management</div>
              </div>
            </Link>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
            {navLinks()}
          </nav>

          <div className="border-t border-[#E6E9F0] bg-[#F5F7FA] p-4">
            <div className="flex items-center gap-2.5 rounded-[10px] border border-[#E6E9F0] bg-white px-2.5 py-2">
              <Building className="h-4 w-4 shrink-0 text-[#6B7488]" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">Active Tenant</p>
                <p className="truncate text-xs font-medium text-[#475069]">{tenantName || tenantId}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#FBFAF9]">
          {/* Mobile Navigation Drawer */}
          {mobileMenuOpen && (
            <div className="fixed inset-0 z-50 flex md:hidden">
              <div className="fixed inset-0 bg-black/30 backdrop-blur-xs" onClick={() => setMobileMenuOpen(false)} />
              <div className="relative z-10 flex h-full w-64 flex-col border-r border-[#E6E9F0] bg-white">
                <div className="flex h-16 items-center justify-between border-b border-[#E6E9F0] px-5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#6D28D9] text-white">
                      <ShieldAlert className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-[#0E1726]">AuthClaw ITSM</div>
                      <div className="text-[10px] font-semibold text-[#6D28D9]">Incident Management</div>
                    </div>
                  </div>
                  <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-1.5 text-[#6B7488] hover:text-[#0E1726]" aria-label="Close navigation">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <nav className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{navLinks(() => setMobileMenuOpen(false))}</nav>
                <div className="border-t border-[#E6E9F0] bg-[#F5F7FA] p-4">
                  <div className="mb-4 flex items-center gap-2.5 rounded-[10px] border border-[#E6E9F0] bg-white px-2.5 py-2">
                    <Building className="h-4 w-4 shrink-0 text-[#6B7488]" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">Active Tenant</p>
                      <p className="truncate text-xs font-medium text-[#475069]">{tenantName || tenantId}</p>
                    </div>
                  </div>
                  <button type="button" onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50">
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Shared AuthClaw workspace header */}
          <header className="sticky top-4 z-30 mx-4 mt-4 hidden h-14 items-center justify-between rounded-[20px] border border-[#E6E9F0] bg-white/90 px-6 shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)] backdrop-blur-md md:flex">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/itsm/incident-manager" className="shrink-0 text-sm text-[#6B7488] hover:text-[#0E1726]">AuthClaw ITSM</Link>
              <span className="text-[#A8B0C0]">/</span>
              <span className="shrink-0 text-sm text-[#6B7488]">Incident Management</span>
              <span className="text-[#A8B0C0]">/</span>
              <span className="truncate text-sm font-medium text-[#0E1726]">{currentPage}</span>
            </div>

            <div className="ml-4 flex shrink-0 items-center gap-2">
              <NotificationBell />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setProfileDropdownOpen((open) => !open)}
                  className="flex items-center gap-2.5 rounded-[10px] border border-[#E6E9F0] bg-white px-3 py-1.5 transition-all duration-150 hover:border-[#A78BFA] hover:bg-[#F5F7FA]"
                  aria-expanded={profileDropdownOpen}
                  aria-haspopup="menu"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#A78BFA] bg-[#F1ECFE] text-[10px] font-bold text-[#6D28D9]">{userEmail.slice(0, 2).toUpperCase()}</span>
                  <span className="max-w-[220px] truncate text-xs font-medium text-[#475069]">{userEmail}</span>
                  <ChevronDown className={`h-3.5 w-3.5 text-[#6B7488] transition-transform duration-200 ${profileDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                <div className={`fixed inset-0 z-30 ${profileDropdownOpen ? "pointer-events-auto" : "pointer-events-none"}`} onClick={() => setProfileDropdownOpen(false)} />
                <div role="menu" className={`absolute right-0 z-40 mt-2 w-56 origin-top-right rounded-[10px] border border-[#E6E9F0] bg-white py-1 shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)] transition-all duration-200 ${profileDropdownOpen ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1 scale-95 opacity-0"}`}>
                  <div className="border-b border-[#E6E9F0] px-4 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">Signed In As</p>
                    <p className="mt-0.5 truncate text-xs font-medium text-[#475069]">{userEmail}</p>
                    <p className="mt-0.5 text-[10px] font-medium text-[#6D28D9]">Incident Manager</p>
                  </div>
                  <button type="button" role="menuitem" onClick={handleLogout} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-500 transition-colors hover:bg-red-50">
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
