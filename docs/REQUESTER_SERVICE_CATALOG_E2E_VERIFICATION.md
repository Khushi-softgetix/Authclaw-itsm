# Requester Service Catalog End-to-End Data Flow Verification

**Date**: September 17, 2026  
**Project**: AuthClaw ITSM Requester Portal  
**Phase**: Requester Service Catalog Integration  
**Status Tags Used**: `[VERIFIED]`, `[MISMATCH]`, `[NOT VERIFIED]`  

---

## 1. Executive Summary

The **Requester Service Catalog** (`/itsm/services`) has been successfully migrated from a static frontend array to a **database-backed end-to-end data flow**. 

Catalog requests now flow dynamically from PostgreSQL tables `public.itsm_services` and `public.itsm_service_catalog_items` with authoritative tenant isolation and session authorization.

$$\text{Requester UI (`/itsm/services`)} \xrightarrow{\text{fetch("/api/itsm/service-catalog")}} \text{Next.js BFF Proxy} \xrightarrow[\text{Bearer Token}]{\text{GET /v1/itsm/service-catalog}} \text{FastAPI Endpoint} \xrightarrow{\text{SQLAlchemy ORM}} \text{PostgreSQL (`itsm_services` + `itsm_service_catalog_items`)}$$

---

## 2. End-to-End Flow Summary

| Layer | Component / File | Description | Status |
|---|---|---|---|
| **Frontend UI** | `console/src/app/(console)/itsm/services/page.tsx` | Renders dynamic Service Catalog cards, category tabs ("Hardware & Equipment", "Software Access & SSO", "Security & MFA Reset", "General IT Assistance"), search bar, loading spinner, and empty/error states. | `[VERIFIED]` |
| **Next.js BFF Route** | `console/src/lib/bff-routes.ts` | Resolves `itsm/service-catalog` to backend path `/v1/itsm/service-catalog` and attaches the user's session cookie as a Bearer header. | `[VERIFIED]` |
| **FastAPI Backend Endpoint** | `backend/app/api/v1/endpoints/itsm_services.py` | `GET /v1/itsm/service-catalog` parses authenticated tenant ID, enforces tenant isolation, auto-seeds default active services for new tenants, and executes PostgreSQL query. | `[VERIFIED]` |
| **FastAPI Main Router** | `backend/main.py` | Mounts `itsm_services_router` at `/v1/itsm/service-catalog` and `/api/itsm/service-catalog`. | `[VERIFIED]` |
| **Database Models** | `backend/app/db/models.py` | `ITSMService` and `ITSMServiceCatalogItem` ORM models mapped to PostgreSQL. | `[VERIFIED]` |
| **PostgreSQL DB Tables** | `public.itsm_services`<br>`public.itsm_service_catalog_items` | Database storage for catalog items, categories, SLA delivery hours, and fulfillment metadata. | `[VERIFIED]` |

---

## 3. Database Tables & Columns Map

### Table 1: `public.itsm_services`
- **Primary Key**: `id` (UUID)
- **Foreign Keys**: `tenant_id` -> `tenants.id`
- **Columns Used**:
  - `tenant_id` (UUID) — Tenant isolation
  - `name` (VARCHAR(255)) — Service name (e.g., `Workplace Technology`, `Access & Identity`, `IT Security`)
  - `slug` (VARCHAR(100)) — Unique service identifier
  - `description` (TEXT) — Operational service context
  - `tier` (VARCHAR(20)) — Tier level (`TIER_1`, `TIER_2`)
  - `status` (VARCHAR(32)) — Service status (`OPERATIONAL`)

### Table 2: `public.itsm_service_catalog_items`
- **Primary Key**: `id` (UUID)
- **Foreign Keys**: `tenant_id` -> `tenants.id`, `service_id` -> `itsm_services.id`
- **Columns Used**:
  - `tenant_id` (UUID) — Tenant isolation
  - `service_id` (UUID) — Foreign key linking to parent `itsm_services`
  - `name` (VARCHAR(255)) — Catalog item title (e.g., `New Developer Laptop / Workstation`, `AWS Account & IAM Sandbox Access`)
  - `slug` (VARCHAR(100)) — Unique item slug
  - `description` (TEXT) — Item details and provisioning scope
  - `version` (INTEGER) — Catalog item schema version (default `1`)
  - `approval_required` (BOOLEAN) — Flags if manager approval is required
  - `fulfillment_group` (VARCHAR(100)) — Operational team assigned to request
  - `estimated_delivery_hours` (INTEGER) — SLA target in hours
  - `is_active` (BOOLEAN) — Active flag (`True` for requester visibility)

---

## 4. Security & Tenant Isolation Verification

1. **Authoritative Backend Scoping**:
   - `get_current_tenant` dependency extracts `tenant_id` directly from the authenticated session context (`request.state.tenant_id`).
   - SQL queries strictly filter by `ITSMServiceCatalogItem.tenant_id == tenant_id` and `ITSMService.tenant_id == tenant_id`. `[VERIFIED]`

2. **Cross-Tenant Prevention**:
   - Requesters can only access catalog items belonging to their active tenant session.
   - Frontend parameters are ignored by backend security scoping. `[VERIFIED]`

3. **Active State Filtering**:
   - Only items with `is_active == True` and operational parent services are returned to requesters. `[VERIFIED]`

---

## 5. UI & Feature State Verification

| State | Verification Details | Status |
|---|---|---|
| **Loading State** | Renders animated spinner with `"Loading database-backed service catalog..."` message while fetching. | `[VERIFIED]` |
| **Data Display** | Renders catalog item cards with SLA badges, fulfillment type (`Manager Approval`, `Automated`, `IT Triage`), description, and `"Request Service"` CTA button. | `[VERIFIED]` |
| **Category Filtering** | Client-side tabs filter returned items by `"Hardware & Equipment"`, `"Software Access & SSO"`, `"Security & MFA Reset"`, and `"General IT Assistance"`. | `[VERIFIED]` |
| **Search Querying** | Text input filters items in real time across item name, description, and service category. | `[VERIFIED]` |
| **Empty State** | Displays `"No services found"` graphic if no items match search or category. | `[VERIFIED]` |
| **Error Handling** | Displays error alert banner with a `"Retry"` button if API call fails. | `[VERIFIED]` |
| **Incident Navigation** | Clicking `"Request Service"` navigates to `/itsm/incidents/new?category=...&title=...` with pre-filled category and service title. | `[VERIFIED]` |

---

## 6. Files Changed

1. `backend/app/schemas/itsm_services.py` `[NEW]` — Pydantic response schema `RequesterServiceCatalogItemResponse`.
2. `backend/app/api/v1/endpoints/itsm_services.py` `[NEW]` — FastAPI router `GET /v1/itsm/service-catalog`.
3. `backend/main.py` `[MODIFY]` — Registered `itsm_services_router` routes.
4. `console/src/lib/bff-routes.ts` `[MODIFY]` — Added `itsm/service-catalog` to allowed GET BFF routes.
5. `console/src/app/(console)/itsm/services/page.tsx` `[MODIFY]` — Updated UI component to fetch DB-backed data.
6. `docs/REQUESTER_SERVICE_CATALOG_E2E_VERIFICATION.md` `[NEW]` — Verification documentation.
