import React from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Incident Manager | AuthClaw ITSM",
  description: "Incident Manager workspace in AuthClaw ITSM.",
};

export default function IncidentManagerPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-[#0E1726] tracking-tight">
          Incident Manager
        </h1>
        <p className="text-sm text-[#6B7488] mt-1">
          Welcome to the Incident Manager workspace.
        </p>
      </div>

      <div className="rounded-[20px] border border-[#E6E9F0] bg-white p-8 shadow-[0_1px_2px_rgba(11,31,63,.05)]">
        <div className="max-w-md space-y-2">
          <h2 className="text-sm font-semibold text-[#0E1726]">
            Workspace Initialized
          </h2>
          <p className="text-xs text-[#6B7488] leading-relaxed">
            This dedicated workspace is established for Incident Manager operations.
            Operational tools and queues will be configured here in upcoming phases.
          </p>
        </div>
      </div>
    </div>
  );
}
