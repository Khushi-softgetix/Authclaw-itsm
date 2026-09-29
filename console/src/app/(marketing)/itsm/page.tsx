import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  ArrowRight,
  Check,
  CircleUserRound,
  Headphones,
  LockKeyhole,
  Route,
  UsersRound,
} from "lucide-react";
import { createMarketingMetadata } from "@/marketing/seo";
import { marketingRoutes } from "@/marketing/config";

export const metadata: Metadata = createMarketingMetadata({
  title: "AuthClaw ITSM — Governed IT Service Management",
  description:
    "Keep service work, ownership, commitments, and decisions connected in one secure ITSM workspace.",
  path: "/itsm",
});

const serviceFlow = [
  ["01", "Request"],
  ["02", "Prioritize"],
  ["03", "Coordinate"],
  ["04", "Improve"],
] as const;

const capabilities = [
  {
    icon: Headphones,
    title: "Get help and track work",
    description:
      "A clear entry point for incidents and service requests, with progress that people can understand.",
    items: ["Guided support intake", "Request and incident history", "Requester-visible updates"],
    previewTitle: "My support",
    previewRows: [
      ["Email access", "Assigned"],
      ["VPN connection", "In progress"],
      ["Software request", "Waiting for approval"],
    ],
  },
  {
    icon: Route,
    title: "Restore and improve services",
    description:
      "Coordinate restoration, preserve operational evidence, and turn recurring issues into controlled improvement.",
    items: ["Incident and major response", "Problem and controlled change", "SLA, knowledge, and service context"],
    previewTitle: "Response flow",
    previewRows: [
      ["Priority", "P1 · Critical"],
      ["Responsible team", "Network operations"],
      ["Next action", "Validate recovery"],
    ],
  },
] as const;

const audiences = [
  {
    icon: CircleUserRound,
    title: "Employees",
    description: "Request help, follow progress, and respond when more information is needed.",
  },
  {
    icon: Headphones,
    title: "Service teams",
    description: "Prioritize work, coordinate ownership, restore service, and keep people informed.",
  },
  {
    icon: UsersRound,
    title: "Leaders and administrators",
    description: "Manage commitments, access, service configuration, and operational improvement.",
  },
] as const;

export default async function ItsmLandingPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  const isAuthenticated = Boolean(sessionToken?.startsWith("acl_session_"));
  const primaryCtaHref = isAuthenticated ? "/itsm/incidents" : "/itsm/login";
  const primaryCtaText = isAuthenticated ? "Open your workspaces" : "Sign in to ITSM";

  return (
    <div className="marketing-site bg-white text-[#0E1726]">
      <section className="overflow-hidden border-b border-[#E6E9F0] bg-white">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 sm:px-8 sm:py-20 lg:items-start lg:min-h-[650px] lg:grid-cols-[minmax(0,1.03fr)_minmax(460px,.97fr)] lg:gap-20 lg:py-24">
          <div className="max-w-2xl">
            <h1 className="max-w-[720px] text-[42px] font-semibold leading-[1.05] tracking-[-0.045em] text-[#0E1726] sm:text-[56px] lg:text-[64px]">
              Service work, ownership, and decisions&mdash;connected.
            </h1>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link className="btn btn-primary w-full justify-center sm:w-auto" href={primaryCtaHref}>
                {primaryCtaText}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <a className="btn btn-ghost w-full justify-center sm:w-auto" href="#capabilities">
                Explore capabilities
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 -z-10 rounded-full bg-[#F1ECFE] opacity-70 blur-3xl" />
            <div className="overflow-hidden rounded-[22px] border border-[#D9CCFB] bg-white shadow-[0_28px_70px_-40px_rgba(45,26,92,.42)]">
              <div className="flex items-center justify-between border-b border-[#E6E9F0] px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6D28D9]">
                    Active service response
                  </p>
                  <p className="mt-1 text-sm text-[#6B7488]">One record. Clear ownership. Visible progress.</p>
                </div>
                <span className="rounded-full bg-[#F1ECFE] px-3 py-1 text-xs font-semibold text-[#6D28D9]">
                  In progress
                </span>
              </div>

              <div className="p-6 sm:p-7">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-sm font-semibold text-[#6D28D9]">Service interruption</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
                      Customer access is degraded
                    </h2>
                  </div>
                  <div className="rounded-xl border border-[#E6E9F0] bg-[#F5F7FA] px-4 py-3 text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7488]">Priority</p>
                    <p className="mt-1 text-sm font-semibold text-[#0E1726]">P1 · Critical</p>
                  </div>
                </div>

                <div className="mt-7 grid gap-px overflow-hidden rounded-xl border border-[#E6E9F0] bg-[#E6E9F0] sm:grid-cols-3">
                  {[
                    ["Responsible team", "Service operations"],
                    ["Commitment", "Response on track"],
                    ["Next action", "Validate recovery"],
                  ].map(([label, value]) => (
                    <div className="bg-white px-4 py-4" key={label}>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6B7488]">{label}</p>
                      <p className="mt-1.5 text-sm font-semibold text-[#0E1726]">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8">
                  <div className="relative grid grid-cols-4 gap-2">
                    <div className="absolute left-[9%] right-[9%] top-3 h-px bg-[#D9CCFB]" />
                    {["Received", "Prioritized", "Assigned", "Resolved"].map((step, index) => (
                      <div className="relative text-center" key={step}>
                        <span
                          className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold ${
                            index < 3
                              ? "border-[#6D28D9] bg-[#6D28D9] text-white"
                              : "border-[#D9CCFB] bg-white text-[#6D28D9]"
                          }`}
                        >
                          {index < 3 ? <Check aria-hidden="true" className="h-3 w-3" /> : "4"}
                        </span>
                        <p className="mt-2 text-[11px] font-medium text-[#475069]">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 sm:px-8 lg:grid-cols-[.72fr_1.28fr] lg:items-end lg:gap-20">
          <div className="max-w-xl">
            <h2 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              One clear flow from request to improvement.
            </h2>
            <p className="mt-4 text-lg leading-8 text-[#475069]">
              Keep the people asking for help and the teams restoring service aligned around the same operational truth.
            </p>
          </div>
          <ol className="grid border-y border-[#E6E9F0] sm:grid-cols-2 md:grid-cols-4 md:divide-x md:divide-[#E6E9F0]">
            {serviceFlow.map(([number, title]) => (
              <li className="flex items-center gap-4 border-b border-[#E6E9F0] py-6 last:border-b-0 sm:px-6 sm:[&:nth-child(3)]:border-b-0 md:border-b-0 md:first:pl-0 md:last:pr-0" key={number}>
                <span className="text-sm font-semibold text-[#6D28D9]">{number}</span>
                <h3 className="text-lg font-semibold">{title}</h3>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="capabilities" className="border-y border-[#E6E9F0] bg-[#F5F7FA] py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-6 sm:px-8">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
              The essential service work, connected.
            </h2>
            <p className="mt-4 text-lg leading-8 text-[#475069]">
              Two clear workspaces show how requests become owned, coordinated service work.
            </p>
          </div>

          <div className="mt-14 divide-y divide-[#DDE1E9] border-y border-[#DDE1E9]">
            {capabilities.map(({ icon: Icon, title, description, items, previewTitle, previewRows }, index) => (
              <article className="grid items-start gap-9 py-11 sm:py-12 lg:grid-cols-[.9fr_1.1fr] lg:gap-20" key={title}>
                <div className={index % 2 === 1 ? "lg:order-2" : undefined}>
                  <Icon aria-hidden="true" className="h-7 w-7 text-[#6D28D9]" strokeWidth={1.7} />
                  <h3 className="mt-5 text-2xl font-semibold tracking-[-0.025em]">{title}</h3>
                  <p className="mt-4 max-w-xl text-base leading-7 text-[#475069]">{description}</p>
                  <ul className="mt-6 space-y-3">
                    {items.map((item) => (
                      <li className="flex items-center gap-3 text-sm font-medium text-[#0E1726]" key={item}>
                        <Check aria-hidden="true" className="h-4 w-4 text-[#6D28D9]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={`overflow-hidden rounded-2xl border border-[#D9CCFB] bg-white shadow-[0_18px_45px_-38px_rgba(45,26,92,.5)] ${index % 2 === 1 ? "lg:order-1" : ""}`}>
                  <div className="flex items-center justify-between border-b border-[#E6E9F0] px-5 py-4">
                    <p className="text-sm font-semibold">{previewTitle}</p>
                    <span className="text-xs font-medium text-[#6D28D9]">Connected workspace</span>
                  </div>
                  <div className="divide-y divide-[#E6E9F0]">
                    {previewRows.map(([label, value]) => (
                      <div className="flex items-center justify-between gap-4 px-5 py-4" key={label}>
                        <span className="text-sm text-[#475069]">{label}</span>
                        <span className="text-right text-sm font-semibold text-[#0E1726]">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="roles" className="bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-6 sm:px-8">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                Workspaces for every service role.
              </h2>
              <p className="mt-4 text-lg leading-8 text-[#475069]">
                People see the tools and actions available for the responsibilities assigned to them.
              </p>
            </div>
            <Link className="inline-flex items-center gap-2 text-sm font-semibold text-[#6D28D9]" href="/itsm/roles">
              Explore roles and workspaces
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-12 grid border-y border-[#E6E9F0] md:grid-cols-3 md:divide-x md:divide-[#E6E9F0]">
            {audiences.map(({ icon: Icon, title, description }) => (
              <article className="flex flex-col border-b border-[#E6E9F0] py-9 last:border-b-0 md:min-h-52 md:border-b-0 md:px-8 md:first:pl-0 md:last:pr-0" key={title}>
                <Icon aria-hidden="true" className="h-6 w-6 text-[#6D28D9]" strokeWidth={1.7} />
                <h3 className="mt-5 text-xl font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#6B7488]">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="trust" className="border-t border-[#E6E9F0] px-6 py-20 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[24px] border border-[#D9CCFB] bg-[#F7F4FF]">
          <div className="grid gap-10 px-7 py-10 lg:grid-cols-[1.1fr_1.9fr] lg:px-12 lg:py-12">
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#6D28D9] shadow-sm">
                <LockKeyhole aria-hidden="true" className="h-5 w-5" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.025em]">Secure by design.</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-[#475069]">
                Access follows tenant boundaries and assigned responsibilities, while important actions retain a clear history.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-3">
              {[
                ["Tenant-isolated data", "Records remain within the organization that owns them."],
                ["Role-aware access", "Each action is limited by assigned responsibilities."],
                ["Auditable actions", "Ownership, decisions, and important changes stay traceable."],
              ].map(([title, description]) => (
                <div className="border-t border-[#D9CCFB] pt-5" key={title}>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#6B7488]">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#E6E9F0] bg-[#F5F7FA]">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 px-6 py-14 sm:px-8 sm:py-16 lg:flex-row lg:items-center">
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.035em]">
              Ready to bring service work together?
            </h2>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
            <Link className="btn btn-primary w-full justify-center sm:w-auto" href={primaryCtaHref}>
              {primaryCtaText}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link className="btn btn-ghost w-full justify-center sm:w-auto" href={marketingRoutes.demo}>
              Book a demo
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
