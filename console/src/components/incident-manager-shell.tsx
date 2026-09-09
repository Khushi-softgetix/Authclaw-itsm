"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building,
  ChevronDown,
  Flame,
  LogOut,
  Menu,
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
  userRole,
  itsmRole,
}: IncidentManagerShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

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
          <Link
            href="/itsm/incident-manager"
            onClick={onClick}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              pathname === "/itsm/incident-manager"
                ? "bg-[#FEF2F2] text-[#DC2626]"
                : "text-[#475069] hover:bg-[#F5F7FA] hover:text-[#0E1726]"
            }`}
          >
            <Flame className="w-4 h-4 text-[#DC2626]" />
            <span>Incident Manager</span>
          </Link>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FBFAF9] text-[#0E1726] flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 z-30 bg-white border-r border-[#E6E9F0]">
        {/* Brand Header */}
        <div className="h-16 px-6 flex items-center gap-3 border-b border-[#E6E9F0]">
          <Link href="/itsm/incident-manager" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#DC2626] to-[#991B1B] flex items-center justify-center text-white shadow-xs">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold tracking-tight text-[#0E1726]">
                AuthClaw ITSM
              </div>
              <div className="text-[10px] font-medium text-[#DC2626]">
                Incident Manager Portal
              </div>
            </div>
          </Link>
        </div>

        {/* Minimal Navigation */}
        <div className="flex-1 overflow-y-auto px-4 py-5">
          {navLinks()}
        </div>

        {/* Sidebar Footer / Tenant & Identity */}
        <div className="p-4 border-t border-[#E6E9F0] bg-[#FAFAFA]">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="w-7 h-7 rounded-full bg-[#FEF2F2] text-[#DC2626] flex items-center justify-center text-[11px] font-bold border border-[#FECACA]">
              IM
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#0E1726] truncate">
                {userEmail}
              </p>
              <p className="text-[10px] text-[#DC2626] font-medium truncate">
                Incident Manager
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-[#E6E9F0] px-4 md:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-lg text-[#475069] hover:bg-[#F5F7FA] hover:text-[#0E1726]"
              aria-label="Open mobile menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
                Incident Manager
              </span>
              <span className="text-xs text-[#6B7488]">/</span>
              <span className="text-xs font-medium text-[#0E1726]">Workspace</span>
            </div>
          </div>

          {/* Right Header Utilities */}
          <div className="flex items-center gap-3">
            <NotificationBell />

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileDropdownOpen((prev) => !prev)}
                className="flex items-center gap-2 pl-2 pr-1.5 py-1.5 rounded-lg hover:bg-[#F5F7FA] transition-colors text-left"
              >
                <div className="w-7 h-7 rounded-full bg-[#FEF2F2] text-[#DC2626] flex items-center justify-center text-xs font-bold border border-[#FECACA]">
                  IM
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-xs font-semibold text-[#0E1726] leading-tight truncate max-w-[140px]">
                    {userEmail}
                  </div>
                  <div className="text-[10px] text-[#DC2626] font-medium leading-tight">
                    Incident Manager
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-[#6B7488]" />
              </button>

              {profileDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setProfileDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-1.5 w-60 rounded-xl bg-white border border-[#E6E9F0] shadow-lg py-2 z-50">
                    <div className="px-3.5 py-2 border-b border-[#E6E9F0]">
                      <p className="text-xs font-semibold text-[#0E1726] truncate">
                        {userEmail}
                      </p>
                      <p className="text-[10px] text-[#DC2626] font-medium mt-0.5">
                        Incident Manager
                      </p>
                      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-[#6B7488]">
                        <Building className="w-3 h-3 text-[#8E97A8]" />
                        <span className="truncate">{tenantName}</span>
                      </div>
                    </div>
                    <div className="pt-1">
                      <button
                        onClick={() => {
                          setProfileDropdownOpen(false);
                          handleLogout();
                        }}
                        className="w-full flex items-center gap-2 px-3.5 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Log out</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

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
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#DC2626] to-[#991B1B] flex items-center justify-center text-white font-bold text-xs">
                    IM
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
            </div>
          </div>
        )}

        {/* Workspace Body */}
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
