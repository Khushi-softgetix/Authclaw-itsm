import React from "react";
import Link from "next/link";
import { Ticket, Shield, ArrowRight } from "lucide-react";

export function ItsmPublicFooter() {
  const currentYear = new Date().getFullYear();

  const footerGroups = [
    {
      heading: "Product",
      links: [
        { label: "Incident Management", href: "/itsm#solutions" },
        { label: "Service Catalog", href: "/itsm#solutions" },
        { label: "Knowledge Management", href: "/itsm#solutions" },
        { label: "SLA Management", href: "/itsm#solutions" },
        { label: "Change & Problem", href: "/itsm#solutions" },
        { label: "AI Copilot & Ops", href: "/itsm#solutions" },
      ],
    },
    {
      heading: "Roles & Workspaces",
      links: [
        { label: "Requester Portal", href: "/itsm/roles#requester" },
        { label: "Service Agent", href: "/itsm/roles#service-agent" },
        { label: "Service Lead", href: "/itsm/roles#service-lead" },
        { label: "Process & Change", href: "/itsm/roles#process-change" },
        { label: "Platform Administrator", href: "/itsm/roles#platform-admin" },
        { label: "Auditor & Compliance", href: "/itsm/roles#auditor" },
      ],
    },
    {
      heading: "Platform & Security",
      links: [
        { label: "Role-Based Access Control", href: "/itsm/roles" },
        { label: "Enterprise Tenancy", href: "/itsm#solutions" },
        { label: "Audit & Trust Center", href: "/security" },
        { label: "In-line Compliance", href: "/product" },
        { label: "API Reference", href: "/api/docs" },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "About AuthClaw", href: "/company" },
        { label: "Book a Demo", href: "/demo" },
        { label: "ITSM Login", href: "/itsm/login" },
        { label: "Governance Portal", href: "/login" },
        { label: "Contact Us", href: "/demo" },
      ],
    },
  ];

  return (
    <footer className="border-t border-[#E6E9F0] bg-white text-[#475069] mt-auto">
      <div className="mx-auto max-w-7xl px-6 sm:px-8 pt-14 pb-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-10 lg:gap-8 mb-12">
          {/* Brand Col */}
          <div className="lg:col-span-2 space-y-4">
            <Link href="/itsm" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[10px] bg-[#6D28D9] flex items-center justify-center shadow-[0_4px_12px_-4px_rgba(109,40,217,.5)]">
                <Ticket className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-lg tracking-tight text-[#0E1726]">
                  AuthClaw
                </span>
                <span className="font-bold text-lg text-[#6D28D9]">
                  ITSM
                </span>
              </div>
            </Link>
            <p className="text-xs leading-relaxed text-[#6B7488] max-w-sm">
              AI-native service management built natively into the AuthClaw platform.
              Streamline enterprise incidents, automated triage, SLA compliance,
              and continuous ITIL workflows with intelligent copilot actions.
            </p>
            <div className="pt-2">
              <Link
                href="/itsm/login"
                className="inline-flex items-center gap-2 text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] transition"
              >
                Sign in to your ITSM workspace
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Nav columns */}
          {footerGroups.map((group) => (
            <div key={group.heading} className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#0E1726]">
                {group.heading}
              </h4>
              <ul className="space-y-2 text-xs">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[#6B7488] hover:text-[#0E1726] transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-[#F0F2F6] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#8C95A8]">
          <p>© {currentYear} AuthClaw ITSM. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            A product by <strong className="text-[#0E1726]">AgentsArchitects.ai</strong>
          </p>
        </div>
      </div>
    </footer>
  );
}
