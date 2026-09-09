"use client";

import React from "react";
import Link from "next/link";
import { GitPullRequest, ArrowRight, Sparkles, Ticket } from "lucide-react";

export default function ChangesPage() {
  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-8 shadow-sm text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#FFFBEB] text-[#D97706] flex items-center justify-center mx-auto shadow-sm">
          <GitPullRequest className="w-6 h-6" />
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFFBEB] text-[#D97706] text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Roadmap · Upcoming Phase</span>
        </div>
        <h1 className="text-2xl font-bold text-[#0E1726]">Change &amp; Problem Management</h1>
        <p className="text-xs sm:text-sm text-[#6B7488] max-w-lg mx-auto leading-relaxed">
          Change Advisory Board (CAB) workflows, deployment collision detection, risk scoring, and Problem record investigations for recurring incident root causes.
        </p>
        <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/itsm/incidents"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-sm"
          >
            <Ticket className="w-4 h-4" />
            <span>Manage Incidents (Available Now)</span>
          </Link>
          <Link
            href="/itsm/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E6E9F0] text-[#0E1726] text-xs font-semibold hover:bg-[#F9FAFB] transition"
          >
            <span>Back to Dashboard</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
