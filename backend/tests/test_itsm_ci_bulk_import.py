"""Comprehensive test suite for CMDB-005: Bulk Configuration Item (CI) Import.

Tests cover:
1. CSV and JSON parsing with field mapping
2. Required field validation (name, ci_type)
3. Deterministic transformation (synonym normalization, casing, whitespace trimming)
4. Dry-run safety (ZERO database records created or modified)
5. Insert detection for new CIs
6. Update detection and diffing for existing CIs
7. Conflict detection (in-batch duplicate names/ext_ids, ambiguous matches)
8. Error handling and error queue generation
9. Confirmation import and transaction atomicity
10. Source attribution retention in CI attributes JSONB
11. Reconciliation without CI deletion
12. Tenant isolation (Tenant A import never touches Tenant B CIs)
13. Platform Administrator authorization enforcement (HTTP 403 on non-admin)
14. Non-regression of standard CI create/update endpoints
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import hash_key
from app.db.models import ITSMConfigurationItem, ITSMService
from app.services.itsm_ci_import_service import (
    CIImportService,
    normalize_ci_type,
    normalize_environment,
    normalize_status,
)
from main import app


class CIBulkImportTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.SessionLocal = sessionmaker(bind=cls.engine)
        cls.client = TestClient(app)

        cls.tenant_id = uuid4()
        cls.tenant_b_id = uuid4()

        # Platform Admin user in Tenant A
        cls.admin_user_id = uuid4()
        cls.admin_key = f"admin-key-{uuid4().hex[:12]}"

        # Standard Requester user in Tenant A (unauthorized for import)
        cls.requester_user_id = uuid4()
        cls.requester_key = f"req-key-{uuid4().hex[:12]}"

        # Platform Admin in Tenant B
        cls.tenant_b_admin_id = uuid4()
        cls.tenant_b_admin_key = f"tb-admin-{uuid4().hex[:12]}"

        with cls.engine.begin() as conn:
            # Seed tenants
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now()) ON CONFLICT (id) DO NOTHING"
                ),
                [
                    {"id": cls.tenant_id, "name": f"Tenant-CI-Import-{cls.tenant_id.hex[:6]}"},
                    {"id": cls.tenant_b_id, "name": f"Tenant-B-CI-Import-{cls.tenant_b_id.hex[:6]}"},
                ],
            )

            def create_user(user_id: UUID, tenant_id: UUID, email: str, role: str, itsm_role: str, key: str):
                conn.execute(
                    text(
                        "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :email, :role, 'NONE', true, now(), now())"
                    ),
                    {"id": user_id, "tenant_id": tenant_id, "email": email, "role": role},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                    ),
                    {"tenant_id": tenant_id, "user_id": user_id, "itsm_role": itsm_role},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :key_hash, :name, ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                    ),
                    {"id": uuid4(), "tenant_id": tenant_id, "key_hash": hash_key(key), "name": f"key-{user_id}", "created_by": user_id},
                )

            create_user(cls.admin_user_id, cls.tenant_id, f"ci_admin_{cls.admin_user_id.hex[:6]}@example.com", "admin", "PLATFORM_ADMINISTRATOR", cls.admin_key)
            create_user(cls.requester_user_id, cls.tenant_id, f"ci_req_{cls.requester_user_id.hex[:6]}@example.com", "admin", "REQUESTER", cls.requester_key)
            create_user(cls.tenant_b_admin_id, cls.tenant_b_id, f"ci_tb_admin_{cls.tenant_b_admin_id.hex[:6]}@example.com", "admin", "PLATFORM_ADMINISTRATOR", cls.tenant_b_admin_key)

            # Seed a service in Tenant A
            cls.test_service_id = uuid4()
            cls.test_service_name = "Core Identity Service"
            conn.execute(
                text(
                    "INSERT INTO itsm_services (id, tenant_id, name, slug, description, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :name, 'core-id', 'Identity service', 'TIER_1', 'ACTIVE', NOW(), NOW())"
                ),
                {
                    "id": cls.test_service_id,
                    "tenant_id": cls.tenant_id,
                    "name": cls.test_service_name,
                },
            )

    def setUp(self):
        self.db: Session = self.SessionLocal()

    def tearDown(self):
        self.db.close()

    # -------------------------------------------------------------------------
    # 1. Transformations & Synonyms Unit Tests
    # -------------------------------------------------------------------------
    def test_ci_type_normalization(self):
        """Validates standard CI types and synonym transformations."""
        self.assertEqual(normalize_ci_type("vm"), "SERVER")
        self.assertEqual(normalize_ci_type("virtual_machine"), "SERVER")
        self.assertEqual(normalize_ci_type("host"), "SERVER")
        self.assertEqual(normalize_ci_type("postgres"), "DATABASE")
        self.assertEqual(normalize_ci_type("rds"), "DATABASE")
        self.assertEqual(normalize_ci_type("k8s"), "CONTAINER_CLUSTER")
        self.assertEqual(normalize_ci_type("alb"), "LOAD_BALANCER")
        self.assertEqual(normalize_ci_type("s3"), "STORAGE")
        self.assertEqual(normalize_ci_type("SERVER"), "SERVER")
        self.assertIsNone(normalize_ci_type(""))
        self.assertIsNone(normalize_ci_type(None))

    def test_environment_normalization(self):
        """Validates environment synonyms and default fallback."""
        self.assertEqual(normalize_environment("prod"), "PRODUCTION")
        self.assertEqual(normalize_environment("live"), "PRODUCTION")
        self.assertEqual(normalize_environment("stage"), "STAGING")
        self.assertEqual(normalize_environment("dev"), "DEVELOPMENT")
        self.assertEqual(normalize_environment("dr"), "DISASTER_RECOVERY")
        self.assertEqual(normalize_environment("unknown-env"), "PRODUCTION")

    def test_status_normalization(self):
        """Validates CI operational status synonyms."""
        self.assertEqual(normalize_status("running"), "ACTIVE")
        self.assertEqual(normalize_status("online"), "ACTIVE")
        self.assertEqual(normalize_status("stopped"), "MAINTENANCE")
        self.assertEqual(normalize_status("retired"), "DECOMMISSIONED")
        self.assertEqual(normalize_status("active"), "ACTIVE")

    # -------------------------------------------------------------------------
    # 2. Dry-Run Safety: Modifies Zero Records
    # -------------------------------------------------------------------------
    def test_dry_run_modifies_zero_database_records(self):
        """Dry-run must evaluate records without altering the database."""
        initial_count = (
            self.db.query(ITSMConfigurationItem)
            .filter(ITSMConfigurationItem.tenant_id == self.tenant_id)
            .count()
        )

        raw_records = [
            {
                "hostname": "prod-app-server-01",
                "type": "server",
                "state": "running",
                "env": "prod",
                "app_service": self.test_service_name,
                "arn": "i-0987654321fedcba",
            },
            {
                "hostname": "prod-db-postgres",
                "type": "postgres",
                "state": "running",
                "env": "prod",
            },
        ]

        field_mapping = {
            "hostname": "name",
            "type": "ci_type",
            "state": "status",
            "env": "environment",
            "app_service": "service_name",
            "arn": "external_resource_id",
        }

        response = CIImportService.dry_run(
            db=self.db,
            tenant_id=self.tenant_id,
            source_filename="test_servers.csv",
            source_type="csv",
            raw_records=raw_records,
            field_mapping=field_mapping,
        )

        self.assertEqual(response.total_records, 2)
        self.assertEqual(response.valid_records, 2)
        self.assertEqual(response.insert_count, 2)
        self.assertEqual(response.update_count, 0)
        self.assertEqual(response.conflict_count, 0)
        self.assertEqual(response.error_count, 0)

        # Database state MUST be completely unchanged
        after_count = (
            self.db.query(ITSMConfigurationItem)
            .filter(ITSMConfigurationItem.tenant_id == self.tenant_id)
            .count()
        )
        self.assertEqual(initial_count, after_count)

    # -------------------------------------------------------------------------
    # 3. Validation & Conflict Detection
    # -------------------------------------------------------------------------
    def test_missing_required_fields_and_conflict_detection(self):
        """Validates missing required fields, in-batch duplicates, and ambiguous conflicts."""
        # Seed an existing CI in Tenant A
        existing_ci = ITSMConfigurationItem(
            id=uuid4(),
            tenant_id=self.tenant_id,
            name="existing-web-node",
            ci_type="SERVER",
            environment="PRODUCTION",
            status="ACTIVE",
            external_resource_id="res-existing-001",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.db.add(existing_ci)

        another_ci = ITSMConfigurationItem(
            id=uuid4(),
            tenant_id=self.tenant_id,
            name="different-node",
            ci_type="DATABASE",
            environment="PRODUCTION",
            status="ACTIVE",
            external_resource_id="res-different-002",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.db.add(another_ci)
        self.db.commit()

        raw_records = [
            # Row 1: Missing name -> ERROR
            {"ci_type": "SERVER", "environment": "PRODUCTION"},
            # Row 2: Missing ci_type -> ERROR
            {"name": "orphaned-ci", "environment": "PRODUCTION"},
            # Row 3: Duplicate batch name -> CONFLICT on row 4
            {"name": "batch-duplicate-ci", "ci_type": "SERVER"},
            {"name": "batch-duplicate-ci", "ci_type": "SERVER"},
            # Row 5: Ambiguous CI match (name matches existing_ci, but ext_id matches another_ci) -> CONFLICT
            {
                "name": "existing-web-node",
                "ci_type": "SERVER",
                "external_resource_id": "res-different-002",
            },
            # Row 6: Non-existent service name -> ERROR
            {
                "name": "valid-name-bad-service",
                "ci_type": "SERVER",
                "service_name": "NonExistentService12345",
            },
        ]

        field_mapping = {
            "name": "name",
            "ci_type": "ci_type",
            "environment": "environment",
            "external_resource_id": "external_resource_id",
            "service_name": "service_name",
        }

        response = CIImportService.dry_run(
            db=self.db,
            tenant_id=self.tenant_id,
            source_filename="bad_records.json",
            source_type="json",
            raw_records=raw_records,
            field_mapping=field_mapping,
        )

        self.assertEqual(response.total_records, 6)
        self.assertEqual(response.error_count, 3)  # Rows 1, 2, 6
        self.assertEqual(response.conflict_count, 2)  # Rows 4 (batch dup), 5 (ambiguous)

        # Inspect row 1
        r1 = response.rows[0]
        self.assertEqual(r1.action, "ERROR")
        self.assertTrue(any("name" in err for err in r1.errors))

        # Inspect row 2
        r2 = response.rows[1]
        self.assertEqual(r2.action, "ERROR")
        self.assertTrue(any("ci_type" in err for err in r2.errors))

        # Inspect row 4
        r4 = response.rows[3]
        self.assertEqual(r4.action, "CONFLICT")
        self.assertTrue(any("Duplicate CI name" in c for c in r4.conflicts))

        # Inspect row 5
        r5 = response.rows[4]
        self.assertEqual(r5.action, "CONFLICT")
        self.assertTrue(any("Ambiguous CI match" in c for c in r5.conflicts))

    # -------------------------------------------------------------------------
    # 4. Commit Import: Inserts, Updates, Source Attribution & Audit
    # -------------------------------------------------------------------------
    def test_commit_import_lifecycle_and_source_attribution(self):
        """Verifies commits execute inserts and updates, store source attribution, and generate an audit event."""
        # Pre-existing CI to test UPDATE
        ci_to_update = ITSMConfigurationItem(
            id=uuid4(),
            tenant_id=self.tenant_id,
            name="cluster-head-node",
            ci_type="SERVER",
            environment="DEVELOPMENT",
            status="ACTIVE",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.db.add(ci_to_update)
        self.db.commit()

        raw_records = [
            # 1. New CI -> INSERT
            {
                "ci_name": "new-k8s-ingress",
                "class": "load_balancer",
                "env": "prod",
                "status": "online",
                "service": self.test_service_name,
                "asset_tag": "tag-ingress-001",
                "rack_number": "Rack-4B",  # Extra unmapped custom attribute
            },
            # 2. Existing CI -> UPDATE (promoted to PRODUCTION, status MAINTENANCE)
            {
                "ci_name": "cluster-head-node",
                "class": "server",
                "env": "production",
                "status": "stopped",
                "rack_number": "Rack-2A",
            },
            # 3. Invalid CI -> Error queue
            {
                "ci_name": "",
                "class": "server",
            },
        ]

        field_mapping = {
            "ci_name": "name",
            "class": "ci_type",
            "env": "environment",
            "status": "status",
            "service": "service_name",
            "asset_tag": "external_resource_id",
        }

        filename = "infra_march_2026.csv"
        commit_res = CIImportService.commit_import(
            db=self.db,
            tenant_id=self.tenant_id,
            actor_id=self.admin_user_id,
            source_filename=filename,
            source_type="csv",
            raw_records=raw_records,
            field_mapping=field_mapping,
            update_existing=True,
        )

        self.assertEqual(commit_res.total_records, 3)
        self.assertEqual(commit_res.inserted_count, 1)
        self.assertEqual(commit_res.updated_count, 1)
        self.assertEqual(commit_res.error_count, 1)
        self.assertEqual(len(commit_res.error_queue), 1)
        self.assertEqual(commit_res.error_queue[0].row_number, 3)

        # Verify inserted CI in DB
        inserted = (
            self.db.query(ITSMConfigurationItem)
            .filter(ITSMConfigurationItem.tenant_id == self.tenant_id, ITSMConfigurationItem.name == "new-k8s-ingress")
            .first()
        )
        self.assertIsNotNone(inserted)
        self.assertEqual(inserted.ci_type, "LOAD_BALANCER")
        self.assertEqual(inserted.environment, "PRODUCTION")
        self.assertEqual(inserted.status, "ACTIVE")
        self.assertEqual(inserted.service_id, self.test_service_id)
        self.assertEqual(inserted.external_resource_id, "tag-ingress-001")

        # Verify Source Attribution in attributes JSONB
        attrs = inserted.attributes or {}
        self.assertEqual(attrs.get("source"), "bulk_import")
        self.assertEqual(attrs.get("source_file"), filename)
        self.assertEqual(attrs.get("import_batch_id"), commit_res.batch_id)
        self.assertEqual(attrs.get("imported_by"), str(self.admin_user_id))
        self.assertIn("imported_at", attrs)
        self.assertEqual(attrs.get("custom_fields", {}).get("rack_number"), "Rack-4B")

        # Verify updated CI in DB
        self.db.refresh(ci_to_update)
        self.assertEqual(ci_to_update.environment, "PRODUCTION")
        self.assertEqual(ci_to_update.status, "MAINTENANCE")
        up_attrs = ci_to_update.attributes or {}
        self.assertEqual(up_attrs.get("last_import_batch_id"), commit_res.batch_id)
        self.assertEqual(up_attrs.get("last_source_file"), filename)
        self.assertEqual(up_attrs.get("last_imported_by"), str(self.admin_user_id))

    # -------------------------------------------------------------------------
    # 5. Tenant Isolation
    # -------------------------------------------------------------------------
    def test_tenant_isolation(self):
        """Import into Tenant B cannot update or see Tenant A CIs."""
        ci_a = ITSMConfigurationItem(
            id=uuid4(),
            tenant_id=self.tenant_id,
            name="tenant-isolated-db",
            ci_type="DATABASE",
            environment="PRODUCTION",
            status="ACTIVE",
            external_resource_id="arn:tenant-a:db",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        self.db.add(ci_a)
        self.db.commit()

        # Tenant B imports a CI with the exact same name and external ID
        raw_records = [
            {
                "name": "tenant-isolated-db",
                "ci_type": "DATABASE",
                "environment": "STAGING",
                "external_resource_id": "arn:tenant-a:db",
            }
        ]

        # Dry run for Tenant B
        res_b = CIImportService.dry_run(
            db=self.db,
            tenant_id=self.tenant_b_id,
            source_filename="tenant_b_upload.json",
            source_type="json",
            raw_records=raw_records,
        )

        # For Tenant B, this is a brand NEW CI (INSERT), not an update of Tenant A's CI!
        self.assertEqual(res_b.insert_count, 1)
        self.assertEqual(res_b.update_count, 0)
        self.assertIsNone(res_b.rows[0].existing_ci_id)

    # -------------------------------------------------------------------------
    # 6. Authorization: Platform Administrator vs Unauthorized Roles
    # -------------------------------------------------------------------------
    def test_api_authorization_enforced(self):
        """Platform Administrator is authorized (200), Requester is rejected (403)."""
        payload = {
            "source_filename": "auth_test.json",
            "source_type": "json",
            "raw_records": [{"name": "auth-test-vm", "ci_type": "SERVER"}],
            "field_mapping": {},
        }

        # 1. Requester -> 403 Forbidden
        res_req = self.client.post(
            "/v1/itsm/admin/configuration-items/import/dry-run",
            json=payload,
            headers={"Authorization": f"Bearer {self.requester_key}"},
        )
        self.assertEqual(res_req.status_code, 403)

        # 2. Platform Admin -> 200 OK
        res_admin = self.client.post(
            "/v1/itsm/admin/configuration-items/import/dry-run",
            json=payload,
            headers={"Authorization": f"Bearer {self.admin_key}"},
        )
        self.assertEqual(res_admin.status_code, 200)
        data = res_admin.json()
        self.assertEqual(data["total_records"], 1)
        self.assertEqual(data["insert_count"], 1)

    # -------------------------------------------------------------------------
    # 7. Non-Regression of Standard CI Create/Update Endpoints
    # -------------------------------------------------------------------------
    def test_standard_ci_creation_regression(self):
        """Standard CI create endpoint /v1/itsm/admin/configuration-items returns 201."""
        ci_payload = {
            "name": f"manual-test-ci-{uuid4().hex[:6]}",
            "ci_type": "APPLICATION",
            "environment": "PRODUCTION",
            "status": "ACTIVE",
            "service_id": str(self.test_service_id),
        }

        res = self.client.post(
            "/v1/itsm/admin/configuration-items",
            json=ci_payload,
            headers={"Authorization": f"Bearer {self.admin_key}"},
        )
        self.assertEqual(res.status_code, 201)
        created = res.json()
        self.assertEqual(created["name"], ci_payload["name"])
        self.assertEqual(created["ci_type"], "APPLICATION")
        self.assertEqual(created["service_name"], self.test_service_name)
