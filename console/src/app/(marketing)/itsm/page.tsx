import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  ArrowRight,
  Check,
  CircleUserRound,
  FileText,
  Headphones,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { createMarketingMetadata } from "@/marketing/seo";

export const metadata: Metadata = createMarketingMetadata({
  title: "AuthClaw ITSM — Governed IT Service Management",
  description:
    "A connected service management workspace for requests, incidents, operations, and auditable improvement.",
  path: "/itsm",
});

const foundationItems = [
  {
    icon: ShieldCheck,
    title: "Shared identity",
    description: "One identity across AuthClaw product areas.",
  },
  {
    icon: UsersRound,
    title: "Tenant-aware access",
    description: "Consistent, secure organizational boundaries.",
  },
  {
    icon: FileText,
    title: "Auditable operations",
    description: "A traceable record of service work.",
  },
] as const;

const serviceFlow = [
  ["01", "Request", "Capture the service need"],
  ["02", "Prioritize", "Make urgency and impact clear"],
  ["03", "Coordinate", "Connect ownership and action"],
  ["04", "Improve", "Preserve evidence and learning"],
] as const;

const capabilityGroups = [
  {
    icon: CircleUserRound,
    title: "Requester work",
    description: "A simple, consistent experience for getting help.",
    items: ["Submit and track requests", "Stay informed on progress", "One place for service interactions"],
  },
  {
    icon: Headphones,
    title: "Service operations",
    description: "Coordinate, resolve, and improve with confidence.",
    items: ["Triage and assign work", "Keep teams aligned", "Capture resolution and improvement"],
  },
] as const;

const roles = [
  {
    icon: CircleUserRound,
    title: "Employees",
    description: "Get help and stay informed.",
    items: ["Submit requests", "Track progress", "Find answers"],
  },
  {
    icon: Headphones,
    title: "Service teams",
    description: "Resolve issues and keep work moving.",
    items: ["Manage and assign", "Collaborate across teams", "Close and learn"],
  },
  {
    icon: UsersRound,
    title: "Leaders and assurance",
    description: "Maintain oversight and trust.",
    items: ["Understand service health", "Access audit evidence", "Drive improvement"],
  },
] as const;

function IncidentPreview({ compact = false }: { compact?: boolean }) {
  if (compact) {
    const timeline = [
      ["Customer access is degraded", "Today, 10:14"],
      ["Assigned to Service operations", "Today, 10:18"],
      ["Response on track", "Today, 10:32"],
      ["Validate recovery", "Pending"],
    ] as const;

    return (
      <div className="overflow-hidden rounded-[18px] border border-[#18345B] bg-[#0A2143] text-white shadow-[0_24px_50px_-30px_rgba(10,33,67,.65)]">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 font-mono text-[11px] tracking-[0.08em] text-[#9CAED0]">
          <span className="h-2 w-2 rounded-full bg-white/35" />
          <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" />
          <span className="h-2 w-2 rounded-full bg-[#DDD6FE]" />
          <span className="ml-2">authclaw · itsm</span>
        </div>
        <div className="border-b border-white/10 px-5 pt-4">
          <div className="flex gap-6 text-xs text-[#91A4C8]">
            <span>Request</span>
            <span className="border-b-2 border-[#8B5CF6] pb-3 text-white">Activity</span>
            <span>Related</span>
            <span>Evidence</span>
          </div>
        </div>
        <div className="px-6 py-5">
          <ol className="relative space-y-5 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-[#7C3AED]">
            {timeline.map(([title, time], index) => (
              <li className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-4" key={title}>
                <span className={`relative z-10 mt-1 h-4 w-4 rounded-full border-2 ${index === timeline.length - 1 ? "border-[#D9CCFB] bg-[#0A2143]" : "border-[#7C3AED] bg-[#7C3AED]"}`} />
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-1 block text-xs text-[#91A4C8]">{time}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[20px] border border-[#18345B] bg-[#0A2143] text-white shadow-[0_30px_60px_-32px_rgba(10,33,67,.72)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 font-mono text-[11px] tracking-[0.08em] text-[#9CAED0]">
        <span className="h-2 w-2 rounded-full bg-white/35" />
        <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" />
        <span className="h-2 w-2 rounded-full bg-[#DDD6FE]" />
        <span className="ml-2">authclaw · itsm</span>
      </div>
      <div className="p-5 sm:p-7">
        <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#9CAED0]">Service interruption</p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">Customer access is degraded</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[#B9C5DB]">One record keeps context, ownership, and progress together.</p>
            </div>
            <span className="rounded-lg border border-[#7656C8] bg-[#321C69] px-3 py-2 text-xs font-semibold text-[#E9E3FF]">P1 · Critical</span>
          </div>
          <dl className="mt-6 divide-y divide-white/10 border-y border-white/10">
            {[
              ["Responsible team", "Service operations"],
              ["Commitment", "Response on track"],
              ["Next action", "Validate recovery"],
            ].map(([label, value]) => (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 py-3.5" key={label}>
                <dt className="text-sm text-[#9CAED0]">{label}</dt>
                <dd className="text-right text-sm font-semibold text-white">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-7 grid grid-cols-4 gap-2">
            {["Received", "Prioritized", "Assigned", "Resolved"].map((step, index) => (
              <div className="relative text-center" key={step}>
                {index < 3 ? <span aria-hidden="true" className="absolute left-1/2 top-3 h-px w-full bg-[#7C3AED]" /> : null}
                <span className={`relative z-10 mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold ${index < 3 ? "border-[#7C3AED] bg-[#7C3AED] text-white" : "border-[#D9CCFB] bg-[#0A2143] text-[#E9E3FF]"}`}>
                  {index < 3 ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : "4"}
                </span>
                <span className="mt-2 block text-[10px] font-medium text-[#B9C5DB] sm:text-xs">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function ItsmLandingPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  const isAuthenticated = Boolean(sessionToken?.startsWith("acl_session_"));
  const primaryCtaHref = isAuthenticated ? "/itsm/incidents" : "/itsm/login";
  const primaryCtaText = isAuthenticated ? "Open ITSM workspace" : "Sign in to ITSM";

  return (
    <div className="bg-white text-[#0E1726]">
      <section className="border-b border-[#E6E9F0]">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 sm:px-8 sm:py-20 lg:min-h-[680px] lg:grid-cols-[minmax(0,1fr)_minmax(460px,.96fr)] lg:gap-16 lg:py-24">
          <div className="max-w-2xl">
            <h1 className="font-bold leading-[1.04] tracking-[-0.047em] text-[#0E1726]">
              <span className="block text-[42px] sm:text-[56px] lg:text-[60px]">Service work,</span>
              <span className="block text-[42px] sm:text-[56px] lg:text-[60px]">ownership, and</span>
              <span className="block whitespace-nowrap text-[35px] sm:text-[49px] lg:text-[55px]">decisions–connected.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[#536078]">
              AuthClaw ITSM is a built-in product area for requesting help, restoring service, and improving operations on the same trusted platform foundation.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={primaryCtaHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-[#6D28D9] px-6 text-sm font-semibold text-white shadow-[0_12px_24px_-12px_rgba(109,40,217,.75)] transition hover:bg-[#5B21B6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-2">
                {primaryCtaText}<ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <Link href="/itsm/roles" className="inline-flex min-h-12 items-center justify-center rounded-[10px] border border-[#D9DEE8] bg-white px-6 text-sm font-semibold text-[#0E1726] transition hover:border-[#C4B5FD] hover:bg-[#F8F5FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-2">
                Explore role workspaces
              </Link>
            </div>
          </div>
          <IncidentPreview />
        </div>
      </section>

      <section className="border-b border-[#E4DDF6] bg-[#F8F5FF]" aria-label="AuthClaw platform foundation">
        <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6D28D9]">Built on the AuthClaw foundation</p>
          <div className="mt-6 grid gap-6 md:grid-cols-3 md:divide-x md:divide-[#DDD6FE]">
            {foundationItems.map(({ icon: Icon, title, description }) => (
              <div className="flex items-start gap-4 md:px-6 md:first:pl-0" key={title}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#6D28D9] shadow-sm"><Icon aria-hidden="true" className="h-5 w-5" /></span>
                <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-[#6B7488]">{description}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#E6E9F0]" aria-labelledby="flow-heading">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 sm:px-8 lg:grid-cols-[.72fr_1.28fr] lg:items-center lg:py-24">
          <div className="max-w-md">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6D28D9]">One operational flow</p>
            <h2 id="flow-heading" className="mt-4 text-4xl font-bold leading-tight tracking-[-0.035em]">From request to resolution.</h2>
            <p className="mt-4 text-base leading-7 text-[#6B7488]">The same service context moves from intake to accountable improvement.</p>
          </div>
          <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            {serviceFlow.map(([number, title, description], index) => (
              <li className="relative" key={number}>
                {index < serviceFlow.length - 1 ? <span aria-hidden="true" className="absolute left-14 right-0 top-6 hidden h-px bg-[#DDD6FE] lg:block" /> : null}
                <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-[#F1ECFE] text-sm font-bold text-[#6D28D9]">{number}</span>
                <h3 className="mt-5 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#6B7488]">{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="capabilities" className="scroll-mt-20 border-b border-[#E6E9F0]" aria-labelledby="capabilities-heading">
        <div className="mx-auto grid max-w-7xl gap-14 px-6 py-20 sm:px-8 lg:grid-cols-[.82fr_1.18fr] lg:items-center lg:py-24">
          <div className="max-w-lg">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6D28D9]">Capabilities</p>
            <h2 id="capabilities-heading" className="mt-4 text-4xl font-bold leading-tight tracking-[-0.035em]">Everything service teams need, built in.</h2>
            <p className="mt-5 text-base leading-7 text-[#536078]">Requester work and service operations stay connected through the same identity, access control, and audit evidence as the rest of AuthClaw.</p>
            <a href="#workspaces" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[#6D28D9] px-5 text-sm font-semibold text-white transition hover:bg-[#5B21B6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-2">Explore capabilities<ArrowRight aria-hidden="true" className="h-4 w-4" /></a>
          </div>
          <div className="divide-y divide-[#E6E9F0] border-y border-[#E6E9F0]">
            {capabilityGroups.map(({ icon: Icon, title, description, items }) => (
              <article className="grid gap-5 py-8 sm:grid-cols-[56px_minmax(0,1fr)]" key={title}>
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#F1ECFE] text-[#6D28D9]"><Icon aria-hidden="true" className="h-6 w-6" /></span>
                <div>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#6B7488]">{description}</p>
                  <ul className="mt-4 space-y-2.5">
                    {items.map((item) => <li className="flex items-center gap-3 text-sm text-[#475069]" key={item}><Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[#6D28D9]" />{item}</li>)}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workspaces" className="scroll-mt-20 border-b border-[#E4DDF6] bg-[#F8F5FF]" aria-labelledby="roles-heading">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:px-8 lg:py-24">
          <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:items-start">
            <div className="max-w-md">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6D28D9]">For every role</p>
              <h2 id="roles-heading" className="mt-4 text-4xl font-bold leading-tight tracking-[-0.035em]">Role-based workspaces. A shared source of truth.</h2>
              <p className="mt-5 text-base leading-7 text-[#536078]">Everyone works in a focused space, with the same service context and evidence.</p>
              <Link href="/itsm/roles" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[#D7DCE5] bg-white px-5 text-sm font-semibold text-[#0E1726] transition hover:border-[#C4B5FD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]">Explore role workspaces<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
            </div>
            <div className="grid gap-8 md:grid-cols-3 md:divide-x md:divide-[#DDD6FE]">
              {roles.map(({ icon: Icon, title, description, items }) => (
                <article className="md:px-7 md:first:pl-0 md:last:pr-0" key={title}>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#6D28D9] shadow-sm"><Icon aria-hidden="true" className="h-5 w-5" /></span>
                  <h3 className="mt-5 text-base font-semibold">{title}</h3>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-[#6B7488]">{description}</p>
                  <ul className="mt-4 space-y-2.5">
                    {items.map((item) => <li className="flex items-start gap-2.5 text-sm text-[#536078]" key={item}><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#6D28D9]" />{item}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#E6E9F0]" aria-labelledby="context-heading">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 py-20 sm:px-8 lg:grid-cols-[1fr_.92fr] lg:py-24">
          <IncidentPreview compact />
          <div className="max-w-lg">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6D28D9]">One record, end to end</p>
            <h2 id="context-heading" className="mt-4 text-4xl font-bold leading-tight tracking-[-0.035em]">Keep context, ownership, and progress together.</h2>
            <p className="mt-5 text-base leading-7 text-[#536078]">From the initial request to final resolution, teams work from the same record—with a clear history and next action.</p>
            <Link href={primaryCtaHref} className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[#D7DCE5] bg-white px-5 text-sm font-semibold text-[#0E1726] transition hover:border-[#C4B5FD] hover:bg-[#F8F5FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]">See the connected experience<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
          </div>
        </div>
      </section>

      <section id="trust" className="scroll-mt-20 border-b border-[#E4DDF6] bg-[#F8F5FF]" aria-labelledby="trust-heading">
        <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8">
          <h2 id="trust-heading" className="sr-only">Trusted by design</h2>
          <div className="grid gap-6 md:grid-cols-3 md:divide-x md:divide-[#DDD6FE]">
            {foundationItems.map(({ icon: Icon, title, description }) => (
              <div className="flex items-start gap-4 md:px-6 md:first:pl-0" key={title}>
                <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#6D28D9]" />
                <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-[#6B7488]">{description}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 text-center sm:px-8 sm:py-24" aria-labelledby="cta-heading">
        <div className="mx-auto max-w-2xl">
          <h2 id="cta-heading" className="text-4xl font-bold tracking-[-0.035em]">Put service work in the path.</h2>
          <p className="mt-4 text-base leading-7 text-[#6B7488]">AuthClaw ITSM helps teams move from request to resolution with shared context and accountable ownership.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={primaryCtaHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-[#6D28D9] px-6 text-sm font-semibold text-white transition hover:bg-[#5B21B6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-2">{primaryCtaText}<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
            <Link href="/demo" className="inline-flex min-h-12 items-center justify-center rounded-[10px] border border-[#D7DCE5] px-6 text-sm font-semibold text-[#0E1726] transition hover:border-[#C4B5FD] hover:bg-[#F8F5FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]">Book a demo</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
