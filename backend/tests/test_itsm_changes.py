import os
import unittest
from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class TestITSMChangeManagement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        cls.tenant_id = uuid4()
        cls.pcm_user_id = uuid4()
        cls.pcm_key = f"pcm-test-{uuid4().hex[:12]}"

        cls.req_user_id = uuid4()
        cls.req_key = f"req-test-{uuid4().hex[:12]}"

        cls.agent_user_id = uuid4()
        cls.agent_key = f"agent-test-{uuid4().hex[:12]}"

        cls.tenant_b_id = uuid4()
        cls.tenant_b_pcm_id = uuid4()
        cls.tenant_b_pcm_key = f"tb-pcm-{uuid4().hex[:12]}"

        cls.service_id = uuid4()
        cls.ci_id = uuid4()

        cls.change_1_id = uuid4()
        cls.change_2_id = uuid4()
        cls.change_3_id = uuid4()
        cls.change_4_id = uuid4()
        cls.change_b1_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenant A
            conn.execute(
                text("INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) VALUES (:id, :name, 'starter', 'active', now(), now())"),
                {"id": cls.tenant_id, "name": f"tenant-change-a-{uuid4().hex[:8]}"},
            )

            # Tenant A - Problem and Change Manager
            conn.execute(
                text("INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"),
                {"id": cls.pcm_user_id, "tenant_id": cls.tenant_id, "email": f"pcm-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text("INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PROCESS_CHANGE_MANAGER', true, true, now(), now())"),
                {"tenant_id": cls.tenant_id, "user_id": cls.pcm_user_id},
            )
            conn.execute(
                text("INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) VALUES (:id, :tenant_id, :key_hash, 'pcm-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.pcm_key), "created_by": cls.pcm_user_id},
            )

            # Tenant A - Requester
            conn.execute(
                text("INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"),
                {"id": cls.req_user_id, "tenant_id": cls.tenant_id, "email": f"req-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text("INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, false, now(), now())"),
                {"tenant_id": cls.tenant_id, "user_id": cls.req_user_id},
            )
            conn.execute(
                text("INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) VALUES (:id, :tenant_id, :key_hash, 'req-key', ARRAY['read'], true, :created_by, now(), now())"),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.req_key), "created_by": cls.req_user_id},
            )

            # Tenant A - Service Agent
            conn.execute(
                text("INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": f"agent-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text("INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"),
                {"tenant_id": cls.tenant_id, "user_id": cls.agent_user_id},
            )
            conn.execute(
                text("INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) VALUES (:id, :tenant_id, :key_hash, 'agent-key', ARRAY['read', 'write'], true, :created_by, now(), now())"),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # 2. Tenant B
            conn.execute(
                text("INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) VALUES (:id, :name, 'starter', 'active', now(), now())"),
                {"id": cls.tenant_b_id, "name": f"tenant-change-b-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text("INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"),
                {"id": cls.tenant_b_pcm_id, "tenant_id": cls.tenant_b_id, "email": f"tb-pcm-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text("INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PROCESS_CHANGE_MANAGER', true, true, now(), now())"),
                {"tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_pcm_id},
            )
            conn.execute(
                text("INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) VALUES (:id, :tenant_id, :key_hash, 'tb-pcm-key', ARRAY['read', 'write'], true, :created_by, now(), now())"),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.tenant_b_pcm_key), "created_by": cls.tenant_b_pcm_id},
            )

            # Service in Tenant A
            conn.execute(
                text("INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, created_at, updated_at) VALUES (:id, :tenant_id, 'Core Authentication Gateway', 'core-auth-gateway', 'Identity auth service', 'TIER_1', 'ACTIVE', now(), now())"),
                {"id": cls.service_id, "tenant_id": cls.tenant_id},
            )

            # Configuration Item in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_configuration_items (id, tenant_id, service_id, name, ci_type, environment, status, attributes, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Edge Gateway Router 01', 'NETWORK_ROUTER', 'PRODUCTION', 'ACTIVE', '{}', now(), now())"
                ),
                {"id": cls.ci_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id},
            )

            # Changes in Tenant A
            # 1. Open (CAB_REVIEW) with affected CI
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, assigned_to_id, assigned_team, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-000001', 'Core Router Firmware Upgrade', 'Scheduled edge router firmware upgrade to v4.2', 'STANDARD', 'LOW', 'LOW', 'CAB_REVIEW', :service_id, :req_by, :assignee, 'Network Operations', now(), now())"
                ),
                {"id": cls.change_1_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id, "req_by": cls.pcm_user_id, "assignee": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_request_cis (id, tenant_id, change_id, ci_id, impact_type, notes, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :change_id, :ci_id, 'PRIMARY_TARGET', 'Direct firmware target', now())"
                ),
                {"tenant_id": cls.tenant_id, "change_id": cls.change_1_id, "ci_id": cls.ci_id},
            )

            # 2. Scheduled
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, assigned_to_id, assigned_team, earliest_start_at, latest_finish_at, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-000002', 'Upgrade PostgreSQL cluster to 17.2', 'Database patch and index re-index', 'NORMAL', 'HIGH', 'HIGH', 'SCHEDULED', :service_id, :req_by, :assignee, 'Database Engineering', now() + interval '1 day', now() + interval '1 day 2 hours', now(), now())"
                ),
                {"id": cls.change_2_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id, "req_by": cls.pcm_user_id, "assignee": cls.pcm_user_id},
            )

            # 3. In Progress (IMPLEMENTING)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, assigned_team, actual_start_at, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-000003', 'Emergency Redis cluster memory expansion', 'Add 32GB RAM nodes during traffic peak', 'EMERGENCY', 'HIGH', 'CRITICAL', 'IMPLEMENTING', :service_id, :req_by, 'Infrastructure Team', now(), now(), now())"
                ),
                {"id": cls.change_3_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id, "req_by": cls.pcm_user_id},
            )

            # 4. Completed
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, assigned_team, actual_finish_at, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-000004', 'TLS certificate renewal for *.authclaw.com', 'Annual cert rotation on API gateways', 'STANDARD', 'LOW', 'LOW', 'COMPLETED', :service_id, :req_by, 'Security Ops', now() - interval '1 hour', now() - interval '1 hour', now())"
                ),
                {"id": cls.change_4_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id, "req_by": cls.pcm_user_id},
            )

            # 5. Change in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-000099', 'Tenant B isolated change', 'Isolated change details', 'STANDARD', 'LOW', 'LOW', 'DRAFT', :req_by, now(), now())"
                ),
                {"id": cls.change_b1_id, "tenant_id": cls.tenant_b_id, "req_by": cls.tenant_b_pcm_id},
            )

    def test_01_unauthenticated_request_is_unauthorized(self):
        res = self.client.get("/v1/itsm/changes")
        self.assertEqual(res.status_code, 401)

    def test_02_requester_is_forbidden(self):
        res = self.client.get(
            "/v1/itsm/changes",
            headers={"Authorization": f"Bearer {self.req_key}"},
        )
        self.assertEqual(res.status_code, 403)

    def test_03_service_agent_is_forbidden(self):
        res = self.client.get(
            "/v1/itsm/changes",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 403)

    def test_04_pcm_can_list_changes(self):
        res = self.client.get(
            "/v1/itsm/changes",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertEqual(len(items), 4)
        numbers = [item["change_number"] for item in items]
        self.assertIn("CHG-000001", numbers)
        self.assertIn("CHG-000002", numbers)
        self.assertIn("CHG-000003", numbers)
        self.assertIn("CHG-000004", numbers)
        self.assertNotIn("CHG-000099", numbers)

    def test_05_pcm_can_get_stats(self):
        res = self.client.get(
            "/v1/itsm/changes/stats",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        stats = res.json()
        self.assertEqual(stats["total"], 4)
        self.assertEqual(stats["open"], 1)
        self.assertEqual(stats["scheduled"], 1)
        self.assertEqual(stats["in_progress"], 1)
        self.assertEqual(stats["completed"], 1)

    def test_06_filter_by_status(self):
        res_open = self.client.get(
            "/v1/itsm/changes?status=OPEN",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res_open.status_code, 200)
        open_items = res_open.json()
        self.assertEqual(len(open_items), 1)
        self.assertEqual(open_items[0]["change_number"], "CHG-000001")

        res_sched = self.client.get(
            "/v1/itsm/changes?status=SCHEDULED",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res_sched.status_code, 200)
        sched_items = res_sched.json()
        self.assertEqual(len(sched_items), 1)
        self.assertEqual(sched_items[0]["change_number"], "CHG-000002")

    def test_07_search_filter(self):
        res_num = self.client.get(
            "/v1/itsm/changes?search=000002",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res_num.status_code, 200)
        items_num = res_num.json()
        self.assertEqual(len(items_num), 1)
        self.assertEqual(items_num[0]["change_number"], "CHG-000002")

        res_title = self.client.get(
            "/v1/itsm/changes?search=Redis",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res_title.status_code, 200)
        items_title = res_title.json()
        self.assertEqual(len(items_title), 1)
        self.assertEqual(items_title[0]["change_number"], "CHG-000003")

    def test_08_get_change_detail(self):
        res = self.client.get(
            f"/v1/itsm/changes/{self.change_2_id}",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        chg = res.json()
        self.assertEqual(chg["change_number"], "CHG-000002")
        self.assertEqual(chg["title"], "Upgrade PostgreSQL cluster to 17.2")
        self.assertEqual(chg["status"], "SCHEDULED")
        self.assertEqual(chg["change_type"], "NORMAL")
        self.assertEqual(chg["risk_level"], "HIGH")
        self.assertEqual(chg["impact_level"], "HIGH")
        self.assertEqual(chg["service_name"], "Core Authentication Gateway")
        self.assertIsNotNone(chg["earliest_start_at"])
        self.assertIsNotNone(chg["latest_finish_at"])

    def test_09_tenant_isolation_cross_tenant_access_denied(self):
        res = self.client.get(
            f"/v1/itsm/changes/{self.change_b1_id}",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 404)

        res_b = self.client.get(
            f"/v1/itsm/changes/{self.change_1_id}",
            headers={"Authorization": f"Bearer {self.tenant_b_pcm_key}"},
        )
        self.assertEqual(res_b.status_code, 404)

    def test_10_get_change_detail_with_affected_cis(self):
        res = self.client.get(
            f"/v1/itsm/changes/{self.change_1_id}",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        chg = res.json()
        self.assertEqual(chg["change_number"], "CHG-000001")
        self.assertIn("affected_cis", chg)
        self.assertEqual(len(chg["affected_cis"]), 1)
        ci_item = chg["affected_cis"][0]
        self.assertEqual(ci_item["name"], "Edge Gateway Router 01")
        self.assertEqual(ci_item["ci_type"], "NETWORK_ROUTER")
        self.assertEqual(ci_item["environment"], "PRODUCTION")
        self.assertEqual(ci_item["impact_type"], "PRIMARY_TARGET")

    def test_11_update_assessment_unauthenticated_is_unauthorized(self):
        res = self.client.patch(
            f"/v1/itsm/changes/{self.change_1_id}/assessment",
            json={"risk_level": "HIGH"},
        )
        self.assertEqual(res.status_code, 401)

    def test_12_update_assessment_forbidden_for_other_roles(self):
        # Requester forbidden
        res_req = self.client.patch(
            f"/v1/itsm/changes/{self.change_1_id}/assessment",
            headers={"Authorization": f"Bearer {self.req_key}"},
            json={"risk_level": "HIGH"},
        )
        self.assertEqual(res_req.status_code, 403)

        # Service Agent forbidden
        res_agent = self.client.patch(
            f"/v1/itsm/changes/{self.change_1_id}/assessment",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"risk_level": "HIGH"},
        )
        self.assertEqual(res_agent.status_code, 403)

    def test_13_update_assessment_success(self):
        payload = {
            "risk_level": "HIGH",
            "impact_level": "MEDIUM",
            "change_type": "NORMAL",
            "description": "Updated reason: Edge router critical CVE patch deployment",
            "implementation_plan": "1. Backup running config\n2. TFTP install firmware v4.2.1\n3. Reload with fallback timer",
            "test_plan": "1. Verify BGP state\n2. Run packet latency probe",
            "backout_plan": "Reboot into secondary firmware partition v4.1.9",
        }
        res = self.client.patch(
            f"/v1/itsm/changes/{self.change_1_id}/assessment",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json=payload,
        )
        self.assertEqual(res.status_code, 200)
        updated = res.json()
        self.assertEqual(updated["risk_level"], "HIGH")
        self.assertEqual(updated["impact_level"], "MEDIUM")
        self.assertEqual(updated["change_type"], "NORMAL")
        self.assertEqual(updated["description"], payload["description"])
        self.assertEqual(updated["implementation_plan"], payload["implementation_plan"])
        self.assertEqual(updated["test_plan"], payload["test_plan"])
        self.assertEqual(updated["backout_plan"], payload["backout_plan"])

    def test_14_update_assessment_invalid_enums_rejected(self):
        res_bad_risk = self.client.patch(
            f"/v1/itsm/changes/{self.change_1_id}/assessment",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"risk_level": "CATASTROPHIC"},
        )
        self.assertEqual(res_bad_risk.status_code, 400)
        self.assertIn("Invalid risk_level", res_bad_risk.json()["detail"])

        res_bad_impact = self.client.patch(
            f"/v1/itsm/changes/{self.change_1_id}/assessment",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"impact_level": "TOTAL_RUIN"},
        )
        self.assertEqual(res_bad_impact.status_code, 400)
        self.assertIn("Invalid impact_level", res_bad_impact.json()["detail"])

        res_bad_type = self.client.patch(
            f"/v1/itsm/changes/{self.change_1_id}/assessment",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"change_type": "HOTFIX_SUPER"},
        )
        self.assertEqual(res_bad_type.status_code, 400)
        self.assertIn("Invalid change_type", res_bad_type.json()["detail"])

    def test_15_update_assessment_cross_tenant_blocked(self):
        # Tenant A PCM tries to update Tenant B change
        res = self.client.patch(
            f"/v1/itsm/changes/{self.change_b1_id}/assessment",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"risk_level": "HIGH"},
        )
        self.assertEqual(res.status_code, 404)

    def test_16_lifecycle_submit_review(self):
        # Create a new draft change to test the full lifecycle forward
        draft_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-990001', 'Test Lifecycle Progression', 'Testing full lifecycle progression', 'STANDARD', 'LOW', 'LOW', 'DRAFT', :service_id, :req_by, now(), now())"
                ),
                {"id": draft_id, "tenant_id": self.tenant_id, "service_id": self.service_id, "req_by": self.pcm_user_id},
            )

        res = self.client.post(
            f"/v1/itsm/changes/{draft_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"action": "submit_review", "notes": "Submitting for CAB review"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "CAB_REVIEW")

    def test_17_lifecycle_approve(self):
        # Create a CAB_REVIEW change
        cab_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-990002', 'CAB Review to Approved', 'Testing approval', 'STANDARD', 'LOW', 'LOW', 'CAB_REVIEW', :service_id, :req_by, now(), now())"
                ),
                {"id": cab_id, "tenant_id": self.tenant_id, "service_id": self.service_id, "req_by": self.pcm_user_id},
            )

        res = self.client.post(
            f"/v1/itsm/changes/{cab_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"action": "approve", "notes": "Approved by Change Manager"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "APPROVED")

    def test_18_lifecycle_schedule(self):
        # Create an APPROVED change
        appr_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-990003', 'Approved to Scheduled', 'Testing scheduling', 'STANDARD', 'LOW', 'LOW', 'APPROVED', :service_id, :req_by, now(), now())"
                ),
                {"id": appr_id, "tenant_id": self.tenant_id, "service_id": self.service_id, "req_by": self.pcm_user_id},
            )

        start_dt = "2026-10-01T02:00:00Z"
        end_dt = "2026-10-01T04:00:00Z"
        res = self.client.post(
            f"/v1/itsm/changes/{appr_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={
                "action": "schedule",
                "earliest_start_at": start_dt,
                "latest_finish_at": end_dt,
                "notes": "Maintenance window booked",
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "SCHEDULED")
        self.assertIsNotNone(data["earliest_start_at"])
        self.assertIsNotNone(data["latest_finish_at"])

    def test_19_lifecycle_start_implementation(self):
        # Create a SCHEDULED change
        sched_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-990004', 'Scheduled to Implementing', 'Testing start implementation', 'STANDARD', 'LOW', 'LOW', 'SCHEDULED', :service_id, :req_by, now(), now())"
                ),
                {"id": sched_id, "tenant_id": self.tenant_id, "service_id": self.service_id, "req_by": self.pcm_user_id},
            )

        res = self.client.post(
            f"/v1/itsm/changes/{sched_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"action": "start_implementation", "implementation_notes": "Starting rollout on primary node"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "IMPLEMENTING")
        self.assertIsNotNone(data["actual_start_at"])

    def test_20_lifecycle_complete_with_validation(self):
        # Create an IMPLEMENTING change
        impl_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-990005', 'Implementing to Completed', 'Testing completion', 'STANDARD', 'LOW', 'LOW', 'IMPLEMENTING', :service_id, :req_by, now(), now())"
                ),
                {"id": impl_id, "tenant_id": self.tenant_id, "service_id": self.service_id, "req_by": self.pcm_user_id},
            )

        res = self.client.post(
            f"/v1/itsm/changes/{impl_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"action": "complete", "validation_notes": "All smoke tests and latency checks passed"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "COMPLETED")
        self.assertIsNotNone(data["actual_finish_at"])
        self.assertEqual(data["test_plan"], "All smoke tests and latency checks passed")

    def test_21_lifecycle_close(self):
        # Create a COMPLETED change
        comp_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-990006', 'Completed to Closed', 'Testing closure', 'STANDARD', 'LOW', 'LOW', 'COMPLETED', :service_id, :req_by, now(), now())"
                ),
                {"id": comp_id, "tenant_id": self.tenant_id, "service_id": self.service_id, "req_by": self.pcm_user_id},
            )

        res = self.client.post(
            f"/v1/itsm/changes/{comp_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"action": "close", "notes": "Governance review complete, closing change"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "CLOSED")

    def test_22_lifecycle_terminal_closed_rejects_transition(self):
        # Create a CLOSED change
        closed_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-990007', 'Closed Change', 'Terminal check', 'STANDARD', 'LOW', 'LOW', 'CLOSED', :service_id, :req_by, now(), now())"
                ),
                {"id": closed_id, "tenant_id": self.tenant_id, "service_id": self.service_id, "req_by": self.pcm_user_id},
            )

        res = self.client.post(
            f"/v1/itsm/changes/{closed_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"action": "start_implementation"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("terminal state", res.json()["detail"].lower())

    def test_23_lifecycle_reject_returns_to_draft(self):
        cab_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-990008', 'CAB Rejection Test', 'Testing rejection to draft', 'STANDARD', 'LOW', 'LOW', 'CAB_REVIEW', :service_id, :req_by, now(), now())"
                ),
                {"id": cab_id, "tenant_id": self.tenant_id, "service_id": self.service_id, "req_by": self.pcm_user_id},
            )

        res = self.client.post(
            f"/v1/itsm/changes/{cab_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"action": "reject", "notes": "Insufficient backout plan details"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "DRAFT")

    def test_24_lifecycle_cancel(self):
        draft_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-990009', 'Cancel Test', 'Testing cancellation', 'STANDARD', 'LOW', 'LOW', 'DRAFT', :service_id, :req_by, now(), now())"
                ),
                {"id": draft_id, "tenant_id": self.tenant_id, "service_id": self.service_id, "req_by": self.pcm_user_id},
            )

        res = self.client.post(
            f"/v1/itsm/changes/{draft_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"action": "cancel", "notes": "Project cancelled by sponsor"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "CANCELLED")

    def test_25_lifecycle_unauthorized_role_rejected(self):
        res = self.client.post(
            f"/v1/itsm/changes/{self.change_1_id}/transition",
            headers={"Authorization": f"Bearer {self.req_key}"},
            json={"action": "approve"},
        )
        self.assertEqual(res.status_code, 403)

    def test_26_lifecycle_tenant_isolation(self):
        res = self.client.post(
            f"/v1/itsm/changes/{self.change_b1_id}/transition",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"action": "approve"},
        )
        self.assertEqual(res.status_code, 404)

    def test_27_get_change_activities(self):
        res = self.client.get(
            f"/v1/itsm/changes/{self.change_1_id}/activities",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        activities = res.json()
        self.assertIsInstance(activities, list)
        self.assertGreaterEqual(len(activities), 1)


if __name__ == "__main__":
    unittest.main()
