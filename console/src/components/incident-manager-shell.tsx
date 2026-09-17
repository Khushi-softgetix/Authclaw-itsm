"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  Radio,
  ShieldAlert,
  X,
} from "lucide-react";

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
}: IncidentManagerShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItems = [
    { href: "/itsm/incident-manager", label: "Overview", icon: LayoutDashboard, exact: true },
    { href: "/itsm/incident-manager/incidents", label: "Incident Queue", icon: ListFilter },
    { href: "/itsm/incident-manager/major-incidents", label: "Major incident command", icon: Radio },
  ];

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
          <span className="text-sm font-bold">AuthClaw ITSM</span>
        </Link>
        <button type="button" onClick={() => setMobileMenuOpen(true)} className="rounded-lg p-2 text-[#475069] hover:bg-[#F5F7FA]" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      </header>
      <div className="relative flex flex-1">
      {/* Desktop Left Sidebar */}
      <aside className="sticky top-4 z-30 m-4 mr-0 hidden h-[calc(100vh-2rem)] w-64 flex-col overflow-hidden rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)] md:flex">
        {/* Brand Header */}
        <div className="h-16 px-6 flex items-center gap-3 border-b border-[#E6E9F0]">
          <Link href="/itsm/incident-manager" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#6D28D9] text-white shadow-[0_8px_20px_-8px_rgba(109,40,217,.6)]">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div className="text-base font-bold tracking-wide text-[#0E1726]">AuthClaw ITSM</div>
          </Link>
        </div>

        {/* Minimal Navigation */}
        <div className="flex-1 overflow-y-auto px-4 py-5">
          {navLinks()}
        </div>

        {/* Sidebar Footer / Identity */}
        <div className="border-t border-[#E6E9F0] bg-[#F5F7FA] p-4">
          <div className="flex items-center gap-2.5 rounded-[12px] border border-[#DDD6FE] bg-white px-3 py-2.5 shadow-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#C4B5FD] bg-[#F1ECFE] text-[10px] font-bold text-[#6D28D9]">
              IM
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[#0E1726]" title={userEmail}>{userEmail}</p>
              <p className="text-[10px] font-medium text-[#6D28D9]">Incident Manager</p>
            </div>
            <button type="button" onClick={handleLogout} className="rounded-lg p-2 text-[#6B7488] transition hover:bg-[#F1ECFE] hover:text-[#5B21B6]" aria-label="Log out" title="Log out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#FBFAF9]">
        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            <div
              className="fixed inset-0 bg-black/30 backdrop-blur-xs"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative w-64 bg-white flex flex-col h-full z-10 border-r border-[#E6E9F0]">
              <div className="h-16 px-5 flex items-center justify-between border-b border-[#E6E9F0]">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#6D28D9] text-white">
                    <ShieldAlert className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold text-[#0E1726]">Incident Manager</span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 text-[#6B7488] hover:text-[#0E1726]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {navLinks(() => setMobileMenuOpen(false))}
              </div>
              <div className="border-t border-[#E6E9F0] bg-[#F5F7FA] p-4">
                <div className="flex items-center gap-2.5 rounded-[12px] border border-[#DDD6FE] bg-white px-3 py-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#C4B5FD] bg-[#F1ECFE] text-[10px] font-bold text-[#6D28D9]">IM</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#0E1726]">{userEmail}</p><p className="text-[10px] font-medium text-[#6D28D9]">Incident Manager</p></div>
                  <button type="button" onClick={handleLogout} className="rounded-lg p-2 text-[#6B7488] hover:bg-[#F1ECFE] hover:text-[#5B21B6]" aria-label="Log out"><LogOut className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Workspace Body */}
        <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">{children}</main>
      </div>
      </div>
    </div>
  );
}
