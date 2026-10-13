from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.schemas.itsm_outage_alerts import AlertDraftRequest
from app.services.itsm_outage_alert_service import OutageAlertService
from app.services.itsm_outage_alert_policy import allowed_actions_for, can_manage, project_alert


CONTENT = {
    "alert_number": "ALT-000001",
    "title": "Email unavailable",
    "alert_type": "OUTAGE",
    "severity": "CRITICAL",
    "intent": "RESOLVE",
    "status": "ACTIVE",
    "public_status": "INVESTIGATING",
    "public_summary": "Email is currently unavailable.",
    "impact_summary": "Users cannot send messages.",
    "recommended_action": "Use the status page for updates.",
    "service_agent_guidance": "Use the approved workaround.",
    "internal_notes": "Restricted diagnostic evidence.",
    "service_agent_handling": "SOLVE",
    "affected_services": [{"id": "service-1", "name": "Email"}],
    "outage_started_at": "2026-10-13T08:00:00+00:00",
    "latest_publication_at": "2026-10-13T08:15:00+00:00",
    "authorized_links": [{"type": "INCIDENT", "id": "incident-1"}],
    "links": [{"type": "INCIDENT", "id": "incident-1"}],
}


def test_only_incident_manager_has_business_management_permission():
    assert can_manage("INCIDENT_MANAGER") is True
    assert can_manage("PLATFORM_ADMINISTRATOR") is False
    assert can_manage("AUDITOR") is False


def test_requester_projection_excludes_internal_and_support_fields():
    projected = project_alert(CONTENT, "REQUESTER")
    assert projected["public_summary"] == CONTENT["public_summary"]
    assert projected["public_status"] == "INVESTIGATING"
    assert projected["latest_publication_at"] == CONTENT["latest_publication_at"]
    assert "internal_notes" not in projected
    assert "service_agent_guidance" not in projected
    assert "links" not in projected


def test_service_agent_projection_includes_only_approved_support_context():
    projected = project_alert(CONTENT, "SERVICE_AGENT")
    assert projected["service_agent_guidance"] == CONTENT["service_agent_guidance"]
    assert projected["authorized_links"] == CONTENT["authorized_links"]
    assert "internal_notes" not in projected


def test_auditor_projection_is_evidence_safe_and_read_only():
    projected = project_alert(CONTENT, "AUDITOR")
    assert projected["severity"] == CONTENT["severity"]
    assert projected["links"] == CONTENT["links"]
    assert "internal_notes" not in projected
    assert "service_agent_guidance" not in projected
    assert allowed_actions_for("AUDITOR", intent="RESOLVE", handling="SOLVE", has_incident_link=True) == ["VIEW_EVIDENCE"]


def test_solve_action_needs_agent_role_intent_and_existing_incident():
    assert "OPEN_LINKED_INCIDENT" in allowed_actions_for("SERVICE_AGENT", intent="RESOLVE", handling="SOLVE", has_incident_link=True)
    assert "OPEN_LINKED_INCIDENT" not in allowed_actions_for("SERVICE_AGENT", intent="INFORM", handling="SOLVE", has_incident_link=True)
    assert "OPEN_LINKED_INCIDENT" not in allowed_actions_for("SERVICE_AGENT", intent="RESOLVE", handling="ALERT_ONLY", has_incident_link=True)
    assert "OPEN_LINKED_INCIDENT" not in allowed_actions_for("SERVICE_AGENT", intent="RESOLVE", handling="SOLVE", has_incident_link=False)


def test_incomplete_service_scoped_alert_can_be_saved_as_draft_but_not_previewed():
    payload = AlertDraftRequest(
        title="Email access degradation",
        alert_type="DEGRADATION",
        severity="HIGH",
        intent="INFORM",
        public_summary="Some employees cannot open company email.",
        impact_summary="Email access is intermittent.",
        audiences=[{"audience_type": "SERVICE_USERS"}],
    )

    # Schema validation deliberately permits an incomplete delivery scope.
    assert payload.service_ids == []

    with pytest.raises(HTTPException, match="Service-scoped audiences require"):
        OutageAlertService._validate_publishable(
            SimpleNamespace(audiences=[SimpleNamespace(audience_type="SERVICE_USERS")], services=[], links=[], service_agent_handling="ALERT_ONLY")
        )


def test_publishable_validation_requires_an_incident_for_solve():
    alert = SimpleNamespace(
        audiences=[SimpleNamespace(audience_type="SERVICE_AGENTS")],
        services=[SimpleNamespace(service_id=uuid4())],
        links=[],
        service_agent_handling="SOLVE",
    )
    with pytest.raises(HTTPException, match="Solve requires an existing linked Incident"):
        OutageAlertService._validate_publishable(alert)


def test_public_status_is_separate_from_internal_lifecycle_and_recovery_is_explicit():
    alert = SimpleNamespace(public_status="INVESTIGATING")
    assert OutageAlertService._publication_public_status(alert, "INITIAL", None) == "INVESTIGATING"
    assert OutageAlertService._publication_public_status(alert, "UPDATE", "IDENTIFIED") == "IDENTIFIED"
    assert OutageAlertService._publication_public_status(alert, "UPDATE", "MONITORING") == "MONITORING"
    assert OutageAlertService._publication_public_status(alert, "RECOVERY", None) == "RECOVERED"
    with pytest.raises(HTTPException, match="only be published through Publish Recovery"):
        OutageAlertService._publication_public_status(alert, "UPDATE", "RECOVERED")
    with pytest.raises(HTTPException, match="requires the Recovered public status"):
        OutageAlertService._publication_public_status(alert, "RECOVERY", "MONITORING")


def test_auditor_evidence_status_distinguishes_missing_from_not_collected():
    publication = SimpleNamespace(
        audience_snapshot=[{"type": "SERVICE_USERS"}],
        recipient_count=1,
        recipients=[SimpleNamespace(delivery_status="AVAILABLE")],
    )
    alert = SimpleNamespace(status="ACTIVE", publications=[publication])

    evidence = OutageAlertService._auditor_evidence_status(alert, audit_event_count=2)

    assert evidence["status"] == "AVAILABLE_WITH_LIMITATIONS"
    assert evidence["checks"]["publication_history"] == "PRESENT"
    assert evidence["checks"]["delivery_evidence"] == "PRESENT"
    assert evidence["checks"]["authorization_decision"] == "NOT_COLLECTED"
    assert evidence["checks"]["recipient_exclusions"] == "NOT_COLLECTED"


def test_auditor_evidence_status_flags_missing_required_publication():
    alert = SimpleNamespace(status="ACTIVE", publications=[])

    evidence = OutageAlertService._auditor_evidence_status(alert, audit_event_count=1)

    assert evidence["status"] == "INCOMPLETE"
    assert evidence["checks"]["publication_history"] == "MISSING"


def test_platform_admin_projection_is_delivery_operator_and_excludes_business_content():
    projected = project_alert(CONTENT, "PLATFORM_ADMINISTRATOR")
    assert projected["alert_number"] == CONTENT["alert_number"]
    assert projected["status"] == "ACTIVE"
    assert projected["public_status"] == "INVESTIGATING"
    assert projected["affected_services"] == CONTENT["affected_services"]
    # Operational content and internal notes MUST be strictly excluded
    assert "title" not in projected
    assert "public_summary" not in projected
    assert "impact_summary" not in projected
    assert "recommended_action" not in projected
    assert "service_agent_guidance" not in projected
    assert "internal_notes" not in projected
    assert "links" not in projected
    assert "audiences" not in projected


def test_platform_admin_delivery_health_permission_and_actions():
    from app.services.itsm_outage_alert_policy import (
        can_view_delivery_health,
        projection_type_for_role,
    )

    assert can_view_delivery_health("PLATFORM_ADMINISTRATOR") is True
    assert can_view_delivery_health("INCIDENT_MANAGER") is True
    assert can_view_delivery_health("REQUESTER") is False
    assert can_view_delivery_health("SERVICE_AGENT") is False
    assert can_view_delivery_health("AUDITOR") is False

    assert projection_type_for_role("PLATFORM_ADMINISTRATOR") == "DELIVERY_OPERATOR"
    assert allowed_actions_for(
        "PLATFORM_ADMINISTRATOR",
        intent="RESOLVE",
        handling="SOLVE",
        has_incident_link=True,
    ) == ["VIEW_DELIVERY_HEALTH"]
