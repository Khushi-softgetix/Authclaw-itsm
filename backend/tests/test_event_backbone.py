from app.services import event_backbone


def test_stable_event_id_is_deterministic_for_same_identity():
    first = event_backbone.stable_event_id(
        event_type="workflow",
        tenant_id="tenant-1",
        subject_id="workflow-1",
        action="TRANSITION:action:status:req-1",
        trace=["workflow_id=workflow-1", "transition=TRANSITION"],
    )
    second = event_backbone.stable_event_id(
        event_type="workflow",
        tenant_id="tenant-1",
        subject_id="workflow-1",
        action="TRANSITION:action:status:req-1",
        trace=["workflow_id=workflow-1", "transition=TRANSITION"],
    )

    assert first == second


def test_backend_event_topic_names_match_backbone_contract():
    assert event_backbone.GATEWAY_TRAFFIC_TOPIC == "gateway.traffic"
    assert event_backbone.AUDIT_EVENTS_TOPIC == "audit.events"
    assert event_backbone.AUDIT_DLQ_TOPIC == "audit.deadletter"


def test_publish_persists_before_kafka(monkeypatch):
    order = []

    monkeypatch.setattr(
        event_backbone,
        "persist_audit_event",
        lambda _event: order.append("postgres"),
    )
    monkeypatch.setattr(
        event_backbone,
        "publish_pending_audit_events",
        lambda _producer, _tenant: order.append("outbox"),
    )

    assert event_backbone.publish_audit_event(object(), "tenant-1", {}) is None
    assert order == ["postgres", "outbox"]


def test_publish_stops_when_postgres_fails(monkeypatch):
    failure = RuntimeError("postgres unavailable")
    monkeypatch.setattr(event_backbone, "persist_audit_event", lambda _event: failure)

    assert event_backbone.publish_audit_event(object(), "tenant-1", {}) is failure


def test_persist_binds_database_tenant_before_audit_append(monkeypatch):
    calls = []

    class FakeSession:
        def __init__(self):
            self.info = {}

        def execute(self, statement, params):
            calls.append((str(statement), params, dict(self.info)))

        def commit(self):
            calls.append(("commit", None, dict(self.info)))

        def rollback(self):
            raise AssertionError("successful persistence must not roll back")

        def close(self):
            calls.append(("close", None, dict(self.info)))

    tenant_id = "11111111-1111-1111-1111-111111111111"
    session = FakeSession()
    monkeypatch.setattr("app.db.session.SessionLocal", lambda: session)
    monkeypatch.setattr(
        "app.services.audit_store.append_audit_event",
        lambda db, event: calls.append(("append", event, dict(db.info))),
    )

    assert event_backbone.persist_audit_event({"tenant_id": tenant_id}) is None
    assert "set_config('app.current_tenant_id'" in calls[0][0]
    assert calls[0][1] == {"tenant_id": tenant_id}
    assert calls[0][2] == {"tenant_id": tenant_id}
    assert calls[1] == ("append", {"tenant_id": tenant_id}, {"tenant_id": tenant_id})
