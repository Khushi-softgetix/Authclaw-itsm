"""Domain and database service for ITSM Incident Management."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import (
    ITSMService,
    ITSMMajorIncident,
    ITSMSLAPolicy,
    ITSMTicket,
    ITSMTicketActivity,
    ITSMTicketCategory,
    ITSMTicketCounter,
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
    VALID_IMPACTS,
    VALID_PRIORITIES,
    VALID_STATUSES,
    VALID_URGENCIES,
)
from app.services.audit_store import append_audit_event

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
    def generate_ticket_number(db: Session, tenant_id: UUID, ticket_type: str = "INCIDENT") -> str:
        """Concurrency-safe atomic sequence generation per tenant using itsm_ticket_counters."""
        default_prefix = "INC" if ticket_type == "INCIDENT" else ticket_type[:3]
        query = text(
            """
            INSERT INTO public.itsm_ticket_counters (id, tenant_id, ticket_type, prefix, last_number, updated_at)
            VALUES (gen_random_uuid(), :tenant_id, :ticket_type, :prefix, 1, clock_timestamp())
            ON CONFLICT (tenant_id, ticket_type)
            DO UPDATE SET
                last_number = public.itsm_ticket_counters.last_number + 1,
                updated_at = clock_timestamp()
            RETURNING prefix, last_number
            """
        )
        row = db.execute(
            query,
            {"tenant_id": str(tenant_id), "ticket_type": ticket_type, "prefix": default_prefix},
        ).fetchone()
        if not row:
            raise RuntimeError("Failed to generate ticket number")
        prefix, number = row[0], row[1]
        return f"{prefix}-{number:06d}"

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
            cls._validate_user_in_tenant(db, tenant_id, payload.assignee_id, "Assignee")
        if payload.service_id:
            cls._validate_service_in_tenant(db, tenant_id, payload.service_id)
        if payload.category_id:
            cls._validate_category_in_tenant(db, tenant_id, payload.category_id)

        # Priority calculation
        priority = (
            normalize_priority(payload.priority)
            if payload.priority
            else calculate_priority_from_matrix(payload.impact, payload.urgency)
        )

        # Minimal SLA Policy Association (Step 14: no SLA engine calculations)
        sla_policy = (
            db.query(ITSMSLAPolicy)
            .filter(
                ITSMSLAPolicy.tenant_id == tenant_id,
                ITSMSLAPolicy.ticket_type == "INCIDENT",
                ITSMSLAPolicy.priority == priority,
                ITSMSLAPolicy.is_active == True,
            )
            .first()
        )

        ticket_number = cls.generate_ticket_number(db, tenant_id, "INCIDENT")
        initial_status = "ASSIGNED" if (payload.assignee_id or payload.assignment_group) else "NEW"

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
            assignment_group=payload.assignment_group,
            service_id=payload.service_id,
            category_id=payload.category_id,
            category=payload.category,
            subcategory=payload.subcategory,
            is_major_incident=payload.is_major_incident,
            sla_policy_id=sla_policy.id if sla_policy else None,
            sla_status="WITHIN_SLA",
            created_at=now,
            updated_at=now,
        )
        db.add(ticket)
        db.flush()

        # Initial activity record
        cls._record_activity(
            db=db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            activity_type="CREATED",
            content=f"Incident logged with priority {priority} (Status: {initial_status})",
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
        return ticket

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
    def get_incident(cls, db: Session, tenant_id: UUID, incident_id: UUID) -> ITSMTicket:
        ticket = (
            db.query(ITSMTicket)
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

        if payload.priority is not None:
            norm_priority = normalize_priority(payload.priority)
            if norm_priority != ticket.priority:
                old_values["priority"] = ticket.priority
                new_values["priority"] = norm_priority
                ticket.priority = norm_priority
                changed_fields.append("priority")

        if payload.service_id is not None and payload.service_id != ticket.service_id:
            cls._validate_service_in_tenant(db, tenant_id, payload.service_id)
            old_values["service_id"] = str(ticket.service_id) if ticket.service_id else None
            new_values["service_id"] = str(payload.service_id)
            ticket.service_id = payload.service_id
            changed_fields.append("service_id")

        if payload.category_id is not None and payload.category_id != ticket.category_id:
            cls._validate_category_in_tenant(db, tenant_id, payload.category_id)
            old_values["category_id"] = str(ticket.category_id) if ticket.category_id else None
            new_values["category_id"] = str(payload.category_id)
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
            cls._validate_user_in_tenant(db, tenant_id, payload.assignee_id, "Assignee")
            old_values["assignee_id"] = str(ticket.assignee_id) if ticket.assignee_id else None
            new_values["assignee_id"] = str(payload.assignee_id)
            ticket.assignee_id = payload.assignee_id
            changed_fields.append("assignee_id")

        if payload.assignment_group is not None and payload.assignment_group != ticket.assignment_group:
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
            ticket.updated_at = datetime.now(timezone.utc)
            cls._record_activity(
                db=db,
                tenant_id=tenant_id,
                ticket_id=ticket.id,
                activity_type="FIELD_UPDATE",
                content=f"Updated fields: {', '.join(changed_fields)}",
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
            ticket.resolved_at = datetime.now(timezone.utc)

        if target_status == "CLOSED":
            ticket.closed_at = datetime.now(timezone.utc)
            ticket.closed_by = actor_id

        if current_status == "RESOLVED" and target_status == "IN_PROGRESS":
            # Reopening ticket
            ticket.resolved_at = None

        ticket.status = target_status
        ticket.updated_at = datetime.now(timezone.utc)

        cls._record_activity(
            db=db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            activity_type="STATUS_CHANGE",
            content=f"Status changed from {current_status} to {target_status}" + (f": {payload.status_reason}" if payload.status_reason else ""),
            old_value={"status": current_status},
            new_value={"status": target_status, "status_reason": payload.status_reason},
            actor_id=actor_id,
        )

        cls._emit_audit_event(
            db=db,
            tenant_id=tenant_id,
            ticket=ticket,
            action="status_changed",
            actor_id=actor_id,
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
            cls._validate_user_in_tenant(db, tenant_id, payload.assignee_id, "Assignee")

        old_assignee = str(ticket.assignee_id) if ticket.assignee_id else None
        new_assignee = str(payload.assignee_id) if payload.assignee_id else None
        old_group = ticket.assignment_group
        new_group = payload.assignment_group

        ticket.assignee_id = payload.assignee_id
        if payload.assignment_group is not None:
            ticket.assignment_group = payload.assignment_group

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
        return ticket

    @classmethod
    def declare_major_incident(
        cls,
        db: Session,
        tenant_id: UUID,
        incident_id: UUID,
        actor_id: UUID,
        payload: MajorIncidentDeclareRequest,
    ) -> ITSMMajorIncident:
        ticket = cls.get_incident(db, tenant_id, incident_id)
        existing = db.query(ITSMMajorIncident).filter(
            ITSMMajorIncident.tenant_id == tenant_id,
            ITSMMajorIncident.ticket_id == incident_id,
        ).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Incident is already declared as major")

        commander_id = payload.incident_commander_id or actor_id
        cls._validate_user_in_tenant(db, tenant_id, commander_id, "Incident commander")
        major_incident = ITSMMajorIncident(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            incident_commander_id=commander_id,
            declared_by_id=actor_id,
            bridge_url=payload.bridge_url,
            communication_channel=payload.communication_channel,
            impacted_business_units=payload.impacted_business_units,
            customer_impact_description=payload.customer_impact_description,
            executive_summary=payload.executive_summary,
        )
        ticket.is_major_incident = True
        ticket.updated_at = datetime.now(timezone.utc)
        db.add(major_incident)
        cls._record_activity(
            db, tenant_id, ticket.id, "MAJOR_INCIDENT_DECLARED",
            content="Major incident declared",
            new_value={"incident_commander_id": str(commander_id)}, actor_id=actor_id,
        )
        cls._emit_audit_event(db, tenant_id, ticket, "major_incident_declared", actor_id)
        db.commit()
        db.refresh(major_incident)
        return major_incident

    @classmethod
    def get_major_incident(cls, db: Session, tenant_id: UUID, incident_id: UUID) -> ITSMMajorIncident:
        cls.get_incident(db, tenant_id, incident_id)
        major_incident = db.query(ITSMMajorIncident).filter(
            ITSMMajorIncident.tenant_id == tenant_id,
            ITSMMajorIncident.ticket_id == incident_id,
        ).first()
        if not major_incident:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Major incident not found")
        return major_incident

    @classmethod
    def update_major_incident(
        cls, db: Session, tenant_id: UUID, incident_id: UUID, actor_id: UUID, payload: MajorIncidentUpdateRequest,
    ) -> ITSMMajorIncident:
        major_incident = cls.get_major_incident(db, tenant_id, incident_id)
        changes = payload.model_dump(exclude_unset=True)
        audit_changes = payload.model_dump(mode="json", exclude_unset=True)
        if "incident_commander_id" in changes and changes["incident_commander_id"] is not None:
            cls._validate_user_in_tenant(db, tenant_id, changes["incident_commander_id"], "Incident commander")
        for field, value in changes.items():
            setattr(major_incident, field, value)
        if changes:
            ticket = cls.get_incident(db, tenant_id, incident_id)
            ticket.updated_at = datetime.now(timezone.utc)
            cls._record_activity(
                db, tenant_id, ticket.id, "MAJOR_INCIDENT_UPDATED",
                content="Major incident command details updated", new_value=audit_changes, actor_id=actor_id,
            )
            cls._emit_audit_event(db, tenant_id, ticket, "major_incident_updated", actor_id)
            db.commit()
            db.refresh(major_incident)
        return major_incident

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
        return activity

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
            .filter(
                ITSMTicketActivity.ticket_id == incident_id,
                ITSMTicketActivity.tenant_id == tenant_id,
            )
            .order_by(ITSMTicketActivity.created_at.asc())
            .all()
        )
