"""Integration coverage for standalone Outage & Alerts foundations."""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.auth import hash_key
from app.schemas.itsm_outage_alerts import OutageAlertPublicationRequest
from app.services.itsm_outage_alert_service import OutageAlertService, PublicationAuthorization
from main import app


class OutageAlertIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database_url = os.getenv("OWNER_DATABASE_URL", "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw")
        cls.engine = create_engine(cls.database_url, pool_pre_ping=True)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def create_fixture_tenant(self, suffix: str, role: str = "INCIDENT_MANAGER"):
        tenant_id = uuid4()
        with self.engine.begin() as conn:
            conn.execute(text("INSERT INTO public.tenants (id,name,tier,status,created_at,updated_at) VALUES (:id,:name,'starter','active',now(),now())"), {"id": tenant_id, "name": f"outage-{suffix}-{uuid4().hex[:8]}"})
        user_id, key = self.add_tenant_principal(tenant_id, suffix, role)
        return tenant_id, user_id, key

    def add_tenant_principal(self, tenant_id: UUID, suffix: str, role: str):
        """Create an independently authenticated role in an existing tenant."""
        user_id = uuid4()
        key = f"outage-alert-{suffix}-{uuid4().hex}"
        with self.engine.begin() as conn:
            conn.execute(text("INSERT INTO public.users (id,tenant_id,email,role,platform_role,is_active,created_at,updated_at) VALUES (:id,:tenant,:email,'admin','NONE',true,now(),now())"), {"id": user_id, "tenant": tenant_id, "email": f"{suffix}-{uuid4().hex[:8]}@example.com"})
            conn.execute(text("INSERT INTO public.itsm_user_access (id,tenant_id,user_id,itsm_role,has_itsm_access,has_governance_access,created_at,updated_at) VALUES (:id,:tenant,:user,:role,true,true,now(),now())"), {"id": uuid4(), "tenant": tenant_id, "user": user_id, "role": role})
            conn.execute(text("INSERT INTO public.api_keys (id,tenant_id,key_hash,name,scopes,is_active,expires_at,created_by,created_at,updated_at) VALUES (:id,:tenant,:hash,'outage-test',ARRAY['read','write','admin'],true,now() + interval '1 day',:user,now(),now())"), {"id": uuid4(), "tenant": tenant_id, "hash": hash_key(key), "user": user_id})
        return user_id, key

    def service_session(self, key: str) -> Session:
        session = Session(self.engine)
        session.execute(text("SELECT authn.bind_api_key_context(:credential_hash)"), {"credential_hash": hash_key(key)})
        return session

    @staticmethod
    def headers(key: str):
        return {"Authorization": f"Bearer {key}"}

    def create_draft(self, key: str, title: str = "Payments service interruption"):
        response = self.client.post("/v1/itsm/alerts", json={"title": title, "draft_message": "We are investigating service disruption."}, headers=self.headers(key))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def publish_with_verified_policy(self, tenant_id: UUID, user_id: UUID, key: str, alert_id: str, kind: str, message: str):
        db = self.service_session(key)
        try:
            return OutageAlertService.publish_after_verified_policy(
                db,
                tenant_id=tenant_id,
                actor_id=user_id,
                alert_id=UUID(alert_id),
                payload=OutageAlertPublicationRequest(message=message, idempotency_key=f"test-{kind}-{uuid4()}"),
                publication_type=kind,
                authorization=PublicationAuthorization(approved=True, audience_policy_ref="future-policy-ref"),
            )
        finally:
            db.close()

    def test_draft_is_persisted_and_publish_fails_closed_without_policy(self):
        _, _, key = self.create_fixture_tenant("draft")
        draft = self.create_draft(key)
        self.assertEqual(draft["status"], "DRAFT")
        self.assertFalse(draft["readiness"]["ready"])
        response = self.client.post(f"/v1/itsm/alerts/{draft['id']}/publish", json={"message": draft["draft_message"]}, headers=self.headers(key))
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("pending", response.json()["detail"].lower())
        reread = self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(key)).json()
        self.assertEqual(reread["status"], "DRAFT")
        self.assertEqual(reread["publications"], [])

    def test_verified_publication_lifecycle_is_append_only_and_recovery_is_atomic(self):
        tenant_id, user_id, key = self.create_fixture_tenant("lifecycle")
        draft = self.create_draft(key)
        active = self.publish_with_verified_policy(tenant_id, user_id, key, draft["id"], "INITIAL", "We are investigating.")
        self.assertEqual(active.status, "ACTIVE")
        active = self.publish_with_verified_policy(tenant_id, user_id, key, draft["id"], "UPDATE", "Engineering has identified the fault.")
        self.assertEqual(active.status, "ACTIVE")
        recovered = self.publish_with_verified_policy(tenant_id, user_id, key, draft["id"], "RECOVERY", "Service has recovered.")
        self.assertEqual(recovered.status, "RECOVERED")
        self.assertIsNotNone(recovered.recovered_at)

        detail = self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(key)).json()
        self.assertEqual([item["publication_type"] for item in detail["publications"]], ["INITIAL", "UPDATE", "RECOVERY"])
        self.assertEqual(detail["publications"][-1]["message"], "Service has recovered.")
        self.assertEqual(detail["state_history"][-1]["to_state"], "RECOVERED")
        self.assertEqual(detail["deliveries"][-1]["status"], "PENDING_CONFIGURATION")

        publication_id = detail["publications"][0]["id"]
        with self.assertRaises(Exception):
            with self.engine.begin() as conn:
                conn.execute(text("UPDATE public.itsm_outage_alert_publications SET message='changed' WHERE id=:id"), {"id": UUID(publication_id)})

    def test_delivery_intent_is_idempotent_and_attempts_are_traced(self):
        tenant_id, user_id, key = self.create_fixture_tenant("delivery")
        draft = self.create_draft(key)
        self.publish_with_verified_policy(tenant_id, user_id, key, draft["id"], "INITIAL", "We are investigating.")
        detail = self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(key)).json()
        delivery = detail["deliveries"][0]
        db = self.service_session(key)
        try:
            same = OutageAlertService.create_delivery_intent(
                db,
                tenant_id=tenant_id,
                publication_id=UUID(delivery["publication_id"]),
                idempotency_key=delivery["idempotency_key"],
                correlation_id=UUID(delivery["correlation_id"]),
            )
            self.assertEqual(str(same.id), delivery["id"])
            attempt = OutageAlertService.record_delivery_attempt(
                db,
                tenant_id=tenant_id,
                delivery_id=UUID(delivery["id"]),
                attempt_status="FAILED",
                error_detail="Provider is not configured",
            )
            db.commit()
            self.assertEqual(attempt.attempt_number, 1)
        finally:
            db.close()

    def test_link_is_explicit_tenant_safe_and_incident_resolution_does_not_recover_alert(self):
        tenant_id, user_id, key = self.create_fixture_tenant("link")
        headers = self.headers(key)
        draft = self.create_draft(key)
        self.publish_with_verified_policy(tenant_id, user_id, key, draft["id"], "INITIAL", "We are investigating.")
        incident = self.client.post("/v1/itsm/incidents", json={"title": "Payments outage", "description": "Investigating payments"}, headers=headers)
        self.assertEqual(incident.status_code, 201, incident.text)
        incident_id = incident.json()["id"]
        with self.engine.begin() as conn:
            conn.execute(
                text("INSERT INTO public.itsm_teams (id, tenant_id, name, is_active, created_at, updated_at) VALUES (:id, :tenant_id, 'Payments', true, now(), now())"),
                {"id": uuid4(), "tenant_id": tenant_id},
            )
        link = self.client.post(f"/v1/itsm/alerts/{draft['id']}/links", json={"target_type": "INCIDENT", "target_id": incident_id}, headers=headers)
        self.assertEqual(link.status_code, 201, link.text)
        self.assertEqual(link.json()["incident_id"], incident_id)
        self.assertEqual(self.client.post(f"/v1/itsm/alerts/{draft['id']}/links", json={"target_type": "INCIDENT", "target_id": incident_id}, headers=headers).status_code, 409)

        self.assertEqual(self.client.post(f"/v1/itsm/incidents/{incident_id}/assign", json={"assignment_group": "Payments"}, headers=headers).status_code, 200)
        self.assertEqual(self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "IN_PROGRESS"}, headers=headers).status_code, 200)
        resolved = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "RESOLVED", "resolution_code": "FIXED", "resolution_summary": "Payments restored"}, headers=headers)
        self.assertEqual(resolved.status_code, 200, resolved.text)
        self.assertEqual(self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=headers).json()["status"], "ACTIVE")

    def test_role_actions_and_read_projections_fail_closed(self):
        tenant_id, _, manager_key = self.create_fixture_tenant("manager")
        draft = self.create_draft(manager_key)
        _, service_agent_key = self.add_tenant_principal(tenant_id, "agent", "SERVICE_AGENT")
        _, requester_key = self.add_tenant_principal(tenant_id, "requester", "REQUESTER")
        _, auditor_key = self.add_tenant_principal(tenant_id, "auditor", "AUDITOR")
        _, admin_key = self.add_tenant_principal(tenant_id, "admin", "PLATFORM_ADMIN")

        self.assertEqual(self.client.post("/v1/itsm/alerts", json={"title": "No", "draft_message": "No"}, headers=self.headers(service_agent_key)).status_code, 403)
        requester_list = self.client.get("/v1/itsm/alerts", headers=self.headers(requester_key))
        self.assertEqual(requester_list.status_code, 200, requester_list.text)
        self.assertEqual(requester_list.json()["items"], [])
        self.assertIn("pending", requester_list.json()["visibility_note"].lower())
        auditor = self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(auditor_key))
        self.assertEqual(auditor.status_code, 200, auditor.text)
        self.assertIn("state_history", auditor.json())
        self.assertEqual(self.client.get("/v1/itsm/alerts", headers=self.headers(admin_key)).status_code, 403)

    def test_tenant_isolation_and_audit_evidence(self):
        tenant_id, user_id, key = self.create_fixture_tenant("audit")
        draft = self.create_draft(key)
        self.publish_with_verified_policy(tenant_id, user_id, key, draft["id"], "INITIAL", "We are investigating.")
        _, _, foreign_key = self.create_fixture_tenant("foreign")
        self.assertEqual(self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(foreign_key)).status_code, 404)
        with self.engine.begin() as conn:
            actions = conn.execute(text("SELECT action FROM audit_log_metadata WHERE tenant_id=:tenant AND action LIKE 'outage_alert_%' ORDER BY created_at"), {"tenant": tenant_id}).scalars().all()
        self.assertIn("outage_alert_draft_created", actions)
        self.assertIn("outage_alert_published", actions)

    def test_audience_resolution_by_service_subscription(self):
        tenant_id, manager_id, manager_key = self.create_fixture_tenant("audience")
        
        # 1. Create two services
        service_a_id = uuid4()
        service_b_id = uuid4()
        with self.engine.begin() as conn:
            conn.execute(
                text("INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status) VALUES (:id, :tenant, 'Service A', 'service-a', 'TIER_1', 'OPERATIONAL')"),
                {"id": service_a_id, "tenant": tenant_id},
            )
            conn.execute(
                text("INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status) VALUES (:id, :tenant, 'Service B', 'service-b', 'TIER_1', 'OPERATIONAL')"),
                {"id": service_b_id, "tenant": tenant_id},
            )
            
        # 2. Create users and subscribe them
        req_a_id, req_a_key = self.add_tenant_principal(tenant_id, "req-a", "REQUESTER")
        req_b_id, req_b_key = self.add_tenant_principal(tenant_id, "req-b", "REQUESTER")
        agent_id, agent_key = self.add_tenant_principal(tenant_id, "agent", "SERVICE_AGENT")
        pcm_id, pcm_key = self.add_tenant_principal(tenant_id, "pcm", "PROBLEM_CHANGE_MANAGER")
        
        with self.engine.begin() as conn:
            # req_a -> service_a
            conn.execute(text("INSERT INTO public.itsm_service_subscriptions (id, tenant_id, service_id, user_id) VALUES (:id, :tenant, :service, :user)"), {"id": uuid4(), "tenant": tenant_id, "service": service_a_id, "user": req_a_id})
            # req_b -> service_b
            conn.execute(text("INSERT INTO public.itsm_service_subscriptions (id, tenant_id, service_id, user_id) VALUES (:id, :tenant, :service, :user)"), {"id": uuid4(), "tenant": tenant_id, "service": service_b_id, "user": req_b_id})
            # agent -> service_a
            conn.execute(text("INSERT INTO public.itsm_service_subscriptions (id, tenant_id, service_id, user_id) VALUES (:id, :tenant, :service, :user)"), {"id": uuid4(), "tenant": tenant_id, "service": service_a_id, "user": agent_id})
            # pcm -> service_a
            conn.execute(text("INSERT INTO public.itsm_service_subscriptions (id, tenant_id, service_id, user_id) VALUES (:id, :tenant, :service, :user)"), {"id": uuid4(), "tenant": tenant_id, "service": service_a_id, "user": pcm_id})

        # 3. Create an alert for Service A and publish it
        draft = self.client.post("/v1/itsm/alerts", json={"title": "Service A Outage", "draft_message": "Draft notes", "affected_service_ids": [str(service_a_id)]}, headers=self.headers(manager_key)).json()
        
        # Test: non-managers cannot see DRAFT
        self.assertEqual(self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(req_a_key)).status_code, 404)
        
        # Publish it
        active = self.publish_with_verified_policy(tenant_id, manager_id, manager_key, draft["id"], "INITIAL", "We are down.")
        
        # 4. Verify Requester A (subscribed to Service A)
        res_a = self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(req_a_key))
        self.assertEqual(res_a.status_code, 200, res_a.text)
        data_a = res_a.json()
        self.assertIn("publications", data_a)
        self.assertNotIn("links", data_a)
        self.assertNotIn("draft_message", data_a)
        
        # 5. Verify Requester B (not subscribed to Service A)
        res_b = self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(req_b_key))
        self.assertEqual(res_b.status_code, 404, res_b.text)
        
        # 6. Verify Service Agent (subscribed to Service A)
        res_agent = self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(agent_key))
        self.assertEqual(res_agent.status_code, 200, res_agent.text)
        data_agent = res_agent.json()
        self.assertIn("links", data_agent)
        self.assertNotIn("state_history", data_agent)
        
        # 7. Verify Problem & Change Manager (subscribed to Service A)
        res_pcm = self.client.get(f"/v1/itsm/alerts/{draft['id']}", headers=self.headers(pcm_key))
        self.assertEqual(res_pcm.status_code, 200, res_pcm.text)
        data_pcm = res_pcm.json()
        self.assertIn("state_history", data_pcm)
        self.assertNotIn("draft_message", data_pcm)
