"""Tests for ITSM Platform Administrator API endpoints."""
import pytest
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.schemas.itsm_admin import VALID_ITSM_ROLES, ITSMUserAccessUpdateRequest


def test_valid_itsm_roles():
    """Verify all 6 approved ITSM roles are accepted and invalid ones rejected."""
    for role in (
        "REQUESTER",
        "SERVICE_AGENT",
        "INCIDENT_MANAGER",
        "PROCESS_CHANGE_MANAGER",
        "PLATFORM_ADMINISTRATOR",
        "AUDITOR",
    ):
        assert role in VALID_ITSM_ROLES
        req = ITSMUserAccessUpdateRequest(has_itsm_access=True, itsm_role=role.lower())
        assert req.itsm_role == role

    # Verify SERVICE_LEAD backward-compatibility normalizes to INCIDENT_MANAGER
    assert "SERVICE_LEAD" in VALID_ITSM_ROLES
    sl_req = ITSMUserAccessUpdateRequest(has_itsm_access=True, itsm_role="service_lead")
    assert sl_req.itsm_role == "INCIDENT_MANAGER"

    with pytest.raises(ValueError):
        ITSMUserAccessUpdateRequest(has_itsm_access=True, itsm_role="INVALID_ROLE")


def test_unauthenticated_request_rejected(client: TestClient):
    """Unauthenticated requests to /v1/itsm/admin/users must return 401."""
    res = client.get("/v1/itsm/admin/users")
    assert res.status_code == 401
