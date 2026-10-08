"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Key,
  Laptop,
  Layers,
  LifeBuoy,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Users,
  X,
  Zap,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { ITSMServiceSummary } from "@/lib/itsm-types";

interface ServiceCatalogItem {
  id: string;
  tenant_id: string;
  service_id: string;
  service_name: string;
  category_label: string;
  name: string;
  slug: string;
  description: string | null;
  estimated_delivery_hours: number;
  estimated_time_label: string;
  approval_required: boolean;
  fulfillment_type: string;
  fulfillment_group: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const REQUESTER_SERVICES_CATALOG = [
  {
    id: "laptop-req",
    name: "New Developer Laptop / Workstation",
    category_label: "Hardware & Equipment",
    description: "Request a standard developer laptop (MacBook Pro or ThinkPad) with pre-installed enterprise tools.",
    estimated_time_label: "24-48 hrs",
    fulfillment_type: "Manager Approval",
    approval_required: true,
  },
  {
    id: "monitor-req",
    name: "External Monitor & Peripheral Kit",
    category_label: "Hardware & Equipment",
    description: "4K external monitor, ergonomic mechanical keyboard, mouse, and USB-C docking station.",
    estimated_time_label: "24 hrs",
    fulfillment_type: "IT Triage",
    approval_required: false,
  },
  {
    id: "aws-sso",
    name: "AWS Account & IAM Sandbox Access",
    category_label: "Software Access & SSO",
    description: "Temporary or permanent developer sandbox IAM role in AWS cloud infrastructure.",
    estimated_time_label: "2 hrs",
    fulfillment_type: "Automated",
    approval_required: true,
  },
  {
    id: "github-access",
    name: "GitHub Enterprise Organization Seat",
    category_label: "Software Access & SSO",
    description: "Invite seat to AuthClaw GitHub repositories with team permissions.",
    estimated_time_label: "1 hr",
    fulfillment_type: "Automated",
    approval_required: false,
  },
  {
    id: "mfa-reset",
    name: "Security Token & MFA Reset",
    category_label: "Security & MFA Reset",
    description: "Reset lost authenticator app registration or locked hardware security token (YubiKey).",
    estimated_time_label: "15 mins",
    fulfillment_type: "IT Triage",
    approval_required: true,
  },
  {
    id: "vpn-cert",
    name: "Corporate VPN & WireGuard Profile",
    category_label: "Security & MFA Reset",
    description: "Generate or update encrypted WireGuard VPN client certificate for remote access.",
    estimated_time_label: "30 mins",
    fulfillment_type: "Automated",
    approval_required: false,
  },
  {
    id: "wifi-guest",
    name: "Office WiFi & Guest Network Passcode",
    category_label: "General IT Assistance",
    description: "High-speed office WPA3-Enterprise credential provision or temporary visitor codes.",
    estimated_time_label: "Immediate",
    fulfillment_type: "Automated",
    approval_required: false,
  },
  {
    id: "zoom-room",
    name: "AV & Conference Room Setup",
    category_label: "General IT Assistance",
    description: "Technical setup support for all-hands presentations or video conference equipment.",
    estimated_time_label: "2 hrs",
    fulfillment_type: "IT Triage",
    approval_required: false,
  },
];

export default function ServicesPage() {
  const [userRole, setUserRole] = useState<string>("SERVICE_AGENT");
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);

  // Agent State
  const [services, setServices] = useState<ITSMServiceSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [tierFilter, setTierFilter] = useState<string>("ALL");

  // Requester State
  const [catalogItems, setCatalogItems] = useState<ServiceCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [requesterCategory, setRequesterCategory] = useState<string>("all");
  const [requesterSearch, setRequesterSearch] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        let detected = "SERVICE_AGENT";
        if (session) {
          detected = (
            session.itsmRole ||
            (session.platformRole === "SUPER_ADMIN" ? "PLATFORM_ADMINISTRATOR" : "REQUESTER")
          ).toUpperCase();
        }
        setUserRole(detected);
      })
      .catch(() => {
        setUserRole("SERVICE_AGENT");
      })
      .finally(() => {
        setSessionLoading(false);
      });
  }, []);

  const fetchCatalogItems = useCallback(async () => {
    try {
      setCatalogLoading(true);
      setCatalogError(null);
      const res = await fetch("/api/itsm/service-catalog", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to load service catalog");
      }
      const data = await res.json();
      setCatalogItems(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setCatalogError(err instanceof Error ? err.message : "Failed to load service catalog");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const fetchServices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (tierFilter !== "ALL") params.set("tier", tierFilter);

      const res = await fetch(`/api/itsm/services?${params.toString()}`);
      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to load services");
      }

      const data = await res.json();
      setServices(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load services");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, tierFilter]);

  useEffect(() => {
    if (!sessionLoading) {
      if (userRole === "CATALOG_MANAGER") {
        window.location.replace("/itsm/catalog-manager/studio");
        return;
      }
      if (userRole === "REQUESTER") {
        fetchCatalogItems();
      } else {
        fetchServices();
      }
    }
  }, [userRole, sessionLoading, fetchCatalogItems, fetchServices]);

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center py-24" id="services-loading-spinner">
        <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin" />
        <span className="ml-3 text-xs text-[#475069]">Loading services...</span>
      </div>
    );
  }

  // =========================================================================
  // REQUESTER PORTAL (Database-backed Catalog View with Fallback)
  // =========================================================================
  if (userRole === "REQUESTER") {
    const displayCatalog = catalogItems.length > 0 ? catalogItems : REQUESTER_SERVICES_CATALOG;
    const filteredCatalog = displayCatalog.filter((item: any) => {
      const catLower = (item.category_label || "").toLowerCase();
      let matchesCategory = true;
      if (requesterCategory === "hardware") {
        matchesCategory = catLower.includes("hardware") || catLower.includes("equipment");
      } else if (requesterCategory === "software") {
        matchesCategory = catLower.includes("software") || catLower.includes("access") || catLower.includes("sso");
      } else if (requesterCategory === "security") {
        matchesCategory = catLower.includes("security") || catLower.includes("mfa") || catLower.includes("vpn");
      } else if (requesterCategory === "general") {
        matchesCategory = catLower.includes("general") || catLower.includes("assistance");
      }

      const q = requesterSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        catLower.includes(q);

      return matchesCategory && matchesSearch;
    });

    return (
      <div className="space-y-8 max-w-6xl mx-auto" id="requester-services-page">
        {/* Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#DDCEFB] text-[#6D28D9] flex items-center justify-center shrink-0">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-[11px] font-semibold mb-1 border border-[#DDD6FE]">
                <span>Service Catalog</span>
              </div>
              <h1 className="text-xl font-extrabold text-[#0E1726] tracking-tight">
                IT Service Requests &amp; Provisioning
              </h1>
              <p className="text-xs text-[#6B7488] mt-1 max-w-xl">
                Browse hardware equipment, software SSO access, and IT security services available for your workspace.
              </p>
            </div>
          </div>

          <div className="shrink-0">
            <Link
              href="/itsm/incidents/new"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>Report Broken Equipment / Bug</span>
            </Link>
          </div>
        </div>

        {/* Category Tabs & Search Bar */}
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[#F0F2F6] flex-1">
              {[
                { id: "all", label: "All Services", icon: Layers },
                { id: "hardware", label: "Hardware & Equipment", icon: Laptop },
                { id: "software", label: "Software Access & SSO", icon: Key },
                { id: "security", label: "Security & MFA Reset", icon: ShieldCheck },
                { id: "general", label: "General IT Assistance", icon: LifeBuoy },
              ].map((cat) => {
                const Icon = cat.icon;
                const active = requesterCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setRequesterCategory(cat.id)}
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

            <button
              onClick={fetchCatalogItems}
              className="p-2 text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-xl border border-[#E6E9F0] transition shrink-0"
              title="Refresh service catalog"
            >
              <RefreshCw className={`w-4 h-4 ${catalogLoading ? "animate-spin text-[#6D28D9]" : ""}`} />
            </button>
          </div>

          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
            <input
              type="text"
              value={requesterSearch}
              onChange={(e) => setRequesterSearch(e.target.value)}
              placeholder="Search service catalog (e.g. laptop, AWS, VPN)..."
              className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl pl-9 pr-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
          </div>
        </div>

        {/* Error Alert */}
        {catalogError && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
            <span>{catalogError}</span>
            <button
              onClick={fetchCatalogItems}
              className="text-xs font-bold text-red-800 hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Services Grid */}
        {catalogLoading && catalogItems.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center text-xs text-[#6B7488]">
            <RefreshCw className="w-5 h-5 text-[#6D28D9] animate-spin mx-auto mb-2" />
            <span>Loading service catalog...</span>
          </div>
        ) : filteredCatalog.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#F5F7FA] text-[#6B7488] flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-[#0E1726]">No services found</h3>
            <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
              {requesterSearch
                ? "No catalog items match your search criteria."
                : "No active service catalog items available for this category."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCatalog.map((service: any) => (
              <div
                key={service.id}
                className="bg-white rounded-2xl border border-[#E6E9F0] hover:border-[#A78BFA] p-6 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4 group"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-full border border-[#A78BFA]">
                      {service.category_label || service.categoryLabel}
                    </span>
                    {(service.approval_required || service.popular) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                        <Zap className="w-3 h-3 text-amber-500" />{" "}
                        {service.approval_required ? "Approval Required" : "Popular"}
                      </span>
                    )}
                  </div>

                  <h3 className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition">
                    {service.name || service.title}
                  </h3>

                  <p className="text-xs text-[#6B7488] leading-relaxed line-clamp-3">
                    {service.description || "Request standard IT provisioning for your workspace."}
                  </p>
                </div>

                <div className="pt-3 border-t border-[#F0F2F6] space-y-3">
                  <div className="flex items-center justify-between text-[11px] text-[#6B7488]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> {service.estimated_time_label || service.estimatedTime || "24 hrs"} SLA
                    </span>
                    <span className="font-semibold text-[#475069]">
                      {service.fulfillment_type || service.fulfillmentType || "IT Triage"}
                    </span>
                  </div>

                  <Link
                    href={`/itsm/requests/new?item=${encodeURIComponent(service.id)}`}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-bold rounded-xl transition shadow-sm"
                  >
                    <span>Request Service</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // SERVICE AGENT WORKSPACE: Operational Services & CMDB Context
  // =========================================================================
  const getStatusBadge = (status?: string | null) => {
    switch ((status || "OPERATIONAL").toUpperCase()) {
      case "OPERATIONAL":
      case "ACTIVE":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            OPERATIONAL
          </span>
        );
      case "DEGRADED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            DEGRADED
          </span>
        );
      case "OUTAGE":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            OUTAGE
          </span>
        );
      case "MAINTENANCE":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            MAINTENANCE
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-700 border border-slate-200">
            {status || "UNKNOWN"}
          </span>
        );
    }
  };

  const getTierBadge = (tier?: string | null) => {
    switch ((tier || "TIER_3").toUpperCase()) {
      case "TIER_1":
        return (
          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]">
            Tier 1 · Mission Critical
          </span>
        );
      case "TIER_2":
        return (
          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
            Tier 2 · Business Core
          </span>
        );
      case "TIER_3":
        return (
          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-slate-50 text-slate-700 border border-slate-200">
            Tier 3 · Standard IT
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-slate-50 text-slate-700 border border-slate-200">
            {tier || "TIER_3"}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto" id="service-agent-services-page">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-[#F1ECFE] text-[#6D28D9]">
              <Layers className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-[#0E1726] tracking-tight">
              Operational IT Services &amp; CMDB Context
            </h1>
          </div>
          <p className="text-xs text-[#6B7488]">
            Browse operational technical services, escalation ownership, configuration items, and active ticket dependencies.
          </p>
        </div>

        <button
          onClick={() => fetchServices()}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA] transition self-start md:self-auto"
          id="services-refresh-button"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#6D28D9]" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-xs space-y-4" id="services-controls-bar">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
            <input
              type="text"
              id="services-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search services by name, description, or escalation team..."
              className="w-full pl-9 pr-9 py-2 bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl text-xs text-[#0E1726] placeholder-[#6B7488] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#6D28D9] transition"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-2.5 text-[#6B7488] hover:text-[#0E1726]"
                id="services-clear-search-button"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Status & Tier Filter Tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 bg-[#F5F7FA] rounded-xl border border-[#E6E9F0] text-xs">
              <span className="text-[10px] font-semibold text-[#6B7488] uppercase px-2">Status:</span>
              {["ALL", "OPERATIONAL", "DEGRADED", "MAINTENANCE"].map((stat) => (
                <button
                  key={stat}
                  onClick={() => setStatusFilter(stat)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                    statusFilter === stat
                      ? "bg-white text-[#0E1726] shadow-xs"
                      : "text-[#6B7488] hover:text-[#0E1726]"
                  }`}
                >
                  {stat === "ALL" ? "All" : stat.charAt(0) + stat.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#F5F7FA] rounded-xl border border-[#E6E9F0] text-xs">
              <span className="text-[10px] font-semibold text-[#6B7488] uppercase px-2">Tier:</span>
              {["ALL", "TIER_1", "TIER_2", "TIER_3"].map((tier) => (
                <button
                  key={tier}
                  onClick={() => setTierFilter(tier)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                    tierFilter === tier
                      ? "bg-white text-[#0E1726] shadow-xs"
                      : "text-[#6B7488] hover:text-[#0E1726]"
                  }`}
                >
                  {tier === "ALL" ? "All" : tier.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      {loading && services.length === 0 ? (
        <div className="flex items-center justify-center py-20" id="services-loading-state">
          <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin" />
          <span className="ml-3 text-xs text-[#475069]">Loading operational services...</span>
        </div>
      ) : error ? (
        <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-3" id="services-error-state">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
          <p className="text-xs text-rose-700 font-medium">{error}</p>
          <button
            onClick={() => fetchServices()}
            className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-semibold hover:bg-rose-700 transition"
          >
            Retry
          </button>
        </div>
      ) : services.length === 0 ? (
        <div className="p-12 bg-white border border-[#E6E9F0] rounded-2xl text-center space-y-3" id="services-empty-state">
          <Layers className="w-10 h-10 text-[#A78BFA] mx-auto" />
          <h3 className="text-sm font-bold text-[#0E1726]">No services found</h3>
          <p className="text-xs text-[#6B7488] max-w-md mx-auto">
            {search || statusFilter !== "ALL" || tierFilter !== "ALL"
              ? "No operational services matched your current search and filter criteria. Clear filters to see all services."
              : "No services are currently defined in this tenant."}
          </p>
          {(search || statusFilter !== "ALL" || tierFilter !== "ALL") && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("ALL");
                setTierFilter("ALL");
              }}
              className="px-4 py-2 bg-[#6D28D9] text-white rounded-xl text-xs font-semibold hover:bg-[#5B21B6] transition"
              id="services-reset-filters-button"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="services-grid">
          {services.map((service) => (
            <Link
              key={service.id}
              href={`/itsm/services/${service.id}`}
              className="bg-white rounded-2xl border border-[#E6E9F0] hover:border-[#A78BFA] p-5 shadow-xs hover:shadow-md transition flex flex-col justify-between space-y-4 group"
              id={`service-card-${service.id}`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  {getTierBadge(service.tier)}
                  {getStatusBadge(service.status)}
                </div>

                <div>
                  <h3
                    className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition"
                    id={`service-card-name-${service.id}`}
                  >
                    {service.name}
                  </h3>
                  <p className="text-xs text-[#6B7488] mt-1 line-clamp-2 leading-relaxed">
                    {service.description || "No description provided."}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-[#F0F2F6] space-y-2 text-[11px] text-[#6B7488]">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#8C95A8]" />
                    <span>{service.escalation_team || "IT Support"}</span>
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-[#475069]">
                    <Database className="w-3.5 h-3.5 text-[#8C95A8]" />
                    <span>{service.ci_count ?? 0} CIs</span>
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Ticket className="w-3.5 h-3.5 text-[#8C95A8]" />
                    <span>{service.active_ticket_count ?? 0} Active Tickets</span>
                  </span>
                  <span className="text-[#8C95A8]">
                    {service.updated_at ? `Updated ${formatDateTime(service.updated_at)}` : "Recently updated"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
