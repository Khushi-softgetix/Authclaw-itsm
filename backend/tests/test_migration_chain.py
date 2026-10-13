"""Keep merged migration history and runtime schema gates compatible."""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_bootstrap_creates_roles_before_worker_schema(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    import pytest
    from scripts import bootstrap_database_security as bootstrap

    created = set()
    roles = tuple(
        SimpleNamespace(name=name, schema="public")
        for name in (
            "fresh_migrator",
            "fresh_runtime",
            "fresh_agent_migrator",
            "fresh_agent_runtime",
        )
    )
    monkeypatch.setattr(bootstrap, "ensure_auth_definer_role", lambda conn: None)
    monkeypatch.setattr(bootstrap, "ensure_agent_auth_definer_role", lambda conn: None)
    monkeypatch.setattr(
        bootstrap, "ensure_login_role", lambda conn, role: created.add(role.name)
    )

    class BoundaryReached(Exception):
        pass

    def prepare_worker(conn, owner):
        assert owner in created, "worker schema owner must exist first"
        raise BoundaryReached

    monkeypatch.setattr(
        bootstrap.worker_maintenance_security, "prepare", prepare_worker
    )
    with pytest.raises(BoundaryReached):
        bootstrap.prepare(MagicMock(), "fresh_test", roles)


def test_worker_migration_follows_platform_history_and_runtime_gates():
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    scripts = ScriptDirectory.from_config(config)
    assert scripts.get_heads() == ["059"]
    assert scripts.get_revision("059").down_revision == "058"
    assert scripts.get_revision("058").down_revision == "057"
    assert scripts.get_revision("057").down_revision == "056"
    assert scripts.get_revision("056").down_revision == "055"
    assert scripts.get_revision("055").down_revision == "054"
    assert scripts.get_revision("054").down_revision == "053"
    assert scripts.get_revision("053").down_revision == "052"
    assert scripts.get_revision("046").down_revision == "045"
    assert scripts.get_revision("045").down_revision == "044"
    revisions = list(scripts.walk_revisions())
    assert len({revision.revision for revision in revisions}) == len(revisions)
    assert (
        '"AUTHCLAW_EXPECTED_DB_REVISION", "059"'
        in (backend / "app/core/startup_checks.py").read_text()
    )
    assert "version_num IN ('046', '050', '051', '052', '053', '054', '055', '056', '057', '058', '059')" in (backend.parent / "gateway/db.go").read_text()

    public_status = (backend / "alembic/versions/059_add_outage_alert_public_status.py").read_text()
    assert "INVESTIGATING" in public_status
    assert "IDENTIFIED" in public_status
    assert "MONITORING" in public_status
    assert "RECOVERED" in public_status

    service_targeting = (backend / "alembic/versions/058_add_service_alert_recipient_scope.py").read_text()
    assert "SERVICE_ENTITLEMENTS" in service_targeting
    assert "ALL_REQUESTERS" in service_targeting

    outage_integrity = (backend / "alembic/versions/056_harden_outage_alert_integrity.py").read_text()
    assert "fk_outage_alert_recipient_tenant_publication" in outage_integrity
    outage_audiences = (backend / "alembic/versions/057_complete_outage_alert_audiences.py").read_text()
    assert "SPECIFIC_USER" in outage_audiences
    assert "enforce_outage_alert_reference_tenant" in outage_audiences
    assert "enforce_outage_alert_current_publication_tenant" in outage_integrity
    assert "status = 'EXPIRED'" in outage_integrity

    reliability = (backend / "alembic/versions/055_incident_reliability_p0.py").read_text()
    assert "sla_warning_escalated_at" in reliability
    assert "sla_breach_escalated_at" in reliability
    assert "itsm_incident_operations" in reliability
    assert "ENABLE ROW LEVEL SECURITY" in reliability
    assert "FORCE ROW LEVEL SECURITY" in reliability
    assert "sla_candidate_tenants" in reliability
    assert "worker_maintenance.sla_candidate_tenants" in reliability
    assert "SLA_WARNING_ESCALATION" in reliability
    assert "SLA_BREACH_ESCALATION" in reliability
    worker_security = (backend / "scripts/worker_maintenance_security.py").read_text()
    assert "worker_maintenance.sla_candidate_tenants()" in worker_security
    assert "public.itsm_tickets" in worker_security
