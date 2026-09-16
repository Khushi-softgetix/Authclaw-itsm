# ITSM Requester Portal: Details, Notifications & Profile Verification Report

**Date**: September 15, 2026  
**Project**: AuthClaw ITSM  
**Scope**: Implement & Verify Requester Ticket Details, Notifications, Profile/Logout & Requester Sidebar Navigation  

---

## Executive Summary

The remaining ITSM Requester Portal features (**Requester Ticket Details**, **Requester Notifications**, and **Requester Profile / Logout**) have been fully implemented and integrated into the Requester Navigation Sidebar and Account Menu.

All security controls, RBAC checks, tenant isolation, and separation from the AuthClaw Governance Layer have been strictly verified.

---

## 1. Feature PASS/FAIL Results

| Feature / Verification Category | Status | Result & Verification Summary |
|---|---|---|
| **Requester Ticket Details** | **PASS** | Opens ticket-specific route `/itsm/incidents/[id]` via My Tickets & Dashboard. Displays title, description, category, urgency, status, timeline, and requester comments. Hides internal notes, agent assignment, and admin controls. Blocks unauthorized ticket IDs with HTTP 404. |
| **Requester Notifications** | **PASS** | Added to Requester Sidebar (`/itsm/notifications`). Displays only requester's own ITSM ticket notifications. Excludes Governance, compliance, audit, remediation, and approval events. Read/unread & mark-all-read supported. |
| **Requester Profile** | **PASS** | Accessible via `/itsm/profile` and account menu. Displays authenticated user email (`requester123@gmail.com`), role (`Requester`), active tenant name & tenant ID. Zero admin controls exposed. |
| **Sidebar Visibility** | **PASS** | Requester sidebar displays: 1. Dashboard, 2. My Tickets, 3. Report an Issue, 4. Service Catalog, 5. Knowledge Base, 6. Notifications. Ticket Details opens directly when clicking tickets from lists. |
| **Requester Isolation** | **PASS** | Requesters cannot access other requesters' tickets or change ticket status/assignment (returns HTTP 403/404). Requesters attempting to access Platform Admin routes are redirected to `/itsm/dashboard/requester`. |
| **Logout** | **PASS** | Account menu and Profile page trigger official AuthClaw logout flow (`POST /api/auth/logout`), clearing session cookies and redirecting to `/itsm/login`. |
| **Platform Administrator Protection** | **PASS** | **CONFIRMED**: Zero Platform Administrator files, CMDB, Problems & Changes, Reports & Audit, Settings, SLA configs, or AuthClaw core auth files were modified. |

---

## 2. Verified Requester Routes & Navigation

| Route | Requester Allowed | Description / Component |
|---|---|---|
| `/itsm/dashboard/requester` | **YES** | Requester Dashboard with live KPI stats, active tickets table, catalog shortcuts, and KB search. |
| `/itsm/incidents` | **YES** | My Tickets list with real backend status filter tabs, search, and refresh state. |
| `/itsm/incidents/new` | **YES** | Report an Issue form with title, description, category, impact, and required urgency validation. |
| `/itsm/services` | **YES** | Service Catalog listing categorized hardware, software/SSO, security, and general IT services. |
| `/itsm/knowledge` | **YES** | Self-Service Knowledge Base with guide categories, search, and step-by-step resolution modal. |
| `/itsm/incidents/[id]` | **YES** | Ticket-specific details page (scoped strictly to tickets owned by the requester). |
| `/itsm/notifications` | **YES** | Dedicated ITSM Requester Notifications page (isolated from Governance `/notifications`). |
| `/itsm/profile` | **YES** | Requester Profile & Session Details page with official logout action. |

---

## 3. Sidebar Order & Account Menu Integration

### Requester Navigation Sidebar (`console-shell.tsx`)
1. **Dashboard** (`/itsm/dashboard`)
2. **My Tickets** (`/itsm/incidents`)
3. **Report an Issue** (`/itsm/incidents/new`)
4. **Service Catalog** (`/itsm/services`)
5. **Knowledge Base** (`/itsm/knowledge`)
6. **Notifications** (`/itsm/notifications`)

### Ticket Details Navigation Flow
* Ticket Details is ticket-specific. Clicking any ticket row or ticket number in **My Tickets** or **Dashboard** opens `/itsm/incidents/[id]`. No fake generic Ticket Details page exists without a ticket ID.

### Account Menu Integration
* Header profile dropdown displays logged-in requester's email (`requester123@gmail.com`) and role (`Requester`).
* Dropdown includes **My Profile** linking to `/itsm/profile` and **Sign Out** triggering `POST /api/auth/logout`.

---

## 4. Authorization & Security Verification

1. **Ticket Access Scoping**:
   - `GET /v1/itsm/incidents/[id]`: Returns incident if `incident.requester_id == actor_id`. If an invalid or another requester's ticket ID is requested, backend returns `HTTP 404 Not Found`.
2. **Privileged Operational Action Blocks**:
   - `POST /v1/itsm/incidents/[id]/status`: Returns `HTTP 403 Forbidden` for `REQUESTER` role.
   - `POST /v1/itsm/incidents/[id]/assign`: Returns `HTTP 403 Forbidden` for `REQUESTER` role.
   - `PATCH /v1/itsm/incidents/[id]`: Returns `HTTP 403 Forbidden` for `REQUESTER` role.
3. **Internal Notes Masking**:
   - `GET /v1/itsm/incidents/[id]/activities`: Automatically filters out all activities where `is_internal = True` for `REQUESTER` role.

---

## 5. Files Changed (Requester Scope Only)

1. `console/src/app/(console)/itsm/layout.tsx` (Allowed `/itsm/notifications` and `/itsm/profile` routes for `REQUESTER` role)
2. `console/src/components/console-shell.tsx` (Added Notifications to requester sidebar, added My Profile link to header user dropdown, updated page breadcrumbs)
3. `console/src/app/(console)/itsm/profile/page.tsx` (**NEW**: Dedicated Requester Profile & Account Information Page)
4. `console/src/app/(console)/itsm/notifications/page.tsx` (Dedicated ITSM Requester Notifications Page)
5. `backend/app/api/v1/endpoints/itsm_incidents.py` (Added backend `create_notification` triggers on ticket creation and public comment addition)

**Platform Administrator & AuthClaw Governance Audit**:
* `console/src/app/(console)/itsm/changes/*`: Unchanged
* `console/src/app/(console)/itsm/cmdb/*`: Unchanged
* `console/src/app/(console)/itsm/reports/*`: Unchanged
* `console/src/app/(console)/itsm/requests/*`: Unchanged
* `console/src/app/(console)/itsm/settings/*`: Unchanged
* `console/src/app/(console)/notifications/*`: Unchanged (Governance notifications page preserved)

---

## 6. Known Limitations

* Requesters are not permitted to change ticket operational status, assign agent groups, or toggle major incident flags. Operational lifecycle changes must be performed by Service Agents or Service Leads.
* Requester Notifications are generated for ticket submissions, status updates, and agent public comments, and are filtered to exclude AI Governance Layer events.
