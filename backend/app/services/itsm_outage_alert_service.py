"""Authoritative lifecycle, targeting, projection, and delivery logic for alerts."""
from __future__ import annotations

import hashlib
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import String, cast, func, or_, text
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    AuditLogMetadata,
    ITSMChangeRequest,
    ITSMConfigurationItem,
    ITSMMajorIncident,
    ITSMOutageAlert,
    ITSMOutageAlertAudience,
    ITSMOutageAlertCI,
    ITSMOutageAlertGrant,
    ITSMOutageAlertLink,
    ITSMOutageAlertPublication,
    ITSMOutageAlertRecipient,
    ITSMOutageAlertService,
    ITSMProblemDetail,
    ITSMService,
    ITSMServiceConsumer,
    ITSMServiceSupportTeam,
    ITSMTeam,
    ITSMTeamMember,
    ITSMTicket,
    ITSMUserAccess,
    User,
)
from app.schemas.itsm_outage_alerts import AlertDraftRequest, AlertPublicationRequest
from app.services.audit_store import append_audit_event
from app.services.itsm_outage_alert_policy import (
    ACTION_PERMISSIONS,
    allowed_actions_for,
    can_manage,
    can_view_delivery_health,
    normalize_role,
    project_alert,
    projection_fields,
    projection_type_for_role,
)
from app.services.notifications import add_notification
from app.services.itsm_incident_service import IncidentService

logger = logging.getLogger("services.itsm_outage_alerts")

RECIPIENT_ROLES = {"REQUESTER", "SERVICE_AGENT", "PROCESS_CHANGE_MANAGER", "PROBLEM_CHANGE_MANAGER", "CATALOG_MANAGER"}
TENANT_WIDE_RECIPIENT_ROLES = RECIPIENT_ROLES | {"INCIDENT_MANAGER", "SERVICE_LEAD"}
TENANT_WIDE_AUDIENCE = "ALL_PORTAL_USERS"


class OutageAlertService:
    @staticmethod
    def role_for(db: Session, tenant_id: UUID, user_id: UUID) -> str:
        access = db.query(ITSMUserAccess).filter(
            ITSMUserAccess.tenant_id == tenant_id,
            ITSMUserAccess.user_id == user_id,
            ITSMUserAccess.has_itsm_access.is_(True),
        ).first()
        if not access:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ITSM access required")
        return str(access.itsm_role).upper()

    @classmethod
    def require_manager(cls, db: Session, tenant_id: UUID, user_id: UUID) -> str:
        role = cls.role_for(db, tenant_id, user_id)
        if not can_manage(role):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Outage Alert permission required")
        return role

    @classmethod
    def permission_scope(
        cls,
        db: Session,
        tenant_id: UUID,
        user_id: UUID,
        permission: str,
    ) -> set[UUID] | None:
        """Return allowed service ids, or None for an explicit tenant-wide grant."""
        cls.require_manager(db, tenant_id, user_id)
        grants = db.query(ITSMOutageAlertGrant.service_id).filter(
            ITSMOutageAlertGrant.tenant_id == tenant_id,
            ITSMOutageAlertGrant.user_id == user_id,
            ITSMOutageAlertGrant.permission == permission,
        ).all()
        if not grants:
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")
        if any(row.service_id is None for row in grants):
            return None
        return {row.service_id for row in grants}

    @classmethod
    def require_permission(
        cls,
        db: Session,
        tenant_id: UUID,
        user_id: UUID,
        permission: str,
        service_ids: set[UUID] | None = None,
    ) -> set[UUID] | None:
        scope = cls.permission_scope(db, tenant_id, user_id, permission)
        requested = set(service_ids or ())
        if scope is not None and (not requested or not requested.issubset(scope)):
            raise HTTPException(status_code=403, detail="Alert operation is outside the authorized service scope")
        return scope

    @staticmethod
    def _service_ids(alert: ITSMOutageAlert) -> set[UUID]:
        return {item.service_id for item in alert.services}

    @classmethod
    def require_alert_permission(
        cls,
        db: Session,
        tenant_id: UUID,
        user_id: UUID,
        permission: str,
        alert: ITSMOutageAlert,
    ) -> None:
        scope = cls.require_permission(db, tenant_id, user_id, permission, cls._service_ids(alert))
        if scope is not None and any(
            audience.audience_type == TENANT_WIDE_AUDIENCE
            for audience in alert.audiences
        ):
            raise HTTPException(
                status_code=403,
                detail="A tenant-wide Alert audience requires a tenant-wide permission grant",
            )

    @staticmethod
    def _query(db: Session, tenant_id: UUID):
        return db.query(ITSMOutageAlert).options(
            selectinload(ITSMOutageAlert.services).selectinload(ITSMOutageAlertService.service),
            selectinload(ITSMOutageAlert.configuration_items).selectinload(ITSMOutageAlertCI.configuration_item),
            selectinload(ITSMOutageAlert.audiences).selectinload(ITSMOutageAlertAudience.team),
            selectinload(ITSMOutageAlert.audiences).selectinload(ITSMOutageAlertAudience.user),
            selectinload(ITSMOutageAlert.links),
            selectinload(ITSMOutageAlert.publications).selectinload(ITSMOutageAlertPublication.recipients),
        ).filter(ITSMOutageAlert.tenant_id == tenant_id)

    @classmethod
    def get_alert(cls, db: Session, tenant_id: UUID, alert_id: UUID) -> ITSMOutageAlert:
        alert = cls._query(db, tenant_id).filter(ITSMOutageAlert.id == alert_id).first()
        if not alert:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
        return alert

    @staticmethod
    def _next_number(db: Session, tenant_id: UUID) -> str:
        count = db.query(func.count(ITSMOutageAlert.id)).filter(ITSMOutageAlert.tenant_id == tenant_id).scalar() or 0
        return f"ALT-{count + 1:06d}"

    @classmethod
    def _validate_payload(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        payload: AlertDraftRequest,
        permission: str,
    ) -> None:
        service_ids = set(payload.service_ids)
        permission_scope = cls.require_permission(
            db, tenant_id, actor_id, permission, service_ids
        )
        if permission_scope is not None and any(
            audience.audience_type == TENANT_WIDE_AUDIENCE
            for audience in payload.audiences
        ):
            raise HTTPException(
                status_code=403,
                detail="A tenant-wide Alert audience requires a tenant-wide permission grant",
            )
        if service_ids:
            found = {row.id for row in db.query(ITSMService.id).filter(ITSMService.tenant_id == tenant_id, ITSMService.id.in_(service_ids)).all()}
            if found != service_ids:
                raise HTTPException(status_code=422, detail="One or more affected services are unavailable")
        ci_ids = set(payload.ci_ids)
        if ci_ids:
            cis = db.query(ITSMConfigurationItem).filter(ITSMConfigurationItem.tenant_id == tenant_id, ITSMConfigurationItem.id.in_(ci_ids)).all()
            if {row.id for row in cis} != ci_ids:
                raise HTTPException(status_code=422, detail="One or more configuration items are unavailable")
            if service_ids and any(row.service_id and row.service_id not in service_ids for row in cis):
                raise HTTPException(status_code=422, detail="A selected configuration item is outside the affected services")
        team_ids = {aud.team_id for aud in payload.audiences if aud.team_id}
        if team_ids:
            found = {row.id for row in db.query(ITSMTeam.id).filter(ITSMTeam.tenant_id == tenant_id, ITSMTeam.id.in_(team_ids), ITSMTeam.is_active.is_(True)).all()}
            if found != team_ids:
                raise HTTPException(status_code=422, detail="One or more selected teams are unavailable")
        for link in payload.links:
            cls.require_permission(db, tenant_id, actor_id, "OUTAGE_ALERT:LINK", service_ids)
            cls._validate_link(db, tenant_id, link.target_type, link.target_id, service_ids)
        for audience in payload.audiences:
            if audience.audience_type == "SPECIFIC_USER" and not cls._specific_user_is_eligible(
                db,
                tenant_id,
                audience.user_id,
                service_ids,
                [(link.target_type, link.target_id) for link in payload.links],
            ):
                raise HTTPException(
                    status_code=422,
                    detail="Selected user is not currently eligible for the affected services or linked records",
                )

    @staticmethod
    def _validate_publishable(alert: ITSMOutageAlert) -> None:
        """Require complete delivery scope only when a draft is previewed/published."""
        service_scoped = any(
            audience.audience_type in {
                "SERVICE_USERS",
                "SERVICE_AGENTS",
                "SERVICE_OWNERS",
                "SPECIFIC_USER",
            }
            for audience in alert.audiences
        )
        if service_scoped and not alert.services:
            raise HTTPException(status_code=422, detail="Service-scoped audiences require at least one affected service")
        if alert.service_agent_handling == "SOLVE" and not any(
            link.target_type == "INCIDENT" for link in alert.links
        ):
            raise HTTPException(
                status_code=422,
                detail="Solve requires an existing linked Incident; alerts never create work automatically",
            )

    @staticmethod
    def _validate_link(
        db: Session,
        tenant_id: UUID,
        target_type: str,
        target_id: UUID,
        alert_service_ids: set[UUID],
    ) -> None:
        target_service_id: UUID | None = None
        if target_type in {"INCIDENT", "PROBLEM"}:
            expected = target_type
            exists = db.query(ITSMTicket.id, ITSMTicket.service_id).filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.id == target_id,
                ITSMTicket.ticket_type == expected,
            ).first()
            target_service_id = exists.service_id if exists else None
        elif target_type == "MAJOR_INCIDENT":
            exists = db.query(ITSMMajorIncident.id, ITSMTicket.service_id).join(
                ITSMTicket, ITSMTicket.id == ITSMMajorIncident.ticket_id
            ).filter(
                ITSMMajorIncident.tenant_id == tenant_id,
                ITSMMajorIncident.id == target_id,
                ITSMTicket.tenant_id == tenant_id,
            ).first()
            target_service_id = exists.service_id if exists else None
        elif target_type == "CHANGE":
            exists = db.query(ITSMChangeRequest.id, ITSMChangeRequest.service_id).filter(
                ITSMChangeRequest.tenant_id == tenant_id,
                ITSMChangeRequest.id == target_id,
            ).first()
            target_service_id = exists.service_id if exists else None
        else:
            exists = None
        if not exists:
            raise HTTPException(status_code=422, detail=f"Linked {target_type.lower()} is unavailable")
        if target_service_id is None:
            raise HTTPException(status_code=422, detail=f"Linked {target_type.lower()} must have an authorized service")
        if target_service_id not in alert_service_ids:
            raise HTTPException(status_code=422, detail=f"Linked {target_type.lower()} is outside the affected services")

    @classmethod
    def _specific_user_is_eligible(
        cls,
        db: Session,
        tenant_id: UUID,
        user_id: UUID | None,
        service_ids: set[UUID],
        links: list[tuple[str, UUID]],
    ) -> bool:
        """A named recipient must already have an authorized business relationship.

        Selecting a person is a narrowing mechanism, never a way to bypass
        service, team, owner, or assigned-record eligibility.
        """
        if user_id is None:
            return False
        row = db.query(User, ITSMUserAccess).join(
            ITSMUserAccess,
            (ITSMUserAccess.user_id == User.id)
            & (ITSMUserAccess.tenant_id == User.tenant_id),
        ).filter(
            User.tenant_id == tenant_id,
            User.id == user_id,
            User.is_active.is_(True),
            ITSMUserAccess.has_itsm_access.is_(True),
        ).first()
        if not row:
            return False
        _user, access = row
        raw_role = str(access.itsm_role or "").upper()
        role = normalize_role(raw_role)
        now = datetime.now(timezone.utc)
        if role == "REQUESTER":
            if service_ids and db.query(ITSMService.id).filter(
                ITSMService.tenant_id == tenant_id,
                ITSMService.id.in_(service_ids),
                ITSMService.alert_recipient_scope == "ALL_REQUESTERS",
            ).first():
                return True
            return bool(service_ids and db.query(ITSMServiceConsumer.id).filter(
                ITSMServiceConsumer.tenant_id == tenant_id,
                ITSMServiceConsumer.user_id == user_id,
                ITSMServiceConsumer.service_id.in_(service_ids),
                ITSMServiceConsumer.is_active.is_(True),
                ITSMServiceConsumer.effective_from <= now,
                or_(
                    ITSMServiceConsumer.effective_until.is_(None),
                    ITSMServiceConsumer.effective_until > now,
                ),
            ).first())
        if role == "SERVICE_AGENT":
            return bool(service_ids and db.query(ITSMTeamMember.id).join(
                ITSMTeam,
                (ITSMTeam.id == ITSMTeamMember.team_id)
                & (ITSMTeam.tenant_id == ITSMTeamMember.tenant_id),
            ).join(
                ITSMServiceSupportTeam,
                (ITSMServiceSupportTeam.team_id == ITSMTeamMember.team_id)
                & (ITSMServiceSupportTeam.tenant_id == ITSMTeamMember.tenant_id),
            ).filter(
                ITSMTeamMember.tenant_id == tenant_id,
                ITSMTeamMember.user_id == user_id,
                ITSMTeam.is_active.is_(True),
                ITSMServiceSupportTeam.service_id.in_(service_ids),
            ).first())
        if role == "SERVICE_OWNER":
            return bool(service_ids and db.query(ITSMService.id).filter(
                ITSMService.tenant_id == tenant_id,
                ITSMService.id.in_(service_ids),
                ITSMService.owner_user_id == user_id,
            ).first())
        if role == "PROBLEM_AND_CHANGE_MANAGER":
            for target_type, target_id in links:
                if target_type == "PROBLEM" and db.query(ITSMProblemDetail.id).filter(
                    ITSMProblemDetail.tenant_id == tenant_id,
                    ITSMProblemDetail.ticket_id == target_id,
                    ITSMProblemDetail.assigned_investigator_id == user_id,
                ).first():
                    return True
                if target_type == "CHANGE" and db.query(ITSMChangeRequest.id).filter(
                    ITSMChangeRequest.tenant_id == tenant_id,
                    ITSMChangeRequest.id == target_id,
                    ITSMChangeRequest.assigned_to_id == user_id,
                ).first():
                    return True
        return False

    @classmethod
    def _replace_scope(cls, db: Session, alert: ITSMOutageAlert, payload: AlertDraftRequest, actor_id: UUID) -> None:
        for collection in (alert.services, alert.configuration_items, alert.audiences, alert.links):
            collection.clear()
        # Flush orphan deletes before re-inserting an unchanged service/team
        # key. Otherwise PostgreSQL can see the replacement INSERT before the
        # old row's DELETE and reject a valid draft edit as a duplicate.
        db.flush()
        for service_id in dict.fromkeys(payload.service_ids):
            alert.services.append(ITSMOutageAlertService(tenant_id=alert.tenant_id, service_id=service_id))
        for ci_id in dict.fromkeys(payload.ci_ids):
            alert.configuration_items.append(ITSMOutageAlertCI(tenant_id=alert.tenant_id, ci_id=ci_id))
        seen_audiences: set[tuple[str, UUID | None, UUID | None]] = set()
        for item in payload.audiences:
            key = (item.audience_type, item.team_id, item.user_id)
            if key not in seen_audiences:
                alert.audiences.append(ITSMOutageAlertAudience(
                    tenant_id=alert.tenant_id,
                    audience_type=item.audience_type,
                    team_id=item.team_id,
                    user_id=item.user_id,
                ))
                seen_audiences.add(key)
        for item in payload.links:
            alert.links.append(ITSMOutageAlertLink(tenant_id=alert.tenant_id, target_type=item.target_type, target_id=item.target_id, created_by_id=actor_id))

    @classmethod
    def create_draft(cls, db: Session, tenant_id: UUID, actor_id: UUID, payload: AlertDraftRequest) -> ITSMOutageAlert:
        cls._validate_payload(db, tenant_id, actor_id, payload, "OUTAGE_ALERT:CREATE")
        cls.require_permission(db, tenant_id, actor_id, "OUTAGE_ALERT:READ", set(payload.service_ids))
        alert = ITSMOutageAlert(
            tenant_id=tenant_id, alert_number=cls._next_number(db, tenant_id), status="DRAFT",
            created_by_id=actor_id, updated_by_id=actor_id,
            **payload.model_dump(exclude={"service_ids", "ci_ids", "audiences", "links"}),
        )
        db.add(alert)
        db.flush()
        cls._replace_scope(db, alert, payload, actor_id)
        cls._audit(db, alert, actor_id, "draft.created")
        db.commit()
        return cls.get_alert(db, tenant_id, alert.id)

    @classmethod
    def update_draft(cls, db: Session, tenant_id: UUID, actor_id: UUID, alert_id: UUID, payload: AlertDraftRequest) -> ITSMOutageAlert:
        alert = cls.get_alert(db, tenant_id, alert_id)
        cls.require_alert_permission(db, tenant_id, actor_id, "OUTAGE_ALERT:EDIT", alert)
        if alert.status != "DRAFT":
            raise HTTPException(status_code=409, detail="Only drafts can be edited")
        cls._validate_payload(db, tenant_id, actor_id, payload, "OUTAGE_ALERT:EDIT")
        cls.require_permission(db, tenant_id, actor_id, "OUTAGE_ALERT:READ", set(payload.service_ids))
        old_links = {(row.target_type, row.target_id) for row in alert.links}
        new_links = {(row.target_type, row.target_id) for row in payload.links}
        if old_links != new_links:
            cls.require_permission(db, tenant_id, actor_id, "OUTAGE_ALERT:LINK", set(payload.service_ids))
        for key, value in payload.model_dump(exclude={"service_ids", "ci_ids", "audiences", "links"}).items():
            setattr(alert, key, value)
        alert.updated_by_id = actor_id
        alert.updated_at = datetime.now(timezone.utc)
        cls._replace_scope(db, alert, payload, actor_id)
        cls._audit(db, alert, actor_id, "draft.updated")
        db.commit()
        return cls.get_alert(db, tenant_id, alert.id)

    @classmethod
    def link_record(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        alert_id: UUID,
        target_type: str,
        target_id: UUID,
    ) -> ITSMOutageAlert:
        """Add an audited operational relationship without rewriting publications."""
        alert = cls._query(db, tenant_id).filter(
            ITSMOutageAlert.id == alert_id,
        ).with_for_update().first()
        if not alert:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
        cls.require_alert_permission(db, tenant_id, actor_id, "OUTAGE_ALERT:LINK", alert)
        if alert.status not in {"DRAFT", "ACTIVE"}:
            raise HTTPException(
                status_code=409,
                detail="Related records can only be changed while an alert is Draft or Active",
            )
        normalized_type = str(target_type).upper()
        cls._validate_link(
            db,
            tenant_id,
            normalized_type,
            target_id,
            cls._service_ids(alert),
        )
        existing = next((
            link for link in alert.links
            if link.target_type == normalized_type and link.target_id == target_id
        ), None)
        if existing is None:
            alert.links.append(ITSMOutageAlertLink(
                tenant_id=tenant_id,
                target_type=normalized_type,
                target_id=target_id,
                created_by_id=actor_id,
            ))
            alert.updated_by_id = actor_id
            alert.updated_at = datetime.now(timezone.utc)
            cls._audit(
                db,
                alert,
                actor_id,
                "link.added",
                [f"target_type={normalized_type}", f"target_id={target_id}"],
            )
            db.commit()
        return cls.get_alert(db, tenant_id, alert.id)

    @classmethod
    def unlink_record(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        alert_id: UUID,
        target_type: str,
        target_id: UUID,
    ) -> None:
        """Remove a current relationship while retaining publication snapshots and audit."""
        alert = cls._query(db, tenant_id).filter(
            ITSMOutageAlert.id == alert_id,
        ).with_for_update().first()
        if not alert:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
        cls.require_alert_permission(db, tenant_id, actor_id, "OUTAGE_ALERT:LINK", alert)
        if alert.status not in {"DRAFT", "ACTIVE"}:
            raise HTTPException(
                status_code=409,
                detail="Related records can only be changed while an alert is Draft or Active",
            )
        normalized_type = str(target_type).upper()
        link = next((
            item for item in alert.links
            if item.target_type == normalized_type and item.target_id == target_id
        ), None)
        if link is None:
            return
        remaining_incidents = sum(
            1 for item in alert.links
            if item.target_type == "INCIDENT" and item.id != link.id
        )
        if (
            alert.status == "ACTIVE"
            and alert.service_agent_handling == "SOLVE"
            and normalized_type == "INCIDENT"
            and remaining_incidents == 0
        ):
            raise HTTPException(
                status_code=409,
                detail="An Active Solve alert must keep at least one linked Incident",
            )
        db.delete(link)
        alert.updated_by_id = actor_id
        alert.updated_at = datetime.now(timezone.utc)
        cls._audit(
            db,
            alert,
            actor_id,
            "link.removed",
            [f"target_type={normalized_type}", f"target_id={target_id}"],
        )
        db.commit()

    @staticmethod
    def _latest_publication_at(alert: ITSMOutageAlert) -> datetime | None:
        return alert.publications[-1].published_at if alert.publications else None

    @classmethod
    def _content(
        cls,
        alert: ITSMOutageAlert,
        *,
        latest_publication_at: datetime | None = None,
    ) -> dict[str, Any]:
        def json_datetime(value: datetime | None) -> str | None:
            return value.isoformat() if value is not None else None

        if latest_publication_at is None:
            latest_publication_at = cls._latest_publication_at(alert)

        return {
            "alert_number": alert.alert_number, "title": alert.title, "alert_type": alert.alert_type,
            "severity": alert.severity, "intent": alert.intent, "status": alert.status,
            "public_status": alert.public_status,
            "public_summary": alert.public_summary, "impact_summary": alert.impact_summary,
            "recommended_action": alert.recommended_action, "service_agent_guidance": alert.service_agent_guidance,
            "internal_notes": alert.internal_notes, "service_agent_handling": alert.service_agent_handling,
            "affected_services": [{"id": str(item.service_id), "name": item.service.name} for item in alert.services],
            "configuration_items": [{"id": str(item.ci_id), "name": item.configuration_item.name} for item in alert.configuration_items],
            "audiences": [{
                "type": item.audience_type,
                "team_id": str(item.team_id) if item.team_id else None,
                "user_id": str(item.user_id) if item.user_id else None,
            } for item in alert.audiences],
            "links": [{"type": item.target_type, "id": str(item.target_id)} for item in alert.links],
            "authorized_links": [{"type": item.target_type, "id": str(item.target_id)} for item in alert.links],
            "outage_started_at": json_datetime(alert.outage_started_at), "next_update_at": json_datetime(alert.next_update_at),
            "published_at": json_datetime(alert.published_at),
            "latest_publication_at": json_datetime(latest_publication_at),
            "recovered_at": json_datetime(alert.recovered_at),
            "created_by_id": str(alert.created_by_id), "updated_by_id": str(alert.updated_by_id),
            "created_at": json_datetime(alert.created_at), "updated_at": json_datetime(alert.updated_at),
        }

    @staticmethod
    def _publication_public_status(
        alert: ITSMOutageAlert,
        publication_type: str,
        requested_status: str | None,
    ) -> str:
        if publication_type == "RECOVERY":
            if requested_status not in {None, "RECOVERED"}:
                raise HTTPException(
                    status_code=422,
                    detail="Publish Recovery requires the Recovered public status",
                )
            return "RECOVERED"
        if requested_status == "RECOVERED":
            raise HTTPException(
                status_code=422,
                detail="Recovered status can only be published through Publish Recovery",
            )
        return requested_status or alert.public_status or "INVESTIGATING"

    @classmethod
    def _project_current_recipient_snapshot(
        cls,
        alert: ITSMOutageAlert,
        snapshot: dict[str, Any],
        role: str,
    ) -> dict[str, Any]:
        content = dict(snapshot)
        # Older immutable snapshots predate these derived public fields. Add
        # current public evidence to the response without rewriting history.
        content.setdefault("public_status", alert.public_status)
        latest = cls._latest_publication_at(alert)
        if latest is not None:
            content.setdefault("latest_publication_at", latest.isoformat())
        return project_alert(content, role)

    @classmethod
    def resolve_recipients(cls, db: Session, alert: ITSMOutageAlert) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        service_ids = [item.service_id for item in alert.services]
        resolved: dict[UUID, dict[str, Any]] = {}
        exclusions: list[dict[str, Any]] = []

        def include(
            rows: list[tuple[User, ITSMUserAccess]],
            audience_type: str,
            reason: str,
            *,
            allowed_roles: set[str] = RECIPIENT_ROLES,
            projection_role: str | None = None,
        ) -> None:
            for user, access in rows:
                role = str(access.itsm_role).upper()
                if role not in allowed_roles:
                    exclusions.append({"audience_type": audience_type, "reason": "Role is not eligible for business alert delivery", "count": 1})
                    continue
                effective_role = projection_role or role
                current = resolved.get(user.id)
                membership = {"audience_type": audience_type, "reason": reason}
                candidate = {
                    "user_id": user.id,
                    "role": role,
                    "policy_role": effective_role,
                    "audience_type": audience_type,
                    "reason": reason,
                    "audience_memberships": [membership],
                }
                if current:
                    if membership not in current["audience_memberships"]:
                        current["audience_memberships"].append(membership)
                    if cls._projection_rank(effective_role) > cls._projection_rank(current["policy_role"]):
                        current.update({
                            "policy_role": effective_role,
                            "audience_type": audience_type,
                            "reason": reason,
                        })
                else:
                    resolved[user.id] = candidate

        for audience in alert.audiences:
            rows: list[tuple[User, ITSMUserAccess]] = []
            reason = ""
            empty_reason: str | None = None
            if audience.audience_type == TENANT_WIDE_AUDIENCE:
                rows = db.query(User, ITSMUserAccess).join(
                    ITSMUserAccess,
                    (ITSMUserAccess.user_id == User.id)
                    & (ITSMUserAccess.tenant_id == User.tenant_id),
                ).filter(
                    User.tenant_id == alert.tenant_id,
                    User.is_active.is_(True),
                    ITSMUserAccess.has_itsm_access.is_(True),
                    ITSMUserAccess.itsm_role.in_(TENANT_WIDE_RECIPIENT_ROLES),
                ).all()
                reason = "Active employee-facing portal account in this tenant"
                empty_reason = "No active employee-facing portal account is available in this tenant"
                include(
                    rows,
                    audience.audience_type,
                    reason,
                    allowed_roles=TENANT_WIDE_RECIPIENT_ROLES,
                    projection_role="REQUESTER",
                )
                if not rows:
                    exclusions.append({
                        "audience_type": audience.audience_type,
                        "reason": empty_reason,
                        "count": 0,
                    })
                continue
            if audience.audience_type == "SERVICE_USERS":
                has_company_wide_service = db.query(ITSMService.id).filter(
                    ITSMService.tenant_id == alert.tenant_id,
                    ITSMService.id.in_(service_ids),
                    ITSMService.alert_recipient_scope == "ALL_REQUESTERS",
                ).first() is not None
                requester_query = db.query(User, ITSMUserAccess).join(
                    ITSMUserAccess,
                    (ITSMUserAccess.user_id == User.id)
                    & (ITSMUserAccess.tenant_id == User.tenant_id),
                ).filter(
                    User.tenant_id == alert.tenant_id,
                    User.is_active.is_(True),
                    ITSMUserAccess.has_itsm_access.is_(True),
                    ITSMUserAccess.itsm_role == "REQUESTER",
                )
                if has_company_wide_service:
                    rows = requester_query.all()
                    reason = "Active Requester for a company-wide affected service"
                    empty_reason = "No active Requester is available in this tenant"
                else:
                    now = datetime.now(timezone.utc)
                    rows = requester_query.join(
                        ITSMServiceConsumer,
                        (ITSMServiceConsumer.user_id == User.id)
                        & (ITSMServiceConsumer.tenant_id == User.tenant_id),
                    ).filter(
                        ITSMServiceConsumer.service_id.in_(service_ids),
                        ITSMServiceConsumer.is_active.is_(True),
                        ITSMServiceConsumer.effective_from <= now,
                        or_(
                            ITSMServiceConsumer.effective_until.is_(None),
                            ITSMServiceConsumer.effective_until > now,
                        ),
                    ).all()
                    reason = "Authorized user of an affected service"
                    empty_reason = "No active Requester has an entitlement to the affected services"
            elif audience.audience_type == "SERVICE_AGENTS":
                rows = db.query(User, ITSMUserAccess).join(ITSMUserAccess, (ITSMUserAccess.user_id == User.id) & (ITSMUserAccess.tenant_id == User.tenant_id)).join(
                    ITSMTeamMember, (ITSMTeamMember.user_id == User.id) & (ITSMTeamMember.tenant_id == User.tenant_id)
                ).join(
                    ITSMTeam, (ITSMTeam.id == ITSMTeamMember.team_id) & (ITSMTeam.tenant_id == User.tenant_id)
                ).join(ITSMServiceSupportTeam, (ITSMServiceSupportTeam.team_id == ITSMTeamMember.team_id) & (ITSMServiceSupportTeam.tenant_id == User.tenant_id)).filter(
                    User.tenant_id == alert.tenant_id, User.is_active.is_(True), ITSMUserAccess.has_itsm_access.is_(True),
                    ITSMUserAccess.itsm_role == "SERVICE_AGENT", ITSMTeam.is_active.is_(True),
                    ITSMServiceSupportTeam.service_id.in_(service_ids),
                ).all()
                reason = "Support team is assigned to an affected service"
            elif audience.audience_type == "PROBLEM_MANAGERS":
                problem_ids = [
                    link.target_id for link in alert.links
                    if link.target_type == "PROBLEM"
                ]
                if problem_ids:
                    rows = db.query(User, ITSMUserAccess).join(
                        ITSMUserAccess,
                        (ITSMUserAccess.user_id == User.id)
                        & (ITSMUserAccess.tenant_id == User.tenant_id),
                    ).join(
                        ITSMProblemDetail,
                        (ITSMProblemDetail.assigned_investigator_id == User.id)
                        & (ITSMProblemDetail.tenant_id == User.tenant_id),
                    ).filter(
                        User.tenant_id == alert.tenant_id,
                        User.is_active.is_(True),
                        ITSMUserAccess.has_itsm_access.is_(True),
                        ITSMUserAccess.itsm_role == "PROCESS_CHANGE_MANAGER",
                        ITSMProblemDetail.ticket_id.in_(problem_ids),
                    ).all()
                reason = "Assigned investigator for a linked Problem"
            elif audience.audience_type == "CHANGE_MANAGERS":
                change_ids = [
                    link.target_id for link in alert.links
                    if link.target_type == "CHANGE"
                ]
                if change_ids:
                    rows = db.query(User, ITSMUserAccess).join(
                        ITSMUserAccess,
                        (ITSMUserAccess.user_id == User.id)
                        & (ITSMUserAccess.tenant_id == User.tenant_id),
                    ).join(
                        ITSMChangeRequest,
                        (ITSMChangeRequest.assigned_to_id == User.id)
                        & (ITSMChangeRequest.tenant_id == User.tenant_id),
                    ).filter(
                        User.tenant_id == alert.tenant_id,
                        User.is_active.is_(True),
                        ITSMUserAccess.has_itsm_access.is_(True),
                        ITSMUserAccess.itsm_role == "PROCESS_CHANGE_MANAGER",
                        ITSMChangeRequest.id.in_(change_ids),
                    ).all()
                reason = "Assigned manager for a linked Change"
            elif audience.audience_type == "SELECTED_TEAM" and audience.team_id:
                rows = db.query(User, ITSMUserAccess).join(ITSMUserAccess, (ITSMUserAccess.user_id == User.id) & (ITSMUserAccess.tenant_id == User.tenant_id)).join(
                    ITSMTeamMember, (ITSMTeamMember.user_id == User.id) & (ITSMTeamMember.tenant_id == User.tenant_id)
                ).join(
                    ITSMTeam, (ITSMTeam.id == ITSMTeamMember.team_id) & (ITSMTeam.tenant_id == User.tenant_id)
                ).filter(
                    User.tenant_id == alert.tenant_id, User.is_active.is_(True),
                    ITSMUserAccess.has_itsm_access.is_(True), ITSMTeam.is_active.is_(True),
                    ITSMTeamMember.team_id == audience.team_id,
                ).all()
                reason = f"Member of selected team {audience.team.name if audience.team else ''}".strip()
            elif audience.audience_type == "SERVICE_OWNERS":
                owner_ids = [row.owner_user_id for row in db.query(ITSMService).filter(ITSMService.tenant_id == alert.tenant_id, ITSMService.id.in_(service_ids), ITSMService.owner_user_id.isnot(None)).all()]
                if owner_ids:
                    rows = db.query(User, ITSMUserAccess).join(ITSMUserAccess, (ITSMUserAccess.user_id == User.id) & (ITSMUserAccess.tenant_id == User.tenant_id)).filter(
                        User.tenant_id == alert.tenant_id,
                        User.id.in_(owner_ids),
                        User.is_active.is_(True),
                        ITSMUserAccess.has_itsm_access.is_(True),
                        ITSMUserAccess.itsm_role == "CATALOG_MANAGER",
                    ).all()
                reason = "Owner of an affected service"
            elif audience.audience_type == "SPECIFIC_USER" and audience.user_id:
                if cls._specific_user_is_eligible(
                    db,
                    alert.tenant_id,
                    audience.user_id,
                    set(service_ids),
                    [(link.target_type, link.target_id) for link in alert.links],
                ):
                    rows = db.query(User, ITSMUserAccess).join(
                        ITSMUserAccess,
                        (ITSMUserAccess.user_id == User.id)
                        & (ITSMUserAccess.tenant_id == User.tenant_id),
                    ).filter(
                        User.tenant_id == alert.tenant_id,
                        User.id == audience.user_id,
                        User.is_active.is_(True),
                        ITSMUserAccess.has_itsm_access.is_(True),
                    ).all()
                reason = "Specifically selected and independently eligible for this alert scope"
            include(rows, audience.audience_type, reason)
            if not rows:
                exclusions.append({"audience_type": audience.audience_type, "reason": empty_reason or cls._empty_reason(audience.audience_type), "count": 0})

        content = cls._content(alert)
        recipients = []
        for item in resolved.values():
            policy_role = item.pop("policy_role")
            projection = project_alert(content, policy_role)
            authorized_links = cls._authorized_links_for_recipient(
                db,
                alert,
                item["user_id"],
                policy_role,
            )
            if "authorized_links" in projection:
                projection["authorized_links"] = authorized_links
            has_authorized_incident = any(link["type"] == "INCIDENT" for link in authorized_links)
            actions = allowed_actions_for(
                policy_role,
                intent=alert.intent,
                handling=alert.service_agent_handling,
                has_incident_link=has_authorized_incident,
            )
            recipients.append({**item, "projection_type": projection_type_for_role(policy_role), "content": projection, "allowed_actions": actions})
        return sorted(recipients, key=lambda row: (row["audience_type"], str(row["user_id"]))), exclusions

    @classmethod
    def _authorized_links_for_recipient(
        cls,
        db: Session,
        alert: ITSMOutageAlert,
        user_id: UUID,
        role: str,
    ) -> list[dict[str, str]]:
        """Return only related records the recipient can independently read."""
        normalized = normalize_role(role)
        authorized: list[dict[str, str]] = []
        for link in alert.links:
            allowed = False
            if normalized == "SERVICE_AGENT" and link.target_type in {"INCIDENT", "MAJOR_INCIDENT"}:
                if link.target_type == "INCIDENT":
                    ticket = db.query(ITSMTicket).filter(
                        ITSMTicket.tenant_id == alert.tenant_id,
                        ITSMTicket.id == link.target_id,
                        ITSMTicket.ticket_type == "INCIDENT",
                    ).first()
                else:
                    ticket = db.query(ITSMTicket).join(
                        ITSMMajorIncident,
                        (ITSMMajorIncident.ticket_id == ITSMTicket.id)
                        & (ITSMMajorIncident.tenant_id == ITSMTicket.tenant_id),
                    ).filter(
                        ITSMTicket.tenant_id == alert.tenant_id,
                        ITSMMajorIncident.id == link.target_id,
                    ).first()
                allowed = bool(
                    ticket
                    and IncidentService.check_incident_agent_access(
                        db,
                        alert.tenant_id,
                        ticket,
                        user_id,
                    )
                )
            elif normalized == "PROBLEM_AND_CHANGE_MANAGER":
                if link.target_type == "PROBLEM":
                    allowed = bool(
                        db.query(ITSMProblemDetail.id)
                        .filter(
                            ITSMProblemDetail.tenant_id == alert.tenant_id,
                            ITSMProblemDetail.ticket_id == link.target_id,
                            ITSMProblemDetail.assigned_investigator_id == user_id,
                        )
                        .first()
                    )
                elif link.target_type == "CHANGE":
                    allowed = bool(
                        db.query(ITSMChangeRequest.id)
                        .filter(
                            ITSMChangeRequest.tenant_id == alert.tenant_id,
                            ITSMChangeRequest.id == link.target_id,
                            ITSMChangeRequest.assigned_to_id == user_id,
                        )
                        .first()
                    )
            elif normalized == "SERVICE_OWNER":
                target_service_id = cls._linked_record_service_id(db, alert, link)
                allowed = bool(
                    target_service_id
                    and db.query(ITSMService.id).filter(
                        ITSMService.tenant_id == alert.tenant_id,
                        ITSMService.id == target_service_id,
                        ITSMService.owner_user_id == user_id,
                    ).first()
                )
            if allowed:
                authorized.append({"type": link.target_type, "id": str(link.target_id)})
        return authorized

    @staticmethod
    def _linked_record_service_id(
        db: Session,
        alert: ITSMOutageAlert,
        link: ITSMOutageAlertLink,
    ) -> UUID | None:
        if link.target_type in {"INCIDENT", "PROBLEM"}:
            row = db.query(ITSMTicket.service_id).filter(
                ITSMTicket.tenant_id == alert.tenant_id,
                ITSMTicket.id == link.target_id,
                ITSMTicket.ticket_type == link.target_type,
            ).first()
        elif link.target_type == "MAJOR_INCIDENT":
            row = db.query(ITSMTicket.service_id).join(
                ITSMMajorIncident,
                (ITSMMajorIncident.ticket_id == ITSMTicket.id)
                & (ITSMMajorIncident.tenant_id == ITSMTicket.tenant_id),
            ).filter(
                ITSMTicket.tenant_id == alert.tenant_id,
                ITSMMajorIncident.id == link.target_id,
            ).first()
        elif link.target_type == "CHANGE":
            row = db.query(ITSMChangeRequest.service_id).filter(
                ITSMChangeRequest.tenant_id == alert.tenant_id,
                ITSMChangeRequest.id == link.target_id,
            ).first()
        else:
            row = None
        return row.service_id if row else None

    @staticmethod
    def _projection_rank(role: str) -> int:
        return {"REQUESTER": 1, "CATALOG_MANAGER": 2, "PROCESS_CHANGE_MANAGER": 2, "PROBLEM_CHANGE_MANAGER": 2, "SERVICE_AGENT": 3}.get(role, 0)

    @staticmethod
    def _empty_reason(audience_type: str) -> str:
        return {
            "ALL_PORTAL_USERS": "No active employee-facing portal account is available in this tenant",
            "SERVICE_USERS": "No active Requester is linked to the affected services",
            "SERVICE_AGENTS": "No active Service Agent belongs to a support team for the affected services",
            "PROBLEM_MANAGERS": "No active Problem Manager is assigned to a linked Problem",
            "CHANGE_MANAGERS": "No active Change Manager is assigned to a linked Change",
            "SELECTED_TEAM": "The selected team has no active eligible ITSM members",
            "SERVICE_OWNERS": "The affected services have no active eligible owner",
            "SPECIFIC_USER": "The selected user is no longer eligible for the affected services or linked records",
        }.get(audience_type, "No eligible recipients")

    @classmethod
    def _preview_token(cls, alert: ITSMOutageAlert, recipients: list[dict[str, Any]]) -> str:
        alert_content = cls._content(alert)
        for server_managed in (
            "updated_by_id", "updated_at", "published_at",
            "latest_publication_at", "recovered_at",
        ):
            alert_content.pop(server_managed, None)
        canonical = {
            "alert": alert_content,
            "recipients": [{
                "user_id": str(r["user_id"]),
                "audience_memberships": r["audience_memberships"],
                "projection": r["content"],
                "actions": r["allowed_actions"],
            } for r in recipients],
        }
        return hashlib.sha256(json.dumps(canonical, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()

    @classmethod
    def preview(cls, db: Session, tenant_id: UUID, actor_id: UUID, alert_id: UUID, changes: Any | None = None) -> dict[str, Any]:
        alert = cls.get_alert(db, tenant_id, alert_id)
        cls.require_alert_permission(db, tenant_id, actor_id, "OUTAGE_ALERT:PREVIEW", alert)
        if alert.status not in {"DRAFT", "ACTIVE"}:
            raise HTTPException(status_code=409, detail="This alert cannot be previewed in its current state")
        if not alert.audiences:
            raise HTTPException(status_code=422, detail="Select at least one audience before preview")
        cls._validate_publishable(alert)
        publication_type = getattr(changes, "publication_type", None) or ("INITIAL" if alert.status == "DRAFT" else "UPDATE")
        requested_public_status = getattr(changes, "public_status", None) if changes is not None else None
        public_status = cls._publication_public_status(alert, publication_type, requested_public_status)
        original: dict[str, Any] = {"status": alert.status, "public_status": alert.public_status}
        provided_fields = getattr(changes, "model_fields_set", set()) if changes is not None else set()
        nullable_fields = {"recommended_action", "service_agent_guidance", "internal_notes", "next_update_at"}
        for field in ("public_summary", "impact_summary", "recommended_action", "service_agent_guidance", "internal_notes", "severity", "next_update_at"):
            value = getattr(changes, field, None) if changes is not None else None
            original[field] = getattr(alert, field)
            if value is not None or (field in nullable_fields and field in provided_fields):
                setattr(alert, field, value)
        alert.public_status = public_status
        if publication_type == "INITIAL":
            alert.status = "ACTIVE"
        elif publication_type == "RECOVERY":
            alert.status = "RECOVERED"
        try:
            # Preview temporarily applies unsaved publication content. Prevent
            # relationship lookups in the resolver from auto-flushing those
            # temporary values into the canonical draft.
            with db.no_autoflush:
                recipients, exclusions = cls.resolve_recipients(db, alert)
                grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
                for row in recipients:
                    for membership in row["audience_memberships"]:
                        grouped[(
                            membership["audience_type"],
                            row["projection_type"],
                        )].append(row)
                groups = [{
                    "audience_type": audience_type,
                    "projection_type": projection_type,
                    "recipient_count": len(rows),
                    "included_because": next(
                        membership["reason"]
                        for membership in rows[0]["audience_memberships"]
                        if membership["audience_type"] == audience_type
                    ),
                    "projection_fields": projection_fields(rows[0]["role"]),
                    "allowed_actions": sorted({action for row in rows for action in row["allowed_actions"]}),
                } for (audience_type, projection_type), rows in grouped.items()]
                token = cls._preview_token(alert, recipients)
        finally:
            for field, value in original.items():
                setattr(alert, field, value)
        return {"alert_id": alert.id, "preview_token": token, "total_recipients": len(recipients), "groups": groups, "exclusions": exclusions}

    @classmethod
    def list_recipient_evidence(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        alert_id: UUID,
        *,
        publication_id: UUID | None = None,
        search: str | None = None,
        audience_type: str | None = None,
        projection_type: str | None = None,
        delivery_status: str | None = None,
        acknowledgement: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Return an authorized, paginated explanation of Alert recipients.

        Live preview rows come from the canonical resolver. Published rows come
        from immutable recipient snapshots so the screen never rewrites who was
        actually targeted or why.
        """
        alert = cls.get_alert(db, tenant_id, alert_id)
        cls.require_alert_permission(
            db,
            tenant_id,
            actor_id,
            "OUTAGE_ALERT:PREVIEW",
            alert,
        )
        term = (search or "").strip().lower()

        if publication_id is not None:
            publication = db.query(ITSMOutageAlertPublication).filter(
                ITSMOutageAlertPublication.tenant_id == tenant_id,
                ITSMOutageAlertPublication.alert_id == alert.id,
                ITSMOutageAlertPublication.id == publication_id,
            ).first()
            if not publication:
                raise HTTPException(status_code=404, detail="Alert publication not found")

            query = db.query(ITSMOutageAlertRecipient, User.email).outerjoin(
                User,
                (User.id == ITSMOutageAlertRecipient.user_id)
                & (User.tenant_id == ITSMOutageAlertRecipient.tenant_id),
            ).filter(
                ITSMOutageAlertRecipient.tenant_id == tenant_id,
                ITSMOutageAlertRecipient.publication_id == publication.id,
            )
            if term:
                query = query.filter(User.email.ilike(f"%{term}%"))
            if audience_type:
                query = query.filter(or_(
                    ITSMOutageAlertRecipient.audience_type == audience_type,
                    ITSMOutageAlertRecipient.audience_memberships.contains([
                        {"audience_type": audience_type}
                    ]),
                ))
            if projection_type:
                query = query.filter(
                    ITSMOutageAlertRecipient.projection_type == projection_type
                )
            if delivery_status:
                query = query.filter(
                    ITSMOutageAlertRecipient.delivery_status == delivery_status
                )
            if acknowledgement == "ACKNOWLEDGED":
                query = query.filter(
                    ITSMOutageAlertRecipient.acknowledged_at.isnot(None)
                )
            elif acknowledgement == "PENDING":
                query = query.filter(
                    ITSMOutageAlertRecipient.acknowledged_at.is_(None)
                )

            total = query.count()
            rows = query.order_by(
                User.email.asc().nullslast(),
                ITSMOutageAlertRecipient.id.asc(),
            ).offset(offset).limit(limit).all()
            items = [{
                "user_id": recipient.user_id,
                "email": email or "Unavailable user",
                "role": recipient.projection_type,
                "projection_type": recipient.projection_type,
                "audience_memberships": recipient.audience_memberships or [{
                    "audience_type": recipient.audience_type,
                    "reason": recipient.inclusion_reason,
                }],
                "inclusion_reason": recipient.inclusion_reason,
                "projection_fields": sorted((recipient.content_snapshot or {}).keys()),
                "allowed_actions": sorted(recipient.allowed_actions or []),
                "channels": (["IN_APP"] if recipient.notification_id else []) + ["PORTAL"],
                "delivery_status": recipient.delivery_status,
                "available_at": recipient.available_at,
                "read_at": recipient.read_at,
                "acknowledged_at": recipient.acknowledged_at,
            } for recipient, email in rows]
            return {
                "source": "PUBLICATION_SNAPSHOT",
                "publication_id": publication.id,
                "publication_version": publication.version,
                "items": items,
                "total": total,
                "offset": offset,
                "limit": limit,
                "has_more": offset + len(items) < total,
            }

        if alert.status not in {"DRAFT", "ACTIVE"}:
            raise HTTPException(
                status_code=409,
                detail="Live recipient preview is unavailable in this alert state",
            )
        recipients, _ = cls.resolve_recipients(db, alert)
        user_ids = {recipient["user_id"] for recipient in recipients}
        emails = {
            user_id: email
            for user_id, email in db.query(User.id, User.email).filter(
                User.tenant_id == tenant_id,
                User.id.in_(user_ids or {UUID(int=0)}),
            ).all()
        }
        items = []
        for recipient in recipients:
            memberships = recipient["audience_memberships"]
            email = emails.get(recipient["user_id"], "Unavailable user")
            if term and term not in email.lower():
                continue
            if audience_type and not any(
                membership.get("audience_type") == audience_type
                for membership in memberships
            ):
                continue
            if projection_type and recipient["projection_type"] != projection_type:
                continue
            items.append({
                "user_id": recipient["user_id"],
                "email": email,
                "role": recipient["role"],
                "projection_type": recipient["projection_type"],
                "audience_memberships": memberships,
                "inclusion_reason": recipient["reason"],
                "projection_fields": sorted(recipient["content"].keys()),
                "allowed_actions": sorted(recipient["allowed_actions"]),
                "channels": [],
                "delivery_status": None,
                "available_at": None,
                "read_at": None,
                "acknowledged_at": None,
            })
        items.sort(key=lambda item: (item["email"].lower(), str(item["user_id"])))
        total = len(items)
        page = items[offset:offset + limit]
        return {
            "source": "LIVE_PREVIEW",
            "publication_id": None,
            "publication_version": None,
            "items": page,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + len(page) < total,
        }

    @classmethod
    def publish(cls, db: Session, tenant_id: UUID, actor_id: UUID, alert_id: UUID, payload: AlertPublicationRequest, publication_type: str) -> ITSMOutageAlertPublication:
        permission = {
            "INITIAL": "OUTAGE_ALERT:PUBLISH",
            "UPDATE": "OUTAGE_ALERT:UPDATE",
            "RECOVERY": "OUTAGE_ALERT:RECOVER",
        }.get(publication_type)
        if permission is None:
            raise HTTPException(status_code=422, detail="Unsupported publication type")
        alert = cls._query(db, tenant_id).filter(
            ITSMOutageAlert.id == alert_id,
        ).with_for_update().first()
        if not alert:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
        cls.require_alert_permission(db, tenant_id, actor_id, permission, alert)
        if db.get_bind().dialect.name == "postgresql":
            db.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                {"key": f"{tenant_id}:outage-alert:{payload.idempotency_key}"},
            )
        existing = db.query(ITSMOutageAlertPublication).filter(ITSMOutageAlertPublication.tenant_id == tenant_id, ITSMOutageAlertPublication.idempotency_key == payload.idempotency_key).first()
        if existing:
            if existing.alert_id != alert_id or existing.publication_type != publication_type:
                raise HTTPException(status_code=409, detail="Idempotency key is already used for another operation")
            return existing
        if any(
            audience.audience_type == TENANT_WIDE_AUDIENCE
            for audience in alert.audiences
        ) and not payload.confirm_tenant_wide:
            raise HTTPException(
                status_code=422,
                detail="Confirm the tenant-wide recipient preview before publishing",
            )
        required = "DRAFT" if publication_type == "INITIAL" else "ACTIVE"
        if alert.status != required:
            raise HTTPException(status_code=409, detail=f"{publication_type.title()} is not valid while alert is {alert.status}")
        alert.public_status = cls._publication_public_status(
            alert,
            publication_type,
            payload.public_status,
        )
        nullable_fields = {"recommended_action", "service_agent_guidance", "internal_notes", "next_update_at"}
        for field in ("public_summary", "impact_summary", "recommended_action", "service_agent_guidance", "internal_notes", "severity", "next_update_at"):
            value = getattr(payload, field)
            if value is not None or (field in nullable_fields and field in payload.model_fields_set):
                setattr(alert, field, value)
        alert.updated_by_id = actor_id
        original_status = alert.status
        if publication_type == "INITIAL":
            alert.status = "ACTIVE"
        elif publication_type == "RECOVERY":
            alert.status = "RECOVERED"
        recipients, exclusions = cls.resolve_recipients(db, alert)
        if not recipients:
            detail = exclusions[0]["reason"] if exclusions else "No authorized recipients match the selected audience and scope"
            raise HTTPException(status_code=422, detail=detail)
        token = cls._preview_token(alert, recipients)
        if token != payload.preview_token:
            alert.status = original_status
            raise HTTPException(status_code=409, detail="Alert, audience, or recipient eligibility changed. Preview again before publishing")
        version = (db.query(func.max(ITSMOutageAlertPublication.version)).filter(ITSMOutageAlertPublication.alert_id == alert.id).scalar() or 0) + 1
        now = datetime.now(timezone.utc)
        alert.updated_at = now
        if publication_type == "INITIAL":
            alert.published_at = now
        elif publication_type == "RECOVERY":
            alert.recovered_at = now
        publication = ITSMOutageAlertPublication(
            tenant_id=tenant_id, alert_id=alert.id, version=version, publication_type=publication_type,
            content_snapshot=cls._content(alert, latest_publication_at=now),
            audience_snapshot=[{
                "type": a.audience_type,
                "team_id": str(a.team_id) if a.team_id else None,
                "user_id": str(a.user_id) if a.user_id else None,
            } for a in alert.audiences],
            recipient_count=len(recipients), idempotency_key=payload.idempotency_key,
            published_by_id=actor_id, published_at=now,
        )
        db.add(publication)
        db.flush()
        for resolved in recipients:
            # resolve_recipients is the single projection authority for both
            # preview and delivery.  Re-projecting the canonical Alert here
            # would discard its per-recipient related-record authorization
            # and could persist identifiers the recipient cannot read.
            final_projection = {
                **resolved["content"],
                "latest_publication_at": now.isoformat(),
            }
            notification_severity = str(final_projection.get("severity") or "info").lower()
            public_status_label = str(final_projection.get("public_status") or "Service update").replace("_", " ").title()
            notification = add_notification(
                db, tenant_id=tenant_id, user_id=resolved["user_id"], type="itsm_outage_alert",
                severity="critical" if notification_severity == "critical" else "warning" if notification_severity == "high" else "info",
                title=f"{public_status_label}: " + str(final_projection.get("title") or "Service alert"),
                body=str(final_projection.get("public_summary") or "")[:1000], link=f"/itsm/outage-alerts/{alert.id}",
            )
            db.flush()
            db.add(ITSMOutageAlertRecipient(
                tenant_id=tenant_id, publication_id=publication.id, user_id=resolved["user_id"],
                audience_type=resolved["audience_type"], projection_type=resolved["projection_type"],
                inclusion_reason=resolved["reason"],
                audience_memberships=resolved["audience_memberships"],
                allowed_actions=resolved["allowed_actions"],
                content_snapshot=final_projection, notification_id=notification.id,
                delivery_status="AVAILABLE", attempt_count=1, available_at=now,
            ))
        alert.current_publication_id = publication.id
        cls._audit(db, alert, actor_id, f"publication.{publication_type.lower()}", [f"version={version}", f"recipient_count={len(recipients)}"])
        db.commit()
        db.refresh(publication)
        return publication

    @classmethod
    def cancel_draft(cls, db: Session, tenant_id: UUID, actor_id: UUID, alert_id: UUID) -> ITSMOutageAlert:
        alert = cls.get_alert(db, tenant_id, alert_id)
        cls.require_alert_permission(db, tenant_id, actor_id, "OUTAGE_ALERT:CANCEL", alert)
        if alert.status != "DRAFT":
            raise HTTPException(status_code=409, detail="Only an unpublished draft can be cancelled")
        alert.status, alert.cancelled_at, alert.updated_by_id = "CANCELLED", datetime.now(timezone.utc), actor_id
        cls._audit(db, alert, actor_id, "draft.cancelled")
        db.commit()
        return alert

    @classmethod
    def _has_alert_permission(
        cls,
        db: Session,
        tenant_id: UUID,
        user_id: UUID,
        permission: str,
        alert: ITSMOutageAlert,
    ) -> bool:
        grants = db.query(ITSMOutageAlertGrant.service_id).filter(
            ITSMOutageAlertGrant.tenant_id == tenant_id,
            ITSMOutageAlertGrant.user_id == user_id,
            ITSMOutageAlertGrant.permission == permission,
        ).all()
        if not grants:
            return False
        if any(row.service_id is None for row in grants):
            return True
        service_ids = cls._service_ids(alert)
        return bool(service_ids) and service_ids.issubset({row.service_id for row in grants})

    @classmethod
    def _manager_actions(
        cls,
        db: Session,
        tenant_id: UUID,
        user_id: UUID,
        alert: ITSMOutageAlert,
    ) -> list[str]:
        actions = ["VIEW"] if cls._has_alert_permission(db, tenant_id, user_id, "OUTAGE_ALERT:READ", alert) else []
        lifecycle_actions = {
            "DRAFT": ("PREVIEW", "EDIT_DRAFT", "PUBLISH", "CANCEL_DRAFT", "LINK_RECORD"),
            "ACTIVE": ("PREVIEW", "PUBLISH_UPDATE", "PUBLISH_RECOVERY", "LINK_RECORD"),
            "RECOVERED": (),
            "CANCELLED": (),
        }.get(alert.status, ())
        for action in lifecycle_actions:
            permission = ACTION_PERMISSIONS[action]
            if cls._has_alert_permission(db, tenant_id, user_id, permission, alert):
                actions.append(action)
        return actions

    @classmethod
    def _current_recipient(
        cls,
        db: Session,
        alert: ITSMOutageAlert,
        user_id: UUID,
    ) -> dict[str, Any] | None:
        """Intersect the current delivery snapshot with current eligibility.

        Recipient snapshots are audit evidence, not a durable access grant. A
        caller must still be eligible for the alert now and must have been a
        recipient of the alert's current publication. The immutable snapshot
        is returned so read paths cannot expand historical content by
        re-projecting the canonical publication under a newly acquired role.
        """
        if alert.current_publication_id is None:
            return None
        snapshot = db.query(ITSMOutageAlertRecipient).filter(
            ITSMOutageAlertRecipient.tenant_id == alert.tenant_id,
            ITSMOutageAlertRecipient.publication_id == alert.current_publication_id,
            ITSMOutageAlertRecipient.user_id == user_id,
        ).first()
        if not snapshot:
            return None
        recipients, _ = cls.resolve_recipients(db, alert)
        current = next((row for row in recipients if row["user_id"] == user_id), None)
        if current is None:
            return None
        return {
            **current,
            "content_snapshot": snapshot.content_snapshot,
            "snapshot_actions": snapshot.allowed_actions,
        }

    @staticmethod
    def _delivery_counts(alert: ITSMOutageAlert) -> dict[str, int]:
        counts: dict[str, int] = defaultdict(int)
        for publication in alert.publications:
            for recipient in publication.recipients:
                counts[recipient.delivery_status] += 1
        return dict(sorted(counts.items()))

    @staticmethod
    def _parse_audit_trace(raw_trace: Any) -> dict[str, Any]:
        if isinstance(raw_trace, dict):
            return raw_trace
        if isinstance(raw_trace, str):
            try:
                parsed = json.loads(raw_trace)
            except json.JSONDecodeError:
                return {}
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list):
                values: dict[str, Any] = {}
                for item in parsed:
                    if isinstance(item, str) and "=" in item:
                        key, value = item.split("=", 1)
                        values[key.strip()] = value.strip()
                return values
        return {}

    @classmethod
    def _auditor_audit_events(
        cls,
        db: Session,
        tenant_id: UUID,
        alert_id: UUID,
    ) -> list[dict[str, Any]]:
        rows = (
            db.query(AuditLogMetadata)
            .filter(
                AuditLogMetadata.tenant_id == tenant_id,
                AuditLogMetadata.request_id == str(alert_id),
                AuditLogMetadata.action.ilike("itsm.outage_alert.%"),
            )
            .order_by(AuditLogMetadata.tenant_sequence.asc())
            .all()
        )
        actor_ids = {row.actor_id for row in rows if row.actor_id is not None}
        displays = {
            str(user.id): user.email
            for user in db.query(User.id, User.email).filter(
                User.tenant_id == tenant_id,
                User.id.in_(actor_ids or {UUID(int=0)}),
            )
        }
        return [
            {
                "record_id": str(row.record_id),
                "sequence": row.tenant_sequence,
                "timestamp": row.created_at,
                "actor_id": str(row.actor_id) if row.actor_id else None,
                "actor_display": displays.get(str(row.actor_id)) if row.actor_id else "System",
                "action": row.action.removeprefix("itsm.outage_alert."),
                "outcome": "RECORDED" if 200 <= row.response_status < 300 else "FAILED",
                "response_status": row.response_status,
                "reason": row.reason,
                "correlation_id": row.request_id,
                "policy_decision": cls._parse_audit_trace(row.execution_trace).get("policy_decision"),
                "prior_hash": row.prior_hash,
                "integrity_hash": row.integrity_hash,
            }
            for row in rows
        ]

    @classmethod
    def _auditor_evidence_status(
        cls,
        alert: ITSMOutageAlert,
        audit_event_count: int,
    ) -> dict[str, Any]:
        publications_expected = alert.status in {"ACTIVE", "RECOVERED"}
        publication_status = "PRESENT" if alert.publications else (
            "MISSING" if publications_expected else "NOT_APPLICABLE"
        )
        audience_status = "NOT_APPLICABLE"
        resolution_status = "NOT_APPLICABLE"
        delivery_status = "NOT_APPLICABLE"
        if alert.publications:
            audience_status = (
                "PRESENT"
                if all(publication.audience_snapshot is not None for publication in alert.publications)
                else "MISSING"
            )
            resolution_status = (
                "PRESENT"
                if all(publication.recipient_count == len(publication.recipients) for publication in alert.publications)
                else "INCOMPLETE"
            )
            recipients = [
                recipient
                for publication in alert.publications
                for recipient in publication.recipients
            ]
            delivery_status = (
                "PRESENT"
                if recipients and all(recipient.delivery_status for recipient in recipients)
                else "NOT_APPLICABLE" if not recipients else "INCOMPLETE"
            )
        checks = {
            "publication_history": publication_status,
            "audience_snapshot": audience_status,
            "recipient_resolution": resolution_status,
            "delivery_evidence": delivery_status,
            "audit_timeline": "PRESENT" if audit_event_count else "MISSING",
            # Successful lifecycle events are recorded, but the current alert
            # workflow does not persist the evaluated policy/grant as a
            # separate decision record. Report that limitation honestly.
            "authorization_decision": "NOT_COLLECTED",
            "recipient_exclusions": "NOT_COLLECTED",
        }
        incomplete = any(value in {"MISSING", "INCOMPLETE"} for value in checks.values())
        limited = any(value == "NOT_COLLECTED" for value in checks.values())
        overall = "INCOMPLETE" if incomplete else "AVAILABLE_WITH_LIMITATIONS" if limited else "COMPLETE"
        return {"status": overall, "checks": checks}

    @classmethod
    def list_auditor_evidence(
        cls,
        db: Session,
        tenant_id: UUID,
        user_id: UUID,
        *,
        search: str | None = None,
        lifecycle_status: str | None = None,
        severity: str | None = None,
        audience: str | None = None,
        actor: str | None = None,
        delivery_status: str | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        role = cls.role_for(db, tenant_id, user_id)
        if normalize_role(role) != "AUDITOR":
            raise HTTPException(status_code=403, detail="Auditor evidence permission required")

        query = cls._query(db, tenant_id)
        if lifecycle_status:
            query = query.filter(ITSMOutageAlert.status == lifecycle_status.upper())
        if severity:
            query = query.filter(ITSMOutageAlert.severity == severity.upper())
        if start:
            query = query.filter(func.coalesce(ITSMOutageAlert.published_at, ITSMOutageAlert.created_at) >= start)
        if end:
            query = query.filter(func.coalesce(ITSMOutageAlert.published_at, ITSMOutageAlert.created_at) <= end)
        if search:
            pattern = f"%{search.strip()}%"
            service_alert_ids = db.query(ITSMOutageAlertService.alert_id).join(
                ITSMService,
                (ITSMService.id == ITSMOutageAlertService.service_id)
                & (ITSMService.tenant_id == ITSMOutageAlertService.tenant_id),
            ).filter(
                ITSMOutageAlertService.tenant_id == tenant_id,
                ITSMService.name.ilike(pattern),
            )
            query = query.filter(or_(
                ITSMOutageAlert.alert_number.ilike(pattern),
                ITSMOutageAlert.title.ilike(pattern),
                cast(ITSMOutageAlert.id, String).ilike(pattern),
                ITSMOutageAlert.id.in_(service_alert_ids),
            ))
        if audience:
            audience_alert_ids = db.query(ITSMOutageAlertAudience.alert_id).filter(
                ITSMOutageAlertAudience.tenant_id == tenant_id,
                ITSMOutageAlertAudience.audience_type == audience.upper(),
            )
            query = query.filter(ITSMOutageAlert.id.in_(audience_alert_ids))
        if actor:
            matching_actor_ids = [row.id for row in db.query(User.id).filter(
                User.tenant_id == tenant_id,
                User.email.ilike(f"%{actor.strip()}%"),
            ).all()]
            published_alert_ids = db.query(ITSMOutageAlertPublication.alert_id).filter(
                ITSMOutageAlertPublication.tenant_id == tenant_id,
                ITSMOutageAlertPublication.published_by_id.in_(matching_actor_ids),
            )
            query = query.filter(or_(
                ITSMOutageAlert.created_by_id.in_(matching_actor_ids),
                ITSMOutageAlert.id.in_(published_alert_ids),
            ))
        if delivery_status:
            delivery_alert_ids = db.query(ITSMOutageAlertPublication.alert_id).join(
                ITSMOutageAlertRecipient,
                (ITSMOutageAlertRecipient.publication_id == ITSMOutageAlertPublication.id)
                & (ITSMOutageAlertRecipient.tenant_id == ITSMOutageAlertPublication.tenant_id),
            ).filter(
                ITSMOutageAlertPublication.tenant_id == tenant_id,
                ITSMOutageAlertRecipient.delivery_status == delivery_status.upper(),
            )
            query = query.filter(ITSMOutageAlert.id.in_(delivery_alert_ids))

        total = query.count()
        alerts = (
            query.order_by(ITSMOutageAlert.updated_at.desc(), ITSMOutageAlert.id.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        actor_ids = {
            actor_id
            for alert in alerts
            for actor_id in (
                alert.created_by_id,
                alert.publications[-1].published_by_id if alert.publications else None,
            )
            if actor_id is not None
        }
        displays = {
            str(user.id): user.email
            for user in db.query(User.id, User.email).filter(
                User.tenant_id == tenant_id,
                User.id.in_(actor_ids or {UUID(int=0)}),
            )
        }
        alert_ids = [str(alert.id) for alert in alerts]
        audit_counts = {
            str(request_id): int(count)
            for request_id, count in db.query(
                AuditLogMetadata.request_id,
                func.count(AuditLogMetadata.id),
            ).filter(
                AuditLogMetadata.tenant_id == tenant_id,
                AuditLogMetadata.request_id.in_(alert_ids or [""]),
                AuditLogMetadata.action.ilike("itsm.outage_alert.%"),
            ).group_by(AuditLogMetadata.request_id)
        }

        items = []
        for alert in alerts:
            latest = alert.publications[-1] if alert.publications else None
            delivery = cls._delivery_counts(alert)
            audit_count = audit_counts.get(str(alert.id), 0)
            evidence = cls._auditor_evidence_status(alert, audit_count)
            publication_recipient_counts = [publication.recipient_count for publication in alert.publications]
            summary = cls.summary(alert, role)
            summary.update({
                "created_by_id": alert.created_by_id,
                "created_by_display": displays.get(str(alert.created_by_id)),
                "created_at": alert.created_at,
                "published_by_id": latest.published_by_id if latest else None,
                "published_by_display": displays.get(str(latest.published_by_id)) if latest else None,
                "intended_audiences": sorted({item.audience_type for item in alert.audiences}),
                "publication_count": len(alert.publications),
                "recipient_count": publication_recipient_counts[-1] if publication_recipient_counts else 0,
                "delivery_summary": delivery,
                "broadcast_outcome": (
                    "RECOVERED" if alert.status == "RECOVERED" else
                    "PUBLISHED" if alert.status == "ACTIVE" else
                    "CANCELLED" if alert.status == "CANCELLED" else
                    "NOT_PUBLISHED"
                ),
                "audit_event_count": audit_count,
                "evidence_status": evidence["status"],
            })
            items.append(summary)
        return {
            "items": items,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + len(items) < total,
        }

    @classmethod
    def list_delivery_health(
        cls,
        db: Session,
        tenant_id: UUID,
        user_id: UUID,
        *,
        search: str | None = None,
        alert_status: str | None = None,
        delivery_status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        role = cls.role_for(db, tenant_id, user_id)
        if not can_view_delivery_health(role):
            raise HTTPException(status_code=403, detail="Broadcast delivery health permission required")

        query = cls._query(db, tenant_id)
        readable_alert_ids = None
        if normalize_role(role) == "INCIDENT_MANAGER":
            read_scope = cls.permission_scope(
                db,
                tenant_id,
                user_id,
                "OUTAGE_ALERT:READ",
            )
            if read_scope is not None:
                readable_alert_ids = (
                    db.query(ITSMOutageAlertService.alert_id)
                    .filter(
                        ITSMOutageAlertService.tenant_id == tenant_id,
                        ITSMOutageAlertService.service_id.in_(read_scope),
                    )
                    .distinct()
                )
                query = query.filter(ITSMOutageAlert.id.in_(readable_alert_ids))
        if alert_status:
            query = query.filter(ITSMOutageAlert.status == alert_status.upper())
        if search:
            pattern = f"%{search.strip()}%"
            service_alert_ids = db.query(ITSMOutageAlertService.alert_id).join(
                ITSMService,
                (ITSMService.id == ITSMOutageAlertService.service_id)
                & (ITSMService.tenant_id == ITSMOutageAlertService.tenant_id),
            ).filter(
                ITSMOutageAlertService.tenant_id == tenant_id,
                ITSMService.name.ilike(pattern),
            )
            query = query.filter(or_(
                ITSMOutageAlert.alert_number.ilike(pattern),
                cast(ITSMOutageAlert.id, String).ilike(pattern),
                ITSMOutageAlert.id.in_(service_alert_ids),
            ))
        if delivery_status:
            delivery_alert_ids = db.query(ITSMOutageAlertPublication.alert_id).join(
                ITSMOutageAlertRecipient,
                (ITSMOutageAlertRecipient.publication_id == ITSMOutageAlertPublication.id)
                & (ITSMOutageAlertRecipient.tenant_id == ITSMOutageAlertPublication.tenant_id),
            ).filter(
                ITSMOutageAlertPublication.tenant_id == tenant_id,
                ITSMOutageAlertRecipient.delivery_status == delivery_status.upper(),
            )
            query = query.filter(ITSMOutageAlert.id.in_(delivery_alert_ids))

        total = query.count()
        alerts = (
            query.order_by(ITSMOutageAlert.updated_at.desc(), ITSMOutageAlert.id.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        all_published_query = db.query(ITSMOutageAlert).filter(
            ITSMOutageAlert.tenant_id == tenant_id,
            ITSMOutageAlert.status.in_(["ACTIVE", "RECOVERED"]),
        )
        if readable_alert_ids is not None:
            all_published_query = all_published_query.filter(
                ITSMOutageAlert.id.in_(readable_alert_ids)
            )
        all_published_alerts = all_published_query.all()
        total_broadcasts = len(all_published_alerts)
        active_broadcasts = sum(1 for a in all_published_alerts if a.status == "ACTIVE")

        recipient_counts = db.query(
            ITSMOutageAlertRecipient.delivery_status,
            func.count(ITSMOutageAlertRecipient.id),
        ).join(
            ITSMOutageAlertPublication,
            (ITSMOutageAlertPublication.id == ITSMOutageAlertRecipient.publication_id)
            & (ITSMOutageAlertPublication.tenant_id == ITSMOutageAlertRecipient.tenant_id),
        ).filter(
            ITSMOutageAlertRecipient.tenant_id == tenant_id,
        )
        if readable_alert_ids is not None:
            recipient_counts = recipient_counts.filter(
                ITSMOutageAlertPublication.alert_id.in_(readable_alert_ids)
            )
        recipient_counts_query = recipient_counts.group_by(
            ITSMOutageAlertRecipient.delivery_status
        ).all()

        global_delivery = {row[0]: int(row[1]) for row in recipient_counts_query}
        total_recipients = sum(global_delivery.values())
        total_delivered = global_delivery.get("AVAILABLE", 0)
        total_retrying = global_delivery.get("RETRYING", 0)
        total_failed = global_delivery.get("FAILED", 0) + global_delivery.get("PERMANENTLY_FAILED", 0)

        items = []
        for alert in alerts:
            delivery = cls._delivery_counts(alert)
            failed_count = delivery.get("FAILED", 0) + delivery.get("PERMANENTLY_FAILED", 0)
            retrying_count = delivery.get("RETRYING", 0)
            publication_recipient_counts = [p.recipient_count for p in alert.publications]
            last_err = None
            for p in alert.publications:
                for r in p.recipients:
                    if r.last_error:
                        last_err = r.last_error
                        break
                if last_err:
                    break

            if failed_count > 0:
                health_status = "FAILED"
            elif retrying_count > 0:
                health_status = "RETRYING"
            elif len(alert.publications) > 0:
                health_status = "HEALTHY"
            else:
                health_status = "IDLE"

            summary = cls.summary(alert, role)
            summary.update({
                "publication_count": len(alert.publications),
                "recipient_count": publication_recipient_counts[-1] if publication_recipient_counts else 0,
                "delivery_summary": delivery,
                "channels": ["IN_APP", "PORTAL"],
                "failed_recipient_count": failed_count,
                "retrying_recipient_count": retrying_count,
                "delivery_health_status": health_status,
                "last_error": last_err,
            })
            items.append(summary)

        return {
            "items": items,
            "total": total,
            "metrics": {
                "total_broadcasts": total_broadcasts,
                "active_broadcasts": active_broadcasts,
                "total_recipients": total_recipients,
                "total_delivered": total_delivered,
                "total_retrying": total_retrying,
                "total_failed": total_failed,
            },
            "channels": [
                {"channel": "IN_APP", "status": "OPERATIONAL", "name": "In-App Notifications", "description": "Persistent tenant in-app notification feed"},
                {"channel": "PORTAL", "status": "OPERATIONAL", "name": "Employee Portal Banner", "description": "Real-time self-service portal outage banners"},
            ],
            "offset": offset,
            "limit": limit,
            "has_more": offset + len(items) < total,
        }

    @classmethod
    def list_visible(cls, db: Session, tenant_id: UUID, user_id: UUID, requested_status: str | None = None, linked_type: str | None = None, linked_id: UUID | None = None) -> list[dict[str, Any]]:
        role = cls.role_for(db, tenant_id, user_id)
        query = cls._query(db, tenant_id)
        if requested_status:
            query = query.filter(ITSMOutageAlert.status == requested_status.upper())
        if linked_type and linked_id:
            linked_alert_ids = db.query(ITSMOutageAlertLink.alert_id).filter(
                ITSMOutageAlertLink.tenant_id == tenant_id,
                ITSMOutageAlertLink.target_type == linked_type.upper(),
                ITSMOutageAlertLink.target_id == linked_id,
            )
            query = query.filter(ITSMOutageAlert.id.in_(linked_alert_ids))
        normalized = normalize_role(role)
        if not can_manage(role) and normalized not in {"AUDITOR", "PLATFORM_ADMIN"}:
            visible_ids = db.query(ITSMOutageAlertPublication.alert_id).join(ITSMOutageAlertRecipient).filter(
                ITSMOutageAlertPublication.tenant_id == tenant_id, ITSMOutageAlertRecipient.user_id == user_id
            ).distinct()
            query = query.filter(ITSMOutageAlert.id.in_(visible_ids))
        alerts = query.order_by(ITSMOutageAlert.updated_at.desc(), ITSMOutageAlert.id.desc()).all()
        if can_manage(role):
            alerts = [
                alert for alert in alerts
                if cls._has_alert_permission(db, tenant_id, user_id, "OUTAGE_ALERT:READ", alert)
            ]
        elif normalized not in {"AUDITOR", "PLATFORM_ADMIN"}:
            alerts = [alert for alert in alerts if cls._current_recipient(db, alert, user_id)]
        summaries = []
        for alert in alerts:
            if can_manage(role) or normalized in {"AUDITOR", "PLATFORM_ADMIN"}:
                summaries.append(cls.summary(alert, role))
                continue
            recipient = cls._current_recipient(db, alert, user_id)
            if recipient:
                content = cls._project_current_recipient_snapshot(
                    alert, recipient["content_snapshot"], role
                )
                summaries.append(cls.summary(alert, role, content=content))
        return summaries

    @classmethod
    def detail(cls, db: Session, tenant_id: UUID, user_id: UUID, alert_id: UUID) -> dict[str, Any]:
        role = cls.role_for(db, tenant_id, user_id)
        alert = cls.get_alert(db, tenant_id, alert_id)
        normalized = normalize_role(role)
        evidence = None
        delivery_health = None
        if can_manage(role):
            cls.require_alert_permission(db, tenant_id, user_id, "OUTAGE_ALERT:READ", alert)
            content = project_alert(cls._content(alert), role)
            actions = cls._manager_actions(db, tenant_id, user_id, alert)
            projection = projection_type_for_role(role)
            publications = [{"id": str(p.id), "version": p.version, "type": p.publication_type, "published_at": p.published_at, "publisher_id": str(p.published_by_id), "recipient_count": p.recipient_count, "content": project_alert(p.content_snapshot, role)} for p in alert.publications]
        elif normalized == "AUDITOR":
            content = project_alert(cls._content(alert), role)
            content["audiences"] = [
                {
                    "type": audience.audience_type,
                    "scope": (
                        "SELECTED_TEAM" if audience.team_id else
                        "SPECIFIC_USER" if audience.user_id else
                        "TENANT_WIDE" if audience.audience_type == TENANT_WIDE_AUDIENCE else
                        "SERVICE_RELATIONSHIP"
                    ),
                }
                for audience in alert.audiences
            ]
            actions = allowed_actions_for(role, intent=alert.intent, handling=alert.service_agent_handling, has_incident_link=any(link.target_type == "INCIDENT" for link in alert.links))
            projection = projection_type_for_role(role)
            publisher_ids = {publication.published_by_id for publication in alert.publications}
            actor_ids = publisher_ids | {alert.created_by_id, alert.updated_by_id}
            actor_displays = {
                str(user.id): user.email
                for user in db.query(User.id, User.email).filter(
                    User.tenant_id == tenant_id,
                    User.id.in_(actor_ids),
                )
            }
            publications = []
            for publication in alert.publications:
                recipient_summary: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
                for recipient in publication.recipients:
                    recipient_summary[recipient.audience_type][recipient.delivery_status] += 1
                publication_content = project_alert(publication.content_snapshot, role)
                publication_content["audiences"] = [
                    {
                        "type": str(item.get("type") or item.get("audience_type") or "UNKNOWN"),
                        "scope": (
                            "SELECTED_TEAM" if item.get("team_id") else
                            "SPECIFIC_USER" if item.get("user_id") else
                            "TENANT_WIDE" if item.get("type") == TENANT_WIDE_AUDIENCE else
                            "SERVICE_RELATIONSHIP"
                        ),
                    }
                    for item in (publication.content_snapshot.get("audiences") or [])
                    if isinstance(item, dict)
                ]
                publications.append({
                    "id": str(publication.id),
                    "version": publication.version,
                    "type": publication.publication_type,
                    "published_at": publication.published_at,
                    "publisher_id": str(publication.published_by_id),
                    "publisher_display": actor_displays.get(str(publication.published_by_id)),
                    "recipient_count": publication.recipient_count,
                    "audience_snapshot": [
                        {
                            "type": str(item.get("type") or item.get("audience_type") or "UNKNOWN"),
                            "scope": (
                                "SELECTED_TEAM" if item.get("team_id") else
                                "SPECIFIC_USER" if item.get("user_id") else
                                "TENANT_WIDE" if item.get("type") == TENANT_WIDE_AUDIENCE else
                                "SERVICE_RELATIONSHIP"
                            ),
                        }
                        for item in (publication.audience_snapshot or [])
                        if isinstance(item, dict)
                    ],
                    "recipient_resolution": {
                        audience_type: dict(sorted(status_counts.items()))
                        for audience_type, status_counts in sorted(recipient_summary.items())
                    },
                    "delivery_channels": sorted({
                        "IN_APP" for recipient in publication.recipients if recipient.notification_id
                    }),
                    "exclusion_evidence": "NOT_COLLECTED",
                    "content": publication_content,
                })
            audit_events = cls._auditor_audit_events(db, tenant_id, alert.id)
            evidence = {
                "summary": cls._auditor_evidence_status(alert, len(audit_events)),
                "creator_display": actor_displays.get(str(alert.created_by_id)),
                "updated_by_display": actor_displays.get(str(alert.updated_by_id)),
                "audit_events": audit_events,
                "authorization": {
                    "status": "NOT_COLLECTED",
                    "explanation": "The lifecycle action is recorded, but the evaluated permission and scope decision are not stored as separate evidence.",
                },
                "recipient_identities_exposed": False,
            }
        elif normalized == "PLATFORM_ADMIN":
            content = project_alert(cls._content(alert), role)
            actions = allowed_actions_for(role, intent=alert.intent, handling=alert.service_agent_handling, has_incident_link=any(link.target_type == "INCIDENT" for link in alert.links))
            projection = projection_type_for_role(role)
            delivery = cls._delivery_counts(alert)
            publications = []
            recent_errors = []
            for publication in alert.publications:
                recipient_summary = defaultdict(lambda: defaultdict(int))
                failed_recipients = 0
                for recipient in publication.recipients:
                    recipient_summary[recipient.audience_type][recipient.delivery_status] += 1
                    if recipient.delivery_status in {"FAILED", "PERMANENTLY_FAILED"}:
                        failed_recipients += 1
                    if recipient.last_error:
                        recent_errors.append({
                            "version": publication.version,
                            "attempt_count": recipient.attempt_count,
                            "error": recipient.last_error,
                            "status": recipient.delivery_status,
                        })
                publications.append({
                    "id": str(publication.id),
                    "version": publication.version,
                    "type": publication.publication_type,
                    "published_at": publication.published_at,
                    "recipient_count": publication.recipient_count,
                    "failed_count": failed_recipients,
                    "delivery_summary": {
                        st: sum(cnts[st] for cnts in recipient_summary.values())
                        for st in ["AVAILABLE", "QUEUED", "RETRYING", "FAILED", "PERMANENTLY_FAILED"]
                        if sum(cnts[st] for cnts in recipient_summary.values()) > 0
                    },
                    "delivery_channels": sorted({
                        "IN_APP" for recipient in publication.recipients if recipient.notification_id
                    } or ["IN_APP", "PORTAL"]),
                })
            delivery_health = {
                "summary": delivery,
                "total_recipients": sum(p.recipient_count for p in alert.publications),
                "channels": [
                    {"channel": "IN_APP", "status": "OPERATIONAL", "name": "In-App Notifications"},
                    {"channel": "PORTAL", "status": "OPERATIONAL", "name": "Employee Portal Banner"},
                ],
                "recent_errors": recent_errors[:10],
                "publications_diagnostics": publications,
            }
        else:
            current_recipient = cls._current_recipient(db, alert, user_id)
            if not current_recipient:
                raise HTTPException(status_code=404, detail="Alert not found")
            content = cls._project_current_recipient_snapshot(
                alert, current_recipient["content_snapshot"], role
            )
            current_actions = allowed_actions_for(
                role,
                intent=alert.intent,
                handling=alert.service_agent_handling,
                has_incident_link=any(link.target_type == "INCIDENT" for link in alert.links),
            )
            actions = sorted(set(current_recipient["snapshot_actions"]) & set(current_actions))
            projection = projection_type_for_role(role)
            publications = []
            for publication in alert.publications:
                historic = next((row for row in publication.recipients if row.user_id == user_id), None)
                if historic:
                    publications.append({
                        "version": publication.version,
                        "type": publication.publication_type,
                        "published_at": publication.published_at,
                        "content": project_alert(historic.content_snapshot, role),
                    })
        delivery = None
        if can_manage(role) or normalized in {"AUDITOR", "PLATFORM_ADMIN"}:
            delivery = cls._delivery_counts(alert)
        return {
            "id": alert.id, "alert_number": alert.alert_number, "status": alert.status,
            "projection_type": projection, "content": content, "allowed_actions": actions,
            "affected_services": content.get("affected_services", [{"id": str(s.service_id), "name": s.service.name} for s in alert.services if s.service]),
            "links": [] if normalized == "PLATFORM_ADMIN" else (content.get("links", []) if can_manage(role) or normalized == "AUDITOR" else content.get("authorized_links", [])),
            "publications": publications, "delivery_summary": delivery,
            "delivery_health": delivery_health,
            "evidence": evidence,
        }

    @classmethod
    def summary(
        cls,
        alert: ITSMOutageAlert,
        role: str,
        *,
        content: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        content = content if content is not None else project_alert(cls._content(alert), role)
        return {
            "id": alert.id,
            "alert_number": content.get("alert_number", alert.alert_number),
            "title": content.get("title"),
            "alert_type": content.get("alert_type"),
            "severity": content.get("severity"),
            "intent": content.get("intent"),
            "status": content.get("status", alert.status),
            "public_status": content.get("public_status"),
            "affected_services": content.get("affected_services", []),
            "updated_at": content.get("updated_at", alert.updated_at),
            "published_at": content.get("published_at"),
            "latest_publication_at": content.get("latest_publication_at"),
            "recovered_at": content.get("recovered_at"),
        }

    @classmethod
    def acknowledge(cls, db: Session, tenant_id: UUID, user_id: UUID, alert_id: UUID) -> None:
        cls.role_for(db, tenant_id, user_id)
        alert = cls.get_alert(db, tenant_id, alert_id)
        current = cls._current_recipient(db, alert, user_id)
        recipient = db.query(ITSMOutageAlertRecipient).filter(
            ITSMOutageAlertRecipient.tenant_id == tenant_id,
            ITSMOutageAlertRecipient.user_id == user_id,
            ITSMOutageAlertRecipient.publication_id == alert.current_publication_id,
        ).first()
        current_actions = (
            set(current["allowed_actions"]) & set(current["snapshot_actions"])
            if current
            else set()
        )
        if not recipient or "ACKNOWLEDGE" not in current_actions:
            raise HTTPException(status_code=403, detail="Acknowledgement is not permitted")
        if not recipient.acknowledged_at:
            now = datetime.now(timezone.utc)
            recipient.acknowledged_at = now
            recipient.read_at = recipient.read_at or now
            if recipient.notification is not None:
                recipient.notification.read_at = recipient.notification.read_at or now
            cls._audit(db, alert, user_id, "recipient.acknowledged")
            db.commit()

    @staticmethod
    def _audit(db: Session, alert: ITSMOutageAlert, actor_id: UUID, action: str, extra: list[str] | None = None) -> None:
        db.execute(text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"), {"tenant_id": str(alert.tenant_id)})
        append_audit_event(db, {
            "id": str(uuid4()), "tenant_id": str(alert.tenant_id), "timestamp": datetime.now(timezone.utc),
            "actor_id": str(actor_id), "actor_type": "user", "action": f"itsm.outage_alert.{action}",
            "request_id": str(alert.id), "context_id": str(alert.id),
            "event_category": "action", "target_id": str(alert.id),
            "target_type": "outage_alert", "policy_decision": "ALLOW",
            "provider": "itsm", "reason": action,
            "response_status": 200, "frameworks_affected": ["ITIL"],
            "execution_trace": [f"alert_id={alert.id}", f"alert_number={alert.alert_number}", f"status={alert.status}"] + (extra or []),
        })
