"""Backend test suite for Service Agent Knowledge Management (Step 5).

Covers:
1. SERVICE_AGENT can list knowledge articles via GET /v1/itsm/knowledge (200 OK)
2. SERVICE_AGENT can search knowledge articles with keywords (e.g. ?search=VPN)
3. SERVICE_AGENT can filter knowledge articles by category
4. SERVICE_AGENT can retrieve an article detail via GET /v1/itsm/knowledge/{id} (200 OK)
5. Unauthenticated request receives 401 Unauthorized
6. User with disabled ITSM access receives 403 Forbidden
7. Tenant isolation: Agent in Tenant A cannot retrieve Tenant B knowledge article (404 Not Found)
8. Non-existent article returns 404 Not Found
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ServiceAgentKnowledgeTestCase(unittest.TestCase):
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
        cls.agent_user_id = uuid4()
        cls.agent_email = f"agent-kb-{uuid4().hex[:8]}@example.com"
        cls.agent_key = f"agent-kb-{uuid4().hex[:12]}"

        # Setup user without ITSM access
        cls.no_itsm_user_id = uuid4()
        cls.no_itsm_key = f"no-itsm-{uuid4().hex[:12]}"

        # Setup secondary tenant (Tenant B)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_agent_id = uuid4()
        cls.tenant_b_key = f"tb-agent-kb-{uuid4().hex[:12]}"

        # Article IDs
        cls.article_a1_id = uuid4()
        cls.article_a2_id = uuid4()
        cls.article_b1_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-kb-a-{uuid4().hex[:8]}"},
            )
            # Service Agent in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": cls.agent_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-kb-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # User without ITSM access in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.no_itsm_user_id, "tenant_id": cls.tenant_id, "email": f"no-itsm-{uuid4().hex[:8]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'no-itsm-key', ARRAY['read'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.no_itsm_key), "created_by": cls.no_itsm_user_id},
            )

            # Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-kb-b-{uuid4().hex[:8]}"},
            )
            # Service Agent in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.tenant_b_agent_id, "tenant_id": cls.tenant_b_id, "email": f"tb-agent-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-agent-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.tenant_b_key), "created_by": cls.tenant_b_agent_id},
            )

            # Insert Knowledge Articles for Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_knowledge_articles ("
                    "  id, tenant_id, title, slug, category, status, current_published_version, "
                    "  view_count, helpful_count, author_id, published_at, created_at, updated_at"
                    ") VALUES ("
                    "  :id, :tenant_id, 'VPN Troubleshooting Guide', 'vpn-troubleshooting-guide', "
                    "  'Networking', 'PUBLISHED', 1, 10, 5, :author_id, now(), now(), now()"
                    ")"
                ),
                {"id": cls.article_a1_id, "tenant_id": cls.tenant_id, "author_id": cls.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_knowledge_article_versions ("
                    "  id, tenant_id, article_id, version_number, title, content_markdown, "
                    "  summary, keywords, change_summary, created_by, created_at"
                    ") VALUES ("
                    "  gen_random_uuid(), :tenant_id, :article_id, 1, 'VPN Troubleshooting Guide', "
                    "  '# VPN Troubleshooting\nFollow these steps to resolve VPN dropped connections.', "
                    "  'Quick diagnostic steps for corporate VPN connectivity.', "
                    "  ARRAY['vpn', 'network'], 'Initial version', :created_by, now()"
                    ")"
                ),
                {"tenant_id": cls.tenant_id, "article_id": cls.article_a1_id, "created_by": cls.agent_user_id},
            )

            conn.execute(
                text(
                    "INSERT INTO public.itsm_knowledge_articles ("
                    "  id, tenant_id, title, slug, category, status, current_published_version, "
                    "  view_count, helpful_count, author_id, published_at, created_at, updated_at"
                    ") VALUES ("
                    "  :id, :tenant_id, 'Okta SSO Reset Procedure', 'okta-sso-reset-procedure', "
                    "  'Authentication', 'PUBLISHED', 1, 20, 8, :author_id, now(), now(), now()"
                    ")"
                ),
                {"id": cls.article_a2_id, "tenant_id": cls.tenant_id, "author_id": cls.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_knowledge_article_versions ("
                    "  id, tenant_id, article_id, version_number, title, content_markdown, "
                    "  summary, keywords, change_summary, created_by, created_at"
                    ") VALUES ("
                    "  gen_random_uuid(), :tenant_id, :article_id, 1, 'Okta SSO Reset Procedure', "
                    "  '# Okta SSO\nClear cookies and reset MFA tokens for SSO.', "
                    "  'How to reset Okta SSO credentials and clear session cache.', "
                    "  ARRAY['okta', 'sso'], 'Initial version', :created_by, now()"
                    ")"
                ),
                {"tenant_id": cls.tenant_id, "article_id": cls.article_a2_id, "created_by": cls.agent_user_id},
            )

            # Insert Knowledge Article for Tenant B (Isolated)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_knowledge_articles ("
                    "  id, tenant_id, title, slug, category, status, current_published_version, "
                    "  view_count, helpful_count, author_id, published_at, created_at, updated_at"
                    ") VALUES ("
                    "  :id, :tenant_id, 'Tenant B Secret Manual', 'tenant-b-secret-manual', "
                    "  'Security', 'PUBLISHED', 1, 5, 2, :author_id, now(), now(), now()"
                    ")"
                ),
                {"id": cls.article_b1_id, "tenant_id": cls.tenant_b_id, "author_id": cls.tenant_b_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_knowledge_article_versions ("
                    "  id, tenant_id, article_id, version_number, title, content_markdown, "
                    "  summary, keywords, change_summary, created_by, created_at"
                    ") VALUES ("
                    "  gen_random_uuid(), :tenant_id, :article_id, 1, 'Tenant B Secret Manual', "
                    "  '# Tenant B Secret\nConfidential instructions for Tenant B.', "
                    "  'Confidential Tenant B document.', "
                    "  ARRAY['secret', 'confidential'], 'Initial version', :created_by, now()"
                    ")"
                ),
                {"tenant_id": cls.tenant_b_id, "article_id": cls.article_b1_id, "created_by": cls.tenant_b_agent_id},
            )

    def test_01_service_agent_can_list_knowledge(self):
        """Service Agent can list published articles within tenant."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/knowledge", headers=headers)
        self.assertEqual(res.status_code, 200)
        articles = res.json()
        self.assertIsInstance(articles, list)
        self.assertGreaterEqual(len(articles), 2)
        titles = [a["title"] for a in articles]
        self.assertIn("VPN Troubleshooting Guide", titles)
        self.assertIn("Okta SSO Reset Procedure", titles)

    def test_02_service_agent_can_search_knowledge(self):
        """Keyword search returns only matching articles."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/knowledge?search=VPN", headers=headers)
        self.assertEqual(res.status_code, 200)
        articles = res.json()
        self.assertGreaterEqual(len(articles), 1)
        for a in articles:
            self.assertTrue("vpn" in a["title"].lower() or "vpn" in (a.get("summary") or "").lower())

    def test_03_service_agent_can_filter_by_category(self):
        """Filtering by category returns category-matched articles."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/knowledge?category=Authentication", headers=headers)
        self.assertEqual(res.status_code, 200)
        articles = res.json()
        self.assertGreaterEqual(len(articles), 1)
        for a in articles:
            self.assertEqual(a["category"].upper(), "AUTHENTICATION")

    def test_04_service_agent_can_get_article_detail(self):
        """Service Agent can retrieve full markdown content by article UUID."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get(f"/v1/itsm/knowledge/{self.article_a1_id}", headers=headers)
        self.assertEqual(res.status_code, 200)
        detail = res.json()
        self.assertEqual(detail["id"], str(self.article_a1_id))
        self.assertEqual(detail["title"], "VPN Troubleshooting Guide")
        self.assertIn("# VPN Troubleshooting", detail["content_markdown"])
        self.assertEqual(detail["category"], "Networking")

    def test_05_unauthenticated_request_rejected(self):
        """Unauthenticated request must return 401 Unauthorized."""
        res = self.client.get("/v1/itsm/knowledge")
        self.assertEqual(res.status_code, 401)

        res_detail = self.client.get(f"/v1/itsm/knowledge/{self.article_a1_id}")
        self.assertEqual(res_detail.status_code, 401)

    def test_06_disabled_itsm_user_rejected(self):
        """User with has_itsm_access=false must receive 403 Forbidden."""
        headers = {"Authorization": f"Bearer {self.no_itsm_key}"}
        res = self.client.get("/v1/itsm/knowledge", headers=headers)
        self.assertEqual(res.status_code, 403)

    def test_07_tenant_isolation_enforced(self):
        """Service Agent in Tenant A cannot access Tenant B article (404 Not Found)."""
        headers_a = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get(f"/v1/itsm/knowledge/{self.article_b1_id}", headers=headers_a)
        self.assertEqual(res.status_code, 404)

        # But Service Agent in Tenant B CAN access Tenant B article
        headers_b = {"Authorization": f"Bearer {self.tenant_b_key}"}
        res_b = self.client.get(f"/v1/itsm/knowledge/{self.article_b1_id}", headers=headers_b)
        self.assertEqual(res_b.status_code, 200)
        self.assertEqual(res_b.json()["title"], "Tenant B Secret Manual")

    def test_08_nonexistent_article_returns_404(self):
        """Non-existent article UUID returns 404 Not Found."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        random_id = uuid4()
        res = self.client.get(f"/v1/itsm/knowledge/{random_id}", headers=headers)
        self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
