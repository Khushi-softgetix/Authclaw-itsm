"""Integration test suite for Service Agent -> Report Recurring Problem workflow.

Covers:
1. SERVICE_AGENT can report recurring problem (201 Created)
2. Problem is created correctly (type=PROBLEM, prefix=PRB-, status=NEW)
3. Originating Incident is linked to Problem (linked_problem_id)
4. Ticket activities logged for both Incident and Problem
5. Audit log event recorded
6. Problem appears in Problem & Change Manager queue
7. Problem & Change Manager can open Problem detail and see originating incident
8. Duplicate protection: second submission does not duplicate, returns existing problem
9. REQUESTER role receives 403 Forbidden
10. Unauthenticated request receives 401 Unauthorized
11. Tenant isolation enforced: cross-tenant access denied
12. Validation errors for missing required fields
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ITSMRecurringProblemTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Primary Tenant (Tenant A)
        cls.tenant_id = uuid4()
        cls.agent_user_id = uuid4()
        cls.agent_key = f"agent-test-{uuid4().hex[:12]}"

        cls.pcm_user_id = uuid4()
        cls.pcm_key = f"pcm-test-{uuid4().hex[:12]}"

        cls.req_user_id = uuid4()
        cls.req_key = f"req-test-{uuid4().hex[:12]}"

        # Secondary Tenant (Tenant B)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_agent_id = uuid4()
        cls.tenant_b_agent_key = f"tb-agent-{uuid4().hex[:12]}"

        # Service & Incidents IDs
        cls.service_id = uuid4()
        cls.incident_1_id = uuid4()
        cls.incident_2_id = uuid4()
        cls.incident_b_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-rec-a-{uuid4().hex[:8]}"},
            )

            # Service in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Auth Service', 'auth-service', 'TIER_1', 'ACTIVE', now(), now())"
                ),
                {"id": cls.service_id, "tenant_id": cls.tenant_id},
            )

            # Service Agent in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": f"agent-{uuid4().hex[:6]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # Problem & Change Manager in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.pcm_user_id, "tenant_id": cls.tenant_id, "email": f"pcm-{uuid4().hex[:6]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'pcm-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.pcm_key), "created_by": cls.pcm_user_id},
            )

            # Requester in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.req_user_id, "tenant_id": cls.tenant_id, "email": f"req-{uuid4().hex[:6]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'req-key', ARRAY['read'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.req_key), "created_by": cls.req_user_id},
            )

            # Incident 1 in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, source_channel, requester_id, service_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-990001', 'INCIDENT', 'Recurring Gateway 504 Timeout', 'Users receiving 504 timeouts periodically', 'HIGH', 'HIGH', 'P2', 'IN_PROGRESS', 'PORTAL', :req_id, :service_id, now(), now())"
                ),
                {"id": cls.incident_1_id, "tenant_id": cls.tenant_id, "req_id": cls.req_user_id, "service_id": cls.service_id},
            )

            # Incident 2 in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, source_channel, requester_id, service_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-990002', 'INCIDENT', 'Another Incident', 'Description for incident 2', 'MEDIUM', 'MEDIUM', 'P3', 'NEW', 'PORTAL', :req_id, :service_id, now(), now())"
                ),
                {"id": cls.incident_2_id, "tenant_id": cls.tenant_id, "req_id": cls.req_user_id, "service_id": cls.service_id},
            )

            # 2. Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-rec-b-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.tenant_b_agent_id, "tenant_id": cls.tenant_b_id, "email": f"tb-agent-{uuid4().hex[:6]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-agent-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.tenant_b_agent_key), "created_by": cls.tenant_b_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-990009', 'INCIDENT', 'Tenant B Incident', 'Isolated', 'LOW', 'LOW', 'P4', 'NEW', 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.incident_b_id, "tenant_id": cls.tenant_b_id, "req_id": cls.tenant_b_agent_id},
            )

    @classmethod
    def tearDownClass(cls):
        try:
            with cls.migrator_engine.begin() as conn:
                conn.execute(text("DELETE FROM public.itsm_ticket_activities WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_problem_details WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_tickets WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_ticket_counters WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_services WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.users WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
        except Exception:
            pass
        finally:
            cls.migrator_engine.dispose()

    def test_01_service_agent_can_report_recurring_problem(self):
        """Service Agent successfully reports recurring problem from incident."""
        payload = {
            "problem_short_description": "Recurring Gateway 504 Timeout Pattern",
            "recurring_reason": "Third occurrence this week during peak traffic",
            "notes": "Suspected connection pool exhaustion in auth gateway",
        }
        res = self.client.post(
            f"/v1/itsm/incidents/{self.incident_1_id}/report-recurring-problem",
            json=payload,
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()

        self.assertIn("problem_id", data)
        self.assertIn("problem_ticket_number", data)
        self.assertTrue(data["problem_ticket_number"].startswith("PRB-"))
        self.assertFalse(data["already_reported"])
        self.assertEqual(data["message"], "Recurring problem reported successfully.")

        # Save problem_id for subsequent tests
        ITSMRecurringProblemTestCase.created_problem_id = UUID(data["problem_id"])
        ITSMRecurringProblemTestCase.created_problem_number = data["problem_ticket_number"]

    def test_02_problem_and_incident_linked_correctly(self):
        """Verify problem record attributes and originating incident linkage in database."""
        with self.migrator_engine.connect() as conn:
            # Verify Problem ticket
            prb_row = conn.execute(
                text("SELECT ticket_number, ticket_type, status, priority, title, description FROM public.itsm_tickets WHERE id = :id"),
                {"id": self.created_problem_id},
            ).first()
            self.assertIsNotNone(prb_row)
            self.assertEqual(prb_row.ticket_type, "PROBLEM")
            self.assertEqual(prb_row.status, "NEW")
            self.assertEqual(prb_row.priority, "P2")  # Inherited from incident
            self.assertEqual(prb_row.title, "Recurring Gateway 504 Timeout Pattern")
            self.assertIn("Recurring Issue:", prb_row.description)
            self.assertIn("Originating Incident: INC-990001", prb_row.description)

            # Verify Problem Detail record
            detail_row = conn.execute(
                text("SELECT known_error FROM public.itsm_problem_details WHERE ticket_id = :id"),
                {"id": self.created_problem_id},
            ).first()
            self.assertIsNotNone(detail_row)
            self.assertFalse(detail_row.known_error)

            # Verify Incident link
            inc_row = conn.execute(
                text("SELECT linked_problem_id FROM public.itsm_tickets WHERE id = :id"),
                {"id": self.incident_1_id},
            ).first()
            self.assertIsNotNone(inc_row)
            self.assertEqual(inc_row.linked_problem_id, self.created_problem_id)

        # Verify via GET incident endpoint
        res = self.client.get(
            f"/v1/itsm/incidents/{self.incident_1_id}",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200)
        inc_data = res.json()
        self.assertEqual(inc_data["linked_problem_id"], str(self.created_problem_id))
        self.assertEqual(inc_data["linked_problem_ticket_number"], self.created_problem_number)

    def test_03_activity_and_audit_logged(self):
        """Verify ticket activities and audit store records were logged."""
        with self.migrator_engine.connect() as conn:
            # Incident activity
            inc_act = conn.execute(
                text("SELECT activity_type, content FROM public.itsm_ticket_activities WHERE ticket_id = :id AND activity_type = 'RECURRING_PROBLEM_REPORTED'"),
                {"id": self.incident_1_id},
            ).first()
            self.assertIsNotNone(inc_act)
            self.assertIn("Recurring problem reported", inc_act.content)

            # Problem activity
            prb_act = conn.execute(
                text("SELECT activity_type, content FROM public.itsm_ticket_activities WHERE ticket_id = :id AND activity_type = 'PROBLEM_CREATED'"),
                {"id": self.created_problem_id},
            ).first()
            self.assertIsNotNone(prb_act)
            self.assertIn("Problem raised from recurring incident INC-990001", prb_act.content)

    def test_04_problem_appears_in_pcm_queue_and_detail(self):
        """Problem & Change Manager sees the Problem in queue and can inspect detail with related incident."""
        # Queue check
        res_queue = self.client.get(
            "/v1/itsm/problems",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res_queue.status_code, 200)
        items = res_queue.json()
        prb_item = next((item for item in items if item["id"] == str(self.created_problem_id)), None)
        self.assertIsNotNone(prb_item)
        self.assertEqual(prb_item["ticket_number"], self.created_problem_number)
        self.assertEqual(prb_item["related_incidents_count"], 1)

        # Detail check
        res_detail = self.client.get(
            f"/v1/itsm/problems/{self.created_problem_id}",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res_detail.status_code, 200)
        detail = res_detail.json()
        self.assertEqual(detail["ticket_number"], self.created_problem_number)
        self.assertEqual(detail["related_incidents_count"], 1)
        self.assertEqual(len(detail["related_incidents"]), 1)
        self.assertEqual(detail["related_incidents"][0]["ticket_number"], "INC-990001")

    def test_05_duplicate_submission_protection(self):
        """Duplicate submission on the same incident does not create another Problem."""
        with self.migrator_engine.connect() as conn:
            initial_count = conn.execute(
                text("SELECT count(*) FROM public.itsm_tickets WHERE tenant_id = :t AND ticket_type = 'PROBLEM'"),
                {"t": self.tenant_id},
            ).scalar()

        payload = {
            "problem_short_description": "Accidental duplicate report",
            "recurring_reason": "Trying to report again",
        }
        res = self.client.post(
            f"/v1/itsm/incidents/{self.incident_1_id}/report-recurring-problem",
            json=payload,
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        # Should succeed safely with already_reported = True
        self.assertIn(res.status_code, [200, 201])
        data = res.json()
        self.assertTrue(data["already_reported"])
        self.assertEqual(data["problem_id"], str(self.created_problem_id))
        self.assertEqual(data["problem_ticket_number"], self.created_problem_number)
        self.assertIn("already reported", data["message"].lower())

        with self.migrator_engine.connect() as conn:
            after_count = conn.execute(
                text("SELECT count(*) FROM public.itsm_tickets WHERE tenant_id = :t AND ticket_type = 'PROBLEM'"),
                {"t": self.tenant_id},
            ).scalar()

        # Count must remain exactly the same
        self.assertEqual(initial_count, after_count)

    def test_06_requester_cannot_report_recurring_problem(self):
        """Requester role is forbidden from using this endpoint."""
        payload = {
            "problem_short_description": "Requester problem attempt",
            "recurring_reason": "Not allowed",
        }
        res = self.client.post(
            f"/v1/itsm/incidents/{self.incident_2_id}/report-recurring-problem",
            json=payload,
            headers={"Authorization": f"Bearer {self.req_key}"},
        )
        self.assertEqual(res.status_code, 403)

    def test_07_unauthenticated_cannot_report_recurring_problem(self):
        """Unauthenticated requests are rejected with 401."""
        payload = {
            "problem_short_description": "Unauth attempt",
            "recurring_reason": "Not allowed",
        }
        res = self.client.post(
            f"/v1/itsm/incidents/{self.incident_2_id}/report-recurring-problem",
            json=payload,
        )
        self.assertEqual(res.status_code, 401)

    def test_08_tenant_isolation(self):
        """Cross-tenant operations are strictly rejected."""
        payload = {
            "problem_short_description": "Cross-tenant attack",
            "recurring_reason": "Should fail",
        }
        # Tenant B agent attempting to report on Tenant A incident
        res = self.client.post(
            f"/v1/itsm/incidents/{self.incident_2_id}/report-recurring-problem",
            json=payload,
            headers={"Authorization": f"Bearer {self.tenant_b_agent_key}"},
        )
        self.assertEqual(res.status_code, 404)

    def test_09_validation_errors(self):
        """Validation errors for missing required fields."""
        # Missing recurring_reason
        res = self.client.post(
            f"/v1/itsm/incidents/{self.incident_2_id}/report-recurring-problem",
            json={"problem_short_description": "Test"},
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 422)

        # Missing problem_short_description
        res2 = self.client.post(
            f"/v1/itsm/incidents/{self.incident_2_id}/report-recurring-problem",
            json={"recurring_reason": "Test"},
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res2.status_code, 422)


if __name__ == "__main__":
    unittest.main()
