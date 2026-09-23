# Requester Portal End-to-End Data Flow Verification Report

**Date**: September 17, 2026  
**Project**: AuthClaw ITSM Requester Portal  
**Mode**: READ-ONLY Architecture & Data Flow Investigation  
**Status Tags Used**: `[VERIFIED]`, `[MISMATCH]`, `[NOT VERIFIED]`, `[NEEDS DECISION]`  

---

## Executive Summary

This report presents a comprehensive, read-only end-to-end data flow verification of all 8 core features of the **AuthClaw ITSM Requester Portal**. 

The verification traces the complete data lifecycle:
$$\text{Frontend UI} \longrightarrow \text{Next.js BFF Proxy} \longrightarrow \text{FastAPI Endpoint} \longrightarrow \text{Domain Service} \longrightarrow \text{PostgreSQL DB} \longrightarrow \text{Notification Store}$$

---

## 1. Summary of Module Statuses

| # | Requester Module | Exact Route | API / Backend Endpoint | DB Table(s) Used | Operation | Tenant / Requester Scoping | Status |
|---|---|---|---|---|---|---|---|
| **1** | **Dashboard** | `/itsm/dashboard/requester` | `GET /v1/itsm/incidents?limit=10` | `public.itsm_tickets` | Read | `tenant_id` + `requester_id = actor_id` | `[VERIFIED]` (Ticket data)<br>`[MISMATCH]` (Static KPI/KB) |
| **2** | **My Tickets** | `/itsm/incidents` | `GET /v1/itsm/incidents` | `public.itsm_tickets` | Read | `tenant_id` + `requester_id = actor_id` | `[VERIFIED]` |
| **3** | **Report an Issue** | `/itsm/incidents/new` | `POST /v1/itsm/incidents` | `public.itsm_tickets`<br>`public.itsm_ticket_counters`<br>`public.itsm_ticket_activities`<br>`public.notifications` | Write | `tenant_id` + `requester_id = actor_id` | `[VERIFIED]` |
| **4** | **Ticket Details** | `/itsm/incidents/[id]` | `GET /v1/itsm/incidents/{id}`<br>`GET /v1/itsm/incidents/{id}/activities`<br>`POST /v1/itsm/incidents/{id}/activities` | `public.itsm_tickets`<br>`public.itsm_ticket_activities`<br>`public.notifications` | Read & Write | `tenant_id` + `requester_id == actor_id` (404 on mismatch) | `[VERIFIED]` |
| **5** | **Notifications** | `/itsm/notifications` | `GET /v1/notifications`<br>`POST /v1/notifications/{id}/read`<br>`POST /v1/notifications/read-all` | `public.notifications` | Read & Write | `tenant_id` + `user_id = actor_id` + Client ITSM filter | `[VERIFIED]` |
| **6** | **Service Catalog** | `/itsm/services` | N/A (Client-side static array) | None (Disconnected from `public.itsm_services`) | Read | Client-side static array | `[MISMATCH]` |
| **7** | **Knowledge Base** | `/itsm/knowledge` | N/A (Client-side static array) | None (Disconnected from `public.itsm_knowledge_articles`) | Read | Client-side static array | `[MISMATCH]` |
| **8** | **Profile** | `/itsm/profile` | `GET /v1/auth/me`<br>`POST /api/auth/logout` | `public.users`<br>`public.itsm_user_access` | Read & Write | `tenant_id` + `user_id = actor_id` from cookie session | `[VERIFIED]` |

---

## 2. Feature-by-Feature End-to-End Trace

### Feature 1: Requester Dashboard (`/itsm/dashboard/requester`)

* **Frontend Component**: `console/src/app/(console)/itsm/dashboard/requester/page.tsx`
* **Root Redirection**: `console/src/app/(console)/itsm/dashboard/page.tsx` checks `GET /v1/auth/me`. If `itsm_role === "REQUESTER"`, redirects to `/itsm/dashboard/requester`. `[VERIFIED]`
* **API / BFF Route**: `GET /api/itsm/incidents?limit=10` proxied via `console/src/app/api/[...path]/route.ts` to `GET /v1/itsm/incidents?limit=10`. `[VERIFIED]`
* **Backend Router**: `backend/app/api/v1/endpoints/itsm_incidents.py::list_incidents`
* **Domain Service**: `backend/app/services/itsm_incident_service.py::list_incidents`
* **DB Table**: `public.itsm_tickets`
* **Operation Type**: Read (SELECT)
* **Requester & Tenant Scoping**:
  - `get_current_tenant` dependency enforces `tenant_id = request.state.tenant_id`. `[VERIFIED]`
  - `_get_itsm_role()` detects `REQUESTER` role and overrides `requester_id = actor_id`. Requester can only query their own tickets. `[VERIFIED]`
* **Data Returned**: Array of `IncidentResponse` schema records for caller. `[VERIFIED]`
* **Frontend UI Display**:
  - "My Active Tickets" count renders `openTickets.length` (Status != RESOLVED / CLOSED / CANCELLED). `[VERIFIED]`
  - "Resolved Tickets" count renders `resolvedTickets.length` (Status == RESOLVED / CLOSED). `[VERIFIED]`
  - Incidents table renders `ticket_number`, `title`, `status`, `priority`, and `created_at/updated_at`. `[VERIFIED]`
* **Mismatches / Hardcoded Elements**:
  - "Pending Action" stat card is hardcoded to `0`. `[MISMATCH]`
  - "Avg Resolution Time" stat card is hardcoded to `"1.8 hrs"`. `[MISMATCH]`
  - "Self-Service Knowledge Base" widget in right panel uses static array. `[MISMATCH]`

---

### Feature 2: My Tickets (`/itsm/incidents`)

* **Frontend Component**: `console/src/app/(console)/itsm/incidents/page.tsx`
* **API / BFF Route**: `GET /api/itsm/incidents?search={search}&limit=100` -> proxied to `GET /v1/itsm/incidents?search={search}&limit=100`
* **Backend Router**: `backend/app/api/v1/endpoints/itsm_incidents.py::list_incidents`
* **Domain Service**: `backend/app/services/itsm_incident_service.py::list_incidents`
* **DB Table**: `public.itsm_tickets`
* **Operation Type**: Read (SELECT)
* **Requester & Tenant Scoping**:
  - `tenant_id` filter is strictly applied from token session. `[VERIFIED]`
  - `requester_id` is automatically set to `actor_id` for `REQUESTER` role. Requesters cannot retrieve other users' tickets. `[VERIFIED]`
* **Data Returned**: Array of tickets matching requester ID, ordered by `created_at DESC`. `[VERIFIED]`
* **Frontend UI Display**:
  - Filter tabs ("All Tickets", "Open", "In Progress", "Pending", "Resolved", "Closed") dynamically count and filter the returned array. `[VERIFIED]`
  - Search bar filters by ticket number and title. `[VERIFIED]`
  - Table displays `ticket_number` (clickable link), `title`, `ticket_type`, `status` badge, `priority` badge, `created_at`, `updated_at`, and a "View Details" action button. `[VERIFIED]`

---

### Feature 3: Report an Issue (`/itsm/incidents/new`)

* **Frontend Component**: `console/src/app/(console)/itsm/incidents/new/page.tsx`
* **API / BFF Route**: `POST /api/itsm/incidents` -> proxied to `POST /v1/itsm/incidents`
* **Payload Sent**:
  ```json
  {
    "title": "My laptop monitor flickers",
    "description": "The external display loses signal randomly.",
    "impact": "MEDIUM",
    "urgency": "HIGH",
    "category": "HARDWARE",
    "source_channel": "PORTAL"
  }
  ```
* **Backend Router**: `backend/app/api/v1/endpoints/itsm_incidents.py::create_incident`
* **Domain Service**: `backend/app/services/itsm_incident_service.py::create_incident`
* **DB Tables Modified**:
  1. `public.itsm_tickets` (Inserts new incident row with UUID primary key). `[VERIFIED]`
  2. `public.itsm_ticket_counters` (Atomically increments `last_number` for tenant `INC` prefix). `[VERIFIED]`
  3. `public.itsm_ticket_activities` (Inserts `CREATED` activity record). `[VERIFIED]`
  4. `public.notifications` (Inserts notification record for requester with `type="itsm.incident.created"` and `link="/itsm/incidents/{ticket_id}"`). `[VERIFIED]`
  5. `public.users` (Validates active requester user in tenant). `[VERIFIED]`
* **Operation Type**: Write (INSERT / UPDATE)
* **Requester & Tenant Scoping**:
  - Backend extracts `actor_id` from session and assigns it to `requester_id`. `[VERIFIED]`
  - Role check forces `assignee_id = None`, `assignment_group = None`, and `is_major_incident = False` for `REQUESTER` role. `[VERIFIED]`
  - Backend enforces valid `urgency` selection (HTTP 400 Bad Request if missing). `[VERIFIED]`
* **Data Returned**: Newly created `IncidentResponse` schema object containing generated `id` (UUID) and `ticket_number` (e.g., `INC-000006`). `[VERIFIED]`
* **Frontend UI Display**: Renders success screen displaying green check icon, formatted ticket number badge, title, status, and navigation buttons. `[VERIFIED]`

---

### Feature 4: Ticket Details & Discussion (`/itsm/incidents/[id]`)

* **Frontend Component**: `console/src/app/(console)/itsm/incidents/[id]/page.tsx`
* **API / BFF Routes**:
  - Fetch Ticket: `GET /api/itsm/incidents/{id}` -> `GET /v1/itsm/incidents/{id}` `[VERIFIED]`
  - Fetch Activities: `GET /api/itsm/incidents/{id}/activities` -> `GET /v1/itsm/incidents/{id}/activities` `[VERIFIED]`
  - Add Public Comment: `POST /api/itsm/incidents/{id}/activities` -> `POST /v1/itsm/incidents/{id}/activities` `[VERIFIED]`
* **Backend Router**: `backend/app/api/v1/endpoints/itsm_incidents.py` (`get_incident`, `list_incident_activities`, `add_incident_activity`)
* **Domain Service**: `backend/app/services/itsm_incident_service.py`
* **DB Tables Used**:
  - `public.itsm_tickets` (Reads ticket record by primary key `id`). `[VERIFIED]`
  - `public.itsm_ticket_activities` (Reads timeline and inserts new user comments). `[VERIFIED]`
  - `public.notifications` (Inserts notification when comment is posted). `[VERIFIED]`
* **Operation Type**: Read & Write
* **Requester Isolation & Protection**:
  - **Ownership Check**: If caller has `REQUESTER` role and `str(incident.requester_id) != str(actor_id)`, backend raises `HTTP 404 Not Found`, preventing unauthorized ticket probing. `[VERIFIED]`
  - **Internal Notes Filtering**: Requesters only receive public timeline activities (`is_internal == False`). `[VERIFIED]`
  - **Operational Guard**: `update_incident`, `change_incident_status`, and `assign_incident` endpoints raise `HTTP 403 Forbidden` if called by a `REQUESTER`. Frontend hides agent operational action buttons. `[VERIFIED]`
* **Frontend UI Display**: Renders breadcrumb, status/priority badges, incident title, lifecycle stepper, ticket details card, resolution summary card (if resolved), and activity timeline. `[VERIFIED]`

---

### Feature 5: Requester Notifications (`/itsm/notifications`)

* **Frontend Component**: `console/src/app/(console)/itsm/notifications/page.tsx`
* **API / BFF Routes**:
  - List: `GET /api/notifications?limit=50` -> proxied to `GET /v1/notifications?limit=50` `[VERIFIED]`
  - Mark Read: `POST /api/notifications/{id}/read` -> proxied to `POST /v1/notifications/{id}/read` `[VERIFIED]`
  - Mark All Read: `POST /api/notifications/read-all` -> proxied to `POST /v1/notifications/read-all` `[VERIFIED]`
* **Backend Router**: `backend/app/api/v1/endpoints/notifications.py`
* **DB Table**: `public.notifications`
* **Operation Type**: Read & Write
* **Scoping & Filtering**:
  - Backend filters by `tenant_id` and `or_(user_id IS NULL, user_id = actor_id)`. `[VERIFIED]`
  - Frontend filters out Governance layer items (`governance`, `compliance`, `audit`, `remediation`), presenting exclusively ITSM ticket notifications. `[VERIFIED]`
* **Notification Link Reference Verification**:
  - When an incident is logged, `create_notification()` persists `link = "/itsm/incidents/{ticket_id}"`. `[VERIFIED]`
  - Clicking "View Ticket Details" in the notification UI navigates directly to the target ticket. `[VERIFIED]`
* **Frontend UI Display**: Displays unread badge counter, notification title, body snippet, timestamp, read status indicator, and direct link to ticket details. `[VERIFIED]`

---

### Feature 6: Service Catalog (`/itsm/services`)

* **Frontend Component**: `console/src/app/(console)/itsm/services/page.tsx`
* **API Route Used**: None (Client-side static array `SERVICES_CATALOG`). `[MISMATCH]`
* **DB Tables**: Disconnected from database tables `public.itsm_services` and `public.itsm_service_catalog_items`. `[MISMATCH]`
* **Operation Type**: Client-side read.
* **Data Flow**:
  - Displays catalog cards grouped by Hardware, Software, Security, and General.
  - Clicking "Request Service" redirects user to `/itsm/incidents/new?category=...&title=...` with pre-filled query parameters. `[VERIFIED]`

---

### Feature 7: Knowledge Base (`/itsm/knowledge`)

* **Frontend Component**: `console/src/app/(console)/itsm/knowledge/page.tsx`
* **API Route Used**: None (Client-side static array `KNOWLEDGE_ARTICLES`). `[MISMATCH]`
* **DB Tables**: Disconnected from database table `public.itsm_knowledge_articles`. `[MISMATCH]`
* **Operation Type**: Client-side read & modal state.
* **Data Flow**:
  - Displays article cards with category tabs and text search.
  - Clicking an article opens a modal with step-by-step resolution steps.
  - Includes a "Report an Issue Instead" button linking to `/itsm/incidents/new`. `[VERIFIED]`

---

### Feature 8: Requester Profile (`/itsm/profile`)

* **Frontend Component**: `console/src/app/(console)/itsm/profile/page.tsx`
* **API / BFF Route**: `GET /api/auth/session` -> proxies to backend `GET /v1/auth/me` `[VERIFIED]`
* **Backend Endpoint**: `backend/app/api/v1/endpoints/auth.py::me`
* **DB Tables**: `public.users` and `authn.lookup_itsm_user_access()`
* **Operation Type**: Read (Session details) & Write (Cookie deletion on logout via `POST /api/auth/logout`). `[VERIFIED]`
* **Scoping**: Session token cookie (`authclaw_session`) carries user identity and tenant scope. `[VERIFIED]`
* **Data Returned**: `userId`, `userEmail`, `tenantId`, `itsmRole` (`REQUESTER`), `platformRole`. `[VERIFIED]`
* **Frontend UI Display**: Renders user email, ITSM Role badge (`REQUESTER`), Active Workspace Tenant ID, session status, and Sign Out button. `[VERIFIED]`

---

## 3. End-to-End Lifecycle Verification (INC-000005 & INC-000006)

Direct read-only verification of real database records `INC-000005` and `INC-000006` in PostgreSQL container `authclaw-full-postgres`:

```
Requester (requester123@gmail.com)
  │
  ├──> POST /itsm/incidents/new
  │      │
  │      ├──> DB INSERT INTO public.itsm_tickets
  │      │      ├── ticket_number: INC-000005 (UUID: cbbb8450-1be1-4988-ba66-efcad63b8844) [VERIFIED]
  │      │      └── ticket_number: INC-000006 (UUID: 71441c3a-92a5-4de5-ac91-abe9c4fc00ad) [VERIFIED]
  │      │
  │      ├──> DB INSERT INTO public.itsm_ticket_activities
  │      │      └── activity_type: CREATED [VERIFIED]
  │      │
  │      └──> DB INSERT INTO public.notifications
  │             ├── INC-000005 Notification ID: b7a7cad6-d1a8-4417-899b-ce91efb41721 [VERIFIED]
  │             ├── INC-000006 Notification ID: d3665323-7273-49fe-91d2-dec4749ad966 [VERIFIED]
  │             └── link: /itsm/incidents/{ticket_uuid} [VERIFIED]
  │
  ├──> GET /itsm/incidents (My Tickets)
  │      └── Reads record from public.itsm_tickets WHERE requester_id = actor_id [VERIFIED]
  │
  ├──> GET /itsm/incidents/{ticket_uuid} (Ticket Details)
  │      └── Reads record & activity timeline from public.itsm_tickets & activities [VERIFIED]
  │
  └──> GET /itsm/notifications (Notifications Page)
         └── Reads notification record from public.notifications & renders link [VERIFIED]
```

---

## 4. Summary of Verified vs Broken/Missing Data Flows

### 1. Verified Data Flows `[VERIFIED]`
- **Incident Creation**: Form submit -> FastAPI backend -> `public.itsm_tickets` & `public.itsm_ticket_counters`.
- **Activity Timeline Logging**: Initial creation and public comments -> `public.itsm_ticket_activities`.
- **Notification Persistence & Linking**: Incident creation & comments -> `public.notifications` with exact ticket UUID links.
- **My Tickets List & Scoping**: `GET /v1/itsm/incidents` filters strictly by `tenant_id` and `requester_id = actor_id`.
- **Ticket Details Security**: `GET /v1/itsm/incidents/{id}` returns HTTP 404 if a requester attempts to fetch another user's ticket.
- **Role Isolation**: Requesters are blocked (HTTP 403) from updating status, assigning tickets, or editing operational details.
- **Profile & Session**: Session lookup (`GET /v1/auth/me`) correctly reports `REQUESTER` role and `tenant_id`.

### 2. Broken / Missing / Mismatched Data Flows `[MISMATCH]`
- **Service Catalog DB Disconnection**: Service Catalog page (`/itsm/services`) uses a hardcoded static array instead of querying `public.itsm_services` or `public.itsm_service_catalog_items`.
- **Knowledge Base DB Disconnection**: Knowledge Base page (`/itsm/knowledge`) uses a hardcoded static array instead of querying `public.itsm_knowledge_articles`.
- **Dashboard KPI Stat Cards**: "Pending Action" and "Avg Resolution Time" stat cards display static values (`0` and `1.8 hrs`).
- **File Attachments Persistence**: Table `public.attachments` does not exist in the database schema; file uploads are not persisted in PostgreSQL.

---

## 5. Exact Files & Tables Inspected

### Frontend Components & Routes:
- `console/src/app/(console)/itsm/dashboard/page.tsx`
- `console/src/app/(console)/itsm/dashboard/requester/page.tsx`
- `console/src/app/(console)/itsm/incidents/page.tsx`
- `console/src/app/(console)/itsm/incidents/new/page.tsx`
- `console/src/app/(console)/itsm/incidents/[id]/page.tsx`
- `console/src/app/(console)/itsm/notifications/page.tsx`
- `console/src/app/(console)/itsm/services/page.tsx`
- `console/src/app/(console)/itsm/knowledge/page.tsx`
- `console/src/app/(console)/itsm/profile/page.tsx`
- `console/src/app/api/[...path]/route.ts`
- `console/src/app/api/auth/session/route.ts`
- `console/src/lib/bff-routes.ts`

### Backend Endpoints & Domain Services:
- `backend/app/api/v1/endpoints/itsm_incidents.py`
- `backend/app/api/v1/endpoints/notifications.py`
- `backend/app/api/v1/endpoints/auth.py`
- `backend/app/services/itsm_incident_service.py`
- `backend/app/services/notifications.py`
- `backend/app/db/models.py`

### PostgreSQL Tables Inspected in `authclaw`:
- `public.itsm_tickets`
- `public.itsm_ticket_counters`
- `public.itsm_ticket_activities`
- `public.notifications`
- `public.users`
- `public.itsm_user_access`
- `public.itsm_services`
- `public.itsm_knowledge_articles`

---

## 6. Recommended Fixes (Architectural Recommendations Only — Not Implemented)

1. **Service Catalog DB Integration**: Connect `/itsm/services` to backend endpoint `GET /v1/itsm/services` reading from `public.itsm_services`.
2. **Knowledge Base DB Integration**: Connect `/itsm/knowledge` to backend endpoint `GET /v1/itsm/knowledge-articles` reading from `public.itsm_knowledge_articles`.
3. **Dynamic Dashboard Metrics**: Replace static KPI numbers on the Requester Dashboard with dynamic counts derived from `public.itsm_tickets`.
4. **File Attachments Schema**: Create database table `public.attachments` and endpoints to support ticket file uploads.
