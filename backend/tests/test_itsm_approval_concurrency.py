"""Concurrency, Idempotency, and Atomicity test suite for ITSM Approvals.

Tests:
1. Double-click without key is idempotent (returns 200, exactly 1 audit event, 1 ticket activity).
2. Retry with same Idempotency-Key returns saved result without duplicate side-effects.
3. Reusing Idempotency-Key with conflicting payload (different reason) is rejected with HTTP 409.
4. Reusing Idempotency-Key with conflicting action (approve vs reject) is rejected with HTTP 409.
5. Reusing Idempotency-Key across different approvals is rejected with HTTP 409.
6. Simultaneous Approve and Reject requests (concurrency race) committed atomically without overwrite.
7. Simultaneous duplicate requests (concurrent double-clicks) succeed with exactly 1 audit record.
8. Decision rejected with HTTP 409 when approval is no longer PENDING.
9. Transaction rollback preserves PENDING status if decision fails mid-transaction.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import unittest
from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ITSMApprovalConcurrencyTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        cls.tenant_id = uuid4()
        cls.requester_user_id = uuid4()
        cls.requester_email = f"req-conc-{uuid4().hex[:8]}@example.com"
        cls.requester_key = f"key-req-conc-{uuid4().hex[:12]}"

        cls.manager_user_id = uuid4()
        cls.manager_email = f"mgr-conc-{uuid4().hex[:8]}@example.com"
        cls.manager_key = f"key-mgr-conc-{uuid4().hex[:12]}"

        cls.pcm_user_id = uuid4()
        cls.pcm_email = f"pcm-conc-{uuid4().hex[:8]}@example.com"
        cls.pcm_key = f"key-pcm-conc-{uuid4().hex[:12]}"

        cls.service_id = uuid4()
        cls.catalog_item_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'ENTERPRISE', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"Tenant Approval Concurrency {uuid4().hex[:8]}"},
            )

            def create_test_user(u_id, email, key, itsm_role):
                conn.execute(
                    text(
                        "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :email, 'hash', 'operator', 'NONE', true, now(), now())"
                    ),
                    {"id": u_id, "tenant_id": cls.tenant_id, "email": email},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :key_hash, 'Key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                    ),
                    {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(key), "created_by": u_id},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                    ),
                    {"tenant_id": cls.tenant_id, "user_id": u_id, "itsm_role": itsm_role},
                )

            create_test_user(cls.requester_user_id, cls.requester_email, cls.requester_key, "REQUESTER")
            create_test_user(cls.manager_user_id, cls.manager_email, cls.manager_key, "INCIDENT_MANAGER")
            create_test_user(cls.pcm_user_id, cls.pcm_email, cls.pcm_key, "PROCESS_CHANGE_MANAGER")

            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, status, tier, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Concurrency Cloud', 'concurrency-cloud', 'ACTIVE', 'TIER_1', now(), now())"
                ),
                {"id": cls.service_id, "tenant_id": cls.tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, description, approval_required, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Concurrency Catalog Item', 'concurrency-item', 'Test item', true, true, now(), now())"
                ),
                {"id": cls.catalog_item_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id},
            )

    def _create_approval_fixture(self, title: str = "Test Request") -> tuple[UUID, UUID]:
        app_id = uuid4()
        tkt_id = uuid4()
        tkt_num = f"REQ-CONC-{uuid4().hex[:6].upper()}"
        now = datetime.now(timezone.utc)

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, title, description, ticket_type, status, priority, urgency, impact, requester_id, service_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :ticket_number, :title, 'Request Description', 'SERVICE_REQUEST', 'PENDING', 'P3', 'MEDIUM', 'MEDIUM', :requester_id, :service_id, now(), now())"
                ),
                {
                    "id": tkt_id,
                    "tenant_id": self.tenant_id,
                    "ticket_number": tkt_num,
                    "title": title,
                    "requester_id": self.requester_user_id,
                    "service_id": self.service_id,
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_request_details (id, tenant_id, ticket_id, catalog_item_id, catalog_item_version, intake_schema_snapshot, submitted_form_data, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, :catalog_item_id, 1, '{}', '{}', now())"
                ),
                {
                    "tenant_id": self.tenant_id,
                    "ticket_id": tkt_id,
                    "catalog_item_id": self.catalog_item_id,
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.pending_approvals (id, tenant_id, action_type, action_description, action_id, action_payload, status, requester_id, approver_id, expires_at, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'service_request_approval', :title, :action_id, :payload, 'PENDING', :requester_id, null, :expires_at, now(), now())"
                ),
                {
                    "id": app_id,
                    "tenant_id": self.tenant_id,
                    "title": title,
                    "action_id": str(tkt_id),
                    "payload": json.dumps({"ticket_id": str(tkt_id), "requester_id": str(self.requester_user_id), "requester_email": self.requester_email}),
                    "requester_id": self.requester_user_id,
                    "expires_at": now + timedelta(days=7),
                },
            )
        return app_id, tkt_id

    # 1. Double-click without key is idempotent
    def test_double_click_without_key_is_idempotent(self):
        """Sequential double-click with identical payload returns saved result with exactly 1 audit record."""
        app_id, tkt_id = self._create_approval_fixture("Double Click Test")

        # First click
        res1 = self.client.post(
            f"/v1/itsm/approvals/{app_id}/approve",
            headers={"Authorization": f"Bearer {self.manager_key}"},
            json={"reason": "Approved on click 1"},
        )
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["status"], "APPROVED")

        # Second click (double-click)
        res2 = self.client.post(
            f"/v1/itsm/approvals/{app_id}/approve",
            headers={"Authorization": f"Bearer {self.manager_key}"},
            json={"reason": "Approved on click 1"},
        )
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["status"], "APPROVED")
        self.assertEqual(res2.json()["id"], res1.json()["id"])

        # Verify exactly 1 audit event exists in approval_audit
        with self.migrator_engine.connect() as conn:
            audit_count = conn.execute(
                text("SELECT count(*) FROM public.approval_audit WHERE approval_id = :id"),
                {"id": app_id},
            ).scalar()
            self.assertEqual(audit_count, 1)

            activity_count = conn.execute(
                text("SELECT count(*) FROM public.itsm_ticket_activities WHERE ticket_id = :ticket_id"),
                {"ticket_id": tkt_id},
            ).scalar()
            self.assertEqual(activity_count, 1)

    # 2. Retry with same Idempotency-Key returns saved result
    def test_retry_with_same_idempotency_key_returns_saved_result(self):
        """Repeated identical request with Idempotency-Key returns saved response without duplicate audit entries."""
        app_id, tkt_id = self._create_approval_fixture("Idempotent Retry Test")
        idem_key = f"idem-key-{uuid4().hex[:8]}"

        # First request
        res1 = self.client.post(
            f"/v1/itsm/approvals/{app_id}/approve",
            headers={
                "Authorization": f"Bearer {self.manager_key}",
                "Idempotency-Key": idem_key,
            },
            json={"reason": "Approved for deployment"},
        )
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()
        self.assertEqual(data1["status"], "APPROVED")

        # Retry identical request with same key
        res2 = self.client.post(
            f"/v1/itsm/approvals/{app_id}/approve",
            headers={
                "Authorization": f"Bearer {self.manager_key}",
                "Idempotency-Key": idem_key,
            },
            json={"reason": "Approved for deployment"},
        )
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertEqual(data1["id"], data2["id"])
        self.assertEqual(data1["status"], data2["status"])
        self.assertEqual(data1["ticket_status"], data2["ticket_status"])

        # Check only 1 audit record created
        with self.migrator_engine.connect() as conn:
            audit_count = conn.execute(
                text("SELECT count(*) FROM public.approval_audit WHERE approval_id = :id"),
                {"id": app_id},
            ).scalar()
            self.assertEqual(audit_count, 1)

    # 3. Reusing Idempotency-Key with conflicting payload (different reason) is rejected with HTTP 409
    def test_reusing_idempotency_key_with_different_reason_rejected_with_409(self):
        """Reusing an idempotency key with differing reason payload MUST be rejected with HTTP 409 Conflict."""
        app_id, _ = self._create_approval_fixture("Conflicting Reason Test")
        idem_key = f"idem-key-conflict-{uuid4().hex[:8]}"

        # First request
        res1 = self.client.post(
            f"/v1/itsm/approvals/{app_id}/approve",
            headers={
                "Authorization": f"Bearer {self.manager_key}",
                "Idempotency-Key": idem_key,
            },
            json={"reason": "Original approval reason"},
        )
        self.assertEqual(res1.status_code, 200)

        # Second request with same key but differing reason
        res2 = self.client.post(
            f"/v1/itsm/approvals/{app_id}/approve",
            headers={
                "Authorization": f"Bearer {self.manager_key}",
                "Idempotency-Key": idem_key,
            },
            json={"reason": "Conflicting altered reason"},
        )
        self.assertEqual(res2.status_code, 409)
        self.assertIn("Idempotency key collision", res2.json()["detail"])

    # 4. Reusing Idempotency-Key with conflicting action (approve vs reject) is rejected with HTTP 409
    def test_reusing_idempotency_key_with_conflicting_action_rejected_with_409(self):
        """Reusing an idempotency key with conflicting action (Approve vs Reject) MUST be rejected with HTTP 409 Conflict."""
        app_id, _ = self._create_approval_fixture("Conflicting Action Test")
        idem_key = f"idem-key-action-{uuid4().hex[:8]}"

        # Approved with key
        res1 = self.client.post(
            f"/v1/itsm/approvals/{app_id}/approve",
            headers={
                "Authorization": f"Bearer {self.manager_key}",
                "Idempotency-Key": idem_key,
            },
            json={"reason": "Approved initially"},
        )
        self.assertEqual(res1.status_code, 200)

        # Attempt to reject with same key
        res2 = self.client.post(
            f"/v1/itsm/approvals/{app_id}/reject",
            headers={
                "Authorization": f"Bearer {self.pcm_key}",
                "Idempotency-Key": idem_key,
            },
            json={"reason": "Approved initially"},
        )
        self.assertEqual(res2.status_code, 409)
        self.assertIn("Idempotency key collision", res2.json()["detail"])

    # 5. Reusing Idempotency-Key across different approvals is rejected with HTTP 409
    def test_reusing_idempotency_key_across_different_approvals_rejected_with_409(self):
        """Reusing an idempotency key across different approval requests MUST be rejected with HTTP 409 Conflict."""
        app_id1, _ = self._create_approval_fixture("Approval 1")
        app_id2, _ = self._create_approval_fixture("Approval 2")
        idem_key = f"idem-key-cross-{uuid4().hex[:8]}"

        # Decide approval 1
        res1 = self.client.post(
            f"/v1/itsm/approvals/{app_id1}/approve",
            headers={
                "Authorization": f"Bearer {self.manager_key}",
                "Idempotency-Key": idem_key,
            },
            json={"reason": "Approved"},
        )
        self.assertEqual(res1.status_code, 200)

        # Attempt to use same key on approval 2
        res2 = self.client.post(
            f"/v1/itsm/approvals/{app_id2}/approve",
            headers={
                "Authorization": f"Bearer {self.manager_key}",
                "Idempotency-Key": idem_key,
            },
            json={"reason": "Approved"},
        )
        self.assertEqual(res2.status_code, 409)
        self.assertIn("Idempotency key collision", res2.json()["detail"])

    # 6. Simultaneous Approve and Reject requests (concurrency race)
    def test_simultaneous_approve_and_reject_concurrency(self):
        """Simultaneous Approve and Reject requests are serialized by row lock; exactly one commits, other rejected with 409."""
        app_id, tkt_id = self._create_approval_fixture("Concurrent Race Test")

        def send_approve():
            client = TestClient(app)
            return client.post(
                f"/v1/itsm/approvals/{app_id}/approve",
                headers={"Authorization": f"Bearer {self.manager_key}"},
                json={"reason": "Concurrent approve"},
            )

        def send_reject():
            client = TestClient(app)
            return client.post(
                f"/v1/itsm/approvals/{app_id}/reject",
                headers={"Authorization": f"Bearer {self.pcm_key}"},
                json={"reason": "Concurrent reject"},
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            fut_app = executor.submit(send_approve)
            fut_rej = executor.submit(send_reject)
            res_app = fut_app.result()
            res_rej = fut_rej.result()

        status_codes = [res_app.status_code, res_rej.status_code]
        self.assertIn(200, status_codes)
        self.assertIn(409, status_codes)

        # Verify only one decision was committed to the database
        with self.migrator_engine.connect() as conn:
            approval_row = conn.execute(
                text("SELECT status FROM public.pending_approvals WHERE id = :id"),
                {"id": app_id},
            ).first()
            self.assertIn(approval_row.status, {"APPROVED", "REJECTED"})

            ticket_row = conn.execute(
                text("SELECT status FROM public.itsm_tickets WHERE id = :id"),
                {"id": tkt_id},
            ).first()
            if approval_row.status == "APPROVED":
                self.assertEqual(ticket_row.status, "IN_PROGRESS")
            else:
                self.assertEqual(ticket_row.status, "CANCELLED")

            audit_count = conn.execute(
                text("SELECT count(*) FROM public.approval_audit WHERE approval_id = :id"),
                {"id": app_id},
            ).scalar()
            self.assertEqual(audit_count, 1)

    # 7. Simultaneous duplicate requests (concurrent double-clicks)
    def test_simultaneous_double_click_concurrency(self):
        """Concurrent requests with same Idempotency-Key all return 200, but only 1 decision is recorded in audit."""
        app_id, tkt_id = self._create_approval_fixture("Concurrent Double Click")
        idem_key = f"idem-key-concurrent-{uuid4().hex[:8]}"

        def send_identical_approve():
            client = TestClient(app)
            return client.post(
                f"/v1/itsm/approvals/{app_id}/approve",
                headers={
                    "Authorization": f"Bearer {self.manager_key}",
                    "Idempotency-Key": idem_key,
                },
                json={"reason": "Concurrent identical approve"},
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            futures = [executor.submit(send_identical_approve) for _ in range(3)]
            results = [f.result() for f in futures]

        for r in results:
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["status"], "APPROVED")

        with self.migrator_engine.connect() as conn:
            audit_count = conn.execute(
                text("SELECT count(*) FROM public.approval_audit WHERE approval_id = :id"),
                {"id": app_id},
            ).scalar()
            self.assertEqual(audit_count, 1)

            activity_count = conn.execute(
                text("SELECT count(*) FROM public.itsm_ticket_activities WHERE ticket_id = :ticket_id"),
                {"ticket_id": tkt_id},
            ).scalar()
            self.assertEqual(activity_count, 1)

    # 8. Decision rejected with HTTP 409 when approval is no longer PENDING
    def test_decision_rejected_when_not_pending(self):
        """Attempting to decide an already resolved approval returns HTTP 409 Conflict."""
        app_id, _ = self._create_approval_fixture("Already Resolved Test")

        # Reject it
        res_rej = self.client.post(
            f"/v1/itsm/approvals/{app_id}/reject",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"reason": "Cancelled project"},
        )
        self.assertEqual(res_rej.status_code, 200)
        self.assertEqual(res_rej.json()["status"], "REJECTED")

        # Now attempt to approve it
        res_app = self.client.post(
            f"/v1/itsm/approvals/{app_id}/approve",
            headers={"Authorization": f"Bearer {self.manager_key}"},
            json={"reason": "Try to override rejection"},
        )
        self.assertEqual(res_app.status_code, 409)
        self.assertIn("Approval already resolved", res_app.json()["detail"])

    # 9. Transaction rollback preserves PENDING status if decision fails mid-transaction
    def test_transaction_rollback_preserves_pending_state(self):
        """If an unhandled error occurs before commit, transaction rolls back cleanly leaving status PENDING."""
        from unittest.mock import patch
        app_id, tkt_id = self._create_approval_fixture("Rollback Test")

        # Force an exception right before commit inside _process_approval_decision
        with patch("app.api.v1.endpoints.itsm_approvals.append_audit_event", side_effect=RuntimeError("Simulated audit store explosion")):
            # Note: append_audit_event is wrapped in savepoint, so let's mock db.commit to raise
            pass

        from sqlalchemy.orm import Session
        orig_commit = Session.commit

        def failing_commit(session_self):
            raise RuntimeError("Simulated DB failure during commit")

        with patch.object(Session, "commit", failing_commit):
            try:
                self.client.post(
                    f"/v1/itsm/approvals/{app_id}/approve",
                    headers={"Authorization": f"Bearer {self.manager_key}"},
                    json={"reason": "Will fail during commit"},
                )
            except RuntimeError:
                pass

        # Verify database was rolled back and approval remains PENDING
        with self.migrator_engine.connect() as conn:
            approval_row = conn.execute(
                text("SELECT status FROM public.pending_approvals WHERE id = :id"),
                {"id": app_id},
            ).first()
            self.assertEqual(approval_row.status, "PENDING")

            ticket_row = conn.execute(
                text("SELECT status FROM public.itsm_tickets WHERE id = :id"),
                {"id": tkt_id},
            ).first()
            self.assertEqual(ticket_row.status, "PENDING")


if __name__ == "__main__":
    unittest.main()
