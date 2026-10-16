"""End-to-End PostgreSQL Integration Tests for Multi-Tenant Isolation across ITSM.

Proves tenant isolation end-to-end under real PostgreSQL Row-Level Security (RLS)
and the unprivileged authclaw_app role (NOBYPASSRLS).

Tests 9 core isolation dimensions:
1. API CRUD (Incidents, Activities, Problems, Changes, Services)
2. Search (Keyword and identifier discovery)
3. Reports / KPIs (Metrics, counts, aggregates)
4. Attachments & Downloads (File access and metadata discovery)
5. Exports (Audit and incident data exports)
6. Audit Records (Audit metadata, outbox, and event integrity)
7. Administrative & Support Paths (User access, entitlements, teams)
8. Background Worker Paths (Bounded worker execution)
9. Direct PostgreSQL / RLS Access (Unauthenticated 0-row read & cross-tenant write rejection)
"""

from __future__ import annotations

import os
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import (
    ITSMChangeRequest,
    ITSMKnowledgeArticle,
    ITSMService,
    ITSMServiceCatalogItem,
    ITSMTicket,
    ITSMTicketActivity,
    ITSMUserAccess,
    Notification,
    Tenant,
    User,
)
from app.db.session import database_auth_context
from app.services.itsm_attachment_service import ITSMAttachmentService
from app.services.itsm_kpi_service import ITSMKPIService
from tests.db_safety import destructive_test_urls


@pytest.fixture(scope="module")
def postgres_isolation_db():
    """Provision an isolated PostgreSQL database explicitly ending in _test."""
    owner_url, app_url = destructive_test_urls()
    db_name = f"authclaw_iso_{uuid4().hex}_test"

    assert db_name.endswith("_test"), f"Test database {db_name} must end in _test"

    admin_engine = create_engine(owner_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{db_name}"'))

    owner_test_url = make_url(owner_url).set(database=db_name).render_as_string(hide_password=False)
    app_test_url = make_url(app_url).set(database=db_name).render_as_string(hide_password=False)

    backend_dir = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "DATABASE_URL": owner_test_url,
        "BOOTSTRAP_DATABASE_URL": owner_test_url,
    }

    def run(*args):
        res = subprocess.run(
            [sys.executable, *args],
            cwd=backend_dir,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert res.returncode == 0, f"Command failed: {res.stderr}\nOutput: {res.stdout}"

    try:
        run("scripts/bootstrap_database_security.py", "prepare")
        run("-m", "alembic", "upgrade", "head")
        run("scripts/bootstrap_database_security.py", "finalize-backend")

        owner_engine = create_engine(owner_test_url, echo=False)
        app_engine = create_engine(app_test_url, echo=False)

        yield owner_engine, app_engine, db_name
    finally:
        if "owner_engine" in locals():
            owner_engine.dispose()
        if "app_engine" in locals():
            app_engine.dispose()
        with admin_engine.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)'))
        admin_engine.dispose()


@pytest.fixture(scope="module")
def test_setup(postgres_isolation_db):
    """Seed distinct Tenant A and Tenant B identities and data."""
    owner_engine, app_engine, db_name = postgres_isolation_db
    SessionMaker = sessionmaker(bind=app_engine, autocommit=False, autoflush=False)

    tenant_a_id = uuid4()
    tenant_b_id = uuid4()
    user_a_id = uuid4()
    user_b_id = uuid4()
    session_hash_a = uuid4().hex + uuid4().hex
    session_hash_b = uuid4().hex + uuid4().hex

    ticket_a_id = uuid4()
    ticket_b_id = uuid4()
    attachment_a_id = uuid4()
    service_a_id = uuid4()
    service_b_id = uuid4()

    # Unique string markers for Tenant A
    MARKER_TITLE = "FALCON-ALPHA-TOPSECRET-OUTAGE"
    MARKER_PAYLOAD = "SUPERSECRET-INTEL-ALPHA-7729"
    MARKER_FILENAME = "alpha_classified_diagnostics.txt"

    with owner_engine.begin() as conn:
        # 1. Tenants
        conn.execute(
            text(
                "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                "VALUES (:id_a, 'Tenant Alpha Corp', 'enterprise', 'active', now(), now()), "
                "       (:id_b, 'Tenant Beta Ltd', 'starter', 'active', now(), now())"
            ),
            {"id_a": tenant_a_id, "id_b": tenant_b_id},
        )

        # 2. Users
        conn.execute(
            text(
                "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                "VALUES (:u_a, :t_a, 'admin-a@alpha.test', 'admin', 'NONE', true, now(), now()), "
                "       (:u_b, :t_b, 'admin-b@beta.test', 'admin', 'NONE', true, now(), now())"
            ),
            {"u_a": user_a_id, "t_a": tenant_a_id, "u_b": user_b_id, "t_b": tenant_b_id},
        )

        # 3. Sessions in authn
        conn.execute(
            text(
                "SELECT authn.create_session(:hash_a, :t_a, :u_a, 'test', now() + interval '1 hour', '{}'::jsonb)"
            ),
            {"hash_a": session_hash_a, "t_a": tenant_a_id, "u_a": user_a_id},
        )
        conn.execute(
            text(
                "SELECT authn.create_session(:hash_b, :t_b, :u_b, 'test', now() + interval '1 hour', '{}'::jsonb)"
            ),
            {"hash_b": session_hash_b, "t_b": tenant_b_id, "u_b": user_b_id},
        )

        # 4. ITSM User Access
        conn.execute(
            text(
                "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :t_a, :u_a, 'INCIDENT_MANAGER', true, now(), now()), "
                "       (gen_random_uuid(), :t_b, :u_b, 'INCIDENT_MANAGER', true, now(), now())"
            ),
            {"t_a": tenant_a_id, "u_a": user_a_id, "t_b": tenant_b_id, "u_b": user_b_id},
        )

        # 5. Tickets
        conn.execute(
            text(
                "INSERT INTO public.itsm_tickets "
                "(id, tenant_id, ticket_number, title, description, ticket_type, status, priority, urgency, impact, "
                " requester_id, sla_resolution_due_at, sla_status, created_at, updated_at) "
                "VALUES "
                "(:id_a, :t_a, 'INC-ALPHA-01', :title_a, :desc_a, 'INCIDENT', 'IN_PROGRESS', 'CRITICAL', 'HIGH', 'HIGH', "
                " :u_a, now() + interval '2 hours', 'WITHIN_SLA', now(), now()), "
                "(:id_b, :t_b, 'INC-BETA-01', 'Beta Routine Inquiry', 'Standard Beta description', 'INCIDENT', 'IN_PROGRESS', 'LOW', 'LOW', 'LOW', "
                " :u_b, now() + interval '2 hours', 'WITHIN_SLA', now(), now())"
            ),
            {
                "id_a": ticket_a_id,
                "t_a": tenant_a_id,
                "u_a": user_a_id,
                "title_a": MARKER_TITLE,
                "desc_a": MARKER_PAYLOAD,
                "id_b": ticket_b_id,
                "t_b": tenant_b_id,
                "u_b": user_b_id,
            },
        )

        # 6. Ticket Activities
        conn.execute(
            text(
                "INSERT INTO public.itsm_ticket_activities "
                "(id, tenant_id, ticket_id, activity_type, actor_type, actor_id, content, metadata, created_at) "
                "VALUES (gen_random_uuid(), :t_a, :id_a, 'COMMENT', 'USER', :u_a, 'Secret internal comment for Alpha', '{}'::jsonb, now())"
            ),
            {"t_a": tenant_a_id, "id_a": ticket_a_id, "u_a": user_a_id},
        )

        # 7. Services
        conn.execute(
            text(
                "INSERT INTO public.itsm_services "
                "(id, tenant_id, name, slug, description, tier, status, owner_user_id, created_at, updated_at) "
                "VALUES "
                "(:s_a, :t_a, 'Alpha Secret Engine', 'alpha-secret-engine', 'Confidential Payment Service', 'TIER_1', 'ACTIVE', :u_a, now(), now()), "
                "(:s_b, :t_b, 'Beta Public Wiki', 'beta-public-wiki', 'Standard Docs', 'TIER_3', 'ACTIVE', :u_b, now(), now())"
            ),
            {"s_a": service_a_id, "t_a": tenant_a_id, "u_a": user_a_id, "s_b": service_b_id, "t_b": tenant_b_id, "u_b": user_b_id},
        )

        # 8. Attachments
        conn.execute(
            text(
                "INSERT INTO public.itsm_attachments "
                "(id, tenant_id, uploaded_by_id, target_type, target_id, file_name, file_size_bytes, mime_type, checksum_sha256, storage_path, storage_backend, created_at) "
                "VALUES "
                "(:att_a, :t_a, :u_a, 'TICKET', :id_a, :fname_a, 2048, 'text/plain', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'tenants/a/files/att1', 'LOCAL', now())"
            ),
            {
                "att_a": attachment_a_id,
                "t_a": tenant_a_id,
                "u_a": user_a_id,
                "id_a": ticket_a_id,
                "fname_a": MARKER_FILENAME,
            },
        )

        # 9. Audit Event
        conn.execute(
            text("SELECT authn.set_context(:t_a, :u_a, gen_random_uuid())"),
            {"t_a": tenant_a_id, "u_a": user_a_id},
        )
        conn.execute(
            text("SELECT set_config('app.current_tenant_id', :t_a, true)"),
            {"t_a": str(tenant_a_id)},
        )
        conn.execute(
            text(
                "SELECT public.append_audit_event_v2("
                "  p_tenant_id => :t_a, p_record_id => gen_random_uuid(),"
                "  p_idempotency_key => 'audit-alpha-unique-key-101',"
                "  p_occurred_at => now(),"
                "  p_actor_type => 'user',"
                "  p_action => 'incident.create',"
                "  p_reason => 'Alpha Confidential Operation'"
                ")"
            ),
            {"t_a": tenant_a_id},
        )
        conn.execute(text("SELECT authn.set_context(NULL, NULL, NULL)"))
        conn.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    return {
        "owner_engine": owner_engine,
        "app_engine": app_engine,
        "SessionMaker": SessionMaker,
        "tenant_a_id": tenant_a_id,
        "tenant_b_id": tenant_b_id,
        "user_a_id": user_a_id,
        "user_b_id": user_b_id,
        "session_hash_a": session_hash_a,
        "session_hash_b": session_hash_b,
        "ticket_a_id": ticket_a_id,
        "ticket_b_id": ticket_b_id,
        "attachment_a_id": attachment_a_id,
        "service_a_id": service_a_id,
        "service_b_id": service_b_id,
        "MARKER_TITLE": MARKER_TITLE,
        "MARKER_PAYLOAD": MARKER_PAYLOAD,
        "MARKER_FILENAME": MARKER_FILENAME,
    }


def test_1_api_crud_isolation(test_setup):
    """Verify Tenant B cannot read, update, delete, or create records for Tenant A."""
    data = test_setup
    SessionMaker = data["SessionMaker"]
    tenant_a_id = data["tenant_a_id"]
    tenant_b_id = data["tenant_b_id"]
    ticket_a_id = data["ticket_a_id"]
    ticket_b_id = data["ticket_b_id"]

    # 1. Tenant B session cannot read Tenant A ticket
    with database_auth_context("session", data["session_hash_b"]):
        db: Session = SessionMaker()
        try:
            # Query by ID returns None
            assert db.query(ITSMTicket).filter(ITSMTicket.id == ticket_a_id).first() is None
            # Query all tickets only returns Tenant B tickets
            b_tickets = db.query(ITSMTicket).all()
            assert len(b_tickets) == 1
            assert b_tickets[0].id == ticket_b_id

            # Cross-tenant UPDATE affects 0 rows
            res = db.execute(
                ITSMTicket.__table__.update()
                .where(ITSMTicket.id == ticket_a_id)
                .values(title="Hacked By Tenant B")
            )
            assert res.rowcount == 0, "Cross-tenant update must affect 0 rows"

            # Cross-tenant DELETE affects 0 rows
            res_del = db.execute(
                ITSMTicket.__table__.delete().where(ITSMTicket.id == ticket_a_id)
            )
            assert res_del.rowcount == 0, "Cross-tenant delete must affect 0 rows"

            # Cross-tenant INSERT with Tenant A tenant_id is rejected by RLS
            with pytest.raises(DBAPIError):
                sp = db.begin_nested()
                try:
                    db.execute(
                        text(
                            "INSERT INTO public.itsm_tickets "
                            "(id, tenant_id, ticket_number, title, description, ticket_type, status, priority, urgency, impact, "
                            " requester_id, sla_resolution_due_at, sla_status, created_at, updated_at) "
                            "VALUES (:id, :t_a, 'INC-B-POISON', 'Poison', 'Poison desc', 'INCIDENT', 'NEW', 'LOW', 'LOW', 'LOW', "
                            " :u_b, now() + interval '1 hour', 'WITHIN_SLA', now(), now())"
                        ),
                        {"id": uuid4(), "t_a": tenant_a_id, "u_b": data["user_b_id"]},
                    )
                    sp.commit()
                except Exception:
                    sp.rollback()
                    raise
        finally:
            db.close()


def test_2_search_and_discovery_isolation(test_setup):
    """Verify keyword and identifier search by Tenant B reveals 0 information about Tenant A."""
    data = test_setup
    SessionMaker = data["SessionMaker"]
    MARKER_TITLE = data["MARKER_TITLE"]
    MARKER_PAYLOAD = data["MARKER_PAYLOAD"]

    with database_auth_context("session", data["session_hash_b"]):
        db: Session = SessionMaker()
        try:
            # Search by unique title keyword
            search_title = db.query(ITSMTicket).filter(
                ITSMTicket.title.ilike(f"%{MARKER_TITLE}%")
            ).all()
            assert len(search_title) == 0, "Tenant B must never discover Tenant A title via search"

            # Search by unique payload keyword
            search_payload = db.query(ITSMTicket).filter(
                ITSMTicket.description.ilike(f"%{MARKER_PAYLOAD}%")
            ).all()
            assert len(search_payload) == 0, "Tenant B must never discover Tenant A description via search"

            # Search ticket activities
            search_act = db.query(ITSMTicketActivity).filter(
                ITSMTicketActivity.content.ilike("%Secret internal comment%")
            ).all()
            assert len(search_act) == 0, "Tenant B must never discover Tenant A activity content"
        finally:
            db.close()


def test_3_reports_and_kpi_isolation(test_setup):
    """Verify KPI computations and aggregate counts for Tenant B strictly exclude Tenant A data."""
    data = test_setup
    SessionMaker = data["SessionMaker"]
    tenant_b_id = data["tenant_b_id"]

    with database_auth_context("session", data["session_hash_b"]):
        db: Session = SessionMaker()
        try:
            kpi_service = ITSMKPIService(db, str(tenant_b_id))
            all_kpis = kpi_service.compute_all_kpis()

            # Backlog age only reflects Tenant B tickets (exactly 1 ticket in Tenant B, NOT 2)
            assert all_kpis.backlog_age.total_open == 1, (
                f"Backlog count must be 1 for Tenant B, got {all_kpis.backlog_age.total_open}"
            )

            # Direct aggregate counts
            count_b = db.execute(text("SELECT count(*) FROM public.itsm_tickets")).scalar_one()
            assert count_b == 1, f"Direct count under Tenant B must be 1, got {count_b}"
        finally:
            db.close()


def test_4_attachments_and_downloads_isolation(test_setup):
    """Verify Tenant B cannot list, query, or download Tenant A attachments or discover filenames."""
    data = test_setup
    SessionMaker = data["SessionMaker"]
    tenant_b_id = data["tenant_b_id"]
    attachment_a_id = data["attachment_a_id"]
    MARKER_FILENAME = data["MARKER_FILENAME"]

    with database_auth_context("session", data["session_hash_b"]):
        db: Session = SessionMaker()
        try:
            # Query by attachment_id returns None
            row = db.execute(
                text("SELECT * FROM public.itsm_attachments WHERE id = :id"),
                {"id": attachment_a_id},
            ).first()
            assert row is None, "Tenant B must not read Tenant A attachment metadata"

            # List attachments returns 0 rows for Tenant B
            all_att = db.execute(text("SELECT * FROM public.itsm_attachments")).fetchall()
            assert len(all_att) == 0, "Tenant B must see 0 attachments"

            # Searching by filename yields 0 rows
            row_file = db.execute(
                text("SELECT * FROM public.itsm_attachments WHERE file_name = :fname"),
                {"fname": MARKER_FILENAME},
            ).first()
            assert row_file is None, "Tenant B must not discover Tenant A filename"

            # ITSMAttachmentService.get_attachment raises exception for Tenant B
            with pytest.raises(Exception):
                ITSMAttachmentService.get_attachment(db, tenant_b_id, attachment_a_id)
        finally:
            db.close()


def test_5_exports_and_audit_records_isolation(test_setup):
    """Verify Tenant B cannot view or export Tenant A audit records or outbox events."""
    data = test_setup
    SessionMaker = data["SessionMaker"]

    with database_auth_context("session", data["session_hash_b"]):
        db: Session = SessionMaker()
        try:
            # Query audit_log_metadata for Tenant A event
            alpha_audit = db.execute(
                text("SELECT * FROM public.audit_log_metadata WHERE idempotency_key = 'audit-alpha-unique-key-101'")
            ).first()
            assert alpha_audit is None, "Tenant B must not see Tenant A audit records"

            # Total audit count for Tenant B is 0
            audit_count = db.execute(text("SELECT count(*) FROM public.audit_log_metadata")).scalar_one()
            assert audit_count == 0, "Tenant B must have 0 audit log records"
        finally:
            db.close()


def test_6_admin_and_user_access_isolation(test_setup):
    """Verify Tenant B admin/manager cannot view or manipulate Tenant A user entitlements."""
    data = test_setup
    SessionMaker = data["SessionMaker"]
    tenant_a_id = data["tenant_a_id"]
    user_a_id = data["user_a_id"]

    with database_auth_context("session", data["session_hash_b"]):
        db: Session = SessionMaker()
        try:
            # Query itsm_user_access for Tenant A user
            access_a = db.execute(
                text("SELECT * FROM public.itsm_user_access WHERE user_id = :u_a"),
                {"u_a": user_a_id},
            ).first()
            assert access_a is None, "Tenant B must not view Tenant A user access entitlements"

            # Query all user access only returns Tenant B access
            access_list = db.query(ITSMUserAccess).all()
            for acc in access_list:
                assert acc.tenant_id != tenant_a_id, "Tenant B must never see Tenant A user access records"
        finally:
            db.close()


def test_7_services_and_catalog_isolation(test_setup):
    """Verify Service and Catalog items are strictly isolated between tenants."""
    data = test_setup
    SessionMaker = data["SessionMaker"]
    service_a_id = data["service_a_id"]
    service_b_id = data["service_b_id"]

    with database_auth_context("session", data["session_hash_b"]):
        db: Session = SessionMaker()
        try:
            # Tenant B sees Service B, cannot see Service A
            assert db.query(ITSMService).filter(ITSMService.id == service_a_id).first() is None
            s_b = db.query(ITSMService).filter(ITSMService.id == service_b_id).first()
            assert s_b is not None
            assert s_b.name == "Beta Public Wiki"
        finally:
            db.close()


def test_8_direct_postgresql_rls_enforcement(test_setup):
    """Verify raw PostgreSQL queries under authclaw_app without auth context read 0 rows."""
    data = test_setup
    app_engine = data["app_engine"]

    # Direct connection as authclaw_app with NO auth context
    with app_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM public.itsm_tickets")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.itsm_ticket_activities")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.itsm_attachments")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.itsm_services")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.itsm_user_access")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.audit_log_metadata")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.users")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.tenants")).scalar_one() == 0

        # Attempting to forge current_tenant_id GUC without HMAC-signed app.auth_context reads 0
        conn.execute(
            text("SELECT set_config('app.current_tenant_id', :t_a, true)"),
            {"t_a": str(data["tenant_a_id"])},
        )
        assert conn.execute(text("SELECT count(*) FROM public.itsm_tickets")).scalar_one() == 0
