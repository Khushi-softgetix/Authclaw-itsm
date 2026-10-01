"""Domain and database service for ITSM Service Requests (Step 6)."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher
import logging
import re
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, inspect, or_, text
from sqlalchemy.orm import Session, joinedload

from app.db.models import (
    ITSMService,
    ITSMServiceCatalogItem,
    ITSMServiceRequestDetail,
    ITSMTeam,
    ITSMTeamMember,
    ITSMTicket,
    ITSMTicketActivity,
    ITSMUserAccess,
    Notification,
    PendingApproval,
    User,
)
from app.schemas.itsm_incidents import IncidentActivityCreateRequest
from app.schemas.itsm_requests import (
    ServiceRequestAssignRequest,
    ServiceRequestCreateRequest,
    ServiceRequestDetailData,
    ServiceRequestResponse,
    ServiceRequestStatusUpdateRequest,
)
from app.services.audit_store import append_audit_event
from app.services.notifications import create_notification

logger = logging.getLogger("authclaw.itsm.requests")

ALLOWED_REQUEST_TRANSITIONS: dict[str, set[str]] = {
    "NEW": {"ASSIGNED", "IN_PROGRESS", "CANCELLED"},
    "ASSIGNED": {"IN_PROGRESS", "CANCELLED"},
    "IN_PROGRESS": {"PENDING", "RESOLVED", "CANCELLED"},
    "PENDING": {"IN_PROGRESS", "RESOLVED", "CANCELLED"},
    "RESOLVED": {"CLOSED", "IN_PROGRESS"},
    "CLOSED": set(),
    "CANCELLED": set(),
}


class RequestService:
    @staticmethod
    def _build_response(
        ticket: ITSMTicket,
        detail: Optional[ITSMServiceRequestDetail] = None,
    ) -> ServiceRequestResponse:
        """Convert an ITSMTicket and its detail snapshot into ServiceRequestResponse."""
        detail_data = None
        if detail:
            cat_name = detail.catalog_item.name if detail.catalog_item else None
            detail_data = ServiceRequestDetailData(
                catalog_item_id=detail.catalog_item_id,
                catalog_item_name=cat_name,
                catalog_item_version=detail.catalog_item_version,
                intake_schema_snapshot=detail.intake_schema_snapshot or {},
                submitted_form_data=detail.submitted_form_data or {},
            )

        requester_email = ticket.requester.email if ticket.requester else None
        assignee_email = ticket.assignee.email if ticket.assignee else None
        service_name = ticket.service.name if ticket.service else None

        return ServiceRequestResponse(
            id=ticket.id,
            tenant_id=ticket.tenant_id,
            ticket_number=ticket.ticket_number,
            ticket_type=ticket.ticket_type,
            title=ticket.title,
            description=ticket.description,
            impact=ticket.impact or "MEDIUM",
            urgency=ticket.urgency or "MEDIUM",
            priority=ticket.priority or "P3",
            status=ticket.status,
            status_reason=ticket.status_reason,
            source_channel=ticket.source_channel or "PORTAL",
            requester_id=ticket.requester_id,
            requester_email=requester_email,
            assignee_id=ticket.assignee_id,
            assignee_email=assignee_email,
            assignment_group=ticket.assignment_group,
            service_id=ticket.service_id,
            service_name=service_name,
            category=ticket.category or "SERVICE_REQUEST",
            sla_status=ticket.sla_status or "WITHIN_SLA",
            sla_response_due_at=ticket.sla_response_due_at,
            sla_response_met_at=ticket.sla_response_met_at,
            sla_resolution_due_at=ticket.sla_resolution_due_at,
            sla_resolution_met_at=ticket.sla_resolution_met_at,
            resolution_code=ticket.resolution_code,
            resolution_summary=ticket.resolution_summary,
            resolved_at=ticket.resolved_at,
            closed_at=ticket.closed_at,
            created_at=ticket.created_at,
            updated_at=ticket.updated_at,
            request_detail=detail_data,
        )

    @staticmethod
    def _emit_audit_event(
        db: Session,
        tenant_id: UUID,
        ticket: ITSMTicket,
        action: str,
        actor_id: UUID,
        *,
        reason: str,
        trace_items: list[str] | None = None,
        before_summary: dict[str, Any] | None = None,
        after_summary: dict[str, Any] | None = None,
    ) -> None:
        try:
            savepoint = db.begin_nested()
            try:
                db.execute(
                    text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                    {"tenant_id": str(tenant_id)},
                )
                append_audit_event(
                    db,
                    {
                        "id": str(uuid4()),
                        "idempotency_key": f"itsm:request:{ticket.id}:{action}:{datetime.now(timezone.utc).timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": datetime.now(timezone.utc),
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": f"itsm.request.{action}",
                        "request_id": str(ticket.id),
                        "context_id": str(ticket.id),
                        "event_category": "update" if action in {"status_changed", "assigned"} else "action",
                        "target_id": str(ticket.id),
                        "target_type": "service_request",
                        "before_summary": before_summary,
                        "after_summary": after_summary,
                        "provider": "itsm",
                        "reason": reason,
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": trace_items or [],
                    },
                )
                savepoint.commit()
            except Exception as exc:
                savepoint.rollback()
                logger.warning("Audit event emission failed: %s", exc)
        except Exception as exc:
            logger.warning("Audit event savepoint failed: %s", exc)

    @classmethod
    def create_request(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        payload: ServiceRequestCreateRequest,
    ) -> ServiceRequestResponse:
        """Create a new service request and snapshot catalog intake details."""
        user = db.query(User).filter(User.id == actor_id, User.tenant_id == tenant_id, User.is_active.is_(True)).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid Requester: User not found or inactive in this tenant",
            )

        catalog_item = None
        service_id = payload.service_id
        fulfillment_group = None

        if payload.catalog_item_id:
            catalog_item = (
                db.query(ITSMServiceCatalogItem)
                .options(joinedload(ITSMServiceCatalogItem.service))
                .filter(
                    ITSMServiceCatalogItem.id == payload.catalog_item_id,
                    ITSMServiceCatalogItem.tenant_id == tenant_id,
                    ITSMServiceCatalogItem.is_active.is_(True),
                )
                .first()
            )
            if not catalog_item:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Selected catalog item not found or inactive",
                )
            service_id = catalog_item.service_id
            fulfillment_group = catalog_item.fulfillment_group

        service = catalog_item.service if (catalog_item and catalog_item.service) else (
            db.query(ITSMService).filter(ITSMService.id == service_id, ITSMService.tenant_id == tenant_id).first() if service_id else None
        )

        # Resolve responsible group and assignee if not explicitly configured on catalog item
        resolved_team_name, resolved_agent_id, _ = cls.resolve_responsible_recipients(
            db=db,
            tenant_id=tenant_id,
            ticket=None,
            catalog_item=catalog_item,
            service=service,
            actor_id=actor_id,
        )

        if not fulfillment_group and resolved_team_name:
            fulfillment_group = resolved_team_name
        assignee_id = resolved_agent_id

        title = payload.title.strip() if payload.title and payload.title.strip() else (
            catalog_item.name if catalog_item else "Service Request"
        )

        from app.services.itsm_incident_service import IncidentService
        ticket_number = IncidentService.generate_ticket_number(db, tenant_id, "SERVICE_REQUEST", prefix="REQ")

        initial_status = "ASSIGNED" if (fulfillment_group or assignee_id) else "NEW"
        status_reason = None
        if catalog_item and catalog_item.approval_required:
            initial_status = "PENDING"
            status_reason = "Pending approval"
        priority = payload.priority.strip().upper() if payload.priority else "P3"
        now = datetime.now(timezone.utc)

        ticket = ITSMTicket(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_number=ticket_number,
            ticket_type="SERVICE_REQUEST",
            title=title,
            description=payload.description.strip(),
            impact=payload.impact.strip().upper() if payload.impact else "MEDIUM",
            urgency=payload.urgency.strip().upper() if payload.urgency else "MEDIUM",
            priority=priority,
            status=initial_status,
            status_reason=status_reason,
            source_channel=payload.source_channel or "PORTAL",
            requester_id=actor_id,
            assignee_id=assignee_id,
            assignment_group=fulfillment_group,
            service_id=service_id,
            category="SERVICE_REQUEST",
            sla_status="WITHIN_SLA",
            created_at=now,
            updated_at=now,
        )

        from app.services.itsm_sla_service import apply_sla_policy
        sla_policy = IncidentService._find_sla_policy(db, tenant_id, priority, service_id)
        apply_sla_policy(ticket, sla_policy, now)

        db.add(ticket)
        db.flush()

        detail = None
        if catalog_item:
            submitted = dict(payload.form_data or {})
            submitted["quantity"] = payload.quantity
            submitted["reason"] = payload.description.strip()

            detail = ITSMServiceRequestDetail(
                id=uuid4(),
                tenant_id=tenant_id,
                ticket_id=ticket.id,
                catalog_item_id=catalog_item.id,
                catalog_item_version=catalog_item.version or 1,
                intake_schema_snapshot=catalog_item.intake_schema or {},
                submitted_form_data=submitted,
                created_at=now,
            )
            db.add(detail)
            db.flush()

            if catalog_item.approval_required:
                approval = PendingApproval(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    action_id=str(ticket.id),
                    action_type="service_request_approval",
                    action_description=f"Approval for Service Request: {title} ({ticket_number})",
                    action_payload={
                        "ticket_id": str(ticket.id),
                        "ticket_number": ticket_number,
                        "title": title,
                        "catalog_item_id": str(catalog_item.id),
                        "catalog_item_name": catalog_item.name,
                        "service_name": catalog_item.service.name if catalog_item.service else None,
                        "quantity": payload.quantity,
                        "description": payload.description.strip(),
                        "priority": priority,
                        "urgency": payload.urgency.strip().upper() if payload.urgency else "MEDIUM",
                        "impact": payload.impact.strip().upper() if payload.impact else "MEDIUM",
                        "requester_id": str(actor_id),
                        "requester_email": user.email,
                        "form_data": payload.form_data or {},
                    },
                    status="PENDING",
                    requester_id=actor_id,
                    expires_at=now + timedelta(days=14),
                    created_at=now,
                    updated_at=now,
                )
                db.add(approval)
                db.flush()

        cls._record_activity(
            db=db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            activity_type="CREATED",
            content=f"Service request submitted for '{title}' (Status: {initial_status})",
            actor_id=actor_id,
        )

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
                        "idempotency_key": f"itsm:request:{ticket.id}:created:{now.timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": now,
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.request.created",
                        "request_id": str(ticket.id),
                        "provider": "itsm",
                        "reason": f"Service request submitted for {title}",
                        "response_status": 201,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"ticket_id={ticket.id}",
                            f"ticket_number={ticket.ticket_number}",
                            f"catalog_item_id={catalog_item.id if catalog_item else None}",
                            f"status={initial_status}",
                        ],
                    },
                )
                sp.commit()
            except Exception as e:
                sp.rollback()
                logger.warning("Audit event emission failed: %s", e)
        except Exception as e:
            logger.warning("Audit event savepoint failed: %s", e)

        db.commit()
        db.refresh(ticket)

        cls.notify_catalog_service_request_created(
            db=db,
            tenant_id=tenant_id,
            ticket=ticket,
            catalog_item=catalog_item,
            service=service,
            actor_id=actor_id,
            quantity=payload.quantity,
        )

        return cls._build_response(ticket, detail)

    @classmethod
    def list_requests(
        cls,
        db: Session,
        tenant_id: UUID,
        *,
        status_filter: Optional[str] = None,
        priority: Optional[str] = None,
        service_id: Optional[UUID] = None,
        assignee_id: Optional[UUID] = None,
        assigned_to_me: bool = False,
        actor_id: Optional[UUID] = None,
        requester_id: Optional[UUID] = None,
        search: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[ServiceRequestResponse]:
        """List service requests within tenant context."""
        query = (
            db.query(ITSMTicket)
            .options(
                joinedload(ITSMTicket.requester),
                joinedload(ITSMTicket.assignee),
                joinedload(ITSMTicket.service),
            )
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "SERVICE_REQUEST",
            )
        )

        if assigned_to_me and actor_id:
            query = query.filter(ITSMTicket.assignee_id == actor_id)
        elif assignee_id:
            query = query.filter(ITSMTicket.assignee_id == assignee_id)

        if requester_id:
            query = query.filter(ITSMTicket.requester_id == requester_id)

        if status_filter:
            norm_status = status_filter.strip().upper()
            if norm_status == "OPEN":
                query = query.filter(ITSMTicket.status.in_(["NEW", "ASSIGNED"]))
            elif norm_status == "IN_PROGRESS":
                query = query.filter(ITSMTicket.status == "IN_PROGRESS")
            elif norm_status == "RESOLVED":
                query = query.filter(ITSMTicket.status.in_(["RESOLVED", "CLOSED"]))
            elif norm_status != "ALL":
                query = query.filter(ITSMTicket.status == norm_status)

        if priority:
            query = query.filter(ITSMTicket.priority == priority.strip().upper())

        if service_id:
            query = query.filter(ITSMTicket.service_id == service_id)

        if search:
            pattern = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    ITSMTicket.title.ilike(pattern),
                    ITSMTicket.description.ilike(pattern),
                    ITSMTicket.ticket_number.ilike(pattern),
                )
            )

        tickets = query.order_by(ITSMTicket.created_at.desc()).offset(offset).limit(limit).all()

        # Batch load request details for returned tickets
        ticket_ids = [t.id for t in tickets]
        details_map = {}
        if ticket_ids:
            details = (
                db.query(ITSMServiceRequestDetail)
                .options(joinedload(ITSMServiceRequestDetail.catalog_item))
                .filter(
                    ITSMServiceRequestDetail.tenant_id == tenant_id,
                    ITSMServiceRequestDetail.ticket_id.in_(ticket_ids),
                )
                .all()
            )
            for d in details:
                details_map[d.ticket_id] = d

        return [cls._build_response(t, details_map.get(t.id)) for t in tickets]

    @classmethod
    def get_request(
        cls,
        db: Session,
        tenant_id: UUID,
        request_id: UUID,
    ) -> ServiceRequestResponse:
        """Fetch a single service request with its form snapshot."""
        ticket = (
            db.query(ITSMTicket)
            .options(
                joinedload(ITSMTicket.requester),
                joinedload(ITSMTicket.assignee),
                joinedload(ITSMTicket.service),
            )
            .filter(
                ITSMTicket.id == request_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "SERVICE_REQUEST",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Service request '{request_id}' not found",
            )

        detail = (
            db.query(ITSMServiceRequestDetail)
            .options(joinedload(ITSMServiceRequestDetail.catalog_item))
            .filter(
                ITSMServiceRequestDetail.tenant_id == tenant_id,
                ITSMServiceRequestDetail.ticket_id == request_id,
            )
            .first()
        )

        return cls._build_response(ticket, detail)

    @classmethod
    def change_request_status(
        cls,
        db: Session,
        tenant_id: UUID,
        request_id: UUID,
        actor_id: UUID,
        payload: ServiceRequestStatusUpdateRequest,
    ) -> ServiceRequestResponse:
        """Execute a validated lifecycle status transition for a Service Request."""
        ticket = (
            db.query(ITSMTicket)
            .options(
                joinedload(ITSMTicket.requester),
                joinedload(ITSMTicket.assignee),
                joinedload(ITSMTicket.service),
            )
            .filter(
                ITSMTicket.id == request_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "SERVICE_REQUEST",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Service request '{request_id}' not found",
            )

        current_status = ticket.status
        target_status = payload.status.strip().upper()

        if current_status in {"CLOSED", "CANCELLED"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot transition service request in terminal status '{current_status}'",
            )

        allowed = ALLOWED_REQUEST_TRANSITIONS.get(current_status, set())
        if target_status not in allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status transition from '{current_status}' to '{target_status}'. Allowed: {sorted(list(allowed))}",
            )

        transition_time = datetime.now(timezone.utc)
        if target_status == "RESOLVED":
            ticket.resolved_at = transition_time
            ticket.sla_resolution_met_at = transition_time
            if payload.resolution_code:
                ticket.resolution_code = payload.resolution_code.strip()
            if payload.resolution_summary:
                ticket.resolution_summary = payload.resolution_summary.strip()
        elif target_status == "CLOSED":
            ticket.closed_at = transition_time
            ticket.closed_by = actor_id
        elif current_status == "RESOLVED" and target_status == "IN_PROGRESS":
            ticket.resolved_at = None
            ticket.sla_resolution_met_at = None

        ticket.status = target_status
        ticket.status_reason = payload.status_reason.strip() if payload.status_reason else ticket.status_reason
        ticket.updated_at = transition_time

        # Activity recording
        activity_content = f"Status changed from {current_status} to {target_status}"
        if payload.status_reason:
            activity_content += f": {payload.status_reason}"
        elif target_status == "RESOLVED" and payload.resolution_summary:
            activity_content += f": {payload.resolution_summary}"

        new_val: dict[str, Any] = {"status": target_status, "status_reason": payload.status_reason}
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
            db,
            tenant_id,
            ticket,
            "status_changed",
            actor_id,
            reason=payload.status_reason or f"Status changed to {target_status}",
            trace_items=[
                f"ticket_id={ticket.id}",
                f"ticket_number={ticket.ticket_number}",
                f"old_status={current_status}",
                f"new_status={target_status}",
            ],
            before_summary={"status": current_status},
            after_summary=new_val,
        )

        db.commit()
        db.refresh(ticket)

        detail = (
            db.query(ITSMServiceRequestDetail)
            .options(joinedload(ITSMServiceRequestDetail.catalog_item))
            .filter(
                ITSMServiceRequestDetail.tenant_id == tenant_id,
                ITSMServiceRequestDetail.ticket_id == request_id,
            )
            .first()
        )
        return cls._build_response(ticket, detail)

    @classmethod
    def assign_request(
        cls,
        db: Session,
        tenant_id: UUID,
        request_id: UUID,
        actor_id: UUID,
        payload: ServiceRequestAssignRequest,
    ) -> ServiceRequestResponse:
        """Assign or reassign a service request."""
        ticket = (
            db.query(ITSMTicket)
            .options(
                joinedload(ITSMTicket.requester),
                joinedload(ITSMTicket.assignee),
                joinedload(ITSMTicket.service),
            )
            .filter(
                ITSMTicket.id == request_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "SERVICE_REQUEST",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Service request '{request_id}' not found",
            )

        if ticket.status in {"CLOSED", "CANCELLED"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot assign service request in terminal status '{ticket.status}'",
            )

        old_assignee_id = ticket.assignee_id
        old_group = ticket.assignment_group

        if payload.assignee_id:
            assignee_user = db.query(User).filter(User.id == payload.assignee_id, User.tenant_id == tenant_id).first()
            if not assignee_user or not assignee_user.is_active:
                raise HTTPException(status_code=400, detail="Invalid assignee: User not active or in another tenant")
            ticket.assignee_id = payload.assignee_id

        if payload.assignment_group is not None:
            group_name = payload.assignment_group.strip()
            if group_name and inspect(db.get_bind()).has_table("itsm_teams", schema="public"):
                team = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant_id, ITSMTeam.name == group_name, ITSMTeam.is_active.is_(True)).first()
                if not team:
                    raise HTTPException(status_code=400, detail="Assignment group must be an active team in this tenant")
            ticket.assignment_group = group_name or None

        if ticket.status == "NEW" and (ticket.assignee_id or ticket.assignment_group):
            ticket.status = "ASSIGNED"

        ticket.updated_at = datetime.now(timezone.utc)

        cls._record_activity(
            db=db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            activity_type="ASSIGNMENT",
            content=f"Assignment updated: team={ticket.assignment_group}, assignee={ticket.assignee_id}",
            old_value={"assignee_id": str(old_assignee_id) if old_assignee_id else None, "assignment_group": old_group},
            new_value={"assignee_id": str(ticket.assignee_id) if ticket.assignee_id else None, "assignment_group": ticket.assignment_group},
            actor_id=actor_id,
        )

        cls._emit_audit_event(
            db,
            tenant_id,
            ticket,
            "assigned",
            actor_id,
            reason="Service request assignment updated",
            trace_items=[f"ticket_id={ticket.id}", f"ticket_number={ticket.ticket_number}"],
            before_summary={
                "assignee_id": str(old_assignee_id) if old_assignee_id else None,
                "assignment_group": old_group,
            },
            after_summary={
                "assignee_id": str(ticket.assignee_id) if ticket.assignee_id else None,
                "assignment_group": ticket.assignment_group,
            },
        )

        db.commit()
        db.refresh(ticket)

        detail = (
            db.query(ITSMServiceRequestDetail)
            .options(joinedload(ITSMServiceRequestDetail.catalog_item))
            .filter(
                ITSMServiceRequestDetail.tenant_id == tenant_id,
                ITSMServiceRequestDetail.ticket_id == request_id,
            )
            .first()
        )
        return cls._build_response(ticket, detail)

    @classmethod
    def list_activities(
        cls,
        db: Session,
        tenant_id: UUID,
        request_id: UUID,
    ) -> list[ITSMTicketActivity]:
        """List all activity entries for a service request."""
        # Ensure ticket exists in tenant
        ticket = (
            db.query(ITSMTicket.id)
            .filter(
                ITSMTicket.id == request_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "SERVICE_REQUEST",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(status_code=404, detail="Service request not found")

        return (
            db.query(ITSMTicketActivity)
            .options(joinedload(ITSMTicketActivity.actor))
            .filter(
                ITSMTicketActivity.ticket_id == request_id,
                ITSMTicketActivity.tenant_id == tenant_id,
            )
            .order_by(ITSMTicketActivity.created_at.asc())
            .all()
        )

    @classmethod
    def add_activity(
        cls,
        db: Session,
        tenant_id: UUID,
        request_id: UUID,
        actor_id: UUID,
        payload: IncidentActivityCreateRequest,
    ) -> ITSMTicketActivity:
        """Add a comment or internal note to a service request."""
        ticket = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == request_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "SERVICE_REQUEST",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(status_code=404, detail="Service request not found")

        act_type = payload.activity_type.strip().upper() if payload.activity_type else "COMMENT"
        activity = cls._record_activity(
            db=db,
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            activity_type=act_type,
            content=payload.content.strip(),
            actor_id=actor_id,
            is_internal=payload.is_internal,
        )

        ticket.updated_at = datetime.now(timezone.utc)
        cls._emit_audit_event(
            db,
            tenant_id,
            ticket,
            "activity_added",
            actor_id,
            reason="Service request activity added",
            trace_items=[f"activity_type={act_type}", f"is_internal={payload.is_internal}"],
            after_summary={"activity_type": act_type, "is_internal": payload.is_internal},
        )
        db.commit()
        db.refresh(activity)

        # Notify requester if this is a public comment from an agent/non-requester
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

            ticket_num = ticket.ticket_number or "REQ"
            title = f"New reply on {ticket_num}"
            body = "Requester has replied to your service request."
            link = f"/itsm/requests/{ticket.id}"

            # Ensure tenant context is set for RLS before querying/inserting notifications
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )

            # Deduplication: suppress duplicate notification within 5 seconds for the same request comment
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
                type="itsm.request.comment",
                severity="info",
                title=title,
                body=body,
                link=link,
            )
        except Exception as exc:
            logger.warning("Failed to dispatch assignee comment notification for request %s: %s", getattr(ticket, "ticket_number", ticket.id), exc)
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

            ticket_num = ticket.ticket_number or "REQ"
            title = f"New reply on {ticket_num}"
            if ticket.title:
                body = f"Agent has replied to your service request '{ticket.title}'."
            else:
                body = "Agent has replied to your service request."
            link = f"/itsm/requests/{ticket.id}"

            # Ensure tenant context is set for RLS before querying/inserting notifications
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )

            # Deduplication: suppress duplicate notification within 5 seconds for the same request comment
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
                type="itsm.request.comment",
                severity="info",
                title=title,
                body=body,
                link=link,
            )
        except Exception as exc:
            logger.warning("Failed to dispatch requester comment notification for request %s: %s", getattr(ticket, "ticket_number", ticket.id), exc)
            return None

    @classmethod
    def resolve_responsible_recipients(
        cls,
        db: Session,
        tenant_id: UUID,
        ticket: Optional[ITSMTicket] = None,
        catalog_item: Optional[ITSMServiceCatalogItem] = None,
        service: Optional[ITSMService] = None,
        actor_id: Optional[UUID] = None,
    ) -> tuple[Optional[str], Optional[UUID], list[UUID]]:
        """
        Identify responsible team and individual agent for a catalog item / service,
        and resolve recipient user IDs according to project rules:
        - If an individual agent is configured/assigned, notify that agent.
        - If only a team is configured, notify active members of that team in the tenant.
        - Do not notify every service agent in the tenant.
        - Do not invent a recipient if no valid assignment exists.
        - Never notify the requester (actor_id).
        """
        try:
            # Ensure tenant context is set for RLS before querying users / access / teams
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )

            # 1. Identify candidate individual agent
            candidate_agent_id: Optional[UUID] = None
            if ticket and ticket.assignee_id:
                candidate_agent_id = ticket.assignee_id
            elif service and service.owner_user_id:
                candidate_agent_id = service.owner_user_id

            # Validate candidate agent if present
            resolved_agent_id: Optional[UUID] = None
            if candidate_agent_id:
                agent_user = (
                    db.query(User)
                    .filter(
                        User.id == candidate_agent_id,
                        User.tenant_id == tenant_id,
                        User.is_active.is_(True),
                    )
                    .first()
                )
                if agent_user and (not actor_id or str(agent_user.id) != str(actor_id)):
                    access = (
                        db.query(ITSMUserAccess)
                        .filter(
                            ITSMUserAccess.tenant_id == tenant_id,
                            ITSMUserAccess.user_id == agent_user.id,
                        )
                        .first()
                    )
                    is_agent_role = (
                        (access and access.has_itsm_access and (access.itsm_role or "").upper() not in ("REQUESTER", "AUDITOR"))
                        or (agent_user.role or "").lower() in ("agent", "admin", "owner")
                    )
                    if is_agent_role:
                        resolved_agent_id = agent_user.id

            # 2. Identify candidate team
            candidate_team_str: Optional[str] = None
            if ticket and ticket.assignment_group and ticket.assignment_group.strip():
                candidate_team_str = ticket.assignment_group.strip()
            elif catalog_item and catalog_item.fulfillment_group and catalog_item.fulfillment_group.strip():
                candidate_team_str = catalog_item.fulfillment_group.strip()
            elif service and service.escalation_team and service.escalation_team.strip():
                candidate_team_str = service.escalation_team.strip()

            active_teams = (
                db.query(ITSMTeam)
                .filter(
                    ITSMTeam.tenant_id == tenant_id,
                    ITSMTeam.is_active.is_(True),
                )
                .order_by(ITSMTeam.created_at.asc())
                .all()
            )

            matched_team: Optional[ITSMTeam] = None

            def normalize_team_str(s: str) -> str:
                s = s.lower().strip()
                for suffix in (" team", " group", " dept", " department"):
                    if s.endswith(suffix):
                        s = s[:-len(suffix)].strip()
                return s

            def words_match(a: str, b: str) -> bool:
                wa = re.findall(r'[a-z0-9]{3,}', a.lower())
                wb = re.findall(r'[a-z0-9]{3,}', b.lower())
                for w1 in wa:
                    for w2 in wb:
                        if w1 == w2:
                            return True
                        if len(w1) >= 5 and len(w2) >= 5 and (w1[:5] == w2[:5]):
                            return True
                        if w1.startswith("requir") and w2.startswith("requir"):
                            return True
                        if SequenceMatcher(None, w1, w2).ratio() >= 0.85:
                            return True
                return False

            if candidate_team_str:
                norm_cand = normalize_team_str(candidate_team_str)
                cand_matches = []
                for tm in active_teams:
                    tm_norm = normalize_team_str(tm.name)
                    if tm.name.strip().lower() == candidate_team_str.lower():
                        cand_matches.append((1, tm))
                    elif tm_norm == norm_cand:
                        cand_matches.append((2, tm))
                    elif norm_cand in tm_norm or tm_norm in norm_cand:
                        cand_matches.append((3, tm))
                if cand_matches:
                    def score_cand(item):
                        prio, tm = item
                        m_count = db.query(ITSMTeamMember).filter(ITSMTeamMember.team_id == tm.id, ITSMTeamMember.tenant_id == tenant_id).count()
                        return (prio, -m_count)
                    cand_matches.sort(key=score_cand)
                    matched_team = cand_matches[0][1]

            if not matched_team and not candidate_team_str:
                cat_name = (catalog_item.name or "").strip() if catalog_item else ""
                cat_slug = (catalog_item.slug or "").strip() if catalog_item else ""
                svc_name = (service.name or "").strip() if service else ""
                svc_slug = (service.slug or "").strip() if service else ""
                tkt_title = (ticket.title or "").strip() if ticket else ""
                combined_text = f"{cat_name} {cat_slug} {svc_name} {svc_slug} {tkt_title}".lower()

                inferred_matches = []
                for tm in active_teams:
                    t_name = tm.name.strip().lower()
                    if not t_name:
                        continue
                    if t_name in (cat_name.lower(), svc_name.lower(), cat_slug.lower(), svc_slug.lower()):
                        inferred_matches.append((1, tm))
                    elif words_match(t_name, f"{cat_name} {svc_name}"):
                        inferred_matches.append((2, tm))
                    elif len(t_name) >= 3 and (t_name in combined_text or combined_text in t_name):
                        inferred_matches.append((3, tm))

                if not inferred_matches:
                    hardware_keywords = ("pc", "laptop", "hardware", "computer", "device", "workstation")
                    if any(k in combined_text for k in hardware_keywords):
                        for tm in active_teams:
                            t_name = tm.name.strip().lower()
                            if any(target in t_name for target in ("it support", "hardware", "workplace", "desktop support")):
                                inferred_matches.append((4, tm))

                if inferred_matches:
                    def score_inf(item):
                        prio, tm = item
                        m_count = db.query(ITSMTeamMember).filter(ITSMTeamMember.team_id == tm.id, ITSMTeamMember.tenant_id == tenant_id).count()
                        return (prio, -m_count)
                    inferred_matches.sort(key=score_inf)
                    matched_team = inferred_matches[0][1]

            candidate_team_name = matched_team.name.strip() if matched_team else candidate_team_str

            # 3. Resolve recipients based on project assignment rules:
            # - If an individual agent is configured/assigned, notify that agent.
            # - If only a team is configured, notify active members of that specific team.
            # - Do not notify every agent in tenant.
            # - Do not invent a recipient if no valid assignment exists.
            recipients: list[UUID] = []
            if resolved_agent_id:
                recipients = [resolved_agent_id]
            elif matched_team:
                team_member_rows = (
                    db.query(ITSMTeamMember.user_id)
                    .outerjoin(User, (User.id == ITSMTeamMember.user_id) & (User.tenant_id == ITSMTeamMember.tenant_id))
                    .filter(
                        ITSMTeamMember.tenant_id == tenant_id,
                        ITSMTeamMember.team_id == matched_team.id,
                        or_(User.id.is_(None), User.is_active.is_(True)),
                    )
                    .all()
                )
                member_ids = {r[0] for r in team_member_rows if r[0]}
                if actor_id:
                    member_ids.discard(actor_id)

                valid_members: set[UUID] = set()
                for uid in member_ids:
                    u = db.query(User).filter(User.id == uid, User.tenant_id == tenant_id, User.is_active.is_(True)).first()
                    if not u:
                        continue
                    acc = db.query(ITSMUserAccess).filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == uid).first()
                    is_agent_role = (
                        (acc and acc.has_itsm_access and (acc.itsm_role or "").upper() not in ("REQUESTER", "AUDITOR"))
                        or (u.role or "").lower() in ("agent", "admin", "owner")
                    )
                    if is_agent_role:
                        valid_members.add(uid)
                recipients = list(valid_members)
            elif candidate_team_name:
                # Fallback by team name if entity wasn't in active_teams list
                team_member_rows = (
                    db.query(ITSMTeamMember.user_id)
                    .join(ITSMTeam, (ITSMTeam.id == ITSMTeamMember.team_id) & (ITSMTeam.tenant_id == ITSMTeamMember.tenant_id))
                    .outerjoin(User, (User.id == ITSMTeamMember.user_id) & (User.tenant_id == ITSMTeamMember.tenant_id))
                    .filter(
                        ITSMTeam.tenant_id == tenant_id,
                        ITSMTeamMember.tenant_id == tenant_id,
                        func.lower(ITSMTeam.name) == func.lower(candidate_team_name),
                        ITSMTeam.is_active.is_(True),
                        or_(User.id.is_(None), User.is_active.is_(True)),
                    )
                    .all()
                )
                member_ids = {r[0] for r in team_member_rows if r[0]}
                if actor_id:
                    member_ids.discard(actor_id)

                valid_members = set()
                for uid in member_ids:
                    u = db.query(User).filter(User.id == uid, User.tenant_id == tenant_id, User.is_active.is_(True)).first()
                    if not u:
                        continue
                    acc = db.query(ITSMUserAccess).filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == uid).first()
                    is_agent_role = (
                        (acc and acc.has_itsm_access and (acc.itsm_role or "").upper() not in ("REQUESTER", "AUDITOR"))
                        or (u.role or "").lower() in ("agent", "admin", "owner")
                    )
                    if is_agent_role:
                        valid_members.add(uid)
                recipients = list(valid_members)

            return (candidate_team_name, resolved_agent_id, recipients)
        except Exception as exc:
            logger.warning("Error resolving responsible recipients: %s", exc)
            return (None, None, [])

    @classmethod
    def notify_catalog_service_request_created(
        cls,
        db: Session,
        tenant_id: UUID,
        ticket: ITSMTicket,
        catalog_item: Optional[ITSMServiceCatalogItem] = None,
        service: Optional[ITSMService] = None,
        actor_id: Optional[UUID] = None,
        quantity: int = 1,
    ) -> list[Notification]:
        """Dispatches an in-app notification to the responsible Service Agent / team when a catalog request is created."""
        created_notifications: list[Notification] = []
        try:
            if not ticket:
                return []

            # Ensure tenant context is set for RLS before querying/inserting notifications
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )

            # Resolve responsible recipients
            _, _, recipient_ids = cls.resolve_responsible_recipients(
                db=db,
                tenant_id=tenant_id,
                ticket=ticket,
                catalog_item=catalog_item,
                service=service,
                actor_id=actor_id,
            )

            ticket_ref = getattr(ticket, "ticket_number", getattr(ticket, "id", "unknown"))

            if not recipient_ids:
                logger.info(
                    "No responsible agent or team configured for catalog request %s; skipping notification",
                    ticket_ref,
                )
                return []

            item_display_name = (
                catalog_item.name
                if catalog_item and catalog_item.name
                else (service.name if service and service.name else (ticket.title or "Service Request"))
            )
            title = f"New service request: {ticket.ticket_number}"
            body = f"Requester has submitted a new service request for '{item_display_name}' (Quantity: {quantity})."
            link = f"/itsm/requests/{ticket.id}"

            for recipient_id in recipient_ids:
                # Deduplication: ensure one notification per recipient for this service request
                existing = (
                    db.query(Notification)
                    .filter(
                        Notification.tenant_id == tenant_id,
                        Notification.user_id == recipient_id,
                        Notification.type == "itsm.request.created",
                        Notification.link == link,
                    )
                    .first()
                )
                if existing:
                    created_notifications.append(existing)
                    continue

                notif = create_notification(
                    db=db,
                    tenant_id=tenant_id,
                    user_id=recipient_id,
                    type="itsm.request.created",
                    severity="info",
                    title=title,
                    body=body,
                    link=link,
                )
                if notif:
                    created_notifications.append(notif)

            return created_notifications
        except Exception as exc:
            logger.warning(
                "Failed to dispatch catalog request creation notification for ticket %s: %s",
                getattr(ticket, "ticket_number", getattr(ticket, "id", "unknown")),
                exc,
            )
            return []

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
            activity_type=activity_type,
            actor_id=actor_id,
            actor_type=actor_type,
            content=content,
            activity_metadata=meta,
            created_at=datetime.now(timezone.utc),
        )
        db.add(activity)
        db.flush()
        return activity
