"""API router for ITSM Approvals."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import logging
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload

from app.core.auth import deny_itsm_auditor_mutation, get_current_tenant, get_tenant_db
from app.db.models import (
    ApprovalAudit,
    ITSMServiceCatalogItem,
    ITSMServiceRequestDetail,
    ITSMTicket,
    ITSMTicketActivity,
    Notification,
    PendingApproval,
    User,
)
from app.schemas.itsm_approvals import (
    ITSMApprovalActionRequest,
    ITSMApprovalResponse,
)
from app.services.audit_store import append_audit_event
from app.services.notifications import add_notification

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


def _validate_approval_decision_authority(
    *,
    db: Session,
    approval: PendingApproval,
    ticket: Optional[ITSMTicket],
    actor_id: UUID,
    user_role: str,
    platform_role: str,
    request: Request,
) -> None:
    """Validate decision authority and enforce Segregation of Duties (SoD).

    Rules:
    1. Auditor access is strictly read-only (denied with audit log).
    2. Segregation of Duties (SoD): Requesters can NEVER approve or reject their own requests.
    3. Role authorization: Only authorized manager/administrator roles can decide requests.
    4. Assigned approver: If an approver is explicitly designated, other users (except platform admin) cannot decide.
    """
    # 1. Auditor read-only enforcement
    if user_role == "AUDITOR":
        deny_itsm_auditor_mutation(request, db, user_role, "itsm.approval.decision")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Auditor access is read-only",
        )

    # 2. Segregation of Duties (SoD) check
    payload = approval.action_payload or {}
    payload_requester_str = payload.get("requester_id")
    is_requester = False
    if approval.requester_id and approval.requester_id == actor_id:
        is_requester = True
    elif ticket and ticket.requester_id == actor_id:
        is_requester = True
    elif payload_requester_str:
        try:
            if UUID(str(payload_requester_str)) == actor_id:
                is_requester = True
        except (ValueError, TypeError):
            pass

    if is_requester:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Segregation of duties violation: Requesters cannot approve or reject their own requests.",
        )

    # 3. Role-based authorization: fail closed if role cannot be established or unauthorized
    # Authorized roles from existing role definitions:
    # PLATFORM_ADMINISTRATOR, SERVICE_LEAD, INCIDENT_MANAGER, PROCESS_CHANGE_MANAGER
    # Unauthorized roles: REQUESTER, SERVICE_AGENT, AUDITOR
    authorized_roles = {
        "PLATFORM_ADMINISTRATOR",
        "SERVICE_LEAD",
        "INCIDENT_MANAGER",
        "PROCESS_CHANGE_MANAGER",
    }
    is_platform_admin = (
        user_role == "PLATFORM_ADMINISTRATOR"
        or platform_role in {"ADMIN", "SUPER_ADMIN"}
        or str(getattr(request.state, "user_role", "")).lower() in {"owner", "admin"}
    )

    if not is_platform_admin and user_role not in authorized_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Forbidden: Role '{user_role}' is not authorized to approve or reject service requests. Manager or Administrator authorization required.",
        )

    # 4. Approver assignment check (if explicitly designated)
    if approval.approver_id and approval.approver_id != actor_id and not is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: This request is assigned to a different approver.",
        )


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

    assignment_group = ticket.assignment_group if ticket else None
    assignee_id = ticket.assignee_id if ticket else None
    assignee_email = None
    if ticket and hasattr(ticket, "assignee") and ticket.assignee:
        assignee_email = ticket.assignee.email
    elif assignee_id:
        ass_u = db.query(User).filter(User.id == assignee_id).first()
        if ass_u:
            assignee_email = ass_u.email

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
        assignment_group=assignment_group,
        assignee_id=assignee_id,
        assignee_email=assignee_email,
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


def _process_approval_decision(
    *,
    approval_id: str,
    target_action: str,  # "APPROVED" or "REJECTED"
    request: Request,
    body: Optional[ITSMApprovalActionRequest],
    db: Session,
    tenant_id: str,
) -> ITSMApprovalResponse:
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    user_role = _get_user_role_and_validate(db, t_id, actor_id)
    platform_role = str(getattr(request.state, "platform_role", "") or "").upper()

    # Extract client-supplied idempotency key from headers or request body
    client_idempotency_key = (
        request.headers.get("Idempotency-Key")
        or request.headers.get("X-Idempotency-Key")
        or (body.idempotency_key if body and hasattr(body, "idempotency_key") else None)
    )
    if client_idempotency_key:
        client_idempotency_key = client_idempotency_key.strip() or None

    # Normalize reasons
    if target_action == "APPROVED":
        raw_reason = body.reason.strip() if body and body.reason else ""
        saved_reason = raw_reason if raw_reason else None
        audit_reason = raw_reason if raw_reason else "Request approved"
    else:
        raw_reason = body.reason.strip() if body and body.reason else ""
        saved_reason = raw_reason if raw_reason else "Request rejected by manager"
        audit_reason = saved_reason

    # Row-lock PendingApproval using with_for_update() to guarantee atomic decisions
    approval = None
    try:
        app_uuid = UUID(approval_id)
        approval = (
            db.query(PendingApproval)
            .filter(
                PendingApproval.tenant_id == t_id,
                PendingApproval.id == app_uuid,
            )
            .with_for_update()
            .first()
        )
    except ValueError:
        pass

    if not approval:
        approval = (
            db.query(PendingApproval)
            .filter(
                PendingApproval.tenant_id == t_id,
                PendingApproval.action_id == approval_id,
            )
            .with_for_update()
            .first()
        )

    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval request not found",
        )

    # Find and row-lock underlying ticket if present
    ticket_id = approval.action_id or (approval.action_payload or {}).get("ticket_id")
    ticket = None
    if ticket_id:
        try:
            ticket = (
                db.query(ITSMTicket)
                .filter(
                    ITSMTicket.tenant_id == t_id,
                    ITSMTicket.id == UUID(str(ticket_id)),
                )
                .with_for_update()
                .first()
            )
        except ValueError:
            ticket = None

    # Check for existing idempotency key across the tenant
    if client_idempotency_key:
        prior_audit = (
            db.query(ApprovalAudit)
            .filter(
                ApprovalAudit.tenant_id == t_id,
                func.json_extract_path_text(ApprovalAudit.details, "idempotency_key") == client_idempotency_key,
            )
            .first()
        )
        if prior_audit:
            # Reused across different approval requests -> 409 Conflict
            if prior_audit.approval_id != approval.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Idempotency key collision: key already used with a different approval request",
                )
            # Reused on the same approval: verify identical decision action and reason
            prior_reason = (prior_audit.reason or "").strip()
            req_reason = (raw_reason or "").strip()
            if prior_audit.action == target_action and prior_reason == req_reason:
                # Exact replay: return saved result without duplicate side-effects
                return _build_approval_response(approval, db, ticket)
            else:
                # Reused key with conflicting decision action or payload -> 409 Conflict
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Idempotency key collision: key already used with a different payload",
                )

    # Check if approval has already been resolved
    if approval.status != "PENDING":
        # Check if identical repeat (double-click without explicit idempotency key)
        norm_saved_reason = (approval.resolution_reason or "").strip()
        norm_req_reason = (raw_reason or "").strip()
        if approval.status == target_action and (
            norm_saved_reason == norm_req_reason
            or (target_action == "REJECTED" and norm_saved_reason == "Request rejected by manager" and not norm_req_reason)
        ):
            return _build_approval_response(approval, db, ticket)

        # Conflicting decision on an already resolved approval -> 409 Conflict
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Approval already resolved: {approval.status}",
        )

    # Validate approval authority and enforce Segregation of Duties (SoD)
    _validate_approval_decision_authority(
        db=db,
        approval=approval,
        ticket=ticket,
        actor_id=actor_id,
        user_role=user_role,
        platform_role=platform_role,
        request=request,
    )

    now = datetime.now(timezone.utc)
    payload_copy = dict(approval.action_payload or {})
    if client_idempotency_key:
        payload_copy["idempotency_key"] = client_idempotency_key
    payload_copy["decision_action"] = target_action
    payload_copy["decision_reason"] = raw_reason
    approval.action_payload = payload_copy

    approval.status = target_action
    approval.approver_id = actor_id
    approval.updated_at = now
    if target_action == "APPROVED":
        approval.approved_at = now
        approval.resolution_reason = saved_reason
    else:
        approval.resolution_reason = saved_reason

    if ticket:
        prev_status = ticket.status
        if target_action == "APPROVED":
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
        else:
            ticket.status = "CANCELLED"
            ticket.status_reason = saved_reason
            ticket.updated_at = now
            activity = ITSMTicketActivity(
                id=uuid4(),
                tenant_id=t_id,
                ticket_id=ticket.id,
                activity_type="STATUS_CHANGE",
                content=f"Request rejected ({saved_reason}). Status changed from {prev_status} to CANCELLED",
                activity_metadata={
                    "old_status": prev_status,
                    "new_status": "CANCELLED",
                    "status_reason": saved_reason,
                },
                actor_id=actor_id,
                created_at=now,
            )
        db.add(activity)

    # Immutable approval audit log with idempotency metadata
    audit = ApprovalAudit(
        id=uuid4(),
        tenant_id=t_id,
        approval_id=approval.id,
        actor_id=actor_id,
        action=target_action,
        reason=raw_reason,
        details={
            "idempotency_key": client_idempotency_key,
            "reason": raw_reason,
            "action": target_action,
        },
        created_at=now,
    )
    db.add(audit)

    # Stable audit log idempotency key (no timestamp)
    stable_audit_key = (
        f"itsm:approval:{approval.id}:{client_idempotency_key}"
        if client_idempotency_key
        else f"itsm:approval:{approval.id}:{target_action.lower()}"
    )

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
                    "idempotency_key": stable_audit_key,
                    "tenant_id": str(t_id),
                    "timestamp": now,
                    "actor_id": str(actor_id),
                    "actor_type": "user",
                    "action": f"itsm.approval.{target_action.lower()}",
                    "request_id": str(ticket.id) if ticket else str(approval.id),
                    "provider": "itsm",
                    "reason": audit_reason,
                    "response_status": 200,
                    "frameworks_affected": ["ITIL"],
                    "execution_trace": [
                        f"approval_id={approval.id}",
                        f"ticket_id={ticket.id if ticket else None}",
                        f"status={target_action}",
                    ],
                },
            )
            sp.commit()
        except Exception as e:
            sp.rollback()
            logger.warning("Audit event emission failed for approval: %s", e)
    except Exception as e:
        logger.warning("Audit savepoint failed: %s", e)

    # Dispatch in-app notification to requester
    recipient_id = approval.requester_id or (ticket.requester_id if ticket else None)
    if recipient_id:
        try:
            recent_cutoff = now - timedelta(seconds=10)
            notif_type = "itsm.request.approval" if target_action == "APPROVED" else "itsm.request.rejection"
            existing = (
                db.query(Notification)
                .filter(
                    Notification.tenant_id == t_id,
                    Notification.user_id == recipient_id,
                    Notification.type == notif_type,
                    Notification.link == f"/itsm/requests/{ticket.id if ticket else approval.id}",
                    Notification.created_at >= recent_cutoff,
                )
                .first()
            )
            if not existing:
                ticket_ref = ticket.ticket_number if (ticket and ticket.ticket_number) else (f"Request {ticket.id}" if ticket else "Service Request")
                ticket_title = ticket.title if (ticket and ticket.title) else ticket_ref
                if target_action == "APPROVED":
                    add_notification(
                        db,
                        tenant_id=t_id,
                        user_id=recipient_id,
                        type=notif_type,
                        severity="info",
                        title=f"Service Request Approved: {ticket_ref}",
                        body=f"Your request '{ticket_title}' has been approved and moved to in-progress fulfillment.",
                        link=f"/itsm/requests/{ticket.id if ticket else approval.id}",
                    )
                else:
                    body_msg = f"Your request '{ticket_title}' was rejected."
                    if saved_reason:
                        body_msg += f" Reason: {saved_reason}"
                    add_notification(
                        db,
                        tenant_id=t_id,
                        user_id=recipient_id,
                        type=notif_type,
                        severity="warning",
                        title=f"Service Request Rejected: {ticket_ref}",
                        body=body_msg,
                        link=f"/itsm/requests/{ticket.id if ticket else approval.id}",
                    )
        except Exception as e:
            logger.warning("Failed to dispatch approval notification: %s", e)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(approval)
    if ticket:
        db.refresh(ticket)

    return _build_approval_response(approval, db, ticket)


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
    return _process_approval_decision(
        approval_id=approval_id,
        target_action="APPROVED",
        request=request,
        body=body,
        db=db,
        tenant_id=tenant_id,
    )


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
    return _process_approval_decision(
        approval_id=approval_id,
        target_action="REJECTED",
        request=request,
        body=body,
        db=db,
        tenant_id=tenant_id,
    )
