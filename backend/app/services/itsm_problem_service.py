"""Service layer for ITSM Problem Management."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload

from app.db.models import ITSMProblemDetail, ITSMTicket, ITSMTicketActivity, User
from app.schemas.itsm_problems import (
    ProblemActivityResponse,
    ProblemCloseRequest,
    ProblemDetailData,
    ProblemDetailResponse,
    ProblemInvestigationUpdateRequest,
    ProblemResolveRequest,
    ProblemStatsResponse,
    ProblemSummaryResponse,
    RelatedIncidentItem,
)
from app.services.audit_store import append_audit_event




class ProblemService:
    @classmethod
    def list_problems(
        cls,
        db: Session,
        tenant_id: UUID,
        *,
        status_filter: Optional[str] = None,
        search: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[ProblemSummaryResponse]:
        query = (
            db.query(ITSMTicket)
            .options(
                joinedload(ITSMTicket.service),
                joinedload(ITSMTicket.assignee),
            )
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
        )

        if status_filter:
            norm_status = status_filter.strip().upper()
            if norm_status == "OPEN":
                query = query.filter(ITSMTicket.status.in_(["NEW", "ASSIGNED", "OPEN"]))
            elif norm_status == "IN_PROGRESS":
                query = query.filter(ITSMTicket.status == "IN_PROGRESS")
            elif norm_status == "RESOLVED":
                query = query.filter(ITSMTicket.status == "RESOLVED")
            elif norm_status == "CLOSED":
                query = query.filter(ITSMTicket.status == "CLOSED")
            elif norm_status != "ALL":
                query = query.filter(ITSMTicket.status == norm_status)

        if search and search.strip():
            pattern = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    ITSMTicket.ticket_number.ilike(pattern),
                    ITSMTicket.title.ilike(pattern),
                    ITSMTicket.description.ilike(pattern),
                )
            )

        tickets = (
            query.order_by(ITSMTicket.updated_at.desc(), ITSMTicket.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        if not tickets:
            return []

        # Fetch related incident counts for these problem tickets
        ticket_ids = [t.id for t in tickets]
        count_rows = (
            db.query(
                ITSMTicket.linked_problem_id,
                func.count(ITSMTicket.id).label("cnt"),
            )
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "INCIDENT",
                ITSMTicket.linked_problem_id.in_(ticket_ids),
            )
            .group_by(ITSMTicket.linked_problem_id)
            .all()
        )
        counts_map = {row[0]: row[1] for row in count_rows}

        results: list[ProblemSummaryResponse] = []
        for t in tickets:
            service_name = t.service.name if t.service else None
            assignee_email = t.assignee.email if t.assignee else None
            rel_cnt = counts_map.get(t.id, 0)
            results.append(
                ProblemSummaryResponse(
                    id=t.id,
                    ticket_number=t.ticket_number,
                    title=t.title,
                    description=t.description,
                    status=t.status,
                    priority=t.priority,
                    service_id=t.service_id,
                    service_name=service_name,
                    assignment_group=t.assignment_group,
                    assignee_id=t.assignee_id,
                    assignee_email=assignee_email,
                    created_at=t.created_at,
                    updated_at=t.updated_at,
                    related_incidents_count=rel_cnt,
                )
            )
        return results

    @classmethod
    def get_problem_stats(cls, db: Session, tenant_id: UUID) -> ProblemStatsResponse:
        base_filter = [
            ITSMTicket.tenant_id == tenant_id,
            ITSMTicket.ticket_type == "PROBLEM",
        ]

        total = db.query(func.count(ITSMTicket.id)).filter(*base_filter).scalar() or 0

        open_cnt = (
            db.query(func.count(ITSMTicket.id))
            .filter(*base_filter, ITSMTicket.status.in_(["NEW", "ASSIGNED", "OPEN"]))
            .scalar()
            or 0
        )

        in_progress_cnt = (
            db.query(func.count(ITSMTicket.id))
            .filter(*base_filter, ITSMTicket.status == "IN_PROGRESS")
            .scalar()
            or 0
        )

        resolved_cnt = (
            db.query(func.count(ITSMTicket.id))
            .filter(*base_filter, ITSMTicket.status == "RESOLVED")
            .scalar()
            or 0
        )

        return ProblemStatsResponse(
            open=open_cnt,
            in_progress=in_progress_cnt,
            resolved=resolved_cnt,
            total=total,
        )

    @classmethod
    def get_problem(cls, db: Session, tenant_id: UUID, problem_id: UUID) -> ProblemDetailResponse:
        ticket = (
            db.query(ITSMTicket)
            .options(
                joinedload(ITSMTicket.service),
                joinedload(ITSMTicket.assignee),
            )
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )

        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem '{problem_id}' not found",
            )

        # Related incidents linked to this problem
        incidents = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "INCIDENT",
                ITSMTicket.linked_problem_id == problem_id,
            )
            .order_by(ITSMTicket.created_at.desc())
            .all()
        )

        related_items = [
            RelatedIncidentItem(
                id=inc.id,
                ticket_number=inc.ticket_number,
                title=inc.title,
                status=inc.status,
                priority=inc.priority,
                created_at=inc.created_at,
            )
            for inc in incidents
        ]

        # Problem details (KEDB / RCA) if present
        problem_detail_rec = (
            db.query(ITSMProblemDetail)
            .filter(
                ITSMProblemDetail.tenant_id == tenant_id,
                ITSMProblemDetail.ticket_id == problem_id,
            )
            .first()
        )

        detail_data: Optional[ProblemDetailData] = None
        if problem_detail_rec:
            detail_data = ProblemDetailData(
                known_error=problem_detail_rec.known_error,
                root_cause_summary=problem_detail_rec.root_cause_summary,
                workaround_summary=problem_detail_rec.workaround_summary,
                permanent_solution=problem_detail_rec.permanent_solution,
                rca_document_url=problem_detail_rec.rca_document_url,
                assigned_investigator_id=problem_detail_rec.assigned_investigator_id,
                identified_at=problem_detail_rec.identified_at,
                resolved_at=problem_detail_rec.resolved_at,
            )

        service_name = ticket.service.name if ticket.service else None
        assignee_email = ticket.assignee.email if ticket.assignee else None

        closed_by_email = None
        if ticket.closed_by:
            closed_user = db.query(User).filter(User.id == ticket.closed_by).first()
            if closed_user:
                closed_by_email = closed_user.email

        return ProblemDetailResponse(
            id=ticket.id,
            ticket_number=ticket.ticket_number,
            title=ticket.title,
            description=ticket.description,
            status=ticket.status,
            priority=ticket.priority,
            service_id=ticket.service_id,
            service_name=service_name,
            assignment_group=ticket.assignment_group,
            assignee_id=ticket.assignee_id,
            assignee_email=assignee_email,
            configuration_item_id=ticket.configuration_item_id,
            created_at=ticket.created_at,
            updated_at=ticket.updated_at,
            related_incidents_count=len(related_items),
            related_incidents=related_items,
            problem_details=detail_data,
            resolution_summary=ticket.resolution_summary,
            resolution_code=ticket.resolution_code,
            resolved_at=ticket.resolved_at,
            closed_at=ticket.closed_at,
            closed_by_email=closed_by_email,
        )


    @classmethod
    def update_investigation(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
        payload: ProblemInvestigationUpdateRequest,
        actor_id: UUID,
    ) -> ProblemDetailResponse:
        ticket = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem '{problem_id}' not found",
            )

        actor_user = db.query(User).filter(User.id == actor_id).first()
        actor_email = actor_user.email if actor_user else None

        now = datetime.now(timezone.utc)
        status_changed = False
        old_status = ticket.status

        # 1. Update ticket status if provided
        if payload.status:
            new_status = payload.status.strip().upper()
            allowed_statuses = {"OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"}
            if new_status not in allowed_statuses:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status '{payload.status}'. Allowed statuses: {', '.join(sorted(allowed_statuses))}",
                )
            if new_status != old_status:
                ticket.status = new_status
                status_changed = True
                if new_status in ("RESOLVED", "CLOSED") and not ticket.resolved_at:
                    ticket.resolved_at = now
                elif new_status not in ("RESOLVED", "CLOSED"):
                    ticket.resolved_at = None

                # Log status change activity
                status_activity = ITSMTicketActivity(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    ticket_id=problem_id,
                    actor_type="USER",
                    actor_id=actor_id,
                    activity_type="STATUS_CHANGE",
                    content=f"Problem status changed from {old_status} to {new_status}.",
                    activity_metadata={
                        "old_status": old_status,
                        "new_status": new_status,
                        "actor_email": actor_email,
                    },
                    created_at=now,
                )
                db.add(status_activity)

        # 2. Get or create ITSMProblemDetail
        detail_rec = (
            db.query(ITSMProblemDetail)
            .filter(
                ITSMProblemDetail.tenant_id == tenant_id,
                ITSMProblemDetail.ticket_id == problem_id,
            )
            .first()
        )
        is_new_detail = False
        if not detail_rec:
            is_new_detail = True
            detail_rec = ITSMProblemDetail(
                id=uuid4(),
                tenant_id=tenant_id,
                ticket_id=problem_id,
                assigned_investigator_id=actor_id,
                identified_at=now,
                known_error=False,
                created_at=now,
                updated_at=now,
            )
            db.add(detail_rec)

        investigation_fields_updated = False
        if payload.root_cause_summary is not None:
            detail_rec.root_cause_summary = payload.root_cause_summary
            investigation_fields_updated = True
        if payload.workaround_summary is not None:
            detail_rec.workaround_summary = payload.workaround_summary
            investigation_fields_updated = True
        if payload.known_error is not None:
            detail_rec.known_error = payload.known_error
            investigation_fields_updated = True
        if payload.permanent_solution is not None:
            detail_rec.permanent_solution = payload.permanent_solution
            investigation_fields_updated = True
        if payload.rca_document_url is not None:
            detail_rec.rca_document_url = payload.rca_document_url
            investigation_fields_updated = True

        if ticket.status in ("RESOLVED", "CLOSED") and not detail_rec.resolved_at:
            detail_rec.resolved_at = now
        elif ticket.status not in ("RESOLVED", "CLOSED"):
            detail_rec.resolved_at = None

        if investigation_fields_updated or is_new_detail or status_changed:
            detail_rec.updated_at = now
            ticket.updated_at = now

        # 3. Log Investigation note if provided or log update activity
        if payload.investigation_notes and payload.investigation_notes.strip():
            note_activity = ITSMTicketActivity(
                id=uuid4(),
                tenant_id=tenant_id,
                ticket_id=problem_id,
                actor_type="USER",
                actor_id=actor_id,
                activity_type="INVESTIGATION",
                content=payload.investigation_notes.strip(),
                activity_metadata={
                    "actor_email": actor_email,
                    "known_error": detail_rec.known_error,
                    "note_type": "investigation_note",
                },
                created_at=now,
            )
            db.add(note_activity)
        elif investigation_fields_updated:
            update_activity = ITSMTicketActivity(
                id=uuid4(),
                tenant_id=tenant_id,
                ticket_id=problem_id,
                actor_type="USER",
                actor_id=actor_id,
                activity_type="INVESTIGATION",
                content="Problem investigation details updated.",
                activity_metadata={
                    "actor_email": actor_email,
                    "known_error": detail_rec.known_error,
                },
                created_at=now,
            )
            db.add(update_activity)

        db.commit()
        db.refresh(ticket)

        # 4. Audit trail
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
                        "idempotency_key": f"itsm:problem:{ticket.id}:investigation:{datetime.now(timezone.utc).timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": datetime.now(timezone.utc),
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.problem.investigated",
                        "request_id": str(ticket.id),
                        "provider": "itsm",
                        "reason": "Problem investigation updated",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"problem_id={ticket.id}",
                            f"ticket_number={ticket.ticket_number}",
                            f"status={ticket.status}",
                            f"known_error={detail_rec.known_error}",
                        ],
                    },
                )
                sp.commit()
            except Exception:
                sp.rollback()
        except Exception:
            pass

        return cls.get_problem(db, tenant_id, problem_id)

    @classmethod
    def list_problem_activities(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
    ) -> list[ProblemActivityResponse]:
        ticket = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem '{problem_id}' not found",
            )

        activities = (
            db.query(ITSMTicketActivity)
            .options(joinedload(ITSMTicketActivity.actor))
            .filter(
                ITSMTicketActivity.tenant_id == tenant_id,
                ITSMTicketActivity.ticket_id == problem_id,
            )
            .order_by(ITSMTicketActivity.created_at.desc())
            .all()
        )

        results: list[ProblemActivityResponse] = []
        for act in activities:
            actor_email = act.actor.email if act.actor else None
            if not actor_email and act.activity_metadata:
                actor_email = act.activity_metadata.get("actor_email")
            results.append(
                ProblemActivityResponse(
                    id=act.id,
                    ticket_id=act.ticket_id,
                    activity_type=act.activity_type,
                    actor_id=act.actor_id,
                    actor_email=actor_email,
                    content=act.content,
                    metadata=act.activity_metadata or {},
                    created_at=act.created_at,
                )
            )
        return results

    @classmethod
    def resolve_problem(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
        payload: ProblemResolveRequest,
        actor_id: UUID,
    ) -> ProblemDetailResponse:
        ticket = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem '{problem_id}' not found",
            )

        if ticket.status == "CLOSED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot resolve a CLOSED problem. Problem lifecycle has concluded.",
            )

        actor_user = db.query(User).filter(User.id == actor_id).first()
        actor_email = actor_user.email if actor_user else None

        now = datetime.now(timezone.utc)
        old_status = ticket.status

        # 1. Update ticket lifecycle to RESOLVED
        ticket.status = "RESOLVED"
        ticket.resolution_summary = payload.resolution_summary.strip()
        ticket.resolved_at = now
        ticket.updated_at = now

        # 2. Get or create ITSMProblemDetail
        detail_rec = (
            db.query(ITSMProblemDetail)
            .filter(
                ITSMProblemDetail.tenant_id == tenant_id,
                ITSMProblemDetail.ticket_id == problem_id,
            )
            .first()
        )
        if not detail_rec:
            detail_rec = ITSMProblemDetail(
                id=uuid4(),
                tenant_id=tenant_id,
                ticket_id=problem_id,
                assigned_investigator_id=actor_id,
                identified_at=now,
                known_error=False,
                created_at=now,
                updated_at=now,
            )
            db.add(detail_rec)

        detail_rec.resolved_at = now
        detail_rec.updated_at = now

        if payload.permanent_solution is not None:
            detail_rec.permanent_solution = payload.permanent_solution.strip() if payload.permanent_solution else None
        if payload.workaround_summary is not None:
            detail_rec.workaround_summary = payload.workaround_summary.strip() if payload.workaround_summary else None
        if payload.root_cause_summary is not None:
            detail_rec.root_cause_summary = payload.root_cause_summary.strip() if payload.root_cause_summary else None
        if payload.rca_document_url is not None:
            detail_rec.rca_document_url = payload.rca_document_url.strip() if payload.rca_document_url else None

        # 3. Log resolution activity
        activity_content = f"Problem resolved: {payload.resolution_summary.strip()}"
        if payload.resolution_notes and payload.resolution_notes.strip():
            activity_content += f"\nResolution notes: {payload.resolution_notes.strip()}"

        resolution_activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem_id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="RESOLUTION",
            content=activity_content,
            activity_metadata={
                "old_status": old_status,
                "new_status": "RESOLVED",
                "actor_email": actor_email,
                "resolution_summary": payload.resolution_summary.strip(),
            },
            created_at=now,
        )
        db.add(resolution_activity)

        db.commit()
        db.refresh(ticket)

        # 4. Audit trail
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
                        "idempotency_key": f"itsm:problem:{ticket.id}:resolve:{datetime.now(timezone.utc).timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": datetime.now(timezone.utc),
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.problem.resolved",
                        "request_id": str(ticket.id),
                        "provider": "itsm",
                        "reason": f"Problem resolved: {payload.resolution_summary.strip()[:100]}",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"problem_id={ticket.id}",
                            f"ticket_number={ticket.ticket_number}",
                            f"old_status={old_status}",
                            "new_status=RESOLVED",
                            f"resolution_summary={payload.resolution_summary.strip()[:60]}",
                        ],
                    },
                )
                sp.commit()
            except Exception:
                sp.rollback()
        except Exception:
            pass

        return cls.get_problem(db, tenant_id, problem_id)

    @classmethod
    def close_problem(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
        payload: Optional[ProblemCloseRequest],
        actor_id: UUID,
    ) -> ProblemDetailResponse:
        ticket = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem '{problem_id}' not found",
            )

        if ticket.status == "CLOSED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Problem is already CLOSED",
            )

        if ticket.status != "RESOLVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Problem cannot be closed from status '{ticket.status}'. Problem must be RESOLVED before closing.",
            )

        actor_user = db.query(User).filter(User.id == actor_id).first()
        actor_email = actor_user.email if actor_user else None

        now = datetime.now(timezone.utc)
        old_status = ticket.status

        # 1. Update ticket lifecycle to CLOSED
        ticket.status = "CLOSED"
        ticket.closed_at = now
        ticket.closed_by = actor_id
        ticket.updated_at = now

        # 2. Activity
        closure_notes = payload.closure_notes.strip() if payload and payload.closure_notes and payload.closure_notes.strip() else None
        activity_content = "Problem closed: Lifecycle concluded."
        if closure_notes:
            activity_content += f" Closure notes: {closure_notes}"

        closure_activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem_id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="STATUS_CHANGE",
            content=activity_content,
            activity_metadata={
                "old_status": old_status,
                "new_status": "CLOSED",
                "actor_email": actor_email,
                "closure_notes": closure_notes,
            },
            created_at=now,
        )
        db.add(closure_activity)

        db.commit()
        db.refresh(ticket)

        # 3. Audit trail
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
                        "idempotency_key": f"itsm:problem:{ticket.id}:close:{datetime.now(timezone.utc).timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": datetime.now(timezone.utc),
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.problem.closed",
                        "request_id": str(ticket.id),
                        "provider": "itsm",
                        "reason": closure_notes or "Problem closed",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"problem_id={ticket.id}",
                            f"ticket_number={ticket.ticket_number}",
                            f"old_status={old_status}",
                            "new_status=CLOSED",
                        ],
                    },
                )
                sp.commit()
            except Exception:
                sp.rollback()
        except Exception:
            pass

        return cls.get_problem(db, tenant_id, problem_id)


