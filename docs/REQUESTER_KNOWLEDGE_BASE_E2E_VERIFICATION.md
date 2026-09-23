# Requester Knowledge Base End-to-End Data Flow Verification

**Date**: September 17, 2026  
**Project**: AuthClaw ITSM Requester Portal  
**Phase**: Requester Knowledge Base Integration  
**Status Tags Used**: `[VERIFIED]`, `[MISMATCH]`, `[NOT VERIFIED]`  

---

## 1. Executive Summary

The **Requester Knowledge Base** (`/itsm/knowledge`) has been successfully migrated from a static frontend array to a **database-backed end-to-end data flow**. 

Published resolution guides and documentation now flow dynamically from PostgreSQL tables `public.itsm_knowledge_articles` and `public.itsm_knowledge_article_versions` with authoritative tenant isolation and session authorization.

$$\text{Requester UI (`/itsm/knowledge`)} \xrightarrow{\text{fetch("/api/itsm/knowledge")}} \text{Next.js BFF Proxy} \xrightarrow[\text{Bearer Token}]{\text{GET /v1/itsm/knowledge}} \text{FastAPI Endpoint} \xrightarrow{\text{SQLAlchemy ORM}} \text{PostgreSQL (`itsm_knowledge_articles` + `itsm_knowledge_article_versions`)}$$

---

## 2. End-to-End Flow Summary

| Layer | Component / File | Description | Status |
|---|---|---|---|
| **Frontend UI** | `console/src/app/(console)/itsm/knowledge/page.tsx` | Renders dynamic Knowledge Base cards, category pills ("All", "Networking", "Authentication", "Security", "DevOps & Cloud"), search input, guide detail modal with step-by-step resolution, helpful feedback, and loading/empty/error states. | `[VERIFIED]` |
| **Next.js BFF Route** | `console/src/lib/bff-routes.ts` | Resolves `itsm/knowledge` to backend path `/v1/itsm/knowledge` and attaches the user's session cookie as a Bearer header. | `[VERIFIED]` |
| **FastAPI Backend Endpoint** | `backend/app/api/v1/endpoints/itsm_knowledge.py` | `GET /v1/itsm/knowledge` parses authenticated tenant ID, enforces tenant isolation, auto-seeds default published resolution guides for new tenants, and executes PostgreSQL query. | `[VERIFIED]` |
| **FastAPI Main Router** | `backend/main.py` | Mounts `itsm_knowledge_router` at `/v1/itsm/knowledge` and `/api/itsm/knowledge`. | `[VERIFIED]` |
| **Database Models** | `backend/app/db/models.py` | `ITSMKnowledgeArticle` and `ITSMKnowledgeArticleVersion` ORM models mapped to PostgreSQL. | `[VERIFIED]` |
| **PostgreSQL DB Tables** | `public.itsm_knowledge_articles`<br>`public.itsm_knowledge_article_versions` | Database storage for article metadata, published versions, Markdown content, resolution steps, view counts, and helpful feedback counters. | `[VERIFIED]` |

---

## 3. Database Tables & Columns Map

### Table 1: `public.itsm_knowledge_articles`
- **Primary Key**: `id` (UUID)
- **Foreign Keys**: `tenant_id` -> `tenants.id`, `author_id` -> `users.id`
- **Columns Used**:
  - `tenant_id` (UUID) — Tenant isolation
  - `title` (VARCHAR(512)) — Article title
  - `slug` (VARCHAR(255)) — Unique article URL slug
  - `category` (VARCHAR(100)) — Category classification (e.g., `Networking`, `Authentication`, `Security`, `DevOps & Cloud`)
  - `status` (VARCHAR(32)) — Lifecycle status (`PUBLISHED`)
  - `current_published_version` (INTEGER) — Version number of current published revision (e.g., `1`)
  - `view_count` (INTEGER) — Total article pageviews
  - `helpful_count` (INTEGER) — Helpful feedback counter
  - `published_at` (TIMESTAMP) — Initial publication timestamp

### Table 2: `public.itsm_knowledge_article_versions`
- **Primary Key**: `id` (UUID)
- **Foreign Keys**: `tenant_id` -> `tenants.id`, `article_id` -> `itsm_knowledge_articles.id`, `created_by` -> `users.id`
- **Columns Used**:
  - `tenant_id` (UUID) — Tenant isolation
  - `article_id` (UUID) — Foreign key linking to parent `itsm_knowledge_articles`
  - `version_number` (INTEGER) — Immutable revision number
  - `title` (VARCHAR(512)) — Revision title
  - `summary` (TEXT) — Brief guide summary
  - `content_markdown` (TEXT) — Formatted guide content and step-by-step resolution steps
  - `keywords` (ARRAY(TEXT)) — Search tags and keywords

---

## 4. Security & Tenant Isolation Verification

1. **Authoritative Backend Scoping**:
   - `get_current_tenant` dependency extracts `tenant_id` directly from the authenticated session context (`request.state.tenant_id`).
   - SQL queries strictly filter by `ITSMKnowledgeArticle.tenant_id == tenant_id` and `ITSMKnowledgeArticleVersion.tenant_id == tenant_id`. `[VERIFIED]`

2. **Cross-Tenant Prevention**:
   - Requesters can only access published knowledge articles belonging to their active tenant session.
   - Frontend parameters are ignored by backend security scoping. `[VERIFIED]`

3. **Status Scoping**:
   - Only articles with `status == 'PUBLISHED'` are returned to requesters. Drafts or internal administrative revisions are excluded. `[VERIFIED]`

---

## 5. UI & Feature State Verification

| State | Verification Details | Status |
|---|---|---|
| **Loading State** | Renders animated spinner with `"Loading database-backed knowledge base articles..."` message while fetching. | `[VERIFIED]` |
| **Data Display** | Renders article cards with view counts, read times, summary, and `"Read Guide"` button. | `[VERIFIED]` |
| **Modal Resolution View** | Clicking an article opens a detail modal displaying full guide content and numbered step-by-step resolution instructions. | `[VERIFIED]` |
| **Helpful Feedback** | Clicking `"Yes"` in the modal sends `POST /api/itsm/knowledge/{id}/helpful` to increment `helpful_count` in PostgreSQL. | `[VERIFIED]` |
| **Category Filtering** | Category pills ("All", "Networking", "Authentication", "Security", "DevOps & Cloud") filter returned articles. | `[VERIFIED]` |
| **Search Querying** | Text input filters articles in real time across title, category, summary, and content text. | `[VERIFIED]` |
| **Empty State** | Displays `"No articles found"` graphic if search or category returns 0 articles. | `[VERIFIED]` |
| **Error Handling** | Displays error alert banner with a `"Retry"` button if API call fails. | `[VERIFIED]` |
| **Incident Navigation** | Clicking `"Report an Issue Instead"` navigates to `/itsm/incidents/new`. | `[VERIFIED]` |

---

## 6. Files Changed

1. `backend/app/schemas/itsm_knowledge.py` `[NEW]` — Pydantic response schema `RequesterKBArticleResponse`.
2. `backend/app/api/v1/endpoints/itsm_knowledge.py` `[NEW]` — FastAPI router `GET /v1/itsm/knowledge` & `POST /v1/itsm/knowledge/{id}/helpful`.
3. `backend/main.py` `[MODIFY]` — Registered `itsm_knowledge_router` routes.
4. `console/src/lib/bff-routes.ts` `[MODIFY]` — Added `itsm/knowledge` to allowed GET & POST BFF routes.
5. `console/src/app/(console)/itsm/knowledge/page.tsx` `[MODIFY]` — Updated UI component to fetch DB-backed data.
6. `docs/REQUESTER_KNOWLEDGE_BASE_E2E_VERIFICATION.md` `[NEW]` — Verification documentation.
