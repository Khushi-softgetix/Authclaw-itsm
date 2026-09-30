"""Domain and database service for ITSM Service Requests (Step 6)."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import logging
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import inspect, or_, text
from sqlalchemy.orm import Session, joinedload

from app.db.models import (
    ITSMService,
    ITSMServiceCatalogItem,
    ITSMServiceRequestDetail,
    ITSMTeam,
    ITSMTicket,
    ITSMTicketActivity,
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

        title = payload.title.strip() if payload.title and payload.title.strip() else (
            catalog_item.name if catalog_item else "Service Request"
        )

        from app.services.itsm_incident_service import IncidentService
        ticket_number = IncidentService.generate_ticket_number(db, tenant_id, "SERVICE_REQUEST", prefix="REQ")

        initial_status = "ASSIGNED" if fulfillment_group else "NEW"
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
                        "idempotency_key": f"itsm:request:{ticket.id}:status_changed:{datetime.now(timezone.utc).timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": datetime.now(timezone.utc),
                        "actor_id": str(actor_id) if actor_id else None,
                        "actor_type": "user",
                        "action": "itsm.request.status_changed",
                        "request_id": str(ticket.id),
                        "provider": "itsm",
                        "reason": payload.status_reason or f"Status changed to {target_status}",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"ticket_id={ticket.id}",
                            f"ticket_number={ticket.ticket_number}",
                            f"old_status={current_status}",
                            f"new_status={target_status}",
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
        db.commit()
        db.refresh(activity)
        return activity

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
