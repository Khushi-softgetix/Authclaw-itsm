export const marketingRoutes = {
  home: "/",
  product: "/product",
  itsm: "/itsm",
  pricing: "/pricing",
  security: "/security",
  company: "/company",
  privacy: "/privacy",
  terms: "/terms",
  cookies: "/cookies",
  subprocessors: "/subprocessors",
  dpa: "/dpa",
  login: "/login",
  itsmLogin: "/itsm/login",
  trial: "/early-access",
  demo: "/demo",
  earlyAccess: "/early-access",
  contact: "/early-access",
  careers: "/early-access",
  trustReport: "/early-access",
} as const;

export interface ProductMenuItem {
  href: string;
  label: string;
  description: string;
  badge?: string;
}

export const productMenuItems: readonly ProductMenuItem[] = [
  {
    href: marketingRoutes.product,
    label: "In-line gateway",
    description: "Low-latency multi-model proxy with active PII/PHI redaction.",
  },
  {
    href: marketingRoutes.product,
    label: "Agentic remediation",
    description: "LangGraph orchestrator proposing fixes under human-in-the-loop approvals.",
  },
  {
    href: marketingRoutes.product,
    label: "Audit & trust center",
    description: "Append-only SHA-256 hash-chained log with exportable evidence bundles.",
  },
  {
    href: marketingRoutes.product,
    label: "Framework scoring",
    description: "Automated framework scoring for SOC 2, HIPAA, and GDPR readiness.",
  },
  {
    href: marketingRoutes.itsm,
    label: "AuthClaw ITSM",
    description: "AI-native IT service management with incident lifecycle, SLAs, and unified operations.",
    badge: "New",
  },
] as const;

export const marketingNavigation = [
  { href: marketingRoutes.product, label: "Product" },
  { href: marketingRoutes.pricing, label: "Pricing" },
  { href: marketingRoutes.security, label: "Security" },
  { href: marketingRoutes.company, label: "Company" },
  { href: marketingRoutes.earlyAccess, label: "Early Access" },
] as const;

export const marketingFooterGroups = [
  {
    heading: "Product",
    links: [
      { href: marketingRoutes.product, label: "In-line gateway" },
      { href: marketingRoutes.product, label: "Agentic remediation" },
      { href: marketingRoutes.product, label: "Audit & trust center" },
      { href: marketingRoutes.product, label: "Framework scoring" },
      { href: marketingRoutes.itsm, label: "AuthClaw ITSM" },
    ],
  },
  {
    heading: "Solutions",
    links: [
      { href: marketingRoutes.pricing, label: "Pricing" },
      { href: marketingRoutes.security, label: "Security" },
      { href: marketingRoutes.security, label: "Trust center" },
      { href: marketingRoutes.product, label: "Integrations" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: marketingRoutes.company, label: "About" },
      { href: marketingRoutes.careers, label: "Careers" },
      { href: marketingRoutes.contact, label: "Contact" },
      { href: marketingRoutes.security, label: "Responsible AI" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: marketingRoutes.privacy, label: "Privacy Notice" },
      { href: marketingRoutes.terms, label: "Terms of Use" },
      { href: marketingRoutes.cookies, label: "Cookies" },
      { href: marketingRoutes.subprocessors, label: "Subprocessors" },
      { href: marketingRoutes.dpa, label: "DPA requests" },
    ],
  },
] as const;

export const marketingSiteUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL || "https://authclaw.ai"
);

export const isMarketingSiteIndexable =
  process.env.NODE_ENV === "production" &&
  marketingSiteUrl.protocol === "https:" &&
  marketingSiteUrl.hostname === "authclaw.ai";

