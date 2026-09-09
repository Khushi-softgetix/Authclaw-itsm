import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { createMarketingMetadata } from "@/marketing/seo";
import { marketingRoutes } from "@/marketing/config";

export const metadata: Metadata = createMarketingMetadata({
  title: "AuthClaw ITSM — AI-Native IT Service Management",
  description:
    "Manage incidents, service requests, knowledge, SLAs, and operational workflows in the same secure platform that governs your enterprise AI.",
  path: "/itsm",
});

export default async function ItsmLandingPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  const isAuthenticated = Boolean(sessionToken?.startsWith("acl_session_"));

  const primaryCtaHref = isAuthenticated ? "/itsm/incidents" : "/itsm/login";
  const primaryCtaText = isAuthenticated ? "Go to ITSM Console" : "Login to ITSM";

  return (
    <div className="marketing-site">
      {/* HERO SECTION */}
      <section className="hero">
        <div className="wrap hero-in">
          <div className="hero-copy">
            <span className="eyebrow">AuthClaw ITSM</span>
            <h1>
              AI-native service management, <br />
              built into AuthClaw.
            </h1>
            <p className="sub">
              Manage incidents, service requests, knowledge, SLAs, and operational workflows
              in the same secure platform that governs your AI.
            </p>
            <div className="cta-row" style={{ display: "flex", gap: "12px", marginTop: "24px", flexWrap: "wrap" }}>
              <Link className="btn btn-primary" href={primaryCtaHref}>
                {primaryCtaText}
              </Link>
              <a className="btn btn-ghost" href="#incidents">
                Explore Incident Management
              </a>
            </div>
          </div>

          <div className="hero-visual" style={{ position: "relative" }}>
            <div
              className="terminal"
              style={{
                background: "var(--white)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-lg)",
                boxShadow: "var(--shadow-lg)",
                overflow: "hidden",
              }}
            >
              <div
                className="t-head"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  background: "var(--paper-2)",
                  borderBottom: "1px solid var(--line)",
                  fontFamily: "var(--font-m)",
                  fontSize: "12px",
                  color: "var(--slate)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "#10B981",
                      display: "inline-block",
                    }}
                  />
                  <span>itsm · live operational flow</span>
                </div>
                <span
                  style={{
                    background: "var(--violet-050)",
                    color: "var(--violet)",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontWeight: 600,
                  }}
                >
                  Phase 4 MVP
                </span>
              </div>

              <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    background: "var(--paper)",
                    borderRadius: "var(--r-sm)",
                    border: "1px solid var(--line-2)",
                  }}
                >
                  <div>
                    <span style={{ fontFamily: "var(--font-m)", fontSize: "11px", color: "var(--slate)" }}>
                      INC-000001
                    </span>
                    <p style={{ fontWeight: 600, fontSize: "14px", color: "var(--ink)", marginTop: "2px" }}>
                      Payment Gateway Latency Surge
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "3px 8px",
                        borderRadius: "4px",
                        background: "#FEE2E2",
                        color: "#DC2626",
                      }}
                    >
                      P1 Critical
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "3px 8px",
                        borderRadius: "4px",
                        background: "#D1FAE5",
                        color: "#059669",
                      }}
                    >
                      RESOLVED
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    background: "var(--paper)",
                    borderRadius: "var(--r-sm)",
                    border: "1px solid var(--line-2)",
                  }}
                >
                  <div>
                    <span style={{ fontFamily: "var(--font-m)", fontSize: "11px", color: "var(--slate)" }}>
                      INC-000002
                    </span>
                    <p style={{ fontWeight: 600, fontSize: "14px", color: "var(--ink)", marginTop: "2px" }}>
                      LLM Egress Quota Threshold Alert
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "3px 8px",
                        borderRadius: "4px",
                        background: "#FEF3C7",
                        color: "#D97706",
                      }}
                    >
                      P2 High
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "3px 8px",
                        borderRadius: "4px",
                        background: "#EDE9FE",
                        color: "#6D28D9",
                      }}
                    >
                      IN_PROGRESS
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    padding: "12px",
                    background: "var(--paper-2)",
                    borderRadius: "var(--r-sm)",
                    fontFamily: "var(--font-m)",
                    fontSize: "12px",
                    color: "var(--slate)",
                    lineHeight: "1.6",
                  }}
                >
                  <div style={{ color: "var(--violet)", fontWeight: 600 }}>Lifecycle State Machine</div>
                  <div>NEW → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INCIDENT MANAGEMENT SPOTLIGHT */}
      <section
        id="incidents"
        className="band"
        style={{ background: "var(--white)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
      >
        <div className="wrap">
          <div className="sec-head center" style={{ margin: "0 auto 48px auto", textAlign: "center" }}>
            <span className="eyebrow">Available Feature</span>
            <h2>Incident Management</h2>
            <p className="sub" style={{ margin: "16px auto 0 auto", maxWidth: "680px" }}>
              Identify, prioritize, assign, and resolve service disruptions while keeping the
              complete operational history in one place.
            </p>
          </div>

          <div
            className="fgrid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "24px",
            }}
          >
            <div className="fcard">
              <div className="ico" style={{ fontSize: "20px", color: "var(--violet)", marginBottom: "12px" }}>
                ⌘
              </div>
              <h3 style={{ fontSize: "17px", fontWeight: 600, marginBottom: "8px" }}>
                Deterministic Priority Derivation
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Priority (P1–P4) is derived automatically by the backend from impact and urgency matrices, ensuring
                consistent severity classification without manual guessing.
              </p>
            </div>

            <div className="fcard">
              <div className="ico" style={{ fontSize: "20px", color: "var(--violet)", marginBottom: "12px" }}>
                ⛨
              </div>
              <h3 style={{ fontSize: "17px", fontWeight: 600, marginBottom: "8px" }}>
                Strict Lifecycle Transitions
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Enforces the approved state machine. Transitioning to Pending or Cancelled requires a status reason;
                transitioning to Resolved strictly mandates resolution codes and summaries.
              </p>
            </div>

            <div className="fcard">
              <div className="ico" style={{ fontSize: "20px", color: "var(--violet)", marginBottom: "12px" }}>
                ▤
              </div>
              <h3 style={{ fontSize: "17px", fontWeight: 600, marginBottom: "8px" }}>
                Activity Stream & Dual Notes
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Chronological timeline tracking status updates, assignments, and comments. Supports internal operator
                work notes hidden from non-privileged viewers.
              </p>
            </div>

            <div className="fcard">
              <div className="ico" style={{ fontSize: "20px", color: "var(--violet)", marginBottom: "12px" }}>
                ◈
              </div>
              <h3 style={{ fontSize: "17px", fontWeight: 600, marginBottom: "8px" }}>
                Tenant Assignment & SLA Awareness
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Assign incidents to operational groups and verified tenant users. Automatically links active SLA
                policies and target response intervals.
              </p>
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: "40px" }}>
            <Link className="btn btn-primary" href={primaryCtaHref}>
              Launch Incident Management
            </Link>
          </div>
        </div>
      </section>

      {/* ROADMAP CAPABILITIES OVERVIEW */}
      <section id="solutions" className="band">
        <div className="wrap">
          <div className="sec-head center" style={{ margin: "0 auto 48px auto", textAlign: "center" }}>
            <span className="eyebrow">Product Roadmap</span>
            <h2>Approved ITSM Capabilities</h2>
            <p className="sub" style={{ margin: "16px auto 0 auto", maxWidth: "680px" }}>
              AuthClaw ITSM provides a complete IT service management suite built directly on our secure multi-tenant
              foundation.
            </p>
          </div>

          <div
            className="fgrid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "24px",
            }}
          >
            <div
              className="fcard"
              style={{
                background: "var(--white)",
                border: "1px solid var(--violet-300)",
                boxShadow: "var(--ring-violet)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span className="eyebrow" style={{ color: "var(--violet)" }}>Phase 4 · MVP</span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: "4px",
                    background: "var(--violet-050)",
                    color: "var(--violet)",
                  }}
                >
                  Available Now
                </span>
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "var(--ink)" }}>
                Incident Management
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                End-to-end incident lifecycle management with automated ticket numbering (INC-XXXXXX), P1–P4 priority
                matrix, assignment groups, and resolution tracking.
              </p>
            </div>

            <div className="fcard" style={{ background: "var(--white)", border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span className="eyebrow">Roadmap</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--mute)" }}>Upcoming</span>
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "var(--ink)" }}>
                Service Requests
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Standardized service request workflows, automated approvals, fulfillment task tracking, and self-service
                portals for end users.
              </p>
            </div>

            <div className="fcard" style={{ background: "var(--white)", border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span className="eyebrow">Roadmap</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--mute)" }}>Upcoming</span>
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "var(--ink)" }}>
                Service Catalog
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Curated catalog of IT and AI services with request forms, entitlement rules, SLAs, and approval matrices
                tailored to enterprise roles.
              </p>
            </div>

            <div className="fcard" style={{ background: "var(--white)", border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span className="eyebrow">Roadmap</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--mute)" }}>Upcoming</span>
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "var(--ink)" }}>
                Knowledge Management
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Knowledge-Centered Service (KCS) with versioned resolution guides, search, article lifecycle, and AI
                agent retrieval assistance.
              </p>
            </div>

            <div className="fcard" style={{ background: "var(--white)", border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span className="eyebrow">Roadmap</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--mute)" }}>Upcoming</span>
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "var(--ink)" }}>
                SLA Management
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Multi-tier service level agreements, business-calendar calculation engines, escalation rules, and
                breach notification monitors.
              </p>
            </div>

            <div className="fcard" style={{ background: "var(--white)", border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span className="eyebrow">Roadmap</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--mute)" }}>Upcoming</span>
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "var(--ink)" }}>
                Configuration Management (CMDB)
              </h3>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Configuration item registry linking services, AI models, cloud infrastructure, and dependencies with
                impact analysis for change management.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ROLES SECTION */}
      <section id="roles" className="band" style={{ background: "var(--white)" }}>
        <div className="wrap">
          <div className="sec-head center" style={{ margin: "0 auto 48px auto", textAlign: "center" }}>
            <span className="eyebrow">Operating Model</span>
            <h2>Six Purpose-Built Roles for Enterprise Service Flow</h2>
            <p className="sub" style={{ margin: "16px auto 0 auto", maxWidth: "680px" }}>
              AuthClaw ITSM provides purpose-tailored dashboards and strict cryptographic boundaries for every stakeholder in IT service delivery.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "24px",
              marginBottom: "36px",
            }}
          >
            <div style={{ background: "#FAFAFC", padding: "24px", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#2563EB", background: "#EFF6FF", padding: "3px 8px", borderRadius: "4px" }}>
                Self-Service
              </span>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginTop: "12px", marginBottom: "6px", color: "var(--ink)" }}>Requester Portal</h3>
              <p style={{ fontSize: "13px", color: "var(--slate)", lineHeight: 1.5 }}>
                Streamlined intake, ticket status tracking, knowledge search, and verified issue resolution for enterprise employees.
              </p>
            </div>
            <div style={{ background: "#FAFAFC", padding: "24px", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#7C3AED", background: "#F5F3FF", padding: "3px 8px", borderRadius: "4px" }}>
                Tier 1 &amp; Tier 2
              </span>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginTop: "12px", marginBottom: "6px", color: "var(--ink)" }}>Service Agent</h3>
              <p style={{ fontSize: "13px", color: "var(--slate)", lineHeight: 1.5 }}>
                Rapid triage, AI copilot runbooks, work notes, public communication, and SLA adherence across active tickets.
              </p>
            </div>
            <div style={{ background: "#FAFAFC", padding: "24px", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "3px 8px", borderRadius: "4px" }}>
                Major Incidents
              </span>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginTop: "12px", marginBottom: "6px", color: "var(--ink)" }}>Service Lead</h3>
              <p style={{ fontSize: "13px", color: "var(--slate)", lineHeight: 1.5 }}>
                Unified incident command, queue load balancing, major incident escalation, and real-time SLA breach prevention.
              </p>
            </div>
            <div style={{ background: "#FAFAFC", padding: "24px", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#D97706", background: "#FFFBEB", padding: "3px 8px", borderRadius: "4px" }}>
                Stability Governance
              </span>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginTop: "12px", marginBottom: "6px", color: "var(--ink)" }}>Process &amp; Change</h3>
              <p style={{ fontSize: "13px", color: "var(--slate)", lineHeight: 1.5 }}>
                Change Advisory Board (CAB) review, risk evaluation, collision detection, and problem root cause analysis.
              </p>
            </div>
            <div style={{ background: "#FAFAFC", padding: "24px", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "3px 8px", borderRadius: "4px" }}>
                Systems &amp; Rules
              </span>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginTop: "12px", marginBottom: "6px", color: "var(--ink)" }}>Platform Admin</h3>
              <p style={{ fontSize: "13px", color: "var(--slate)", lineHeight: 1.5 }}>
                Assignment groups, SLA business hours, service catalog definitions, and AI copilot model configurations.
              </p>
            </div>
            <div style={{ background: "#FAFAFC", padding: "24px", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#0891B2", background: "#ECFEFF", padding: "3px 8px", borderRadius: "4px" }}>
                Independent Assurance
              </span>
              <h3 style={{ fontSize: "18px", fontWeight: 700, marginTop: "12px", marginBottom: "6px", color: "var(--ink)" }}>Auditor &amp; Compliance</h3>
              <p style={{ fontSize: "13px", color: "var(--slate)", lineHeight: 1.5 }}>
                Tamper-evident append-only audit trail verification, compliance exports, and read-only inspection guarantees.
              </p>
            </div>
          </div>

          <div style={{ textAlign: "center" }}>
            <Link className="btn btn-primary" href="/itsm/roles">
              View Detailed Roles &amp; Responsibilities &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* CONVERGENCE SECTION */}
      <section
        id="about"
        className="band-tight"
        style={{ background: "var(--paper-2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
      >
        <div className="wrap">
          <div className="sec-head center" style={{ margin: "0 auto 48px auto", textAlign: "center" }}>
            <span className="eyebrow">Unified Architecture</span>
            <h2>One platform for IT operations and AI governance.</h2>
            <p className="sub" style={{ margin: "16px auto 0 auto", maxWidth: "680px" }}>
              AuthClaw ITSM shares the same enterprise-grade security, identity, and compliance primitives that power
              the rest of your AuthClaw deployment.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "28px",
            }}
          >
            <div
              style={{
                background: "var(--white)",
                padding: "24px",
                borderRadius: "var(--r-md)",
                border: "1px solid var(--line)",
              }}
            >
              <h4 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>Shared Enterprise Identity</h4>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Single sign-on via OIDC/SAML, role-based access control, and native multi-tenant Row Level Security (RLS)
                enforced in PostgreSQL.
              </p>
            </div>

            <div
              style={{
                background: "var(--white)",
                padding: "24px",
                borderRadius: "var(--r-md)",
                border: "1px solid var(--line)",
              }}
            >
              <h4 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>Agentic Remediation Link</h4>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Connect incident response with LangGraph autonomous remediation agents, requiring human-in-the-loop
                approval before changes apply.
              </p>
            </div>

            <div
              style={{
                background: "var(--white)",
                padding: "24px",
                borderRadius: "var(--r-md)",
                border: "1px solid var(--line)",
              }}
            >
              <h4 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>Append-Only Audit Trail</h4>
              <p style={{ fontSize: "14px", color: "var(--slate)", lineHeight: 1.5 }}>
                Every lifecycle change, assignment, and comment automatically registers in the cryptographically chained
                audit log.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING SECTION */}
      <section id="pricing" className="band" style={{ background: "var(--white)", borderTop: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="sec-head center" style={{ margin: "0 auto 48px auto", textAlign: "center" }}>
            <span className="eyebrow">Transparent Pricing</span>
            <h2>Enterprise Service Management, Simple Economics</h2>
            <p className="sub" style={{ margin: "16px auto 0 auto", maxWidth: "680px" }}>
              Scale incident response and service management without per-ticket penalties. Included in AuthClaw Enterprise tiers.
            </p>
          </div>

          <div style={{ maxWidth: "840px", margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px" }}>
            <div style={{ background: "#FAFBFD", border: "1px solid var(--line)", borderRadius: "16px", padding: "32px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <span className="eyebrow">AuthClaw ITSM Standard</span>
                <h3 style={{ fontSize: "24px", fontWeight: 800, marginTop: "8px", color: "var(--ink)" }}>Included with Enterprise</h3>
                <p style={{ fontSize: "14px", color: "var(--slate)", marginTop: "8px", lineHeight: 1.5 }}>
                  Full incident management, SLA tracking, requester self-service, and up to 10 agent seats included with every AuthClaw Enterprise cluster.
                </p>
                <ul style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px", color: "var(--slate)" }}>
                  <li>✓ End-to-end incident lifecycle (INC-XXXXXX)</li>
                  <li>✓ 6 role-based dashboards</li>
                  <li>✓ PostgreSQL RLS multi-tenancy</li>
                  <li>✓ Cryptographic audit log trail</li>
                </ul>
              </div>
              <div style={{ marginTop: "28px" }}>
                <Link className="btn btn-ghost" href="/itsm/login" style={{ width: "100%", textAlign: "center" }}>
                  Sign In
                </Link>
              </div>
            </div>

            <div style={{ background: "white", border: "2px solid #6D28D9", borderRadius: "16px", padding: "32px", display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: "0 10px 30px rgba(109,40,217,0.08)" }}>
              <div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "white", background: "#6D28D9", padding: "3px 10px", borderRadius: "20px" }}>Dedicated &amp; Custom</span>
                <h3 style={{ fontSize: "24px", fontWeight: 800, marginTop: "8px", color: "var(--ink)" }}>Enterprise Scale</h3>
                <p style={{ fontSize: "14px", color: "var(--slate)", marginTop: "8px", lineHeight: 1.5 }}>
                  For high-volume operations requiring dedicated SLA engines, LangGraph AI triage copilots, custom CMDB topologies, and custom compliance packages.
                </p>
                <ul style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px", color: "var(--slate)" }}>
                  <li>✓ Unlimited agents &amp; requesters</li>
                  <li>✓ LangGraph Agentic Remediation Integration</li>
                  <li>✓ 99.99% SLA uptime guarantee</li>
                  <li>✓ Dedicated customer success engineer</li>
                </ul>
              </div>
              <div style={{ marginTop: "28px" }}>
                <Link className="btn btn-primary" href={marketingRoutes.demo} style={{ width: "100%", textAlign: "center" }}>
                  Talk to Solutions Engineering
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CLOSING CTA BANNER */}
      <section className="band" style={{ textAlign: "center" }}>
        <div className="wrap">
          <span className="eyebrow">Get Started</span>
          <h2 style={{ fontSize: "36px", marginTop: "12px", marginBottom: "16px" }}>
            Unify service operations with enterprise AI governance.
          </h2>
          <p className="sub" style={{ margin: "0 auto 32px auto", maxWidth: "600px" }}>
            Sign in to access your AuthClaw ITSM workspace or speak with our solutions engineering team.
          </p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link className="btn btn-primary" href={primaryCtaHref}>
              {primaryCtaText}
            </Link>
            <Link className="btn btn-ghost" href={marketingRoutes.demo}>
              Book a demo
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
