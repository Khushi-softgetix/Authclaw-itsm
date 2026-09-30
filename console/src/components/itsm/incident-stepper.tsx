"use client";

import React from "react";
import { Check, XCircle } from "lucide-react";

interface IncidentStepperProps {
  currentStatus: string;
}

const ORDERED_STEPS = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

const STEP_LABELS: Record<string, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export default function IncidentStepper({ currentStatus }: IncidentStepperProps) {
  const norm = currentStatus?.toUpperCase().trim() || "NEW";
  const isCancelled = norm === "CANCELLED";
  const isPending = norm === "PENDING";
  const isClosed = norm === "CLOSED";

  const getStepIndex = (st: string) => {
    switch (st) {
      case "NEW":
        return 0;
      case "ASSIGNED":
        return 1;
      case "IN_PROGRESS":
      case "PENDING":
        return 2;
      case "RESOLVED":
        return 3;
      case "CLOSED":
        return 4;
      default:
        return 0;
    }
  };

  const currentIndex = getStepIndex(norm);

  return (
    <div className="w-full bg-white rounded-[16px] border border-[#E6E9F0] p-4 shadow-sm">
      <div className="flex items-center justify-between overflow-x-auto gap-2">
        {isCancelled ? (
          <div className="flex items-center gap-2 text-red-600 font-semibold text-sm px-2">
            <XCircle className="w-5 h-5" />
            <span>Incident Cancelled</span>
          </div>
        ) : (
          ORDERED_STEPS.map((step, idx) => {
            const isCompleted = isClosed ? idx <= currentIndex : idx < currentIndex;
            const isCurrent = idx === currentIndex;
            const label = isCurrent && isPending ? "Pending" : STEP_LABELS[step];

            return (
              <React.Fragment key={step}>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      isCompleted
                        ? "bg-emerald-600 text-white"
                        : isCurrent
                        ? isPending
                          ? "bg-yellow-500 text-white ring-4 ring-yellow-100"
                          : "bg-[#6D28D9] text-white ring-4 ring-purple-100"
                        : "bg-[#F5F7FA] text-[#6B7488] border border-[#E6E9F0]"
                    }`}
                  >
                    {isCompleted ? <Check className="w-4 h-4" /> : idx + 1}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      isCurrent
                        ? "text-[#0E1726] font-semibold"
                        : isCompleted
                        ? "text-[#475069]"
                        : "text-[#6B7488]"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {idx < ORDERED_STEPS.length - 1 && (
                  <div
                    className={`flex-1 min-w-[20px] h-0.5 rounded transition-colors ${
                      idx < currentIndex ? "bg-emerald-500" : "bg-[#E6E9F0]"
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
