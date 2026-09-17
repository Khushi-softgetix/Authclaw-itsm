# Requester Attachments End-to-End (E2E) Verification Document

## Executive Summary
This document provides the complete end-to-end technical proof and architectural verification for Phase 4: Requester File Attachments in AuthClaw ITSM.

Requesters reporting an IT issue can now attach files (screenshots, logs, diagnostics) during ticket creation. The implementation reuses the existing `public.itsm_attachments` PostgreSQL table and `ITSMAttachment` ORM model, backed by a local filesystem storage engine with strict tenant isolation, SHA-256 integrity hashing, and path traversal security.

---

## 1. End-to-End (E2E) Data Flow Architecture

```
[ Report an Issue UI ] (console/src/app/(console)/itsm/incidents/new/page.tsx)
          │  1. Create Ticket -> POST /api/itsm/incidents
          │  2. Attach File   -> POST /api/itsm/incidents/{ticket_id}/attachments (FormData)
          ▼
[ Next.js BFF Proxy ] (console/src/app/api/itsm/incidents/[id]/attachments/route.ts)
          │  Proxies multipart/form-data with Session Bearer Token
          ▼
[ FastAPI Endpoint ] (POST /v1/itsm/incidents/{ticket_id}/attachments in backend/app/api/v1/endpoints/itsm_attachments.py)
          │  Enforces tenant isolation & requester ticket ownership
          ▼
[ Storage Engine ] (LocalStorageEngine in backend/app/core/storage.py)
          │  1. Validates file size (<= 10MB) & sanitizes filename
          │  2. Computes SHA-256 checksum
          │  3. Writes file content to data/uploads/{tenant_id}/{stem}_{checksum}.ext
          ▼
[ PostgreSQL Database ] (public.itsm_attachments)
          │  Inserts ITSMAttachment row: target_type="TICKET", target_id=ticket.id, storage_path, storage_backend="LOCAL"
          ▼
[ Ticket Details UI ] (console/src/app/(console)/itsm/incidents/[id]/page.tsx)
          │  1. Fetches attachments -> GET /api/itsm/incidents/{ticket_id}/attachments
          │  2. Renders Attachment Card with file size & download link
          │  3. Downloads file -> GET /api/itsm/attachments/{attachment_id}/download
```

---

## 2. Step-by-Step Technical Traceability

### Step 1: File Selection & Upload UI (`console/src/app/(console)/itsm/incidents/new/page.tsx`)
User selects files via a paperclip input component. After incident creation returns `ticket_id`, files are uploaded sequentially:
```tsx
const formData = new FormData();
formData.append("file", file);
await fetch(`/api/itsm/incidents/${createdTicketId}/attachments`, {
  method: "POST",
  body: formData,
});
```

### Step 2: BFF Proxy (`console/src/app/api/itsm/incidents/[id]/attachments/route.ts`)
Proxies multipart/form-data requests to backend FastAPI endpoint with authenticated tenant session token.

### Step 3: FastAPI Attachment Endpoint (`backend/app/api/v1/endpoints/itsm_attachments.py`)
```python
@router.post("/incidents/{incident_id}/attachments", response_model=AttachmentResponse, status_code=201)
async def upload_incident_attachment(incident_id: UUID, file: UploadFile = File(...), ...):
    incident = IncidentService.get_incident(db, t_id, incident_id)
    if role == "REQUESTER" and str(incident.requester_id) != str(actor_id):
        raise HTTPException(status_code=404, detail="Incident not found.")
    content = await file.read()
    return ITSMAttachmentService.save_attachment(...)
```

### Step 4: Storage Engine & DB Model (`backend/app/core/storage.py` & `backend/app/services/itsm_attachment_service.py`)
- Physical files are stored at `data/uploads/{tenant_id}/{safe_filename}` outside PostgreSQL.
- Database metadata inserted into `public.itsm_attachments`:
  - `target_type`: `"TICKET"`
  - `target_id`: `{ticket_id}`
  - `file_name`: original filename
  - `file_size_bytes`: byte length
  - `mime_type`: content type
  - `storage_path`: relative path
  - `storage_backend`: `"LOCAL"`
  - `checksum_sha256`: SHA-256 hex digest
  - `uploaded_by_id`: requester user ID

### Step 5: Ticket Details Display & Download (`console/src/app/(console)/itsm/incidents/[id]/page.tsx`)
- Fetches metadata via `GET /api/itsm/incidents/{ticket_id}/attachments`.
- Displays attachment card containing paperclip icon, filename, formatted file size in KB, and direct download link.
- Downloads file stream via `GET /api/itsm/attachments/{attachment_id}/download` with `Content-Disposition` header.

---

## 3. Security & Validation Controls
1. **Tenant Isolation**: All queries and file paths enforce `tenant_id` boundaries.
2. **Requester Ownership**: Requesters can only upload, list, or download attachments for tickets they own (`requester_id == actor_id`). Unowned ticket requests return HTTP 404.
3. **Path Traversal Protection**: Storage engine validates that all resolved file paths remain strictly inside `data/uploads/{tenant_id}`.
4. **File Size Limit**: Files exceeding 10 MB are rejected with HTTP 400 Bad Request.
5. **Checksum Verification**: SHA-256 hashes are computed for integrity verification.
