"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Key,
  Laptop,
  Layers,
  LifeBuoy,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

interface ServiceItem {
  id: string;
  title: string;
  category: "hardware" | "software" | "security" | "general";
  categoryLabel: string;
  description: string;
  estimatedTime: string;
  fulfillmentType: "Automated" | "Manager Approval" | "IT Triage";
  popular?: boolean;
}

const SERVICES_CATALOG: ServiceItem[] = [
  {
    id: "laptop-req",
    title: "New Developer Laptop / Workstation",
    category: "hardware",
    categoryLabel: "Hardware & Equipment",
    description: "Request a standard developer laptop (MacBook Pro or ThinkPad) with pre-installed enterprise tools.",
    estimatedTime: "24-48 hrs",
    fulfillmentType: "Manager Approval",
    popular: true,
  },
  {
    id: "monitor-req",
    title: "External Monitor & Peripheral Kit",
    category: "hardware",
    categoryLabel: "Hardware & Equipment",
    description: "4K external monitor, ergonomic mechanical keyboard, mouse, and USB-C docking station.",
    estimatedTime: "24 hrs",
    fulfillmentType: "IT Triage",
  },
  {
    id: "aws-sso",
    title: "AWS Account & IAM Sandbox Access",
    category: "software",
    categoryLabel: "Software Access & SSO",
    description: "Temporary or permanent developer sandbox IAM role in AWS cloud infrastructure.",
    estimatedTime: "2 hrs",
    fulfillmentType: "Automated",
    popular: true,
  },
  {
    id: "github-access",
    title: "GitHub Enterprise Organization Seat",
    category: "software",
    categoryLabel: "Software Access & SSO",
    description: "Invite seat to AuthClaw GitHub repositories with team permissions.",
    estimatedTime: "1 hr",
    fulfillmentType: "Automated",
  },
  {
    id: "mfa-reset",
    title: "Security Token & MFA Reset",
    category: "security",
    categoryLabel: "Security & MFA Reset",
    description: "Reset lost authenticator app registration or locked hardware security token (YubiKey).",
    estimatedTime: "15 mins",
    fulfillmentType: "IT Triage",
    popular: true,
  },
  {
    id: "vpn-cert",
    title: "Corporate VPN & WireGuard Profile",
    category: "security",
    categoryLabel: "Security & MFA Reset",
    description: "Generate or update encrypted WireGuard VPN client certificate for remote access.",
    estimatedTime: "30 mins",
    fulfillmentType: "Automated",
  },
  {
    id: "wifi-guest",
    title: "Office WiFi & Guest Network Passcode",
    category: "general",
    categoryLabel: "General IT Assistance",
    description: "High-speed office WPA3-Enterprise credential provision or temporary visitor codes.",
    estimatedTime: "Immediate",
    fulfillmentType: "Automated",
  },
  {
    id: "zoom-room",
    title: "AV & Conference Room Setup",
    category: "general",
    categoryLabel: "General IT Assistance",
    description: "Technical setup support for all-hands presentations or video conference equipment.",
    estimatedTime: "2 hrs",
    fulfillmentType: "IT Triage",
  },
];

export default function ServicesPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const filteredServices = SERVICES_CATALOG.filter((item) => {
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] rounded-2xl p-6 sm:p-8 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <Layers className="w-3.5 h-3.5" />
            <span>Service Catalog</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            IT Service Requests &amp; Provisioning
          </h1>
          <p className="text-sm text-blue-100 max-w-xl">
            Browse hardware equipment, software SSO access, and IT security services available for your workspace.
          </p>
        </div>

        <div className="shrink-0">
          <Link
            href="/itsm/incidents/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#1E40AF] font-bold text-xs hover:bg-blue-50 transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Report Broken Equipment / Bug</span>
          </Link>
        </div>
      </div>

      {/* Category Tabs & Search Bar */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-sm space-y-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[#F0F2F6]">
          {[
            { id: "all", label: "All Services", icon: Layers },
            { id: "hardware", label: "Hardware & Equipment", icon: Laptop },
            { id: "software", label: "Software Access & SSO", icon: Key },
            { id: "security", label: "Security & MFA Reset", icon: ShieldCheck },
            { id: "general", label: "General IT Assistance", icon: LifeBuoy },
          ].map((cat) => {
            const Icon = cat.icon;
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-2 ${
                  active
                    ? "bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]"
                    : "text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA]"
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? "text-[#6D28D9]" : "text-[#6B7488]"}`} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search service catalog (e.g. laptop, AWS, VPN)..."
            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl pl-9 pr-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
          />
        </div>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredServices.map((service) => (
          <div
            key={service.id}
            className="bg-white rounded-2xl border border-[#E6E9F0] hover:border-[#A78BFA] p-6 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4 group"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-full border border-[#A78BFA]">
                  {service.categoryLabel}
                </span>
                {service.popular && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    <Zap className="w-3 h-3 text-amber-500" /> Popular
                  </span>
                )}
              </div>

              <h3 className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition">
                {service.title}
              </h3>

              <p className="text-xs text-[#6B7488] leading-relaxed line-clamp-3">
                {service.description}
              </p>
            </div>

            <div className="pt-3 border-t border-[#F0F2F6] space-y-3">
              <div className="flex items-center justify-between text-[11px] text-[#6B7488]">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {service.estimatedTime} SLA
                </span>
                <span className="font-semibold text-[#475069]">{service.fulfillmentType}</span>
              </div>

              <Link
                href={`/itsm/incidents/new?category=${encodeURIComponent(service.categoryLabel)}&title=${encodeURIComponent(service.title)}`}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-bold rounded-xl transition shadow-sm"
              >
                <span>Request Service</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
