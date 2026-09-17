"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  Building,
  Calendar,
  CheckCircle2,
  Clock,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

interface PlatformSettings {
  tenant_id: string;
  tenant_name: string;
  platform_edition: string;
  notifications_enabled: boolean;
  notification_delivery_channel: string;
  default_priority: string;
  active_services_count: number;
  active_catalog_items_count: number;
  active_sla_policies_count: number;
  default_business_calendar: string | null;
}

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/itsm/admin/settings", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load platform settings (${res.status})`);
      }
      const data = await res.json();
      setSettings(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load platform settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <div className="space-y-6 max-w-5xl pb-16">
      {/* Back Link */}
      <div>
        <Link
          href="/itsm/admin-portal"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7488] hover:text-[#0F1523] transition group"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to Overview
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F1523]">
            Platform Settings
          </h1>
          <p className="text-sm text-[#475069] mt-1">
            Review tenant platform architecture, in-app notification infrastructure, and operational baseline parameters.
          </p>
        </div>

        <button
          onClick={fetchSettings}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#D5D9E2] text-sm font-medium text-[#475069] hover:text-[#0F1523] hover:bg-[#F8FAFC] transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm font-medium">{error}</div>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-[#E6E9F0] rounded-2xl p-16 text-center flex flex-col items-center justify-center min-h-[300px]">
          <Loader2 className="w-8 h-8 text-[#6D28D9] animate-spin mb-3" />
          <p className="text-sm text-[#6B7488]">Loading platform settings and configuration...</p>
        </div>
      ) : settings ? (
        <div className="space-y-6">
          {/* Section 1: Tenant Platform Architecture */}
          <div className="bg-white border border-[#E6E9F0] rounded-2xl shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3 pb-4 border-b border-[#E6E9F0]">
              <div className="w-10 h-10 rounded-xl bg-[#F1ECFE] flex items-center justify-center text-[#6D28D9]">
                <Building className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F1523]">Tenant Platform Architecture</h2>
                <p className="text-xs text-[#6B7488]">Authenticated workspace context and isolation boundaries</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7488]">Active Tenant</p>
                <p className="text-sm font-bold text-[#0F1523] mt-1">{settings.tenant_name}</p>
                <p className="text-[11px] font-mono text-[#8C95A8] truncate mt-0.5">{settings.tenant_id}</p>
              </div>

              <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7488]">Platform Edition</p>
                <p className="text-sm font-bold text-[#0F1523] mt-1">{settings.platform_edition}</p>
                <p className="text-[11px] text-emerald-700 font-medium mt-0.5">MVP Foundation Operational</p>
              </div>

              <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7488]">Security Isolation</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-bold text-[#0F1523]">Server-Side Enforced</span>
                </div>
                <p className="text-[11px] text-[#6B7488] mt-0.5">Strict Tenant DB Scoping</p>
              </div>
            </div>
          </div>

          {/* Section 2: Notifications Infrastructure */}
          <div className="bg-white border border-[#E6E9F0] rounded-2xl shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3 pb-4 border-b border-[#E6E9F0]">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F1523]">Notification Infrastructure</h2>
                <p className="text-xs text-[#6B7488]">In-app notification delivery and real-time operational alerts</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-[#0F1523]">In-App Notification Delivery</h3>
                  <p className="text-xs text-[#475069] mt-1 leading-relaxed">
                    Alerts, ticket updates, assignment handoffs, and SLA warnings are delivered natively through the in-app notification feed in real-time.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active & Polling
                    </span>
                    <span className="text-[11px] font-mono text-[#6B7488]">Channel: IN_APP</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] flex items-start gap-3">
                <Shield className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-[#0F1523]">Tenant Privacy & Data Isolation</h3>
                  <p className="text-xs text-[#475069] mt-1 leading-relaxed">
                    All notifications are isolated per tenant in <code className="text-xs font-mono bg-white px-1.5 py-0.5 rounded border">public.notifications</code>. No external email relays or third-party SMS providers are required in the MVP.
                  </p>
                  <div className="mt-3">
                    <span className="text-[11px] text-[#6B7488]">Zero external webhook credentials required</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Operational Baselines & Defaults */}
          <div className="bg-white border border-[#E6E9F0] rounded-2xl shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3 pb-4 border-b border-[#E6E9F0]">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#0F1523]">Operational Policy Baselines</h2>
                <p className="text-xs text-[#6B7488]">Default resolution thresholds and active entity counts</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7488]">Default Priority</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    {settings.default_priority}
                  </span>
                  <span className="text-xs text-[#475069]">Medium Impact</span>
                </div>
                <p className="text-[10px] text-[#6B7488] mt-2">Standard incident intake default</p>
              </div>

              <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7488]">Default Calendar</p>
                <p className="text-xs font-bold text-[#0F1523] mt-1 truncate">{settings.default_business_calendar}</p>
                <Link
                  href="/itsm/admin-portal/sla"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6D28D9] hover:underline mt-2"
                >
                  Manage Calendars &rarr;
                </Link>
              </div>

              <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7488]">Active Services</p>
                <p className="text-xl font-bold text-[#0F1523] mt-1">{settings.active_services_count}</p>
                <Link
                  href="/itsm/admin-portal/services"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6D28D9] hover:underline mt-1"
                >
                  Manage Services &rarr;
                </Link>
              </div>

              <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7488]">SLA Policies</p>
                <p className="text-xl font-bold text-[#0F1523] mt-1">{settings.active_sla_policies_count}</p>
                <Link
                  href="/itsm/admin-portal/sla"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6D28D9] hover:underline mt-1"
                >
                  Manage SLAs &rarr;
                </Link>
              </div>
            </div>
          </div>

          {/* Section 4: MVP Boundaries & Roadmap Notice */}
          <div className="p-6 rounded-2xl border border-[#DDD6FE] bg-gradient-to-br from-[#F5F3FF] to-[#FAF5FF] flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#6D28D9] flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="space-y-1.5 text-xs text-[#475069]">
              <h3 className="text-sm font-bold text-[#0F1523]">MVP Platform Scope & Future Roadmap</h3>
              <p className="leading-relaxed">
                This concludes <strong>Phase 4 Platform Administrator MVP</strong>. No additional platform settings are configurable in this release. All operational controls are actively maintained through their designated modules: <strong>Users</strong>, <strong>Teams</strong>, <strong>Services</strong>, <strong>Configuration Items</strong>, <strong>Service Catalog</strong>, and <strong>SLA Configuration</strong>.
              </p>
              <p className="text-[#6B7488] leading-relaxed pt-1">
                Advanced features (including visual workflow builders, external webhook event dispatchers, AIOps correlation models, and marketplace integrations) are reserved for subsequent roadmap phases.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
