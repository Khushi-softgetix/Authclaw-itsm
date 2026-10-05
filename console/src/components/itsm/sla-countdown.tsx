"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, PauseCircle } from "lucide-react";
import {
  calculateSlaStatus,
  formatSlaDurationDetailed,
  SlaCalculationResult,
  SlaTicketLike,
} from "@/lib/itsm-sla";
import { formatDateTime } from "@/lib/itsm-format";

/**
 * Custom React hook for live SLA countdown updates without drift.
 * Runs on a 1-second interval by default.
 */
export function useSlaCountdown(
  ticket?: SlaTicketLike | null,
  intervalMs: number = 1000
): SlaCalculationResult {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    // If ticket has no SLA or is closed/resolved, no need for active countdown timer
    if (!ticket?.sla_due_at && !ticket?.sla_resolution_due_at && !ticket?.sla_response_due_at) {
      return;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    return () => clearInterval(timer);
  }, [ticket?.sla_due_at, ticket?.sla_resolution_due_at, ticket?.sla_response_due_at, intervalMs]);

  return calculateSlaStatus(ticket, now);
}

/**
 * Compact SLA Countdown Badge for Work Queue table rows.
 * Examples:
 * - 🟢 2h 14m
 * - 🟠 18m
 * - 🔴 12m overdue
 * - ⏸️ Paused (45m)
 * - No SLA
 */
export function SlaCountdownBadge({
  ticket,
  showLabel = false,
}: {
  ticket?: SlaTicketLike | null;
  showLabel?: boolean;
}) {
  const sla = useSlaCountdown(ticket, 1000);

  if (!sla.hasSla) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
        No SLA
      </span>
    );
  }

  const tooltip = sla.isBreached
    ? `SLA Breached · Due: ${formatDateTime(sla.dueAt?.toISOString())}`
    : sla.isPaused
    ? `SLA Paused · Remaining: ${sla.formattedRemaining}`
    : `${sla.stateLabel} · Due: ${formatDateTime(sla.dueAt?.toISOString())}`;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors duration-300 ${sla.colorTheme.badge}`}
      title={tooltip}
    >
      {sla.state === "GREEN" && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      )}
      {sla.state === "AMBER" && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
      )}
      {sla.state === "RED" && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      )}
      {sla.state === "PAUSED" && (
        <PauseCircle className="w-3 h-3 text-slate-500" />
      )}

      <span>{showLabel ? sla.formattedRemaining : sla.formattedShort}</span>
    </span>
  );
}

/**
 * Prominent SLA Countdown Panel for Incident & Service Request Detail Pages.
 * Displays:
 * - SLA Risk State (🟢 On Track / 🟠 Warning / 🔴 Breached / ⏸️ Paused)
 * - Large remaining or overdue countdown
 * - Authoritative due timestamp
 * - Visual progress bar of elapsed SLA time
 */
export function SlaCountdownPanel({
  ticket,
}: {
  ticket?: SlaTicketLike | null;
}) {
  const sla = useSlaCountdown(ticket, 1000);

  if (!sla.hasSla) {
    return (
      <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-3" id="incident-sla-card">
        <h2 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
          SLA Status
        </h2>
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-1">
          <p className="text-xs font-semibold text-slate-700">No SLA Target</p>
          <p className="text-[11px] text-[#6B7488]">
            No applicable SLA policy or deadline configured for this ticket.
          </p>
        </div>
      </div>
    );
  }

  // Pick state icon and headline text
  let statusIcon = <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  let headlineTitle = "SLA on track";
  if (sla.state === "AMBER") {
    statusIcon = <AlertTriangle className="w-4 h-4 text-amber-600" />;
    headlineTitle = "Warning: SLA breach approaching";
  } else if (sla.state === "RED") {
    statusIcon = <AlertCircle className="w-4 h-4 text-red-600" />;
    headlineTitle = "SLA Breached";
  } else if (sla.state === "PAUSED") {
    statusIcon = <PauseCircle className="w-4 h-4 text-slate-600" />;
    headlineTitle = "SLA Paused";
  }

  // Precise formatted countdown
  const countdownText = sla.isBreached
    ? `${formatSlaDurationDetailed(sla.overdueSeconds)} overdue`
    : `${formatSlaDurationDetailed(sla.remainingSeconds)} remaining`;

  return (
    <div
      className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-4"
      id="incident-sla-card"
    >
      <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
        <h2 className="text-sm font-bold text-[#0E1726]">SLA Status</h2>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border transition-colors duration-300 ${sla.colorTheme.badge}`}
        >
          {statusIcon}
          <span>{headlineTitle}</span>
        </span>
      </div>

      {/* Prominent Live Countdown Box */}
      <div
        className={`rounded-xl p-4 border transition-all duration-300 ${
          sla.state === "RED"
            ? "bg-red-50/70 border-red-200 text-red-900"
            : sla.state === "AMBER"
            ? "bg-amber-50/70 border-amber-200 text-amber-900"
            : sla.state === "PAUSED"
            ? "bg-slate-50 border-slate-200 text-slate-800"
            : "bg-emerald-50/60 border-emerald-200 text-emerald-900"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider opacity-80 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {sla.isBreached ? "Overdue Time" : sla.isPaused ? "Time Frozen" : "Time Remaining"}
          </span>
          <span className="text-[11px] font-mono font-medium opacity-75">
            {sla.elapsedPercentage}% elapsed
          </span>
        </div>

        {/* Large Countdown Display */}
        <div className="text-2xl font-black tracking-tight mt-1 font-mono">
          {countdownText}
        </div>

        {/* Dynamic Progress Bar */}
        <div className="w-full bg-black/10 rounded-full h-1.5 mt-3 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${sla.colorTheme.progressBar}`}
            style={{ width: `${sla.elapsedPercentage}%` }}
          />
        </div>
      </div>

      {/* Timestamp Details */}
      <div className="space-y-2.5 text-xs">
        <div className="flex items-center justify-between py-1 border-b border-slate-100">
          <span className="text-[#6B7488]">SLA Due:</span>
          <span className="font-semibold text-[#0E1726]">
            {formatDateTime(sla.dueAt?.toISOString())}
          </span>
        </div>

        {sla.startedAt && (
          <div className="flex items-center justify-between py-1 border-b border-slate-100">
            <span className="text-[#6B7488]">Started:</span>
            <span className="font-medium text-[#475069]">
              {formatDateTime(sla.startedAt?.toISOString())}
            </span>
          </div>
        )}

        {sla.isPaused && (
          <div className="flex items-center justify-between py-1 text-slate-600 bg-slate-100/70 px-2 rounded-lg">
            <span>SLA Timer Paused</span>
            <span className="font-medium">Awaiting action</span>
          </div>
        )}
      </div>
    </div>
  );
}
