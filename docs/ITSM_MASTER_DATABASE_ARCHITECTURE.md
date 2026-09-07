# AuthClaw ITSM Master Database Architecture & Implementation Specification

> **Status:** IMPLEMENTED AND VERIFIED  
> **Alembic Revisions:** `043` (MVP) $\to$ `044` (V1) $\to$ `045` (V1.5) $\to$ `046` (V2)  
> **Database Version:** PostgreSQL 17.2  
> **Tenant Isolation:** Native PostgreSQL Row Level Security (RLS) via `authn.current_tenant_id()`  
> **AuthClaw Pre-existing DB State:** 100% READ-ONLY (Zero modifications to migrations `001`–`042` or existing tables)

---

## 1. Executive Summary

This document serves as the authoritative, permanent reference for the AuthClaw IT Service Management (ITSM) multi-tenant database layer. Covering the entire product lifecycle from **MVP through V2**, this architecture provides a unified, highly governed foundation natively integrated into the existing AuthClaw enterprise platform without creating a separate database or modifying existing AuthClaw schema objects.

### Core Architectural Guarantees
1. **Strict AuthClaw Immutability:** Existing AuthClaw tables (`tenants`, `users`, `pending_approvals`, `policies`, `audit_log_metadata`, etc.) and migrations (`001`–`042`) were treated as strictly read-only.
2. **Linear Alembic Continuity:** New migrations continue linearly from `042`:
   - `043`: ITSM MVP Foundation (12 tables)
   - `044`: ITSM V1 Foundation (5 tables)
   - `045`: ITSM V1.5 Foundation (8 tables)
   - `046`: ITSM V2 Foundation (5 tables)
3. **Hard Multi-Tenant Isolation:** Every ITSM table contains a `tenant_id` foreign key referencing `tenants(id)` with `ON DELETE CASCADE`. Row Level Security (RLS) is enabled and forced (`FORCE ROW LEVEL SECURITY`) with `tenant_id = authn.current_tenant_id()`.
4. **Least-Privilege Role Separation:**
   - `authclaw_migrator`: DDL ownership and Alembic migrations.
   - `authclaw_app`: Full CRUD on ITSM domain entities (`SELECT, INSERT, UPDATE, DELETE`).
   - `authclaw_agent_runtime`: Strictly bounded access (`SELECT` on ITSM tables, `INSERT` on `itsm_ticket_activities`, `UPDATE` only on AI triage columns of `itsm_tickets`, no access to billing or security tables).

---

## 2. Table Inventory by Release

| Release | Table Name | Description | Key Constraints & Indexes |
| :--- | :--- | :--- | :--- |
| **MVP** | `itsm_business_calendars` | Business hours & holidays for SLAs | Unique(`tenant_id`, `name`) |
| **MVP** | `itsm_services` | Service portfolio & tiers | Unique(`tenant_id`, `slug`) |
| **MVP** | `itsm_ticket_categories` | Hierarchical category taxonomy | Unique(`tenant_id`, `code`), Self FK |
| **MVP** | `itsm_sla_policies` | Response & resolution SLA targets | Composite lookup index |
| **MVP** | `itsm_ticket_counters` | Concurrency-safe ticket numbering | Unique(`tenant_id`, `ticket_type`) |
| **MVP** | `itsm_tickets` | Incidents, Problems, & Requests | Unique(`tenant_id`, `ticket_number`), RLS |
| **MVP** | `itsm_ticket_activities` | Ticket audit trail & conversation history | Indexed by (`tenant_id`, `ticket_id`) |
| **MVP** | `itsm_service_catalog_items` | Catalog request templates & intake schema | Unique(`tenant_id`, `slug`) |
| **MVP** | `itsm_service_request_details` | Snapshot of schema & submitted data | Unique(`tenant_id`, `ticket_id`) |
| **MVP** | `itsm_knowledge_articles` | Knowledge base article metadata | Unique(`tenant_id`, `slug`) |
| **MVP** | `itsm_knowledge_article_versions`| Immutable revisions of KB articles | Unique(`tenant_id`, `article_id`, `version_number`) |
| **MVP** | `itsm_configuration_items` | Configuration Items (CMDB assets) | Indexed by (`tenant_id`, `service_id`, `ci_type`) |
| **V1** | `itsm_change_requests` | Change management & CAB tracking | Unique(`tenant_id`, `change_number`), FK to `pending_approvals` |
| **V1** | `itsm_change_request_cis` | Normalized Change $\leftrightarrow$ CI join | Unique(`tenant_id`, `change_id`, `ci_id`) |
| **V1** | `itsm_service_relationships` | Directed acyclic service graph | Unique(`tenant_id`, `parent_id`, `child_id`), Check `parent != child` |
| **V1** | `itsm_attachments` | Secure file attachments & quarantine | Indexed by (`tenant_id`, `target_type`, `target_id`) |
| **V1** | `itsm_problem_details` | Root cause, known error, & RCA | Unique(`tenant_id`, `ticket_id`) |
| **V1.5** | `itsm_major_incidents` | Incident commander, bridge, postmortem | Unique(`tenant_id`, `ticket_id`) |
| **V1.5** | `itsm_oncall_schedules` | Service on-call calendars | Unique(`tenant_id`, `name`) |
| **V1.5** | `itsm_oncall_rotations` | Multi-tier rotation schedules | Unique(`tenant_id`, `schedule_id`, `tier_level`) |
| **V1.5** | `itsm_oncall_overrides` | Temporary shift substitution overrides | Time-range index |
| **V1.5** | `itsm_agent_sessions` | Agent decision traces (NO raw CoT) | Indexed by (`tenant_id`, `ticket_id`), FK to `pending_approvals` |
| **V1.5** | `itsm_workflows` | Visual workflow automation templates | Unique(`tenant_id`, `slug`) |
| **V1.5** | `itsm_workflow_versions` | Immutable DAG workflow definitions | Unique(`tenant_id`, `workflow_id`, `version_number`) |
| **V1.5** | `itsm_workflow_executions` | Workflow runtime execution instances | Indexed by status and pending approval |
| **V2** | `itsm_event_rules` | Alert correlation & routing rules | Priority ordered index |
| **V2** | `itsm_ingested_events` | Alert storm deduplication store | Unique(`tenant_id`, `fingerprint`) |
| **V2** | `itsm_integration_configs` | Jira, ServiceNow, PagerDuty connectors | Unique(`tenant_id`, `name`) |
| **V2** | `itsm_integration_sync_records` | Bi-directional sync audit & retry queue | Indexed by entity and sync status |
| **V2** | `itsm_proactive_remediations` | Governed remediation with rollback | Pre/post checks, rollback plan, FK to `pending_approvals` |

---

## 3. Detailed Entity Specifications

### 3.1 MVP Entities (Migration 043)

#### `itsm_business_calendars`
- **Purpose:** Stores business operating schedules and holiday calendars for SLA calculation engines.
- **Columns:**
  - `id`: UUID (PK, default `gen_random_uuid()`)
  - `tenant_id`: UUID (FK $\to$ `tenants.id`, CASCADE, NOT NULL)
  - `name`: VARCHAR(255) NOT NULL
  - `timezone`: VARCHAR(50) NOT NULL DEFAULT `'UTC'`
  - `weekly_hours`: JSONB NOT NULL
  - `holidays`: JSONB NOT NULL DEFAULT `'[]'::jsonb`
  - `is_default`: BOOLEAN NOT NULL DEFAULT FALSE
  - `created_at` / `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT `now()`
- **Constraints:** `UNIQUE(tenant_id, name)`

#### `itsm_services`
- **Purpose:** Technical and business service definitions constituting the Service Portfolio.
- **Columns:**
  - `id`: UUID (PK)
  - `tenant_id`: UUID (FK $\to$ `tenants.id`, CASCADE, NOT NULL)
  - `name`: VARCHAR(255) NOT NULL
  - `slug`: VARCHAR(100) NOT NULL
  - `description`: TEXT NULL
  - `tier`: VARCHAR(20) NOT NULL DEFAULT `'TIER_2'`
  - `status`: VARCHAR(32) NOT NULL DEFAULT `'OPERATIONAL'`
  - `owner_user_id`: UUID (FK $\to$ `users.id`, SET NULL)
  - `escalation_team`: VARCHAR(100) NULL
  - `created_at` / `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT `now()`
- **Constraints:** `UNIQUE(tenant_id, slug)`

#### `itsm_tickets`
- **Purpose:** Core ITSM work record supporting Incidents, Problems, and Service Requests.
- **Columns:**
  - `id`: UUID (PK)
  - `tenant_id`: UUID (FK $\to$ `tenants.id`, CASCADE, NOT NULL)
  - `ticket_number`: VARCHAR(32) NOT NULL
  - `ticket_type`: VARCHAR(32) NOT NULL (`INCIDENT`, `PROBLEM`, `SERVICE_REQUEST`)
  - `title`: VARCHAR(512) NOT NULL
  - `description`: TEXT NOT NULL
  - `impact`: VARCHAR(20) NOT NULL DEFAULT `'MEDIUM'`
  - `urgency`: VARCHAR(20) NOT NULL DEFAULT `'MEDIUM'`
  - `priority`: VARCHAR(20) NOT NULL DEFAULT `'P3'`
  - `status`: VARCHAR(32) NOT NULL DEFAULT `'NEW'`
  - `status_reason`: TEXT NULL
  - `source_channel`: VARCHAR(50) NOT NULL DEFAULT `'PORTAL'`
  - `requester_id`: UUID (FK $\to$ `users.id`, RESTRICT, NOT NULL)
  - `assignee_id`: UUID (FK $\to$ `users.id`, SET NULL)
  - `assignment_group`: VARCHAR(100) NULL
  - `service_id`: UUID (FK $\to$ `itsm_services.id`, SET NULL)
  - `category_id`: UUID (FK $\to$ `itsm_ticket_categories.id`, SET NULL)
  - `category`: VARCHAR(100) NOT NULL DEFAULT `'GENERAL'`
  - `subcategory`: VARCHAR(100) NULL
  - `is_major_incident`: BOOLEAN NOT NULL DEFAULT FALSE
  - `linked_problem_id`: UUID (FK $\to$ `itsm_tickets.id`, SET NULL)
  - `linked_finding_id`: UUID (FK $\to$ `findings.id`, SET NULL)
  - `sla_policy_id`: UUID (FK $\to$ `itsm_sla_policies.id`, SET NULL)
  - `sla_response_due_at`: TIMESTAMPTZ NULL
  - `sla_response_met_at`: TIMESTAMPTZ NULL
  - `sla_resolution_due_at`: TIMESTAMPTZ NULL
  - `sla_resolution_met_at`: TIMESTAMPTZ NULL
  - `sla_status`: VARCHAR(20) NOT NULL DEFAULT `'WITHIN_SLA'`
  - `sla_paused_at`: TIMESTAMPTZ NULL
  - `sla_accumulated_pause_seconds`: INTEGER NOT NULL DEFAULT 0
  - `resolution_code`: VARCHAR(50) NULL
  - `resolution_summary`: TEXT NULL
  - `resolved_at` / `closed_at`: TIMESTAMPTZ NULL
  - `closed_by`: UUID (FK $\to$ `users.id`, SET NULL)
  - `ai_triaged`: BOOLEAN NOT NULL DEFAULT FALSE
  - `ai_suggested_priority`: VARCHAR(20) NULL
  - `ai_confidence_score`: FLOAT NULL
  - `ai_summary`: TEXT NULL
  - `created_at` / `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT `now()`
- **Constraints:** `UNIQUE(tenant_id, ticket_number)`

#### `itsm_service_catalog_items` & `itsm_service_request_details`
- **Purpose:** Versioned request catalog items and immutable submitted form data snapshots.
- **Key Fields in `itsm_service_request_details`:**
  - `catalog_item_version`: INTEGER NOT NULL
  - `intake_schema_snapshot`: JSONB NOT NULL (freezes schema at time of submission)
  - `submitted_form_data`: JSONB NOT NULL (freezes user responses)

---

### 3.2 V1 Entities (Migration 044)

#### `itsm_change_requests`
- **Purpose:** Change governance, CAB reviews, risk evaluation, and planning windows.
- **Linkage:** Reuses `pending_approvals.id` via nullable FK for seamless HITL integration.

#### `itsm_change_request_cis`
- **Purpose:** Fully normalized many-to-many join between Change Requests and Configuration Items.
- **Constraints:** `UNIQUE(tenant_id, change_id, ci_id)`

#### `itsm_service_relationships`
- **Purpose:** Topological dependency graph between services.
- **Constraints:**
  - `UNIQUE(tenant_id, parent_service_id, child_service_id)`
  - `CHECK(parent_service_id != child_service_id)` (prevents self-referencing cycles)

#### `itsm_attachments`
- **Purpose:** Universal, quarantined file attachment registry for tickets, changes, problems, and articles.
- **Security Attributes:** `checksum_sha256`, `is_quarantined`, `quarantine_reason`, `file_size_bytes`, `mime_type`.

#### `itsm_problem_details`
- **Purpose:** Root Cause Analysis (RCA) and Known Error Database (KEDB) attached to problem tickets.

---

### 3.3 V1.5 Entities (Migration 045)

#### `itsm_major_incidents`
- **Purpose:** Major incident response coordination, incident commander assignment, and bridge management.

#### `itsm_oncall_schedules`, `itsm_oncall_rotations`, `itsm_oncall_overrides`
- **Purpose:** Multi-tiered paging rotations (primary, secondary, escalation manager) with shift overrides.

#### `itsm_agent_sessions`
- **Purpose:** Safe AI reasoning logs.
- **Safety Requirement:** Stores high-level decision summaries, evidence artifacts, and action proposals; STRICTLY EXCLUDES raw chain-of-thought tokens. Links to `pending_approvals.id` when human sign-off is needed.

#### `itsm_workflows`, `itsm_workflow_versions`, `itsm_workflow_executions`
- **Purpose:** Visual ITSM automation DAG builder with immutable versioning and execution audit.

---

### 3.4 V2 Entities (Migration 046)

#### `itsm_ingested_events`
- **Purpose:** High-throughput alert ingestion and deduplication engine for alert storm control.
- **Deduplication:** Enforces `UNIQUE(tenant_id, fingerprint)`, enabling atomic occurrence counter increments.

#### `itsm_proactive_remediations`
- **Purpose:** Autonomous and semi-autonomous remediation execution.
- **Governance Gate:** Enforces pre-check validation, execution tracking, post-check verification, rollback plan registration, and optional human approval gating via `pending_approvals`.

---

## 4. Row Level Security & Access Control

All 30 ITSM tables enforce tenant isolation at the PostgreSQL engine level:

```sql
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.<table_name> FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.<table_name> FOR ALL
    USING (tenant_id = authn.current_tenant_id())
    WITH CHECK (tenant_id = authn.current_tenant_id());
```

### Role Grants Matrix

| Role | ITSM Tables Access | Special Privileges | Constraints |
| :--- | :--- | :--- | :--- |
| `authclaw_migrator` | Owner / DDL Full | Migration execution, schema management | Cannot be bypassed by runtime queries |
| `authclaw_app` | `SELECT, INSERT, UPDATE, DELETE` | Full CRUD on all 30 ITSM tables | Bounded by RLS `authn.current_tenant_id()` |
| `authclaw_agent_runtime` | `SELECT` on all 30 tables | `INSERT` on `itsm_ticket_activities`<br>`UPDATE (ai_*)` on `itsm_tickets`<br>`INSERT, UPDATE` on `itsm_agent_sessions`, `itsm_ingested_events`, `itsm_proactive_remediations` | CANNOT delete tickets; CANNOT insert/update core security or billing tables |

---

## 5. Verification & Test Suite Summary

The test suite (`backend/tests/test_itsm_database.py`) was executed inside the live container environment with **13 out of 13 tests passing**:

```
Ran 13 tests in 0.977s
OK
```

### Verified Test Cases:
1. `test_tenant_isolation_reads`: Tenant A cannot see Tenant B's tickets or services.
2. `test_cross_tenant_insert_prevented`: Tenant A cannot insert rows into Tenant B.
3. `test_service_graph_acyclic_and_no_self_ref`: `ck_itsm_service_rel_no_self_ref` prevents self-referencing loops.
4. `test_attachment_quarantine_and_metadata`: Verifies SHA-256 checksums and quarantine reasons.
5. `test_change_ci_normalized_relationship`: Validates normalized join table and prevents duplicates.
6. `test_service_catalog_version_snapshot`: Verifies that request submissions freeze the version schema and submitted form data.
7. `test_knowledge_article_versioning`: Validates multi-version immutable revisions under parent articles.
8. `test_ticket_numbering_concurrency`: Proves sequential, gap-free, atomic ticket number generation (`INC-000001`, `INC-000002`, ...).
9. `test_agent_runtime_least_privilege`: Validates PostgreSQL permission boundaries for `authclaw_agent_runtime`.
10. `test_change_approval_linkage`: Proves clean foreign key integration with `pending_approvals`.
11. `test_audit_event_emission`: Proves integration with the existing AuthClaw immutable audit pipeline (`audit_log_metadata` and `audit_outbox`).
12. `test_event_deduplication`: Verifies SHA-256 fingerprint collision prevention and alert aggregation.
13. `test_proactive_remediation_governance`: Verifies remediation lifecycle, pre/post checks, and rollback safety.

---

## 6. Migration Reversibility & Upgrade Verification

The migration sequence was validated using full rollback and re-upgrade:
- Baseline: `alembic current` $\to$ `042`
- Upgrade to head: `alembic upgrade head` $\to$ `046 (head)` (30 ITSM tables created)
- Downgrade to baseline: `alembic downgrade 042` $\to$ `042` (0 residual tables)
- Re-upgrade to head: `alembic upgrade head` $\to$ `046 (head)` (30 tables recreated cleanly)

**DATABASE IMPLEMENTATION STATUS: READY FOR MVP BACKEND IMPLEMENTATION**
