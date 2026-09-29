"""Backend unit tests for Problem and Change Manager Step 9: Knowledge Governance."""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ITSMKnowledgeGovernanceTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Setup primary tenant (Tenant A)
        cls.tenant_id = uuid4()

        # Problem & Change Manager (Tenant A)
        cls.pcm_user_id = uuid4()
        cls.pcm_email = f"pcm-kg-{uuid4().hex[:8]}@example.com"
        cls.pcm_key = f"pcm-kg-{uuid4().hex[:12]}"

        # Requester (Tenant A)
        cls.req_user_id = uuid4()
        cls.req_email = f"req-kg-{uuid4().hex[:8]}@example.com"
        cls.req_key = f"req-kg-{uuid4().hex[:12]}"

        # Service Agent (Tenant A)
        cls.agent_user_id = uuid4()
        cls.agent_email = f"agent-kg-{uuid4().hex[:8]}@example.com"
        cls.agent_key = f"agent-kg-{uuid4().hex[:12]}"

        # User without ITSM access (Tenant A)
        cls.no_itsm_user_id = uuid4()
        cls.no_itsm_key = f"no-itsm-kg-{uuid4().hex[:12]}"

        # Secondary tenant (Tenant B) for tenant isolation
        cls.tenant_b_id = uuid4()
        cls.tb_pcm_user_id = uuid4()
        cls.tb_pcm_key = f"tb-pcm-kg-{uuid4().hex[:12]}"

        # Pre-seeded article in Tenant B
        cls.tb_article_id = uuid4()

        # Pre-seeded service in Tenant A
        cls.service_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # Create Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-kg-a-{uuid4().hex[:8]}"},
            )

            # Pre-seed service in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'VPN Gateway', 'vpn-gw', 'Corporate VPN service', 'TIER_1', 'OPERATIONAL', now(), now())"
                ),
                {"id": cls.service_id, "tenant_id": cls.tenant_id},
            )

            # PCM User in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.pcm_user_id, "tenant_id": cls.tenant_id, "email": cls.pcm_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PROCESS_CHANGE_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'pcm-kg-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.pcm_key), "created_by": cls.pcm_user_id},
            )

            # Requester User in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.req_user_id, "tenant_id": cls.tenant_id, "email": cls.req_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.req_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'req-kg-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.req_key), "created_by": cls.req_user_id},
            )

            # Service Agent User in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'member', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": cls.agent_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-kg-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # Disabled ITSM User in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.no_itsm_user_id, "tenant_id": cls.tenant_id, "email": f"no-itsm-kg-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', false, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.no_itsm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'no-itsm-kg-key', ARRAY['read'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.no_itsm_key), "created_by": cls.no_itsm_user_id},
            )

            # Create Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-kg-b-{uuid4().hex[:8]}"},
            )
            # PCM User in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.tb_pcm_user_id, "tenant_id": cls.tenant_b_id, "email": f"tb-pcm-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PROCESS_CHANGE_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_b_id, "user_id": cls.tb_pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-pcm-kg-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.tb_pcm_key), "created_by": cls.tb_pcm_user_id},
            )
            # Pre-seed article in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.itsm_knowledge_articles (id, tenant_id, title, slug, category, status, current_published_version, author_id, published_at, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Tenant B Secret Article', 'tenant-b-secret-art', 'Security', 'PUBLISHED', 1, :author_id, now(), now(), now())"
                ),
                {"id": cls.tb_article_id, "tenant_id": cls.tenant_b_id, "author_id": cls.tb_pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_knowledge_article_versions (id, tenant_id, article_id, version_number, title, content_markdown, summary, keywords, change_summary, created_by, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :article_id, 1, 'Tenant B Secret Article', 'Super secret doc', 'Secret summary', ARRAY['secret'], 'Initial', :created_by, now())"
                ),
                {"tenant_id": cls.tenant_b_id, "article_id": cls.tb_article_id, "created_by": cls.tb_pcm_user_id},
            )

    def pcm_headers(self):
        return {"Authorization": f"Bearer {self.pcm_key}"}

    def req_headers(self):
        return {"Authorization": f"Bearer {self.req_key}"}

    def agent_headers(self):
        return {"Authorization": f"Bearer {self.agent_key}"}

    def no_itsm_headers(self):
        return {"Authorization": f"Bearer {self.no_itsm_key}"}

    def test_01_unauthenticated_requests_fail_401(self):
        res = self.client.get("/v1/itsm/knowledge")
        self.assertEqual(res.status_code, 401)

        res_post = self.client.post("/v1/itsm/knowledge", json={"title": "Test", "content_markdown": "Test"})
        self.assertEqual(res_post.status_code, 401)

    def test_02_disabled_itsm_access_fails_403(self):
        res = self.client.get("/v1/itsm/knowledge", headers=self.no_itsm_headers())
        self.assertEqual(res.status_code, 403)

        res_post = self.client.post(
            "/v1/itsm/knowledge",
            headers=self.no_itsm_headers(),
            json={"title": "Test", "content_markdown": "Test"},
        )
        self.assertEqual(res_post.status_code, 403)

    def test_03_requester_forbidden_from_governance_actions(self):
        # Create
        res_create = self.client.post(
            "/v1/itsm/knowledge",
            headers=self.req_headers(),
            json={"title": "Forbidden Article", "content_markdown": "Forbidden content"},
        )
        self.assertEqual(res_create.status_code, 403)

        # Update
        fake_id = uuid4()
        res_patch = self.client.patch(
            f"/v1/itsm/knowledge/{fake_id}",
            headers=self.req_headers(),
            json={"title": "Hacked Title"},
        )
        self.assertEqual(res_patch.status_code, 403)

        # Publish
        res_pub = self.client.post(
            f"/v1/itsm/knowledge/{fake_id}/publish",
            headers=self.req_headers(),
        )
        self.assertEqual(res_pub.status_code, 403)

        # Archive
        res_arc = self.client.post(
            f"/v1/itsm/knowledge/{fake_id}/archive",
            headers=self.req_headers(),
        )
        self.assertEqual(res_arc.status_code, 403)

    def test_04_pcm_create_knowledge_article_draft(self):
        payload = {
            "title": "VPN Troubleshooting & Diagnostics",
            "category": "Networking",
            "summary": "Step-by-step diagnostic guide for WireGuard VPN connectivity issues.",
            "content_markdown": "# VPN Troubleshooting\n\n1. Check network route\n2. Verify interface status.",
            "keywords": ["vpn", "wireguard", "network"],
            "service_id": str(self.service_id),
        }
        res = self.client.post("/v1/itsm/knowledge", headers=self.pcm_headers(), json=payload)
        self.assertEqual(res.status_code, 201)
        data = res.json()

        self.assertEqual(data["title"], "VPN Troubleshooting & Diagnostics")
        self.assertEqual(data["status"], "DRAFT")
        self.assertEqual(data["category"], "Networking")
        self.assertEqual(data["version_number"], 1)
        self.assertIsNone(data["current_published_version"])
        self.assertIn("slug", data)
        self.assertEqual(len(data["versions"]), 1)
        self.assertEqual(data["versions"][0]["version_number"], 1)
        self.assertEqual(data["versions"][0]["change_summary"], "Initial draft created")

        # Store for subsequent tests
        ITSMKnowledgeGovernanceTestCase.created_article_id = data["id"]

    def test_05_pcm_get_article_detail_and_versions(self):
        art_id = self.created_article_id
        res = self.client.get(f"/v1/itsm/knowledge/{art_id}", headers=self.pcm_headers())
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["id"], art_id)
        self.assertEqual(data["status"], "DRAFT")

        # Test GET /versions endpoint
        res_ver = self.client.get(f"/v1/itsm/knowledge/{art_id}/versions", headers=self.pcm_headers())
        self.assertEqual(res_ver.status_code, 200)
        versions = res_ver.json()
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0]["version_number"], 1)

    def test_06_pcm_update_article_creates_new_version(self):
        art_id = self.created_article_id
        update_payload = {
            "title": "VPN Troubleshooting & Diagnostics (Updated)",
            "content_markdown": "# VPN Troubleshooting v2\n\n1. Check MTU size\n2. Run ping diagnostics.",
            "summary": "Expanded diagnostic guide including MTU and DNS checks.",
            "change_summary": "Added MTU troubleshooting steps for high-latency connections",
        }
        res = self.client.patch(f"/v1/itsm/knowledge/{art_id}", headers=self.pcm_headers(), json=update_payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["title"], "VPN Troubleshooting & Diagnostics (Updated)")
        self.assertEqual(data["version_number"], 2)
        self.assertEqual(len(data["versions"]), 2)

        # Verify version ordering: latest first
        self.assertEqual(data["versions"][0]["version_number"], 2)
        self.assertEqual(data["versions"][0]["change_summary"], "Added MTU troubleshooting steps for high-latency connections")
        self.assertEqual(data["versions"][1]["version_number"], 1)

    def test_07_pcm_publish_article(self):
        art_id = self.created_article_id
        res = self.client.post(f"/v1/itsm/knowledge/{art_id}/publish", headers=self.pcm_headers())
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["status"], "PUBLISHED")
        self.assertEqual(data["current_published_version"], 2)
        self.assertIsNotNone(data["published_at"])

    def test_08_consumer_can_view_published_article(self):
        art_id = self.created_article_id
        # Service Agent can fetch published article
        res = self.client.get(f"/v1/itsm/knowledge/{art_id}", headers=self.agent_headers())
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "PUBLISHED")

        # Standard list without status defaults to PUBLISHED articles
        res_list = self.client.get("/v1/itsm/knowledge", headers=self.agent_headers())
        self.assertEqual(res_list.status_code, 200)
        items = res_list.json()
        published_ids = [item["id"] for item in items]
        self.assertIn(art_id, published_ids)

    def test_09_pcm_filter_articles_by_status(self):
        # Filter status=PUBLISHED
        res_pub = self.client.get("/v1/itsm/knowledge?status=PUBLISHED", headers=self.pcm_headers())
        self.assertEqual(res_pub.status_code, 200)
        pub_ids = [x["id"] for x in res_pub.json()]
        self.assertIn(self.created_article_id, pub_ids)

        # Filter status=ALL
        res_all = self.client.get("/v1/itsm/knowledge?status=ALL", headers=self.pcm_headers())
        self.assertEqual(res_all.status_code, 200)
        all_ids = [x["id"] for x in res_all.json()]
        self.assertIn(self.created_article_id, all_ids)

    def test_10_pcm_archive_and_restore_draft_article(self):
        art_id = self.created_article_id

        # Archive / Retire
        res_arch = self.client.post(f"/v1/itsm/knowledge/{art_id}/archive", headers=self.pcm_headers())
        self.assertEqual(res_arch.status_code, 200)
        data = res_arch.json()
        self.assertEqual(data["status"], "ARCHIVED")

        # Verify consumer list without status does not include archived article
        res_cons = self.client.get("/v1/itsm/knowledge", headers=self.agent_headers())
        self.assertEqual(res_cons.status_code, 200)
        cons_ids = [x["id"] for x in res_cons.json()]
        self.assertNotIn(art_id, cons_ids)

        # Filter status=ARCHIVED includes it
        res_arch_filter = self.client.get("/v1/itsm/knowledge?status=ARCHIVED", headers=self.pcm_headers())
        self.assertEqual(res_arch_filter.status_code, 200)
        arch_ids = [x["id"] for x in res_arch_filter.json()]
        self.assertIn(art_id, arch_ids)

        # Restore to DRAFT
        res_draft = self.client.post(f"/v1/itsm/knowledge/{art_id}/draft", headers=self.pcm_headers())
        self.assertEqual(res_draft.status_code, 200)
        data_draft = res_draft.json()
        self.assertEqual(data_draft["status"], "DRAFT")

    def test_11_filter_by_service_id(self):
        res = self.client.get(f"/v1/itsm/knowledge?service_id={self.service_id}&status=ALL", headers=self.pcm_headers())
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertTrue(len(items) >= 1)
        for item in items:
            self.assertEqual(item["service_id"], str(self.service_id))

    def test_12_tenant_isolation_cross_tenant_access_denied(self):
        # PCM in Tenant A attempts to view Tenant B article -> 404
        res_get = self.client.get(f"/v1/itsm/knowledge/{self.tb_article_id}", headers=self.pcm_headers())
        self.assertEqual(res_get.status_code, 404)

        # PCM in Tenant A attempts to update Tenant B article -> 404
        res_patch = self.client.patch(
            f"/v1/itsm/knowledge/{self.tb_article_id}",
            headers=self.pcm_headers(),
            json={"title": "Cross-tenant exploit"},
        )
        self.assertEqual(res_patch.status_code, 404)

        # PCM in Tenant A attempts to publish Tenant B article -> 404
        res_pub = self.client.post(f"/v1/itsm/knowledge/{self.tb_article_id}/publish", headers=self.pcm_headers())
        self.assertEqual(res_pub.status_code, 404)

        # PCM in Tenant A attempts to archive Tenant B article -> 404
        res_arc = self.client.post(f"/v1/itsm/knowledge/{self.tb_article_id}/archive", headers=self.pcm_headers())
        self.assertEqual(res_arc.status_code, 404)


if __name__ == "__main__":
    unittest.main()
