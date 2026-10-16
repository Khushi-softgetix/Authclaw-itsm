"""PostgreSQL/RLS integration coverage for ANA-004 generation."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.services import itsm_metric_snapshot_worker as worker


@pytest.fixture(scope="module")
def postgres_engines():
    owner_url = os.getenv("OWNER_DATABASE_URL")
    app_url = os.getenv("DATABASE_URL")
    worker_url = os.getenv("METRIC_SNAPSHOT_DATABASE_URL")
    if not owner_url or not app_url or not worker_url:
        pytest.skip("OWNER_DATABASE_URL, DATABASE_URL, and METRIC_SNAPSHOT_DATABASE_URL are required")
    engines = tuple(create_engine(url, pool_pre_ping=True) for url in (owner_url, app_url, worker_url))
    try:
        yield engines
    finally:
        for engine in engines:
            engine.dispose()


def _seed_incident(owner, *, created_at: datetime):
    tenant_id, user_id, ticket_id = uuid4(), uuid4(), uuid4()
    with owner.begin() as conn:
        conn.execute(
            text("INSERT INTO public.tenants(id,name,status,created_at,updated_at) VALUES (:id,:name,'active',now(),now())"),
            {"id": tenant_id, "name": f"ANA-004 {tenant_id}"},
        )
        conn.execute(
            text(
                "INSERT INTO public.users(id,tenant_id,email,role,platform_role,is_active,created_at,updated_at) "
                "VALUES (:id,:tenant,:email,'admin','NONE',true,now(),now())"
            ),
            {"id": user_id, "tenant": tenant_id, "email": f"ana-{user_id}@example.test"},
        )
        conn.execute(
            text(
                "INSERT INTO public.itsm_tickets("
                "id,tenant_id,ticket_number,ticket_type,title,description,impact,urgency,priority,status,"
                "source_channel,requester_id,category,is_major_incident,sla_status,sla_accumulated_pause_seconds,"
                "version,ai_triaged,created_at,updated_at) VALUES ("
                ":id,:tenant,:number,'INCIDENT','Historical incident','ANA-004 integration','MEDIUM','MEDIUM','P3','NEW',"
                "'PORTAL',:user,'GENERAL',false,'WITHIN_SLA',0,1,false,:created,:created)"
            ),
            {
                "id": ticket_id,
                "tenant": tenant_id,
                "number": f"INC-{str(ticket_id)[:8]}",
                "user": user_id,
                "created": created_at,
            },
        )
        conn.execute(
            text(
                "INSERT INTO public.itsm_ticket_activities("
                "id,tenant_id,ticket_id,activity_type,actor_id,actor_type,content,metadata,created_at) "
                "VALUES (gen_random_uuid(),:tenant,:ticket,'CREATED',:user,'USER','Created',"
                "cast(:metadata AS jsonb),:created)"
            ),
            {
                "tenant": tenant_id,
                "ticket": ticket_id,
                "user": user_id,
                "metadata": '{"new_value":{"status":"NEW","priority":"P3"}}',
                "created": created_at,
            },
        )
    return tenant_id, ticket_id


def _snapshot_rows(engine, tenant_id):
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT metric_key,period_grain,period_start,period_end,definition_version,value "
                "FROM public.itsm_metric_snapshots WHERE tenant_id=:tenant ORDER BY period_start,metric_key"
            ),
            {"tenant": tenant_id},
        ).mappings().all()


def test_worker_identity_binds_one_tenant_and_api_role_cannot_enumerate(postgres_engines):
    owner, app, metric_worker = postgres_engines
    tenant_a, _ = _seed_incident(owner, created_at=datetime(2026, 3, 1, tzinfo=timezone.utc))
    tenant_b, _ = _seed_incident(owner, created_at=datetime(2026, 3, 1, tzinfo=timezone.utc))

    with metric_worker.begin() as conn:
        conn.execute(text("SELECT worker_maintenance.bind_metric_snapshot_context(:tenant)"), {"tenant": tenant_a})
        assert conn.execute(text("SELECT count(*) FROM public.tenants WHERE id=:tenant"), {"tenant": tenant_a}).scalar_one() == 1
        assert conn.execute(text("SELECT count(*) FROM public.itsm_tickets WHERE tenant_id=:tenant"), {"tenant": tenant_b}).scalar_one() == 0

    with app.connect() as conn:
        assert not conn.execute(
            text("SELECT has_table_privilege(current_user,'public.itsm_metric_snapshots','INSERT')")
        ).scalar_one()
        with pytest.raises(DBAPIError):
            conn.execute(text("SELECT * FROM worker_maintenance.metric_snapshot_candidate_tenants()"))
        conn.rollback()
        with pytest.raises(DBAPIError):
            conn.execute(text("SELECT worker_maintenance.bind_metric_snapshot_context(:tenant)"), {"tenant": tenant_a})


def test_catch_up_is_complete_concurrency_safe_and_immutable(postgres_engines, monkeypatch):
    owner, _, metric_worker = postgres_engines
    tenant_id, ticket_id = _seed_incident(
        owner, created_at=datetime(2026, 3, 1, 8, tzinfo=timezone.utc)
    )
    monkeypatch.setenv("ITSM_METRIC_SNAPSHOT_MAX_PERIODS_PER_SWEEP", "100")
    reference = datetime(2026, 4, 5, 12, tzinfo=timezone.utc)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: worker.sweep(metric_worker, reference), range(2)))
    assert all(result["failures"] == 0 for result in results)

    rows = _snapshot_rows(owner, tenant_id)
    assert {row["period_grain"] for row in rows} == {"DAILY", "WEEKLY", "MONTHLY"}
    identities = {
        (row["metric_key"], row["period_grain"], row["period_start"], row["period_end"], row["definition_version"])
        for row in rows
    }
    assert len(identities) == len(rows)
    before = {
        (
            row["metric_key"],
            row["period_grain"],
            row["period_start"],
            row["period_end"],
            row["definition_version"],
        ): row["value"]
        for row in rows
    }

    with owner.begin() as conn:
        conn.execute(
            text("UPDATE public.itsm_tickets SET title='Later edit',status='CANCELLED',updated_at=:updated WHERE id=:id"),
            {"id": ticket_id, "updated": reference + timedelta(days=1)},
        )
    assert worker.sweep(metric_worker, reference + timedelta(days=1))["failures"] == 0
    after = {
        (
            row["metric_key"],
            row["period_grain"],
            row["period_start"],
            row["period_end"],
            row["definition_version"],
        ): row["value"]
        for row in _snapshot_rows(owner, tenant_id)
        if (
            row["metric_key"],
            row["period_grain"],
            row["period_start"],
            row["period_end"],
            row["definition_version"],
        ) in before
    }
    assert after == before

    snapshot_id = None
    with owner.connect() as conn:
        snapshot_id = conn.execute(
            text("SELECT id FROM public.itsm_metric_snapshots WHERE tenant_id=:tenant LIMIT 1"),
            {"tenant": tenant_id},
        ).scalar_one()
    with owner.connect() as conn:
        with pytest.raises(DBAPIError):
            conn.execute(
                text("UPDATE public.itsm_metric_snapshots SET metric_key='TAMPERED' WHERE id=:id"),
                {"id": snapshot_id},
            )
        conn.rollback()
        with pytest.raises(DBAPIError):
            conn.execute(text("DELETE FROM public.itsm_metric_snapshots WHERE id=:id"), {"id": snapshot_id})


def test_partial_failure_is_atomic_and_retryable(postgres_engines, monkeypatch):
    owner, _, metric_worker = postgres_engines
    tenant_id, _ = _seed_incident(owner, created_at=datetime(2026, 3, 10, tzinfo=timezone.utc))
    monkeypatch.setenv("ITSM_METRIC_SNAPSHOT_MAX_PERIODS_PER_SWEEP", "1")
    reference = datetime(2026, 3, 12, 12, tzinfo=timezone.utc)
    original = worker.ITSMMetricSnapshotService.generate_period

    def fail_generation(*args, **kwargs):
        raise RuntimeError("injected-generation-failure")

    monkeypatch.setattr(worker.ITSMMetricSnapshotService, "generate_period", fail_generation)
    failed = worker.sweep(metric_worker, reference)
    assert failed["failures"] >= 1
    assert _snapshot_rows(owner, tenant_id) == []

    monkeypatch.setattr(worker.ITSMMetricSnapshotService, "generate_period", original)
    with owner.begin() as conn:
        conn.execute(
            text(
                "UPDATE public.itsm_metric_snapshot_jobs SET next_attempt_at=:now "
                "WHERE tenant_id=:tenant AND status='FAILED'"
            ),
            {"tenant": tenant_id, "now": reference},
        )
    recovered = worker.sweep(metric_worker, reference)
    assert recovered["failures"] == 0
    assert len(_snapshot_rows(owner, tenant_id)) == 10
