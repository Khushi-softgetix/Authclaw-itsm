"use client";

import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  GitPullRequest,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export default function ProblemChangeManagerPage() {
  return (
    <div className="space-y-8 max-w-6xl mx-auto" id="pcm-portal-container">
      {/* Top Header Banner matching Knowledge banner style */}
      <div
        className="bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] rounded-2xl p-6 sm:p-8 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6"
        id="pcm-portal-header"
      >
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-200" />
            <span>Problem &amp; Change Governance · Step 1 Foundation</span>
          </div>
          <h1
            className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white"
            id="pcm-portal-title"
          >
            Problem and Change Manager
          </h1>
          <p
            className="text-sm text-blue-100 max-w-xl"
            id="pcm-portal-subtitle"
          >
            Problem and Change Management Workspace
          </p>
        </div>

        <div className="shrink-0">
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/15 text-white text-xs font-semibold border border-white/20 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Role Active: Problem and Change Manager</span>
          </div>
        </div>
      </div>

      {/* Foundation Status Alert */}
      <div
        className="flex items-start gap-3 p-4 rounded-xl bg-[#F8FAFC] border border-[#E6E9F0] text-xs"
        id="pcm-status-banner"
      >
        <div className="w-6 h-6 rounded-lg bg-[#F1ECFE] text-[#6D28D9] flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <div className="space-y-0.5">
          <p className="font-semibold text-[#0E1726]">Portal Foundation Active</p>
          <p className="text-[#6B7488] leading-relaxed">
            Authentication, role authorization, tenant isolation, and navigation foundation are operational. Core functional modules for Problem Management and Change Management are scheduled for subsequent implementation steps.
          </p>
        </div>
      </div>

      {/* Planned Functional Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Problems Card */}
        <div
          className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col justify-between hover:border-[#DDD6FE] hover:shadow-[0_8px_24px_-8px_rgba(109,40,217,.12)] transition-all duration-200"
          id="pcm-problems-card"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-[#FFFBEB] border border-[#FEF3C7] text-[#D97706] flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                Step 2+ Planned
              </span>
            </div>

            <div>
              <h2 className="text-base font-semibold text-[#0E1726]">
                Problem Management
              </h2>
              <p className="text-xs text-[#475069] mt-1.5 leading-relaxed">
                Investigate recurring incident patterns, identify technical root causes, formulate workarounds, and maintain the Known Error Database (KEDB).
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-[#F5F7FA] mt-6">
            <Link
              href="/itsm/problem-change-manager/problems"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:underline"
              id="pcm-problems-link"
            >
              <span>View Problems Workspace</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Changes Card */}
        <div
          className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col justify-between hover:border-[#DDD6FE] hover:shadow-[0_8px_24px_-8px_rgba(109,40,217,.12)] transition-all duration-200"
          id="pcm-changes-card"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-[#F5F3FF] border border-[#EDE9FE] text-[#6D28D9] flex items-center justify-center">
                <GitPullRequest className="w-5 h-5" />
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                Active
              </span>
            </div>

            <div>
              <h2 className="text-base font-semibold text-[#0E1726]">
                Change Management
              </h2>
              <p className="text-xs text-[#475069] mt-1.5 leading-relaxed">
                Assess production change risk, evaluate scheduling collisions, enforce standard/emergency approval workflows, and coordinate CAB reviews.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-[#F5F7FA] mt-6">
            <Link
              href="/itsm/problem-change-manager/changes"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:underline"
              id="pcm-changes-link"
            >
              <span>Open Changes Queue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Knowledge Base Card */}
        <div
          className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col justify-between hover:border-[#DDD6FE] hover:shadow-[0_8px_24px_-8px_rgba(109,40,217,.12)] transition-all duration-200"
          id="pcm-knowledge-card"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] border border-[#D1FAE5] text-[#059669] flex items-center justify-center">
                <BookOpen className="w-5 h-5" />
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                Active
              </span>
            </div>

            <div>
              <h2 className="text-base font-semibold text-[#0E1726]">
                Knowledge Base
              </h2>
              <p className="text-xs text-[#475069] mt-1.5 leading-relaxed">
                Access published standard operating procedures, architectural standards, and operational workarounds across all IT service domains.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-[#F5F7FA] mt-6">
            <Link
              href="/itsm/knowledge"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:underline"
              id="pcm-knowledge-link"
            >
              <span>Browse Knowledge Base</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Role Specifications Summary */}
      <div
        className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] space-y-4"
        id="pcm-foundation-overview"
      >
        <div className="border-b border-[#E6E9F0] pb-3">
          <h2 className="text-sm font-bold text-[#0E1726]">
            Role Architecture &amp; Governance
          </h2>
          <p className="text-[11px] text-[#6B7488]">
            Security, access boundaries, and operational scope
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E6E9F0] space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
              User-Facing Title
            </span>
            <p className="text-xs font-semibold text-[#0E1726]">
              Problem and Change Manager
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E6E9F0] space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
              Internal Identifier
            </span>
            <p className="text-xs font-mono font-semibold text-[#475069]">
              PROCESS_CHANGE_MANAGER
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E6E9F0] space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
              Access Model
            </span>
            <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>public.itsm_user_access</span>
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E6E9F0] space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
              Tenant Context
            </span>
            <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              <span>RLS &amp; Session Bound</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
