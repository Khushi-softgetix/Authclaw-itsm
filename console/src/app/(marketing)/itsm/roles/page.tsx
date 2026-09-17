import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  User,
  Headphones,
  ShieldAlert,
  GitPullRequest,
  Sliders,
  FileCheck,
  ArrowRight,
  CheckCircle2,
  Lock,
  Sparkles,
  Layers,
} from "lucide-react";
import { createMarketingMetadata } from "@/marketing/seo";

export const metadata: Metadata = createMarketingMetadata({
  title: "ITSM Roles & Responsibilities — AuthClaw ITSM",
  description:
    "Explore the 6 purpose-built roles in AuthClaw ITSM: Requester, Service Agent, Incident Manager, Process & Change Manager, Platform Administrator, and Auditor.",
  path: "/itsm/roles",
});

interface RoleDefinition {
  id: string;
  roleKey: string;
  name: string;
  badge: string;
  tagline: string;
  description: string;
  dashboardPath: string;
  icon: any;
  color: string;
  bgColor: string;
  borderColor: string;
  responsibilities: string[];
  capabilities: string[];
  targetAudience: string;
}

const ROLES: RoleDefinition[] = [
  {
    id: "requester",
    roleKey: "REQUESTER",
    name: "Requester",
    badge: "Self-Service Portal",
    tagline: "Simplified intake, real-time ticket tracking, and verified resolutions.",
    description:
      "Employees, developers, and business stakeholders who need to report technical issues, request hardware/software access, or consult knowledge articles.",
    dashboardPath: "/itsm/dashboard/requester",
    icon: User,
    color: "#2563EB",
    bgColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    responsibilities: [
      "Submit new incidents and service requests with guided forms",
      "Monitor status, activity timeline, and agent notes in real time",
      "Confirm resolution or reopen tickets if issues persist",
      "Search curated self-service knowledge base articles",
      "Provide customer satisfaction (CSAT) ratings upon resolution",
    ],
    capabilities: [
      "Guided category selector",
      "Real-time ticket status updates",
      "Interactive comment stream",
      "Resolution sign-off",
    ],
    targetAudience: "All enterprise employees, business analysts, internal engineering consumers",
  },
  {
    id: "service-agent",
    roleKey: "SERVICE_AGENT",
    name: "Service Agent",
    badge: "Tier 1 & Tier 2 Operations",
    tagline: "Rapid incident triage, AI-augmented runbooks, and resolution tracking.",
    description:
      "Technical support engineers and front-line service specialists dedicated to investigating, debugging, and resolving assigned tickets within SLA targets.",
    dashboardPath: "/itsm/dashboard/service-agent",
    icon: Headphones,
    color: "#7C3AED",
    bgColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    responsibilities: [
      "Triage incoming tickets and assign appropriate severity (P1–P4)",
      "Diagnose incidents using telemetry and suggested AI runbooks",
      "Maintain active communication with requesters via public comments",
      "Log internal technical work notes and root cause observations",
      "Resolve tickets adhering to response and resolution SLAs",
    ],
    capabilities: [
      "My assigned ticket queue",
      "One-click state transitions (In Progress, On Hold, Resolved)",
      "Rich activity feed with internal vs public notes",
      "SLA countdown indicators",
    ],
    targetAudience: "IT Support Engineers, Tier 1/2 Service Desk Specialists, NOC Operators",
  },
  {
    id: "incident-manager",
    roleKey: "INCIDENT_MANAGER",
    name: "Incident Manager",
    badge: "Incident Command & Queue Lead",
    tagline: "Dedicated incident manager workspace, queue governance, and escalation control.",
    description:
      "Team leads, service delivery managers, and incident command commanders responsible for team throughput, queue balance, and high-impact crisis resolution.",
    dashboardPath: "/itsm/incident-manager",
    icon: ShieldAlert,
    color: "#DC2626",
    bgColor: "#FEF2F2",
    borderColor: "#FECACA",
    responsibilities: [
      "Unified oversight across standard incidents and P1/P2 Major Incidents",
      "Rebalance unassigned or backlogged queues across agent pools",
      "Monitor SLA breach projections and trigger immediate escalations",
      "Coordinate war rooms and stakeholder comms during major outages",
      "Approve post-incident review (PIR) summaries and corrective actions",
    ],
    capabilities: [
      "Queue health and distribution telemetry",
      "Major incident command dashboard with war room status",
      "Agent workload and MTTR performance tracking",
      "SLA breach warning alerts",
    ],
    targetAudience: "IT Service Managers, Support Team Leads, Incident Commanders, Operations Managers",
  },
  {
    id: "process-change",
    roleKey: "PROCESS_CHANGE_MANAGER",
    name: "Process & Change Manager",
    badge: "CAB & Stability Governance",
    tagline: "Change Advisory Board approvals, conflict detection, and problem prevention.",
    description:
      "Process owners, release coordinators, and CAB members who protect production availability by evaluating change risk, dependencies, and recurring problems.",
    dashboardPath: "/itsm/dashboard/process-change",
    icon: GitPullRequest,
    color: "#D97706",
    bgColor: "#FFFBEB",
    borderColor: "#FDE68A",
    responsibilities: [
      "Chair Change Advisory Board (CAB) reviews for Normal & Emergency changes",
      "Analyze change risk scores, collision windows, and rollback plans",
      "Group repeat incidents into formal Problem records for root cause analysis (RCA)",
      "Enforce compliance with ITIL release management standards",
      "Conduct post-implementation reviews to assess change success rate",
    ],
    capabilities: [
      "Pending change approval queue",
      "Change calendar and scheduling conflict detector",
      "Problem management tracking linked to incident clusters",
      "ITIL governance scorecard",
    ],
    targetAudience: "Change Managers, CAB Directors, Release Managers, Problem Management Leads",
  },
  {
    id: "platform-admin",
    roleKey: "PLATFORM_ADMINISTRATOR",
    name: "Platform Administrator",
    badge: "Platform & Systems Administration",
    tagline: "Global ITSM configuration, SLA rules, assignment groups, and AI settings.",
    description:
      "Enterprise systems administrators and platform engineers configuring organizational settings, data schemas, automated routing, and third-party integrations.",
    dashboardPath: "/itsm/dashboard/platform-admin",
    icon: Sliders,
    color: "#059669",
    bgColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    responsibilities: [
      "Define multi-tenant assignment groups and agent membership",
      "Configure business hours, holiday calendars, and SLA policy tiers",
      "Manage service catalog item definitions, categories, and custom fields",
      "Configure LangGraph AI copilot models, prompts, and guardrails",
      "Oversee tenant security settings, API tokens, and webhook endpoints",
    ],
    capabilities: [
      "Assignment group editor and user directory",
      "SLA policy and business calendar rules engine",
      "AI Copilot and tool execution permissions",
      "Tenant configuration and operational health monitors",
    ],
    targetAudience: "ITSM Platform Architects, Systems Administrators, DevOps Infrastructure Leads",
  },
  {
    id: "auditor",
    roleKey: "AUDITOR",
    name: "Auditor & Compliance",
    badge: "Independent Assurance & Read-Only",
    tagline: "Cryptographic audit trails, tamper evidence, and compliance exports.",
    description:
      "Internal audit teams, compliance officers, and external certifiers verifying operational integrity, change controls, and regulatory standards without mutation risk.",
    dashboardPath: "/itsm/dashboard/auditor",
    icon: FileCheck,
    color: "#0891B2",
    bgColor: "#ECFEFF",
    borderColor: "#A5F3FC",
    responsibilities: [
      "Inspect read-only operational histories across all incidents and changes",
      "Verify tamper-evident hash chaining in the append-only audit log",
      "Generate compliance packages for SOC 2, ISO/IEC 20000, and ITIL audits",
      "Audit authorization chains, approval timestamps, and override justifications",
      "Analyze historical SLA compliance and breach remediation metrics",
    ],
    capabilities: [
      "Immutable audit log viewer with cryptographic signature verification",
      "Compliance evidence exporter (JSON / CSV / PDF ready)",
      "Approval chain inspector and segregation-of-duties analyzer",
      "Zero-write security guarantees across all ITSM records",
    ],
    targetAudience: "Internal Audit, Compliance Officers, SOC 2 Auditors, Risk Management Officers",
  },
];

export default async function ItsmRolesPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  const isAuthenticated = Boolean(sessionToken?.startsWith("acl_session_"));

  return (
    <div className="bg-[#FAFBFD] min-h-screen py-16 px-6 sm:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Page Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F1ECFE] border border-[#E9D5FF] text-[#6D28D9] text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Role-Based Operational Architecture</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[#0E1726] tracking-tight">
            AuthClaw ITSM Roles &amp; Responsibilities
          </h1>
          <p className="text-base sm:text-lg text-[#475069] leading-relaxed">
            Every participant in enterprise service operations receives a tailored,
            purpose-built experience. Explore the 6 distinct operational roles
            engineered into AuthClaw ITSM.
          </p>
        </div>

        {/* Roles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
          {ROLES.map((role) => {
            const Icon = role.icon;
            const targetUrl = isAuthenticated
              ? role.dashboardPath
              : `/itsm/login?next=${encodeURIComponent(role.dashboardPath)}`;

            return (
              <div
                key={role.id}
                id={role.id}
                className="flex flex-col bg-white rounded-2xl border border-[#E6E9F0] p-7 shadow-[0_4px_16px_rgba(11,31,63,.04)] hover:shadow-[0_12px_28px_rgba(11,31,63,.08)] hover:border-[#D1D5DB] transition-all duration-200"
              >
                {/* Header with Icon and Badge */}
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                    style={{ backgroundColor: role.bgColor, color: role.color }}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <span
                    className="text-[11px] font-bold px-2.5 py-1 rounded-full tracking-wide"
                    style={{
                      backgroundColor: role.bgColor,
                      color: role.color,
                      border: `1px solid ${role.borderColor}`,
                    }}
                  >
                    {role.badge}
                  </span>
                </div>

                {/* Role Title & Tagline */}
                <h3 className="text-xl font-bold text-[#0E1726] mb-1.5">{role.name}</h3>
                <p className="text-xs font-semibold text-[#6D28D9] mb-3">{role.tagline}</p>
                <p className="text-xs text-[#6B7488] leading-relaxed mb-6">
                  {role.description}
                </p>

                {/* Key Responsibilities */}
                <div className="mb-6 flex-1">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#0E1726] mb-3 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                    Key Responsibilities
                  </h4>
                  <ul className="space-y-2 text-xs text-[#475069]">
                    {role.responsibilities.map((resp, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] mt-1.5 shrink-0" />
                        <span className="leading-snug">{resp}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Capabilities list */}
                <div className="pt-4 border-t border-[#F0F2F6] mb-6">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#8C95A8] mb-2">
                    Included Capabilities
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {role.capabilities.map((cap, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0] px-2 py-0.5 rounded-md font-medium"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Explore Dashboard CTA */}
                <div className="pt-2">
                  <Link
                    href={targetUrl}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-white transition-all shadow-sm active:scale-98 hover:brightness-105"
                    style={{ backgroundColor: role.color }}
                  >
                    <span>Explore {role.name} Dashboard</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* Security & Isolation Banner */}
        <div className="rounded-2xl bg-gradient-to-r from-[#1E1B4B] to-[#312E81] text-white p-8 sm:p-10 shadow-lg flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white text-xs font-medium backdrop-blur-sm">
              <Lock className="w-3.5 h-3.5" />
              <span>Cryptographic Tenant &amp; Role Isolation</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Enforced by PostgreSQL Row Level Security &amp; RBAC
            </h2>
            <p className="text-sm text-indigo-200 leading-relaxed">
              Every dashboard and query is strictly scoped to the user&apos;s authorized tenant and
              ITSM role. Service desk agents cannot alter governance policies, and auditors are
              cryptographically prevented from mutating live tickets.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0">
            <Link
              href={isAuthenticated ? "/itsm/dashboard" : "/itsm/login"}
              className="px-5 py-3 rounded-xl bg-white text-[#1E1B4B] font-bold text-xs hover:bg-[#F3F4F6] transition shadow-md"
            >
              {isAuthenticated ? "Launch Your Dashboard" : "Sign In to ITSM"}
            </Link>
            <Link
              href="/demo"
              className="px-5 py-3 rounded-xl bg-white/10 text-white font-semibold text-xs hover:bg-white/20 transition border border-white/20"
            >
              Request Custom Demo
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
