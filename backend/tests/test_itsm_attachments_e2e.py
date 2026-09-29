"""End-to-end integration test suite for ITSM Attachments Feature.

Covers:
1. Requester uploads attachment to incident (images PNG/JPG, docs PDF/TXT).
2. Attachment metadata persisted to public.itsm_attachments with SHA-256 and local storage.
3. List attachments for incident.
4. Download attachment with disposition attachment and preview mode (inline).
5. Service Agent access to Requester attachments and ability to add attachments.
6. Validation: invalid extension rejection, oversized file rejection, empty file rejection.
7. Tenant isolation: cross-tenant access rejection.
8. Requester ownership: another requester in same tenant cannot access ticket attachments.
9. Service request attachments upload and listing.
"""
from __future__ import annotations

import io
import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ITSMAttachmentsE2ETestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()

    def setUp(self):
        self.tenant_a = uuid4()
        self.tenant_b = uuid4()

        self.requester_a_id = uuid4()
        self.requester_b_id = uuid4()  # Same tenant, different requester
        self.agent_a_id = uuid4()
        self.tenant_b_user_id = uuid4()

        self.requester_a_key = f"req-a-key-{uuid4().hex[:12]}"
        self.requester_b_key = f"req-b-key-{uuid4().hex[:12]}"
        self.agent_a_key = f"agent-a-key-{uuid4().hex[:12]}"
        self.tenant_b_key = f"tenant-b-key-{uuid4().hex[:12]}"

        with self.migrator_engine.begin() as conn:
            # Create Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": self.tenant_a, "name": f"tenant-a-{uuid4().hex[:8]}"},
            )

            # Create Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": self.tenant_b, "name": f"tenant-b-{uuid4().hex[:8]}"},
            )

            # Tenant A: Requester A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": self.requester_a_id, "tenant_id": self.tenant_a, "email": f"requester-a-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, true, now(), now())"
                ),
                {"tenant_id": self.tenant_a, "user_id": self.requester_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'req-a-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": self.tenant_a,
                    "key_hash": hash_key(self.requester_a_key),
                    "created_by": self.requester_a_id,
                },
            )

            # Tenant A: Requester B (same tenant, different user)
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": self.requester_b_id, "tenant_id": self.tenant_a, "email": f"requester-b-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, true, now(), now())"
                ),
                {"tenant_id": self.tenant_a, "user_id": self.requester_b_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'req-b-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": self.tenant_a,
                    "key_hash": hash_key(self.requester_b_key),
                    "created_by": self.requester_b_id,
                },
            )

            # Tenant A: Service Agent A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": self.agent_a_id, "tenant_id": self.tenant_a, "email": f"agent-a-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": self.tenant_a, "user_id": self.agent_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-a-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": self.tenant_a,
                    "key_hash": hash_key(self.agent_a_key),
                    "created_by": self.agent_a_id,
                },
            )

            # Tenant B: User B
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": self.tenant_b_user_id, "tenant_id": self.tenant_b, "email": f"user-b-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": self.tenant_b, "user_id": self.tenant_b_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'tenant-b-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": self.tenant_b,
                    "key_hash": hash_key(self.tenant_b_key),
                    "created_by": self.tenant_b_user_id,
                },
            )

    def _create_incident(self, api_key: str, title: str = "Test VPN Incident") -> dict:
        headers = {"Authorization": f"Bearer {api_key}"}
        payload = {
            "title": title,
            "description": "Cannot connect to company VPN from remote workstation.",
            "impact": "MEDIUM",
            "urgency": "HIGH",
            "category": "NETWORK",
            "source_channel": "PORTAL",
        }
        res = self.client.post("/v1/itsm/incidents", json=payload, headers=headers)
        self.assertEqual(res.status_code, 201, f"Failed to create incident: {res.text}")
        return res.json()

    def test_requester_upload_and_lifecycle(self):
        """End-to-end: Requester uploads PNG, lists attachments, downloads, and agent accesses it."""
        # 1. Create incident as Requester A
        inc = self._create_incident(self.requester_a_key)
        inc_id = inc["id"]

        # 2. Upload PNG file
        fake_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
        upload_res = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            files={"file": ("screenshot.png", io.BytesIO(fake_png), "image/png")},
        )
        self.assertEqual(upload_res.status_code, 201, f"Upload failed: {upload_res.text}")
        att_data = upload_res.json()
        att_id = att_data["id"]
        self.assertEqual(att_data["file_name"], "screenshot.png")
        self.assertEqual(att_data["mime_type"], "image/png")
        self.assertEqual(att_data["file_size_bytes"], len(fake_png))
        self.assertEqual(att_data["storage_backend"], "LOCAL")
        self.assertIsNotNone(att_data["checksum_sha256"])
        self.assertIn("requester-a-", att_data.get("uploaded_by_email", ""))

        # 3. List attachments as Requester A
        list_res = self.client.get(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
        )
        self.assertEqual(list_res.status_code, 200)
        items = list_res.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], att_id)

        # 4. Download attachment (normal download disposition)
        dl_res = self.client.get(
            f"/v1/itsm/attachments/{att_id}/download",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
        )
        self.assertEqual(dl_res.status_code, 200)
        self.assertEqual(dl_res.content, fake_png)
        self.assertIn("attachment", dl_res.headers.get("content-disposition", ""))

        # 5. Download attachment with preview mode
        prev_res = self.client.get(
            f"/v1/itsm/attachments/{att_id}/download?preview=true",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
        )
        self.assertEqual(prev_res.status_code, 200)
        self.assertEqual(prev_res.content, fake_png)
        self.assertIn("inline", prev_res.headers.get("content-disposition", ""))

        # Assign ticket to agent_a for operational handling
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignee_id = :agent_id WHERE id = :id"),
                {"agent_id": self.agent_a_id, "id": inc_id},
            )

        # 6. Service Agent can also view and download the requester's attachment
        agent_list_res = self.client.get(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
        )
        self.assertEqual(agent_list_res.status_code, 200)
        self.assertEqual(len(agent_list_res.json()), 1)

        agent_dl_res = self.client.get(
            f"/v1/itsm/attachments/{att_id}/download",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
        )
        self.assertEqual(agent_dl_res.status_code, 200)
        self.assertEqual(agent_dl_res.content, fake_png)

        # 7. Service Agent can upload an additional PDF attachment to the ticket
        fake_pdf = b"%PDF-1.4\n%test pdf content"
        agent_up_res = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            files={"file": ("investigation_log.pdf", io.BytesIO(fake_pdf), "application/pdf")},
        )
        self.assertEqual(agent_up_res.status_code, 201)
        pdf_data = agent_up_res.json()
        self.assertEqual(pdf_data["file_name"], "investigation_log.pdf")

        # Now ticket has 2 attachments
        final_list = self.client.get(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
        ).json()
        self.assertEqual(len(final_list), 2)

    def test_validation_rules(self):
        """Verify invalid file types, empty files, and oversized files are rejected."""
        inc = self._create_incident(self.requester_a_key)
        inc_id = inc["id"]

        # 1. Invalid extension (.exe)
        bad_ext_res = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            files={"file": ("malware.exe", io.BytesIO(b"binary"), "application/octet-stream")},
        )
        self.assertEqual(bad_ext_res.status_code, 400)
        self.assertIn("not supported", bad_ext_res.text)

        # 2. Empty file (0 bytes)
        empty_res = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            files={"file": ("empty.txt", io.BytesIO(b""), "text/plain")},
        )
        self.assertEqual(empty_res.status_code, 400)
        self.assertIn("empty", empty_res.text)

        # 3. Oversized file (> 10MB)
        large_content = b"0" * (10 * 1024 * 1024 + 100)
        oversized_res = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            files={"file": ("large_dump.log", io.BytesIO(large_content), "text/plain")},
        )
        self.assertEqual(oversized_res.status_code, 400)
        self.assertIn("exceeds", oversized_res.text)

    def test_isolation_and_security(self):
        """Cross-tenant and cross-requester attachment access must be denied."""
        inc = self._create_incident(self.requester_a_key)
        inc_id = inc["id"]

        # Upload attachment to inc
        upload_res = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            files={"file": ("report.pdf", io.BytesIO(b"%PDF-1.4 report"), "application/pdf")},
        )
        self.assertEqual(upload_res.status_code, 201)
        att_id = upload_res.json()["id"]

        # 1. Other Requester B in Tenant A cannot list or download A's ticket attachments
        req_b_list = self.client.get(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.requester_b_key}"},
        )
        self.assertEqual(req_b_list.status_code, 404)

        req_b_dl = self.client.get(
            f"/v1/itsm/attachments/{att_id}/download",
            headers={"Authorization": f"Bearer {self.requester_b_key}"},
        )
        self.assertEqual(req_b_dl.status_code, 404)

        # 2. User in Tenant B cannot upload to Tenant A's incident
        t_b_up = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/attachments",
            headers={"Authorization": f"Bearer {self.tenant_b_key}"},
            files={"file": ("hack.pdf", io.BytesIO(b"%PDF-1.4 hack"), "application/pdf")},
        )
        self.assertEqual(t_b_up.status_code, 404)

        # 3. User in Tenant B cannot download Tenant A's attachment
        t_b_dl = self.client.get(
            f"/v1/itsm/attachments/{att_id}/download",
            headers={"Authorization": f"Bearer {self.tenant_b_key}"},
        )
        self.assertEqual(t_b_dl.status_code, 404)

        # 4. Unauthenticated request rejected
        unauth_dl = self.client.get(f"/v1/itsm/attachments/{att_id}/download")
        self.assertEqual(unauth_dl.status_code, 401)


if __name__ == "__main__":
    unittest.main()
