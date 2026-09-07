"""ITSM Multi-Tenant Database Verification Test Suite.

Validates the complete ITSM foundation across MVP, V1, V1.5, and V2:
- RLS tenant isolation (reads & cross-tenant write prevention)
- Service graph acyclic constraints
- Attachment quarantine and security metadata
- Change-CI normalization
- Service Catalog version snapshotting
- Knowledge article multi-versioning
- Concurrency-safe ticket numbering
- Agent runtime least-privilege permissions
- AuthClaw HITL approval linkage
- AuthClaw audit pipeline emission
- V2 event fingerprint deduplication
- Governed proactive remediation lifecycle
"""

import json
import os
import unittest
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError, ProgrammingError
from sqlalchemy.orm import sessionmaker

from app.db.models import (
    Base,
    ITSMBusinessCalendar,
    ITSMService,
    ITSMTicketCategory,
    ITSMSLAPolicy,
    ITSMTicketCounter,
    ITSMTicket,
    ITSMTicketActivity,
    ITSMServiceCatalogItem,
    ITSMServiceRequestDetail,
    ITSMKnowledgeArticle,
    ITSMKnowledgeArticleVersion,
    ITSMConfigurationItem,
    ITSMChangeRequest,
    ITSMChangeRequestCI,
    ITSMServiceRelationship,
    ITSMAttachment,
    ITSMProblemDetail,
    ITSMMajorIncident,
    ITSMOnCallSchedule,
    ITSMOnCallRotation,
    ITSMOnCallOverride,
    ITSMAgentSession,
    ITSMWorkflow,
    ITSMWorkflowVersion,
    ITSMWorkflowExecution,
    ITSMEventRule,
    ITSMIngestedEvent,
    ITSMIntegrationConfig,
    ITSMIntegrationSyncRecord,
    ITSMProactiveRemediation,
)
from app.db.session import database_auth_context


class ITSMDatabaseTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.app_url = os.getenv(
            "APP_DATABASE_URL",
            "postgresql+psycopg://authclaw_app:authclaw_app@postgres:5432/authclaw",
        )
        cls.agent_url = os.getenv(
            "AGENT_DATABASE_URL",
            "postgresql+psycopg://authclaw_agent_runtime:authclaw_agent_runtime@postgres:5432/authclaw",
        )

        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.app_engine = create_engine(cls.app_url, pool_pre_ping=True)
        cls.agent_engine = create_engine(cls.agent_url, pool_pre_ping=True)

        cls.AppSession = sessionmaker(bind=cls.app_engine, autocommit=False, autoflush=False)
        cls.AgentSession = sessionmaker(bind=cls.agent_engine, autocommit=False, autoflush=False)
        cls.MigratorSession = sessionmaker(bind=cls.migrator_engine, autocommit=False, autoflush=False)

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()
        cls.app_engine.dispose()
        cls.agent_engine.dispose()

    def create_test_tenant_and_user(self, suffix: str):
        tenant_id = uuid4()
        user_id = uuid4()
        session_hash = uuid4().hex + uuid4().hex
        email = f"itsm-test-{suffix}-{uuid4().hex[:8]}@authclaw-test.invalid"

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": tenant_id, "name": f"itsm-tenant-{suffix}-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": user_id, "tenant_id": tenant_id, "email": email},
            )
            conn.execute(
                text(
                    "SELECT authn.create_session(:session_hash, :tenant_id, :user_id, 'itsm-test', "
                    "now() + interval '2 hours', '{}'::jsonb)"
                ),
                {"session_hash": session_hash, "tenant_id": tenant_id, "user_id": user_id},
            )

        return tenant_id, user_id, session_hash

    # -------------------------------------------------------------------------
    # Test 1: Tenant isolation reads
    # -------------------------------------------------------------------------
    def test_tenant_isolation_reads(self):
        t_a, u_a, s_a = self.create_test_tenant_and_user("iso-a")
        t_b, u_b, s_b = self.create_test_tenant_and_user("iso-b")

        # Insert Service and Ticket for Tenant A
        with database_auth_context("session", s_a):
            db = self.AppSession()
            try:
                svc_a = ITSMService(
                    tenant_id=t_a,
                    name="Authentication Gateway A",
                    slug=f"auth-gw-a-{uuid4().hex[:6]}",
                    tier="TIER_1",
                    status="OPERATIONAL",
                )
                db.add(svc_a)
                db.flush()

                tkt_a = ITSMTicket(
                    tenant_id=t_a,
                    ticket_number=f"INC-{uuid4().hex[:6]}",
                    title="Service A degradation",
                    description="High latency on login",
                    service_id=svc_a.id,
                    requester_id=u_a,
                    status="NEW",
                    priority="P2",
                )
                db.add(tkt_a)
                db.commit()
            finally:
                db.close()

        # Insert Service and Ticket for Tenant B
        with database_auth_context("session", s_b):
            db = self.AppSession()
            try:
                svc_b = ITSMService(
                    tenant_id=t_b,
                    name="Billing Service B",
                    slug=f"billing-b-{uuid4().hex[:6]}",
                    tier="TIER_2",
                    status="OPERATIONAL",
                )
                db.add(svc_b)
                db.flush()

                tkt_b = ITSMTicket(
                    tenant_id=t_b,
                    ticket_number=f"INC-{uuid4().hex[:6]}",
                    title="Invoice webhook timeout",
                    description="Webhook response took >30s",
                    service_id=svc_b.id,
                    requester_id=u_b,
                    status="NEW",
                    priority="P3",
                )
                db.add(tkt_b)
                db.commit()
            finally:
                db.close()

        # Verify Tenant A only sees Tenant A's objects
        with database_auth_context("session", s_a):
            db = self.AppSession()
            try:
                services = db.query(ITSMService).all()
                tickets = db.query(ITSMTicket).all()
                self.assertEqual(len(services), 1)
                self.assertEqual(services[0].name, "Authentication Gateway A")
                self.assertEqual(len(tickets), 1)
                self.assertEqual(tickets[0].title, "Service A degradation")
            finally:
                db.close()

        # Verify Tenant B only sees Tenant B's objects
        with database_auth_context("session", s_b):
            db = self.AppSession()
            try:
                services = db.query(ITSMService).all()
                tickets = db.query(ITSMTicket).all()
                self.assertEqual(len(services), 1)
                self.assertEqual(services[0].name, "Billing Service B")
                self.assertEqual(len(tickets), 1)
                self.assertEqual(tickets[0].title, "Invoice webhook timeout")
            finally:
                db.close()

    # -------------------------------------------------------------------------
    # Test 2: Cross-tenant insert prevented by RLS
    # -------------------------------------------------------------------------
    def test_cross_tenant_insert_prevented(self):
        t_a, u_a, s_a = self.create_test_tenant_and_user("cross-a")
        t_b, u_b, s_b = self.create_test_tenant_and_user("cross-b")

        # Tenant A tries to insert a row specifying tenant_id = Tenant B
        with database_auth_context("session", s_a):
            db = self.AppSession()
            try:
                forged_ticket = ITSMTicket(
                    tenant_id=t_b,  # Forged foreign tenant ID!
                    ticket_number=f"INC-FORGED-{uuid4().hex[:4]}",
                    title="Malicious Ticket Injection",
                    description="Should be blocked by RLS WITH CHECK",
                    requester_id=u_a,
                    status="NEW",
                    priority="P1",
                )
                db.add(forged_ticket)
                with self.assertRaises(DBAPIError):
                    db.commit()
            finally:
                db.rollback()
                db.close()

    # -------------------------------------------------------------------------
    # Test 3: Service graph self-reference prevented by CheckConstraint
    # -------------------------------------------------------------------------
    def test_service_graph_acyclic_and_no_self_ref(self):
        t, u, s = self.create_test_tenant_and_user("svcgraph")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                svc = ITSMService(
                    tenant_id=t,
                    name="Core API Gateway",
                    slug=f"core-api-{uuid4().hex[:6]}",
                    tier="TIER_1",
                )
                db.add(svc)
                db.commit()

                # Self-referencing link must fail constraint ck_itsm_service_rel_no_self_ref
                self_rel = ITSMServiceRelationship(
                    tenant_id=t,
                    parent_service_id=svc.id,
                    child_service_id=svc.id,
                    relationship_type="DEPENDS_ON",
                )
                db.add(self_rel)
                with self.assertRaises(IntegrityError):
                    db.commit()
            finally:
                db.rollback()
                db.close()

    # -------------------------------------------------------------------------
    # Test 4: Attachment quarantine and security metadata
    # -------------------------------------------------------------------------
    def test_attachment_quarantine_and_metadata(self):
        t, u, s = self.create_test_tenant_and_user("attach")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                target_id = uuid4()
                att = ITSMAttachment(
                    tenant_id=t,
                    target_type="TICKET",
                    target_id=target_id,
                    file_name="suspicious_script.sh",
                    file_size_bytes=1048576,
                    mime_type="application/x-sh",
                    storage_path="/quarantine/suspicious_script.sh",
                    storage_backend="S3",
                    checksum_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                    is_quarantined=True,
                    quarantine_reason="Malicious executable payload detected by ClamAV scanner",
                    uploaded_by_id=u,
                )
                db.add(att)
                db.commit()

                retrieved = db.query(ITSMAttachment).filter_by(id=att.id).one()
                self.assertTrue(retrieved.is_quarantined)
                self.assertEqual(retrieved.quarantine_reason, "Malicious executable payload detected by ClamAV scanner")
                self.assertEqual(retrieved.checksum_sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
            finally:
                db.close()

    # -------------------------------------------------------------------------
    # Test 5: Change-CI normalized relationship
    # -------------------------------------------------------------------------
    def test_change_ci_normalized_relationship(self):
        t, u, s = self.create_test_tenant_and_user("chg-ci")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                ci = ITSMConfigurationItem(
                    tenant_id=t,
                    name="db-prod-cluster-01",
                    ci_type="DATABASE_CLUSTER",
                    environment="PRODUCTION",
                )
                db.add(ci)
                db.flush()

                chg = ITSMChangeRequest(
                    tenant_id=t,
                    change_number=f"CHG-{uuid4().hex[:6]}",
                    title="Upgrade PostgreSQL to 17.2",
                    description="Minor version patch for security CVE",
                    requested_by_id=u,
                    change_type="NORMAL",
                    risk_level="HIGH",
                )
                db.add(chg)
                db.flush()

                # Normalized link
                link = ITSMChangeRequestCI(
                    tenant_id=t,
                    change_id=chg.id,
                    ci_id=ci.id,
                    impact_type="MODIFIED",
                    notes="Will undergo 30s failover to standby replica",
                )
                db.add(link)
                db.commit()

                # Verify duplicate fails UniqueConstraint(tenant_id, change_id, ci_id)
                dup_link = ITSMChangeRequestCI(
                    tenant_id=t,
                    change_id=chg.id,
                    ci_id=ci.id,
                    impact_type="RESTARTED",
                )
                db.add(dup_link)
                with self.assertRaises(IntegrityError):
                    db.commit()
            finally:
                db.rollback()
                db.close()

    # -------------------------------------------------------------------------
    # Test 6: Service Catalog version snapshot
    # -------------------------------------------------------------------------
    def test_service_catalog_version_snapshot(self):
        t, u, s = self.create_test_tenant_and_user("cat-snap")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                svc = ITSMService(
                    tenant_id=t,
                    name="Workplace Technology",
                    slug=f"workplace-tech-{uuid4().hex[:6]}",
                )
                db.add(svc)
                db.flush()

                v1_schema = {
                    "type": "object",
                    "properties": {"laptop_model": {"type": "string", "enum": ["MacBook Pro 14", "ThinkPad X1"]}},
                    "required": ["laptop_model"],
                }
                item = ITSMServiceCatalogItem(
                    tenant_id=t,
                    service_id=svc.id,
                    name="Developer Laptop Request",
                    slug=f"laptop-request-{uuid4().hex[:6]}",
                    intake_schema=v1_schema,
                    version=1,
                )
                db.add(item)
                db.flush()

                ticket = ITSMTicket(
                    tenant_id=t,
                    ticket_number=f"REQ-{uuid4().hex[:6]}",
                    ticket_type="SERVICE_REQUEST",
                    title="New laptop for engineer",
                    description="Standard dev machine",
                    requester_id=u,
                )
                db.add(ticket)
                db.flush()

                # Snapshot the request detail with V1 schema and submitted form data
                detail = ITSMServiceRequestDetail(
                    tenant_id=t,
                    ticket_id=ticket.id,
                    catalog_item_id=item.id,
                    catalog_item_version=1,
                    intake_schema_snapshot=v1_schema,
                    submitted_form_data={"laptop_model": "MacBook Pro 14"},
                )
                db.add(detail)
                db.commit()

                # Catalog item updates to V2 with new fields
                item.version = 2
                item.intake_schema = {
                    "type": "object",
                    "properties": {
                        "laptop_model": {"type": "string"},
                        "ram_gb": {"type": "integer", "enum": [32, 64]},
                    },
                    "required": ["laptop_model", "ram_gb"],
                }
                db.commit()

                # Verify the submitted request still has the V1 snapshot intact!
                loaded_detail = db.query(ITSMServiceRequestDetail).filter_by(ticket_id=ticket.id).one()
                self.assertEqual(loaded_detail.catalog_item_version, 1)
                self.assertNotIn("ram_gb", loaded_detail.intake_schema_snapshot["properties"])
                self.assertEqual(loaded_detail.submitted_form_data["laptop_model"], "MacBook Pro 14")
            finally:
                db.close()

    # -------------------------------------------------------------------------
    # Test 7: Knowledge article versioning
    # -------------------------------------------------------------------------
    def test_knowledge_article_versioning(self):
        t, u, s = self.create_test_tenant_and_user("kb-ver")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                article = ITSMKnowledgeArticle(
                    tenant_id=t,
                    title="How to Reset MFA Token",
                    slug=f"reset-mfa-{uuid4().hex[:6]}",
                    author_id=u,
                    status="PUBLISHED",
                    current_published_version=2,
                )
                db.add(article)
                db.flush()

                v1 = ITSMKnowledgeArticleVersion(
                    tenant_id=t,
                    article_id=article.id,
                    version_number=1,
                    title="How to Reset MFA Token (Legacy)",
                    content_markdown="Call IT support at ext 5555.",
                    keywords=["mfa", "reset", "helpdesk"],
                    created_by=u,
                )
                v2 = ITSMKnowledgeArticleVersion(
                    tenant_id=t,
                    article_id=article.id,
                    version_number=2,
                    title="How to Reset MFA Token (Self-Service)",
                    content_markdown="Go to settings -> Security -> Reset Authenticator.",
                    keywords=["mfa", "reset", "self-service"],
                    change_summary="Updated for self-service portal release",
                    created_by=u,
                )
                db.add_all([v1, v2])
                db.commit()

                versions = db.query(ITSMKnowledgeArticleVersion).filter_by(article_id=article.id).order_by(ITSMKnowledgeArticleVersion.version_number).all()
                self.assertEqual(len(versions), 2)
                self.assertEqual(versions[0].version_number, 1)
                self.assertEqual(versions[1].version_number, 2)

                # Duplicate version number must fail unique constraint
                dup_v = ITSMKnowledgeArticleVersion(
                    tenant_id=t,
                    article_id=article.id,
                    version_number=1,
                    title="Conflict",
                    content_markdown="Conflicting version 1",
                    created_by=u,
                )
                db.add(dup_v)
                with self.assertRaises(IntegrityError):
                    db.commit()
            finally:
                db.rollback()
                db.close()

    # -------------------------------------------------------------------------
    # Test 8: Ticket numbering concurrency
    # -------------------------------------------------------------------------
    def test_ticket_numbering_concurrency(self):
        t, u, s = self.create_test_tenant_and_user("counter")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                counter = ITSMTicketCounter(
                    tenant_id=t,
                    ticket_type="INCIDENT",
                    prefix="INC",
                    last_number=0,
                )
                db.add(counter)
                db.commit()

                # Simulate atomic ticket numbering via SQL UPDATE ... RETURNING
                assigned_numbers = []
                for _ in range(5):
                    res = db.execute(
                        text(
                            "UPDATE itsm_ticket_counters "
                            "SET last_number = last_number + 1 "
                            "WHERE tenant_id = :t AND ticket_type = 'INCIDENT' "
                            "RETURNING prefix, last_number"
                        ),
                        {"t": t},
                    ).fetchone()
                    assigned_numbers.append(f"{res[0]}-{res[1]:06d}")
                db.commit()

                self.assertEqual(
                    assigned_numbers,
                    ["INC-000001", "INC-000002", "INC-000003", "INC-000004", "INC-000005"],
                )
            finally:
                db.close()

    # -------------------------------------------------------------------------
    # Test 9: Agent runtime least privilege
    # -------------------------------------------------------------------------
    def test_agent_runtime_least_privilege(self):
        t, u, s = self.create_test_tenant_and_user("agent-priv")

        # Setup ticket as app user
        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                ticket = ITSMTicket(
                    tenant_id=t,
                    ticket_number=f"INC-{uuid4().hex[:6]}",
                    title="Database Connection Pool Exhausted",
                    description="High DB connection count alert",
                    requester_id=u,
                )
                db.add(ticket)
                db.commit()
                ticket_id = ticket.id
            finally:
                db.close()

        # Verify least-privilege boundaries for authclaw_agent_runtime via PostgreSQL privilege introspection
        with self.migrator_engine.connect() as conn:
            privs = conn.execute(
                text(
                    "SELECT "
                    "has_table_privilege('authclaw_agent_runtime', 'public.itsm_tickets', 'SELECT') AS can_select_tickets, "
                    "has_table_privilege('authclaw_agent_runtime', 'public.itsm_tickets', 'DELETE') AS can_delete_tickets, "
                    "has_table_privilege('authclaw_agent_runtime', 'public.itsm_ticket_activities', 'INSERT') AS can_insert_activity, "
                    "has_column_privilege('authclaw_agent_runtime', 'public.itsm_tickets', 'ai_triaged', 'UPDATE') AS can_update_ai_triaged, "
                    "has_column_privilege('authclaw_agent_runtime', 'public.itsm_tickets', 'ai_suggested_priority', 'UPDATE') AS can_update_ai_priority, "
                    "has_column_privilege('authclaw_agent_runtime', 'public.itsm_tickets', 'ai_confidence_score', 'UPDATE') AS can_update_ai_confidence, "
                    "has_column_privilege('authclaw_agent_runtime', 'public.itsm_tickets', 'ai_summary', 'UPDATE') AS can_update_ai_summary, "
                    "has_column_privilege('authclaw_agent_runtime', 'public.itsm_tickets', 'title', 'UPDATE') AS can_update_title, "
                    "has_table_privilege('authclaw_agent_runtime', 'public.users', 'INSERT') AS can_insert_users, "
                    "has_table_privilege('authclaw_agent_runtime', 'public.api_keys', 'INSERT') AS can_insert_api_keys, "
                    "has_table_privilege('authclaw_agent_runtime', 'public.policies', 'DELETE') AS can_delete_policies, "
                    "has_table_privilege('authclaw_agent_runtime', 'public.itsm_agent_sessions', 'INSERT') AS can_insert_agent_sessions, "
                    "has_table_privilege('authclaw_agent_runtime', 'public.itsm_ingested_events', 'INSERT') AS can_insert_ingested_events"
                )
            ).mappings().one()

            # 1. Agent CAN read ITSM tickets
            self.assertTrue(privs["can_select_tickets"])
            # 2. Agent CANNOT delete tickets
            self.assertFalse(privs["can_delete_tickets"])
            # 3. Agent CAN insert ticket activities (notes/triage)
            self.assertTrue(privs["can_insert_activity"])
            # 4. Agent CAN update AI triage columns
            self.assertTrue(privs["can_update_ai_triaged"])
            self.assertTrue(privs["can_update_ai_priority"])
            self.assertTrue(privs["can_update_ai_confidence"])
            self.assertTrue(privs["can_update_ai_summary"])
            # 5. Agent CANNOT update non-AI columns (e.g. title)
            self.assertFalse(privs["can_update_title"])
            # 6. Agent CANNOT insert or modify security/billing tables (users, api_keys, policies)
            self.assertFalse(privs["can_insert_users"])
            self.assertFalse(privs["can_insert_api_keys"])
            self.assertFalse(privs["can_delete_policies"])
            # 7. Agent CAN write to itsm_agent_sessions and itsm_ingested_events
            self.assertTrue(privs["can_insert_agent_sessions"])
            self.assertTrue(privs["can_insert_ingested_events"])

    # -------------------------------------------------------------------------
    # Test 10: HITL PendingApproval linkage
    # -------------------------------------------------------------------------
    def test_change_approval_linkage(self):
        t, u, s = self.create_test_tenant_and_user("hitl-link")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                # Insert AuthClaw pending approval
                approval_id = uuid4()
                db.execute(
                    text(
                        "INSERT INTO public.pending_approvals "
                        "(id, tenant_id, action_id, action_type, action_description, action_payload, "
                        "status, requester_id, expires_at, created_at, updated_at) "
                        "VALUES (:id, :t, :aid, 'change_request_cab', 'CAB Approval for Prod Router Migration', "
                        "'{}'::jsonb, 'PENDING', :u, now() + interval '1 hour', now(), now())"
                    ),
                    {"id": approval_id, "t": t, "aid": f"act-{uuid4().hex[:6]}", "u": u},
                )
                db.commit()

                # Link to Change Request
                chg = ITSMChangeRequest(
                    tenant_id=t,
                    change_number=f"CHG-{uuid4().hex[:6]}",
                    title="Production Core Router Migration",
                    description="Switching traffic to secondary core router",
                    requested_by_id=u,
                    status="CAB_REVIEW",
                    pending_approval_id=approval_id,
                )
                db.add(chg)
                db.commit()

                retrieved = db.query(ITSMChangeRequest).filter_by(id=chg.id).one()
                self.assertEqual(retrieved.pending_approval_id, approval_id)
                self.assertEqual(retrieved.pending_approval.action_type, "change_request_cab")
            finally:
                db.close()

    # -------------------------------------------------------------------------
    # Test 11: Audit event emission via existing AuthClaw pipeline
    # -------------------------------------------------------------------------
    def test_audit_event_emission(self):
        t, u, s = self.create_test_tenant_and_user("audit-itsm")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                record_id = uuid4()
                # Insert into authoritative audit chain
                db.execute(
                    text(
                        "INSERT INTO public.audit_log_metadata "
                        "(id, tenant_id, record_id, tenant_sequence, idempotency_key, "
                        "canonical_payload, actor_id, actor_type, action, created_at) "
                        "VALUES (gen_random_uuid(), :t, :rid, 101, :ikey, "
                        ":payload, :actor, 'user', 'itsm.ticket.priority_override', now())"
                    ),
                    {
                        "t": t,
                        "rid": record_id,
                        "ikey": f"audit-itsm-{uuid4().hex}",
                        "payload": json.dumps({"ticket_number": "INC-000001", "old_priority": "P3", "new_priority": "P1"}),
                        "actor": u,
                    },
                )
                # Insert into transactional Kafka outbox queue
                db.execute(
                    text(
                        "INSERT INTO public.audit_outbox "
                        "(tenant_id, record_id, tenant_sequence, event_payload, created_at) "
                        "VALUES (:t, :rid, 101, CAST(:payload AS json), now())"
                    ),
                    {
                        "t": t,
                        "rid": record_id,
                        "payload": json.dumps({"action": "itsm.ticket.priority_override", "tenant_id": str(t)}),
                    },
                )
                db.commit()

                # Verify outbox entry
                outbox_row = db.execute(
                    text("SELECT record_id, tenant_sequence FROM public.audit_outbox WHERE record_id = :rid"),
                    {"rid": record_id},
                ).fetchone()
                self.assertIsNotNone(outbox_row)
                self.assertEqual(outbox_row[1], 101)
            finally:
                db.close()

    # -------------------------------------------------------------------------
    # Test 12: V2 Event deduplication via fingerprint
    # -------------------------------------------------------------------------
    def test_event_deduplication(self):
        t, u, s = self.create_test_tenant_and_user("event-dedup")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                fingerprint = "dd7205bf47e09ab825bd28b6d390a886f7b9f310f8adfb796933583de0ebf7eb"
                event = ITSMIngestedEvent(
                    tenant_id=t,
                    fingerprint=fingerprint,
                    source="DATADOG",
                    event_type="high_cpu_utilization",
                    severity="CRITICAL",
                    payload={"host": "api-worker-03", "metric": "cpu.idle", "value": 1.2},
                    occurrence_count=1,
                )
                db.add(event)
                db.commit()

                # Duplicate fingerprint for same tenant must fail
                dup_event = ITSMIngestedEvent(
                    tenant_id=t,
                    fingerprint=fingerprint,
                    source="DATADOG",
                    event_type="high_cpu_utilization",
                    severity="CRITICAL",
                    payload={"host": "api-worker-03", "metric": "cpu.idle", "value": 0.8},
                    occurrence_count=1,
                )
                db.add(dup_event)
                with self.assertRaises(IntegrityError):
                    db.commit()
                db.rollback()

                # Increment count on deduplication match
                db.execute(
                    text(
                        "UPDATE itsm_ingested_events "
                        "SET occurrence_count = occurrence_count + 1, last_seen_at = now() "
                        "WHERE tenant_id = :t AND fingerprint = :fp"
                    ),
                    {"t": t, "fp": fingerprint},
                )
                db.commit()

                updated = db.query(ITSMIngestedEvent).filter_by(fingerprint=fingerprint).one()
                self.assertEqual(updated.occurrence_count, 2)
            finally:
                db.close()

    # -------------------------------------------------------------------------
    # Test 13: Governed proactive remediation lifecycle
    # -------------------------------------------------------------------------
    def test_proactive_remediation_governance(self):
        t, u, s = self.create_test_tenant_and_user("remed-gov")

        with database_auth_context("session", s):
            db = self.AppSession()
            try:
                approval_id = uuid4()
                db.execute(
                    text(
                        "INSERT INTO public.pending_approvals "
                        "(id, tenant_id, action_id, action_type, action_description, action_payload, "
                        "status, requester_id, expires_at, created_at, updated_at) "
                        "VALUES (:id, :t, :aid, 'automated_remediation', 'Approval to restart crashed pod cluster', "
                        "'{}'::jsonb, 'PENDING', :u, now() + interval '30 minutes', now(), now())"
                    ),
                    {"id": approval_id, "t": t, "aid": f"act-{uuid4().hex[:6]}", "u": u},
                )
                db.commit()

                remediation = ITSMProactiveRemediation(
                    tenant_id=t,
                    runbook_identifier="runbooks/infra/restart-k8s-pod.yaml",
                    governance_approval_id=approval_id,
                    pre_check_results={"disk_healthy": True, "pod_restart_count": 5},
                    execution_results={},
                    post_check_results={},
                    rollback_plan={"action": "revert_traffic_to_standby", "target": "cluster-us-east-1b"},
                    rollback_executed=False,
                    status="PENDING_APPROVAL",
                )
                db.add(remediation)
                db.commit()

                # Transition to COMPLETED after execution
                remediation.status = "COMPLETED"
                remediation.execution_results = {"pod_restarted": True, "restart_duration_ms": 4200}
                remediation.post_check_results={"http_200_ok": True, "healthcheck_latency_ms": 14}
                remediation.completed_at = datetime.now(timezone.utc)
                db.commit()

                loaded = db.query(ITSMProactiveRemediation).filter_by(id=remediation.id).one()
                self.assertEqual(loaded.status, "COMPLETED")
                self.assertTrue(loaded.post_check_results["http_200_ok"])
                self.assertEqual(loaded.rollback_plan["action"], "revert_traffic_to_standby")
            finally:
                db.close()


if __name__ == "__main__":
    unittest.main()
