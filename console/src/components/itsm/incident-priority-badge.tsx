"use client";

import React from "react";
import { itsmPriorityConfig } from "@/lib/itsm-format";

interface IncidentPriorityBadgeProps {
  priority: string;
  className?: string;
  showLabel?: boolean;
}

export default function IncidentPriorityBadge({
  priority,
  className = "",
  showLabel = true,
}: IncidentPriorityBadgeProps) {
  const config = itsmPriorityConfig(priority);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.badge} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {showLabel ? config.label : priority}
    </span>
  );
}
