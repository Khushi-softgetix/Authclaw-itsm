"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Key,
  Laptop,
  Layers,
  LifeBuoy,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";

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

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const fetchCatalogItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
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
      setServices(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load service catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalogItems();
  }, [fetchCatalogItems]);

  const filteredServices = services.filter((item) => {
    const catLower = (item.category_label || "").toLowerCase();
    let matchesCategory = true;
    if (selectedCategory === "hardware") {
      matchesCategory = catLower.includes("hardware") || catLower.includes("equipment");
    } else if (selectedCategory === "software") {
      matchesCategory = catLower.includes("software") || catLower.includes("access") || catLower.includes("sso");
    } else if (selectedCategory === "security") {
      matchesCategory = catLower.includes("security") || catLower.includes("mfa") || catLower.includes("vpn");
    } else if (selectedCategory === "general") {
      matchesCategory = catLower.includes("general") || catLower.includes("assistance");
    }

    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q)) ||
      item.service_name.toLowerCase().includes(q) ||
      catLower.includes(q);

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

        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search service catalog (e.g. laptop, AWS, VPN)..."
              className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl pl-9 pr-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
          </div>

          <button
            onClick={fetchCatalogItems}
            className="p-2 text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-xl border border-[#E6E9F0] transition"
            title="Refresh service catalog"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchCatalogItems}
            className="text-xs font-bold text-red-800 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Services Grid / Loading / Empty State */}
      {loading && services.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center text-xs text-[#6B7488]">
          <RefreshCw className="w-5 h-5 text-[#6D28D9] animate-spin mx-auto mb-2" />
          <span>Loading database-backed service catalog...</span>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#F5F7FA] text-[#6B7488] flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#0E1726]">No services found</h3>
          <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
            {searchQuery
              ? "No catalog items match your search criteria."
              : "No active service catalog items available for this category."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServices.map((service) => (
            <div
              key={service.id}
              className="bg-white rounded-2xl border border-[#E6E9F0] hover:border-[#A78BFA] p-6 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4 group"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-full border border-[#A78BFA]">
                    {service.category_label}
                  </span>
                  {service.approval_required && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      <Zap className="w-3 h-3 text-amber-500" /> Approval Required
                    </span>
                  )}
                </div>

                <h3 className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition">
                  {service.name}
                </h3>

                <p className="text-xs text-[#6B7488] leading-relaxed line-clamp-3">
                  {service.description || "Request standard IT provisioning for your workspace."}
                </p>
              </div>

              <div className="pt-3 border-t border-[#F0F2F6] space-y-3">
                <div className="flex items-center justify-between text-[11px] text-[#6B7488]">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> {service.estimated_time_label} SLA
                  </span>
                  <span className="font-semibold text-[#475069]">{service.fulfillment_type}</span>
                </div>

                <Link
                  href={`/itsm/incidents/new?category=${encodeURIComponent(service.category_label)}&title=${encodeURIComponent(service.name)}`}
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
