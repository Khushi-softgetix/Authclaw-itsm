import Link from "next/link";
import { Ticket } from "lucide-react";

const FOOTER_GROUPS = [
  {
    heading: "Explore",
    links: [
      { label: "Overview", href: "/itsm" },
      { label: "Capabilities", href: "/itsm#capabilities" },
      { label: "Roles", href: "/itsm/roles" },
      { label: "Trust", href: "/itsm#trust" },
    ],
  },
  {
    heading: "Access",
    links: [
      { label: "Sign in to ITSM", href: "/itsm/login" },
      { label: "Book a demo", href: "/demo" },
    ],
  },
  {
    heading: "Trust",
    links: [
      { label: "Security", href: "/security" },
      { label: "Privacy Notice", href: "/privacy" },
      { label: "Terms of Use", href: "/terms" },
      { label: "Cookies", href: "/cookies" },
    ],
  },
] as const;

const FOOTER_LINK_CLASS =
  "inline-flex min-h-10 items-center rounded-md text-sm text-[#6B7488] transition-colors hover:text-[#6D28D9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-2";

export function ItsmPublicFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-[#E6E9F0] bg-white text-[#475069]">
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8 sm:py-12">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] lg:gap-12">
          <div className="col-span-2 lg:col-span-1 lg:max-w-sm">
            <Link
              href="/itsm"
              aria-label="AuthClaw ITSM home"
              className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] focus-visible:ring-offset-4"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#6D28D9] text-white shadow-[0_4px_12px_-4px_rgba(109,40,217,.5)]">
                <Ticket aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="text-lg font-bold tracking-tight text-[#0E1726]">
                AuthClaw <span className="text-[#6D28D9]">ITSM</span>
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-6 text-[#6B7488]">
              Secure, governed service management for requesting, resolving, and improving IT services.
            </p>
          </div>

          {FOOTER_GROUPS.map((group) => (
            <nav
              key={group.heading}
              aria-label={`${group.heading} links`}
              className={group.heading === "Trust" ? "col-span-2 lg:col-span-1" : undefined}
            >
              <h2 className="text-xs font-semibold text-[#0E1726]">{group.heading}</h2>
              <ul className={group.heading === "Trust" ? "mt-3 grid grid-cols-2 gap-x-8 lg:block lg:space-y-0.5" : "mt-3 space-y-0.5"}>
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className={FOOTER_LINK_CLASS}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-8 border-t border-[#E6E9F0] pt-5 text-xs leading-5 text-[#8C95A8] sm:mt-10 sm:flex sm:items-center sm:justify-between">
          <p>© {currentYear} AuthClaw ITSM</p>
          <p className="mt-1 sm:mt-0">
            A product by <span className="font-semibold text-[#475069]">AgentsArchitects.ai</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
