"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowRight, ChevronDown, Menu, Ticket, X } from "lucide-react";

const navLinks = [
  { label: "Home", href: "/itsm" },
  { label: "Capabilities", href: "/itsm#capabilities" },
  { label: "Roles", href: "/itsm/roles" },
  { label: "Trust", href: "/itsm#trust" },
] as const;

export function ItsmPublicHeader() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#E6E9F0] bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-[66px] max-w-7xl items-center gap-4 px-6 sm:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-initial">
          <Link href="/" aria-label="AuthClaw home" className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-4">
            <span className="mark" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-lg font-bold tracking-[-0.02em] text-[#0E1726]">AuthClaw <span className="text-[#6D28D9]">.ai</span></span>
              <span className="block whitespace-nowrap text-[10px] font-medium text-[#6B7488] sm:hidden">IT Service Management</span>
            </span>
          </Link>
          <span aria-hidden="true" className="hidden h-7 w-px bg-[#DDE1E9] sm:block" />
          <Link href="/itsm" className="hidden items-center gap-2 rounded-md text-sm font-medium text-[#475069] transition-colors hover:text-[#0E1726] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] sm:flex">
            <Ticket aria-hidden="true" className="h-4 w-4 text-[#6D28D9]" />
            IT Service Management
          </Link>
        </div>

        <nav className="mx-auto hidden items-center gap-7 text-sm font-medium text-[#475069] md:flex" aria-label="ITSM Product Navigation">
          <Link href="/product" className="inline-flex items-center gap-1.5 transition-colors hover:text-[#0E1726] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]">Product<ChevronDown aria-hidden="true" className="h-3.5 w-3.5" /></Link>
          {navLinks.slice(1).map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.label} href={item.href} aria-current={active ? "page" : undefined} className={`transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] ${active ? "text-[#6D28D9]" : "hover:text-[#0E1726]"}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <Link href="/itsm/login" className="text-sm font-semibold text-[#475069] transition-colors hover:text-[#0E1726] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]">Sign in</Link>
          <Link href="/demo" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[#6D28D9] px-5 text-sm font-semibold text-white shadow-[0_10px_20px_-10px_rgba(109,40,217,.8)] transition hover:bg-[#5B21B6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-2">Book a demo<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
        </div>

        <button type="button" onClick={() => setMobileMenuOpen((open) => !open)} className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-[#DDE1E9] text-[#0E1726] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] md:hidden" aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={mobileMenuOpen}>
          {mobileMenuOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
        </button>
      </div>

      {mobileMenuOpen ? (
        <div className="border-t border-[#E6E9F0] bg-white px-6 pb-5 pt-3 md:hidden">
          <nav aria-label="Mobile ITSM product navigation" className="mx-auto max-w-7xl space-y-1">
            <Link href="/product" onClick={() => setMobileMenuOpen(false)} className="flex min-h-11 items-center justify-between border-b border-[#EEF1F5] px-1 text-sm font-medium text-[#475069]">Product<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
            {navLinks.map((item) => (
              <Link key={item.label} href={item.href} onClick={() => setMobileMenuOpen(false)} className="flex min-h-11 items-center justify-between border-b border-[#EEF1F5] px-1 text-sm font-medium text-[#475069]">{item.label}<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
            ))}
          </nav>
          <div className="mx-auto mt-4 grid max-w-7xl grid-cols-2 gap-3">
            <Link href="/itsm/login" onClick={() => setMobileMenuOpen(false)} className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[#D7DCE5] text-sm font-semibold text-[#0E1726]">Sign in</Link>
            <Link href="/demo" onClick={() => setMobileMenuOpen(false)} className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-[#6D28D9] text-sm font-semibold text-white">Book a demo</Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
