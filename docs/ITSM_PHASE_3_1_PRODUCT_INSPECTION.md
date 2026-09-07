# PHASE 3.1 — EXISTING AUTHCLAW PRODUCT & FRONTEND INSPECTION
## Integration Architecture & Product Analysis for ITSM Integration

**Status:** COMPLETE & VERIFIED  
**Repository Source of Truth:** `AuthClaw_Align-master`  
**Date:** September 4, 2026  
**Inspection Type:** Non-Destructive Inspection & Technical Integration Blueprint (No Code/DB/Infra Modified)  

---

## 1. Executive Summary

Phase 3.1 performs a comprehensive, non-destructive architectural inspection of the existing AuthClaw repository. The explicit goal is to establish **where and how the new ITSM (IT Service Management) capabilities will technically and visually integrate into the existing AuthClaw product**, without building a separate application, without rewriting existing platforms, and without destabilizing verified core capabilities.

### Key Architectural Takeaways
1. **Unified Product Model:** AuthClaw operates as a unified platform with an App Router-based operator console ([`console/src/app/(console)`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/(console))). ITSM must not exist as a detached application, but as an integrated workspace module within the authenticated console shell.
2. **Strict Platform Reuse:** All 8 core enterprise pillars—Authentication (Session/OIDC), RBAC/Authorization, Multi-Tenancy (PostgreSQL RLS with cryptographic session binding), Tamper-Evident Audit Logging (Kafka + PostgreSQL Outbox + ClickHouse), AI Gateway (Go reverse proxy), Agent Runtime / HITL (LangGraph with MFA approval gates), Operator Console (Next.js 16 + React 19 App Router BFF), and Database Migrations (SQLAlchemy + Alembic)—are fully operational. ITSM will strictly consume these services.
3. **No Unnecessary Redesigns:** The console uses a distinct design system governed by Tailwind CSS 4, Inter + Space Grotesk typography, curated HSL/hex tokens (`#FBFAF9`, `#0E1726`, `#6D28D9`, `#E6E9F0`), and bespoke micro-components. ITSM views will inherit this existing design system seamlessly.

---

## 2. Repository Structure

The AuthClaw codebase is structured as a hardened monorepo containing the following primary components:

```
AuthClaw_Align-master/
├── console/                             # Frontend Next.js 16 App Router application & BFF
│   ├── src/
│   │   ├── app/
│   │   │   ├── (console)/               # Authenticated operator console route group
│   │   │   │   ├── agent/               # LangGraph AI agent remediation & chat UI
│   │   │   │   ├── approvals/           # HITL approval queue & MFA execution UI
│   │   │   │   ├── audit/               # Audit explorer & integrity verification UI
│   │   │   │   ├── aws/                 # AWS Cloud account governance
│   │   │   │   ├── compliance/          # Framework scoring & evidence mapping UI
│   │   │   │   ├── connect/             # Cloud/SaaS integrations & connectors
│   │   │   │   ├── evidence/            # Evidence repository UI
│   │   │   │   ├── findings/            # Security & compliance findings dashboard
│   │   │   │   ├── frameworks/          # Regulatory framework configurations
│   │   │   │   ├── gateway/             # AI gateway telemetry & routes
│   │   │   │   ├── notifications/       # User notifications & alert inbox
│   │   │   │   ├── overview/            # Main executive governance dashboard
│   │   │   │   ├── policies/            # OPA Rego policy editor & simulation
│   │   │   │   ├── risk/                # Red teaming & risk posture
│   │   │   │   ├── settings/            # Tenant, user, & API key management
│   │   │   │   └── layout.tsx           # Authenticated shell layout (session gate)
│   │   │   ├── (marketing)/             # Public product website (SSR/SSG)
│   │   │   │   ├── product/             # Platform product overview page
│   │   │   │   ├── demo/                # Book a demo intake form
│   │   │   │   ├── early-access/        # Early access intake form
│   │   │   │   ├── pricing/             # Public pricing tiers
│   │   │   │   ├── security/            # Security architecture & responsible AI
│   │   │   │   └── layout.tsx           # Marketing layout (header/footer)
│   │   │   ├── api/                     # Next.js BFF API proxy routes
│   │   │   │   ├── [...path]/route.ts   # Regex-routed BFF proxy to backend
│   │   │   │   ├── auth/                # Login, logout, session, OIDC start/callback
│   │   │   │   ├── access-requests/     # Public intake form proxy
│   │   │   │   └── agent/               # Agent chat session & message streaming proxy
│   │   │   ├── login/                   # User authentication & SSO entry point
│   │   │   ├── signup/                  # Onboarding & invitation acceptance
│   │   │   └── trust-center/            # Public & shared compliance trust center
│   │   ├── components/                  # Reusable UI component layer
│   │   │   ├── console-shell.tsx        # Responsive navigation sidebar & header shell
│   │   │   ├── modal-shell.tsx          # Accessible modal dialog container
│   │   │   ├── filter-select.tsx        # Styled dropdown filter component
│   │   │   ├── mfa-challenge-modal.tsx  # MFA/TOTP prompt for critical operations
│   │   │   ├── notification-bell.tsx    # Live notification polling bell & panel
│   │   │   └── trust-summary.tsx        # Trust center summary badge widget
│   │   ├── lib/                         # Client utilities, API fetchers, formatters
│   │   │   ├── api-client.ts            # Server-side BFF proxy & session context reader
│   │   │   ├── bff-routes.ts            # Whitelist routing table for backend proxying
│   │   │   ├── client-fetch.ts          # Browser-side JSON fetch helpers
│   │   │   ├── ui-format.ts             # Status badges, severity colors, date formatters
│   │   │   └── errors.ts                # Sanitized error extraction
│   │   └── marketing/                   # Marketing headers, footers, & copy content
├── backend/                             # Python 3.14 FastAPI core backend & control plane
│   ├── app/
│   │   ├── api/v1/endpoints/            # REST API endpoint routers (23 modules)
│   │   │   ├── access_requests.py       # Public demo & early access intake
│   │   │   ├── apikeys.py               # API key CRUD & rotation
│   │   │   ├── audit.py                 # Audit logs, verification, ClickHouse status
│   │   │   ├── auth.py                  # Login, session validation, OIDC, MFA
│   │   │   ├── chat.py                  # Agent conversation & RAG grounding
│   │   │   ├── compliance_scores.py     # Live compliance scoring algorithms
│   │   │   ├── evidence.py              # Cryptographic evidence records
│   │   │   ├── findings.py              # Automated scan findings & status
│   │   │   ├── gateways.py              # Gateway instance management
│   │   │   ├── policies.py              # OPA policy bundle generation & tests
│   │   │   ├── rag.py                   # Regulatory corpus search & sync
│   │   │   ├── users.py                 # Tenant user management & invitations
│   │   │   └── workflows.py             # LangGraph workflow approvals & remediation
│   │   ├── core/                        # Core security & configuration
│   │   │   ├── auth.py                  # AuthMiddleware, get_tenant_db, RBAC dependencies
│   │   │   ├── config.py                # Pydantic v2 settings & environment variables
│   │   │   └── crypto.py                # AES-256-GCM envelope encryption & key ring
│   │   ├── db/                          # Database connection & models
│   │   │   ├── base.py                  # SQLAlchemy declarative base
│   │   │   ├── models.py                # Relational entities (Users, Tenants, Approvals...)
│   │   │   └── session.py               # Engine, SessionLocal, RLS context hook
│   │   ├── rag/                         # Regulatory compliance corpus & BM25 retriever
│   │   └── services/                    # Business domain services
│   │       ├── access_requests.py       # Intake persistence & notification logic
│   │       ├── audit_store.py           # Dual-write audit sync (PostgreSQL -> ClickHouse)
│   │       └── event_backbone.py        # Outbox event publisher & metrics
│   ├── alembic/                         # Database schema migrations (Revisions 001 - 032)
│   └── main.py                          # FastAPI application factory & router registration
├── gateway/                             # Go 1.26 high-throughput AI Reverse Proxy (Port 8080)
│   ├── main.go                          # Reverse proxy entry, TLS & Kafka transport init
│   ├── proxy.go                         # LLM request/response interception & streaming
│   ├── redact.go                        # Presidio PII/PHI masking & reversible hashing
│   └── opa.go                           # In-line OPA Rego policy evaluation
├── services/agent/                      # Python FastAPI LangGraph Agent Service (Port 8001)
│   ├── main.py                          # Agent endpoints, chat, memory, session handling
│   ├── graph.py                         # LangGraph state graph for scanning & remediation
│   ├── approval_store.py                # HITL approval lifecycle & 30-min TTL logic
│   └── verify_audit.py                  # Background ClickHouse audit mirror worker
├── audit_consumer/                      # Kafka to ClickHouse Consumer Service (Port 9108)
│   ├── consumer.py                      # SHA-256 hash-chain validator & batch inserter
│   └── clickhouse_writer.py             # Append-only MergeTree inserter & deduplication
└── infra/                               # Docker Compose, ClickHouse SQL, OPA, Terraform
    ├── docker-compose.full.yml          # Complete 11-service local development stack
    ├── clickhouse/init.sql              # MergeTree audit table definitions
    └── opa/policies/                    # Rego policy definitions
```

---

## 3. Existing Frontend Architecture

| Attribute | Specification / Code Finding |
| :--- | :--- |
| **Framework & Version** | Next.js `16.3.2`, React `19.2.8`, React-DOM `19.2.8` ([`console/package.json`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/package.json#L14-L19)) |
| **Routing Pattern** | Next.js App Router with Route Groups: `(console)` for authenticated app and `(marketing)` for public web |
| **Application Port** | Port `3001` (`"dev": "next dev -p 3001"`) |
| **Styling Engine** | Tailwind CSS `v4` (`@import "tailwindcss";` in [`console/src/app/globals.css`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/globals.css#L1-L34)) |
| **Icons Library** | `lucide-react` `v1.34.0` |
| **Rendering Strategy** | Server Components for route layouts and authentication checks; Client Components (`"use client"`) for interactive pages, tables, and forms |
| **State Management** | React local state (`useState`, `useCallback`, `useMemo`) combined with URL Search Parameters (`useSearchParams`) for filters/pagination; no bloated Redux/Zustand required |
| **BFF Architecture** | All client requests call Next.js Route Handlers (`/api/*`), which attach server-held session cookies and forward to FastAPI (`http://localhost:8000`) or Agent (`http://localhost:8001`) |

---

## 4. Public Product Experience

### 4.1 Product Presentation & Entry Points
- **Hero & Core Value Proposition:** AuthClaw is presented as *"The runtime layer for AI compliance"* ([`console/src/marketing/content.ts:L9`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/marketing/content.ts#L9)), offering real-time PII/PHI redaction, policy enforcement via OPA, human-in-the-loop remediation, and tamper-evident audit logging.
- **Product Pillars Displayed:**
  1. Multi-model in-line gateway (OpenAI, Anthropic, Bedrock, Azure OpenAI)
  2. PII / PHI redaction (Microsoft Presidio)
  3. Agentic remediation with human approval (LangGraph)
  4. Continuous tamper-evident audit trails (Kafka + ClickHouse)
- **Navigation Items:** `Product` (`/product`), `Pricing` (`/pricing`), `Security` (`/security`), `Company` (`/company`), `Early Access` (`/early-access`).
- **Primary CTAs:** 
  - `Book a demo` (`/demo`) -> Submits to `/api/access-requests`, storing the request in PostgreSQL `access_requests` table.
  - `Log in` (`/login`) -> Transitions the user directly into the authenticated console.
- **Product Workspace Selection:** **NOT FOUND IN CURRENT REPOSITORY**. AuthClaw does not currently display a multi-product or workspace dropdown on the public site or console header. All capabilities are exposed under a unified console navigation.

---

## 5. Authenticated Console Architecture

### 5.1 Route Protection & Layout Hierarchy
The authenticated console is bounded entirely within [`console/src/app/(console)/layout.tsx`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/(console)/layout.tsx):
1. **Server-Side Cookie Gate:** Layout reads the HTTP-only cookie `authclaw_session`. If absent, redirects immediately to `/login`.
2. **Session Verification:** Makes a server-to-server request to FastAPI `GET /v1/auth/me` with `Authorization: Bearer <token>`.
3. **Context Injection:** Extracts `userEmail`, `tenantId`, `tenantName`, and `userRole`.
4. **Shell Render:** Renders `<ConsoleShell>` wrapping the active route page:
   ```tsx
   <ConsoleShell userEmail={userEmail} tenantId={tenantId} tenantName={tenantName} userRole={userRole}>
     {children}
   </ConsoleShell>
   ```

### 5.2 Header Implementation
Inside [`console/src/components/console-shell.tsx:L188-L233`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/components/console-shell.tsx#L188-L233):
- **Sticky Glassmorphic Bar:** `h-14 bg-white/90 backdrop-blur-md rounded-[20px] border border-[#E6E9F0]`
- **Breadcrumb:** Displays static context `Governance Layer / {currentPage}`.
- **Notification Bell:** Live bell icon polling `/api/notifications` with unread counts.
- **User Profile Dropdown:** Displays user avatar initials, user email, active tenant role, and Sign Out button.

---

## 6. Existing Navigation Structure

The console navigation is statically defined in [`console/src/components/console-shell.tsx:L33-L49`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/components/console-shell.tsx#L33-L49). Items are filtered dynamically based on the user's normalized tenant role:

```ts
const readRoles = ["owner", "admin", "developer", "operator", "viewer"];

const navigation = [
  { name: "Overview", href: "/overview", icon: LayoutDashboard, roles: readRoles },
  { name: "Gateway", href: "/gateway", icon: Cpu, roles: ["owner", "admin"] },
  { name: "Compliance", href: "/compliance", icon: ShieldCheck, roles: readRoles },
  { name: "Approvals", href: "/approvals", icon: ClipboardCheck, roles: readRoles },
  { name: "Audit", href: "/audit", icon: ScrollText, roles: readRoles },
  { name: "Agent & Remediation", href: "/agent", icon: MessageSquare, roles: readRoles },
  { name: "Integrations", href: "/connect", icon: Cable, roles: ["owner", "admin"] },
  { name: "Policies & Guardrails", href: "/policies", icon: ShieldAlert, roles: ["owner", "admin"] },
  { name: "Risk & Red Teaming", href: "/risk", icon: ShieldAlert, roles: readRoles },
  { name: "Evidence", href: "/evidence", icon: ScrollText, roles: readRoles },
  { name: "Findings", href: "/findings", icon: ShieldAlert, roles: readRoles },
  { name: "Cloud", href: "/aws", icon: Cloud, roles: ["owner", "admin"] },
  { name: "Settings", href: "/settings", icon: Settings, roles: ["owner", "admin"] },
];
```

### Bottom Sidebar Metadata
- **Active Tenant Card:** Displays `Active Tenant: {tenantName || tenantId}` inside the sidebar footer (`L132-L140`).

---

## 7. Existing Route Structure

| Route | Type | Purpose | Primary Backend Endpoints Used |
| :--- | :--- | :--- | :--- |
| `/` | Public | Homepage & marketing showcase | Static |
| `/product` | Public | Platform capability breakdown | Static |
| `/demo` | Public | Book a demo intake form | `POST /api/access-requests` |
| `/login` | Public/Auth | Login & SSO entry | `POST /api/auth/login`, `GET /api/auth/oidc/start` |
| `/overview` | Authenticated | High-level metrics & framework readiness | `GET /api/dashboard`, `GET /api/compliance-scores` |
| `/gateway` | Authenticated | Gateway proxies & telemetry | `GET /api/gateways` |
| `/compliance`| Authenticated | Frameworks & readiness breakdown | `GET /api/compliance-scores` |
| `/approvals` | Authenticated | HITL pending approvals & MFA gate | `GET /api/approvals`, `POST /api/approvals/{id}/approve` |
| `/audit` | Authenticated | Immutable audit log viewer & hash verify | `GET /api/audit` |
| `/agent` | Authenticated | AI remediation chat & workflow plans | `GET /api/agent/chat/sessions`, `/api/workflows` |
| `/connect` | Authenticated | SaaS & Cloud integration connectors | `GET /api/ephemeral-workers/connectors` |
| `/policies` | Authenticated | OPA Rego policy editor & simulation | `GET /api/policies`, `POST /api/policies/simulate` |
| `/risk` | Authenticated | Red-teaming simulations & risk metrics | `GET /api/red-team` |
| `/evidence` | Authenticated | SOC 2 / GDPR evidence records repository | `GET /api/evidence` |
| `/findings` | Authenticated | Security & compliance findings drawer | `GET /api/findings` |
| `/aws` | Authenticated | AWS resource connector & scanner | `GET /api/aws/status` |
| `/settings` | Authenticated | Users, invites, API keys, usage limits | `GET /api/users`, `GET /api/api-keys` |

---

## 8. Authentication Integration

### 8.1 Mechanism & Token Flow
1. **Login:** User submits credentials at [`console/src/app/login/page.tsx`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/login/page.tsx). The BFF route [`console/src/app/api/auth/login/route.ts`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/api/auth/login/route.ts) forwards to FastAPI `POST /v1/auth/login`.
2. **Session Token:** FastAPI validates credentials against PostgreSQL and generates an opaque session token prefixed with `acl_session_` (or API key prefixed with `acl_live_`).
3. **Cookie Storage:** The BFF sets an HTTP-only, SameSite=Lax cookie named `authclaw_session` (valid for 24 hours).
4. **Principal Validation:** Server components and BFF handlers read this cookie via `cookies().get("authclaw_session")` and validate it against `GET /v1/auth/me`.
5. **No Separate ITSM Authentication:** ITSM pages will reside inside the `(console)` route group and will automatically receive this authenticated session context without any new login flows.

---

## 9. Authorization & RBAC Integration

### 9.1 Platform Roles
Defined in [`backend/app/core/auth.py:L76-L80`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/core/auth.py#L76-L80):
- `owner`: Full administrative control across all tenant resources.
- `admin`: Operational administrator (can configure policies, connectors, gateways, approve changes).
- `developer`: Engineering member (can view telemetry, trigger scans, run red-team simulations).
- `operator`: Operations member (can view dashboard, inspect findings, manage remediation workflows).
- `viewer`: Read-only access to governance overview, audit trails, and evidence.

### 9.2 Scopes
- `read`: Read-only queries.
- `write`: Modifying resources (findings, connectors, tickets).
- `admin`: Destructive operations, credential rotations, policy activations.
- `platform.admin`: Cross-tenant system administration.

### 9.3 Enforcement in Frontend & Backend
- **Frontend:** `<ConsoleShell>` filters navigation links using `item.roles.includes(normalizedRole)`. Action buttons (e.g., Approve / Reject in `ApprovalsPage`) check `canDecide = role === "owner" || role === "admin"`.
- **Backend:** Fast-fail FastAPI dependencies:
  - `require_roles(["owner", "admin"])`
  - `require_scopes(["read", "write"])`
  - `require_platform_admin()`

---

## 10. Backend/API Architecture

- **Framework:** FastAPI running under Python 3.14 (`uvicorn main:app --port 8000`).
- **Entry Point:** [`backend/main.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/main.py).
- **Prefix Conventions:** Canonical routes are registered under `/v1/...` with backwards-compatibility aliases registered under `/api/v1/...`.
- **BFF Proxying:** The Next.js BFF catch-all route [`console/src/app/api/[...path]/route.ts`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/api/[...path]/route.ts) maps client requests to the backend using the strict whitelist regex defined in [`console/src/lib/bff-routes.ts`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/lib/bff-routes.ts).
- **Proposed ITSM Location:** ITSM endpoints will logically live in `backend/app/api/v1/endpoints/itsm.py` (or submodules `itsm_tickets.py`, `itsm_changes.py`), registered in `backend/main.py` under prefix `/v1/itsm`.

---

## 11. PostgreSQL Integration & Database Architecture

- **Engine & Version:** PostgreSQL 17 running on port `5432` (`authclaw-full-postgres`).
- **ORM:** SQLAlchemy 2.0 with Psycopg 3 driver (`postgresql+psycopg://`).
- **Schemas:** 3 distinct schemas created in PostgreSQL:
  1. `public`: Core relational tables (`tenants`, `users`, `findings`, `evidence_records`, `compliance_workflows`, `access_requests`, `rag_corpus_chunks`).
  2. `authn`: Cryptographic authentication helper functions (`bind_session_context`, `bind_api_key_context`).
  3. `agent`: LangGraph state tables (`chat_messages`, `agent_events`, `approval_audit_events`).
- **Migrations:** Alembic migrations located in [`backend/alembic/versions/`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/alembic/versions) (32 revisions currently active). All table alterations are strictly revision-controlled.

---

## 12. RLS & Multi-Tenant Isolation

### 12.1 Cryptographic Context Binding
AuthClaw implements defense-in-depth tenant isolation:
1. `AuthMiddleware` in [`backend/app/core/auth.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/core/auth.py#L123-L144) hashes the incoming credential and executes the PostgreSQL stored function:
   ```sql
   SELECT credential_id, tenant_id, scopes, user_id, role, platform_role, user_is_active, tenant_status 
   FROM authn.bind_session_context(:credential_hash);
   ```
2. The database session dependency `get_tenant_db` sets PostgreSQL session state:
   ```sql
   SET LOCAL app.current_tenant_id = :tenant_id;
   ```
3. PostgreSQL Row Level Security (RLS) policies automatically enforce that queries cannot access rows where `tenant_id != current_setting('app.current_tenant_id')`.
4. **ITSM Application:** All new ITSM tables (`itsm_tickets`, `itsm_changes`, `itsm_sla_policies`) must include `tenant_id: UUID` with foreign key referencing `tenants(id)` and RLS policies enabled.

---

## 13. ClickHouse & Tamper-Evident Audit Integration

- **ClickHouse Cluster:** ClickHouse Server 24 running on port `8123` (HTTP) / `9000` (Native) (`authclaw-full-clickhouse`).
- **Database & Tables:**
  ```
  authclaw
  ├── audit_events          (ReplacingMergeTree partitioned by toYYYYMM(timestamp), ORDER BY (tenant_id, tenant_sequence))
  ├── audit_events_daily    (SummingMergeTree for daily aggregates)
  └── audit_events_daily_mv (Materialized view)
  ```
- **Write Path:**
  1. Transactional backend writes state changes to PostgreSQL table `audit_outbox` within the same ACID transaction as the business entity.
  2. Outbox publisher pushes the canonical JSON payload to Kafka / Redpanda topic `audit.events`.
  3. The `audit_consumer` service validates SHA-256 hash chains (`prior_hash`, `integrity_hash`) and performs batch insertion into ClickHouse.
- **ITSM Audit Requirement:** All ITSM ticket status changes, high-impact configuration modifications, and approval events will emit audit events via `event_backbone.audit_event()`, guaranteeing immutable SOC 2 audit readiness.

---

## 14. AI Gateway Integration

- **Service & Port:** Go-based AI Reverse Proxy running on port `8080` (`authclaw-full-gateway`).
- **Interception Path:** The Gateway terminates client calls, redacts PII/PHI via Microsoft Presidio (`port 3000`), verifies policies via Open Policy Agent (`port 8181`), logs traffic to Kafka, and proxies to upstream providers (OpenAI, Anthropic, Bedrock, Azure OpenAI).
- **ITSM Agent Connectivity:** When ITSM AI agents (e.g., ticket summarization, automated categorization, remediation suggestion) call LLMs, they **must not connect directly to external OpenAI/Anthropic APIs**. They must route all prompts through the AuthClaw Gateway (`http://localhost:8080/v1/chat/completions`) using the tenant's gateway credentials.

---

## 15. Agent Runtime & HITL Integration

- **Engine:** LangGraph orchestrator inside [`services/agent/`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/services/agent) running on port `8001`.
- **Human-in-the-Loop (HITL) Workflow:**
  1. Agent proposes an action (e.g., modify firewall, grant IAM privilege, restart a degraded service).
  2. An approval record is created in `pending_approvals` with status `PENDING` and a 30-minute time-to-live (`expires_at`).
  3. The item appears in the console at [`/approvals`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/(console)/approvals/page.tsx).
  4. An operator with `admin` or `owner` role reviews the action. High-consequence decisions trigger `<MfaChallengeModal>` requiring a TOTP code.
  5. On approval, the backend triggers execution via `remediation_runtime.py` and records an immutable record in `approval_audit`.
- **ITSM Change Management:** ITSM Emergency Changes and High-Risk Service Requests will reuse this exact HITL approval engine.

---

## 16. Existing Search Architecture

- **Global Console Search:** **NOT FOUND IN CURRENT REPOSITORY**. There is no universal top-bar or Cmd+K search mechanism.
- **In-Page Tabular Search:** Localized client/server filters implemented in `/audit`, `/findings`, and `/evidence` using URL query parameters (`actor_id`, `framework`, `severity`, `status`).
- **Regulatory RAG Search:**
  - Endpoint: `GET /api/v1/rag/search?q={query}&limit=5` in [`backend/app/api/v1/endpoints/rag.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/api/v1/endpoints/rag.py#L34-L49).
  - Algorithm: Deterministic TF-IDF / BM25 token-matching retriever over regulatory chunks in PostgreSQL (`rag_corpus_chunks`).
- **ITSM Search Recommendation:** ITSM should follow the established pattern:
  1. Tabular query search for tickets (filtering by ticket ID, title, status, priority, requester).
  2. Reuse the RAG retriever pattern for grounding ITSM knowledge-base search in standard operating procedures (SOPs).

---

## 17. Existing UI Design System

AuthClaw uses a clean, modern design language:

| UI Element | Design Specification / Code Evidence |
| :--- | :--- |
| **Typography** | Headings: `Space Grotesk`, Body: `Inter` ([`globals.css:L35-L46`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/globals.css#L35-L46)) |
| **Card Container** | `bg-white rounded-[20px] border border-[#E6E9F0] shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)] p-6` |
| **Primary Button** | `bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold px-3.5 py-2 rounded-[10px] transition` |
| **Secondary / Ghost Button** | `bg-white border border-[#E6E9F0] text-[#475069] hover:bg-[#F5F7FA] text-xs font-medium px-3 py-2 rounded-[10px]` |
| **Input & Select Fields** | `bg-white border border-[#E6E9F0] text-[#0E1726] text-xs rounded-lg px-3 py-2 focus:ring-1 focus:ring-[#6D28D9]` |
| **Status Badges** | Derived via `statusConfig(status)` in [`ui-format.ts:L16-L32`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/lib/ui-format.ts#L16-L32):<br>• `OPEN` / `CRITICAL`: `bg-red-500/15 text-red-400 border-red-500/30`<br>• `IN_PROGRESS` / `ACKNOWLEDGED`: `bg-blue-500/15 text-blue-400 border-blue-500/30`<br>• `AWAITING_APPROVAL`: `bg-yellow-500/15 text-yellow-400 border-yellow-500/30`<br>• `RESOLVED`: `bg-emerald-500/15 text-emerald-400 border-emerald-500/30` |
| **Modals** | Wrapped with `<ModalShell>` ([`console/src/components/modal-shell.tsx`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/components/modal-shell.tsx)) featuring backdrop blur and centered dialog. |
| **MFA Gate** | `<MfaChallengeModal>` ([`console/src/components/mfa-challenge-modal.tsx`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/components/mfa-challenge-modal.tsx)) for TOTP entry before executing sensitive operations. |

---

## 18. Recommended ITSM Integration Point

### Analysis of Architectural Options

#### Option A: Dedicated Top-Level Sidebar Entry inside Existing Console Shell (RECOMMENDED)
- **Concept:** Add **"Service Desk"** (or **"ITSM"**) to the `navigation` array in [`console-shell.tsx`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/components/console-shell.tsx#L35-L49), with icon `LifeBuoy` or `TicketCheck` from `lucide-react`.
- **Route:** Grouped under `console/src/app/(console)/itsm/` with nested sub-pages:
  - `/itsm` — ITSM Overview & SLA Dashboard
  - `/itsm/tickets` — Incident & Service Request Management
  - `/itsm/changes` — Change Requests & RFC Approvals
  - `/itsm/services` — Service Catalog
  - `/itsm/knowledge` — Knowledge Base & Remediation SOPs
- **Pros:** 100% compliant with existing architecture; reuses `<ConsoleShell>`, layout authentication gate, user profile, notification bell, tenant switcher, and mobile drawer without any destructive modifications.
- **Cons:** Adds an extra item to the sidebar navigation.

#### Option B: Sub-module inside "Agent & Remediation" (`/agent/itsm`)
- **Concept:** Embed ITSM within the existing LangGraph agent page.
- **Evaluation:** **REJECTED**. The `/agent` page is specialized for interactive chat with a scanning/remediation agent. Nesting complete ticketing and SLA workflows inside it conflates AI scanning with ITIL service management.

#### Option C: Product Switcher / Multi-Application Workspace
- **Concept:** Add a top-level dropdown allowing users to switch between "AI Governance" and "ITSM".
- **Evaluation:** **REJECTED FOR PHASE 3**. Requires major visual redesign of `ConsoleShell`, introduces unnecessary navigation layers, and contradicts the requirement to integrate into the existing product without redesigning it.

### Final Recommendation
**Option A is selected.** It preserves the exact layout and authentication flow of AuthClaw while giving ITSM a clear, professional home.

---

## 19. Existing vs New Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             AUTHCLAW PLATFORM                               │
├──────────────────────────────────────┬──────────────────────────────────────┤
│          EXISTING / REUSE            │               NEW ITSM               │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Next.js 16 Console Shell & Layout   │ • ITSM Console Pages (/itsm/*)       │
│ • Session Cookie Auth (Bearer token) │ • ITSM Ticket & SLA Schema / Tables  │
│ • PostgreSQL Multi-Tenancy (RLS)     │ • ITSM FastAPI Endpoints (/v1/itsm/*)│
│ • FastAPI Backend Router & DI        │ • Next.js BFF Routes (/api/itsm/*)   │
│ • Kafka + ClickHouse Audit Pipeline  │ • ITSM State Transitions & SLAs      │
│ • Go AI Gateway (Redaction + OPA)    │ • ITSM Agent Prompts & Categorizer   │
│ • LangGraph Agent Runtime (HITL/MFA) │ • ITSM Service Catalog Definitions   │
│ • Design System (Colors, Fonts, CSS) │ • Ticket Detail & Conversation View  │
│ • ModalShell & FilterSelect Widgets  │ • Incident Severity Metric Cards     │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## 20. Design Decisions Required

1. **Sidebar Labeling:** Should the sidebar entry be named **"Service Desk"**, **"ITSM"**, or **"Tickets & Incidents"**? *(Recommendation: "Service Desk" is standard and intuitive).*
2. **Access Role Defaults:** Which roles can create vs resolve tickets? *(Recommendation: `viewer` and `developer` can create/view; `operator`, `admin`, and `owner` can triage and resolve).*
3. **HITL Change Approval Threshold:** What criteria escalate an ITSM ticket to require MFA-gated approval? *(Recommendation: Any Change Request with risk `HIGH` or `CRITICAL`, or actions affecting production cloud infrastructure).*
4. **Knowledge Base Storage:** Should ITSM SOPs reuse the existing `rag_corpus_chunks` table or live in a dedicated `itsm_knowledge_articles` table? *(Recommendation: Dedicated `itsm_knowledge_articles` table with foreign key to tenant, searchable via the existing TF-IDF / BM25 service).*

---

## 21. Phase 3.2 Recommendations

In **Phase 3.2 (ITSM Domain & Data Architecture)**:
1. **Design the Relational Schema:** Define SQLAlchemy models for:
   - `itsm_tickets` (Incident, Problem, Service Request)
   - `itsm_ticket_comments` (Internal notes vs requester communications)
   - `itsm_change_requests` (RFCs, risk levels, rollback plans)
   - `itsm_sla_policies` (Response/resolution targets by priority)
2. **Alembic Migration Plan:** Draft Migration `033_add_itsm_tables.py` ensuring all tables include `tenant_id` and PostgreSQL RLS policies matching revision `001-032` conventions.
3. **HITL Integration Bridge:** Define the schema mapping between `itsm_change_requests` and `pending_approvals`.
4. **BFF Routing Specs:** Specify the regex entries to add to `console/src/lib/bff-routes.ts`.

---

## 22. Evidence / File References

- **Console Layout & Session Gate:** [`console/src/app/(console)/layout.tsx:L1-L27`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/(console)/layout.tsx#L1-L27)
- **Console Shell & Navigation Definition:** [`console/src/components/console-shell.tsx:L33-L93`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/components/console-shell.tsx#L33-L93)
- **BFF Route Whitelist:** [`console/src/lib/bff-routes.ts:L4-L37`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/lib/bff-routes.ts#L4-L37)
- **BFF Proxy Client:** [`console/src/lib/api-client.ts:L38-L105`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/lib/api-client.ts#L38-L105)
- **UI Formatters & Status Styles:** [`console/src/lib/ui-format.ts:L1-L60`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/lib/ui-format.ts#L1-L60)
- **Global Theme & Color Tokens:** [`console/src/app/globals.css:L1-L100`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/globals.css#L1-L100)
- **Backend Entry & Router Inclusions:** [`backend/main.py:L70-L140`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/main.py#L70-L140)
- **AuthMiddleware & Tenant Session Resolver:** [`backend/app/core/auth.py:L82-L210`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/core/auth.py#L82-L210)
- **Dual-Write Audit Store Sync:** [`backend/app/services/audit_store.py:L1-L60`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/services/audit_store.py#L1-L60)
- **HITL Approval Engine & MFA Gate:** [`services/agent/approval_store.py:L1-L60`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/services/agent/approval_store.py#L1-L60)
- **AI Gateway Chi Router:** [`gateway/main.go:L45-L75`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/gateway/main.go#L45-L75)
- **ClickHouse Schema Definitions:** [`infra/clickhouse/init.sql:L1-L60`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/infra/clickhouse/init.sql#L1-L60)

---

## PHASE 3.1 CONCLUSION

### 1. Where should ITSM appear inside AuthClaw?
ITSM should appear inside the **authenticated operator console** ([`console/src/app/(console)`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/(console))) under the route path `/itsm` (with sub-pages for `/itsm/tickets`, `/itsm/changes`, `/itsm/services`, and `/itsm/knowledge`).

### 2. Which existing frontend structure should ITSM reuse?
ITSM will directly reuse:
- The authenticated layout gate ([`console/src/app/(console)/layout.tsx`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/app/(console)/layout.tsx)).
- The `<ConsoleShell>` responsive wrapper with header, breadcrumbs, notification bell, and user profile dropdown ([`console/src/components/console-shell.tsx`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/components/console-shell.tsx)).
- Next.js BFF proxy pipeline ([`console/src/lib/api-client.ts`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/lib/api-client.ts)).
- Reusable UI widgets: `<ModalShell>`, `<FilterSelect>`, `<MfaChallengeModal>`, and status formatting from `ui-format.ts`.

### 3. Which existing navigation should ITSM extend?
ITSM will extend the `navigation` array in [`console/src/components/console-shell.tsx:L35-L49`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/console/src/components/console-shell.tsx#L35-L49) by adding a new item:
```ts
{ name: "Service Desk", href: "/itsm", icon: LifeBuoy, roles: readRoles }
```

### 4. Which existing authentication should ITSM reuse?
ITSM will reuse the standard AuthClaw cookie-based session authentication (`authclaw_session` cookie containing an `acl_session_*` token) validated via `GET /v1/auth/me`. No new login pages or session managers will be introduced.

### 5. Which existing authorization should ITSM reuse?
ITSM will reuse:
- Frontend role filtering (`owner`, `admin`, `developer`, `operator`, `viewer`).
- Backend dependency decorators: `require_roles(...)`, `require_scopes(...)`, and `get_tenant_db`.

### 6. Which existing backend pattern should ITSM follow?
ITSM backend routes will follow the established FastAPI pattern:
- Route module in `backend/app/api/v1/endpoints/itsm.py`.
- Inclusion in [`backend/main.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/main.py) under prefix `/v1/itsm`.
- Pydantic v2 schemas for request validation and response serialization.
- Dependency injection with `db: Session = Depends(get_tenant_db)` to guarantee RLS context.

### 7. Which existing database architecture should ITSM reuse?
ITSM will store its transactional data in **PostgreSQL 17** (`authclaw` database, `public` schema), managed via Alembic migrations (`backend/alembic/versions`), using standard UUID primary keys and mandatory `tenant_id` foreign keys with Row Level Security enabled.

### 8. Which existing audit infrastructure should ITSM reuse?
ITSM will reuse the **dual-write audit pipeline**:
- In PostgreSQL: Writing to `audit_outbox`.
- In Streaming/Analytics: Publishing through Kafka topic `audit.events` to ClickHouse table `authclaw.audit_events` with SHA-256 hash chaining via `event_backbone.audit_event()`.

### 9. Which existing AI infrastructure should ITSM reuse?
ITSM will reuse:
- **AI Gateway (port 8080):** For all LLM requests with automatic Presidio PII redaction and OPA policy evaluation.
- **Agent Runtime (port 8001):** For LangGraph background agents, ticket triage, and automated remediation.
- **HITL Engine (`approval_store.py`):** For requiring human operator review and MFA confirmation on consequential changes.

### 10. What needs to be newly built for ITSM?
- **Data Models:** Relational tables for tickets, ticket comments, change requests, and SLA policies.
- **Backend APIs:** REST endpoints for ticket lifecycle management, SLA evaluation, and service catalog.
- **Frontend Pages:** Console views under `/itsm` (Overview, Tickets, Changes, Catalog).
- **BFF Endpoints:** Whitelist entries in `bff-routes.ts` or dedicated routes in `console/src/app/api/itsm`.

### 11. What decisions remain unresolved?
- Exact sidebar title (`"Service Desk"` vs `"ITSM"`).
- Escalation thresholds for triggering MFA-gated HITL approvals on changes.
- Whether knowledge-base articles share the regulatory RAG corpus table or use a dedicated tenant table.

### 12. What should be done in Phase 3.2?
- Design the complete relational data architecture and schemas for ITSM.
- Draft the Alembic migration specification (`033_add_itsm_tables.py`).
- Formulate the state transition machine for tickets (Open -> In Progress -> Awaiting Approval -> Resolved -> Closed).
- Specify the SLA calculation engine and breach detection triggers.
