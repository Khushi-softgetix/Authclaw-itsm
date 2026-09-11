"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Loader2,
  Server,
  Timer,
  X,
} from "lucide-react";

interface Service {
  id: string;
  name: string;
}

interface BusinessCalendar {
  id: string;
  name: string;
  timezone: string;
}

const PRIORITIES = [
  { value: "P1", label: "P1 - Critical", desc: "Outages, security breaches, catastrophic system failures", defaultResp: 15, defaultRes: 240 },
  { value: "P2", label: "P2 - High", desc: "Core function unavailable with major operational impact", defaultResp: 30, defaultRes: 480 },
  { value: "P3", label: "P3 - Medium", desc: "Degraded functionality, workarounds available", defaultResp: 120, defaultRes: 1440 },
  { value: "P4", label: "P4 - Low", desc: "Minor questions, cosmetic defects, requests", defaultResp: 480, defaultRes: 2880 },
];

export default function CreateSLAPolicyPage() {
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [calendars, setCalendars] = useState<BusinessCalendar[]>([]);
  const [loadingDependencies, setLoadingDependencies] = useState(true);

  // Form fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("P1");
  const [serviceId, setServiceId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [responseTargetMinutes, setResponseTargetMinutes] = useState(15);
  const [resolutionTargetMinutes, setResolutionTargetMinutes] = useState(240);
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDependencies() {
      try {
        const [svcRes, calRes] = await Promise.all([
          fetch("/api/itsm/admin/services", { cache: "no-store" }),
          fetch("/api/itsm/admin/business-calendars", { cache: "no-store" }),
        ]);

        if (svcRes.ok) {
          const svcData = await svcRes.json();
          setServices(Array.isArray(svcData) ? svcData : []);
        }
        if (calRes.ok) {
          const calData = await calRes.json();
          setCalendars(Array.isArray(calData) ? calData : []);
        }
      } catch (err: unknown) {
        console.error("Failed to load dependencies", err);
      } finally {
        setLoadingDependencies(false);
      }
    }
    loadDependencies();
  }, []);

  const handlePriorityChange = (val: string) => {
    setPriority(val);
    const preset = PRIORITIES.find((p) => p.value === val);
    if (preset) {
      setResponseTargetMinutes(preset.defaultResp);
      setResolutionTargetMinutes(preset.defaultRes);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Policy name is required.");
      return;
    }
    if (responseTargetMinutes <= 0 || resolutionTargetMinutes <= 0) {
      setError("Target minutes must be greater than 0.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/itsm/admin/sla-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          ticket_type: "INCIDENT",
          priority,
          service_id: serviceId || undefined,
          calendar_id: calendarId || undefined,
          response_target_minutes: Number(responseTargetMinutes),
          resolution_target_minutes: Number(resolutionTargetMinutes),
          is_active: isActive,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.message || `Failed to create SLA policy (${res.status})`);
      }

      router.push("/itsm/admin-portal/sla");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred while creating SLA policy");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl pb-16">
      {/* Back Link */}
      <div>
        <Link
          href="/itsm/admin-portal/sla"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7488] hover:text-[#0F1523] transition group"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to SLA Configuration
        </Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0F1523]">
          Create SLA Policy
        </h1>
        <p className="text-sm text-[#475069] mt-1">
          Establish formal response and resolution time targets based on priority and operational scope.
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm font-medium">{error}</div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core Policy Definition */}
        <div className="bg-white border border-[#E6E9F0] rounded-2xl shadow-sm p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E6E9F0]">
            <div className="w-10 h-10 rounded-xl bg-[#F1ECFE] flex items-center justify-center text-[#6D28D9]">
              <Timer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#0F1523]">Policy Definition</h2>
              <p className="text-xs text-[#6B7488]">Specify basic policy identification and scope</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Policy Name */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Policy Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Critical Incident SLA, Standard Support SLA"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Description
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Context or criteria under which this SLA policy applies..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
            </div>

            {/* Priority Selection */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Target Incident Priority <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handlePriorityChange(p.value)}
                    className={`p-3.5 rounded-xl text-left border transition flex flex-col justify-between ${
                      priority === p.value
                        ? "border-[#6D28D9] bg-[#F1ECFE]/30 ring-1 ring-[#6D28D9]"
                        : "border-[#E6E9F0] bg-white hover:border-[#D5D9E2]"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-[#0F1523]">{p.label}</span>
                        {priority === p.value && (
                          <Check className="w-4 h-4 text-[#6D28D9]" />
                        )}
                      </div>
                      <p className="text-[11px] text-[#6B7488] mt-1 leading-snug">{p.desc}</p>
                    </div>
                    <div className="text-[10px] text-[#475069] mt-3 font-mono">
                      Resp: {p.defaultResp}m | Res: {Math.round(p.defaultRes / 60)}h
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Service Scope */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Service Scope
              </label>
              <div className="relative">
                <select
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition appearance-none"
                >
                  <option value="">All Services (Tenant-wide default)</option>
                  {services.map((svc) => (
                    <option key={svc.id} value={svc.id}>
                      {svc.name}
                    </option>
                  ))}
                </select>
                <Server className="w-4 h-4 text-[#6B7488] absolute right-3.5 top-3 pointer-events-none" />
              </div>
              <p className="text-[11px] text-[#6B7488]">Optionally scope this SLA to a specific business service</p>
            </div>

            {/* Business Calendar */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Business Calendar
              </label>
              <div className="relative">
                <select
                  value={calendarId}
                  onChange={(e) => setCalendarId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition appearance-none"
                >
                  <option value="">24x7 Unrestricted Calendar</option>
                  {calendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.name} ({cal.timezone})
                    </option>
                  ))}
                </select>
                <Calendar className="w-4 h-4 text-[#6B7488] absolute right-3.5 top-3 pointer-events-none" />
              </div>
              <p className="text-[11px] text-[#6B7488]">Calculates SLA breach countdown only during defined hours</p>
            </div>
          </div>
        </div>

        {/* Target Thresholds Section */}
        <div className="bg-white border border-[#E6E9F0] rounded-2xl shadow-sm p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E6E9F0]">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#0F1523]">Target Thresholds</h2>
              <p className="text-xs text-[#6B7488]">Specify response and resolution deadlines</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Response Target */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Response Target (Minutes) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={1}
                required
                value={responseTargetMinutes}
                onChange={(e) => setResponseTargetMinutes(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
              <p className="text-[11px] text-[#6B7488]">
                Time allowed from ticket creation until agent first responds / assigns
              </p>
            </div>

            {/* Resolution Target */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Resolution Target (Minutes) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={1}
                required
                value={resolutionTargetMinutes}
                onChange={(e) => setResolutionTargetMinutes(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
              <p className="text-[11px] text-[#6B7488]">
                Total elapsed business time until ticket resolution is recorded
              </p>
            </div>

            {/* Active Toggle */}
            <div className="md:col-span-2 flex items-start gap-3 p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
              <input
                id="policy-active-toggle"
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-[#D5D9E2] text-[#6D28D9] focus:ring-[#6D28D9]"
              />
              <label htmlFor="policy-active-toggle" className="cursor-pointer">
                <span className="block text-sm font-semibold text-[#0F1523]">Enable SLA Policy</span>
                <span className="block text-xs text-[#6B7488] mt-0.5">
                  Activate this SLA rule immediately for matching incoming tickets
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E6E9F0]">
          <Link
            href="/itsm/admin-portal/sla"
            className="px-5 py-2.5 rounded-xl border border-[#D5D9E2] text-sm font-medium text-[#475069] hover:bg-[#F8FAFC] hover:text-[#0F1523] transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#6D28D9] text-white text-sm font-medium shadow-sm hover:bg-[#5B21B6] transition disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating Policy...
              </>
            ) : (
              "Create SLA Policy"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
