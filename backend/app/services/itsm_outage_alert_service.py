"""Domain service and authorization for standalone Outage & Alerts.

No audience resolver, approval workflow, or provider is assumed here.  Public
publication actions deliberately fail closed until those policies are supplied
by an approved product/configuration implementation.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import HTTPException, Request, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.db.models import (
    ITSMMajorIncident,
    ITSMOutageAlert,
    ITSMOutageAlertDelivery,
    ITSMOutageAlertDeliveryAttempt,
    ITSMOutageAlertLink,
    ITSMOutageAlertPublication,
    ITSMOutageAlertService,
    ITSMOutageAlertStateHistory,
    ITSMService,
    ITSMServiceSubscription,
    ITSMTicket,
)
from app.schemas.itsm_outage_alerts import (
    OutageAlertCreateRequest,
    OutageAlertDraftUpdateRequest,
    OutageAlertLinkRequest,
    OutageAlertPublicationRequest,
)
from app.services.audit_store import append_audit_event


FINAL_ITSM_ROLES = {
    "REQUESTER",
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PROBLEM_CHANGE_MANAGER",
    "AUDITOR",
    "PLATFORM_ADMIN",
}

# These aliases preserve existing access records while exposing only the
# finalized six-role Alert policy to callers.
ROLE_ALIASES = {
    "PROCESS_CHANGE_MANAGER": "PROBLEM_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR": "PLATFORM_ADMIN",
    "SERVICE_LEAD": "INCIDENT_MANAGER",
}

OPERATIONAL_ACTIONS = {"CREATE_DRAFT", "UPDATE_DRAFT", "LINK", "PUBLISH", "UPDATE", "RECOVER"}
READ_ROLES = {"REQUESTER", "SERVICE_AGENT", "INCIDENT_MANAGER", "PROBLEM_CHANGE_MANAGER", "AUDITOR"}


@dataclass(frozen=True)
class AlertActor:
    user_id: UUID
    role: str


@dataclass(frozen=True)
class PublicationAuthorization:
    """Input seam for a future approval/audience policy implementation."""

    approved: bool
    audience_policy_ref: str | None = None
    reason: str | None = None


class OutageAlertAuthorization:
    """Action-specific server-side access policy for the finalized six roles."""

    @staticmethod
    def canonical_role(raw_role: str | None) -> str:
        normalized = (raw_role or "").strip().upper()
        return ROLE_ALIASES.get(normalized, normalized)

    @classmethod
    def actor(cls, request: Request, db: Session) -> AlertActor:
        row = db.execute(
            text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
            {"tenant_id": str(request.state.tenant_id), "user_id": str(request.state.user_id)},
        ).first()
        role = cls.canonical_role(str(row.itsm_role) if row else None)
        if not row or not row.has_itsm_access or role not in FINAL_ITSM_ROLES:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden: Outage & Alerts access required")
        return AlertActor(user_id=UUID(str(request.state.user_id)), role=role)

    @classmethod
    def require(cls, request: Request, db: Session, action: str) -> AlertActor:
        actor = cls.actor(request, db)
        if action in OPERATIONAL_ACTIONS:
            if actor.role != "INCIDENT_MANAGER":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden: Incident Manager alert action required")
            return actor
        if action == "READ":
            if actor.role not in READ_ROLES:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden: Alert records are not available for this role")
            return actor
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden: unsupported Alert action")


class OutageAlertService:
    """Persistence and projection service for Outage & Alerts."""

    @staticmethod
    def publication_readiness(alert: ITSMOutageAlert) -> dict[str, Any]:
        if not alert.audience_policy_ref:
            return {
                "ready": False,
                "publication_policy": "PENDING",
                "delivery": "PENDING_CONFIGURATION",
                "detail": "Publishing is pending the approved audience and publication-approval policy.",
            }
        return {
            "ready": False,
            "publication_policy": "PENDING",
            "delivery": "PENDING_CONFIGURATION",
            "detail": "The referenced audience policy has no approved resolver or delivery channel configured.",
        }

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @classmethod
    def _alert(cls, db: Session, tenant_id: UUID, alert_id: UUID) -> ITSMOutageAlert:
        alert = db.query(ITSMOutageAlert).filter(
            ITSMOutageAlert.tenant_id == tenant_id,
            ITSMOutageAlert.id == alert_id,
        ).first()
        if not alert:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outage Alert not found")
        return alert

    @classmethod
    def _validate_services(cls, db: Session, tenant_id: UUID, service_ids: list[UUID]) -> list[ITSMService]:
        unique_ids = list(dict.fromkeys(service_ids))
        if not unique_ids:
            return []
        services = db.query(ITSMService).filter(
            ITSMService.tenant_id == tenant_id,
            ITSMService.id.in_(unique_ids),
        ).all()
        if len(services) != len(unique_ids):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Affected services must belong to the active tenant")
        return services

    @classmethod
    def _add_history(
        cls,
        db: Session,
        *,
        tenant_id: UUID,
        alert_id: UUID,
        from_state: str | None,
        to_state: str,
        action: str,
        actor_id: UUID,
        correlation_id: UUID,
        metadata: dict[str, Any] | None = None,
    ) -> ITSMOutageAlertStateHistory:
        history = ITSMOutageAlertStateHistory(
            tenant_id=tenant_id,
            alert_id=alert_id,
            from_state=from_state,
            to_state=to_state,
            action=action,
            actor_id=actor_id,
            correlation_id=correlation_id,
            event_metadata=metadata or {},
            occurred_at=cls._now(),
        )
        db.add(history)
        return history

    @staticmethod
    def _audit(
        db: Session,
        *,
        tenant_id: UUID,
        actor_id: UUID,
        action: str,
        alert_id: UUID,
        correlation_id: UUID,
        reason: str = "",
    ) -> None:
        # Audit-chain append validates the transaction-local tenant GUC. Bind
        # it explicitly, as the Incident service does, instead of relying on
        # a previous authentication function call remaining in this session.
        db.execute(
            text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
            {"tenant_id": str(tenant_id)},
        )
        append_audit_event(
            db,
            {
                "id": uuid4(),
                "tenant_id": str(tenant_id),
                "actor_id": str(actor_id),
                "actor_type": "USER",
                "action": action,
                "request_id": str(correlation_id),
                "reason": reason,
                "timestamp": datetime.now(timezone.utc),
                "idempotency_key": f"outage-alert:{alert_id}:{action}:{correlation_id}",
                "execution_trace": [{"alert_id": str(alert_id), "correlation_id": str(correlation_id)}],
            },
        )

    @classmethod
    def _commit(cls, db: Session) -> None:
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise

    @classmethod
    def create_draft(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        payload: OutageAlertCreateRequest,
    ) -> ITSMOutageAlert:
        services = cls._validate_services(db, tenant_id, payload.affected_service_ids)
        alert = ITSMOutageAlert(
            tenant_id=tenant_id,
            title=payload.title.strip(),
            draft_message=payload.draft_message.strip(),
            status="DRAFT",
            created_by_id=actor_id,
        )
        correlation_id = uuid4()
        db.add(alert)
        db.flush()
        for service in services:
            db.add(ITSMOutageAlertService(tenant_id=tenant_id, alert_id=alert.id, service_id=service.id))
        cls._add_history(
            db,
            tenant_id=tenant_id,
            alert_id=alert.id,
            from_state=None,
            to_state="DRAFT",
            action="DRAFT_CREATED",
            actor_id=actor_id,
            correlation_id=correlation_id,
        )
        cls._audit(db, tenant_id=tenant_id, actor_id=actor_id, action="outage_alert_draft_created", alert_id=alert.id, correlation_id=correlation_id)
        cls._commit(db)
        db.refresh(alert)
        return alert

    @classmethod
    def update_draft(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        alert_id: UUID,
        payload: OutageAlertDraftUpdateRequest,
    ) -> ITSMOutageAlert:
        alert = cls._alert(db, tenant_id, alert_id)
        if alert.status != "DRAFT":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft Alerts can be edited")
        changed = payload.model_dump(exclude_unset=True)
        if not changed:
            return alert
        if "title" in changed:
            alert.title = changed["title"].strip()
        if "draft_message" in changed:
            alert.draft_message = changed["draft_message"].strip()
        if "affected_service_ids" in changed:
            services = cls._validate_services(db, tenant_id, changed["affected_service_ids"])
            db.query(ITSMOutageAlertService).filter(
                ITSMOutageAlertService.tenant_id == tenant_id,
                ITSMOutageAlertService.alert_id == alert.id,
            ).delete(synchronize_session=False)
            for service in services:
                db.add(ITSMOutageAlertService(tenant_id=tenant_id, alert_id=alert.id, service_id=service.id))
        alert.updated_at = cls._now()
        correlation_id = uuid4()
        cls._add_history(
            db,
            tenant_id=tenant_id,
            alert_id=alert.id,
            from_state="DRAFT",
            to_state="DRAFT",
            action="DRAFT_UPDATED",
            actor_id=actor_id,
            correlation_id=correlation_id,
            metadata={"fields": sorted(changed.keys())},
        )
        cls._audit(db, tenant_id=tenant_id, actor_id=actor_id, action="outage_alert_draft_updated", alert_id=alert.id, correlation_id=correlation_id)
        cls._commit(db)
        db.refresh(alert)
        return alert

    @classmethod
    def link(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        alert_id: UUID,
        payload: OutageAlertLinkRequest,
    ) -> ITSMOutageAlertLink:
        alert = cls._alert(db, tenant_id, alert_id)
        # The foundation can store many links, but product has not chosen that
        # behavior.  Prevent a second link rather than silently defining it.
        if db.query(ITSMOutageAlertLink).filter(
            ITSMOutageAlertLink.tenant_id == tenant_id,
            ITSMOutageAlertLink.alert_id == alert.id,
        ).first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Additional Alert links require the pending link-cardinality policy")

        kwargs: dict[str, Any] = {}
        if payload.target_type == "INCIDENT":
            incident = db.query(ITSMTicket).filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.id == payload.target_id,
                ITSMTicket.ticket_type == "INCIDENT",
            ).first()
            if not incident:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Linked Incident must belong to the active tenant")
            kwargs["incident_id"] = incident.id
        else:
            major = db.query(ITSMMajorIncident).filter(
                ITSMMajorIncident.tenant_id == tenant_id,
                ITSMMajorIncident.id == payload.target_id,
            ).first()
            if not major:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Linked Major Incident must belong to the active tenant")
            kwargs["major_incident_id"] = major.id

        correlation_id = uuid4()
        link = ITSMOutageAlertLink(
            tenant_id=tenant_id,
            alert_id=alert.id,
            linked_by_id=actor_id,
            correlation_id=correlation_id,
            **kwargs,
        )
        db.add(link)
        cls._add_history(
            db,
            tenant_id=tenant_id,
            alert_id=alert.id,
            from_state=alert.status,
            to_state=alert.status,
            action="RECORD_LINKED",
            actor_id=actor_id,
            correlation_id=correlation_id,
            metadata={"target_type": payload.target_type, "target_id": str(payload.target_id)},
        )
        cls._audit(db, tenant_id=tenant_id, actor_id=actor_id, action="outage_alert_linked", alert_id=alert.id, correlation_id=correlation_id, reason=payload.target_type)
        cls._commit(db)
        db.refresh(link)
        return link

    @classmethod
    def require_publication_readiness(cls, alert: ITSMOutageAlert) -> None:
        readiness = cls.publication_readiness(alert)
        if not readiness["ready"]:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=readiness["detail"])

    @classmethod
    def publish_after_verified_policy(
        cls,
        db: Session,
        *,
        tenant_id: UUID,
        actor_id: UUID,
        alert_id: UUID,
        payload: OutageAlertPublicationRequest,
        publication_type: Literal["INITIAL", "UPDATE", "RECOVERY"],
        authorization: PublicationAuthorization,
    ) -> ITSMOutageAlert:
        """Persist a publication only after a future policy resolver approves it.

        This public service seam is intentionally separate from the HTTP route:
        it lets the future approval/audience implementation authorize a single,
        atomic state + immutable-publication transaction without changing the
        Alert aggregate.
        """
        if not authorization.approved or not authorization.audience_policy_ref:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=authorization.reason or "Publishing requires an approved audience and publication policy",
            )
        alert = cls._alert(db, tenant_id, alert_id)
        expected_state = {"INITIAL": "DRAFT", "UPDATE": "ACTIVE", "RECOVERY": "ACTIVE"}[publication_type]
        if alert.status != expected_state:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot publish {publication_type.lower()} while Alert is {alert.status}")

        correlation_id = uuid4()
        next_sequence = int(
            db.query(func.coalesce(func.max(ITSMOutageAlertPublication.sequence_number), 0)).filter(
                ITSMOutageAlertPublication.tenant_id == tenant_id,
                ITSMOutageAlertPublication.alert_id == alert.id,
            ).scalar()
        ) + 1
        publication = ITSMOutageAlertPublication(
            tenant_id=tenant_id,
            alert_id=alert.id,
            sequence_number=next_sequence,
            publication_type=publication_type,
            message=payload.message.strip(),
            audience_policy_ref=authorization.audience_policy_ref,
            published_by_id=actor_id,
            correlation_id=correlation_id,
            published_at=cls._now(),
        )
        db.add(publication)
        db.flush()

        from_state = alert.status
        if publication_type == "INITIAL":
            alert.status = "ACTIVE"
            alert.activated_at = cls._now()
            history_action = "PUBLISHED_INITIAL"
        elif publication_type == "RECOVERY":
            # Option A: recovery message and recovered state share this one
            # transaction. A linked ticket state is intentionally irrelevant.
            alert.status = "RECOVERED"
            alert.recovered_at = cls._now()
            history_action = "PUBLISHED_RECOVERY"
        else:
            history_action = "PUBLISHED_UPDATE"
        alert.audience_policy_ref = authorization.audience_policy_ref
        alert.last_published_at = cls._now()
        alert.updated_at = cls._now()
        cls._add_history(
            db,
            tenant_id=tenant_id,
            alert_id=alert.id,
            from_state=from_state,
            to_state=alert.status,
            action=history_action,
            actor_id=actor_id,
            correlation_id=correlation_id,
            metadata={"publication_id": str(publication.id), "sequence_number": next_sequence},
        )
        cls.create_delivery_intent(
            db,
            tenant_id=tenant_id,
            publication_id=publication.id,
            idempotency_key=payload.idempotency_key or f"outage-alert:{alert.id}:publication:{publication.id}",
            correlation_id=correlation_id,
        )
        action = {
            "INITIAL": "outage_alert_published",
            "UPDATE": "outage_alert_updated",
            "RECOVERY": "outage_alert_recovered",
        }[publication_type]
        cls._audit(db, tenant_id=tenant_id, actor_id=actor_id, action=action, alert_id=alert.id, correlation_id=correlation_id)
        cls._commit(db)
        db.refresh(alert)
        return alert

    @staticmethod
    def create_delivery_intent(
        db: Session,
        *,
        tenant_id: UUID,
        publication_id: UUID,
        idempotency_key: str,
        correlation_id: UUID,
    ) -> ITSMOutageAlertDelivery:
        existing = db.query(ITSMOutageAlertDelivery).filter(
            ITSMOutageAlertDelivery.tenant_id == tenant_id,
            ITSMOutageAlertDelivery.idempotency_key == idempotency_key,
        ).first()
        if existing:
            return existing
        delivery = ITSMOutageAlertDelivery(
            tenant_id=tenant_id,
            publication_id=publication_id,
            channel_ref=None,
            status="PENDING_CONFIGURATION",
            idempotency_key=idempotency_key,
            correlation_id=correlation_id,
        )
        db.add(delivery)
        return delivery

    @classmethod
    def record_delivery_attempt(
        cls,
        db: Session,
        *,
        tenant_id: UUID,
        delivery_id: UUID,
        attempt_status: Literal["QUEUED", "SENT", "FAILED"],
        provider_reference: str | None = None,
        error_detail: str | None = None,
    ) -> ITSMOutageAlertDeliveryAttempt:
        """Provider worker seam; no provider calls are made by this service."""
        delivery = db.query(ITSMOutageAlertDelivery).filter(
            ITSMOutageAlertDelivery.tenant_id == tenant_id,
            ITSMOutageAlertDelivery.id == delivery_id,
        ).first()
        if not delivery:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert delivery intent not found")
        next_attempt = int(
            db.query(func.coalesce(func.max(ITSMOutageAlertDeliveryAttempt.attempt_number), 0)).filter(
                ITSMOutageAlertDeliveryAttempt.tenant_id == tenant_id,
                ITSMOutageAlertDeliveryAttempt.delivery_id == delivery.id,
            ).scalar()
        ) + 1
        attempt = ITSMOutageAlertDeliveryAttempt(
            tenant_id=tenant_id,
            delivery_id=delivery.id,
            attempt_number=next_attempt,
            status=attempt_status,
            provider_reference=provider_reference,
            error_detail=error_detail,
            correlation_id=delivery.correlation_id,
        )
        delivery.status = attempt_status
        delivery.updated_at = cls._now()
        db.add(attempt)
        return attempt

    @classmethod
    def _is_audience(cls, db: Session, tenant_id: UUID, user_id: UUID, alert_id: UUID) -> bool:
        return db.query(ITSMServiceSubscription).join(
            ITSMOutageAlertService,
            (ITSMOutageAlertService.service_id == ITSMServiceSubscription.service_id)
            & (ITSMOutageAlertService.tenant_id == ITSMServiceSubscription.tenant_id),
        ).filter(
            ITSMServiceSubscription.tenant_id == tenant_id,
            ITSMServiceSubscription.user_id == user_id,
            ITSMServiceSubscription.is_active.is_(True),
            ITSMOutageAlertService.alert_id == alert_id,
        ).first() is not None

    @classmethod
    def list_alerts(cls, db: Session, tenant_id: UUID, actor: AlertActor, state: str | None = None) -> tuple[list[dict[str, Any]], str | None]:
        query = db.query(ITSMOutageAlert).filter(ITSMOutageAlert.tenant_id == tenant_id)
        if state:
            normalized = state.strip().upper()
            if normalized not in {"DRAFT", "ACTIVE", "RECOVERED"}:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported Alert state")
            query = query.filter(ITSMOutageAlert.status == normalized)
        
        if actor.role not in {"INCIDENT_MANAGER", "AUDITOR"}:
            query = query.filter(ITSMOutageAlert.status != "DRAFT")
            query = query.join(
                ITSMOutageAlertService,
                (ITSMOutageAlertService.alert_id == ITSMOutageAlert.id)
                & (ITSMOutageAlertService.tenant_id == ITSMOutageAlert.tenant_id),
            ).join(
                ITSMServiceSubscription,
                (ITSMServiceSubscription.service_id == ITSMOutageAlertService.service_id)
                & (ITSMServiceSubscription.tenant_id == ITSMOutageAlertService.tenant_id),
            ).filter(
                ITSMServiceSubscription.user_id == actor.user_id,
                ITSMServiceSubscription.is_active.is_(True),
            ).distinct()

        alerts = query.order_by(ITSMOutageAlert.created_at.desc(), ITSMOutageAlert.id.desc()).all()
        return [cls.project(db, tenant_id, alert, actor.role) for alert in alerts], None

    @classmethod
    def get_alert(cls, db: Session, tenant_id: UUID, alert_id: UUID, actor: AlertActor) -> dict[str, Any]:
        alert = cls._alert(db, tenant_id, alert_id)
        if actor.role in {"INCIDENT_MANAGER", "AUDITOR"}:
            return cls.project(db, tenant_id, alert, actor.role)
        
        if alert.status == "DRAFT" or not cls._is_audience(db, tenant_id, actor.user_id, alert.id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outage Alert not available in this audience")
            
        return cls.project(db, tenant_id, alert, actor.role)

    @classmethod
    def project(cls, db: Session, tenant_id: UUID, alert: ITSMOutageAlert, role: str) -> dict[str, Any]:
        services = db.query(ITSMService).join(
            ITSMOutageAlertService,
            (ITSMOutageAlertService.service_id == ITSMService.id)
            & (ITSMOutageAlertService.tenant_id == ITSMService.tenant_id),
        ).filter(
            ITSMOutageAlertService.tenant_id == tenant_id,
            ITSMOutageAlertService.alert_id == alert.id,
            ITSMService.tenant_id == tenant_id,
        ).order_by(ITSMService.name.asc()).all()
        publications = db.query(ITSMOutageAlertPublication).filter(
            ITSMOutageAlertPublication.tenant_id == tenant_id,
            ITSMOutageAlertPublication.alert_id == alert.id,
        ).order_by(ITSMOutageAlertPublication.sequence_number.asc()).all()
        latest = publications[-1] if publications else None
        base = {
            "id": alert.id,
            "title": alert.title,
            "status": alert.status,
            "affected_services": [{"id": service.id, "name": service.name, "slug": service.slug} for service in services],
            "latest_publication": cls._publication_dict(latest) if latest else None,
            "activated_at": alert.activated_at,
            "recovered_at": alert.recovered_at,
            "created_at": alert.created_at,
            "updated_at": alert.updated_at,
        }

        if role == "REQUESTER":
            base["publications"] = [cls._publication_dict(publication) for publication in publications]
            return base

        links = db.query(ITSMOutageAlertLink).filter(
            ITSMOutageAlertLink.tenant_id == tenant_id,
            ITSMOutageAlertLink.alert_id == alert.id,
        ).order_by(ITSMOutageAlertLink.created_at.asc()).all()

        if role == "SERVICE_AGENT":
            base.update({
                "publications": [cls._publication_dict(publication) for publication in publications],
                "links": [cls._link_dict(link) for link in links],
            })
            return base

        history = db.query(ITSMOutageAlertStateHistory).filter(
            ITSMOutageAlertStateHistory.tenant_id == tenant_id,
            ITSMOutageAlertStateHistory.alert_id == alert.id,
        ).order_by(ITSMOutageAlertStateHistory.occurred_at.asc()).all()

        if role == "PROBLEM_CHANGE_MANAGER":
            base.update({
                "publications": [cls._publication_dict(publication) for publication in publications],
                "links": [cls._link_dict(link) for link in links],
                "state_history": [cls._history_dict(item) for item in history],
            })
            return base

        deliveries = db.query(ITSMOutageAlertDelivery).join(
            ITSMOutageAlertPublication,
            (ITSMOutageAlertPublication.id == ITSMOutageAlertDelivery.publication_id)
            & (ITSMOutageAlertPublication.tenant_id == ITSMOutageAlertDelivery.tenant_id),
        ).filter(
            ITSMOutageAlertDelivery.tenant_id == tenant_id,
            ITSMOutageAlertPublication.alert_id == alert.id,
        ).order_by(ITSMOutageAlertDelivery.created_at.asc()).all()

        base.update(
            {
                "draft_message": alert.draft_message,
                "audience_policy_ref": alert.audience_policy_ref,
                "created_by_id": alert.created_by_id,
                "readiness": cls.publication_readiness(alert),
                "links": [cls._link_dict(link) for link in links],
                "publications": [cls._publication_dict(publication) for publication in publications],
                "state_history": [cls._history_dict(item) for item in history],
                "deliveries": [cls._delivery_dict(db, tenant_id, delivery) for delivery in deliveries],
            }
        )
        return base

    @staticmethod
    def _publication_dict(publication: ITSMOutageAlertPublication) -> dict[str, Any]:
        return {
            "id": publication.id,
            "sequence_number": publication.sequence_number,
            "publication_type": publication.publication_type,
            "message": publication.message,
            "audience_policy_ref": publication.audience_policy_ref,
            "published_by_id": publication.published_by_id,
            "correlation_id": publication.correlation_id,
            "published_at": publication.published_at,
        }

    @staticmethod
    def _history_dict(item: ITSMOutageAlertStateHistory) -> dict[str, Any]:
        return {
            "id": item.id,
            "from_state": item.from_state,
            "to_state": item.to_state,
            "action": item.action,
            "actor_id": item.actor_id,
            "correlation_id": item.correlation_id,
            "metadata": item.event_metadata or {},
            "occurred_at": item.occurred_at,
        }

    @staticmethod
    def _link_dict(link: ITSMOutageAlertLink) -> dict[str, Any]:
        return {
            "id": link.id,
            "incident_id": link.incident_id,
            "major_incident_id": link.major_incident_id,
            "linked_by_id": link.linked_by_id,
            "correlation_id": link.correlation_id,
            "created_at": link.created_at,
        }

    @classmethod
    def _delivery_dict(cls, db: Session, tenant_id: UUID, delivery: ITSMOutageAlertDelivery) -> dict[str, Any]:
        attempts = db.query(ITSMOutageAlertDeliveryAttempt).filter(
            ITSMOutageAlertDeliveryAttempt.tenant_id == tenant_id,
            ITSMOutageAlertDeliveryAttempt.delivery_id == delivery.id,
        ).order_by(ITSMOutageAlertDeliveryAttempt.attempt_number.asc()).all()
        return {
            "id": delivery.id,
            "publication_id": delivery.publication_id,
            "channel_ref": delivery.channel_ref,
            "status": delivery.status,
            "idempotency_key": delivery.idempotency_key,
            "correlation_id": delivery.correlation_id,
            "created_at": delivery.created_at,
            "updated_at": delivery.updated_at,
            "attempts": [
                {
                    "id": attempt.id,
                    "attempt_number": attempt.attempt_number,
                    "status": attempt.status,
                    "provider_reference": attempt.provider_reference,
                    "error_detail": attempt.error_detail,
                    "correlation_id": attempt.correlation_id,
                    "attempted_at": attempt.attempted_at,
                }
                for attempt in attempts
            ],
        }

    @classmethod
    def linkable_records(cls, db: Session, tenant_id: UUID) -> dict[str, Any]:
        incidents = db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
        ).order_by(ITSMTicket.created_at.desc(), ITSMTicket.id.desc()).limit(100).all()
        majors = db.query(ITSMMajorIncident, ITSMTicket).join(
            ITSMTicket,
            (ITSMTicket.id == ITSMMajorIncident.ticket_id)
            & (ITSMTicket.tenant_id == ITSMMajorIncident.tenant_id),
        ).filter(ITSMMajorIncident.tenant_id == tenant_id).order_by(
            ITSMMajorIncident.declared_at.desc(), ITSMMajorIncident.id.desc()
        ).limit(100).all()
        return {
            "incidents": [
                {"id": incident.id, "ticket_number": incident.ticket_number, "title": incident.title, "status": incident.status}
                for incident in incidents
            ],
            "major_incidents": [
                {
                    "id": major.id,
                    "ticket_id": ticket.id,
                    "ticket_number": ticket.ticket_number,
                    "title": ticket.title,
                    "declared_at": major.declared_at,
                }
                for major, ticket in majors
            ],
        }

    @classmethod
    def related_major_incident_alerts(cls, db: Session, tenant_id: UUID, major_incident_id: UUID) -> list[dict[str, Any]]:
        links = db.query(ITSMOutageAlertLink).filter(
            ITSMOutageAlertLink.tenant_id == tenant_id,
            ITSMOutageAlertLink.major_incident_id == major_incident_id,
        ).order_by(ITSMOutageAlertLink.created_at.desc()).all()
        return [cls.project(db, tenant_id, cls._alert(db, tenant_id, link.alert_id), "INCIDENT_MANAGER") for link in links]
