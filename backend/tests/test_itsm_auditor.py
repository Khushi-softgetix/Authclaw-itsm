import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import (
    audit as audit_api,
    evidence as generic_evidence,
    itsm_audit,
    itsm_incidents,
    itsm_knowledge,
    itsm_requests,
    itsm_services,
)
from app.core import auth
from app.orchestrator import runner
from app.services import audit_store, event_backbone


def _request(method="GET"):
    return SimpleNamespace(
        state=SimpleNamespace(tenant_id=uuid4(), user_id=uuid4()),
        headers={},
        method=method,
    )


def test_auditor_mutation_is_denied_and_audited(monkeypatch):
    appended = []
    monkeypatch.setattr(
        "app.services.audit_store.append_audit_event",
        lambda _db, event: appended.append(event),
    )
    db = MagicMock()

    with pytest.raises(HTTPException) as exc:
        auth.deny_itsm_auditor_mutation(_request(), db, "AUDITOR", "incident.update")

    assert exc.value.status_code == 403
    assert appended[0]["action"] == "itsm.authorization.denied"
    assert "attempted_action=incident.update" in appended[0]["execution_trace"]
    db.commit.assert_called_once()


def test_non_auditor_is_not_blocked_by_read_only_guard():
    db = MagicMock()
    auth.deny_itsm_auditor_mutation(_request(), db, "SERVICE_AGENT", "incident.update")
    db.commit.assert_not_called()


@pytest.mark.parametrize(
    "lookup",
    [itsm_incidents._get_itsm_role, itsm_requests._get_user_role_and_validate],
)
def test_itsm_role_lookup_fails_closed_when_access_record_is_missing(lookup):
    db = MagicMock()
    db.execute.return_value.first.return_value = None

    with pytest.raises(HTTPException) as exc:
        lookup(db, uuid4(), uuid4())

    assert exc.value.status_code == 403


@pytest.mark.parametrize(
    "lookup",
    [itsm_incidents._get_itsm_role, itsm_requests._get_user_role_and_validate],
)
def test_itsm_role_lookup_fails_closed_when_database_lookup_fails(lookup):
    db = MagicMock()
    db.execute.side_effect = RuntimeError("database unavailable")

    with pytest.raises(HTTPException) as exc:
        lookup(db, uuid4(), uuid4())

    assert exc.value.status_code == 503


def test_auditor_cannot_create_incident(monkeypatch):
    request = _request()
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="AUDITOR",
        has_itsm_access=True,
    )
    blocked = []

    def deny(_request, _db, role, action):
        blocked.append((role, action))
        raise HTTPException(status_code=403, detail="Auditor access is read-only")

    monkeypatch.setattr(itsm_incidents, "deny_itsm_auditor_mutation", deny)
    payload = MagicMock(urgency="HIGH")

    with pytest.raises(HTTPException) as exc:
        itsm_incidents.create_incident(
            payload, request, db, str(request.state.tenant_id)
        )

    assert exc.value.status_code == 403
    assert blocked == [("AUDITOR", "incident.create")]


@pytest.mark.parametrize(
    ("endpoint", "action"),
    [
        (itsm_requests.change_request_status, "request.status.change"),
        (itsm_requests.assign_request, "request.assign"),
        (itsm_requests.add_request_activity, "request.activity.create"),
    ],
)
def test_auditor_cannot_mutate_requests(monkeypatch, endpoint, action):
    request = _request()
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="AUDITOR",
        has_itsm_access=True,
    )
    blocked = []

    def deny(_request, _db, role, attempted_action):
        blocked.append((role, attempted_action))
        raise HTTPException(status_code=403, detail="Auditor access is read-only")

    monkeypatch.setattr(itsm_requests, "deny_itsm_auditor_mutation", deny)

    with pytest.raises(HTTPException) as exc:
        endpoint(uuid4(), MagicMock(), request, db, str(request.state.tenant_id))

    assert exc.value.status_code == 403
    assert blocked == [("AUDITOR", action)]


def test_auditor_cannot_read_incident_activity_history():
    request = _request()
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="AUDITOR",
        has_itsm_access=True,
    )

    with pytest.raises(HTTPException) as exc:
        itsm_incidents.list_incident_activities(
            uuid4(), request, db, str(request.state.tenant_id)
        )

    assert exc.value.status_code == 403


def test_auditor_cannot_bypass_redacted_api_through_generic_evidence(monkeypatch):
    """Generic evidence can contain platform-sensitive payloads; ITSM Auditors use their dedicated API."""
    request = _request()
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="AUDITOR",
        has_itsm_access=True,
    )
    queried = []
    monkeypatch.setattr(
        generic_evidence.evidence_service,
        "list_evidence",
        lambda *_args, **_kwargs: queried.append(True) or ([], 0),
    )

    with pytest.raises(HTTPException) as exc:
        generic_evidence.list_evidence(
            request=request,
            framework=None,
            evidence_type=None,
            severity=None,
            page=1,
            page_size=20,
            db=db,
        )

    assert exc.value.status_code == 403
    assert queried == []


def test_non_auditor_generic_evidence_access_is_not_changed(monkeypatch):
    request = _request()
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="INCIDENT_MANAGER",
        has_itsm_access=True,
    )
    monkeypatch.setattr(
        generic_evidence.evidence_service,
        "list_evidence",
        lambda *_args, **_kwargs: ([], 0),
    )

    response = generic_evidence.list_evidence(
        request=request,
        framework=None,
        evidence_type=None,
        severity=None,
        page=1,
        page_size=20,
        db=db,
    )

    assert response.total == 0
    assert response.items == []


def test_auditor_restricted_read_is_denied_and_audited(monkeypatch):
    request = _request()
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="AUDITOR",
        has_itsm_access=True,
    )
    appended = []
    monkeypatch.setattr(
        "app.services.audit_store.append_audit_event",
        lambda _db, event: appended.append(event),
    )

    with pytest.raises(HTTPException) as exc:
        auth.ensure_itsm_role(request, db, ["INCIDENT_MANAGER"])

    assert exc.value.status_code == 403
    assert exc.value.detail == "Auditor is not authorized for this operation"
    assert appended[0]["action"] == "itsm.authorization.denied"
    assert "denial_kind=restricted_access" in appended[0]["execution_trace"]


def test_auditor_role_protected_mutation_is_classified_as_mutation(monkeypatch):
    request = _request(method="PATCH")
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="AUDITOR",
        has_itsm_access=True,
    )
    appended = []
    monkeypatch.setattr(
        "app.services.audit_store.append_audit_event",
        lambda _db, event: appended.append(event),
    )

    with pytest.raises(HTTPException) as exc:
        auth.ensure_itsm_role(request, db, ["INCIDENT_MANAGER"])

    assert exc.value.status_code == 403
    assert exc.value.detail == "Auditor access is read-only"
    assert "denial_kind=mutation" in appended[0]["execution_trace"]


def test_auditor_api_dependency_requires_auditor_role():
    events_route = next(
        route for route in itsm_audit.router.routes if route.path == "/events"
    )
    role_dependency = next(
        dependency.call
        for dependency in events_route.dependant.dependencies
        if "required_roles" in inspect.getclosurevars(dependency.call).nonlocals
    )
    assert inspect.getclosurevars(role_dependency).nonlocals["required_roles"] == [
        "AUDITOR"
    ]


@pytest.mark.parametrize(
    "path",
    ["/overview", "/events/{record_id}", "/exports", "/traces", "/export"],
)
def test_all_auditor_capabilities_require_the_auditor_role(path):
    route = next(route for route in itsm_audit.router.routes if route.path == path)
    role_dependency = next(
        dependency.call
        for dependency in route.dependant.dependencies
        if "required_roles" in inspect.getclosurevars(dependency.call).nonlocals
    )
    assert inspect.getclosurevars(role_dependency).nonlocals["required_roles"] == [
        "AUDITOR"
    ]


def test_auditor_response_removes_internal_payload_and_redacts_secrets():
    record = itsm_audit._auditor_safe_record(
        {
            "record_id": "record-1",
            "canonical_payload": "internal-chain-payload",
            "idempotency_key": "internal-idempotency-key",
            "execution_trace": {
                "task_goal": "Review evidence",
                "access_token": "secret-token",
                "nested": {"password": "secret-password", "result": "complete"},
            },
        }
    )

    assert record["record_id"] == "record-1"
    assert "canonical_payload" not in record
    assert "idempotency_key" not in record
    assert record["execution_trace"]["task_goal"] == "Review evidence"
    assert record["execution_trace"]["access_token"] == "[REDACTED]"
    assert record["execution_trace"]["nested"]["password"] == "[REDACTED]"


def test_auditor_response_redacts_legacy_secret_trace_entries():
    record = itsm_audit._auditor_safe_record(
        {
            "record_id": "record-1",
            "execution_trace": [
                "task_goal=Review evidence",
                "access_token=secret-token",
                "password: secret-password",
            ],
        }
    )

    assert record["execution_trace"] == [
        "task_goal=Review evidence",
        "access_token=[REDACTED]",
        "password:[REDACTED]",
    ]


def test_export_history_reuses_the_existing_audit_chain(monkeypatch):
    request = _request()
    result = audit_api.AuditLogsResponse(
        source="postgres", total=1, records=[{"action": "itsm.audit.exported"}], integrity_checked=True
    )
    captured = []
    monkeypatch.setattr(
        itsm_audit.audit_api,
        "get_chain_of_record_logs",
        lambda *_args, **kwargs: captured.append(kwargs) or result,
    )
    monkeypatch.setattr(itsm_audit, "_prepare_auditor_result", lambda *_args: result)

    response = itsm_audit.list_audit_exports(request, db=MagicMock(), limit=50, offset=0)

    assert response is result
    assert captured[0]["action"] == "itsm.audit.exported"
    assert captured[0]["integrity_check"] is True


def test_auditor_search_reuses_audit_store_and_records_search(monkeypatch):
    request = _request()
    result = itsm_audit.audit_api.AuditLogsResponse(
        source="postgres",
        total=1,
        records=[{"action": "itsm.incident.created"}],
        integrity_checked=True,
    )
    query = {}

    def get_logs(*_args, **kwargs):
        query.update(kwargs)
        return result

    monkeypatch.setattr(itsm_audit.audit_api, "get_chain_of_record_logs", get_logs)
    recorded = []
    monkeypatch.setattr(
        itsm_audit,
        "_record_auditor_action",
        lambda *_args, **kwargs: recorded.append(kwargs),
    )

    response = itsm_audit.search_audit_events(
        request,
        db=MagicMock(),
        limit=25,
        offset=0,
        action=None,
        action_prefix="itsm.incident.",
        actor="auditor@example.test",
        target_type="incident",
        outcome="success",
        start=None,
        end=None,
        search="incident",
        integrity_check=True,
    )

    assert response is result
    assert query["action_prefix"] == "itsm.incident."
    assert query["actor"] == "auditor@example.test"
    assert query["target_type"] == "incident"
    assert query["outcome"] == "success"
    assert recorded[0]["action"] == "itsm.audit.searched"


@pytest.mark.parametrize("offset", [0, 25])
def test_unfiltered_audit_paging_does_not_mutate_the_result_set(monkeypatch, offset):
    request = _request()
    result = itsm_audit.audit_api.AuditLogsResponse(
        source="postgres", total=50, records=[], integrity_checked=True
    )
    monkeypatch.setattr(
        itsm_audit.audit_api,
        "get_chain_of_record_logs",
        lambda *_args, **_kwargs: result,
    )
    monkeypatch.setattr(itsm_audit, "_prepare_auditor_result", lambda *_args: result)
    recorded = []
    monkeypatch.setattr(
        itsm_audit,
        "_record_auditor_action",
        lambda *_args, **kwargs: recorded.append(kwargs),
    )

    response = itsm_audit.search_audit_events(
        request,
        db=MagicMock(),
        limit=25,
        offset=offset,
        action=None,
        action_prefix=None,
        actor=None,
        target_type=None,
        outcome=None,
        start=None,
        end=None,
        search=None,
        integrity_check=True,
    )

    assert response is result
    assert recorded == []


def test_auditor_cannot_bypass_redaction_through_generic_audit_api(monkeypatch):
    request = _request()
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="AUDITOR", has_itsm_access=True
    )
    monkeypatch.setattr(
        "app.services.audit_store.append_audit_event",
        lambda *_args, **_kwargs: None,
    )

    with pytest.raises(HTTPException) as exc:
        audit_api.get_audit_logs(
            request,
            db=db,
            limit=1,
            offset=0,
            action=None,
            integrity_check=True,
            search=None,
            trace_only=False,
        )

    assert exc.value.status_code == 403
    assert exc.value.detail == "Auditor is not authorized for this operation"


@pytest.mark.parametrize(
    ("visible_label", "stored_action"),
    [
        ("Itsm Audit Searched", "itsm.audit.searched"),
        ("Agent-Tool Invoked", "agent.tool.invoked"),
        ("itsm.audit.searched", "itsm.audit.searched"),
    ],
)
def test_visible_audit_action_label_normalizes_to_stored_action(
    visible_label, stored_action
):
    assert audit_api._action_search_candidate(visible_label) == stored_action


def test_auditor_results_resolve_tenant_user_actor_email():
    actor_id = uuid4()
    tenant_id = uuid4()
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = [
        SimpleNamespace(id=actor_id, email="actor@example.test")
    ]
    records = [
        {"actor_id": str(actor_id), "actor_type": "user"},
        {"actor_id": str(uuid4()), "actor_type": "agent"},
    ]

    itsm_audit._attach_actor_displays(db, tenant_id, records)

    assert records[0]["actor_display"] == "actor@example.test"
    assert "actor_display" not in records[1]


def test_auditor_evidence_access_binds_verified_tenant_before_append(monkeypatch):
    request = _request()
    db = MagicMock()
    appended = []
    monkeypatch.setattr(
        itsm_audit,
        "append_audit_event",
        lambda _db, event: appended.append(event),
    )

    itsm_audit._record_auditor_action(
        db,
        request,
        action="itsm.audit.searched",
        reason="Auditor searched tenant audit evidence",
        trace=["records_returned=0"],
    )

    statement = str(db.execute.call_args.args[0])
    parameters = db.execute.call_args.args[1]
    assert "set_config('app.current_tenant_id'" in statement
    assert parameters == {"tenant_id": str(request.state.tenant_id)}
    assert appended[0]["tenant_id"] == str(request.state.tenant_id)
    db.commit.assert_called_once()


def test_auditor_export_reuses_signed_export_and_records_export(monkeypatch):
    request = _request()
    artifact = {"manifest": {"record_count": 3}, "signature": {"value": "signed"}}
    monkeypatch.setattr(
        itsm_audit.audit_api,
        "create_signed_audit_export_artifact",
        lambda *_args, **_kwargs: artifact,
    )
    recorded = []
    monkeypatch.setattr(
        itsm_audit,
        "_record_auditor_action",
        lambda *_args, **kwargs: recorded.append(kwargs),
    )

    response = itsm_audit.export_audit_evidence(
        itsm_audit.audit_api.SignedAuditExportRequest(),
        request,
        db=MagicMock(),
    )

    assert response is artifact
    assert recorded[0]["action"] == "itsm.audit.exported"
    assert recorded[0]["trace"]["record_count"] == 3
    assert recorded[0]["trace"]["export_id"]


def test_audit_trace_envelope_exposes_documented_evidence_fields():
    trace = audit_store.build_execution_trace(
        {
            "execution_trace": ["step=classified"],
            "event_category": "update",
            "actor_role": "incident_manager",
            "target_id": "INC-000123",
            "target_type": "incident",
            "policy_decision": "allowed",
            "approval_id": "approval-1",
            "approval_status": "approved",
            "before_summary": {"status": "NEW"},
            "after_summary": {"status": "ASSIGNED"},
            "evidence_references": ["evidence-1"],
        }
    )

    record = audit_api.enrich_audit_record({"execution_trace": trace})

    assert record["target_id"] == "INC-000123"
    assert record["target_type"] == "incident"
    assert record["actor_role"] == "incident_manager"
    assert record["policy_decision"] == "allowed"
    assert record["approval_id"] == "approval-1"
    assert record["approval_status"] == "approved"
    assert record["before_summary"] == {"status": "NEW"}
    assert record["after_summary"] == {"status": "ASSIGNED"}
    assert record["evidence_references"] == ["evidence-1"]


def test_legacy_itsm_trace_recovers_its_real_target():
    record = audit_api.enrich_audit_record(
        {
            "action": "itsm.incident.assigned",
            "record_id": "audit-record-id",
            "execution_trace": '["ticket_id=incident-id", "ticket_number=INC-000123"]',
        }
    )

    assert record["target_id"] == "incident-id"
    assert record["target_type"] == "incident"


def test_event_backbone_records_target_and_structured_agent_trace():
    event = event_backbone.audit_event(
        event_type="agent_action",
        tenant_id=str(uuid4()),
        subject_id="run-123",
        identity_action="completed",
        action="agent.completed",
        reason="Agent completed the task",
        provider="orchestrator",
        request_id="correlation-123",
        agent_trace={
            "task_goal": "Classify incident",
            "evidence_refs": ["INC-000123"],
            "tools": ["classifier"],
            "approvals": [],
            "model": "model-a",
            "model_version": "v1",
            "cost_usd": 0.01,
            "outcome": "completed",
            "failures": [],
        },
    )
    trace = audit_store.build_execution_trace(event)

    assert event["target_id"] == "run-123"
    assert event["target_type"] == "agent_action"
    assert trace["task_goal"] == "Classify incident"
    assert trace["model_version"] == "v1"
    assert trace["cost_usd"] == 0.01


def test_filtered_audit_integrity_allows_expected_sequence_gaps():
    import hashlib

    older = {
        "tenant_id": "tenant-1",
        "tenant_sequence": 10,
        "canonical_payload": "older-canonical",
        "prior_hash": "older-prior",
        "chain_version": 2,
    }
    older["integrity_hash"] = hashlib.sha256(
        (older["canonical_payload"] + older["prior_hash"]).encode("utf-8")
    ).hexdigest()
    newer = {
        "tenant_id": "tenant-1",
        "tenant_sequence": 12,
        "canonical_payload": "newer-canonical",
        "prior_hash": "hash-of-omitted-sequence-11",
        "chain_version": 2,
    }
    newer["integrity_hash"] = hashlib.sha256(
        (newer["canonical_payload"] + newer["prior_hash"]).encode("utf-8")
    ).hexdigest()

    verified = audit_api._verify_chain([newer, older])

    assert all(record["chain_valid"] for record in verified)


def test_workflow_agent_trace_contains_complete_v15_reconstruction_fields(monkeypatch):
    captured = []
    monkeypatch.setattr(runner.event_backbone, "publish_audit_event", lambda _producer, _tenant, event: captured.append(event))
    monkeypatch.setattr(runner, "_init_kafka_producer", lambda: None)

    workflow_id = str(uuid4())
    runner.emit_audit_event(
        workflow_id,
        str(uuid4()),
        "request-123",
        "GATHER_EVIDENCE->ANALYZE_COMPLIANCE",
        "gather_evidence",
        "completed",
    )

    event = captured[0]
    trace = audit_store.build_execution_trace(event)
    assert event["actor_type"] == "agent"
    assert event["actor_id"] == runner._ORCHESTRATOR_ACTOR_ID
    assert trace["task_goal"] == "Gather evidence for compliance analysis"
    assert trace["evidence_refs"] == [workflow_id, "request-123"]
    assert trace["tools"] == ["document_scanner", "presidio_analyzer"]
    assert trace["approvals"] == []
    assert trace["model"] == "none"
    assert trace["model_version"] == "not-applicable"
    assert trace["cost_usd"] == 0.0
    assert trace["outcome"] == "completed"
    assert trace["failures"] == []


def test_agent_trace_api_is_auditor_only_and_uses_trace_query(monkeypatch):
    route = next(route for route in itsm_audit.router.routes if route.path == "/traces")
    role_dependency = next(
        dependency.call
        for dependency in route.dependant.dependencies
        if "required_roles" in inspect.getclosurevars(dependency.call).nonlocals
    )
    assert inspect.getclosurevars(role_dependency).nonlocals["required_roles"] == ["AUDITOR"]

    result = audit_api.AuditLogsResponse(
        source="postgres", total=1, records=[{"action": "agent.completed"}], integrity_checked=True
    )
    captured = []
    monkeypatch.setattr(
        itsm_audit.audit_api,
        "get_chain_of_record_logs",
        lambda *_args, **kwargs: captured.append(kwargs) or result,
    )
    monkeypatch.setattr(itsm_audit, "_record_auditor_action", lambda *_args, **_kwargs: None)

    response = itsm_audit.search_agent_traces(
        _request(), db=MagicMock(), limit=25, offset=0, search=None, integrity_check=True
    )

    assert response is result
    assert captured[0]["trace_only"] is True


@pytest.mark.parametrize(
    ("endpoint", "attempted_action"),
    [
        (itsm_incidents.list_incidents, "incident.list"),
        (itsm_requests.list_requests, "request.list"),
    ],
)
def test_auditor_cannot_read_operational_workspaces(monkeypatch, endpoint, attempted_action):
    request = _request()
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="AUDITOR", has_itsm_access=True
    )
    blocked = []

    def deny(_request, _db, role, action):
        blocked.append((role, action))
        raise HTTPException(status_code=403, detail="Auditor is not authorized for this operation")

    module = itsm_incidents if endpoint is itsm_incidents.list_incidents else itsm_requests
    monkeypatch.setattr(module, "deny_itsm_auditor_access", deny)

    with pytest.raises(HTTPException) as exc:
        endpoint(request=request, db=db, tenant_id=str(request.state.tenant_id))

    assert exc.value.status_code == 403
    assert blocked == [("AUDITOR", attempted_action)]


@pytest.mark.parametrize("verify", [itsm_services._verify_itsm_user, itsm_knowledge._verify_itsm_user])
def test_auditor_is_not_allowed_service_or_knowledge_workspace_access(verify):
    db = MagicMock()
    db.execute.return_value.first.return_value = SimpleNamespace(
        itsm_role="AUDITOR", has_itsm_access=True
    )

    with pytest.raises(HTTPException) as exc:
        verify(db, uuid4(), uuid4())

    assert exc.value.status_code == 403
