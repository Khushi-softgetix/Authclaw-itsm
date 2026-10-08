"""Domain and database service for ITSM Incident Management."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import logging
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import case, false, func, inspect, or_, text
from sqlalchemy.orm import Session, joinedload

from app.db.models import (
    ITSMConfigurationItem,
    ITSMService,
    ITSMTeam,
    ITSMTeamMember,
    ITSMMajorIncident,
    ITSMSLAPolicy,
    ITSMTicket,
    ITSMTicketActivity,
    ITSMTicketCategory,
    ITSMTicketCounter,
    ITSMUserAccess,
    Notification,
    User,
)
from app.schemas.itsm_incidents import (
    IncidentActivityCreateRequest,
    IncidentAssignRequest,
    IncidentCreateRequest,
    IncidentStatusUpdateRequest,
    IncidentUpdateRequest,
    MajorIncidentDeclareRequest,
    MajorIncidentUpdateRequest,
    MajorIncidentCommunication,
    IncidentSavedViewCreateRequest,
    VALID_IMPACTS,
    VALID_PRIORITIES,
    VALID_STATUSES,
    VALID_URGENCIES,
)
from app.services.audit_store import append_audit_event
from app.services.itsm_sla_service import apply_sla_policy, pause_sla, resume_sla
from app.services.notifications import create_notification

logger = logging.getLogger("authclaw.itsm.incidents")

# Approved Phase 3 Lifecycle Transition Matrix
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "NEW": {"ASSIGNED", "IN_PROGRESS", "CANCELLED"},
    "ASSIGNED": {"IN_PROGRESS", "CANCELLED"},
    "IN_PROGRESS": {"PENDING", "RESOLVED", "CANCELLED"},
    "PENDING": {"IN_PROGRESS", "RESOLVED", "CANCELLED"},
    "RESOLVED": {"CLOSED", "IN_PROGRESS"},
    "CLOSED": set(),       # Terminal
    "CANCELLED": set(),    # Terminal
}

PRIORITY_NORMALIZATION: dict[str, str] = {
    "P1": "P1",
    "P1_CRITICAL": "P1",
    "P2": "P2",
    "P2_HIGH": "P2",
    "P3": "P3",
    "P3_MEDIUM": "P3",
    "P4": "P4",
    "P4_LOW": "P4",
}


def normalize_priority(raw: str | None) -> str:
    if not raw:
        return "P3"
    cleaned = raw.strip().upper()
    if cleaned in PRIORITY_NORMALIZATION:
        return PRIORITY_NORMALIZATION[cleaned]
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Invalid priority '{raw}'. Valid values: P1, P2, P3, P4",
    )


def calculate_priority_from_matrix(impact: str, urgency: str) -> str:
    imp = impact.strip().upper()
    urg = urgency.strip().upper()
    if imp not in VALID_IMPACTS or urg not in VALID_URGENCIES:
        return "P3"

    if imp == "CRITICAL" or (imp == "HIGH" and urg in {"HIGH", "CRITICAL"}):
        return "P1"
    if (imp == "HIGH" and urg == "MEDIUM") or (imp == "MEDIUM" and urg in {"HIGH", "CRITICAL"}):
        return "P2"
    if (imp == "MEDIUM" and urg == "MEDIUM") or (imp == "HIGH" and urg == "LOW") or (imp == "LOW" and urg in {"HIGH", "CRITICAL"}):
        return "P3"
    return "P4"


class IncidentService:
    @staticmethod
    def _find_sla_policy(
        db: Session,
        tenant_id: UUID,
        priority: str,
        service_id: UUID | None,
        ticket_type: str = "INCIDENT",
    ) -> ITSMSLAPolicy | None:
        norm_ticket_type = (ticket_type or "INCIDENT").strip().upper()
        query = db.query(ITSMSLAPolicy).filter(
            ITSMSLAPolicy.tenant_id == tenant_id,
            ITSMSLAPolicy.ticket_type == norm_ticket_type,
            ITSMSLAPolicy.priority == priority,
            ITSMSLAPolicy.is_active.is_(True),
        )
        if service_id:
            query = query.filter(or_(ITSMSLAPolicy.service_id == service_id, ITSMSLAPolicy.service_id.is_(None)))
            query = query.order_by(case((ITSMSLAPolicy.service_id == service_id, 0), else_=1))
        else:
            query = query.filter(ITSMSLAPolicy.service_id.is_(None))
        policy = query.first()

        # Fallback for SERVICE_REQUEST if no dedicated policy exists: try active INCIDENT policy
        if not policy and norm_ticket_type != "INCIDENT":
            fallback_query = db.query(ITSMSLAPolicy).filter(
                ITSMSLAPolicy.tenant_id == tenant_id,
                ITSMSLAPolicy.ticket_type == "INCIDENT",
                ITSMSLAPolicy.priority == priority,
                ITSMSLAPolicy.is_active.is_(True),
            )
            if service_id:
                fallback_query = fallback_query.filter(or_(ITSMSLAPolicy.service_id == service_id, ITSMSLAPolicy.service_id.is_(None)))
                fallback_query = fallback_query.order_by(case((ITSMSLAPolicy.service_id == service_id, 0), else_=1))
            else:
                fallback_query = fallback_query.filter(ITSMSLAPolicy.service_id.is_(None))
            policy = fallback_query.first()

        # Fallback if service_id was None but tenant only has service-specific policies
        if not policy and service_id is None:
            any_policy_query = db.query(ITSMSLAPolicy).filter(
                ITSMSLAPolicy.tenant_id == tenant_id,
                ITSMSLAPolicy.ticket_type == norm_ticket_type,
                ITSMSLAPolicy.priority == priority,
                ITSMSLAPolicy.is_active.is_(True),
            ).order_by(ITSMSLAPolicy.created_at.asc())
            policy = any_policy_query.first()

            if not policy and norm_ticket_type != "INCIDENT":
                any_incident_query = db.query(ITSMSLAPolicy).filter(
                    ITSMSLAPolicy.tenant_id == tenant_id,
                    ITSMSLAPolicy.ticket_type == "INCIDENT",
                    ITSMSLAPolicy.priority == priority,
                    ITSMSLAPolicy.is_active.is_(True),
                ).order_by(ITSMSLAPolicy.created_at.asc())
                policy = any_incident_query.first()

        return policy

    @staticmethod
    def list_saved_views(db: Session, tenant_id: UUID, user_id: UUID) -> list:
        return []

    @staticmethod
    def create_saved_view(db: Session, tenant_id: UUID, user_id: UUID, payload: IncidentSavedViewCreateRequest):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Incident saved views are not supported without migration 057",
        )

    @staticmethod
    def delete_saved_view(db: Session, tenant_id: UUID, user_id: UUID, view_id: UUID) -> None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Saved view not found",
        )
    @classmethod
    def _validate_major_command_users(
        cls,
        db: Session,
        tenant_id: UUID,
        payload: MajorIncidentDeclareRequest | MajorIncidentUpdateRequest,
    ) -> None:
        users: list[tuple[UUID, str]] = []
        if payload.incident_commander_id:
            users.append((payload.incident_commander_id, "Incident commander"))
        if payload.communication_lead_id:
            users.append((payload.communication_lead_id, "Communication lead"))
        for checkpoint in payload.restoration_checkpoints:
            if checkpoint.owner_id:
                users.append((checkpoint.owner_id, "Restoration checkpoint owner"))
        for decision in payload.command_decisions:
            if decision.owner_id:
                users.append((decision.owner_id, "Command decision owner"))
        for task in payload.command_tasks:
            if task.owner_id:
                users.append((task.owner_id, "Command task owner"))
        for communication in payload.command_communications:
            if communication.approver_id:
                users.append((communication.approver_id, "Communication approver"))
        for user_id, label in users:
            cls._validate_major_command_user(db, tenant_id, user_id, label)
        for service_id in payload.affected_service_ids:
            cls._validate_service_in_tenant(db, tenant_id, service_id)
        for configuration_item_id in payload.affected_configuration_item_ids:
            cls._validate_configuration_item_in_tenant(
                db,
                tenant_id,
                configuration_item_id,
            )

    @staticmethod
    def _validate_major_command_user(
        db: Session,
        tenant_id: UUID,
        user_id: UUID,
        role_context: str,
    ) -> User:
        user = (
            db.query(User)
            .join(
                ITSMUserAccess,
                (ITSMUserAccess.user_id == User.id)
                & (ITSMUserAccess.tenant_id == User.tenant_id),
            )
            .filter(
                User.id == user_id,
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
                ITSMUserAccess.has_itsm_access.is_(True),
            )
            .first()
        )
        if role_context in {"Incident commander", "Communication approver"}:
            access = db.query(ITSMUserAccess).filter(
                ITSMUserAccess.tenant_id == tenant_id,
                ITSMUserAccess.user_id == user_id,
                ITSMUserAccess.itsm_role == "INCIDENT_MANAGER",
                ITSMUserAccess.has_itsm_access.is_(True),
            ).first()
            if not access:
                raise HTTPException(status_code=400, detail=f"{role_context} must be an Incident Manager in this tenant")
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{role_context} must be an active ITSM user in this tenant",
            )
        return user

    @staticmethod
    def _validate_assignee_in_tenant(db: Session, tenant_id: UUID, user_id: UUID) -> User:
        user = (
            db.query(User)
            .join(
                ITSMUserAccess,
                (ITSMUserAccess.user_id == User.id)
                & (ITSMUserAccess.tenant_id == User.tenant_id),
            )
            .filter(
                User.id == user_id,
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
                ITSMUserAccess.has_itsm_access.is_(True),
            )
            .first()
        )
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid Assignee: User does not exist, is inactive, lacks ITSM access, or does not belong to this tenant",
            )
        return user

    @classmethod
    def list_major_command_participants(
        cls,
        db: Session,
        tenant_id: UUID,
        commanders_only: bool = False,
    ) -> list[User]:
        """Return only active, ITSM-enabled users from the authenticated tenant."""
        query = (
            db.query(User)
            .join(
                ITSMUserAccess,
                (ITSMUserAccess.user_id == User.id)
                & (ITSMUserAccess.tenant_id == User.tenant_id),
            )
            .filter(
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
                ITSMUserAccess.has_itsm_access.is_(True),
            )
            .order_by(User.email.asc())
        )
        if commanders_only:
            query = query.filter(ITSMUserAccess.itsm_role == "INCIDENT_MANAGER")
        return query.all()

    @classmethod
    def get_incident_reference_data(cls, db: Session, tenant_id: UUID) -> dict[str, Any]:
        """Return tenant-scoped, active reference data used for incident coordination."""
        users = cls.list_major_command_participants(db, tenant_id)
        teams = []
        if inspect(db.get_bind()).has_table("itsm_teams", schema="public"):
            teams = (
                db.query(ITSMTeam)
                .filter(ITSMTeam.tenant_id == tenant_id, ITSMTeam.is_active.is_(True))
                .order_by(ITSMTeam.name.asc())
                .all()
            )
        services = (
            db.query(ITSMService)
            .filter(ITSMService.tenant_id == tenant_id)
            .order_by(ITSMService.name.asc())
            .all()
        )
        configuration_items = (
            db.query(ITSMConfigurationItem)
            .filter(
                ITSMConfigurationItem.tenant_id == tenant_id,
                ITSMConfigurationItem.status == "ACTIVE",
            )
            .order_by(ITSMConfigurationItem.name.asc())
            .all()
        )
        categories = (
            db.query(ITSMTicketCategory)
            .filter(
                ITSMTicketCategory.tenant_id == tenant_id,
                ITSMTicketCategory.is_active.is_(True),
            )
            .order_by(ITSMTicketCategory.display_order.asc(), ITSMTicketCategory.name.asc())
            .all()
        )
        return {
            "users": [{"id": user.id, "email": user.email} for user in users],
            "commanders": [{"id": user.id, "email": user.email} for user in cls.list_major_command_participants(db, tenant_id, commanders_only=True)],
            "teams": [{"id": team.id, "name": team.name} for team in teams],
            "services": [
                {"id": service.id, "name": service.name, "status": service.status}
                for service in services
            ],
            "configuration_items": [
                {
                    "id": item.id,
                    "name": item.name,
                    "service_id": item.service_id,
                    "status": item.status,
                }
                for item in configuration_items
            ],
            "categories": [
                {
                    "id": category.id,
                    "name": category.name,
                    "code": category.code,
                    "parent_id": category.parent_category_id,
                }
                for category in categories
            ],
        }

    @staticmethod
    def generate_ticket_number(
        db: Session,
        tenant_id: UUID,
        ticket_type: str = "INCIDENT",
        prefix: str | None = None,
    ) -> str:
        """Concurrency-safe atomic sequence generation per tenant using itsm_ticket_counters."""
        if prefix:
            default_prefix = prefix
        elif ticket_type == "PROBLEM":
            default_prefix = "PRB"
        elif ticket_type == "INCIDENT":
            default_prefix = "INC"
        else:
            default_prefix = ticket_type[:3]

        # Check existing max ticket number in itsm_tickets to prevent collisions with seeded data
        max_row = db.execute(
            text(
                "SELECT ticket_number FROM public.itsm_tickets "
                "WHERE tenant_id = :tenant_id AND ticket_type = :ticket_type "
                "ORDER BY ticket_number DESC LIMIT 1"
            ),
            {"tenant_id": str(tenant_id), "ticket_type": ticket_type},
        ).fetchone()

        init_num = 0
        if max_row and max_row[0]:
            try:
                init_num = int(str(max_row[0]).split("-")[-1])
            except (ValueError, IndexError):
                init_num = 0

        for _ in range(50):
            query = text(
                """
                INSERT INTO public.itsm_ticket_counters (id, tenant_id, ticket_type, prefix, last_number, updated_at)
                VALUES (gen_random_uuid(), :tenant_id, :ticket_type, :prefix, :init_val, clock_timestamp())
                ON CONFLICT (tenant_id, ticket_type)
                DO UPDATE SET
                    last_number = GREATEST(public.itsm_ticket_counters.last_number, :curr_max) + 1,
                    updated_at = clock_timestamp()
                RETURNING prefix, last_number
                """
            )
            row = db.execute(
                query,
                {
                    "tenant_id": str(tenant_id),
                    "ticket_type": ticket_type,
                    "prefix": default_prefix,
                    "init_val": init_num + 1 if init_num > 0 else 1,
                    "curr_max": init_num,
                },
            ).fetchone()
            if not row:
                raise RuntimeError("Failed to generate ticket number")
            pfx, number = row[0], row[1]
            candidate = f"{pfx}-{number:06d}"

            # Safety check: ensure candidate is truly unique
            exists = db.execute(
                text("SELECT 1 FROM public.itsm_tickets WHERE tenant_id = :tenant_id AND ticket_number = :num"),
                {"tenant_id": str(tenant_id), "num": candidate},
            ).fetchone()
            if not exists:
                return candidate

        raise RuntimeError(f"Failed to generate unique ticket number for {ticket_type}")

    @staticmethod
    def _validate_user_in_tenant(db: Session, tenant_id: UUID, user_id: UUID, role_context: str = "User") -> User:
        user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid {role_context}: User does not exist, is inactive, or does not belong to this tenant",
            )
        return user

    @staticmethod
    def _validate_service_in_tenant(db: Session, tenant_id: UUID, service_id: UUID) -> ITSMService:
        service = db.query(ITSMService).filter(ITSMService.id == service_id, ITSMService.tenant_id == tenant_id).first()
        if not service:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid service_id: Service does not exist in this tenant",
            )
        return service

    @staticmethod
    def _validate_category_in_tenant(db: Session, tenant_id: UUID, category_id: UUID) -> ITSMTicketCategory:
        category = db.query(ITSMTicketCategory).filter(
            ITSMTicketCategory.id == category_id,
            ITSMTicketCategory.tenant_id == tenant_id,
            ITSMTicketCategory.is_active == True,
        ).first()
        if not category:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid category_id: Category does not exist in this tenant",
            )
        return category

    @staticmethod
    def _validate_configuration_item_in_tenant(
        db: Session,
        tenant_id: UUID,
        configuration_item_id: UUID,
        service_id: UUID | None = None,
    ) -> ITSMConfigurationItem:
        item = db.query(ITSMConfigurationItem).filter(
            ITSMConfigurationItem.id == configuration_item_id,
            ITSMConfigurationItem.tenant_id == tenant_id,
            ITSMConfigurationItem.status == "ACTIVE",
        ).first()
        if not item:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid configuration_item_id: Configuration item does not exist or is inactive in this tenant",
            )
        if service_id and item.service_id and item.service_id != service_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Configuration item is not associated with the selected service",
            )
        return item

    @staticmethod
    def _validate_assignment_group(db: Session, tenant_id: UUID, assignment_group: str | None) -> None:
        """Require assignment groups to reference an active team in the current tenant."""
        if not assignment_group:
            return
        if not inspect(db.get_bind()).has_table("itsm_teams", schema="public"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assignment groups are unavailable until operational teams are configured",
            )
        if not db.query(ITSMTeam.id).filter(
            ITSMTeam.tenant_id == tenant_id,
            ITSMTeam.is_active.is_(True),
            ITSMTeam.name == assignment_group.strip(),
        ).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Assignment group must be an active operational team in this tenant",
            )

    @staticmethod
    def _record_activity(
        db: Session,
        tenant_id: UUID,
        ticket_id: UUID,
        activity_type: str,
        content: str | None = None,
        old_value: dict[str, Any] | None = None,
        new_value: dict[str, Any] | None = None,
        actor_id: UUID | None = None,
        actor_type: str = "USER",
        is_internal: bool = False,
    ) -> ITSMTicketActivity:
        meta: dict[str, Any] = {}
        if old_value:
            meta["old_value"] = old_value
        if new_value:
            meta["new_value"] = new_value
        if is_internal:
            meta["is_internal"] = True
        if actor_id:
            try:
                actor_user = db.query(User).filter(User.id == actor_id).first()
                if actor_user and actor_user.email:
                    meta["actor_email"] = actor_user.email
                    meta["actor_name"] = actor_user.email
            except Exception:
                pass

        activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=ticket_id,
            actor_type=actor_type,
            actor_id=actor_id,
            activity_type=activity_type,
            content=content,
            activity_metadata=meta,
            created_at=datetime.now(timezone.utc),
        )
        db.add(activity)
        return activity

    @staticmethod
    def _emit_audit_event(
        db: Session,
        tenant_id: UUID,
        ticket: ITSMTicket,
        action: str,
        actor_id: UUID | None,
        reason: str | None = None,
        trace_items: list[str] | None = None,
    ) -> None:
        trace = [
            f"ticket_id={ticket.id}",
            f"ticket_number={ticket.ticket_number}",
            f"status={ticket.status}",
            f"priority={ticket.priority}",
        ]
        if trace_items:
            trace.extend(trace_items)
        try:
            sp = db.begin_nested()
            try:
                db.execute(
                    text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                    {"tenant_id": str(tenant_id)},
                )
                append_audit_event(
                    db,
                    {
                        "id": str(uuid4()),
                        "idempotency_key": f"itsm:incident:{ticket.id}:{action}:{datetime.now(timezone.utc).timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": datetime.now(timezone.utc),
                        "actor_id": str(actor_id) if actor_id else None,
                        "actor_type": "user",
                        "action": f"itsm.incident.{action}",
                        "request_id": str(ticket.id),
                        "provider": "itsm",
                        "reason": reason or action,
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": trace,
                    },
                )
                sp.commit()
            except Exception as e:
                sp.rollback()
                logger.warning("Audit event emission failed (continuing transaction): %s", e)
        except Exception as e:
            logger.warning("Audit event savepoint failed: %s", e)

    @classmethod
    def create_incident(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        payload: IncidentCreateRequest,
    ) -> ITSMTicket:
        cls._validate_user_in_tenant(db, tenant_id, actor_id, "Requester")

        # Validate references
        if payload.assignee_id:
            cls._validate_assignee_in_tenant(db, tenant_id, payload.assignee_id)
        cls._validate_assignment_group(db, tenant_id, payload.assignment_group)
        service = None
        if payload.service_id:
            service = cls._validate_service_in_tenant(db, tenant_id, payload.service_id)
        if payload.configuration_item_id:
            cls._validate_configuration_item_in_tenant(
                db,
                tenant_id,
                payload.configuration_item_id,
                payload.service_id,
            )
        if payload.category_id:
            cls._validate_category_in_tenant(db, tenant_id, payload.category_id)

        # Priority calculation
        matrix_priority = calculate_priority_from_matrix(payload.impact, payload.urgency)
        priority = (
            normalize_priority(payload.priority)
            if payload.priority
            else matrix_priority
        )
        if priority != matrix_priority and not (payload.priority_override_reason or "").strip():
            payload.priority_override_reason = f"Intake priority set to {priority}"

        assignment_group = payload.assignment_group
        if not assignment_group and service and service.escalation_team:
            cls._validate_assignment_group(db, tenant_id, service.escalation_team)
            assignment_group = service.escalation_team

        # Minimal SLA Policy Association (Step 14: no SLA engine calculations)
        sla_policy = cls._find_sla_policy(db, tenant_id, priority, payload.service_id, ticket_type="INCIDENT")

        ticket_number = cls.generate_ticket_number(db, tenant_id, "INCIDENT")
        initial_status = "ASSIGNED" if (payload.assignee_id or assignment_group) else "NEW"

        now = datetime.now(timezone.utc)
        ticket = ITSMTicket(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_number=ticket_number,
            ticket_type="INCIDENT",
            title=payload.title.strip(),
            description=payload.description.strip(),
            impact=payload.impact.strip().upper(),
            urgency=payload.urgency.strip().upper(),
            priority=priority,
            status=initial_status,
            source_channel=payload.source_channel,
            requester_id=actor_id,
            assignee_id=payload.assignee_id,
            assignment_group=assignment_group,
            service_id=payload.service_id,
            category_id=payload.category_id,
            category=payload.category,
            subcategory=payload.subcategory,
            is_major_incident=payload.is_major_incident,
            created_at=now,
            updated_at=now,
        )
        apply_sla_policy(ticket, sla_policy, now)
        db.add(ticket)
        db.flush()

        # Initial activity record
        cls._record_activity(
            db=db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            activity_type="CREATED",
            content=f"Incident logged with priority {priority} (Status: {initial_status})"
            + (f". Priority override: {payload.priority_override_reason.strip()}" if priority != matrix_priority else ""),
            actor_id=actor_id,
        )

        # Audit event
        cls._emit_audit_event(
            db=db,
            tenant_id=tenant_id,
            ticket=ticket,
            action="created",
            actor_id=actor_id,
            reason="Incident created",
        )

        db.commit()
        db.refresh(ticket)

        cls.notify_incident_managers_new_incident(db, tenant_id, ticket, actor_id=actor_id)
        if ticket.assignee_id or ticket.assignment_group:
            cls.notify_assignment_change(
                db=db,
                tenant_id=tenant_id,
                ticket=ticket,
                old_assignee_id=None,
                new_assignee_id=ticket.assignee_id,
                old_group=None,
                new_group=ticket.assignment_group,
                actor_id=actor_id,
            )

        return ticket

    @classmethod
    def notify_incident_managers_new_incident(
        cls,
        db: Session,
        tenant_id: UUID,
        ticket: ITSMTicket,
        actor_id: Optional[UUID] = None,
    ) -> None:
        """Dispatches an in-app notification to all active Incident Managers in the tenant when a new incident is created."""
        try:
            im_rows = (
                db.query(ITSMUserAccess.user_id)
                .outerjoin(User, (User.id == ITSMUserAccess.user_id) & (User.tenant_id == ITSMUserAccess.tenant_id))
                .filter(
                    ITSMUserAccess.tenant_id == tenant_id,
                    func.upper(ITSMUserAccess.itsm_role) == "INCIDENT_MANAGER",
                    ITSMUserAccess.has_itsm_access.is_(True),
                    or_(User.id.is_(None), User.is_active.is_(True)),
                )
                .all()
            )
            manager_ids = {r[0] for r in im_rows if r[0]}

            for mgr_id in manager_ids:
                if actor_id and str(mgr_id) == str(actor_id):
                    continue
                create_notification(
                    db=db,
                    tenant_id=tenant_id,
                    user_id=mgr_id,
                    type="itsm.incident.created",
                    severity="info",
                    title=f"New incident {ticket.ticket_number} has been created",
                    body=ticket.title,
                    link=f"/itsm/incidents/{ticket.id}",
                )
        except Exception as exc:
            logger.warning("Failed to dispatch new incident notification for ticket %s: %s", getattr(ticket, "ticket_number", ticket.id), exc)

    @classmethod
    def notify_assignment_change(
        cls,
        db: Session,
        tenant_id: UUID,
        ticket: ITSMTicket,
        old_assignee_id: Optional[UUID | str],
        new_assignee_id: Optional[UUID | str],
        old_group: Optional[str],
        new_group: Optional[str],
        actor_id: Optional[UUID] = None,
    ) -> None:
        """Dispatches in-app notifications when an incident is assigned or reassigned to a team or agent.
        Prevents duplicate notifications if an agent is assigned both directly and as part of the team.
        """
        try:
            str_old_assignee = str(old_assignee_id) if old_assignee_id else None
            str_new_assignee = str(new_assignee_id) if new_assignee_id else None
            str_old_group = (old_group or "").strip()
            str_new_group = (new_group or "").strip()

            assignee_changed = bool(str_new_assignee and str_new_assignee != (str_old_assignee or ""))
            group_changed = bool(str_new_group and str_new_group != str_old_group)

            if not assignee_changed and not group_changed:
                return

            assigned_agent_uuid: Optional[UUID] = None
            if assignee_changed and new_assignee_id:
                try:
                    assigned_agent_uuid = UUID(str(new_assignee_id))
                except (ValueError, TypeError):
                    assigned_agent_uuid = None

                if assigned_agent_uuid:
                    create_notification(
                        db=db,
                        tenant_id=tenant_id,
                        user_id=assigned_agent_uuid,
                        type="itsm.incident.assigned",
                        severity="info",
                        title=f"Incident {ticket.ticket_number} has been assigned to you",
                        body=ticket.title,
                        link=f"/itsm/incidents/{ticket.id}",
                    )

            if group_changed and str_new_group:
                # Query all active members of the newly assigned team in this tenant
                team_member_rows = (
                    db.query(ITSMTeamMember.user_id)
                    .join(ITSMTeam, (ITSMTeam.id == ITSMTeamMember.team_id) & (ITSMTeam.tenant_id == ITSMTeamMember.tenant_id))
                    .outerjoin(User, (User.id == ITSMTeamMember.user_id) & (User.tenant_id == ITSMTeamMember.tenant_id))
                    .filter(
                        ITSMTeam.tenant_id == tenant_id,
                        ITSMTeamMember.tenant_id == tenant_id,
                        func.lower(ITSMTeam.name) == func.lower(str_new_group),
                        ITSMTeam.is_active.is_(True),
                        or_(User.id.is_(None), User.is_active.is_(True)),
                    )
                    .all()
                )
                team_member_ids = {r[0] for r in team_member_rows if r[0]}

                # Duplicate Prevention:
                # If an agent was directly assigned in this operation, exclude them from team notifications
                if assigned_agent_uuid:
                    team_member_ids.discard(assigned_agent_uuid)

                # Also exclude current ticket assignee if they were already the assignee
                if ticket.assignee_id:
                    try:
                        team_member_ids.discard(UUID(str(ticket.assignee_id)))
                    except (ValueError, TypeError):
                        pass

                for member_id in team_member_ids:
                    create_notification(
                        db=db,
                        tenant_id=tenant_id,
                        user_id=member_id,
                        type="itsm.incident.assigned",
                        severity="info",
                        title=f"Incident {ticket.ticket_number} assigned to your team {str_new_group}",
                        body=ticket.title,
                        link=f"/itsm/incidents/{ticket.id}",
                    )
        except Exception as exc:
            logger.warning("Failed to dispatch assignment notifications for ticket %s: %s", getattr(ticket, "ticket_number", ticket.id), exc)

    @classmethod
    def get_user_team_names(cls, db: Session, tenant_id: UUID, user_id: UUID) -> list[str]:
        """Return list of active team names the given user belongs to within the tenant."""
        if not inspect(db.get_bind()).has_table("itsm_teams", schema="public") or not inspect(db.get_bind()).has_table("itsm_team_members", schema="public"):
            return []
        rows = (
            db.query(ITSMTeam.name)
            .join(ITSMTeamMember, ITSMTeam.id == ITSMTeamMember.team_id)
            .filter(
                ITSMTeam.tenant_id == tenant_id,
                ITSMTeamMember.tenant_id == tenant_id,
                ITSMTeamMember.user_id == user_id,
                ITSMTeam.is_active.is_(True),
            )
            .all()
        )
        return [r[0].strip() for r in rows if r[0] and r[0].strip()]

    @classmethod
    def check_incident_agent_access(
        cls, db: Session, tenant_id: UUID, incident: ITSMTicket, agent_id: UUID
    ) -> bool:
        """Returns True if the incident is assigned directly to the agent or to one of their active teams."""
        if incident.assignee_id and str(incident.assignee_id) == str(agent_id):
            return True
        if incident.assignment_group:
            team_names = cls.get_user_team_names(db, tenant_id, agent_id)
            if incident.assignment_group.strip() in team_names:
                return True
        return False

    @classmethod
    def list_incidents(
        cls,
        db: Session,
        tenant_id: UUID,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        service_id: Optional[UUID] = None,
        category: Optional[str] = None,
        assignee_id: Optional[UUID] = None,
        requester_id: Optional[UUID] = None,
        agent_scope_id: Optional[UUID] = None,
        created_after: Optional[datetime] = None,
        created_before: Optional[datetime] = None,
        search: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[ITSMTicket]:
        query = db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
        )

        if status:
            query = query.filter(ITSMTicket.status == status.strip().upper())
        if priority:
            norm_priority = normalize_priority(priority)
            query = query.filter(ITSMTicket.priority == norm_priority)
        if service_id:
            query = query.filter(ITSMTicket.service_id == service_id)
        if category:
            query = query.filter(ITSMTicket.category == category.strip())
        if assignee_id:
            query = query.filter(ITSMTicket.assignee_id == assignee_id)
        if requester_id:
            query = query.filter(ITSMTicket.requester_id == requester_id)
        if agent_scope_id:
            team_names = cls.get_user_team_names(db, tenant_id, agent_scope_id)
            if team_names:
                query = query.filter(
                    or_(
                        ITSMTicket.assignee_id == agent_scope_id,
                        ITSMTicket.assignment_group.in_(team_names),
                    )
                )
            else:
                query = query.filter(ITSMTicket.assignee_id == agent_scope_id)
        if created_after:
            query = query.filter(ITSMTicket.created_at >= created_after)
        if created_before:
            query = query.filter(ITSMTicket.created_at <= created_before)
        if search:
            pattern = f"%{search.strip()}%"
            query = query.filter(
                ITSMTicket.title.ilike(pattern)
                | ITSMTicket.description.ilike(pattern)
                | ITSMTicket.ticket_number.ilike(pattern)
            )

        return query.order_by(ITSMTicket.created_at.desc()).offset(offset).limit(limit).all()

    @classmethod
    def list_agent_queue(
        cls,
        db: Session,
        tenant_id: UUID,
        agent_id: UUID,
        filter_mode: str = "all",
        status: Optional[str] = None,
        sort_by: str = "recently_updated",
        offset: int = 0,
        limit: int = 50,
    ) -> list[ITSMTicket]:
        query = db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
        )

        if status:
            query = query.filter(ITSMTicket.status == status.strip().upper())
        else:
            query = query.filter(ITSMTicket.status.notin_(["CLOSED", "CANCELLED"]))

        team_names = cls.get_user_team_names(db, tenant_id, agent_id)

        # Baseline scope: Service Agent can only see incidents directly assigned to them or to their active teams
        if team_names:
            workable_scope = or_(
                ITSMTicket.assignee_id == agent_id,
                ITSMTicket.assignment_group.in_(team_names),
            )
        else:
            workable_scope = (ITSMTicket.assignee_id == agent_id)

        mode = (filter_mode or "all").lower().strip()
        if mode in ("assigned_to_me", "my_work"):
            query = query.filter(ITSMTicket.assignee_id == agent_id)
        elif mode in ("team_queue", "my_team", "team"):
            if team_names:
                query = query.filter(ITSMTicket.assignment_group.in_(team_names))
            else:
                query = query.filter(false())
        elif mode == "high_priority":
            query = query.filter(workable_scope, ITSMTicket.priority.in_(["P1", "P2"]))
        elif mode == "sla_risk":
            query = query.filter(workable_scope, ITSMTicket.sla_status.in_(["AT_RISK", "BREACHED"]))
        else:
            # "all" or default: strictly restricted to workable scope (directly assigned + team queue)
            query = query.filter(workable_scope)

        sort_order = (sort_by or "recently_updated").lower().strip()
        if sort_order == "priority":
            query = query.order_by(
                case(
                    (ITSMTicket.priority == "P1", 1),
                    (ITSMTicket.priority == "P2", 2),
                    (ITSMTicket.priority == "P3", 3),
                    (ITSMTicket.priority == "P4", 4),
                    else_=5,
                ).asc(),
                ITSMTicket.updated_at.desc(),
            )
        elif sort_order == "sla_risk":
            query = query.order_by(
                case(
                    (ITSMTicket.sla_status == "BREACHED", 1),
                    (ITSMTicket.sla_status == "AT_RISK", 2),
                    (ITSMTicket.sla_status == "WITHIN_SLA", 3),
                    else_=4,
                ).asc(),
                ITSMTicket.sla_resolution_due_at.asc().nullslast(),
                ITSMTicket.updated_at.desc(),
            )
        else:
            query = query.order_by(ITSMTicket.updated_at.desc())

        return query.offset(offset).limit(limit).all()

    @classmethod
    def list_incident_operations_queue(
        cls,
        db: Session,
        tenant_id: UUID,
        *,
        status_filter: Optional[str] = None,
        priority: Optional[str] = None,
        assignment_group: Optional[str] = None,
        assignee_id: Optional[UUID] = None,
        unassigned_only: bool = False,
        search: Optional[str] = None,
        incident_ids: Optional[set[UUID]] = None,
        command_scope: bool = False,
        sort_by: str = "priority",
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[ITSMTicket], int]:
        """Return a tenant-scoped manager queue without changing the legacy list contract."""
        query = db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
        )
        if command_scope:
            query = query.filter(
                ITSMTicket.status.in_({"NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"}),
                or_(
                    ITSMTicket.is_major_incident.is_(True),
                    ITSMTicket.priority.in_({"P1", "P2"}),
                ),
            )
        if status_filter:
            query = query.filter(ITSMTicket.status == status_filter.strip().upper())
        if priority:
            query = query.filter(ITSMTicket.priority == normalize_priority(priority))
        if assignment_group:
            if assignment_group == "__UNASSIGNED__":
                query = query.filter(ITSMTicket.assignment_group.is_(None))
            else:
                query = query.filter(ITSMTicket.assignment_group == assignment_group.strip())
        if assignee_id:
            query = query.filter(ITSMTicket.assignee_id == assignee_id)
        if unassigned_only:
            query = query.filter(ITSMTicket.assignee_id.is_(None))
        if incident_ids is not None:
            if not incident_ids:
                return [], 0
            query = query.filter(ITSMTicket.id.in_(incident_ids))
        if search:
            pattern = f"%{search.strip()}%"
            query = query.filter(
                ITSMTicket.title.ilike(pattern)
                | ITSMTicket.description.ilike(pattern)
                | ITSMTicket.ticket_number.ilike(pattern)
            )

        total = query.count()
        priority_order = case(
            (ITSMTicket.priority == "P1", 1),
            (ITSMTicket.priority == "P2", 2),
            (ITSMTicket.priority == "P3", 3),
            else_=4,
        )
        if sort_by == "updated":
            ordering = (ITSMTicket.updated_at.desc(),)
        elif sort_by == "sla_due":
            ordering = (
                ITSMTicket.sla_resolution_due_at.asc().nullslast(),
                ITSMTicket.sla_response_due_at.asc().nullslast(),
                priority_order.asc(),
            )
        else:
            ordering = (priority_order.asc(), ITSMTicket.updated_at.desc())
        return query.order_by(*ordering).offset(offset).limit(limit).all(), total

    @classmethod
    def get_incident(cls, db: Session, tenant_id: UUID, incident_id: UUID) -> ITSMTicket:
        ticket = (
            db.query(ITSMTicket)
            .options(
                joinedload(ITSMTicket.service),
                joinedload(ITSMTicket.assignee),
                joinedload(ITSMTicket.linked_problem),
            )
            .filter(
                ITSMTicket.id == incident_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "INCIDENT",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Incident '{incident_id}' not found",
            )
        return ticket

    @classmethod
    def update_incident(
        cls,
        db: Session,
        tenant_id: UUID,
        incident_id: UUID,
        actor_id: UUID,
        payload: IncidentUpdateRequest,
    ) -> ITSMTicket:
        ticket = cls.get_incident(db, tenant_id, incident_id)

        if ticket.status in {"CLOSED", "CANCELLED"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot edit incident in terminal status '{ticket.status}'",
            )

        old_values: dict[str, Any] = {}
        new_values: dict[str, Any] = {}
        changed_fields: list[str] = []

        if payload.title is not None and payload.title.strip() != ticket.title:
            old_values["title"] = ticket.title
            new_values["title"] = payload.title.strip()
            ticket.title = payload.title.strip()
            changed_fields.append("title")

        if payload.description is not None and payload.description.strip() != ticket.description:
            old_values["description"] = ticket.description
            new_values["description"] = payload.description.strip()
            ticket.description = payload.description.strip()
            changed_fields.append("description")

        if payload.impact is not None and payload.impact.strip().upper() != ticket.impact:
            old_values["impact"] = ticket.impact
            new_values["impact"] = payload.impact.strip().upper()
            ticket.impact = payload.impact.strip().upper()
            changed_fields.append("impact")

        if payload.urgency is not None and payload.urgency.strip().upper() != ticket.urgency:
            old_values["urgency"] = ticket.urgency
            new_values["urgency"] = payload.urgency.strip().upper()
            ticket.urgency = payload.urgency.strip().upper()
            changed_fields.append("urgency")

        matrix_priority = calculate_priority_from_matrix(ticket.impact, ticket.urgency)
        if payload.priority is not None:
            norm_priority = normalize_priority(payload.priority)
            if norm_priority != matrix_priority and not (payload.priority_override_reason or "").strip():
                raise HTTPException(status_code=400, detail="priority_override_reason is required when overriding the impact/urgency matrix")
            if norm_priority != ticket.priority:
                old_values["priority"] = ticket.priority
                new_values["priority"] = norm_priority
                ticket.priority = norm_priority
                changed_fields.append("priority")
        elif any(field in changed_fields for field in ("impact", "urgency")) and matrix_priority != ticket.priority:
            old_values["priority"] = ticket.priority
            new_values["priority"] = matrix_priority
            ticket.priority = matrix_priority
            changed_fields.append("priority")

        if payload.priority_override_reason and "priority" in changed_fields:
            new_values["priority_override_reason"] = payload.priority_override_reason.strip()

        if "service_id" in payload.model_fields_set and payload.service_id != ticket.service_id:
            if payload.service_id is not None:
                cls._validate_service_in_tenant(db, tenant_id, payload.service_id)
            if ticket.configuration_item_id and "configuration_item_id" not in payload.model_fields_set:
                cls._validate_configuration_item_in_tenant(
                    db,
                    tenant_id,
                    ticket.configuration_item_id,
                    payload.service_id,
                )
            old_values["service_id"] = str(ticket.service_id) if ticket.service_id else None
            new_values["service_id"] = str(payload.service_id) if payload.service_id else None
            ticket.service_id = payload.service_id
            changed_fields.append("service_id")
            if payload.service_id is not None and not ticket.assignment_group:
                routed_group = db.query(ITSMService.escalation_team).filter(
                    ITSMService.id == payload.service_id,
                    ITSMService.tenant_id == tenant_id,
                ).scalar()
                if routed_group:
                    cls._validate_assignment_group(db, tenant_id, routed_group)
                    old_values["assignment_group"] = None
                    new_values["assignment_group"] = routed_group
                    ticket.assignment_group = routed_group
                    changed_fields.append("assignment_group")

        if "configuration_item_id" in payload.model_fields_set and payload.configuration_item_id is not None:
            cls._validate_configuration_item_in_tenant(
                db,
                tenant_id,
                payload.configuration_item_id,
                payload.service_id if "service_id" in payload.model_fields_set else ticket.service_id,
            )

        if "category_id" in payload.model_fields_set and payload.category_id != ticket.category_id:
            if payload.category_id is not None:
                cls._validate_category_in_tenant(db, tenant_id, payload.category_id)
            old_values["category_id"] = str(ticket.category_id) if ticket.category_id else None
            new_values["category_id"] = str(payload.category_id) if payload.category_id else None
            ticket.category_id = payload.category_id
            changed_fields.append("category_id")

        if payload.category is not None and payload.category != ticket.category:
            old_values["category"] = ticket.category
            new_values["category"] = payload.category
            ticket.category = payload.category
            changed_fields.append("category")

        if payload.subcategory is not None and payload.subcategory != ticket.subcategory:
            old_values["subcategory"] = ticket.subcategory
            new_values["subcategory"] = payload.subcategory
            ticket.subcategory = payload.subcategory
            changed_fields.append("subcategory")

        if payload.assignee_id is not None and payload.assignee_id != ticket.assignee_id:
            cls._validate_assignee_in_tenant(db, tenant_id, payload.assignee_id)
            old_values["assignee_id"] = str(ticket.assignee_id) if ticket.assignee_id else None
            new_values["assignee_id"] = str(payload.assignee_id)
            ticket.assignee_id = payload.assignee_id
            changed_fields.append("assignee_id")

        if payload.assignment_group is not None and payload.assignment_group != ticket.assignment_group:
            cls._validate_assignment_group(db, tenant_id, payload.assignment_group)
            old_values["assignment_group"] = ticket.assignment_group
            new_values["assignment_group"] = payload.assignment_group
            ticket.assignment_group = payload.assignment_group
            changed_fields.append("assignment_group")

        if payload.is_major_incident is not None and payload.is_major_incident != ticket.is_major_incident:
            old_values["is_major_incident"] = ticket.is_major_incident
            new_values["is_major_incident"] = payload.is_major_incident
            ticket.is_major_incident = payload.is_major_incident
            changed_fields.append("is_major_incident")

        if changed_fields:
            if "priority" in changed_fields or "service_id" in changed_fields:
                policy = cls._find_sla_policy(db, tenant_id, ticket.priority, ticket.service_id, ticket_type=ticket.ticket_type)
                response_met_at = ticket.sla_response_met_at
                apply_sla_policy(ticket, policy, ticket.created_at)
                ticket.sla_response_met_at = response_met_at
            ticket.updated_at = datetime.now(timezone.utc)
            cls._record_activity(
                db=db,
                tenant_id=tenant_id,
                ticket_id=ticket.id,
                activity_type="FIELD_UPDATE",
                content=f"Updated fields: {', '.join(changed_fields)}"
                + (f". Priority override: {payload.priority_override_reason.strip()}" if payload.priority_override_reason and "priority" in changed_fields else ""),
                old_value=old_values,
                new_value=new_values,
                actor_id=actor_id,
            )
            cls._emit_audit_event(
                db=db,
                tenant_id=tenant_id,
                ticket=ticket,
                action="updated",
                actor_id=actor_id,
                trace_items=[f"updated_fields={','.join(changed_fields)}"],
            )
            db.commit()
            db.refresh(ticket)

            if "assignee_id" in changed_fields or "assignment_group" in changed_fields:
                cls.notify_assignment_change(
                    db=db,
                    tenant_id=tenant_id,
                    ticket=ticket,
                    old_assignee_id=old_values.get("assignee_id"),
                    new_assignee_id=new_values.get("assignee_id") if "assignee_id" in changed_fields else ticket.assignee_id,
                    old_group=old_values.get("assignment_group"),
                    new_group=new_values.get("assignment_group") if "assignment_group" in changed_fields else ticket.assignment_group,
                    actor_id=actor_id,
                )

        return ticket

    @classmethod
    def change_status(
        cls,
        db: Session,
        tenant_id: UUID,
        incident_id: UUID,
        actor_id: UUID,
        payload: IncidentStatusUpdateRequest,
    ) -> ITSMTicket:
        ticket = cls.get_incident(db, tenant_id, incident_id)
        current_status = ticket.status
        target_status = payload.status.strip().upper()

        if target_status not in VALID_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid target status '{target_status}'. Valid values: {', '.join(sorted(VALID_STATUSES))}",
            )

        if current_status == target_status:
            return ticket

        allowed = ALLOWED_TRANSITIONS.get(current_status, set())
        if target_status not in allowed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Invalid status transition from '{current_status}' to '{target_status}'. Allowed transitions: {sorted(allowed) or 'None (Terminal)'}",
            )

        # Condition checks according to Phase 3 design
        if target_status == "ASSIGNED" and not (ticket.assignee_id or ticket.assignment_group):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot move to ASSIGNED without an assignee_id or assignment_group",
            )

        if target_status in {"PENDING", "CANCELLED"}:
            reason = payload.status_reason or ticket.status_reason
            if not reason or not reason.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"status_reason is required when moving to {target_status}",
                )
            ticket.status_reason = reason.strip()

        transition_time = datetime.now(timezone.utc)
        if target_status == "PENDING":
            pause_sla(ticket, transition_time)
        elif current_status == "PENDING" and target_status in {"IN_PROGRESS", "RESOLVED"}:
            resume_sla(ticket, transition_time)
        if target_status in {"IN_PROGRESS", "RESOLVED"} and ticket.sla_response_met_at is None:
            ticket.sla_response_met_at = transition_time
        if target_status == "RESOLVED":
            res_code = payload.resolution_code or ticket.resolution_code
            res_summary = payload.resolution_summary or ticket.resolution_summary
            if not res_code or not res_code.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="resolution_code is required when resolving an incident",
                )
            if not res_summary or not res_summary.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="resolution_summary is required when resolving an incident",
                )
            ticket.resolution_code = res_code.strip()
            ticket.resolution_summary = res_summary.strip()
            ticket.resolved_at = transition_time
            ticket.sla_resolution_met_at = transition_time

        if target_status == "CLOSED":
            ticket.closed_at = transition_time
            ticket.closed_by = actor_id

        if current_status == "RESOLVED" and target_status == "IN_PROGRESS":
            # Reopening ticket
            ticket.resolved_at = None
            ticket.sla_resolution_met_at = None
            if payload.status_reason and payload.status_reason.strip():
                ticket.status_reason = payload.status_reason.strip()

        ticket.status = target_status
        ticket.updated_at = transition_time

        if ticket.is_major_incident:
            major = db.query(ITSMMajorIncident).filter_by(tenant_id=tenant_id, ticket_id=ticket.id).first()
            if major:
                if target_status == "RESOLVED":
                    major.resolved_at = transition_time
                elif target_status == "CLOSED":
                    major.closed_at = transition_time
                elif current_status == "RESOLVED" and target_status == "IN_PROGRESS":
                    major.resolved_at = None
                    major.closed_at = None

        activity_content = f"Status changed from {current_status} to {target_status}" + (f": {payload.status_reason}" if payload.status_reason else "")
        if target_status == "RESOLVED":
            activity_content = f"Incident resolved: Status changed from {current_status} to RESOLVED: {ticket.resolution_summary} (Code: {ticket.resolution_code})"
        elif current_status == "RESOLVED" and target_status == "IN_PROGRESS":
            activity_content = "Incident reopened: Status changed from RESOLVED to IN_PROGRESS" + (f": {payload.status_reason}" if payload.status_reason else "")

        new_val = {"status": target_status, "status_reason": payload.status_reason}
        if target_status == "RESOLVED":
            new_val["resolution_code"] = ticket.resolution_code
            new_val["resolution_summary"] = ticket.resolution_summary

        cls._record_activity(
            db=db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            activity_type="STATUS_CHANGE",
            content=activity_content,
            old_value={"status": current_status},
            new_value=new_val,
            actor_id=actor_id,
        )

        cls._emit_audit_event(
            db=db,
            tenant_id=tenant_id,
            ticket=ticket,
            action="status_changed",
            actor_id=actor_id,
            reason=payload.status_reason,
            trace_items=[f"old_status={current_status}", f"new_status={target_status}"],
        )

        db.commit()
        db.refresh(ticket)
        return ticket

    @classmethod
    def assign_incident(
        cls,
        db: Session,
        tenant_id: UUID,
        incident_id: UUID,
        actor_id: UUID,
        payload: IncidentAssignRequest,
    ) -> ITSMTicket:
        ticket = cls.get_incident(db, tenant_id, incident_id)

        if ticket.status in {"CLOSED", "CANCELLED"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot reassign incident in terminal status '{ticket.status}'",
            )

        if payload.assignee_id:
            cls._validate_assignee_in_tenant(db, tenant_id, payload.assignee_id)
        cls._validate_assignment_group(db, tenant_id, payload.assignment_group)

        old_assignee = str(ticket.assignee_id) if ticket.assignee_id else None
        new_assignee = str(payload.assignee_id) if payload.assignee_id else None
        old_group = ticket.assignment_group

        ticket.assignee_id = payload.assignee_id
        if "assignment_group" in payload.model_fields_set:
            ticket.assignment_group = payload.assignment_group
        new_group = ticket.assignment_group

        # If incident was NEW and is now assigned, advance to ASSIGNED
        if ticket.status == "NEW" and (ticket.assignee_id or ticket.assignment_group):
            ticket.status = "ASSIGNED"

        ticket.updated_at = datetime.now(timezone.utc)

        cls._record_activity(
            db=db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            activity_type="ASSIGNMENT_CHANGE",
            content=f"Assigned to user '{new_assignee}' / group '{new_group}'",
            old_value={"assignee_id": old_assignee, "assignment_group": old_group},
            new_value={"assignee_id": new_assignee, "assignment_group": new_group},
            actor_id=actor_id,
        )

        cls._emit_audit_event(
            db=db,
            tenant_id=tenant_id,
            ticket=ticket,
            action="assigned",
            actor_id=actor_id,
            trace_items=[f"old_assignee={old_assignee}", f"new_assignee={new_assignee}"],
        )

        db.commit()
        db.refresh(ticket)

        cls.notify_assignment_change(
            db=db,
            tenant_id=tenant_id,
            ticket=ticket,
            old_assignee_id=old_assignee,
            new_assignee_id=new_assignee,
            old_group=old_group,
            new_group=new_group,
            actor_id=actor_id,
        )

        return ticket

    @classmethod
    def declare_major_incident(cls, db: Session, tenant_id: UUID, incident_id: UUID, actor_id: UUID, payload: MajorIncidentDeclareRequest) -> ITSMMajorIncident:
        ticket = cls.get_incident(db, tenant_id, incident_id)
        if db.query(ITSMMajorIncident).filter_by(tenant_id=tenant_id, ticket_id=incident_id).first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Incident is already declared as major")
        commander_id = payload.incident_commander_id or actor_id
        cls._validate_major_command_users(db, tenant_id, payload)
        cls._validate_major_command_user(db, tenant_id, commander_id, "Incident commander")
        cls._validate_communication_approvals(payload, actor_id)
        major = ITSMMajorIncident(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            incident_commander_id=commander_id,
            bridge_url=payload.bridge_url,
            communication_channel=payload.communication_channel,
            declared_at=datetime.now(timezone.utc),
            declared_by_id=actor_id,
            postmortem_status="PENDING",
            executive_summary=payload.executive_summary,
            impacted_business_units=payload.impacted_business_units or [],
            customer_impact_description=payload.customer_impact_description,
        )
        ticket.is_major_incident = True
        ticket.updated_at = datetime.now(timezone.utc)
        db.add(major)
        cls._record_activity(db, tenant_id, ticket.id, "MAJOR_INCIDENT_DECLARED", "Major incident declared", new_value={"incident_commander_id": str(commander_id)}, actor_id=actor_id)
        cls._emit_audit_event(db, tenant_id, ticket, "major_incident_declared", actor_id)
        db.commit(); db.refresh(major)
        return major

    @classmethod
    def get_major_incident(cls, db: Session, tenant_id: UUID, incident_id: UUID) -> ITSMMajorIncident:
        cls.get_incident(db, tenant_id, incident_id)
        major = db.query(ITSMMajorIncident).filter_by(tenant_id=tenant_id, ticket_id=incident_id).first()
        if not major:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Major incident not found")
        return major

    @classmethod
    def update_major_incident(cls, db: Session, tenant_id: UUID, incident_id: UUID, actor_id: UUID, payload: MajorIncidentUpdateRequest) -> ITSMMajorIncident:
        major = cls.get_major_incident(db, tenant_id, incident_id)
        changes = payload.model_dump(exclude_unset=True)
        if "incident_commander_id" in changes and changes["incident_commander_id"] is None:
            raise HTTPException(status_code=400, detail="A declared major incident must retain an Incident Manager as commander")
        cls._validate_major_command_users(db, tenant_id, payload)
        cls._validate_communication_approvals(payload, actor_id, major.command_communications or [])
        valid_fields = {
            "incident_commander_id",
            "bridge_url",
            "communication_channel",
            "executive_summary",
            "impacted_business_units",
            "customer_impact_description",
            "postmortem_status",
            "postmortem_url",
        }
        for field in valid_fields:
            if field in changes:
                setattr(major, field, changes[field])
        if changes:
            ticket = cls.get_incident(db, tenant_id, incident_id)
            ticket.updated_at = datetime.now(timezone.utc)
            cls._record_activity(db, tenant_id, ticket.id, "MAJOR_INCIDENT_UPDATED", "Major incident command details updated", new_value=payload.model_dump(mode="json", exclude_unset=True), actor_id=actor_id)
            cls._emit_audit_event(db, tenant_id, ticket, "major_incident_updated", actor_id)
            db.commit(); db.refresh(major)
        return major

    @staticmethod
    def _validate_communication_approvals(payload: MajorIncidentDeclareRequest, actor_id: UUID, existing: list[dict] | None = None) -> None:
        """An approval can only be recorded by its named, authorized approver.

        Unchanged approval evidence may be retained by another manager. These
        records remain manual coordination evidence, not proof of delivery.
        """
        previous = {str(item["id"]): MajorIncidentCommunication.model_validate(item) for item in existing or []}
        for item in payload.command_communications:
            if item.status == "DRAFT":
                continue
            if not item.approver_id:
                raise HTTPException(status_code=400, detail="Approved communications require an approver")
            old = previous.get(str(item.id))
            retained_approval = old and old.status in {"APPROVED", "COMMUNICATED"} and all(
                getattr(old, field) == getattr(item, field)
                for field in ("audience", "channel", "message", "approver_id", "recorded_at")
            )
            if not retained_approval and item.approver_id != actor_id:
                raise HTTPException(status_code=403, detail="Only the named approver can approve new or changed communication content")

    @classmethod
    def add_activity(
        cls,
        db: Session,
        tenant_id: UUID,
        incident_id: UUID,
        actor_id: UUID,
        payload: IncidentActivityCreateRequest,
    ) -> ITSMTicketActivity:
        ticket = cls.get_incident(db, tenant_id, incident_id)

        activity = cls._record_activity(
            db=db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            activity_type=payload.activity_type.strip().upper(),
            content=payload.content.strip(),
            actor_id=actor_id,
            is_internal=payload.is_internal,
        )

        if ticket.sla_response_met_at is None and actor_id != ticket.requester_id:
            ticket.sla_response_met_at = datetime.now(timezone.utc)

        ticket.updated_at = datetime.now(timezone.utc)

        cls._emit_audit_event(
            db=db,
            tenant_id=tenant_id,
            ticket=ticket,
            action="comment_added",
            actor_id=actor_id,
            trace_items=[f"activity_type={activity.activity_type}", f"is_internal={payload.is_internal}"],
        )

        db.commit()
        db.refresh(activity)

        # Notify requester if this is a public comment from an agent/operator
        cls.notify_requester_public_comment(
            db=db,
            tenant_id=tenant_id,
            ticket=ticket,
            activity=activity,
            actor_id=actor_id,
            is_internal=payload.is_internal,
        )

        # Notify assigned agent if this is a public comment from the requester
        cls.notify_assignee_public_comment(
            db=db,
            tenant_id=tenant_id,
            ticket=ticket,
            activity=activity,
            actor_id=actor_id,
            is_internal=payload.is_internal,
        )

        return activity

    @classmethod
    def notify_assignee_public_comment(
        cls,
        db: Session,
        tenant_id: UUID,
        ticket: ITSMTicket,
        activity: ITSMTicketActivity,
        actor_id: Optional[UUID] = None,
        is_internal: bool = False,
    ) -> Optional[Notification]:
        """Dispatches an in-app notification to the assigned service agent when a requester posts a public comment."""
        try:
            # 1. Ticket must have an assigned individual agent
            if not ticket.assignee_id:
                return None

            # 2. Must have actor_id and ticket requester_id
            if not actor_id or not ticket.requester_id:
                return None

            # 3. Only notify when the requester posts the comment
            if str(actor_id) != str(ticket.requester_id):
                return None

            # 4. Prevent self-notification if actor is the assignee
            if str(actor_id) == str(ticket.assignee_id):
                return None

            # 5. Check internal notes and non-public comments
            act_type = (activity.activity_type or "").strip().upper()
            is_internal_flag = is_internal or bool((activity.activity_metadata or {}).get("is_internal"))
            if is_internal_flag or act_type in ("NOTE", "INTERNAL_NOTE", "WORK_NOTE"):
                return None

            if act_type not in ("COMMENT", "PUBLIC_COMMENT", "REPLY"):
                return None

            if activity.content and activity.content.startswith("Attached file:"):
                return None

            ticket_num = ticket.ticket_number or "INC"
            title = f"New reply on {ticket_num}"
            body = "Requester has replied to your incident."
            link = f"/itsm/incidents/{ticket.id}"

            # Ensure tenant context is set for RLS before querying/inserting notifications
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )

            # Deduplication: suppress duplicate notification within 5 seconds for the same incident comment
            recent_cutoff = datetime.now(timezone.utc) - timedelta(seconds=5)
            existing = (
                db.query(Notification)
                .filter(
                    Notification.tenant_id == tenant_id,
                    Notification.user_id == ticket.assignee_id,
                    Notification.link == link,
                    Notification.body == body,
                    Notification.created_at >= recent_cutoff,
                )
                .first()
            )
            if existing:
                return existing

            return create_notification(
                db=db,
                tenant_id=tenant_id,
                user_id=ticket.assignee_id,
                type="itsm.incident.comment",
                severity="info",
                title=title,
                body=body,
                link=link,
            )
        except Exception as exc:
            logger.warning("Failed to dispatch assignee comment notification for incident %s: %s", getattr(ticket, "ticket_number", ticket.id), exc)
            return None

    @classmethod
    def notify_requester_public_comment(
        cls,
        db: Session,
        tenant_id: UUID,
        ticket: ITSMTicket,
        activity: ITSMTicketActivity,
        actor_id: Optional[UUID] = None,
        is_internal: bool = False,
    ) -> Optional[Notification]:
        """Dispatches an in-app notification to the ticket requester when an agent posts a public comment."""
        try:
            if not ticket.requester_id:
                return None

            if actor_id and str(actor_id) == str(ticket.requester_id):
                return None

            act_type = (activity.activity_type or "").strip().upper()
            is_internal_flag = is_internal or bool((activity.activity_metadata or {}).get("is_internal"))
            if is_internal_flag or act_type in ("NOTE", "INTERNAL_NOTE", "WORK_NOTE"):
                return None

            if act_type not in ("COMMENT", "PUBLIC_COMMENT", "REPLY"):
                return None

            if activity.content and activity.content.startswith("Attached file:"):
                return None

            ticket_num = ticket.ticket_number or "INC"
            title = f"New reply on {ticket_num}"
            if ticket.title:
                body = f"Agent has replied to your incident '{ticket.title}'."
            else:
                body = "Agent has replied to your incident."
            link = f"/itsm/incidents/{ticket.id}"

            # Ensure tenant context is set for RLS before querying/inserting notifications
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )

            # Deduplication: suppress duplicate notification within 5 seconds for the same incident comment
            recent_cutoff = datetime.now(timezone.utc) - timedelta(seconds=5)
            existing = (
                db.query(Notification)
                .filter(
                    Notification.tenant_id == tenant_id,
                    Notification.user_id == ticket.requester_id,
                    Notification.link == link,
                    Notification.body == body,
                    Notification.created_at >= recent_cutoff,
                )
                .first()
            )
            if existing:
                return existing

            return create_notification(
                db=db,
                tenant_id=tenant_id,
                user_id=ticket.requester_id,
                type="itsm.incident.comment",
                severity="info",
                title=title,
                body=body,
                link=link,
            )
        except Exception as exc:
            logger.warning("Failed to dispatch requester comment notification for incident %s: %s", getattr(ticket, "ticket_number", ticket.id), exc)
            return None

    @classmethod
    def list_activities(
        cls,
        db: Session,
        tenant_id: UUID,
        incident_id: UUID,
    ) -> list[ITSMTicketActivity]:
        # Enforce tenant check
        cls.get_incident(db, tenant_id, incident_id)
        return (
            db.query(ITSMTicketActivity)
            .options(joinedload(ITSMTicketActivity.actor))
            .filter(
                ITSMTicketActivity.ticket_id == incident_id,
                ITSMTicketActivity.tenant_id == tenant_id,
            )
            .order_by(ITSMTicketActivity.created_at.asc())
            .all()
        )

    @classmethod
    def get_incident_summary(
        cls,
        db: Session,
        tenant_id: UUID,
        requester_id: Optional[UUID] = None,
    ) -> dict[str, Any]:
        base_query = db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
        )
        if requester_id:
            base_query = base_query.filter(ITSMTicket.requester_id == requester_id)

        open_count = base_query.filter(
            ITSMTicket.status.notin_(["RESOLVED", "CLOSED", "CANCELLED"])
        ).count()

        resolved_count = base_query.filter(
            ITSMTicket.status.in_(["RESOLVED", "CLOSED"])
        ).count()

        pending_count = base_query.filter(
            ITSMTicket.status == "PENDING"
        ).count()

        resolved_tickets = base_query.filter(
            ITSMTicket.status.in_(["RESOLVED", "CLOSED"])
        ).all()

        total_seconds = 0.0
        valid_count = 0
        for ticket in resolved_tickets:
            end_time = ticket.resolved_at or ticket.closed_at
            if end_time and ticket.created_at and end_time >= ticket.created_at:
                delta = (end_time - ticket.created_at).total_seconds()
                total_seconds += delta
                valid_count += 1

        avg_hours = round(total_seconds / (valid_count * 3600.0), 1) if valid_count > 0 else 0.0

        return {
            "open_tickets_count": open_count,
            "resolved_tickets_count": resolved_count,
            "pending_action_count": pending_count,
            "avg_resolution_hours": avg_hours,
        }

