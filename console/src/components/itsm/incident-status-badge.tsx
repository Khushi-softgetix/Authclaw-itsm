"use client";

import React from "react";
import { itsmStatusConfig } from "@/lib/itsm-format";

interface IncidentStatusBadgeProps {
  status: string;
  className?: string;
  tone?: "semantic" | "brand";
}

export default function IncidentStatusBadge({ status, className = "", tone = "semantic" }: IncidentStatusBadgeProps) {
  const config = itsmStatusConfig(status);
  const badgeClass = tone === "brand" ? "border-[#DDD6FE] bg-[#FAF8FF] text-[#5B21B6]" : config.badge;
  const dotClass = tone === "brand" ? "bg-[#7C3AED]" : config.dot;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badgeClass} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {config.label}
    </span>
  );
}
