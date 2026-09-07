# PHASE 3.2 — ITSM DOMAIN & DATABASE ARCHITECTURE DESIGN
## Comprehensive Technical Blueprint for AuthClaw IT Service Management

**Status:** ARCHITECTURE DESIGN COMPLETE  
**Source of Truth Repository:** `AuthClaw_Align-master`  
**Target Environment:** PostgreSQL 17, SQLAlchemy 2.0, Alembic (Revision 042+), Next.js 16 App Router  
**Design Phase:** Non-Destructive Inspection & Architecture Design Only (Zero Code, Table, or Migration Mutations Executed)  

---

## 1. Executive Summary

Phase 3.2 establishes the complete domain and database architecture for integrating enterprise **ITSM (IT Service Management)** directly into the existing AuthClaw platform. 

AuthClaw is a multi-tenant AI governance platform with verified cryptographic session handling, tenant-bound Row Level Security (RLS) in PostgreSQL 17, dual-write tamper-evident audit trails (Kafka + ClickHouse), an in-line Go AI Gateway, and a LangGraph Agent Runtime with MFA-gated human-in-the-loop (HITL) approval workflows.

### Architectural Core Principles
1. **Single Platform Integration:** ITSM is **not** a separate product, second database, or isolated microservice. It is a native domain module inside AuthClaw that shares the `authclaw` PostgreSQL 17 database, the existing Next.js operator console, and the FastAPI control plane.
2. **Strict Platform Infrastructure Reuse:**
   - **PostgreSQL 17 Multi-Tenancy:** All ITSM tables reside in the `public` schema, strictly isolated by PostgreSQL Row Level Security (RLS) driven by `authn.bind_session_context(:credential_hash)` and `app.current_tenant_id`.
   - **HITL Approval Engine:** Change Requests do **not** introduce a redundant approval system. They link directly to the existing `pending_approvals` table and leverage `<MfaChallengeModal>` for high-risk operations.
   - **Tamper-Evident Auditing:** All ITSM state changes, SLA breaches, and approvals write to `audit_outbox` and stream through Kafka to ClickHouse MergeTree tables with SHA-256 cryptographic hash chains.
   - **AI Gateway & LangGraph:** ITSM AI agents execute via the existing LangGraph Agent Runtime (`port 8001`) and route all model invocations through the AuthClaw Go Gateway (`port 8080`) for automatic Presidio PII/PHI redaction and OPA policy evaluation.
3. **Migration Lineage:** Direct inspection of `backend/alembic/versions/` confirms the latest active migration is **`042_make_session_binding_read_only.py`**. The proposed ITSM migration sequence begins strictly at **`043`**.

---

## 2. Existing Database Architecture Reviewed

### 2.1 Engine & Connection Architecture
- **Engine:** PostgreSQL 17 (`authclaw-full-postgres` container on port `5432`).
- **ORM & Driver:** SQLAlchemy 2.0 with Psycopg 3 (`postgresql+psycopg://`).
- **Database Name:** `authclaw`.
- **Database Schemas:**
  - `public`: Business entities (`tenants`, `users`, `findings`, `evidence_records`, `compliance_workflows`, `notifications`).
  - `authn`: Cryptographic session binding and credential validation routines (`authn.bind_session_context`, `authn.bind_api_key_context`).
  - `agent`: LangGraph state tables (`chat_messages`, `agent_events`, `approval_audit_events`).

### 2.2 Verified Model & Column Conventions
Direct inspection of [`backend/app/db/models.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/db/models.py) reveals exact conventions that ITSM models must follow:
- **Primary Keys:** UUID v4 generated on both server and database: `Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)`.
- **Tenant Isolation:** Mandatory `tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)`.
- **Timestamps:** Timezone-aware UTC timestamps:
  - `created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)`
  - `updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)`
- **Enums:** Python `enum.Enum` mapped to SQLAlchemy `Enum(..., native_enum=False, create_constraint=True)` or `String(50)` with `CheckConstraint` (e.g., [`DataSubjectRequest`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/db/models.py#L71-L105)), preventing brittle native PostgreSQL enum alter migrations.
- **Foreign Keys:** Explicit table and column targets (e.g., `ForeignKey("users.id")`, `ForeignKey("tenants.id")`).
- **Soft Deletes:** AuthClaw uses explicit status flags (e.g., `status = "CANCELLED"`, `status = "ARCHIVED"`, `revoked_at = DateTime`) rather than global soft-delete mixins, preserving referential integrity and audit compliance.

### 2.3 Verified Existing Approval Architecture
The existing human-in-the-loop approval mechanism is defined in [`backend/app/db/models.py:L488-L543`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/db/models.py#L488-L543):
- **`pending_approvals`**: Tracks actionable items with `action_id`, `action_type`, `action_payload`, `action_hash`, `status` (`PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CONSUMED`), `expires_at` (30-minute default TTL), and `mfa_verified`.
- **`approval_audit`**: Immutable log of decisions with `actor_id`, `action`, `reason`, and `mfa_timestamp`.
- **ITSM Direct Fit:** Change requests requiring approvals will register a record in `pending_approvals`, exposing it immediately to the `/approvals` UI with no duplicate approval engine needed.

---

## 3. ITSM Domain Model

The ITSM domain integrates ITIL service management workflows with AuthClaw's security, compliance, and AI governance capabilities:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             AUTHCLAW ITSM DOMAIN                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Service Desk & Tickets      : Incidents, Service Requests, Problems     │
│  2. Service Level Management    : SLA Policies, Target Timers, Breach Alerts│
│  3. Change Enablement           : RFCs, Risk Assessment, HITL/MFA Approvals│
│  4. Service Configuration (CMDB): Business Services, CIs, Dependencies     │
│  5. Knowledge Management        : Tenant SOPs, Grounding for Triage Agents  │
│  6. Activity & Attachments      : Public Comments, Internal Notes, S3 Files │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Entity Inclusion & Phasing Matrix

| Entity | Purpose | Classification | Reuse vs Dedicated | Phase |
| :--- | :--- | :--- | :--- | :--- |
| **`itsm_tickets`** | Core tracking for Incidents, Service Requests, Problems | Core Domain | **Dedicated** ITSM table | MVP |
| **`itsm_ticket_activities`** | Threaded comments, internal notes, audit transitions | Core Activity | **Dedicated** ITSM table | MVP |
| **`itsm_sla_policies`** | SLA definitions by priority, response, and resolution targets | Service Level | **Dedicated** ITSM table | MVP |
| **`itsm_services`** | Business services impacted by tickets and changes | Service Catalog | **Dedicated** ITSM table | MVP |
| **`pending_approvals`** | Human approval gate with MFA verification | Security/HITL | **REUSE** existing AuthClaw table | MVP / V1 |
| **`notifications`** | In-app notification bell and email notifications | Alerting | **REUSE** existing AuthClaw table | MVP / V1 |
| **`itsm_change_requests`** | Change management (RFCs, rollback, planned windows) | Change Enablement | **Dedicated** ITSM table linked to `pending_approvals` | V1 |
| **`itsm_attachments`** | Document and screenshot uploads | Storage | **Dedicated** metadata table pointing to S3 | V1 |
| **`itsm_knowledge_articles`**| SOPs, troubleshooting guides, runbooks | Knowledge | **Dedicated** tenant table with RAG retriever | V1.5 |
| **`itsm_configuration_items`**| Granular infrastructure CIs (APIs, DBs, models) | CMDB | **Dedicated** table linked to `cloud_connectors` | V2 |
| **`itsm_service_relationships`| Directed dependency graph between services | CMDB Graph | **Dedicated** self-referential relationship table | V2 |

---

## 4. Ticket Architecture

### 4.1 Evaluation of Architectural Alternatives

#### Option A: Separate Tables (`itsm_incidents`, `itsm_service_requests`, `itsm_problems`)
- *Pros:* Highly normalized, specialized columns per type.
- *Cons:* Triples table count, requires fragmented `UNION` queries for unified dashboards, makes unified SLA tracking and cross-type activity streams cumbersome.

#### Option B: Single Common Ticket Table with Type Field (RECOMMENDED)
- *Pros:* 
  - 90% of attributes across Incidents, Requests, and Problems are identical (`ticket_number`, `tenant_id`, `title`, `description`, `priority`, `status`, `requester_id`, `assignee_id`, `service_id`).
  - High-performance unified filtering in the console (e.g., "All open tickets assigned to me").
  - Universal activity timeline and unified SLA calculation engine.
- *Cons:* Slightly wider table with type-conditional attributes (e.g., `incident_source` vs `request_catalog_id`).
- *Mitigation:* Clean database constraints ensure type-specific required fields are enforced.

#### Option C: Class Table Inheritance (Common Table + Extension Tables)
- *Pros:* Keeps core slim and allows arbitrary subclass fields.
- *Cons:* Requires perpetual multi-table joins on every list and read operation, degrading query performance under high load.

### 4.2 Recommended Ticket Entity Schema Concept

```sql
-- Conceptual DDL: itsm_tickets
CREATE TABLE public.itsm_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    ticket_number VARCHAR(32) NOT NULL, -- e.g., "INC-10042", "REQ-10089", "PRB-10012"
    ticket_type VARCHAR(32) NOT NULL,   -- 'INCIDENT', 'SERVICE_REQUEST', 'PROBLEM'
    
    title VARCHAR(512) NOT NULL,
    description TEXT NOT NULL,
    
    -- ITIL Priority Matrix
    impact VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',   -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    urgency VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',  -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    priority VARCHAR(20) NOT NULL DEFAULT 'P3',     -- 'P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW'
    
    -- Lifecycle State
    status VARCHAR(32) NOT NULL DEFAULT 'NEW',      -- See State Machine below
    status_reason TEXT NULL,
    
    -- Ownership & Assignment
    requester_id UUID NOT NULL REFERENCES public.users(id),
    assignee_id UUID NULL REFERENCES public.users(id),
    assignment_group VARCHAR(100) NULL,             -- e.g., 'SecOps', 'DevOps', 'IT Support'
    
    -- Service Context
    service_id UUID NULL REFERENCES public.itsm_services(id),
    category VARCHAR(100) NOT NULL DEFAULT 'GENERAL',
    subcategory VARCHAR(100) NULL,
    
    -- Operational Flags
    is_major_incident BOOLEAN NOT NULL DEFAULT FALSE,
    linked_problem_id UUID NULL REFERENCES public.itsm_tickets(id),
    linked_finding_id UUID NULL REFERENCES public.findings(id), -- Direct link to AuthClaw findings!
    
    -- SLA Tracking Cache (Denormalized for zero-join dashboard performance)
    sla_policy_id UUID NULL REFERENCES public.itsm_sla_policies(id),
    sla_response_due_at TIMESTAMPTZ NULL,
    sla_response_met_at TIMESTAMPTZ NULL,
    sla_resolution_due_at TIMESTAMPTZ NULL,
    sla_resolution_met_at TIMESTAMPTZ NULL,
    sla_status VARCHAR(20) NOT NULL DEFAULT 'WITHIN_SLA', -- 'WITHIN_SLA', 'WARNING', 'BREACHED'
    sla_paused_at TIMESTAMPTZ NULL,
    sla_accumulated_pause_seconds INTEGER NOT NULL DEFAULT 0,
    
    -- Closure & Resolution
    resolution_code VARCHAR(50) NULL,               -- 'SOLVED_WORKAROUND', 'SOLVED_PERMANENT', 'NOT_AN_ISSUE', 'DUPLICATE'
    resolution_summary TEXT NULL,
    resolved_at TIMESTAMPTZ NULL,
    closed_at TIMESTAMPTZ NULL,
    closed_by UUID NULL REFERENCES public.users(id),
    
    -- AI Triage Metadata
    ai_triaged BOOLEAN NOT NULL DEFAULT FALSE,
    ai_suggested_priority VARCHAR(20) NULL,
    ai_confidence_score FLOAT NULL,
    ai_summary TEXT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Constraints & High-Performance Indexes
CREATE UNIQUE INDEX uq_itsm_tickets_tenant_number ON public.itsm_tickets(tenant_id, ticket_number);
CREATE INDEX idx_itsm_tickets_tenant_status ON public.itsm_tickets(tenant_id, status);
CREATE INDEX idx_itsm_tickets_tenant_assignee ON public.itsm_tickets(tenant_id, assignee_id);
CREATE INDEX idx_itsm_tickets_tenant_priority ON public.itsm_tickets(tenant_id, priority);
CREATE INDEX idx_itsm_tickets_tenant_created ON public.itsm_tickets(tenant_id, created_at DESC);
CREATE INDEX idx_itsm_tickets_sla_breach ON public.itsm_tickets(tenant_id, sla_status, sla_resolution_due_at) 
    WHERE status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED');
```

---

## 5. Ticket State Machine

The ticket state machine enforces strict transition integrity, unambiguous audit recording, and precise SLA timer control:

```
                  ┌──────────────┐
                  │     NEW      │
                  └──────┬───────┘
                         │ (Triage / Assign)
                         ▼
                  ┌──────────────┐
       ┌─────────►│   ASSIGNED   │◄──────────────┐
       │          └──────┬───────┘               │
       │                 │ (Start Work)          │
       │                 ▼                       │
       │          ┌──────────────┐               │
       │   ┌─────►│ IN_PROGRESS  │◄─────────┐    │
       │   │      └──────┬───────┘          │    │
       │   │ (Resume)    │                  │    │
       │   │             │ (Awaiting Input) │    │
       │   │             ▼                  │    │
       │   │      ┌──────────────┐          │    │
       │   └──────┤   PENDING    ├──────────┘    │
       │          └──────┬───────┘               │
       │                 │ (Resolve)             │
       │                 ▼                       │
       │          ┌──────────────┐               │
       │          │   RESOLVED   │               │
       │          └──────┬───────┘               │
       │ (Reopen)        │ (Confirm / TTL)       │
       └─────────────────┼──────────────┐        │
                         ▼              ▼        │
                  ┌──────────────┐ ┌──────────┐  │
                  │    CLOSED    │ │CANCELLED │──┘
                  └──────────────┘ └──────────┘
```

### State Transition & SLA Clock Matrix

| From State | Allowed To State | Trigger / Actor | SLA Response Clock | SLA Resolution Clock | Verification / Condition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`NEW`** | `ASSIGNED` | Operator / Agent / AI | **Stops** (Met) | Running | Assignee or group populated |
| **`NEW`** | `IN_PROGRESS` | Operator / Admin | **Stops** (Met) | Running | Immediate diagnosis start |
| **`NEW`** | `CANCELLED` | Requester / Operator | **Stops** (Exempt) | **Stops** (Exempt) | Reason required |
| **`ASSIGNED`** | `IN_PROGRESS` | Assignee | Stopped | Running | Work started |
| **`ASSIGNED`** | `CANCELLED` | Requester / Operator | Stopped | **Stops** (Exempt) | Reason required |
| **`IN_PROGRESS`** | `PENDING` | Assignee / System | Stopped | **PAUSED** | Sub-status required (`PENDING_CUSTOMER`, `PENDING_VENDOR`, `PENDING_CHANGE`) |
| **`IN_PROGRESS`** | `RESOLVED` | Assignee / Admin | Stopped | **Stops** (Met) | `resolution_code` & `resolution_summary` required |
| **`PENDING`** | `IN_PROGRESS` | Requester Reply / Agent | Stopped | **RESUMES** | SLA deadline extended by accumulated pause seconds |
| **`PENDING`** | `RESOLVED` | Assignee | Stopped | **Stops** (Met) | Resolution details provided |
| **`RESOLVED`** | `CLOSED` | Requester Confirm / TTL | Stopped | Stopped | 5-day automated closure timer expires |
| **`RESOLVED`** | `IN_PROGRESS` | Requester Dispute | Stopped | **RESUMES** | Allowed within 5 days of resolution; reopens SLA |
| **`CLOSED`** | *None (Terminal)* | Terminal State | Stopped | Stopped | Reopening disabled; new ticket must be referenced |
| **`CANCELLED`**| *None (Terminal)* | Terminal State | Stopped | Stopped | Reopening disabled |

---

## 6. SLA Data Model & Calculation Architecture

### 6.1 SLA Architecture Strategy
- **SLA Policy Definition:** Tenant-configurable targets defined in `itsm_sla_policies`.
- **Active Ticket Cache:** Target deadlines (`sla_response_due_at`, `sla_resolution_due_at`) and breach states (`sla_status`) are calculated upon creation and cached directly on the `itsm_tickets` record.
- **Why this hybrid approach?** It avoids executing expensive recursive calendar joins on every dashboard render. A background worker periodically inspects active tickets approaching deadlines to issue warnings and breach alerts.

### 6.2 Conceptual Schema

```sql
-- Conceptual DDL: itsm_sla_policies
CREATE TABLE public.itsm_sla_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    
    ticket_type VARCHAR(32) NOT NULL DEFAULT 'INCIDENT',
    priority VARCHAR(20) NOT NULL, -- 'P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW'
    
    response_target_minutes INTEGER NOT NULL,    -- e.g. P1 = 15, P2 = 60, P3 = 240, P4 = 480
    resolution_target_minutes INTEGER NOT NULL,  -- e.g. P1 = 120, P2 = 480, P3 = 1440, P4 = 4320
    warning_threshold_percent INTEGER NOT NULL DEFAULT 80, -- Trigger warning at 80% elapsed
    
    calendar_type VARCHAR(50) NOT NULL DEFAULT '24x7', -- '24x7' or 'BUSINESS_HOURS_9X5'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX uq_itsm_sla_tenant_type_priority ON public.itsm_sla_policies(tenant_id, ticket_type, priority);
CREATE INDEX idx_itsm_sla_tenant ON public.itsm_sla_policies(tenant_id);
```

### 6.3 SLA Pause & Resume Logic
When an incident is waiting on external input (e.g., requester details or hardware vendor replacement):
1. State changes to `PENDING`. Backend sets `sla_paused_at = clock_timestamp()`.
2. While `status = 'PENDING'`, background breach detectors skip the ticket.
3. When the customer responds or the vendor delivers, state changes back to `IN_PROGRESS`.
4. Backend calculates `paused_duration = clock_timestamp() - sla_paused_at`.
5. `sla_accumulated_pause_seconds += paused_duration`.
6. `sla_resolution_due_at = sla_resolution_due_at + paused_duration`.
7. `sla_paused_at = NULL`.

---

## 7. Change Management Architecture

Change Management governs consequential IT infrastructure, policy, and configuration modifications. To avoid redundant governance layers, **ITSM Change Requests integrate directly with AuthClaw's verified HITL approval system** ([`PendingApproval`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/db/models.py#L488-L521)):

```
ITSM Change Request Created (DRAFT -> SUBMITTED)
                     │
                     ▼
          Risk & Impact Assessment
                     │
        ┌────────────┴────────────┐
        │                         │
Standard / Low Risk      Normal / High / Emergency
(Pre-Approved)           (Requires Human Governance)
        │                         │
        │                         ▼
        │             Register AuthClaw Record:
        │             pending_approvals.create(
        │                 action_type="itsm_change_request",
        │                 action_payload={change_id, diff, plan},
        │                 expires_at=now() + 30_min
        │             )
        │                         │
        │                         ▼
        │             Appears on Operator Console:
        │             /approvals UI Queue
        │                         │
        │                         ▼
        │             Operator Approval Decision:
        │             [Requires MFA / TOTP for Critical]
        │                         │
        │            ┌────────────┴────────────┐
        │            ▼                         ▼
        │        APPROVED                   REJECTED
        │            │                         │
        ▼            ▼                         ▼
      SCHEDULED / IMPLEMENTING              REJECTED / CLOSED
                     │
                     ▼
        Execution & Validation Result
                     │
                     ▼
      Dual-Write to audit_outbox & ClickHouse
```

### 7.1 Conceptual Change Request Schema

```sql
-- Conceptual DDL: itsm_change_requests
CREATE TABLE public.itsm_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    change_number VARCHAR(32) NOT NULL, -- e.g. "CHG-10021"
    
    title VARCHAR(512) NOT NULL,
    description TEXT NOT NULL,
    justification TEXT NOT NULL,
    
    change_type VARCHAR(32) NOT NULL, -- 'STANDARD', 'NORMAL', 'EMERGENCY'
    risk_level VARCHAR(20) NOT NULL,  -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    impact_level VARCHAR(20) NOT NULL,-- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    
    -- Service Context
    service_id UUID NULL REFERENCES public.itsm_services(id),
    affected_ci_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    
    -- Planning & Governance Plans
    implementation_plan TEXT NOT NULL,
    rollback_plan TEXT NOT NULL,
    test_validation_plan TEXT NOT NULL,
    
    -- Scheduling
    planned_start_at TIMESTAMPTZ NOT NULL,
    planned_end_at TIMESTAMPTZ NOT NULL,
    actual_start_at TIMESTAMPTZ NULL,
    actual_end_at TIMESTAMPTZ NULL,
    
    -- Lifecycle State
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', 
    -- 'DRAFT', 'SUBMITTED', 'AWAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 
    -- 'IMPLEMENTING', 'COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK'
    
    -- DIRECT INTEGRATION TO EXISTING AUTHCLAW APPROVAL SYSTEM!
    approval_id UUID NULL REFERENCES public.pending_approvals(id) ON DELETE SET NULL,
    approval_decision_at TIMESTAMPTZ NULL,
    approval_notes TEXT NULL,
    
    -- Execution Record
    requester_id UUID NOT NULL REFERENCES public.users(id),
    implementer_id UUID NULL REFERENCES public.users(id),
    execution_result JSONB NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX uq_itsm_change_tenant_number ON public.itsm_change_requests(tenant_id, change_number);
CREATE INDEX idx_itsm_change_tenant_status ON public.itsm_change_requests(tenant_id, status);
CREATE INDEX idx_itsm_change_approval ON public.itsm_change_requests(approval_id);
```

---

## 8. CMDB & Service Architecture

Rather than introducing an external graph database, AuthClaw's relational PostgreSQL engine is fully capable of modeling enterprise service hierarchies and CI dependencies:

```sql
-- Conceptual DDL: itsm_services (Business & Application Services)
CREATE TABLE public.itsm_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT NULL,
    
    tier VARCHAR(20) NOT NULL DEFAULT 'TIER_2', -- 'TIER_1_CRITICAL', 'TIER_2_CORE', 'TIER_3_SUPPORT'
    status VARCHAR(32) NOT NULL DEFAULT 'OPERATIONAL', -- 'OPERATIONAL', 'DEGRADED', 'OUTAGE', 'MAINTENANCE'
    
    owner_user_id UUID NULL REFERENCES public.users(id),
    escalation_team VARCHAR(100) NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX uq_itsm_services_tenant_slug ON public.itsm_services(tenant_id, slug);
CREATE INDEX idx_itsm_services_tenant ON public.itsm_services(tenant_id);

-- Conceptual DDL: itsm_configuration_items (CIs)
CREATE TABLE public.itsm_configuration_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    service_id UUID NULL REFERENCES public.itsm_services(id) ON DELETE SET NULL,
    
    name VARCHAR(255) NOT NULL,
    ci_type VARCHAR(50) NOT NULL, -- 'API_GATEWAY', 'DATABASE', 'CLOUD_BUCKET', 'LAMBDA_FUNCTION', 'MODEL_ENDPOINT'
    environment VARCHAR(20) NOT NULL DEFAULT 'PRODUCTION', -- 'PRODUCTION', 'STAGING', 'DEVELOPMENT'
    
    -- Direct link to AuthClaw's verified cloud connectors!
    cloud_connector_id UUID NULL REFERENCES public.cloud_connectors(id) ON DELETE SET NULL,
    external_resource_id VARCHAR(512) NULL, -- e.g. AWS ARN, S3 bucket name
    
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_itsm_ci_tenant_service ON public.itsm_configuration_items(tenant_id, service_id);
CREATE INDEX idx_itsm_ci_type ON public.itsm_configuration_items(tenant_id, ci_type);

-- Conceptual DDL: itsm_service_relationships (Dependency Graph)
CREATE TABLE public.itsm_service_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    parent_service_id UUID NOT NULL REFERENCES public.itsm_services(id) ON DELETE CASCADE,
    child_service_id UUID NOT NULL REFERENCES public.itsm_services(id) ON DELETE CASCADE,
    
    relationship_type VARCHAR(50) NOT NULL DEFAULT 'DEPENDS_ON', -- 'DEPENDS_ON', 'RUNS_ON', 'REPLICATES_TO'
    impact_weight FLOAT NOT NULL DEFAULT 1.0,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    
    CONSTRAINT ck_no_self_relationship CHECK (parent_service_id != child_service_id)
);

CREATE UNIQUE INDEX uq_itsm_service_rel ON public.itsm_service_relationships(tenant_id, parent_service_id, child_service_id, relationship_type);
```

---

## 9. Knowledge Model Architecture

### 9.1 Architectural Evaluation: Dedicated vs Existing RAG Corpus
- **Existing `rag_corpus_versions` / `rag_corpus_chunks`:** Inspection of [`backend/app/db/models.py:L677-L721`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/db/models.py#L677-L721) reveals this table is a **global, non-tenant regulatory corpus** for GDPR, HIPAA, and SOC 2 articles. It lacks a `tenant_id` column by design.
- **Security Constraint:** Tenant-specific IT runbooks, incident post-mortems, and internal SOPs cannot share this global table without risking cross-tenant data exposure.
- **Recommended Hybrid Strategy:**
  1. Create a dedicated, tenant-isolated table: `itsm_knowledge_articles`.
  2. Reuse the **exact deterministic tokenization and BM25/TF-IDF retrieval algorithm** implemented in [`backend/app/rag/service.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/rag/service.py).
  3. Ground ITSM AI agents with tenant-filtered knowledge chunks without creating duplicate vector databases.

```sql
-- Conceptual DDL: itsm_knowledge_articles
CREATE TABLE public.itsm_knowledge_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    title VARCHAR(512) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    
    category VARCHAR(100) NOT NULL DEFAULT 'TROUBLESHOOTING',
    service_id UUID NULL REFERENCES public.itsm_services(id) ON DELETE SET NULL,
    
    content_markdown TEXT NOT NULL,
    summary TEXT NULL,
    keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'PUBLISHED', 'ARCHIVED'
    view_count INTEGER NOT NULL DEFAULT 0,
    helpful_count INTEGER NOT NULL DEFAULT 0,
    
    author_id UUID NOT NULL REFERENCES public.users(id),
    published_at TIMESTAMPTZ NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX uq_itsm_kb_tenant_slug ON public.itsm_knowledge_articles(tenant_id, slug);
CREATE INDEX idx_itsm_kb_tenant_status ON public.itsm_knowledge_articles(tenant_id, status);
CREATE INDEX idx_itsm_kb_service ON public.itsm_knowledge_articles(tenant_id, service_id);
```

---

## 10. Comments, Activity, and Attachments

```sql
-- Conceptual DDL: itsm_ticket_activities (Unified Activity Timeline)
CREATE TABLE public.itsm_ticket_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    ticket_id UUID NOT NULL REFERENCES public.itsm_tickets(id) ON DELETE CASCADE,
    
    activity_type VARCHAR(50) NOT NULL, 
    -- 'PUBLIC_COMMENT', 'INTERNAL_NOTE', 'STATUS_CHANGE', 
    -- 'ASSIGNMENT_CHANGE', 'PRIORITY_CHANGE', 'SLA_EVENT', 'AI_NOTE'
    
    actor_id UUID NULL REFERENCES public.users(id), -- Nullable for automated system/AI actions
    actor_type VARCHAR(32) NOT NULL DEFAULT 'USER',  -- 'USER', 'SYSTEM', 'AI_AGENT'
    
    content TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,    -- e.g. {"old_status": "NEW", "new_status": "ASSIGNED"}
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_itsm_activity_ticket ON public.itsm_ticket_activities(tenant_id, ticket_id, created_at ASC);

-- Conceptual DDL: itsm_attachments (Metadata for Uploaded Artifacts)
CREATE TABLE public.itsm_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    ticket_id UUID NOT NULL REFERENCES public.itsm_tickets(id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES public.users(id),
    
    file_name VARCHAR(512) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    
    storage_provider VARCHAR(50) NOT NULL DEFAULT 'S3', -- Uses verified AWSS3Document infrastructure
    s3_bucket VARCHAR(255) NULL,
    s3_object_key TEXT NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_itsm_attachments_ticket ON public.itsm_attachments(tenant_id, ticket_id);
```

---

## 11. Multi-Tenant & Row Level Security (RLS) Design

Following the proven architecture from Alembic revision `036_enforce_p0_resource_rls.py`, every ITSM table will be created with strict RLS policies bound to PostgreSQL's session state:

```sql
-- Template applied to ALL ITSM tables:
ALTER TABLE public.itsm_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itsm_tickets FORCE ROW LEVEL SECURITY;

CREATE POLICY itsm_tickets_tenant_isolation ON public.itsm_tickets
    FOR ALL
    USING (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid);
```

### Verified RLS Protection Properties
1. **Application User Restriction:** The application database role (`authclaw_app`) connects without superuser bypass.
2. **Context Binding:** In `backend/app/core/auth.py`, `get_tenant_db` sets `app.current_tenant_id = :tenant_id` inside each database transaction.
3. **Fail-Closed Security:** If `app.current_tenant_id` is empty or uninitialized, `nullif(...)` returns `NULL`, causing all queries to return zero rows.
4. **No Cross-Tenant Access:** Cross-tenant access is strictly impossible at the database engine level, even if an application SQL query omits the `WHERE tenant_id = ...` clause.

---

## 12. Authorization Boundaries & Permissions

ITSM operations map cleanly onto AuthClaw's existing role hierarchy:

| ITSM Action | Allowed Tenant Roles | Required Scope | Enforcing Mechanism |
| :--- | :--- | :--- | :--- |
| **Submit Incident / Request** | `viewer`, `developer`, `operator`, `admin`, `owner` | `write` | `require_roles(...)`, `require_scopes(["write"])` |
| **Add Public Comment** | `viewer`, `developer`, `operator`, `admin`, `owner` | `write` | Ticket requester or assigned team |
| **Add Internal Agent Note** | `operator`, `admin`, `owner` | `write` | `require_roles(["operator", "admin", "owner"])` |
| **Triage & Reassign Ticket** | `operator`, `admin`, `owner` | `write` | `require_roles(["operator", "admin", "owner"])` |
| **Resolve / Close Incident** | `operator`, `admin`, `owner` | `write` | `require_roles(["operator", "admin", "owner"])` |
| **Create Change Request** | `developer`, `operator`, `admin`, `owner` | `write` | RFC submission permission |
| **Approve / Reject Change** | `admin`, `owner` | `admin` | **Reuses `pending_approvals` gate + MFA** |
| **Configure SLA Policies** | `admin`, `owner` | `admin` | `require_roles(["admin", "owner"])` |
| **Publish Knowledge Article** | `operator`, `admin`, `owner` | `write` | Status transition to `PUBLISHED` |

---

## 13. Audit Integration (Dual-Write to ClickHouse)

ITSM introduces **zero duplicate audit tables**. All business-critical events are captured through the existing AuthClaw audit pipeline:

```
FastAPI ITSM Endpoint ──► Write Ticket / Change to PostgreSQL
                                │
                                ├─► ACID Insert into audit_outbox (PostgreSQL)
                                │          │
                                │          ▼
                                │   Kafka / Redpanda (audit.events)
                                │          │
                                │          ▼
                                │   audit_consumer (SHA-256 Hash Chain)
                                │          │
                                │          ▼
                                └──► ClickHouse: authclaw.audit_events
```

### Audited ITSM Event Inventory

| Event Identifier | Triggering Action | Emitted Payload Fields |
| :--- | :--- | :--- |
| `itsm.ticket.created` | New ticket logged | `ticket_id`, `ticket_number`, `type`, `priority`, `requester_id` |
| `itsm.ticket.status_changed` | State transition | `ticket_id`, `old_status`, `new_status`, `reason`, `actor_id` |
| `itsm.ticket.assigned` | Ticket reassigned | `ticket_id`, `old_assignee`, `new_assignee`, `group` |
| `itsm.ticket.resolved` | Resolution recorded | `ticket_id`, `resolution_code`, `duration_seconds`, `met_sla` |
| `itsm.sla.breached` | SLA deadline passed | `ticket_id`, `policy_id`, `breach_type` (response/resolution) |
| `itsm.change.submitted` | RFC submitted | `change_id`, `change_number`, `change_type`, `risk_level` |
| `itsm.change.approved` | Approver accepts | `approval_id`, `actor_id`, `mfa_verified`, `decision_reason` |
| `itsm.change.executed` | Implementation ran | `change_id`, `execution_status`, `rollback_triggered` |
| `itsm.ai.triage_applied` | Agent auto-classifies | `ticket_id`, `suggested_priority`, `confidence_score` |

---

## 14. AI & Agent Data Boundaries

All AI capabilities operate under strict read/write boundaries through AuthClaw's existing infrastructure:

```
ITSM UI ──► LangGraph Agent Runtime (:8001) ──► Go AI Gateway (:8080) ──► Model Provider
                     │                                   │
                     ▼                                   ▼
             Reads ITSM Schema                   Presidio Redacts PII
             & Knowledge Articles                OPA Checks Policies
```

### Agent Permission Boundaries

| Agent Persona | Readable Entities | Autonomous Write Permissions | Gated Actions (Requires HITL / MFA) |
| :--- | :--- | :--- | :--- |
| **Incident Triage Agent** | Ticket title, description, user, `itsm_services` | Writes `ai_suggested_priority`, category, tags, and summary into `ai_triage_metadata` | Cannot reassign without operator policy; cannot close tickets |
| **Incident Investigation Agent** | Ticket history, `findings`, `evidence_records`, `cloud_connectors` | Posts internal investigation note (`itsm_ticket_activities`) | Cannot alter cloud resources or security groups |
| **Remediation & Change Agent** | Ticket, affected CIs, rollback plans | Drafts `itsm_change_requests` record | **CANNOT EXECUTE CHANGES**. Must submit to `pending_approvals` for operator review |
| **Knowledge Grounding Agent** | `itsm_knowledge_articles`, regulatory RAG chunks | Synthesizes suggested answers for ticket comments | Cannot directly publish articles to customer |

---

## 15. Indexing & Performance Strategy

To guarantee sub-50ms API response times across high-volume tenants:

```
┌──────────────────────────────────────┬────────────────────────────────────────────────────────┐
│ High-Frequency Query Pattern         │ Targeted Index Implementation                          │
├──────────────────────────────────────┼────────────────────────────────────────────────────────┤
│ Active tickets by tenant & status    │ idx_itsm_tickets_tenant_status (tenant_id, status)     │
│ Tickets assigned to specific agent   │ idx_itsm_tickets_tenant_assignee (tenant_id, assignee) │
│ Open tickets nearing SLA breach      │ idx_itsm_tickets_sla_breach (tenant_id, sla_due_at)   │
│                                      │   WHERE status NOT IN ('RESOLVED', 'CLOSED')           │
│ Ticket activity stream (chronological│ idx_itsm_activity_ticket (tenant_id, ticket_id, time)  │
│ Change requests by approval status   │ idx_itsm_change_tenant_status (tenant_id, status)      │
│ Fast knowledge search by slug        │ uq_itsm_kb_tenant_slug (tenant_id, slug) UNIQUE        │
└──────────────────────────────────────┴────────────────────────────────────────────────────────┘
```

---

## 16. Data History & Retention Policy

- **Current Operational State:** Maintained in `itsm_tickets`, `itsm_change_requests`, and `itsm_services`.
- **Chronological Human Activity:** Maintained in `itsm_ticket_activities`.
- **Compliance Audit History:** Reuses the verified `audit_log_metadata` (PostgreSQL) and ClickHouse `audit_events` tables. No redundant ticket history shadow tables are created.
- **Data Retention & GDPR Purge:**
  - Standard tickets: Retained for 365 days after `closed_at`.
  - Inactive tickets older than retention window: An automated retention worker archives resolved payload hashes into ClickHouse cold storage and truncates user-identifiable text in accordance with GDPR Article 17 (Right to Erasure), adhering to the existing GDPR lifecycle in [`backend/app/services/privacy_lifecycle.py`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/services/privacy_lifecycle.py).

---

## 17. Proposed Alembic Migration Sequence

Direct verification of `backend/alembic/versions/` confirmed that migration `042` is the latest:
- **`042_make_session_binding_read_only.py`** (`revision = "042"`, `down_revision = "041"`).

Therefore, the ITSM migration sequence is planned as follows:

```
[042_make_session_binding_read_only.py]  (Existing Head)
                     │
                     ▼
[043_add_itsm_core_schema.py]            (down_revision = "042")
  • Creates itsm_services
  • Creates itsm_sla_policies
  • Creates itsm_tickets
  • Enforces RLS & grants permissions to authclaw_app
                     │
                     ▼
[044_add_itsm_activities_and_attachments.py] (down_revision = "043")
  • Creates itsm_ticket_activities
  • Creates itsm_attachments
  • Enforces RLS & grants permissions
                     │
                     ▼
[045_add_itsm_change_management.py]      (down_revision = "044")
  • Creates itsm_change_requests
  • Foreign key to pending_approvals
  • Enforces RLS & grants permissions
                     │
                     ▼
[046_add_itsm_knowledge_and_cmdb.py]     (down_revision = "045")
  • Creates itsm_knowledge_articles
  • Creates itsm_configuration_items
  • Creates itsm_service_relationships
  • Enforces RLS & grants permissions
```

*(Note: These files are **NOT** created in Phase 3.2. This defines the exact implementation sequence for subsequent engineering phases).*

---

## 18. Entity-Relationship Diagram (ERD)

```
Tenant (public.tenants)
  │
  ├──► itsm_services
  │      │
  │      ├──► itsm_service_relationships (self-referential)
  │      └──► itsm_configuration_items
  │             └──► cloud_connectors (Existing AuthClaw)
  │
  ├──► itsm_sla_policies
  │
  ├──► itsm_tickets
  │      ├──► itsm_ticket_activities
  │      ├──► itsm_attachments
  │      ├──► findings (Existing AuthClaw)
  │      └──► users (Requester / Assignee)
  │
  ├──► itsm_change_requests
  │      └──► pending_approvals (Existing AuthClaw HITL Engine!)
  │             └──► approval_audit (Existing AuthClaw Audit)
  │
  └──► itsm_knowledge_articles
```

---

## 19. Roadmap Mapping: MVP / V1 / V1.5 / V2

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MVP: Core Incident & Service Desk                                           │
│   • itsm_services (Core service catalog)                                    │
│   • itsm_tickets (Incidents & Requests)                                     │
│   • itsm_ticket_activities (Threaded discussion & internal notes)           │
│   • itsm_sla_policies (P1-P4 target tracking & breach warnings)             │
│   • Integration with existing notifications table                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ V1: Change Management & File Uploads                                        │
│   • itsm_change_requests (Standard, Normal, Emergency RFCs)                 │
│   • Direct link to pending_approvals & MFA execution modal                  │
│   • itsm_attachments (S3 document upload & integrity hashing)              │
│   • Dynamic SLA pause/resume on PENDING_CUSTOMER                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ V1.5: AI Triage & Tenant Knowledge Base                                     │
│   • itsm_knowledge_articles (Markdown articles & BM25 retrieval)            │
│   • LangGraph Incident Triage Agent (Priority & categorization suggestion)  │
│   • Automated Finding-to-Ticket conversion from findings table              │
├─────────────────────────────────────────────────────────────────────────────┤
│ V2: Advanced CMDB & Service Graph                                           │
│   • itsm_configuration_items (Granular cloud resource inventory)            │
│   • itsm_service_relationships (Dependency mapping & blast radius analysis) │
│   • Major Incident broadcast bridge                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 20. Architecture Alternatives Considered

1. **Standalone Microservice Database vs Shared Database:**
   - *Considered:* Deploying a dedicated PostgreSQL container for ITSM (`authclaw-itsm-db`).
   - *Rejected:* Destroys atomic transactions, requires distributed 2-phase commits, duplicates tenant/user tables, and complicates RLS context synchronization.
2. **Dedicated Approval Engine vs Reusing AuthClaw HITL Engine:**
   - *Considered:* Creating `itsm_change_approvals` table and custom approval UI.
   - *Rejected:* Violates core platform reuse requirement. AuthClaw's `pending_approvals` already supports expiration TTLs, MFA challenges, audit logging, and is already integrated into the operator console at `/approvals`.
3. **Third-Party Vector Database vs Hybrid BM25 Knowledge Retriever:**
   - *Considered:* Adding Pinecone or Qdrant for ITSM knowledge search.
   - *Rejected:* Introduces unnecessary operational dependencies and security boundaries. AuthClaw's verified BM25/TF-IDF retriever over PostgreSQL text columns provides deterministic, explainable grounding with zero additional infrastructure costs.

---

## 21. Open Decisions

1. **Ticket Number Format:** Should ticket numbering use a global sequence (`TICK-10001`) or tenant-prefixed sequence (`ACME-INC-101`)? *(Recommendation: Tenant-scoped sequential prefix `INC-1001` enforced by unique constraint `(tenant_id, ticket_number)`).*
2. **Customer Portal Route:** Will external end-users submit tickets through a public-facing portal or will all users log in to the console? *(Recommendation: In MVP, all users authenticate via `/login` and access `/itsm` based on role).*
3. **Automated Auto-Closure Window:** What is the inactivity duration before a `RESOLVED` ticket transitions automatically to `CLOSED`? *(Recommendation: Standard 120 hours / 5 business days).*

---

## 22. Phase 3.3 Recommendations

In **Phase 3.3 (Backend API & Service Layer Implementation)**:
1. Implement Pydantic v2 schemas in `backend/app/schemas/itsm.py`.
2. Implement SQLAlchemy ORM models in `backend/app/db/models.py`.
3. Draft and execute Alembic migration `043_add_itsm_core_schema.py`.
4. Implement service functions in `backend/app/services/itsm_service.py` with transactional outbox event emission.
5. Register FastAPI endpoint routes in `backend/app/api/v1/endpoints/itsm.py` under prefix `/v1/itsm`.

---

## 23. Evidence / File References

- **Active Alembic Migration Head:** [`backend/alembic/versions/042_make_session_binding_read_only.py:L1-L63`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/alembic/versions/042_make_session_binding_read_only.py#L1-L63)
- **RLS Policy Enforcement Pattern:** [`backend/alembic/versions/036_enforce_p0_resource_rls.py:L18-L53`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/alembic/versions/036_enforce_p0_resource_rls.py#L18-L53)
- **Verified Model Base & UUID Patterns:** [`backend/app/db/models.py:L1-L150`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/db/models.py#L1-L150)
- **Verified Approval & HITL Schema:** [`backend/app/db/models.py:L488-L543`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/db/models.py#L488-L543)
- **Audit Outbox & Hash Chain Schema:** [`backend/app/db/models.py:L545-L602`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/db/models.py#L545-L602)
- **Tenant Context Dependency Injection:** [`backend/app/core/auth.py:L211-L260`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/core/auth.py#L211-L260)
- **Regulatory Corpus & BM25 Retriever:** [`backend/app/rag/service.py:L1-L70`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/backend/app/rag/service.py#L1-L70)
- **ClickHouse ReplacingMergeTree Audit Schema:** [`infra/clickhouse/init.sql:L1-L60`](file:///c:/Users/ADMIN/Downloads/AuthClaw_Align-master/AuthClaw_Align-master/infra/clickhouse/init.sql#L1-L60)

---

**END PHASE 3.2 DESIGN SPECIFICATION**
