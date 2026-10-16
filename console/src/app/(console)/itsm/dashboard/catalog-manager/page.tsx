"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Layers,
  ArrowRight,
  ShieldCheck,
  FileCheck,
  User,
  Sparkles,
  CheckCircle2,
  Lock,
  Boxes,
  XCircle,
  AlertCircle,
} from "lucide-react";

interface CatalogItemSummary {
  id: string;
  is_active: boolean;
  fulfillment_group: string | null;
}

export default function CatalogManagerDashboardPage() {
  const [metrics, setMetrics] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    needsAttention: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCatalogMetrics() {
      try {
        setLoading(true);
        const res = await fetch("/api/itsm/admin/service-catalog", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const total = data.length;
            const active = data.filter((it: CatalogItemSummary) => it.is_active).length;
            const inactive = data.filter((it: CatalogItemSummary) => !it.is_active).length;
            const needsAttention = data.filter(
              (it: CatalogItemSummary) => !it.fulfillment_group || !it.fulfillment_group.trim()
            ).length;
            setMetrics({ total, active, inactive, needsAttention });
          }
        }
      } catch {
        // Non-blocking fallback
      } finally {
        setLoading(false);
      }
    }
    loadCatalogMetrics();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6" id="catalog-manager-dashboard-container">
      {/* Header Banner - Clean white Catalog Studio-style design */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-xs font-semibold border border-[#DDD6FE]/60">
            <Layers className="w-3.5 h-3.5" />
            <span>Service Catalog Administration · Role Foundation</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight" id="catalog-manager-dashboard-title">
            Catalog Manager Workspace
          </h1>
          <p className="text-xs text-[#6B7488] max-w-2xl leading-relaxed">
            Delegated operational administration for enterprise Service Catalog offerings, request intake forms, and fulfillment specifications without Platform Administrator privileges.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <Link
            href="/itsm/catalog-manager/studio"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E6E9F0] bg-white text-[#475069] hover:text-[#0E1726] hover:bg-slate-50 font-bold text-xs transition shadow-xs"
            id="open-catalog-studio-cta"
          >
            <Boxes className="w-3.5 h-3.5 text-[#6D28D9]" />
            <span>Open Catalog Studio</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#8A93A5]" />
          </Link>
          <Link
            href="/itsm/catalog-manager/studio/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs"
            id="create-catalog-item-cta"
          >
            <span>+ Create Item</span>
          </Link>
        </div>
      </div>

      {/* Catalog Item Summary Metric Cards - Fully clickable */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="catalog-metrics-grid">
        {/* Total Offerings */}
        <Link
          href="/itsm/catalog-manager/studio"
          className="group bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-1 hover:border-[#6D28D9] hover:shadow-md hover:-translate-y-0.5 hover:bg-[#FAF8FF]/50 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"
          id="metric-card-total-offerings"
          title="View all catalog offerings"
        >
          <div className="flex items-center justify-between text-[#6B7488]">
            <span className="text-[10px] font-bold uppercase tracking-wider group-hover:text-[#6D28D9] transition-colors">
              Total Offerings
            </span>
            <Boxes className="w-4 h-4 text-[#6D28D9]" />
          </div>
          <div className="text-2xl font-extrabold text-[#0E1726]" id="metric-total-offerings">
            {loading ? "—" : metrics.total}
          </div>
          <p className="text-[11px] text-[#6B7488]">Published and retired items</p>
        </Link>

        {/* Active Offerings */}
        <Link
          href="/itsm/catalog-manager/studio"
          className="group bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-1 hover:border-emerald-500 hover:shadow-md hover:-translate-y-0.5 hover:bg-emerald-50/30 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          id="metric-card-active-offerings"
          title="View active catalog offerings"
        >
          <div className="flex items-center justify-between text-emerald-600">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488] group-hover:text-emerald-700 transition-colors">
              Active
            </span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-700" id="metric-active-offerings">
            {loading ? "—" : metrics.active}
          </div>
          <p className="text-[11px] text-[#6B7488]">Available in requester portal</p>
        </Link>

        {/* Inactive Offerings */}
        <Link
          href="/itsm/catalog-manager/studio"
          className="group bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-1 hover:border-slate-400 hover:shadow-md hover:-translate-y-0.5 hover:bg-slate-50/50 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          id="metric-card-inactive-offerings"
          title="View inactive catalog offerings"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488] group-hover:text-slate-700 transition-colors">
              Inactive / Disabled
            </span>
            <XCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-slate-700" id="metric-inactive-offerings">
            {loading ? "—" : metrics.inactive}
          </div>
          <p className="text-[11px] text-[#6B7488]">Hidden from employee portal</p>
        </Link>

        {/* Needs Attention */}
        <Link
          href="/itsm/catalog-manager/studio"
          className="group bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-1 hover:border-amber-500 hover:shadow-md hover:-translate-y-0.5 hover:bg-amber-50/30 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          id="metric-card-needs-attention"
          title="View offerings needing fulfillment assignment"
        >
          <div className="flex items-center justify-between text-amber-600">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488] group-hover:text-amber-700 transition-colors">
              Needs Attention
            </span>
            <AlertCircle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-amber-700" id="metric-needs-attention">
            {loading ? "—" : metrics.needsAttention}
          </div>
          <p className="text-[11px] text-[#6B7488]">Missing fulfillment group</p>
        </Link>
      </div>

      {/* Role Foundation Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center shrink-0 text-[#6D28D9]">
            <Layers className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">Role Model</span>
            <h3 className="text-sm font-bold text-[#0E1726]">Delegated Business Role</h3>
            <p className="text-xs text-[#6B7488] leading-relaxed">
              Designed for IT Procurement, HR Operations, and Service Owners to curate catalog items autonomously.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0 text-emerald-600">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">RBAC Guardrails</span>
            <h3 className="text-sm font-bold text-[#0E1726]">Strict Role Boundaries</h3>
            <p className="text-xs text-[#6B7488] leading-relaxed">
              Completely isolated from IAM, user management, security tokens, system settings, and SLA engine rules.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center shrink-0 text-[#6D28D9]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">Studio Status</span>
            <h3 className="text-sm font-bold text-[#0E1726]">Prompt 2: Catalog Studio Active</h3>
            <p className="text-xs text-[#6B7488] leading-relaxed">
              Dedicated catalog management studio, offerings inventory, search/filter, and CRUD workflows enabled.
            </p>
          </div>
        </div>
      </div>

      {/* Main Workspace Navigation Modules */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#0E1726]">Workspace Navigation Modules</h2>
          <span className="text-xs text-[#6B7488]">3 Core Role Entitlements</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Catalog Studio */}
          <Link
            href="/itsm/catalog-manager/studio"
            className="group bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs hover:border-[#6D28D9] hover:shadow-md hover:-translate-y-0.5 hover:bg-[#FAF8FF]/50 transition-all flex flex-col justify-between cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"
            id="catalog-manager-studio-card"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#F1ECFE] text-[#6D28D9] flex items-center justify-center font-bold">
                <Boxes className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition-colors">
                Catalog Studio
              </h3>
              <p className="text-xs text-[#6B7488] leading-relaxed">
                Manage, search, filter, create, and update Service Catalog offerings, delivery SLAs, and fulfillment assignments.
              </p>
            </div>
            <div className="pt-4 mt-4 border-t border-[#E6E9F0] flex items-center justify-between text-xs font-bold text-[#6D28D9]">
              <span>Open Catalog Studio</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Card 2: Form Builder Placeholder */}
          <Link
            href="/itsm/catalog-manager/form-builder"
            className="group bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs hover:border-[#6D28D9] hover:shadow-md hover:-translate-y-0.5 hover:bg-[#FAF8FF]/50 transition-all flex flex-col justify-between cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"
            id="catalog-manager-form-builder-card"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-[#7C3AED] flex items-center justify-center font-bold">
                <FileCheck className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition-colors">
                  Form Builder
                </h3>
                <span className="text-[10px] font-bold text-[#6D28D9] bg-[#F1ECFE] px-2 py-0.5 rounded-full">
                  Step 2
                </span>
              </div>
              <p className="text-xs text-[#6B7488] leading-relaxed">
                Preview the upcoming No-Code Question Builder and dynamic schema engine (REQ-003 / PLT-006) for authoring intake questionnaires.
              </p>
            </div>
            <div className="pt-4 mt-4 border-t border-[#E6E9F0] flex items-center justify-between text-xs font-bold text-[#6D28D9]">
              <span>Preview Form Studio</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>

          {/* Card 3: Profile */}
          <Link
            href="/itsm/profile"
            className="group bg-white rounded-2xl border border-[#E6E9F0] p-6 shadow-xs hover:border-[#6D28D9] hover:shadow-md hover:-translate-y-0.5 hover:bg-[#FAF8FF]/50 transition-all flex flex-col justify-between cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"
            id="catalog-manager-profile-card"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-slate-50 text-[#475069] flex items-center justify-center font-bold">
                <User className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition-colors">
                Catalog Manager Profile
              </h3>
              <p className="text-xs text-[#6B7488] leading-relaxed">
                Review your active session identity, workspace tenant details, and verified catalog management privileges.
              </p>
            </div>
            <div className="pt-4 mt-4 border-t border-[#E6E9F0] flex items-center justify-between text-xs font-bold text-[#6D28D9]">
              <span>Manage Profile</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        </div>
      </div>

      {/* Role Boundary & Security Notice */}
      <div className="rounded-2xl border border-[#E6E9F0] bg-white p-6 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-[#0E1726]">
          <Lock className="w-4 h-4 text-[#6D28D9]" />
          <h3 className="text-sm font-bold">Platform Administrator Separation Guardrails</h3>
        </div>
        <p className="text-xs text-[#6B7488] leading-relaxed">
          The Catalog Manager role is intentionally decoupled from Platform Administration. Catalog Managers cannot access user administration, SAML/OIDC configuration, API keys, platform system settings, or incident resolution workflows. This delegation ensures departmental service owners can maintain service forms safely without administrative risk.
        </p>
        <div className="pt-2 flex flex-wrap gap-2 text-[11px] text-[#475069]">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Multi-Tenant RLS Enforced
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Platform Admin Isolated
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Role-Aware Navigation Active
          </span>
        </div>
      </div>
    </div>
  );
}
