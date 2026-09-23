# Requester Portal Database Verification Report

**Date**: September 17, 2026  
**Project**: AuthClaw ITSM  
**Mode**: Read-Only Architecture & Database Verification  
**Status Tags Used**: `[VERIFIED]`, `[NOT VERIFIED]`, `[MISMATCH]`, `[NEEDS DECISION]`  

---

## 1. Executive Summary & Database / Schema Identification

* **Database Engine**: PostgreSQL 17 (Docker container `authclaw-full-postgres`) `[VERIFIED]`
* **Database Name**: `authclaw` `[VERIFIED]`
* **Database Schema**: `public` (Primary table storage) & `authn` (Authentication lookup functions & platform roles) `[VERIFIED]`
* **Source of Truth for ITSM Tickets**: `public.itsm_tickets` `[VERIFIED]`

---

## 2. Requester Portal Table Map & Schema Summary

| # | Requester Feature | Exact Table Name | Primary Key | Foreign Keys / Relationships | Key Columns Stored | Status |
|---|---|---|---|---|---|---|
| **1** | **Reported Issues & My Tickets** | `public.itsm_tickets` | `id` (UUID) | `tenant_id` -> `tenants.id`<br>`requester_id` -> `users.id`<br>`assignee_id` -> `users.id`<br>`service_id` -> `itsm_services.id`<br>`category_id` -> `itsm_ticket_categories.id`<br>`sla_policy_id` -> `itsm_sla_policies.id` | `ticket_number` (`INC-xxxxxx`), `ticket_type` (`INCIDENT`), `title`, `description`, `impact`, `urgency`, `priority`, `status` (`NEW`, `ASSIGNED`, `IN_PROGRESS`, `PENDING`, `RESOLVED`, `CLOSED`), `source_channel` (`PORTAL`), `category`, `subcategory`, `is_major_incident`, `created_at`, `updated_at` | `[VERIFIED]` |
| **2** | **Ticket Sequence Counter** | `public.itsm_ticket_counters` | `id` (UUID) | `tenant_id` -> `tenants.id` | `ticket_type` (`INCIDENT`), `prefix` (`INC`), `last_number` (e.g. `6`), `updated_at` | `[VERIFIED]` |
| **3** | **Ticket Activities & Timeline** | `public.itsm_ticket_activities` | `id` (UUID) | `tenant_id` -> `tenants.id`<br>`ticket_id` -> `itsm_tickets.id`<br>`actor_id` -> `users.id` | `activity_type` (`CREATED`, `COMMENT`, `STATUS_CHANGE`), `actor_type` (`USER`, `SYSTEM`), `content`, `metadata` (JSONB), `created_at` | `[VERIFIED]` |
| **4** | **Requester Notifications** | `public.notifications` | `id` (UUID) | `tenant_id` -> `tenants.id`<br>`user_id` -> `users.id` | `type` (`itsm.incident.created`, `itsm.incident.comment`), `severity` (`info`, `warning`, `critical`), `title`, `body`, `link` (`/itsm/incidents/{ticket_uuid}`), `read_at`, `created_at` | `[VERIFIED]` |
| **5** | **Requester Identity & Access** | `public.users`<br>& `public.itsm_user_access` | `id` (UUID) | `tenant_id` -> `tenants.id`<br>`user_id` -> `users.id` | `email` (`requester123@gmail.com`), `password_hash`, `role` (`viewer`), `itsm_role` (`REQUESTER`), `has_itsm_access` (`true`), `has_governance_access` (`false`) | `[VERIFIED]` |
| **6** | **Service Catalog** | `public.itsm_services`<br>& `public.itsm_service_catalog_items` | `id` (UUID) | `tenant_id` -> `tenants.id`<br>`service_id` -> `itsm_services.id` | `name`, `slug`, `description`, `category`, `fulfillment_group`, `estimated_delivery_hours`, `is_active` | `[VERIFIED]` |
| **7** | **Knowledge Base** | `public.itsm_knowledge_articles` | `id` (UUID) | `tenant_id` -> `tenants.id`<br>`author_id` -> `users.id` | `title`, `slug`, `category`, `summary`, `content`, `view_count`, `helpful_count`, `status` | `[VERIFIED]` |
| **8** | **Ticket Attachments** | N/A | N/A | N/A | **Table `public.attachments` does not exist in database.** File attachments are not currently persisted in PostgreSQL. | `[NOT VERIFIED]` |

---

## 3. Detailed Data Flow Trace (Requester → API → Database → Notification)

$$\text{Requester UI} \xrightarrow[\text{fetch("/api/itsm/incidents")}]{\text{POST /itsm/incidents/new}} \text{Next.js BFF} \xrightarrow[\text{POST /v1/itsm/incidents}]{\text{Bearer Token}} \text{FastAPI Endpoint} \xrightarrow{\text{IncidentService.create\_incident()}} \text{PostgreSQL DB} \xrightarrow{\text{create\_notification()}} \text{Notifications Table}$$

### Step-by-Step Data Flow:
1. **Requester Input**: User enters title, description, category, impact, and urgency on `/itsm/incidents/new`.
2. **API Router (`backend/app/api/v1/endpoints/itsm_incidents.py`)**:
   - Extracts `actor_id` from `request.state.user_id` and `tenant_id` from `get_current_tenant`.
   - Validates `urgency` field (returns HTTP 400 Bad Request if missing/invalid).
   - Resolves caller role via `_get_itsm_role(db, tenant_id, actor_id)`. If `REQUESTER`, forces `assignee_id = None`, `assignment_group = None`, `is_major_incident = False`.
3. **Domain Service (`backend/app/services/itsm_incident_service.py`)**:
   - `_validate_user_in_tenant()` verifies requester user existence and active status.
   - `generate_ticket_number()` atomically increments `last_number` in `public.itsm_ticket_counters` using `ON CONFLICT DO UPDATE RETURNING`.
   - Derives priority (`P1`-`P4`) from impact/urgency matrix or `calculate_priority_from_matrix()`.
   - Instantiates `ITSMTicket` model and inserts row into `public.itsm_tickets`.
   - Calls `_record_activity()` to insert initial `CREATED` record in `public.itsm_ticket_activities`.
   - Executes `db.commit()` to finalize PostgreSQL transaction. `[VERIFIED]`
4. **Notification Dispatch (`backend/app/services/notifications.py`)**:
   - Calls `create_notification()` to insert notification record into `public.notifications` with `type = "itsm.incident.created"` and `link = "/itsm/incidents/{ticket_id}"`. `[VERIFIED]`

---

## 4. Specific Record Verification (INC-000005 & INC-000006)

Direct read-only database query of PostgreSQL `authclaw` database produced the following verified records:

### Ticket INC-000005
* **Database Table**: `public.itsm_tickets` `[VERIFIED]`
* **Ticket ID (UUID)**: `cbbb8450-1be1-4988-ba66-efcad63b8844`
* **Tenant ID**: `11111111-1111-4111-8111-111111111111`
* **Ticket Number**: `INC-000005` (Stored in column `public.itsm_tickets.ticket_number`) `[VERIFIED]`
* **Title**: `System Monitor Flicker Issue`
* **Status / Priority**: `NEW` / `P1` (Impact: `HIGH`, Urgency: `HIGH`)
* **Requester ID**: `22222222-2222-4222-8222-222222222227` (`requester123@gmail.com`)
* **Created Timestamp**: `2026-09-15 12:27:26.565820+00`
* **Associated Notification**:
  * **Notification Table**: `public.notifications` `[VERIFIED]`
  * **Notification ID**: `b7a7cad6-d1a8-4417-899b-ce91efb41721`
  * **User ID**: `22222222-2222-4222-8222-222222222227`
  * **Type**: `itsm.incident.created`
  * **Title**: `Incident Created: INC-000005`
  * **Body**: `Your ticket 'System Monitor Flicker Issue' has been logged.`
  * **Link Reference**: `/itsm/incidents/cbbb8450-1be1-4988-ba66-efcad63b8844` (Matches exact ticket UUID) `[VERIFIED]`

### Ticket INC-000006
* **Database Table**: `public.itsm_tickets` `[VERIFIED]`
* **Ticket ID (UUID)**: `71441c3a-92a5-4de5-ac91-abe9c4fc00ad`
* **Tenant ID**: `11111111-1111-4111-8111-111111111111`
* **Ticket Number**: `INC-000006` (Stored in column `public.itsm_tickets.ticket_number`) `[VERIFIED]`
* **Title**: `my system moniter is not responding`
* **Status / Priority**: `NEW` / `P3` (Impact: `LOW`, Urgency: `HIGH`)
* **Requester ID**: `22222222-2222-4222-8222-222222222227` (`requester123@gmail.com`)
* **Created Timestamp**: `2026-09-16 12:23:02.910122+00`
* **Associated Notification**:
  * **Notification Table**: `public.notifications` `[VERIFIED]`
  * **Notification ID**: `d3665323-7273-49fe-91d2-dec4749ad966`
  * **User ID**: `22222222-2222-4222-8222-222222222227`
  * **Type**: `itsm.incident.created`
  * **Title**: `Incident Created: INC-000006`
  * **Body**: `Your ticket 'my system moniter is not responding' has been logged.`
  * **Link Reference**: `/itsm/incidents/71441c3a-92a5-4de5-ac91-abe9c4fc00ad` (Matches exact ticket UUID) `[VERIFIED]`

---

## 5. Verification of Source of Truth (`itsm_tickets`)

* **Is `public.itsm_tickets` the Source of Truth?** **YES** `[VERIFIED]`
* **Proof**:
  1. `IncidentService.create_incident()` inserts directly into `public.itsm_tickets`.
  2. `IncidentService.get_incident()` queries `public.itsm_tickets` by primary key `id`.
  3. `IncidentService.list_incidents()` queries `public.itsm_tickets` with filtering by `tenant_id` and `requester_id`.
  4. Sequence generator `public.itsm_ticket_counters` produces `ticket_number` which is persisted in `public.itsm_tickets.ticket_number`.

---

## 6. Requester Isolation & Security Verification

1. **Tenant Isolation**: `get_current_tenant` dependency enforces `tenant_id = request.state.tenant_id` across all queries. `[VERIFIED]`
2. **Requester Identity Scoping**:
   - In `backend/app/api/v1/endpoints/itsm_incidents.py`:
     - Role lookup function `_get_itsm_role(db, tenant_id, actor_id)` checks `authn.lookup_itsm_user_access()`.
     - When role is `"REQUESTER"`:
       - `list_incidents`: Overrides `requester_id = actor_id`. Requesters can only query their own tickets. `[VERIFIED]`
       - `get_incident`: Checks `str(incident.requester_id) != str(actor_id)`. If true, raises `HTTP 404 Not Found`, preventing ticket enumeration/probing. `[VERIFIED]`
       - `update_incident`, `change_incident_status`, `assign_incident`: Raises `HTTP 403 Forbidden` for `REQUESTER` role. `[VERIFIED]`
       - `list_incident_activities`: Filters out any timeline item where `is_internal = True`. `[VERIFIED]`

---

## 7. Mismatches, Risks & Architectural Findings

1. **Attachments Table Missing**:
   - **Finding**: Table `public.attachments` does NOT exist in PostgreSQL schema. `[NOT VERIFIED]`
   - **Risk**: File attachment uploads are not currently persisted in PostgreSQL.
2. **Activity Metadata Column Name**:
   - **Finding**: The SQLAlchemy model `ITSMTicketActivity` references JSONB column `metadata`, while backend activity creation code sets `activity_metadata`. `[MISMATCH]`
3. **Branch Sync**:
   - **Finding**: All requester isolation checks, notification triggers, and profile routes were implemented and verified in commit `5411680` on branch `requester`. `[VERIFIED]`

---

## 8. Inspected Files, Migrations & Code Reference

* `backend/alembic/versions/043_add_itsm_mvp_foundation.py` (Created `itsm_tickets`, `itsm_ticket_counters`, `itsm_ticket_activities`)
* `backend/alembic/versions/047_add_itsm_user_access.py` (Created `itsm_user_access`)
* `backend/app/db/models.py` (SQLAlchemy models for `ITSMTicket`, `ITSMTicketCounter`, `ITSMTicketActivity`, `Notification`, `User`)
* `backend/app/api/v1/endpoints/itsm_incidents.py` (FastAPI router endpoints with requester scoping)
* `backend/app/api/v1/endpoints/notifications.py` (Notification query router)
* `backend/app/services/itsm_incident_service.py` (Ticket creation, counter generation, activity recording)
* `backend/app/services/notifications.py` (Notification insertion helper)
* `console/src/app/(console)/itsm/incidents/page.tsx` (My Tickets UI)
* `console/src/app/(console)/itsm/incidents/new/page.tsx` (Report Issue UI)
* `console/src/app/(console)/itsm/incidents/[id]/page.tsx` (Ticket Details UI)
* `console/src/app/(console)/itsm/notifications/page.tsx` (Requester Notifications UI)
