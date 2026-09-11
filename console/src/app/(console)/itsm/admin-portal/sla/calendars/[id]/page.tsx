"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Globe,
  Loader2,
  X,
} from "lucide-react";

interface BusinessCalendar {
  id: string;
  name: string;
  timezone: string;
  weekly_hours: Record<string, { start: string; end: string }>;
  holidays: any[];
  is_default: boolean;
}

const TIMEZONES = [
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
  { value: "America/New_York", label: "America/New_York (US Eastern Time)" },
  { value: "America/Chicago", label: "America/Chicago (US Central Time)" },
  { value: "America/Denver", label: "America/Denver (US Mountain Time)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (US Pacific Time)" },
  { value: "Europe/London", label: "Europe/London (GMT / BST)" },
  { value: "Europe/Paris", label: "Europe/Paris (Central European Time)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (Gulf Standard Time)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (India Standard Time)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (Singapore Time)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (Japan Standard Time)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST)" },
];

const DAYS = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

export default function EditBusinessCalendarPage() {
  const params = useParams();
  const router = useRouter();
  const calendarId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [isDefault, setIsDefault] = useState(false);

  // Operating days state
  const [activeDays, setActiveDays] = useState<Record<string, boolean>>({
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
  });

  const [dayTimes, setDayTimes] = useState<Record<string, { start: string; end: string }>>({
    monday: { start: "09:00", end: "17:00" },
    tuesday: { start: "09:00", end: "17:00" },
    wednesday: { start: "09:00", end: "17:00" },
    thursday: { start: "09:00", end: "17:00" },
    friday: { start: "09:00", end: "17:00" },
    saturday: { start: "09:00", end: "17:00" },
    sunday: { start: "09:00", end: "17:00" },
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    async function loadCalendar() {
      if (!calendarId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/itsm/admin/business-calendars/${calendarId}`, { cache: "no-store" });
        if (!res.ok) {
          if (res.status === 404) throw new Error("Business calendar not found");
          throw new Error("Failed to load business calendar");
        }
        const data: BusinessCalendar = await res.json();
        setName(data.name || "");
        setTimezone(data.timezone || "UTC");
        setIsDefault(data.is_default ?? false);

        const loadedWeekly = data.weekly_hours || {};
        const newActiveDays: Record<string, boolean> = {};
        const newDayTimes: Record<string, { start: string; end: string }> = {};

        for (const d of DAYS) {
          if (loadedWeekly[d.key]) {
            newActiveDays[d.key] = true;
            newDayTimes[d.key] = {
              start: loadedWeekly[d.key].start || "09:00",
              end: loadedWeekly[d.key].end || "17:00",
            };
          } else {
            newActiveDays[d.key] = false;
            newDayTimes[d.key] = { start: "09:00", end: "17:00" };
          }
        }

        setActiveDays(newActiveDays);
        setDayTimes(newDayTimes);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load calendar details");
      } finally {
        setLoading(false);
      }
    }
    loadCalendar();
  }, [calendarId]);

  const toggleDay = (key: string) => {
    setActiveDays((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleTimeChange = (key: string, field: "start" | "end", val: string) => {
    setDayTimes((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: val,
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Calendar name is required.");
      return;
    }

    const weeklyHours: Record<string, { start: string; end: string }> = {};
    for (const d of DAYS) {
      if (activeDays[d.key]) {
        weeklyHours[d.key] = dayTimes[d.key];
      }
    }

    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/itsm/admin/business-calendars/${calendarId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          timezone,
          weekly_hours: weeklyHours,
          is_default: isDefault,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.message || `Failed to update calendar (${res.status})`);
      }

      setSaveSuccess(true);
      setTimeout(() => {
        router.push("/itsm/admin-portal/sla");
        router.refresh();
      }, 700);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred while updating calendar");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Loader2 className="w-8 h-8 text-[#6D28D9] animate-spin" />
        <p className="text-sm text-[#6B7488]">Loading calendar details...</p>
      </div>
    );
  }

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
          Edit Business Calendar
        </h1>
        <p className="text-sm text-[#475069] mt-1">
          Configure operating hours, timezones, and working schedules for SLA calculations.
        </p>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm font-medium">{error}</div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {saveSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-3 animate-in fade-in">
          <Check className="w-5 h-5 flex-shrink-0 text-emerald-600" />
          <div className="flex-1 text-sm font-medium">
            Business calendar updated successfully! Redirecting...
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core Calendar Settings */}
        <div className="bg-white border border-[#E6E9F0] rounded-2xl shadow-sm p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E6E9F0]">
            <div className="w-10 h-10 rounded-xl bg-[#F1ECFE] flex items-center justify-center text-[#6D28D9]">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#0F1523]">Calendar Identification</h2>
              <p className="text-xs text-[#6B7488]">Name, timezone, and tenant default status</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Calendar Name */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Calendar Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., North America Standard (9-5 ET), EMEA Operations"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] placeholder-[#8C95A8] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition"
              />
            </div>

            {/* Timezone */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#475069]">
                Timezone <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5D9E2] bg-white text-sm text-[#0F1523] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20 focus:border-[#6D28D9] transition appearance-none"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
                <Globe className="w-4 h-4 text-[#6B7488] absolute right-3.5 top-3 pointer-events-none" />
              </div>
              <p className="text-[11px] text-[#6B7488]">Timezone used to evaluate working business hours</p>
            </div>

            {/* Default Calendar Toggle */}
            <div className="md:col-span-2 flex items-start gap-3 p-4 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC]">
              <input
                id="default-cal-toggle"
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-[#D5D9E2] text-[#6D28D9] focus:ring-[#6D28D9]"
              />
              <label htmlFor="default-cal-toggle" className="cursor-pointer">
                <span className="block text-sm font-semibold text-[#0F1523]">Set as Default Calendar</span>
                <span className="block text-xs text-[#6B7488] mt-0.5">
                  Automatically apply this calendar to policies that do not explicitly specify one
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Operating Hours by Day */}
        <div className="bg-white border border-[#E6E9F0] rounded-2xl shadow-sm p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E6E9F0]">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#0F1523]">Operating Days & Hours</h2>
              <p className="text-xs text-[#6B7488]">Specify working shifts. Days unchecked are considered non-working days.</p>
            </div>
          </div>

          <div className="space-y-3">
            {DAYS.map((d) => {
              const active = activeDays[d.key];
              const times = dayTimes[d.key];
              return (
                <div
                  key={d.key}
                  className={`p-3.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    active
                      ? "border-[#E6E9F0] bg-white"
                      : "border-gray-100 bg-[#F8FAFC]/50 opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      id={`day-${d.key}`}
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleDay(d.key)}
                      className="h-4 w-4 rounded border-[#D5D9E2] text-[#6D28D9] focus:ring-[#6D28D9]"
                    />
                    <label htmlFor={`day-${d.key}`} className="text-sm font-semibold text-[#0F1523] cursor-pointer">
                      {d.label}
                    </label>
                  </div>

                  {active ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[#6B7488]">From</span>
                      <input
                        type="time"
                        value={times.start}
                        onChange={(e) => handleTimeChange(d.key, "start", e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-[#D5D9E2] bg-white text-xs font-mono text-[#0F1523] focus:outline-none focus:ring-1 focus:ring-[#6D28D9]"
                      />
                      <span className="text-[#6B7488]">to</span>
                      <input
                        type="time"
                        value={times.end}
                        onChange={(e) => handleTimeChange(d.key, "end", e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-[#D5D9E2] bg-white text-xs font-mono text-[#0F1523] focus:outline-none focus:ring-1 focus:ring-[#6D28D9]"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-[#8C95A8] italic">Non-working Day (Off)</span>
                  )}
                </div>
              );
            })}
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
                Saving Changes...
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
