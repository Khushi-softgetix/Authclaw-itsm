"""API router for ITSM Approvals."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import logging
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_, text
from sqlalchemy.orm import Session, joinedload

from app.core.auth import get_current_tenant, get_tenant_db
from app.db.models import (
    ApprovalAudit,
    ITSMServiceCatalogItem,
    ITSMServiceRequestDetail,
    ITSMTicket,
    ITSMTicketActivity,
    PendingApproval,
    User,
)
from app.schemas.itsm_approvals import (
    ITSMApprovalActionRequest,
    ITSMApprovalResponse,
)
from app.services.audit_store import append_audit_event

logger = logging.getLogger("authclaw.itsm.approvals")

router = APIRouter()


def _get_user_role_and_validate(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    """Validate user has active ITSM access and retrieve role."""
    try:
        row = db.execute(
            text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
            {"tenant_id": str(tenant_id), "user_id": str(user_id)},
        ).first()
        if row:
            if not row.has_itsm_access:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User does not have active ITSM access in this tenant",
                )
            if row.itsm_role:
                return str(row.itsm_role).upper()
    except HTTPException:
        raise
    except Exception:
        pass
    return "REQUESTER"


def _build_approval_response(
    approval: PendingApproval,
    db: Session,
    ticket: Optional[ITSMTicket] = None,
) -> ITSMApprovalResponse:
    """Transform PendingApproval into ITSMApprovalResponse."""
    payload = approval.action_payload or {}
    ticket_id_val = None
    if ticket:
        ticket_id_val = ticket.id
    elif payload.get("ticket_id"):
        try:
            ticket_id_val = UUID(str(payload["ticket_id"]))
        except Exception:
            ticket_id_val = None
    elif approval.action_id:
        try:
            ticket_id_val = UUID(str(approval.action_id))
        except Exception:
            ticket_id_val = None

    if not ticket and ticket_id_val:
        ticket = db.query(ITSMTicket).filter(
            ITSMTicket.id == ticket_id_val,
            ITSMTicket.tenant_id == approval.tenant_id,
        ).first()

    requester_email = payload.get("requester_email")
    if not requester_email and approval.requester_id:
        u = db.query(User).filter(User.id == approval.requester_id).first()
        if u:
            requester_email = u.email

    approver_email = None
    if approval.approver_id:
        app_u = db.query(User).filter(User.id == approval.approver_id).first()
        if app_u:
            approver_email = app_u.email

    title = payload.get("title") or (ticket.title if ticket else approval.action_description)
    description = payload.get("description") or (ticket.description if ticket else None)
    ticket_number = payload.get("ticket_number") or (ticket.ticket_number if ticket else None)
    ticket_status = ticket.status if ticket else None
    catalog_item_name = payload.get("catalog_item_name")
    service_name = payload.get("service_name")
    quantity = payload.get("quantity") or 1
    priority = payload.get("priority") or (ticket.priority if ticket else "P3")
    urgency = payload.get("urgency") or (ticket.urgency if ticket else "MEDIUM")
    impact = payload.get("impact") or (ticket.impact if ticket else "MEDIUM")
    form_data = payload.get("form_data") or {}

    # If catalog details were missing from payload, inspect request details
    if ticket and (not catalog_item_name or not form_data):
        detail = db.query(ITSMServiceRequestDetail).options(
            joinedload(ITSMServiceRequestDetail.catalog_item)
        ).filter(
            ITSMServiceRequestDetail.ticket_id == ticket.id,
            ITSMServiceRequestDetail.tenant_id == approval.tenant_id,
        ).first()
        if detail:
            if detail.catalog_item and not catalog_item_name:
                catalog_item_name = detail.catalog_item.name
            if detail.submitted_form_data and not form_data:
                form_data = detail.submitted_form_data
                if "quantity" in form_data and quantity == 1:
                    quantity = form_data.get("quantity", 1)

    return ITSMApprovalResponse(
        id=approval.id,
        tenant_id=approval.tenant_id,
        ticket_id=ticket_id_val,
        ticket_number=ticket_number,
        title=title,
        description=description,
        status=approval.status,
        ticket_status=ticket_status,
        action_type=approval.action_type,
        action_description=approval.action_description,
        catalog_item_name=catalog_item_name,
        service_name=service_name,
        quantity=quantity,
        priority=priority,
        urgency=urgency,
        impact=impact,
        requester_id=approval.requester_id,
        requester_email=requester_email,
        approver_id=approval.approver_id,
        approver_email=approver_email,
        form_data=form_data,
        resolution_reason=approval.resolution_reason,
        expires_at=approval.expires_at,
        approved_at=approval.approved_at,
        created_at=approval.created_at,
        updated_at=approval.updated_at,
    )


def _sync_pending_service_requests(db: Session, tenant_id: UUID) -> None:
    """Ensure any existing PENDING service requests have a corresponding PendingApproval record."""
    try:
        pending_tickets = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "SERVICE_REQUEST",
                ITSMTicket.status == "PENDING",
            )
            .all()
        )
        if not pending_tickets:
            return

        now = datetime.now(timezone.utc)
        for ticket in pending_tickets:
            existing = (
                db.query(PendingApproval)
                .filter(
                    PendingApproval.tenant_id == tenant_id,
                    or_(
                        PendingApproval.action_id == str(ticket.id),
                        PendingApproval.action_description.like(f"%{ticket.ticket_number}%"),
                    ),
                )
                .first()
            )
            if not existing:
                detail = (
                    db.query(ITSMServiceRequestDetail)
                    .options(joinedload(ITSMServiceRequestDetail.catalog_item).joinedload(ITSMServiceCatalogItem.service))
                    .filter(
                        ITSMServiceRequestDetail.ticket_id == ticket.id,
                        ITSMServiceRequestDetail.tenant_id == tenant_id,
                    )
                    .first()
                )
                cat_name = detail.catalog_item.name if detail and detail.catalog_item else ticket.title
                srv_name = (
                    detail.catalog_item.service.name
                    if detail and detail.catalog_item and detail.catalog_item.service
                    else None
                )
                form_data = detail.submitted_form_data if detail else {}
                qty = form_data.get("quantity", 1) if form_data else 1

                u = db.query(User).filter(User.id == ticket.requester_id).first()
                req_email = u.email if u else None

                approval = PendingApproval(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    action_id=str(ticket.id),
                    action_type="service_request_approval",
                    action_description=f"Approval for Service Request: {ticket.title} ({ticket.ticket_number})",
                    action_payload={
                        "ticket_id": str(ticket.id),
                        "ticket_number": ticket.ticket_number,
                        "title": ticket.title,
                        "description": ticket.description,
                        "catalog_item_name": cat_name,
                        "service_name": srv_name,
                        "quantity": qty,
                        "priority": ticket.priority,
                        "urgency": ticket.urgency,
                        "impact": ticket.impact,
                        "requester_id": str(ticket.requester_id),
                        "requester_email": req_email,
                        "form_data": form_data,
                    },
                    status="PENDING",
                    requester_id=ticket.requester_id,
                    expires_at=now + timedelta(days=14),
                    created_at=ticket.created_at or now,
                    updated_at=ticket.updated_at or now,
                )
                db.add(approval)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Failed syncing pending service requests to approvals: %s", e)


@router.get(
    "",
    response_model=list[ITSMApprovalResponse],
    summary="List ITSM approvals",
    description="Retrieve approval requests for catalog requests requiring review.",
)
def list_approvals(
    request: Request,
    status_filter: Optional[str] = Query(default=None, alias="status", description="Filter by status (PENDING, APPROVED, REJECTED, or ALL)"),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _get_user_role_and_validate(db, t_id, actor_id)

    # Sync any orphaned PENDING service requests
    _sync_pending_service_requests(db, t_id)

    query = db.query(PendingApproval).filter(
        PendingApproval.tenant_id == t_id,
        PendingApproval.action_type.in_(["service_request_approval", "change_request_cab", "catalog_item_approval"]),
    )

    if status_filter and status_filter.upper() != "ALL":
        query = query.filter(PendingApproval.status == status_filter.upper())

    approvals = query.order_by(PendingApproval.created_at.desc()).limit(100).all()
    return [_build_approval_response(a, db) for a in approvals]


@router.post(
    "/{approval_id}/approve",
    response_model=ITSMApprovalResponse,
    summary="Approve an ITSM request",
    description="Approve a pending catalog service request and transition the ticket to IN_PROGRESS.",
)
def approve_request(
    approval_id: str,
    request: Request,
    body: Optional[ITSMApprovalActionRequest] = None,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _get_user_role_and_validate(db, t_id, actor_id)

    # Lookup approval by ID or action_id (ticket_id)
    approval = None
    try:
        app_uuid = UUID(approval_id)
        approval = db.query(PendingApproval).filter(
            PendingApproval.tenant_id == t_id,
            PendingApproval.id == app_uuid,
        ).first()
    except ValueError:
        pass

    if not approval:
        approval = db.query(PendingApproval).filter(
            PendingApproval.tenant_id == t_id,
            PendingApproval.action_id == approval_id,
        ).first()

    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found")

    if approval.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Approval already resolved: {approval.status}",
        )

    now = datetime.now(timezone.utc)
    approval.status = "APPROVED"
    approval.approver_id = actor_id
    approval.approved_at = now
    approval.updated_at = now
    if body and body.reason:
        approval.resolution_reason = body.reason.strip()

    # Find underlying ticket
    ticket_id = approval.action_id or (approval.action_payload or {}).get("ticket_id")
    ticket = None
    if ticket_id:
        try:
            ticket = db.query(ITSMTicket).filter(
                ITSMTicket.tenant_id == t_id,
                ITSMTicket.id == UUID(str(ticket_id)),
            ).first()
        except ValueError:
            ticket = None

    if ticket:
        prev_status = ticket.status
        ticket.status = "IN_PROGRESS"
        ticket.status_reason = "Approved by manager"
        ticket.updated_at = now

        activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=t_id,
            ticket_id=ticket.id,
            activity_type="STATUS_CHANGE",
            content=f"Request approved. Status changed from {prev_status} to IN_PROGRESS",
            activity_metadata={
                "old_status": prev_status,
                "new_status": "IN_PROGRESS",
                "status_reason": "Approved by manager",
            },
            actor_id=actor_id,
            created_at=now,
        )
        db.add(activity)

    # Immutable approval audit log
    audit = ApprovalAudit(
        id=uuid4(),
        tenant_id=t_id,
        approval_id=approval.id,
        actor_id=actor_id,
        action="APPROVED",
    )
    db.add(audit)

    try:
        sp = db.begin_nested()
        try:
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(t_id)},
            )
            append_audit_event(
                db,
                {
                    "id": str(uuid4()),
                    "idempotency_key": f"itsm:approval:{approval.id}:approved:{now.timestamp()}",
                    "tenant_id": str(t_id),
                    "timestamp": now,
                    "actor_id": str(actor_id),
                    "actor_type": "user",
                    "action": "itsm.approval.approved",
                    "request_id": str(ticket.id) if ticket else str(approval.id),
                    "provider": "itsm",
                    "reason": (body.reason.strip() if body and body.reason else "Request approved"),
                    "response_status": 200,
                    "frameworks_affected": ["ITIL"],
                    "execution_trace": [
                        f"approval_id={approval.id}",
                        f"ticket_id={ticket.id if ticket else None}",
                        f"status=APPROVED",
                    ],
                },
            )
            sp.commit()
        except Exception as e:
            sp.rollback()
            logger.warning("Audit event emission failed for approval: %s", e)
    except Exception as e:
        logger.warning("Audit savepoint failed: %s", e)

    db.commit()
    db.refresh(approval)
    if ticket:
        db.refresh(ticket)

    return _build_approval_response(approval, db, ticket)


@router.post(
    "/{approval_id}/reject",
    response_model=ITSMApprovalResponse,
    summary="Reject an ITSM request",
    description="Reject a pending catalog service request and transition the ticket to CANCELLED.",
)
def reject_request(
    approval_id: str,
    request: Request,
    body: Optional[ITSMApprovalActionRequest] = None,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _get_user_role_and_validate(db, t_id, actor_id)

    # Lookup approval by ID or action_id (ticket_id)
    approval = None
    try:
        app_uuid = UUID(approval_id)
        approval = db.query(PendingApproval).filter(
            PendingApproval.tenant_id == t_id,
            PendingApproval.id == app_uuid,
        ).first()
    except ValueError:
        pass

    if not approval:
        approval = db.query(PendingApproval).filter(
            PendingApproval.tenant_id == t_id,
            PendingApproval.action_id == approval_id,
        ).first()

    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found")

    if approval.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Approval already resolved: {approval.status}",
        )

    now = datetime.now(timezone.utc)
    reason = body.reason.strip() if body and body.reason else "Request rejected by manager"
    approval.status = "REJECTED"
    approval.approver_id = actor_id
    approval.resolution_reason = reason
    approval.updated_at = now

    # Find underlying ticket
    ticket_id = approval.action_id or (approval.action_payload or {}).get("ticket_id")
    ticket = None
    if ticket_id:
        try:
            ticket = db.query(ITSMTicket).filter(
                ITSMTicket.tenant_id == t_id,
                ITSMTicket.id == UUID(str(ticket_id)),
            ).first()
        except ValueError:
            ticket = None

    if ticket:
        prev_status = ticket.status
        ticket.status = "CANCELLED"
        ticket.status_reason = reason
        ticket.updated_at = now

        activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=t_id,
            ticket_id=ticket.id,
            activity_type="STATUS_CHANGE",
            content=f"Request rejected ({reason}). Status changed from {prev_status} to CANCELLED",
            activity_metadata={
                "old_status": prev_status,
                "new_status": "CANCELLED",
                "status_reason": reason,
            },
            actor_id=actor_id,
            created_at=now,
        )
        db.add(activity)

    # Immutable approval audit log
    audit = ApprovalAudit(
        id=uuid4(),
        tenant_id=t_id,
        approval_id=approval.id,
        actor_id=actor_id,
        action="REJECTED",
    )
    db.add(audit)

    try:
        sp = db.begin_nested()
        try:
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(t_id)},
            )
            append_audit_event(
                db,
                {
                    "id": str(uuid4()),
                    "idempotency_key": f"itsm:approval:{approval.id}:rejected:{now.timestamp()}",
                    "tenant_id": str(t_id),
                    "timestamp": now,
                    "actor_id": str(actor_id),
                    "actor_type": "user",
                    "action": "itsm.approval.rejected",
                    "request_id": str(ticket.id) if ticket else str(approval.id),
                    "provider": "itsm",
                    "reason": reason,
                    "response_status": 200,
                    "frameworks_affected": ["ITIL"],
                    "execution_trace": [
                        f"approval_id={approval.id}",
                        f"ticket_id={ticket.id if ticket else None}",
                        f"status=REJECTED",
                    ],
                },
            )
            sp.commit()
        except Exception as e:
            sp.rollback()
            logger.warning("Audit event emission failed for rejection: %s", e)
    except Exception as e:
        logger.warning("Audit savepoint failed: %s", e)

    db.commit()
    db.refresh(approval)
    if ticket:
        db.refresh(ticket)

    return _build_approval_response(approval, db, ticket)
