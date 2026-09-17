"use client";

import React from "react";
import { itsmPriorityConfig } from "@/lib/itsm-format";

interface IncidentPriorityBadgeProps {
  priority: string;
  className?: string;
  showLabel?: boolean;
  tone?: "semantic" | "brand";
}

export default function IncidentPriorityBadge({
  priority,
  className = "",
  showLabel = true,
  tone = "semantic",
}: IncidentPriorityBadgeProps) {
  const config = itsmPriorityConfig(priority);
  const badgeClass = tone === "brand" ? "border-[#DDD6FE] bg-[#F1ECFE] text-[#5B21B6]" : config.badge;
  const dotClass = tone === "brand" ? "bg-[#6D28D9]" : config.dot;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badgeClass} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {showLabel ? config.label : priority}
    </span>
  );
}
