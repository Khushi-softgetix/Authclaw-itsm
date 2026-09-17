# ITSM Attachment Backend Verification Document

## Executive Summary
This document presents a read-only technical audit and verification of attachment capabilities within AuthClaw ITSM.

The verification proves that while the database table `public.itsm_attachments` and SQLAlchemy model `ITSMAttachment` exist in PostgreSQL, **no backend API endpoints, storage drivers (S3/local), upload services, or frontend file upload components exist**.

---

## 1. Itemized Inspection Findings

### 1. `itsm_attachments` SQLAlchemy Model / Schema
- **Status**: `[VERIFIED]`
- **Evidence**:
  - Defined in `backend/app/db/models.py` (lines 1525–1549) as `class ITSMAttachment(Base)` mapping to `__tablename__ = "itsm_attachments"`.
  - Schema columns:
    - `id`: `UUID` (Primary Key)
    - `tenant_id`: `UUID` (Foreign Key -> `tenants.id`)
    - `target_type`: `String(32)` (e.g. `"TICKET"`, `"CHANGE"`, `"KB"`)
    - `target_id`: `UUID`
    - `file_name`: `String(255)`
    - `file_size_bytes`: `BigInteger`
    - `mime_type`: `String(127)`
    - `storage_path`: `String(1024)`
    - `storage_backend`: `String(32)` (default `"S3"`)
    - `checksum_sha256`: `String(64)`
    - `is_quarantined`: `Boolean` (default `False`)
    - `quarantine_reason`: `String(255)`
    - `uploaded_by_id`: `UUID` (Foreign Key -> `users.id`)
    - `created_at`: `DateTime(timezone=True)`
  - Index: `idx_itsm_attach_target` on `(tenant_id, target_type, target_id)`.

---

### 2. Existing Attachment / File Upload / Download APIs
- **Status**: `[NOT FOUND]`
- **Evidence**:
  - Comprehensive search across `backend/app/api/v1/endpoints/` yielded **zero** routes or routers handling `/itsm/attachments` or binary file uploads.
  - No BFF route mapping exists in `console/src/lib/bff-routes.ts` for file attachment endpoints.

---

### 3. Existing Services Handling File / Storage Uploads
- **Status**: `[NOT FOUND]`
- **Evidence**:
  - Searched `backend/app/services/`. No service module or handler exists for accepting file streams, computing SHA-256 hashes, managing metadata, or invoking file uploads.

---

### 4. `storage_path` and `storage_backend` Implementation
- **Status**: `[NOT FOUND]`
- **Evidence**:
  - `storage_backend` (default `"S3"`) and `storage_path` exist purely as static database column definitions in `backend/app/db/models.py`.
  - No AWS S3 SDK (`boto3`), Google Cloud Storage driver, MinIO client, or local file system storage engine is implemented anywhere in `backend/app/`.

---

### 5. Existing AuthClaw Storage / File Capabilities
- **Status**: `[NOT FOUND]`
- **Evidence**:
  - Audited all 29 endpoint modules in `backend/app/api/v1/endpoints/`.
  - AuthClaw compliance evidence (`evidence.py`) stores structured JSON payloads (`evidence_data: Dict[str, Any]`) directly in PostgreSQL rows, not binary file attachments or S3 blobs.

---

### 6. `target_type` + `target_id` Usage for Ticket Attachments
- **Status**: `[NOT FOUND]`
- **Evidence**:
  - `target_type` and `target_id` columns exist in `ITSMAttachment` model and are used in unit test `backend/tests/test_itsm_database.py` (line 285) to verify raw ORM insertion.
  - However, no active domain service, API endpoint, or ticket creation logic queries or writes `target_type` + `target_id` records.

---

### 7. `itsm_incidents` / Report an Issue Payload Attachment Support
- **Status**: `[NOT FOUND]`
- **Evidence**:
  - Inspected `IncidentCreateRequest` in `backend/app/schemas/itsm_incidents.py`: accepts only text fields (`title`, `description`, `impact`, `urgency`, `category`, `source_channel`).
  - Inspected `CreateIncidentPage` in `console/src/app/(console)/itsm/incidents/new/page.tsx`: form collects only title, description, category, impact, and urgency. No attachment field or file upload logic exists.

---

### 8. Existing Frontend Upload / File Components
- **Status**: `[NOT FOUND]`
- **Evidence**:
  - Inspected `console/src/components/` and `console/src/components/itsm/`.
  - No file dropzone, file picker, attachment preview, or upload progress component exists.

---

### 9. Relevant Migrations, RLS Policies, Permissions and Tests
- **Status**: `[VERIFIED]`
- **Evidence**:
  - Alembic migration `backend/alembic/versions/048_add_itsm_v1_foundation.py` creates table `public.itsm_attachments` (lines 93–110).
  - Migration enforces RLS: `ALTER TABLE public.itsm_attachments ENABLE ROW LEVEL SECURITY;` and creates policy `tenant_isolation` (`USING (tenant_id = authn.current_tenant_id())`).
  - Database test `backend/tests/test_itsm_database.py` (lines 285–306) verifies ORM persistence and quarantine flags.

---

## 2. Conclusion

Based on empirical evidence from the repository codebase:

**B) DB table exists but backend/storage support is missing**

### Proof Summary:
1. `public.itsm_attachments` table exists in PostgreSQL schema via migration `048_add_itsm_v1_foundation.py` and SQLAlchemy model `ITSMAttachment` in `backend/app/db/models.py`.
2. However, there are **no backend upload/download endpoints**, **no S3/storage driver implementations**, **no attachment service logic**, **no schema support in incident requests**, and **no frontend file upload components**.
