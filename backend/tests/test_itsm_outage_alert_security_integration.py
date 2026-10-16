"""PostgreSQL/API integration coverage for Outage & Alerts P0 controls."""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core.auth import hash_key
from main import app


@pytest.fixture(scope="module")
def outage_context():
    owner_url = os.getenv(
        "OWNER_DATABASE_URL",
        "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
    )
    engine = create_engine(owner_url, pool_pre_ping=True)
    client = TestClient(app)
    ids = {name: uuid4() for name in (
        "tenant_a", "tenant_b", "manager", "scoped_manager", "requester", "unlinked_requester",
        "agent", "process_manager", "other_process_manager", "catalog_manager",
        "auditor", "platform_admin", "tenant_b_requester", "service_a", "service_a_other",
        "service_b", "team_a", "incident_same_service", "incident_agent_authorized",
        "incident_other_service",
        "problem_same_service", "change_same_service",
    )}
    keys = {
        name: f"ak_live_outage_{name}_{uuid4().hex[:12]}"
        for name in (
            "manager", "scoped_manager", "requester", "unlinked_requester", "agent", "process_manager",
            "other_process_manager", "catalog_manager", "auditor", "platform_admin",
            "tenant_b_requester",
        )
    }

    with engine.begin() as conn:
        for key in ("tenant_a", "tenant_b"):
            conn.execute(text(
                "INSERT INTO public.tenants (id,name,tier,status,created_at,updated_at) "
                "VALUES (:id,:name,'starter','active',now(),now())"
            ), {"id": ids[key], "name": f"outage-security-{key}-{uuid4().hex[:8]}"})

        def create_user(name: str, tenant: UUID, role: str) -> None:
            conn.execute(text(
                "INSERT INTO public.users (id,tenant_id,email,role,platform_role,is_active,created_at,updated_at) "
                "VALUES (:id,:tenant,:email,'admin','NONE',true,now(),now())"
            ), {"id": ids[name], "tenant": tenant, "email": f"{name}-{uuid4().hex[:8]}@example.com"})
            conn.execute(text(
                "INSERT INTO public.itsm_user_access "
                "(id,tenant_id,user_id,itsm_role,has_itsm_access,has_governance_access,created_at,updated_at) "
                "VALUES (gen_random_uuid(),:tenant,:user_id,:role,true,true,now(),now())"
            ), {"tenant": tenant, "user_id": ids[name], "role": role})
            conn.execute(text(
                "INSERT INTO public.api_keys "
                "(id,tenant_id,key_hash,name,scopes,is_active,created_by,created_at,updated_at) "
                "VALUES (gen_random_uuid(),:tenant,:key_hash,:name,ARRAY['read','write','admin'],true,:user_id,now(),now())"
            ), {"tenant": tenant, "key_hash": hash_key(keys[name]), "name": f"outage-{name}", "user_id": ids[name]})

        create_user("manager", ids["tenant_a"], "INCIDENT_MANAGER")
        create_user("scoped_manager", ids["tenant_a"], "INCIDENT_MANAGER")
        create_user("requester", ids["tenant_a"], "REQUESTER")
        create_user("unlinked_requester", ids["tenant_a"], "REQUESTER")
        create_user("agent", ids["tenant_a"], "SERVICE_AGENT")
        create_user("process_manager", ids["tenant_a"], "PROCESS_CHANGE_MANAGER")
        create_user("other_process_manager", ids["tenant_a"], "PROCESS_CHANGE_MANAGER")
        create_user("catalog_manager", ids["tenant_a"], "CATALOG_MANAGER")
        create_user("auditor", ids["tenant_a"], "AUDITOR")
        create_user("platform_admin", ids["tenant_a"], "PLATFORM_ADMINISTRATOR")
        create_user("tenant_b_requester", ids["tenant_b"], "REQUESTER")

        for name, tenant in (
            ("service_a", ids["tenant_a"]),
            ("service_a_other", ids["tenant_a"]),
            ("service_b", ids["tenant_b"]),
        ):
            conn.execute(text(
                "INSERT INTO public.itsm_services "
                "(id,tenant_id,name,slug,description,tier,status,created_at,updated_at) "
                "VALUES (:id,:tenant,:name,:slug,'Integration service','TIER_1','OPERATIONAL',now(),now())"
            ), {"id": ids[name], "tenant": tenant, "name": name, "slug": f"{name}-{uuid4().hex[:6]}"})
        conn.execute(text(
            "UPDATE public.itsm_services SET owner_user_id=:owner "
            "WHERE tenant_id=:tenant AND id=:service"
        ), {
            "owner": ids["catalog_manager"],
            "tenant": ids["tenant_a"],
            "service": ids["service_a"],
        })

        conn.execute(text(
            "INSERT INTO public.itsm_service_consumers "
            "(id,tenant_id,service_id,user_id,is_active,source,effective_from,created_at) "
            "VALUES (gen_random_uuid(),:tenant,:service,:user,true,'TEST',now(),now())"
        ), {"tenant": ids["tenant_a"], "service": ids["service_a"], "user": ids["requester"]})
        conn.execute(text(
            "INSERT INTO public.itsm_teams (id,tenant_id,name,description,is_active,created_at,updated_at) "
            "VALUES (:id,:tenant,'Outage Support','Integration team',true,now(),now())"
        ), {"id": ids["team_a"], "tenant": ids["tenant_a"]})
        conn.execute(text(
            "INSERT INTO public.itsm_team_members (id,tenant_id,team_id,user_id,created_at) "
            "VALUES (gen_random_uuid(),:tenant,:team,:user,now())"
        ), {"tenant": ids["tenant_a"], "team": ids["team_a"], "user": ids["agent"]})
        conn.execute(text(
            "INSERT INTO public.itsm_service_support_teams (id,tenant_id,service_id,team_id,created_at) "
            "VALUES (gen_random_uuid(),:tenant,:service,:team,now())"
        ), {"tenant": ids["tenant_a"], "service": ids["service_a"], "team": ids["team_a"]})

        conn.execute(text(
            "INSERT INTO public.itsm_tickets "
            "(id,tenant_id,ticket_number,ticket_type,title,description,impact,urgency,priority,status,"
            "source_channel,requester_id,service_id,category,is_major_incident,sla_status,"
            "sla_accumulated_pause_seconds,ai_triaged,created_at,updated_at) "
            "VALUES (:id,:tenant,:number,'INCIDENT','Other service incident','Scope test','MEDIUM','MEDIUM',"
            "'P3','NEW','PORTAL',:requester,:service,'GENERAL',false,'WITHIN_SLA',0,false,now(),now())"
        ), {
            "id": ids["incident_other_service"], "tenant": ids["tenant_a"],
            "number": f"INC-{uuid4().hex[:8]}", "requester": ids["requester"],
            "service": ids["service_a_other"],
        })
        conn.execute(text(
            "INSERT INTO public.itsm_tickets "
            "(id,tenant_id,ticket_number,ticket_type,title,description,impact,urgency,priority,status,"
            "source_channel,requester_id,service_id,category,is_major_incident,sla_status,"
            "sla_accumulated_pause_seconds,ai_triaged,created_at,updated_at) "
            "VALUES (:id,:tenant,:number,'INCIDENT','Restricted incident','Scope test','MEDIUM','MEDIUM',"
            "'P3','NEW','PORTAL',:requester,:service,'GENERAL',false,'WITHIN_SLA',0,false,now(),now())"
        ), {
            "id": ids["incident_same_service"], "tenant": ids["tenant_a"],
            "number": f"INC-{uuid4().hex[:8]}", "requester": ids["requester"],
            "service": ids["service_a"],
        })
        conn.execute(text(
            "INSERT INTO public.itsm_tickets "
            "(id,tenant_id,ticket_number,ticket_type,title,description,impact,urgency,priority,status,"
            "source_channel,requester_id,service_id,category,assignment_group,is_major_incident,sla_status,"
            "sla_accumulated_pause_seconds,ai_triaged,created_at,updated_at) "
            "VALUES (:id,:tenant,:number,'INCIDENT','Assigned support incident','Solve scope test','MEDIUM','MEDIUM',"
            "'P3','ASSIGNED','PORTAL',:requester,:service,'GENERAL','Outage Support',false,'WITHIN_SLA',0,false,now(),now())"
        ), {
            "id": ids["incident_agent_authorized"], "tenant": ids["tenant_a"],
            "number": f"INC-{uuid4().hex[:8]}", "requester": ids["requester"],
            "service": ids["service_a"],
        })
        conn.execute(text(
            "INSERT INTO public.itsm_tickets "
            "(id,tenant_id,ticket_number,ticket_type,title,description,impact,urgency,priority,status,"
            "source_channel,requester_id,service_id,category,is_major_incident,sla_status,"
            "sla_accumulated_pause_seconds,ai_triaged,created_at,updated_at) "
            "VALUES (:id,:tenant,:number,'PROBLEM','Recurring email failure','Problem scope test','MEDIUM','MEDIUM',"
            "'P3','IN_PROGRESS','PORTAL',:requester,:service,'GENERAL',false,'WITHIN_SLA',0,false,now(),now())"
        ), {
            "id": ids["problem_same_service"], "tenant": ids["tenant_a"],
            "number": f"PRB-{uuid4().hex[:8]}", "requester": ids["requester"],
            "service": ids["service_a"],
        })
        conn.execute(text(
            "INSERT INTO public.itsm_problem_details "
            "(id,tenant_id,ticket_id,known_error,assigned_investigator_id,created_at,updated_at) "
            "VALUES (gen_random_uuid(),:tenant,:ticket,false,:manager,now(),now())"
        ), {
            "tenant": ids["tenant_a"], "ticket": ids["problem_same_service"],
            "manager": ids["process_manager"],
        })
        conn.execute(text(
            "INSERT INTO public.itsm_change_requests "
            "(id,tenant_id,change_number,title,description,change_type,risk_level,impact_level,status,"
            "service_id,lead_time_hours,outage_expected,implementation_plan,backout_plan,test_plan,"
            "requested_by_id,assigned_to_id,created_at,updated_at) "
            "VALUES (:id,:tenant,:number,'Email recovery change','Change scope test','NORMAL','LOW','MEDIUM',"
            "'DRAFT',:service,0,false,'Plan','Backout','Test',:requester,:manager,now(),now())"
        ), {
            "id": ids["change_same_service"], "tenant": ids["tenant_a"],
            "number": f"CHG-{uuid4().hex[:8]}", "service": ids["service_a"],
            "requester": ids["manager"], "manager": ids["process_manager"],
        })

        # Make the second Incident Manager intentionally service-scoped and
        # unable to publish, proving role alone is not sufficient.
        conn.execute(text(
            "DELETE FROM public.itsm_outage_alert_grants WHERE tenant_id=:tenant AND user_id=:user"
        ), {"tenant": ids["tenant_a"], "user": ids["scoped_manager"]})
        for permission in ("OUTAGE_ALERT:READ", "OUTAGE_ALERT:CREATE", "OUTAGE_ALERT:PREVIEW"):
            conn.execute(text(
                "INSERT INTO public.itsm_outage_alert_grants (tenant_id,user_id,permission,service_id) "
                "VALUES (:tenant,:user,:permission,:service)"
            ), {
                "tenant": ids["tenant_a"], "user": ids["scoped_manager"],
                "permission": permission, "service": ids["service_a"],
            })

    context = {"engine": engine, "client": client, "ids": ids, "keys": keys}
    yield context
    client.close()
    engine.dispose()


def headers(context, user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {context['keys'][user]}"}


def draft_payload(context, *, service: str = "service_a", include_bad_link: bool = False) -> dict:
    payload = {
        "title": "Email service unavailable",
        "alert_type": "OUTAGE",
        "severity": "CRITICAL",
        "intent": "INFORM",
        "public_summary": "Email is temporarily unavailable.",
        "impact_summary": "Users cannot send or receive email.",
        "recommended_action": "Please wait for the next update.",
        "service_agent_guidance": "Use the approved mail continuity runbook.",
        "internal_notes": "Restricted infrastructure diagnostics.",
        "service_agent_handling": "ALERT_ONLY",
        "service_ids": [str(context["ids"][service])],
        "ci_ids": [],
        "audiences": [
            {"audience_type": "SERVICE_USERS"},
            {"audience_type": "SERVICE_AGENTS"},
        ],
        "links": [],
    }
    if include_bad_link:
        payload["links"] = [{
            "target_type": "INCIDENT",
            "target_id": str(context["ids"]["incident_other_service"]),
        }]
    return payload


def create_and_preview(context) -> tuple[str, str]:
    client = context["client"]
    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(context, "manager"),
        json=draft_payload(context),
    )
    assert created.status_code == 201, created.text
    alert_id = created.json()["id"]
    preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(context, "manager"),
        json={},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["total_recipients"] == 2
    return alert_id, preview.json()["preview_token"]


@pytest.fixture(scope="module", autouse=True)
def base_published_alert(outage_context):
    alert_id, preview_token = create_and_preview(outage_context)
    response = outage_context["client"].post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview_token,
            "idempotency_key": f"base-publication-{uuid4()}",
        },
    )
    assert response.status_code == 200, response.text
    outage_context["alert_id"] = alert_id
    outage_context["publication_id"] = response.json()["publication_id"]
    yield


def test_recipient_evidence_is_paginated_explainable_and_manager_only(outage_context):
    client = outage_context["client"]
    alert_id = outage_context["alert_id"]

    live = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}/recipients?limit=1",
        headers=headers(outage_context, "manager"),
    )
    assert live.status_code == 200, live.text
    assert live.json()["source"] == "LIVE_PREVIEW"
    assert live.json()["total"] == 2
    assert live.json()["has_more"] is True
    assert len(live.json()["items"]) == 1
    assert live.json()["items"][0]["audience_memberships"]
    assert live.json()["items"][0]["inclusion_reason"]
    assert live.json()["items"][0]["delivery_status"] is None

    published = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}/recipients",
        headers=headers(outage_context, "manager"),
        params={
            "publication_id": outage_context["publication_id"],
            "search": "requester-",
        },
    )
    assert published.status_code == 200, published.text
    assert published.json()["source"] == "PUBLICATION_SNAPSHOT"
    assert published.json()["publication_version"] == 1
    assert published.json()["total"] == 1
    item = published.json()["items"][0]
    assert item["email"].startswith("requester-")
    assert item["delivery_status"] == "AVAILABLE"
    assert item["channels"] == ["IN_APP", "PORTAL"]
    assert "internal_notes" not in item["projection_fields"]

    for denied_role in ("requester", "auditor", "platform_admin"):
        denied = client.get(
            f"/v1/itsm/outage-alerts/{alert_id}/recipients",
            headers=headers(outage_context, denied_role),
        )
        assert denied.status_code == 403


def test_explicit_permission_service_scope_and_record_scope(outage_context):
    client = outage_context["client"]
    denied_service = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "scoped_manager"),
        json=draft_payload(outage_context, service="service_a_other"),
    )
    assert denied_service.status_code == 403

    denied_link = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=draft_payload(outage_context, include_bad_link=True),
    )
    assert denied_link.status_code == 422
    assert "outside the affected services" in denied_link.text


def test_tenant_wide_portal_audience_is_safe_confirmed_and_tenant_isolated(outage_context):
    client = outage_context["client"]
    ids = outage_context["ids"]
    payload = draft_payload(outage_context)
    payload.update({
        "title": "Planned office power shutdown",
        "alert_type": "MAINTENANCE",
        "intent": "ACTION_REQUIRED",
        "public_summary": "Office power will be unavailable tomorrow from 1:00 PM to 2:00 PM.",
        "impact_summary": "Employee workstations will not have power.",
        "recommended_action": "Save your work and shut down your system before 1:00 PM.",
        "service_ids": [],
        "audiences": [{"audience_type": "ALL_PORTAL_USERS"}],
    })

    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert created.status_code == 201, created.text
    alert_id = created.json()["id"]

    preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json={},
    )
    assert preview.status_code == 200, preview.text
    # Requesters, Service Agents, process/service managers, and Incident
    # Managers are employee-facing portal accounts. Auditor and Platform
    # Administrator accounts remain outside business-alert delivery.
    assert preview.json()["total_recipients"] == 8
    assert {group["projection_type"] for group in preview.json()["groups"]} == {"REQUESTER"}

    unconfirmed = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": f"tenant-wide-unconfirmed-{uuid4()}",
        },
    )
    assert unconfirmed.status_code == 422
    assert "Confirm the tenant-wide recipient preview" in unconfirmed.text

    published = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": f"tenant-wide-confirmed-{uuid4()}",
            "confirm_tenant_wide": True,
        },
    )
    assert published.status_code == 200, published.text
    assert published.json()["recipient_count"] == preview.json()["total_recipients"]

    with outage_context["engine"].connect() as conn:
        rows = conn.execute(text(
            "SELECT recipient.user_id,recipient.projection_type,recipient.content_snapshot "
            "FROM public.itsm_outage_alert_recipients AS recipient "
            "WHERE recipient.tenant_id=:tenant AND recipient.publication_id=:publication"
        ), {
            "tenant": ids["tenant_a"],
            "publication": UUID(published.json()["publication_id"]),
        }).mappings().all()
    assert {row["user_id"] for row in rows}.isdisjoint({
        ids["auditor"], ids["platform_admin"], ids["tenant_b_requester"],
    })
    assert {row["projection_type"] for row in rows} == {"REQUESTER"}
    assert all("internal_notes" not in row["content_snapshot"] for row in rows)
    assert all("service_agent_guidance" not in row["content_snapshot"] for row in rows)

    scoped_payload = dict(payload)
    scoped_payload["service_ids"] = [str(ids["service_a"])]
    denied = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "scoped_manager"),
        json=scoped_payload,
    )
    assert denied.status_code == 403
    assert "tenant-wide permission grant" in denied.text


def test_active_alert_links_are_scoped_audited_and_preserve_publications(outage_context):
    client = outage_context["client"]
    ids = outage_context["ids"]
    alert_id, preview_token = create_and_preview(outage_context)
    publication = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview_token,
            "idempotency_key": f"active-link-{uuid4()}",
        },
    )
    assert publication.status_code == 200, publication.text
    publication_id = publication.json()["publication_id"]

    linked = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/links",
        headers=headers(outage_context, "manager"),
        json={
            "target_type": "INCIDENT",
            "target_id": str(ids["incident_same_service"]),
        },
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["status"] == "ACTIVE"
    assert "LINK_RECORD" in linked.json()["allowed_actions"]
    assert {
        "type": "INCIDENT",
        "id": str(ids["incident_same_service"]),
    } in linked.json()["links"]

    denied_scope = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/links",
        headers=headers(outage_context, "manager"),
        json={
            "target_type": "INCIDENT",
            "target_id": str(ids["incident_other_service"]),
        },
    )
    assert denied_scope.status_code == 422
    assert "outside the affected services" in denied_scope.text

    denied_role = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/links",
        headers=headers(outage_context, "agent"),
        json={
            "target_type": "INCIDENT",
            "target_id": str(ids["incident_same_service"]),
        },
    )
    assert denied_role.status_code == 403

    removed = client.delete(
        f"/v1/itsm/outage-alerts/{alert_id}/links/INCIDENT/{ids['incident_same_service']}",
        headers=headers(outage_context, "manager"),
    )
    assert removed.status_code == 204, removed.text
    repeated = client.delete(
        f"/v1/itsm/outage-alerts/{alert_id}/links/INCIDENT/{ids['incident_same_service']}",
        headers=headers(outage_context, "manager"),
    )
    assert repeated.status_code == 204, repeated.text

    detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "manager"),
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["links"] == []
    assert len(detail.json()["publications"]) == 1
    assert detail.json()["publications"][0]["id"] == publication_id

    with outage_context["engine"].connect() as conn:
        actions = conn.execute(text(
            "SELECT action FROM public.audit_log_metadata "
            "WHERE tenant_id=:tenant AND request_id=:alert "
            "AND action IN ('itsm.outage_alert.link.added','itsm.outage_alert.link.removed') "
            "ORDER BY tenant_sequence"
        ), {
            "tenant": ids["tenant_a"],
            "alert": alert_id,
        }).scalars().all()
    assert actions == [
        "itsm.outage_alert.link.added",
        "itsm.outage_alert.link.removed",
    ]


def test_active_alert_link_rolls_back_when_required_audit_fails(outage_context):
    client = outage_context["client"]
    ids = outage_context["ids"]
    alert_id, preview_token = create_and_preview(outage_context)
    publication = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview_token,
            "idempotency_key": f"active-link-audit-{uuid4()}",
        },
    )
    assert publication.status_code == 200, publication.text

    with TestClient(app, raise_server_exceptions=False) as failure_client:
        with patch(
            "app.services.itsm_outage_alert_service.append_audit_event",
            side_effect=RuntimeError("audit unavailable"),
        ):
            response = failure_client.post(
                f"/v1/itsm/outage-alerts/{alert_id}/links",
                headers=headers(outage_context, "manager"),
                json={
                    "target_type": "INCIDENT",
                    "target_id": str(ids["incident_same_service"]),
                },
            )
    assert response.status_code == 500

    with outage_context["engine"].connect() as conn:
        link_count = conn.execute(text(
            "SELECT count(*) FROM public.itsm_outage_alert_links "
            "WHERE tenant_id=:tenant AND alert_id=:alert "
            "AND target_type='INCIDENT' AND target_id=:target"
        ), {
            "tenant": ids["tenant_a"],
            "alert": alert_id,
            "target": ids["incident_same_service"],
        }).scalar_one()
    assert link_count == 0


def test_company_wide_service_resolves_requesters_without_manual_user_links(outage_context):
    client = outage_context["client"]
    ids = outage_context["ids"]
    service_id = ids["service_a_other"]

    updated = client.patch(
        f"/v1/itsm/admin/services/{service_id}",
        headers=headers(outage_context, "platform_admin"),
        json={"alert_recipient_scope": "ALL_REQUESTERS"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["alert_recipient_scope"] == "ALL_REQUESTERS"

    try:
        targeting = client.get(
            f"/v1/itsm/outage-alerts/services/{service_id}/targeting",
            headers=headers(outage_context, "platform_admin"),
        )
        assert targeting.status_code == 200, targeting.text
        targeting_body = targeting.json()
        assert targeting_body["active_requester_count"] == 2
        assert targeting_body["entitled_requester_count"] == 0
        assert targeting_body["eligible_requester_count"] == 2
        assert "requesters" not in targeting_body

        payload = draft_payload(outage_context, service="service_a_other")
        payload["audiences"] = [{"audience_type": "SERVICE_USERS"}]
        created = client.post(
            "/v1/itsm/outage-alerts",
            headers=headers(outage_context, "manager"),
            json=payload,
        )
        assert created.status_code == 201, created.text
        preview = client.post(
            f"/v1/itsm/outage-alerts/{created.json()['id']}/preview",
            headers=headers(outage_context, "manager"),
            json={},
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["total_recipients"] == 2
        assert preview.json()["groups"][0]["included_because"] == "Active Requester for a company-wide affected service"

        denied = client.patch(
            f"/v1/itsm/admin/services/{service_id}",
            headers=headers(outage_context, "manager"),
            json={"alert_recipient_scope": "SERVICE_ENTITLEMENTS"},
        )
        assert denied.status_code == 403
    finally:
        restored = client.patch(
            f"/v1/itsm/admin/services/{service_id}",
            headers=headers(outage_context, "platform_admin"),
            json={"alert_recipient_scope": "SERVICE_ENTITLEMENTS"},
        )
        assert restored.status_code == 200, restored.text


def test_preview_separates_mixed_role_team_members_by_projection(outage_context):
    client = outage_context["client"]
    ids = outage_context["ids"]
    with outage_context["engine"].begin() as conn:
        conn.execute(text(
            "INSERT INTO public.itsm_team_members (id,tenant_id,team_id,user_id,created_at) "
            "VALUES (gen_random_uuid(),:tenant,:team,:user,now()) ON CONFLICT DO NOTHING"
        ), {
            "tenant": ids["tenant_a"],
            "team": ids["team_a"],
            "user": ids["requester"],
        })
    try:
        payload = draft_payload(outage_context)
        payload["audiences"] = [{
            "audience_type": "SELECTED_TEAM",
            "team_id": str(ids["team_a"]),
        }]
        created = client.post(
            "/v1/itsm/outage-alerts",
            headers=headers(outage_context, "manager"),
            json=payload,
        )
        assert created.status_code == 201, created.text
        preview = client.post(
            f"/v1/itsm/outage-alerts/{created.json()['id']}/preview",
            headers=headers(outage_context, "manager"),
            json={},
        )
        assert preview.status_code == 200, preview.text
        assert {
            (group["audience_type"], group["projection_type"])
            for group in preview.json()["groups"]
        } == {
            ("SELECTED_TEAM", "REQUESTER"),
            ("SELECTED_TEAM", "SERVICE_AGENT"),
        }
    finally:
        with outage_context["engine"].begin() as conn:
            conn.execute(text(
                "DELETE FROM public.itsm_team_members "
                "WHERE tenant_id=:tenant AND team_id=:team AND user_id=:user"
            ), {
                "tenant": ids["tenant_a"],
                "team": ids["team_a"],
                "user": ids["requester"],
            })


def test_saved_draft_can_be_edited_only_by_an_authorized_manager(outage_context):
    client = outage_context["client"]
    payload = draft_payload(outage_context)
    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert created.status_code == 201, created.text
    alert_id = created.json()["id"]

    payload["title"] = "Updated customer-safe outage title"
    updated = client.put(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["content"]["title"] == payload["title"]

    denied = client.put(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "requester"),
        json=payload,
    )
    assert denied.status_code == 403

    unsupported_expiry = {**payload, "expires_at": "2027-01-01T00:00:00Z"}
    rejected = client.put(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "manager"),
        json=unsupported_expiry,
    )
    assert rejected.status_code == 422


def test_preview_changes_do_not_mutate_the_saved_draft(outage_context):
    client = outage_context["client"]
    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=draft_payload(outage_context),
    )
    assert created.status_code == 201, created.text
    alert_id = created.json()["id"]
    preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json={"public_summary": "Unsaved preview-only message"},
    )
    assert preview.status_code == 200, preview.text
    detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "manager"),
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["content"]["public_summary"] == "Email is temporarily unavailable."


def test_requester_public_timestamps_status_and_immutable_history(outage_context):
    client = outage_context["client"]
    payload = draft_payload(outage_context)
    payload["outage_started_at"] = "2026-10-13T08:00:00Z"
    payload["next_update_at"] = "2026-10-13T08:30:00Z"
    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert created.status_code == 201, created.text
    alert_id = created.json()["id"]

    initial_changes = {
        "publication_type": "INITIAL",
        "public_status": "IDENTIFIED",
    }
    initial_preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json=initial_changes,
    )
    assert initial_preview.status_code == 200, initial_preview.text
    initial = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": initial_preview.json()["preview_token"],
            "idempotency_key": f"public-status-initial-{uuid4()}",
            "public_status": "IDENTIFIED",
        },
    )
    assert initial.status_code == 200, initial.text

    requester = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "requester"),
    )
    assert requester.status_code == 200, requester.text
    initial_content = requester.json()["content"]
    assert initial_content["public_status"] == "IDENTIFIED"
    assert initial_content["outage_started_at"] == "2026-10-13T08:00:00+00:00"
    assert initial_content["latest_publication_at"] == initial.json()["published_at"]
    assert initial_content["recovered_at"] is None

    # A non-public record edit must not masquerade as a published update.
    with outage_context["engine"].begin() as conn:
        conn.execute(text(
            "UPDATE public.itsm_outage_alerts "
            "SET internal_notes='Internal follow-up', updated_at=updated_at + interval '10 minutes' "
            "WHERE id=:alert"
        ), {"alert": alert_id})
    after_internal_edit = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "requester"),
    )
    assert after_internal_edit.status_code == 200, after_internal_edit.text
    assert after_internal_edit.json()["content"]["latest_publication_at"] == initial.json()["published_at"]
    assert "internal_notes" not in after_internal_edit.json()["content"]

    invalid_recovery_phase = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json={"publication_type": "UPDATE", "public_status": "RECOVERED"},
    )
    assert invalid_recovery_phase.status_code == 422

    update_changes = {
        "publication_type": "UPDATE",
        "public_status": "MONITORING",
        "public_summary": "Email access is restored and is being monitored.",
        "impact_summary": "Email service is available while monitoring continues.",
        "recommended_action": "Retry any failed messages.",
        "next_update_at": "2026-10-13T09:00:00Z",
    }
    update_preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json=update_changes,
    )
    assert update_preview.status_code == 200, update_preview.text
    update = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/updates",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": update_preview.json()["preview_token"],
            "idempotency_key": f"public-status-update-{uuid4()}",
            **{key: value for key, value in update_changes.items() if key != "publication_type"},
        },
    )
    assert update.status_code == 200, update.text

    updated_detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "requester"),
    )
    assert updated_detail.status_code == 200, updated_detail.text
    updated_body = updated_detail.json()
    assert updated_body["content"]["public_status"] == "MONITORING"
    assert updated_body["content"]["latest_publication_at"] == update.json()["published_at"]
    assert updated_body["content"]["published_at"] == initial.json()["published_at"]
    assert len(updated_body["publications"]) == 2
    assert updated_body["publications"][0]["content"]["public_status"] == "IDENTIFIED"
    assert updated_body["publications"][0]["content"]["public_summary"] == payload["public_summary"]
    assert updated_body["publications"][1]["content"]["public_status"] == "MONITORING"
    assert updated_body["publications"][1]["content"]["impact_summary"] == update_changes["impact_summary"]

    recovery_changes = {
        "publication_type": "RECOVERY",
        "public_status": "RECOVERED",
        "public_summary": "Email service has fully recovered.",
        "impact_summary": "Email service is operating normally.",
        "recommended_action": "No further action is required.",
        "next_update_at": None,
    }
    recovery_preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json=recovery_changes,
    )
    assert recovery_preview.status_code == 200, recovery_preview.text
    recovery = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/recovery",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": recovery_preview.json()["preview_token"],
            "idempotency_key": f"public-status-recovery-{uuid4()}",
            **{key: value for key, value in recovery_changes.items() if key != "publication_type"},
        },
    )
    assert recovery.status_code == 200, recovery.text

    recovered_detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "requester"),
    )
    assert recovered_detail.status_code == 200, recovered_detail.text
    recovered_body = recovered_detail.json()
    assert recovered_body["status"] == "RECOVERED"
    assert recovered_body["content"]["public_status"] == "RECOVERED"
    assert recovered_body["content"]["recovered_at"] == recovery.json()["published_at"]
    assert recovered_body["content"]["latest_publication_at"] == recovery.json()["published_at"]
    assert [item["type"] for item in recovered_body["publications"]] == ["INITIAL", "UPDATE", "RECOVERY"]

    active = client.get(
        "/v1/itsm/outage-alerts/active",
        headers=headers(outage_context, "requester"),
    )
    assert active.status_code == 200, active.text
    assert alert_id not in {item["id"] for item in active.json()}
    recovered = client.get(
        "/v1/itsm/outage-alerts?status=RECOVERED",
        headers=headers(outage_context, "requester"),
    )
    assert recovered.status_code == 200, recovered.text
    recovered_summary = next(item for item in recovered.json() if item["id"] == alert_id)
    assert recovered_summary["public_status"] == "RECOVERED"
    assert recovered_summary["latest_publication_at"] == recovery.json()["published_at"]


def test_auditor_and_platform_admin_cannot_create_or_publish(outage_context):
    client = outage_context["client"]
    for user in ("auditor", "platform_admin"):
        response = client.post(
            "/v1/itsm/outage-alerts",
            headers=headers(outage_context, user),
            json=draft_payload(outage_context),
        )
        assert response.status_code == 403, (user, response.text)


def test_relationship_scoped_process_and_service_owner_audiences(outage_context):
    client = outage_context["client"]
    ids = outage_context["ids"]
    payload = draft_payload(outage_context)
    payload["audiences"] = [
        {"audience_type": "PROBLEM_MANAGERS"},
        {"audience_type": "CHANGE_MANAGERS"},
        {"audience_type": "SERVICE_OWNERS"},
    ]
    payload["links"] = [
        {"target_type": "PROBLEM", "target_id": str(ids["problem_same_service"])},
        {"target_type": "CHANGE", "target_id": str(ids["change_same_service"])},
    ]
    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert created.status_code == 201, created.text
    alert_id = created.json()["id"]
    preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json={},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["total_recipients"] == 2
    groups = {group["audience_type"]: group for group in preview.json()["groups"]}
    assert groups["PROBLEM_MANAGERS"]["recipient_count"] == 1
    assert groups["CHANGE_MANAGERS"]["recipient_count"] == 1
    assert groups["SERVICE_OWNERS"]["recipient_count"] == 1

    published = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": f"relationship-audiences-{uuid4()}",
        },
    )
    assert published.status_code == 200, published.text
    assert published.json()["recipient_count"] == 2

    process_detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "process_manager"),
    )
    assert process_detail.status_code == 200, process_detail.text
    assert {item["type"] for item in process_detail.json()["links"]} == {"PROBLEM", "CHANGE"}
    assert client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "other_process_manager"),
    ).status_code == 404

    owner_detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "catalog_manager"),
    )
    assert owner_detail.status_code == 200, owner_detail.text
    assert {item["type"] for item in owner_detail.json()["links"]} == {"PROBLEM", "CHANGE"}

    auditor_detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "auditor"),
    )
    assert auditor_detail.status_code == 200, auditor_detail.text
    assert auditor_detail.json()["allowed_actions"] == ["VIEW_EVIDENCE"]


def test_specific_user_is_a_narrowing_rule_not_an_authorization_bypass(outage_context):
    client = outage_context["client"]
    payload = draft_payload(outage_context)
    payload["audiences"] = [{
        "audience_type": "SPECIFIC_USER",
        "user_id": str(outage_context["ids"]["requester"]),
    }]
    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert created.status_code == 201, created.text
    preview = client.post(
        f"/v1/itsm/outage-alerts/{created.json()['id']}/preview",
        headers=headers(outage_context, "manager"),
        json={},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["total_recipients"] == 1

    payload["audiences"] = [{
        "audience_type": "SPECIFIC_USER",
        "user_id": str(outage_context["ids"]["tenant_b_requester"]),
    }]
    denied = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert denied.status_code == 422
    assert "not currently eligible" in denied.text


def test_publish_projection_idempotency_and_tenant_isolation(outage_context):
    client = outage_context["client"]
    alert_id, preview_token = create_and_preview(outage_context)
    publication = {
        "preview_token": preview_token,
        "idempotency_key": f"publish-{uuid4()}",
    }

    denied = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "scoped_manager"),
        json=publication,
    )
    assert denied.status_code == 403
    assert "OUTAGE_ALERT:PUBLISH" in denied.text

    first = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json=publication,
    )
    assert first.status_code == 200, first.text
    repeated = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json=publication,
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["publication_id"] == first.json()["publication_id"]

    requester_detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "requester"),
    )
    assert requester_detail.status_code == 200, requester_detail.text
    requester_content = requester_detail.json()["content"]
    assert requester_content["public_summary"] == "Email is temporarily unavailable."
    assert "severity" not in requester_content
    assert "service_agent_guidance" not in requester_content
    assert "internal_notes" not in requester_content
    assert "links" not in requester_content

    requester_list = client.get(
        "/v1/itsm/outage-alerts/active",
        headers=headers(outage_context, "requester"),
    )
    assert requester_list.status_code == 200, requester_list.text
    summary = next(row for row in requester_list.json() if row["id"] == alert_id)
    assert summary["severity"] is None
    assert summary["intent"] is None

    notifications = client.get(
        "/v1/notifications",
        headers=headers(outage_context, "requester"),
    )
    assert notifications.status_code == 200, notifications.text
    alert_notification = next(
        row for row in notifications.json()["items"]
        if row.get("link") == f"/itsm/outage-alerts/{alert_id}"
    )
    assert alert_notification["body"] == "Email is temporarily unavailable."
    assert "Restricted" not in alert_notification["body"]
    assert "runbook" not in alert_notification["body"]

    agent_detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "agent"),
    )
    assert agent_detail.status_code == 200, agent_detail.text
    assert agent_detail.json()["content"]["service_agent_guidance"] == "Use the approved mail continuity runbook."
    assert "internal_notes" not in agent_detail.json()["content"]

    other_tenant = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "tenant_b_requester"),
    )
    assert other_tenant.status_code == 404

    with outage_context["engine"].connect() as conn:
        count = conn.execute(text(
            "SELECT count(*) FROM public.itsm_outage_alert_publications WHERE id=:publication"
        ), {"publication": first.json()["publication_id"]}).scalar_one()
        audit_count = conn.execute(text(
            "SELECT count(*) FROM public.audit_log_metadata "
            "WHERE tenant_id=:tenant AND action='itsm.outage_alert.publication.initial'"
        ), {"tenant": outage_context["ids"]["tenant_a"]}).scalar_one()
    assert count == 1
    assert audit_count >= 1


def test_recipient_access_is_revoked_after_current_eligibility_changes(outage_context):
    alert_id = outage_context["alert_id"]
    engine = outage_context["engine"]
    client = outage_context["client"]
    ids = outage_context["ids"]

    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE public.itsm_service_consumers SET is_active=false "
            "WHERE tenant_id=:tenant AND service_id=:service AND user_id=:user"
        ), {"tenant": ids["tenant_a"], "service": ids["service_a"], "user": ids["requester"]})
        conn.execute(text(
            "DELETE FROM public.itsm_team_members WHERE tenant_id=:tenant AND team_id=:team AND user_id=:user"
        ), {"tenant": ids["tenant_a"], "team": ids["team_a"], "user": ids["agent"]})

    assert client.get(f"/v1/itsm/outage-alerts/{alert_id}", headers=headers(outage_context, "requester")).status_code == 404
    assert client.get(f"/v1/itsm/outage-alerts/{alert_id}", headers=headers(outage_context, "agent")).status_code == 404

    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE public.itsm_service_consumers SET is_active=true "
            "WHERE tenant_id=:tenant AND service_id=:service AND user_id=:user"
        ), {"tenant": ids["tenant_a"], "service": ids["service_a"], "user": ids["requester"]})
        conn.execute(text(
            "INSERT INTO public.itsm_team_members (id,tenant_id,team_id,user_id,created_at) "
            "VALUES (gen_random_uuid(),:tenant,:team,:user,now())"
        ), {"tenant": ids["tenant_a"], "team": ids["team_a"], "user": ids["agent"]})
        conn.execute(text(
            "UPDATE public.itsm_user_access SET itsm_role='REQUESTER' "
            "WHERE tenant_id=:tenant AND user_id=:user"
        ), {"tenant": ids["tenant_a"], "user": ids["agent"]})
    assert client.get(f"/v1/itsm/outage-alerts/{alert_id}", headers=headers(outage_context, "agent")).status_code == 404
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE public.itsm_user_access SET itsm_role='SERVICE_AGENT' "
            "WHERE tenant_id=:tenant AND user_id=:user"
        ), {"tenant": ids["tenant_a"], "user": ids["agent"]})


def test_role_change_cannot_expand_an_immutable_recipient_snapshot(outage_context):
    client = outage_context["client"]
    engine = outage_context["engine"]
    ids = outage_context["ids"]
    alert_id, preview_token = create_and_preview(outage_context)
    publication = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview_token,
            "idempotency_key": f"snapshot-isolation-{uuid4()}",
        },
    )
    assert publication.status_code == 200, publication.text

    # The user received the Requester-safe snapshot. A later role/team change
    # can preserve current eligibility, but must not retroactively expose the
    # Service Agent projection stored in the canonical publication.
    try:
        with engine.begin() as conn:
            conn.execute(text(
                "UPDATE public.itsm_user_access SET itsm_role='SERVICE_AGENT' "
                "WHERE tenant_id=:tenant AND user_id=:user"
            ), {"tenant": ids["tenant_a"], "user": ids["requester"]})
            conn.execute(text(
                "INSERT INTO public.itsm_team_members (id,tenant_id,team_id,user_id,created_at) "
                "VALUES (gen_random_uuid(),:tenant,:team,:user,now())"
            ), {
                "tenant": ids["tenant_a"], "team": ids["team_a"],
                "user": ids["requester"],
            })

        detail = client.get(
            f"/v1/itsm/outage-alerts/{alert_id}",
            headers=headers(outage_context, "requester"),
        )
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert "service_agent_guidance" not in body["content"]
        assert "internal_notes" not in body["content"]
        assert "OPEN_LINKED_INCIDENT" not in body["allowed_actions"]
        assert all(
            "service_agent_guidance" not in item["content"]
            and "internal_notes" not in item["content"]
            for item in body["publications"]
        )

        visible = client.get(
            "/v1/itsm/outage-alerts/active",
            headers=headers(outage_context, "requester"),
        )
        assert visible.status_code == 200, visible.text
        summary = next(item for item in visible.json() if item["id"] == alert_id)
        assert summary["severity"] is None
        assert summary["intent"] is None
    finally:
        with engine.begin() as conn:
            conn.execute(text(
                "DELETE FROM public.itsm_team_members "
                "WHERE tenant_id=:tenant AND team_id=:team AND user_id=:user"
            ), {
                "tenant": ids["tenant_a"], "team": ids["team_a"],
                "user": ids["requester"],
            })
            conn.execute(text(
                "UPDATE public.itsm_user_access SET itsm_role='REQUESTER' "
                "WHERE tenant_id=:tenant AND user_id=:user"
            ), {"tenant": ids["tenant_a"], "user": ids["requester"]})


def test_related_record_ids_are_filtered_per_recipient_authorization(outage_context):
    client = outage_context["client"]
    payload = draft_payload(outage_context)
    payload["links"] = [{
        "target_type": "INCIDENT",
        "target_id": str(outage_context["ids"]["incident_same_service"]),
    }]
    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert created.status_code == 201, created.text
    alert_id = created.json()["id"]
    preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json={},
    )
    assert preview.status_code == 200, preview.text
    published = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": f"link-projection-{uuid4()}",
        },
    )
    assert published.status_code == 200, published.text

    agent_detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "agent"),
    )
    assert agent_detail.status_code == 200, agent_detail.text
    assert agent_detail.json()["links"] == []
    assert "OPEN_LINKED_INCIDENT" not in agent_detail.json()["allowed_actions"]
    assert all(item["content"].get("authorized_links") == [] for item in agent_detail.json()["publications"])


def test_solve_exposes_only_an_independently_authorized_linked_incident(outage_context):
    client = outage_context["client"]
    payload = draft_payload(outage_context)
    payload["intent"] = "RESOLVE"
    payload["service_agent_handling"] = "SOLVE"
    payload["links"] = [{
        "target_type": "INCIDENT",
        "target_id": str(outage_context["ids"]["incident_agent_authorized"]),
    }]
    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert created.status_code == 201, created.text
    alert_id = created.json()["id"]
    preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json={},
    )
    assert preview.status_code == 200, preview.text
    published = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": f"solve-link-{uuid4()}",
        },
    )
    assert published.status_code == 200, published.text

    agent_detail = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "agent"),
    )
    assert agent_detail.status_code == 200, agent_detail.text
    assert agent_detail.json()["links"] == [{
        "type": "INCIDENT",
        "id": str(outage_context["ids"]["incident_agent_authorized"]),
    }]
    assert "OPEN_LINKED_INCIDENT" in agent_detail.json()["allowed_actions"]

    blocked_unlink = client.delete(
        f"/v1/itsm/outage-alerts/{alert_id}/links/INCIDENT/"
        f"{outage_context['ids']['incident_agent_authorized']}",
        headers=headers(outage_context, "manager"),
    )
    assert blocked_unlink.status_code == 409
    assert "must keep at least one linked Incident" in blocked_unlink.text


def test_database_rejects_cross_tenant_alert_children(outage_context):
    """RLS is necessary but parent ownership must also be a DB invariant."""
    with pytest.raises(DBAPIError, match="foreign key|violates"):
        with outage_context["engine"].begin() as conn:
            conn.execute(text(
                "INSERT INTO public.itsm_outage_alert_services "
                "(id,tenant_id,alert_id,service_id) "
                "VALUES (gen_random_uuid(),:tenant,:alert,:service)"
            ), {
                "tenant": outage_context["ids"]["tenant_b"],
                "alert": outage_context["alert_id"],
                "service": outage_context["ids"]["service_b"],
            })
    with pytest.raises(DBAPIError, match="same tenant|violates"):
        with outage_context["engine"].begin() as conn:
            conn.execute(text(
                "INSERT INTO public.itsm_outage_alert_audiences "
                "(id,tenant_id,alert_id,audience_type,user_id,created_at) "
                "VALUES (gen_random_uuid(),:tenant,:alert,'SPECIFIC_USER',:user,now())"
            ), {
                "tenant": outage_context["ids"]["tenant_a"],
                "alert": outage_context["alert_id"],
                "user": outage_context["ids"]["tenant_b_requester"],
            })


def test_acknowledgement_marks_the_delivery_and_bell_notification_read(outage_context):
    client = outage_context["client"]
    alert_id, preview_token = create_and_preview(outage_context)
    published = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview_token,
            "idempotency_key": f"acknowledgement-{uuid4()}",
        },
    )
    assert published.status_code == 200, published.text
    acknowledged = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/acknowledge",
        headers=headers(outage_context, "requester"),
    )
    assert acknowledged.status_code == 204, acknowledged.text
    with outage_context["engine"].connect() as conn:
        row = conn.execute(text(
            "SELECT recipient.acknowledged_at,recipient.read_at,notification.read_at AS notification_read_at "
            "FROM public.itsm_outage_alert_recipients AS recipient "
            "JOIN public.notifications AS notification ON notification.id=recipient.notification_id "
            "WHERE recipient.publication_id=:publication AND recipient.user_id=:user"
        ), {
            "publication": published.json()["publication_id"],
            "user": outage_context["ids"]["requester"],
        }).one()
    assert row.acknowledged_at is not None
    assert row.read_at is not None
    assert row.notification_read_at is not None


def test_concurrent_retries_create_one_publication(outage_context):
    alert_id, preview_token = create_and_preview(outage_context)
    payload = {
        "preview_token": preview_token,
        "idempotency_key": f"concurrent-publication-{uuid4()}",
    }

    def publish_once():
        with TestClient(app) as client:
            response = client.post(
                f"/v1/itsm/outage-alerts/{alert_id}/publish",
                headers=headers(outage_context, "manager"),
                json=payload,
            )
            return response.status_code, response.text, response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: publish_once(), range(2)))

    assert [result[0] for result in results] == [200, 200], results
    publication_ids = {result[2]["publication_id"] for result in results}
    assert len(publication_ids) == 1
    with outage_context["engine"].connect() as conn:
        count = conn.execute(text(
            "SELECT count(*) FROM public.itsm_outage_alert_publications "
            "WHERE tenant_id=:tenant AND idempotency_key=:key"
        ), {
            "tenant": outage_context["ids"]["tenant_a"],
            "key": payload["idempotency_key"],
        }).scalar_one()
    assert count == 1


def test_audit_failure_rolls_back_publication(outage_context):
    alert_id, preview_token = create_and_preview(outage_context)
    payload = {"preview_token": preview_token, "idempotency_key": f"audit-failure-{uuid4()}"}
    with TestClient(app, raise_server_exceptions=False) as failure_client:
        with patch(
            "app.services.itsm_outage_alert_service.append_audit_event",
            side_effect=RuntimeError("audit unavailable"),
        ):
            response = failure_client.post(
                f"/v1/itsm/outage-alerts/{alert_id}/publish",
                headers=headers(outage_context, "manager"),
                json=payload,
            )
    assert response.status_code == 500
    with outage_context["engine"].connect() as conn:
        state = conn.execute(text(
            "SELECT status,current_publication_id FROM public.itsm_outage_alerts WHERE id=:alert"
        ), {"alert": alert_id}).one()
        count = conn.execute(text(
            "SELECT count(*) FROM public.itsm_outage_alert_publications WHERE alert_id=:alert"
        ), {"alert": alert_id}).scalar_one()
    assert state.status == "DRAFT"
    assert state.current_publication_id is None
    assert count == 0


def test_publications_and_recipient_snapshots_are_database_immutable(outage_context):
    engine = outage_context["engine"]
    publication_id = outage_context["publication_id"]
    with pytest.raises(DBAPIError, match="immutable"):
        with engine.begin() as conn:
            conn.execute(text(
                "UPDATE public.itsm_outage_alert_publications SET content_snapshot='{}'::jsonb WHERE id=:id"
            ), {"id": publication_id})
    with pytest.raises(DBAPIError, match="cannot be deleted|immutable"):
        with engine.begin() as conn:
            conn.execute(text(
                "DELETE FROM public.itsm_outage_alert_recipients WHERE publication_id=:id"
            ), {"id": publication_id})


def test_current_publication_pointer_cannot_reference_another_alert(outage_context):
    other_alert_id, preview_token = create_and_preview(outage_context)
    other_publication = outage_context["client"].post(
        f"/v1/itsm/outage-alerts/{other_alert_id}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview_token,
            "idempotency_key": f"pointer-integrity-{uuid4()}",
        },
    )
    assert other_publication.status_code == 200, other_publication.text

    with pytest.raises(DBAPIError, match="same alert and tenant"):
        with outage_context["engine"].begin() as conn:
            conn.execute(text(
                "UPDATE public.itsm_outage_alerts SET current_publication_id=:publication "
                "WHERE id=:alert"
            ), {
                "publication": other_publication.json()["publication_id"],
                "alert": outage_context["alert_id"],
            })


def test_recovery_is_atomic_and_idempotent(outage_context):
    client = outage_context["client"]
    alert_id = outage_context["alert_id"]
    preview = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/preview",
        headers=headers(outage_context, "manager"),
        json={"publication_type": "RECOVERY", "public_summary": "Email service has recovered."},
    )
    assert preview.status_code == 200, preview.text
    payload = {
        "preview_token": preview.json()["preview_token"],
        "idempotency_key": f"recovery-{uuid4()}",
        "public_summary": "Email service has recovered.",
    }
    first = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/recovery",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert first.status_code == 200, first.text
    repeated = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/recovery",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["publication_id"] == first.json()["publication_id"]
    with outage_context["engine"].connect() as conn:
        state = conn.execute(text(
            "SELECT status,recovered_at,current_publication_id FROM public.itsm_outage_alerts WHERE id=:id"
        ), {"id": alert_id}).one()
        recovery_count = conn.execute(text(
            "SELECT count(*) FROM public.itsm_outage_alert_publications "
            "WHERE alert_id=:id AND publication_type='RECOVERY'"
        ), {"id": alert_id}).scalar_one()
    assert state.status == "RECOVERED"
    assert state.recovered_at is not None
    assert str(state.current_publication_id) == first.json()["publication_id"]
    assert recovery_count == 1


def test_platform_admin_can_view_delivery_health_and_technical_diagnostics(outage_context):
    client = outage_context["client"]
    alert_id = publish_initial_alert(outage_context)

    # 1. Platform Admin accesses delivery-health endpoint
    res = client.get(
        "/v1/itsm/outage-alerts/delivery-health",
        headers=headers(outage_context, "platform_admin"),
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert "metrics" in data
    assert "channels" in data
    assert "items" in data
    assert data["metrics"]["total_broadcasts"] >= 1
    item = next(it for it in data["items"] if it["id"] == alert_id)
    assert item["delivery_health_status"] in {"HEALTHY", "RETRYING", "FAILED", "IDLE"}
    assert item["recipient_count"] >= 1
    assert "channels" in item
    assert "title" not in item or item["title"] is None  # Operational title not leaked

    # 2. Platform Admin accesses individual alert detail
    detail_res = client.get(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "platform_admin"),
    )
    assert detail_res.status_code == 200, detail_res.text
    detail = detail_res.json()
    assert detail["projection_type"] == "DELIVERY_OPERATOR"
    assert detail["allowed_actions"] == ["VIEW_DELIVERY_HEALTH"]
    assert detail["links"] == []
    assert detail["delivery_health"] is not None
    assert "channels" in detail["delivery_health"]
    assert "summary" in detail["delivery_health"]
    assert "internal_notes" not in detail["content"]
    assert "service_agent_guidance" not in detail["content"]
    assert "public_summary" not in detail["content"]

    # 3. Unauthorized roles cannot access delivery-health
    for unauthorized in ("requester", "service_agent", "auditor"):
        denied = client.get(
            "/v1/itsm/outage-alerts/delivery-health",
            headers=headers(outage_context, unauthorized),
        )
        assert denied.status_code == 403, (unauthorized, denied.text)


def test_scoped_incident_manager_delivery_health_respects_read_grants(outage_context):
    client = outage_context["client"]
    payload = draft_payload(outage_context, service="service_a_other")
    payload["audiences"] = [{
        "audience_type": "SELECTED_TEAM",
        "team_id": str(outage_context["ids"]["team_a"]),
    }]
    created = client.post(
        "/v1/itsm/outage-alerts",
        headers=headers(outage_context, "manager"),
        json=payload,
    )
    assert created.status_code == 201, created.text
    preview = client.post(
        f"/v1/itsm/outage-alerts/{created.json()['id']}/preview",
        headers=headers(outage_context, "manager"),
        json={},
    )
    assert preview.status_code == 200, preview.text
    published = client.post(
        f"/v1/itsm/outage-alerts/{created.json()['id']}/publish",
        headers=headers(outage_context, "manager"),
        json={
            "preview_token": preview.json()["preview_token"],
            "idempotency_key": f"delivery-scope-{uuid4()}",
        },
    )
    assert published.status_code == 200, published.text

    response = client.get(
        "/v1/itsm/outage-alerts/delivery-health",
        headers=headers(outage_context, "scoped_manager"),
    )
    assert response.status_code == 200, response.text
    assert all(
        service["id"] != str(outage_context["ids"]["service_a_other"])
        for item in response.json()["items"]
        for service in item["affected_services"]
    )


def test_platform_admin_cannot_mutate_or_publish_alerts(outage_context):
    client = outage_context["client"]
    alert_id = publish_initial_alert(outage_context)

    # Cannot update alert
    update_res = client.put(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "platform_admin"),
        json=draft_payload(outage_context),
    )
    assert update_res.status_code == 403

    # Cannot publish recovery
    recov_res = client.post(
        f"/v1/itsm/outage-alerts/{alert_id}/recovery",
        headers=headers(outage_context, "platform_admin"),
        json={"preview_token": "a" * 32, "idempotency_key": f"rec-{uuid4()}"},
    )
    assert recov_res.status_code == 403

    # Cannot cancel alert
    cancel_res = client.delete(
        f"/v1/itsm/outage-alerts/{alert_id}",
        headers=headers(outage_context, "platform_admin"),
    )
    assert cancel_res.status_code == 403

