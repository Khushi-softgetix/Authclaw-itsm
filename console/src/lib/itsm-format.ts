export function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    const str = String(iso);
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(str) ? str : `${str}Z`;
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return str;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  } catch {
    return String(iso || "—");
  }
}

export function itsmPriorityConfig(priority: string) {
  const norm = priority?.toUpperCase() || "P3";
  switch (norm) {
    case "P1":
    case "P1_CRITICAL":
      return {
        label: "P1 · Critical",
        badge: "bg-red-500/15 text-red-600 border-red-500/30",
        dot: "bg-red-500",
        pill: "border border-red-500/30 bg-red-50 text-red-700",
      };
    case "P2":
    case "P2_HIGH":
      return {
        label: "P2 · High",
        badge: "bg-orange-500/15 text-orange-600 border-orange-500/30",
        dot: "bg-orange-500",
        pill: "border border-orange-500/30 bg-orange-50 text-orange-700",
      };
    case "P3":
    case "P3_MEDIUM":
      return {
        label: "P3 · Medium",
        badge: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30",
        dot: "bg-yellow-500",
        pill: "border border-yellow-500/30 bg-yellow-50 text-yellow-700",
      };
    case "P4":
    case "P4_LOW":
      return {
        label: "P4 · Low",
        badge: "bg-blue-500/15 text-blue-600 border-blue-500/30",
        dot: "bg-blue-500",
        pill: "border border-blue-500/30 bg-blue-50 text-blue-700",
      };
    default:
      return {
        label: priority || "P3",
        badge: "bg-slate-500/15 text-slate-600 border-slate-500/30",
        dot: "bg-slate-400",
        pill: "border border-slate-500/30 bg-slate-50 text-slate-700",
      };
  }
}

export function itsmStatusConfig(status: string) {
  const norm = status?.toUpperCase() || "NEW";
  switch (norm) {
    case "NEW":
      return {
        label: "New",
        badge: "bg-blue-500/15 text-blue-600 border-blue-500/30",
        dot: "bg-blue-500",
      };
    case "ASSIGNED":
      return {
        label: "Assigned",
        badge: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
        dot: "bg-indigo-500",
      };
    case "IN_PROGRESS":
      return {
        label: "In Progress",
        badge: "bg-amber-500/15 text-amber-700 border-amber-500/30",
        dot: "bg-amber-500",
      };
    case "PENDING":
      return {
        label: "Pending",
        badge: "bg-yellow-500/15 text-yellow-800 border-yellow-500/30",
        dot: "bg-yellow-500",
      };
    case "RESOLVED":
      return {
        label: "Resolved",
        badge: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
        dot: "bg-emerald-500",
      };
    case "CLOSED":
      return {
        label: "Closed",
        badge: "bg-slate-500/15 text-slate-700 border-slate-500/30",
        dot: "bg-slate-400",
      };
    case "CANCELLED":
      return {
        label: "Cancelled",
        badge: "bg-red-500/15 text-red-600 border-red-500/30",
        dot: "bg-red-500",
      };
    default:
      return {
        label: status || "Unknown",
        badge: "bg-slate-500/15 text-slate-600 border-slate-500/30",
        dot: "bg-slate-400",
      };
  }
}

export function itsmImpactConfig(level: string) {
  const norm = level?.toUpperCase() || "MEDIUM";
  switch (norm) {
    case "CRITICAL":
      return "text-red-600 font-semibold";
    case "HIGH":
      return "text-orange-600 font-medium";
    case "MEDIUM":
      return "text-yellow-700 font-medium";
    case "LOW":
      return "text-blue-600";
    default:
      return "text-[#475069]";
  }
}

export const APPROVED_TRANSITIONS: Record<string, string[]> = {
  NEW: ["ASSIGNED", "IN_PROGRESS", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["PENDING", "RESOLVED", "CANCELLED"],
  PENDING: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
  CANCELLED: [],
};

export function itsmAllowedTransitions(currentStatus: string): string[] {
  const norm = currentStatus?.toUpperCase() || "NEW";
  return APPROVED_TRANSITIONS[norm] || [];
}
