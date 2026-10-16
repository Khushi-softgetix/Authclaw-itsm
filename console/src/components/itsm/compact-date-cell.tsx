"use client";

import React from "react";
import { formatDateTime } from "@/lib/itsm-format";

interface CompactDateCellProps {
  createdAt?: string | null;
  updatedAt?: string | null;
  className?: string;
}

function formatShortDateTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    const str = String(iso);
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(str) ? str : `${str}Z`;
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return str;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return String(iso || "—");
  }
}

export function CompactDateCell({
  createdAt,
  updatedAt,
  className = "",
}: CompactDateCellProps) {
  const fullCreated = createdAt ? formatDateTime(createdAt) : "";
  const fullUpdated = updatedAt ? formatDateTime(updatedAt) : fullCreated;

  const createdStr = formatShortDateTime(createdAt);
  const updatedStr = updatedAt ? formatShortDateTime(updatedAt) : createdAt ? formatShortDateTime(createdAt) : "—";

  return (
    <div className={`flex flex-col gap-1 text-[11px] leading-tight select-text ${className}`}>
      <div
        className="flex items-center gap-1.5 text-[#334155]"
        title={fullCreated ? `Created: ${fullCreated}` : undefined}
      >
        <span className="text-[9.5px] font-bold text-[#64748B] uppercase tracking-wider w-[48px] shrink-0">
          Created
        </span>
        <span className="text-[#94A3B8] text-[10px] select-none shrink-0">—</span>
        <span className="font-mono text-[#0E1726] whitespace-nowrap text-[10.5px]">
          {createdStr}
        </span>
      </div>
      <div
        className="flex items-center gap-1.5 text-[#475569]"
        title={fullUpdated ? `Updated: ${fullUpdated}` : undefined}
      >
        <span className="text-[9.5px] font-bold text-[#64748B] uppercase tracking-wider w-[48px] shrink-0">
          Updated
        </span>
        <span className="text-[#94A3B8] text-[10px] select-none shrink-0">—</span>
        <span className="font-mono text-[#334155] whitespace-nowrap text-[10.5px]">
          {updatedStr}
        </span>
      </div>
    </div>
  );
}

export default CompactDateCell;
