import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { createMarketingMetadata } from "@/marketing/seo";
import RoleDirectory, { type RoleDefinition } from "./role-directory";

export const metadata: Metadata = createMarketingMetadata({
  title: "ITSM Roles & Responsibilities — AuthClaw ITSM",
  description: "Explore the 6 purpose-built roles in AuthClaw ITSM: Requester, Service Agent, Incident Manager, Process & Change Manager, Platform Administrator, and Auditor.",
  path: "/itsm/roles",
});

const ROLES: RoleDefinition[] = [
  {
    id: "requester", roleKey: "REQUESTER", name: "Requester", icon: "requester", dashboardPath: "/itsm/dashboard/requester",
    tagline: "Request help and follow progress without service-desk complexity.",
    description: "Employees and business stakeholders can report issues, request services, follow updates, and confirm whether a resolution worked.",
    responsibilities: ["Submit incidents and service requests through guided forms", "Follow ticket status and requester-visible updates", "Confirm a resolution or reopen an unresolved issue", "Use approved knowledge articles before raising a ticket"],
    capabilities: ["Guided request intake", "Ticket tracking", "Requester comments", "Resolution confirmation"],
    targetAudience: "Employees, business teams, and internal service consumers",
  },
  {
    id: "service-agent", roleKey: "SERVICE_AGENT", name: "Service Agent", icon: "service-agent", dashboardPath: "/itsm/dashboard/service-agent",
    tagline: "Investigate assigned work and restore service within SLA targets.",
    description: "Support engineers triage assigned tickets, document their work, communicate with requesters, and drive incidents toward resolution.",
    responsibilities: ["Triage and investigate assigned incidents", "Maintain requester communication and internal work notes", "Move work through approved incident states", "Resolve incidents within response and resolution targets"],
    capabilities: ["Assigned queue", "Status transitions", "Activity timeline", "SLA tracking"],
    targetAudience: "Service-desk analysts, support engineers, and NOC operators",
  },
  {
    id: "incident-manager", roleKey: "INCIDENT_MANAGER", name: "Incident Manager", icon: "incident-manager", dashboardPath: "/itsm/incident-manager",
    tagline: "Protect SLA commitments and coordinate high-impact restoration.",
    description: "Operations leaders monitor incident health, balance ownership, and move into command mode when an incident requires coordinated restoration.",
    responsibilities: ["Monitor priority, ownership, SLA risk, and stalled incidents", "Reassign work and balance response ownership", "Assess P1 and P2 incidents for major-incident command", "Coordinate restoration tasks, decisions, and communications"],
    capabilities: ["Operations overview", "Incident queue", "Workload oversight", "Major Incident command"],
    targetAudience: "Incident managers, support leads, and incident commanders",
  },
  {
    id: "process-change", roleKey: "PROCESS_CHANGE_MANAGER", name: "Process & Change Manager", icon: "process-change", dashboardPath: "/itsm/dashboard/process-change",
    tagline: "Control change risk and reduce repeat operational failures.",
    description: "Process owners and change leaders review risk, coordinate approvals, and connect recurring incidents to longer-term corrective work.",
    responsibilities: ["Review normal and emergency changes", "Assess risk, scheduling conflicts, and rollback readiness", "Coordinate Change Advisory Board decisions", "Track recurring incidents and corrective actions"],
    capabilities: ["Approval queue", "Change calendar", "Risk review", "Problem tracking"],
    targetAudience: "Change managers, CAB members, release managers, and process owners",
  },
  {
    id: "platform-admin", roleKey: "PLATFORM_ADMINISTRATOR", name: "Platform Administrator", icon: "platform-admin", dashboardPath: "/itsm/dashboard/platform-admin",
    tagline: "Configure the people, policies, and reference data behind ITSM.",
    description: "Platform administrators maintain users, teams, services, configuration items, catalog data, and the rules that control service operations.",
    responsibilities: ["Manage users, assignment groups, and memberships", "Configure services, categories, and configuration items", "Maintain SLA policies and business calendars", "Control tenant-level ITSM settings and integrations"],
    capabilities: ["User administration", "Team configuration", "Service data", "SLA policy management"],
    targetAudience: "ITSM administrators, platform owners, and operations engineers",
  },
  {
    id: "auditor", roleKey: "AUDITOR", name: "Auditor & Compliance", icon: "auditor", dashboardPath: "/itsm/dashboard/auditor",
    tagline: "Review operational evidence without changing live service records.",
    description: "Audit and compliance teams inspect histories, approvals, controls, and service performance through a read-only workspace.",
    responsibilities: ["Review incident and change histories", "Inspect approvals, timestamps, and override evidence", "Evaluate SLA performance and breach handling", "Export evidence for compliance review"],
    capabilities: ["Read-only audit trail", "Evidence exports", "Approval review", "SLA reporting"],
    targetAudience: "Internal audit, compliance, risk, and external assurance teams",
  },
];

export default async function ItsmRolesPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  const isAuthenticated = Boolean(sessionToken?.startsWith("acl_session_"));

  return (
    <div className="bg-white px-6 py-14 sm:px-8 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0E1726] sm:text-4xl lg:text-5xl">Choose your ITSM role</h1>
          <p className="mt-4 text-base leading-7 text-[#475069] sm:text-lg">Each role receives a focused workspace for the decisions and work it owns. Select a role to review its responsibilities and available tools.</p>
        </header>

        <RoleDirectory roles={ROLES} isAuthenticated={isAuthenticated} />

        <aside className="mt-10 flex flex-col gap-4 rounded-xl border border-[#DDD6FE] bg-[#FAF8FF] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F1ECFE] text-[#6D28D9]">
              <LockKeyhole aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-[#0E1726]">Your workspaces</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6B7488]">
                Sign in to access the workspaces and tools available for your assigned roles.
              </p>
            </div>
          </div>
          <Link
            href={isAuthenticated ? "/itsm/dashboard" : "/itsm/login"}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-md text-sm font-semibold text-[#6D28D9] transition-colors hover:text-[#5B21B6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-2 sm:self-center"
          >
            {isAuthenticated ? "Open your workspaces" : "Sign in to ITSM"}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
