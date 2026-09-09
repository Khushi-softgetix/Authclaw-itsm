"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ticket, Menu, X, ArrowRight, ExternalLink } from "lucide-react";

export function ItsmPublicHeader() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: "Home", href: "/itsm" },
    { label: "Solutions", href: "/itsm#solutions" },
    { label: "Roles", href: "/itsm/roles" },
    { label: "Pricing", href: "/itsm#pricing" },
    { label: "About", href: "/itsm#about" },
  ];

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-200 ${
        isScrolled
          ? "bg-white/95 backdrop-blur-md border-b border-[#E6E9F0] shadow-[0_1px_2px_rgba(11,31,63,.05)]"
          : "bg-[#FBFAF9] border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 sm:px-8">
        {/* Brand Left */}
        <div className="flex items-center gap-3">
          <Link href="/itsm" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-[10px] bg-[#6D28D9] flex items-center justify-center shadow-[0_4px_12px_-4px_rgba(109,40,217,.5)] group-hover:scale-105 transition-transform">
              <Ticket className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base tracking-tight text-[#0E1726]">
                  AuthClaw
                </span>
                <span className="font-semibold text-base text-[#6D28D9]">
                  ITSM
                </span>
              </div>
            </div>
          </Link>
          <span className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-[#6B7488] bg-[#F1ECFE] text-[#6D28D9] rounded-md border border-[#E9D5FF]">
            AI-Native Service Management
          </span>
        </div>

        {/* Navigation Center */}
        <nav className="hidden md:flex items-center gap-1 text-xs font-medium text-[#475069]" aria-label="ITSM Product Navigation">
          {navLinks.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`px-3.5 py-1.5 rounded-lg transition-colors ${
                  active
                    ? "text-[#6D28D9] bg-[#F1ECFE] font-semibold"
                    : "hover:text-[#0E1726] hover:bg-[#F5F7FA]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Action Buttons Right */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/itsm/login"
            className="text-xs font-semibold text-[#475069] hover:text-[#0E1726] px-3.5 py-2 rounded-lg hover:bg-[#F5F7FA] transition"
          >
            Login
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#6D28D9] hover:bg-[#5B21B6] px-4 py-2 rounded-[10px] shadow-[0_4px_12px_-4px_rgba(109,40,217,.5)] transition active:scale-98"
          >
            Book a Demo
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Mobile Hamburger */}
        <div className="flex md:hidden items-center gap-2">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-[#475069] hover:text-[#0E1726] rounded-lg hover:bg-[#F5F7FA] focus:outline-none"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-[#E6E9F0] bg-white px-6 py-4 space-y-3 shadow-lg animate-in slide-in-from-top-2 duration-150">
          <div className="space-y-1">
            {navLinks.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 text-sm font-medium text-[#475069] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-lg"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="pt-3 border-t border-[#E6E9F0] flex flex-col gap-2">
            <Link
              href="/itsm/login"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full text-center py-2 text-xs font-semibold text-[#475069] border border-[#E6E9F0] rounded-[10px]"
            >
              Login to ITSM
            </Link>
            <Link
              href="/demo"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full text-center py-2 text-xs font-semibold text-white bg-[#6D28D9] rounded-[10px]"
            >
              Book a Demo
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
