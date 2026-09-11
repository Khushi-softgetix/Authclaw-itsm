"""Comprehensive test suite for ITSM Platform Administrator Employee Invite feature."""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from app.db.models import (
    APIKey,
    ITSMUserAccess,
    OnboardingEmailOTP,
    Tenant,
    User,
)
from app.services.email_service import EmailDeliveryError
from main import app


class ITSMAdminInviteTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        migrator_env = os.getenv("OWNER_DATABASE_URL")
        if not migrator_env or migrator_env in ("null", "None"):
            cls.migrator_url = "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw"
        else:
            cls.migrator_url = migrator_env
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()

    def setUp(self):
        self.deliver_patcher = patch(
            "app.api.v1.endpoints.itsm_admin._deliver_otp",
            return_value=("local_outbox", "123456"),
        )
        self.mock_deliver = self.deliver_patcher.start()

    def tearDown(self):
        self.deliver_patcher.stop()

    def create_fixture_tenant(self, suffix: str, itsm_role: str = "PLATFORM_ADMINISTRATOR"):
        tenant_id = uuid4()
        user_id = uuid4()
        api_key_str = f"test-key-{suffix}-{uuid4().hex[:12]}"
        key_hash = hash_key(api_key_str)

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": tenant_id, "name": f"tenant-{suffix}-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {
                    "id": user_id,
                    "tenant_id": tenant_id,
                    "email": f"admin-{suffix}-{uuid4().hex[:8]}@example.com",
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'test-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": tenant_id,
                    "key_hash": key_hash,
                    "created_by": user_id,
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "itsm_role": itsm_role,
                },
            )

        return tenant_id, user_id, api_key_str

    # 1. Admin invites a new employee
    def test_01_admin_invite_new_employee(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("invite-new")
        headers = {"Authorization": f"Bearer {api_key}"}

        invite_email = f"emp-{uuid4().hex[:8]}@company.demo"
        payload = {
            "email": invite_email,
            "itsm_role": "SERVICE_AGENT",
        }
        res = self.client.post("/v1/itsm/admin/users/invite", json=payload, headers=headers)
        self.assertEqual(res.status_code, 201, res.text)
        data = res.json()
        self.assertEqual(data["status"], "invited")
        self.assertEqual(data["email"], invite_email)
        self.assertEqual(data["itsm_role"], "SERVICE_AGENT")
        self.assertIsNotNone(data["signup_id"])

        # Check user created in DB as inactive
        with self.migrator_engine.connect() as conn:
            user_row = conn.execute(
                text("SELECT id, is_active FROM public.users WHERE tenant_id = :tenant_id AND email = :email"),
                {"tenant_id": tenant_id, "email": invite_email},
            ).first()
            self.assertIsNotNone(user_row)
            self.assertFalse(user_row.is_active)

            # Check itsm_user_access pre-linked
            access_row = conn.execute(
                text("SELECT itsm_role, has_itsm_access FROM public.itsm_user_access WHERE tenant_id = :tenant_id AND user_id = :user_id"),
                {"tenant_id": tenant_id, "user_id": user_row.id},
            ).first()
            self.assertIsNotNone(access_row)
            self.assertEqual(access_row.itsm_role, "SERVICE_AGENT")
            self.assertTrue(access_row.has_itsm_access)

            # Check pending onboarding invite OTP
            otp_row = conn.execute(
                text("SELECT status, purpose FROM public.onboarding_email_otps WHERE tenant_id = :tenant_id AND email = :email"),
                {"tenant_id": tenant_id, "email": invite_email},
            ).first()
            self.assertIsNotNone(otp_row)
            self.assertEqual(otp_row.status, "pending")
            self.assertEqual(otp_row.purpose, "invite")

    # 2. Admin invites an existing active user -> updates ITSM role without creating duplicate
    def test_02_admin_invite_existing_active_user(self):
        tenant_id, admin_id, api_key = self.create_fixture_tenant("invite-exist")
        headers = {"Authorization": f"Bearer {api_key}"}

        existing_user_id = uuid4()
        existing_email = f"existing-{uuid4().hex[:8]}@company.demo"

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": existing_user_id, "tenant_id": tenant_id, "email": existing_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :user_id, 'REQUESTER', true, false, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": tenant_id, "user_id": existing_user_id},
            )

        payload = {
            "email": existing_email,
            "itsm_role": "INCIDENT_MANAGER",
        }
        res = self.client.post("/v1/itsm/admin/users/invite", json=payload, headers=headers)
        self.assertEqual(res.status_code, 201, res.text)
        data = res.json()
        self.assertEqual(data["status"], "already_exists")
        self.assertEqual(data["email"], existing_email)
        self.assertEqual(data["itsm_role"], "INCIDENT_MANAGER")

        with self.migrator_engine.connect() as conn:
            # Check only 1 user exists
            count = conn.execute(
                text("SELECT count(*) FROM public.users WHERE tenant_id = :tenant_id AND email = :email"),
                {"tenant_id": tenant_id, "email": existing_email},
            ).scalar()
            self.assertEqual(count, 1)

            # Check itsm_role updated
            access_row = conn.execute(
                text("SELECT itsm_role, has_itsm_access FROM public.itsm_user_access WHERE tenant_id = :tenant_id AND user_id = :user_id"),
                {"tenant_id": tenant_id, "user_id": existing_user_id},
            ).first()
            self.assertIsNotNone(access_row)
            self.assertEqual(access_row.itsm_role, "INCIDENT_MANAGER")
            self.assertTrue(access_row.has_itsm_access)

    # 3. Non-platform admin receives 403 Forbidden
    def test_03_non_platform_admin_rejected(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("non-admin", itsm_role="REQUESTER")
        headers = {"Authorization": f"Bearer {api_key}"}

        payload = {
            "email": "someone@company.demo",
            "itsm_role": "SERVICE_AGENT",
        }
        res = self.client.post("/v1/itsm/admin/users/invite", json=payload, headers=headers)
        self.assertEqual(res.status_code, 403, res.text)

    # 4. Invalid ITSM role rejected
    def test_04_invalid_role_rejected(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("invalid-role")
        headers = {"Authorization": f"Bearer {api_key}"}

        payload = {
            "email": "test@company.demo",
            "itsm_role": "NOT_A_REAL_ROLE",
        }
        res = self.client.post("/v1/itsm/admin/users/invite", json=payload, headers=headers)
        self.assertEqual(res.status_code, 422, res.text)

    # 5. Invalid email format rejected
    def test_05_invalid_email_rejected(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("invalid-email")
        headers = {"Authorization": f"Bearer {api_key}"}

        payload = {
            "email": "not-valid-email",
            "itsm_role": "SERVICE_AGENT",
        }
        res = self.client.post("/v1/itsm/admin/users/invite", json=payload, headers=headers)
        self.assertEqual(res.status_code, 422, res.text)

    # 6. All 6 approved roles are accepted
    def test_06_all_six_approved_roles_accepted(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("all-roles")
        headers = {"Authorization": f"Bearer {api_key}"}

        roles = [
            "REQUESTER",
            "SERVICE_AGENT",
            "INCIDENT_MANAGER",
            "PROCESS_CHANGE_MANAGER",
            "PLATFORM_ADMINISTRATOR",
            "AUDITOR",
        ]
        for role in roles:
            email = f"emp-{role.lower()}@company.demo"
            payload = {"email": email, "itsm_role": role}
            res = self.client.post("/v1/itsm/admin/users/invite", json=payload, headers=headers)
            self.assertEqual(res.status_code, 201, f"Failed for role {role}: {res.text}")
            self.assertEqual(res.json()["itsm_role"], role)

    # 7. Email delivery failure raises 503
    def test_07_email_delivery_failure_raises_503(self):
        self.mock_deliver.side_effect = EmailDeliveryError("SMTP connection timed out")
        tenant_id, user_id, api_key = self.create_fixture_tenant("delivery-fail")
        headers = {"Authorization": f"Bearer {api_key}"}

        payload = {
            "email": f"emp-fail-{uuid4().hex[:8]}@company.demo",
            "itsm_role": "SERVICE_AGENT",
        }
        res = self.client.post("/v1/itsm/admin/users/invite", json=payload, headers=headers)
        self.assertEqual(res.status_code, 503, res.text)
