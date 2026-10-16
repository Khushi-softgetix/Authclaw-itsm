from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.services.itsm_metric_snapshot_service import normalize_period
from app.services.itsm_metric_snapshot_worker import _completed_periods


def test_daily_period_is_previous_completed_utc_day():
    start, end = normalize_period("DAILY", datetime(2026, 10, 16, 12, 30, tzinfo=timezone.utc))
    assert start == datetime(2026, 10, 15, tzinfo=timezone.utc)
    assert end == datetime(2026, 10, 16, tzinfo=timezone.utc)


def test_weekly_period_is_previous_completed_monday_to_monday():
    start, end = normalize_period("WEEKLY", datetime(2026, 10, 16, 12, 30, tzinfo=timezone.utc))
    assert start == datetime(2026, 10, 5, tzinfo=timezone.utc)
    assert end == datetime(2026, 10, 12, tzinfo=timezone.utc)


def test_monthly_period_handles_year_boundary():
    start, end = normalize_period("MONTHLY", datetime(2026, 1, 8, tzinfo=timezone.utc))
    assert start == datetime(2025, 12, 1, tzinfo=timezone.utc)
    assert end == datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_daily_period_uses_tenant_calendar_across_daylight_saving():
    start, end = normalize_period(
        "DAILY",
        datetime(2026, 3, 9, 12, tzinfo=timezone.utc),
        reporting_timezone="America/New_York",
    )
    assert start == datetime(2026, 3, 8, 5, tzinfo=timezone.utc)
    assert end == datetime(2026, 3, 9, 4, tzinfo=timezone.utc)
    assert end - start == timedelta(hours=23)


def test_catch_up_enumerates_every_completed_daily_weekly_and_monthly_period():
    reference = datetime(2026, 4, 5, 12, tzinfo=timezone.utc)
    earliest = datetime(2026, 3, 1, 8, tzinfo=timezone.utc)
    assert len(list(_completed_periods("DAILY", earliest, reference, "UTC", 0))) == 35
    assert len(list(_completed_periods("WEEKLY", earliest, reference, "UTC", 0))) == 5
    assert len(list(_completed_periods("MONTHLY", earliest, reference, "UTC", 0))) == 1


def test_snapshot_contract_is_immutable_tenant_scoped_and_read_limited():
    root = Path(__file__).parents[1]
    migration = (root / "alembic/versions/064_add_immutable_metric_snapshots.py").read_text()
    endpoint = (root / "app/api/v1/endpoints/itsm_analytics.py").read_text()
    service = (root / "app/services/itsm_metric_snapshot_service.py").read_text()

    assert "FORCE ROW LEVEL SECURITY" in migration
    assert "tenant_id = authn.current_tenant_id()" in migration
    assert "BEFORE UPDATE OR DELETE" in migration
    assert "uq_itsm_metric_snapshot_identity" in migration
    assert 'require_itsm_roles(["INCIDENT_MANAGER", "AUDITOR"])' in endpoint
    assert "ITSMMetricSnapshot.tenant_id == self.tenant_id" in service
    assert "on_conflict_do_nothing" in service
