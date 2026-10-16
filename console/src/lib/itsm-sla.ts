/**
 * Authoritative SLA calculation and real-time formatting for ITSM.
 *
 * Implements the 3 SLA risk states based on the 75% elapsed rule:
 * - GREEN (< 75% elapsed): "01h 24m remaining", "SLA on track"
 * - AMBER (>= 75% elapsed, not breached): "20m remaining", "Warning: SLA breach approaching"
 * - RED (deadline passed): "Breached: 12m overdue", "SLA breached"
 * - PAUSED: Timer frozen at pause point
 * - NO_SLA: Neutral state
 */

export type SlaRiskState = "GREEN" | "AMBER" | "RED" | "PAUSED" | "NO_SLA";

export interface SlaTicketLike {
  status?: string | null;
  sla_status?: string | null;
  sla_due_at?: string | null;
  sla_resolution_due_at?: string | null;
  sla_response_due_at?: string | null;
  sla_response_met_at?: string | null;
  sla_resolution_met_at?: string | null;
  sla_paused_at?: string | null;
  sla_accumulated_pause_seconds?: number;
  sla_warning_escalated_at?: string | null;
  sla_breach_escalated_at?: string | null;
  sla_started_at?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
}

export interface SlaCalculationResult {
  state: SlaRiskState;
  hasSla: boolean;
  isPaused: boolean;
  isBreached: boolean;
  isCompleted: boolean;
  isResolved: boolean;
  isClosed: boolean;
  completedAt: Date | null;
  resolvedDurationSeconds: number; // elapsed seconds until resolution/closure
  formattedResolvedDuration: string; // e.g. "15m 30s"
  dueAt: Date | null;
  startedAt: Date | null;
  remainingSeconds: number; // 0 if breached
  overdueSeconds: number; // 0 if not breached
  elapsedFraction: number; // 0.0 to 1.0+
  elapsedPercentage: number; // 0 to 100%
  formattedRemaining: string; // e.g. "01h 24m remaining" or "20m remaining"
  formattedShort: string; // e.g. "01h 24m", "20m", "12m overdue"
  formattedOverdue: string; // e.g. "Breached: 12m overdue"
  stateLabel: string; // "SLA on track", "Warning: SLA breach approaching", "SLA breached", "SLA Met"
  colorTheme: {
    badge: string;
    dot: string;
    border: string;
    text: string;
    progressBar: string;
    iconColor: string;
  };
}

/**
 * Format total seconds into ITSM human-readable format:
 * - >= 24h: "Xh Ym"
 * - >= 1h: "01h 24m"
 * - < 1h: "20m" (or "00m" when 0)
 * Never produces negative outputs.
 */
export function formatSlaDuration(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);

  if (hours > 0) {
    const hStr = hours < 10 ? `0${hours}` : `${hours}`;
    const mStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
    return `${hStr}h ${mStr}m`;
  }
  return `${minutes}m`;
}

/**
 * Format duration with seconds when precision is desired (e.g. detailed view < 1h)
 */
export function formatSlaDurationDetailed(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const remSecs = secs % 60;

  if (hours > 0) {
    const hStr = hours < 10 ? `0${hours}` : `${hours}`;
    const mStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
    if (remSecs > 0) {
      const sStr = remSecs < 10 ? `0${remSecs}` : `${remSecs}`;
      return `${hStr}h ${mStr}m ${sStr}s`;
    }
    return `${hStr}h ${mStr}m`;
  }
  if (minutes > 0) {
    const mStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
    if (remSecs > 0) {
      const sStr = remSecs < 10 ? `0${remSecs}` : `${remSecs}`;
      return `${mStr}m ${sStr}s`;
    }
    return `${mStr}m`;
  }
  return `${remSecs}s`;
}

/**
 * Parse an ISO timestamp or date safely to UTC milliseconds
 */
function parseTimestampMs(iso?: string | null): number | null {
  if (!iso) return null;
  try {
    const str = String(iso);
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(str) ? str : `${str}Z`;
    const d = new Date(normalized);
    const time = d.getTime();
    return isNaN(time) ? null : time;
  } catch {
    return null;
  }
}

/**
 * Calculate the authoritative SLA risk state and countdown for a ticket at instant `nowMs`.
 * This pure calculation function does NOT drift and can be safely called on any timer tick.
 */
export function calculateSlaStatus(
  ticket?: SlaTicketLike | null,
  nowMs: number = Date.now()
): SlaCalculationResult {
  if (!ticket) {
    return createEmptyResult();
  }

  // Check if ticket is resolved or closed
  const resolvedMs = parseTimestampMs(ticket.resolved_at || ticket.sla_resolution_met_at);
  const closedMs = parseTimestampMs(ticket.closed_at);
  const statusUpper = ticket.status ? String(ticket.status).toUpperCase().trim() : "";
  const isResolved = Boolean(resolvedMs || statusUpper === "RESOLVED");
  const isClosed = Boolean(closedMs || statusUpper === "CLOSED");
  const isCompleted = isResolved || isClosed;
  const completedAt = isCompleted ? (resolvedMs ? new Date(resolvedMs) : closedMs ? new Date(closedMs) : null) : null;

  // Determine active due date:
  // If completed, resolution SLA deadline is authoritative
  // If response SLA is defined and not yet met, response SLA is active
  const responseDueMs = parseTimestampMs(ticket.sla_response_due_at);
  const responseMetMs = parseTimestampMs(ticket.sla_response_met_at);
  const resolutionDueMs = parseTimestampMs(ticket.sla_resolution_due_at);
  const explicitDueMs = parseTimestampMs(ticket.sla_due_at);

  const responseActive = Boolean(responseDueMs && !responseMetMs && !isCompleted);
  const activeDueMs = explicitDueMs || (responseActive ? responseDueMs : resolutionDueMs || responseDueMs);

  if (!activeDueMs) {
    return createEmptyResult();
  }

  const dueAt = new Date(activeDueMs);
  const startedMs = parseTimestampMs(ticket.sla_started_at || ticket.created_at) || activeDueMs - 4 * 3600 * 1000;
  const startedAt = new Date(startedMs);

  // Check if ticket SLA is currently paused (a completed ticket is not actively paused)
  const pausedMs = parseTimestampMs(ticket.sla_paused_at);
  const isPaused = Boolean(
    !isCompleted && (ticket.sla_status === "PAUSED" || (pausedMs !== null && !ticket.sla_resolution_met_at))
  );

  // When completed, time stops at resolution or closure timestamp
  // When paused, effective time stops advancing at the pause timestamp
  let effectiveNowMs: number;
  if (isCompleted) {
    effectiveNowMs = (resolvedMs || closedMs) ?? nowMs;
  } else if (isPaused && pausedMs) {
    effectiveNowMs = pausedMs;
  } else {
    effectiveNowMs = nowMs;
  }

  const totalTargetMs = Math.max(activeDueMs - startedMs, 1000);
  const diffMs = activeDueMs - effectiveNowMs;
  const elapsedMs = Math.max(0, effectiveNowMs - startedMs);
  const resolvedDurationSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const formattedResolvedDuration = formatSlaDurationDetailed(resolvedDurationSeconds);

  const hasBreachEscalation = Boolean(parseTimestampMs(ticket.sla_breach_escalated_at));

  let state: SlaRiskState;
  let remainingSeconds = 0;
  let overdueSeconds = 0;
  let elapsedFraction = 0;
  let isBreached = false;

  if (diffMs < 0 || hasBreachEscalation || ticket.sla_status === "BREACHED") {
    // RED: Deadline has passed
    isBreached = true;
    state = "RED";
    overdueSeconds = Math.max(1, Math.floor(Math.abs(diffMs) / 1000));
    remainingSeconds = 0;
    elapsedFraction = 1.0 + Math.abs(diffMs) / totalTargetMs;
  } else {
    remainingSeconds = Math.floor(diffMs / 1000);
    overdueSeconds = 0;
    elapsedFraction = Math.min(1.0, elapsedMs / totalTargetMs);

    if (isCompleted) {
      state = "GREEN";
    } else if (isPaused) {
      state = "PAUSED";
    } else if (elapsedFraction >= 0.75) {
      // AMBER: 75% or more elapsed, but not breached
      state = "AMBER";
    } else {
      // GREEN: Less than 75% elapsed
      state = "GREEN";
    }
  }

  const elapsedPercentage = Math.min(100, Math.max(0, Math.round(elapsedFraction * 100)));

  // Format strings
  const formattedDur = formatSlaDuration(isBreached ? overdueSeconds : remainingSeconds);
  const formattedDetailedDur = formatSlaDurationDetailed(isBreached ? overdueSeconds : remainingSeconds);

  let formattedRemaining: string;
  let formattedShort: string;
  let formattedOverdue: string;
  let stateLabel: string;

  if (isCompleted) {
    if (isBreached) {
      stateLabel = "SLA Breached";
      formattedRemaining = `Breached: ${formattedDetailedDur} overdue at resolution`;
      formattedShort = `${formattedDetailedDur} overdue`;
      formattedOverdue = `Breached: ${formattedDetailedDur} overdue`;
    } else {
      stateLabel = "SLA Met";
      formattedRemaining = `${formattedDetailedDur} remaining at resolution`;
      formattedShort = `Resolved in ${formattedResolvedDuration}`;
      formattedOverdue = "SLA Met";
    }
  } else {
    formattedRemaining = isBreached
      ? `Breached: ${formattedDur} overdue`
      : `${formattedDur} remaining`;
    formattedShort = isBreached
      ? `${formattedDur} overdue`
      : isPaused
      ? `Paused (${formattedDur})`
      : formattedDur;
    formattedOverdue = `Breached: ${formattedDur} overdue`;

    stateLabel = "SLA on track";
    if (state === "AMBER") {
      stateLabel = "Warning: SLA breach approaching";
    } else if (state === "RED") {
      stateLabel = "SLA breached";
    } else if (state === "PAUSED") {
      stateLabel = "SLA paused";
    }
  }

  const colorTheme = getColorTheme(state);

  return {
    state,
    hasSla: true,
    isPaused,
    isBreached,
    isCompleted,
    isResolved,
    isClosed,
    completedAt,
    resolvedDurationSeconds,
    formattedResolvedDuration,
    dueAt,
    startedAt,
    remainingSeconds,
    overdueSeconds,
    elapsedFraction,
    elapsedPercentage,
    formattedRemaining,
    formattedShort,
    formattedOverdue,
    stateLabel,
    colorTheme,
  };
}

function createEmptyResult(): SlaCalculationResult {
  return {
    state: "NO_SLA",
    hasSla: false,
    isPaused: false,
    isBreached: false,
    isCompleted: false,
    isResolved: false,
    isClosed: false,
    completedAt: null,
    resolvedDurationSeconds: 0,
    formattedResolvedDuration: "0s",
    dueAt: null,
    startedAt: null,
    remainingSeconds: 0,
    overdueSeconds: 0,
    elapsedFraction: 0,
    elapsedPercentage: 0,
    formattedRemaining: "No SLA",
    formattedShort: "No SLA",
    formattedOverdue: "No SLA",
    stateLabel: "No SLA",
    colorTheme: getColorTheme("NO_SLA"),
  };
}

function getColorTheme(state: SlaRiskState) {
  switch (state) {
    case "GREEN":
      return {
        badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
        dot: "bg-emerald-500",
        border: "border-emerald-200",
        text: "text-emerald-700",
        progressBar: "bg-emerald-500",
        iconColor: "text-emerald-600",
      };
    case "AMBER":
      return {
        badge: "bg-amber-50 text-amber-800 border-amber-300",
        dot: "bg-amber-500",
        border: "border-amber-300",
        text: "text-amber-800",
        progressBar: "bg-amber-500",
        iconColor: "text-amber-600",
      };
    case "RED":
      return {
        badge: "bg-red-50 text-red-700 border-red-200",
        dot: "bg-red-500",
        border: "border-red-200",
        text: "text-red-700",
        progressBar: "bg-red-500",
        iconColor: "text-red-600",
      };
    case "PAUSED":
      return {
        badge: "bg-slate-100 text-slate-700 border-slate-300",
        dot: "bg-slate-400",
        border: "border-slate-300",
        text: "text-slate-700",
        progressBar: "bg-slate-400",
        iconColor: "text-slate-500",
      };
    case "NO_SLA":
    default:
      return {
        badge: "bg-slate-50 text-slate-500 border-slate-200",
        dot: "bg-slate-400",
        border: "border-slate-200",
        text: "text-slate-500",
        progressBar: "bg-slate-300",
        iconColor: "text-slate-400",
      };
  }
}
