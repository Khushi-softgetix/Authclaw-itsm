"use client";

import React from "react";
import { itsmStatusConfig } from "@/lib/itsm-format";

interface IncidentStatusBadgeProps {
  status: string;
  className?: string;
}

export default function IncidentStatusBadge({ status, className = "" }: IncidentStatusBadgeProps) {
  const config = itsmStatusConfig(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.badge} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
