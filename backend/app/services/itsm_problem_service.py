"""Service layer for ITSM Problem Management."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload

from app.db.models import (
    ITSMChangeRequest,
    ITSMChangeRequestCI,
    ITSMProblemDetail,
    ITSMTicket,
    ITSMTicketActivity,
    User,
)
from app.schemas.itsm_changes import ChangeDetailResponse, ChangeSummaryResponse
from app.schemas.itsm_problems import (
    CreateChangeFromProblemRequest,
    ProblemActivityResponse,
    ProblemCloseRequest,
    ProblemDetailData,
    ProblemDetailResponse,
    ProblemInvestigationUpdateRequest,
    ProblemResolveRequest,
    ProblemStatsResponse,
    ProblemSummaryResponse,
    RelatedIncidentItem,
    ReportRecurringProblemRequest,
    ReportRecurringProblemResponse,
    KnownErrorLookupItem,
    LinkIncidentProblemResponse,
    PublishWorkaroundRequest,
    RetireWorkaroundRequest,
    WorkaroundGovernanceResponse,
)
from app.services.audit_store import append_audit_event
from app.services.itsm_change_service import ITSMChangeService
from app.services.itsm_incident_service import IncidentService

logger = logging.getLogger("authclaw.itsm.problems")


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
                symptoms=problem_detail_rec.symptoms,
                root_cause_summary=problem_detail_rec.root_cause_summary,
                workaround_summary=problem_detail_rec.workaround_summary,
                workaround_status=problem_detail_rec.workaround_status,
                workaround_approved_at=problem_detail_rec.workaround_approved_at,
                workaround_approved_by_id=problem_detail_rec.workaround_approved_by_id,
                workaround_expires_at=problem_detail_rec.workaround_expires_at,
                review_due_at=problem_detail_rec.review_due_at,
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
            related_changes=cls.get_related_changes(db, tenant_id, problem_id),
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
            allowed_statuses = {"NEW", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"}
            if new_status not in allowed_statuses:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status '{payload.status}'. Allowed statuses: {', '.join(sorted(allowed_statuses))}",
                )
            if old_status == "CLOSED" and new_status != "CLOSED":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot reopen a CLOSED problem. Problem lifecycle has concluded.",
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
        fields_set = payload.model_fields_set
        if "root_cause_summary" in fields_set:
            detail_rec.root_cause_summary = payload.root_cause_summary
            investigation_fields_updated = True
        if "workaround_summary" in fields_set:
            detail_rec.workaround_summary = payload.workaround_summary
            investigation_fields_updated = True
        if "known_error" in fields_set:
            detail_rec.known_error = payload.known_error if payload.known_error is not None else False
            investigation_fields_updated = True
        if "permanent_solution" in fields_set:
            detail_rec.permanent_solution = payload.permanent_solution
            investigation_fields_updated = True
        if "symptoms" in fields_set:
            detail_rec.symptoms = payload.symptoms
            investigation_fields_updated = True
        if "workaround_expires_at" in fields_set:
            detail_rec.workaround_expires_at = payload.workaround_expires_at
            investigation_fields_updated = True
        if "review_due_at" in fields_set:
            detail_rec.review_due_at = payload.review_due_at
            investigation_fields_updated = True
        if "rca_document_url" in fields_set:
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

    @classmethod
    def get_related_changes(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
    ) -> list[ChangeSummaryResponse]:
        """Fetch all currently active related changes linked to this problem."""
        problem = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not problem:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem ticket '{problem_id}' not found",
            )

        activities = (
            db.query(ITSMTicketActivity)
            .filter(
                ITSMTicketActivity.tenant_id == tenant_id,
                ITSMTicketActivity.ticket_id == problem_id,
                ITSMTicketActivity.activity_type.in_(["CHANGE_LINKED", "CHANGE_UNLINKED"]),
            )
            .order_by(ITSMTicketActivity.created_at.asc())
            .all()
        )

        linked_change_ids: set[UUID] = set()
        for act in activities:
            meta = act.activity_metadata or {}
            chg_str = meta.get("change_id")
            if not chg_str:
                continue
            try:
                chg_uuid = UUID(chg_str)
            except (ValueError, TypeError):
                continue
            if act.activity_type == "CHANGE_LINKED":
                linked_change_ids.add(chg_uuid)
            elif act.activity_type == "CHANGE_UNLINKED":
                linked_change_ids.discard(chg_uuid)

        if not linked_change_ids:
            return []

        changes = (
            db.query(ITSMChangeRequest)
            .options(
                joinedload(ITSMChangeRequest.service),
                joinedload(ITSMChangeRequest.assigned_to),
            )
            .filter(
                ITSMChangeRequest.tenant_id == tenant_id,
                ITSMChangeRequest.id.in_(linked_change_ids),
            )
            .order_by(ITSMChangeRequest.created_at.desc())
            .all()
        )

        results: list[ChangeSummaryResponse] = []
        for chg in changes:
            service_name = chg.service.name if chg.service else None
            assignee_email = chg.assigned_to.email if chg.assigned_to else None
            results.append(
                ChangeSummaryResponse(
                    id=chg.id,
                    change_number=chg.change_number,
                    title=chg.title,
                    description=chg.description,
                    status=chg.status,
                    change_type=chg.change_type,
                    risk_level=chg.risk_level,
                    impact_level=chg.impact_level,
                    service_id=chg.service_id,
                    service_name=service_name,
                    assigned_team=chg.assigned_team,
                    assigned_to_id=chg.assigned_to_id,
                    assignee_email=assignee_email,
                    earliest_start_at=chg.earliest_start_at,
                    latest_finish_at=chg.latest_finish_at,
                    actual_start_at=chg.actual_start_at,
                    actual_finish_at=chg.actual_finish_at,
                    created_at=chg.created_at,
                    updated_at=chg.updated_at,
                )
            )
        return results

    @classmethod
    def link_change(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
        change_id: UUID,
        actor_id: UUID,
        actor_email: Optional[str] = None,
    ) -> list[ChangeSummaryResponse]:
        """Link an existing Change Request to a Problem Ticket."""
        problem = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not problem:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem ticket '{problem_id}' not found",
            )

        change = (
            db.query(ITSMChangeRequest)
            .filter(
                ITSMChangeRequest.id == change_id,
                ITSMChangeRequest.tenant_id == tenant_id,
            )
            .first()
        )
        if not change:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Change request '{change_id}' not found in current tenant",
            )

        # Check if already active
        existing_linked = cls.get_related_changes(db, tenant_id, problem_id)
        if any(c.id == change_id for c in existing_linked):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Change request '{change.change_number}' is already linked to Problem '{problem.ticket_number}'",
            )

        now = datetime.now(timezone.utc)
        activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem_id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="CHANGE_LINKED",
            content=f"Change {change.change_number} linked to Problem {problem.ticket_number}",
            activity_metadata={
                "change_id": str(change.id),
                "change_number": change.change_number,
                "problem_id": str(problem.id),
                "problem_number": problem.ticket_number,
                "action": "LINK",
                "actor_email": actor_email,
            },
            created_at=now,
        )
        db.add(activity)
        problem.updated_at = now

        # Audit event on change record
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
                        "idempotency_key": f"itsm:change:{change.id}:link_problem:{problem.id}:{now.timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": now,
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.change.problem_linked",
                        "request_id": str(change.id),
                        "policy_id": str(change.id),
                        "provider": "itsm",
                        "reason": f"Change {change.change_number} linked to Problem {problem.ticket_number}",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"problem_id={problem.id}",
                            f"problem_number={problem.ticket_number}",
                            f"change_id={change.id}",
                            f"change_number={change.change_number}",
                        ],
                    },
                )
                sp.commit()
            except Exception as audit_err:
                sp.rollback()
                logger.warning("Failed to emit audit event for link_change: %s", audit_err)
        except Exception:
            pass

        db.commit()

        return cls.get_related_changes(db, tenant_id, problem_id)

    @classmethod
    def unlink_change(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
        change_id: UUID,
        actor_id: UUID,
        actor_email: Optional[str] = None,
    ) -> list[ChangeSummaryResponse]:
        """Unlink an existing Change Request from a Problem Ticket without deleting the Change."""
        problem = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not problem:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem ticket '{problem_id}' not found",
            )

        change = (
            db.query(ITSMChangeRequest)
            .filter(
                ITSMChangeRequest.id == change_id,
                ITSMChangeRequest.tenant_id == tenant_id,
            )
            .first()
        )
        if not change:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Change request '{change_id}' not found in current tenant",
            )

        # Check if currently linked
        existing_linked = cls.get_related_changes(db, tenant_id, problem_id)
        if not any(c.id == change_id for c in existing_linked):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Change request '{change.change_number}' is not currently linked to Problem '{problem.ticket_number}'",
            )

        now = datetime.now(timezone.utc)
        activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem_id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="CHANGE_UNLINKED",
            content=f"Change {change.change_number} unlinked from Problem {problem.ticket_number}",
            activity_metadata={
                "change_id": str(change.id),
                "change_number": change.change_number,
                "problem_id": str(problem.id),
                "problem_number": problem.ticket_number,
                "action": "UNLINK",
                "actor_email": actor_email,
            },
            created_at=now,
        )
        db.add(activity)
        problem.updated_at = now

        # Audit event on change record
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
                        "idempotency_key": f"itsm:change:{change.id}:unlink_problem:{problem.id}:{now.timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": now,
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.change.problem_unlinked",
                        "request_id": str(change.id),
                        "policy_id": str(change.id),
                        "provider": "itsm",
                        "reason": f"Change {change.change_number} unlinked from Problem {problem.ticket_number}",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"problem_id={problem.id}",
                            f"problem_number={problem.ticket_number}",
                            f"change_id={change.id}",
                            f"change_number={change.change_number}",
                        ],
                    },
                )
                sp.commit()
            except Exception as audit_err:
                sp.rollback()
                logger.warning("Failed to emit audit event for unlink_change: %s", audit_err)
        except Exception:
            pass

        db.commit()

        return cls.get_related_changes(db, tenant_id, problem_id)

    @classmethod
    def create_change_from_problem(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
        payload: CreateChangeFromProblemRequest,
        actor_id: UUID,
        actor_email: Optional[str] = None,
    ) -> ChangeDetailResponse:
        """Create a new Change Request pre-filled from Problem data, and link them bidirectionally."""
        problem = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not problem:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem ticket '{problem_id}' not found",
            )

        problem_detail_rec = (
            db.query(ITSMProblemDetail)
            .filter(
                ITSMProblemDetail.tenant_id == tenant_id,
                ITSMProblemDetail.ticket_id == problem_id,
            )
            .first()
        )

        now = datetime.now(timezone.utc)
        change_number = ITSMChangeService.generate_change_number(db, tenant_id)

        description = payload.description
        if not description or not description.strip():
            description = f"Permanent fix for {problem.ticket_number} - {problem.title}"
            if problem_detail_rec and problem_detail_rec.root_cause_summary:
                description += f"\n\nRoot Cause: {problem_detail_rec.root_cause_summary}"

        service_id = payload.service_id or problem.service_id
        implementation_plan = payload.implementation_plan
        if implementation_plan is None and problem_detail_rec and problem_detail_rec.permanent_solution:
            implementation_plan = problem_detail_rec.permanent_solution

        new_change = ITSMChangeRequest(
            id=uuid4(),
            tenant_id=tenant_id,
            change_number=change_number,
            title=payload.title.strip(),
            description=description.strip(),
            change_type=(payload.change_type or "STANDARD").upper(),
            risk_level=(payload.risk_level or "LOW").upper(),
            impact_level=(payload.impact_level or "LOW").upper(),
            status="DRAFT",
            service_id=service_id,
            lead_time_hours=0,
            outage_expected=False,
            implementation_plan=implementation_plan or "",
            backout_plan=payload.backout_plan or "",
            test_plan=payload.test_plan or "",
            requested_by_id=actor_id,
            created_at=now,
            updated_at=now,
        )
        db.add(new_change)

        if payload.ci_ids:
            for ci_id in payload.ci_ids:
                ci_link = ITSMChangeRequestCI(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    change_id=new_change.id,
                    ci_id=ci_id,
                    impact_type="AFFECTED",
                    created_at=now,
                )
                db.add(ci_link)

        # Record activity on Problem ticket
        link_activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem_id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="CHANGE_LINKED",
            content=f"Change {change_number} created from Problem {problem.ticket_number}",
            activity_metadata={
                "change_id": str(new_change.id),
                "change_number": change_number,
                "problem_id": str(problem.id),
                "problem_number": problem.ticket_number,
                "action": "CREATE_AND_LINK",
                "actor_email": actor_email,
            },
            created_at=now,
        )
        db.add(link_activity)
        problem.updated_at = now

        # Audit log events for the new change
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
                        "idempotency_key": f"itsm:change:{new_change.id}:create:{now.timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": now,
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.change.created",
                        "request_id": str(new_change.id),
                        "policy_id": str(new_change.id),
                        "provider": "itsm",
                        "reason": f"Change Request {change_number} created from Problem {problem.ticket_number}",
                        "response_status": 201,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"change_id={new_change.id}",
                            f"change_number={change_number}",
                            f"created_from_problem_id={problem.id}",
                            f"created_from_problem_number={problem.ticket_number}",
                            "status=DRAFT",
                        ],
                    },
                )
                sp.commit()
            except Exception as audit_err:
                sp.rollback()
                logger.warning("Failed to emit audit event for create_change_from_problem: %s", audit_err)
        except Exception:
            pass

        db.commit()

        return ITSMChangeService.get_change(db, tenant_id, new_change.id)

    @classmethod
    def report_recurring_problem(
        cls,
        db: Session,
        tenant_id: UUID,
        incident_id: UUID,
        actor_id: UUID,
        payload: ReportRecurringProblemRequest,
    ) -> ReportRecurringProblemResponse:
        # 1. Fetch incident with row-level lock for concurrency safety
        incident = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == incident_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "INCIDENT",
            )
            .with_for_update()
            .first()
        )
        if not incident:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Incident '{incident_id}' not found",
            )

        # 2. Duplicate protection: if already linked, return existing problem info safely
        if incident.linked_problem_id is not None:
            existing_problem = (
                db.query(ITSMTicket)
                .filter(
                    ITSMTicket.id == incident.linked_problem_id,
                    ITSMTicket.tenant_id == tenant_id,
                    ITSMTicket.ticket_type == "PROBLEM",
                )
                .first()
            )
            if existing_problem:
                return ReportRecurringProblemResponse(
                    problem_id=existing_problem.id,
                    problem_ticket_number=existing_problem.ticket_number,
                    already_reported=True,
                    message="Recurring problem already reported.",
                )

        now = datetime.now(timezone.utc)
        actor_user = db.query(User).filter(User.id == actor_id).first()
        actor_email = actor_user.email if actor_user else None

        # 3. Generate problem ticket number
        problem_number = IncidentService.generate_ticket_number(
            db, tenant_id, ticket_type="PROBLEM", prefix="PRB"
        )

        # 4. Format description with recurring reason, originating incident context, and optional notes
        desc_parts = [
            f"Recurring Issue:\n{payload.recurring_reason.strip()}",
            f"Originating Incident: {incident.ticket_number} - {incident.title}",
        ]
        if incident.description and incident.description.strip():
            desc_parts.append(f"Incident Description:\n{incident.description.strip()}")
        if payload.notes and payload.notes.strip():
            desc_parts.append(f"Notes:\n{payload.notes.strip()}")
        problem_description = "\n\n".join(desc_parts)

        # 5. Create ITSMTicket (ticket_type="PROBLEM")
        problem_ticket = ITSMTicket(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_number=problem_number,
            ticket_type="PROBLEM",
            title=payload.problem_short_description.strip(),
            description=problem_description,
            impact=incident.impact,
            urgency=incident.urgency,
            priority=incident.priority,
            status="NEW",
            source_channel="PORTAL",
            requester_id=actor_id,
            service_id=incident.service_id,
            category_id=incident.category_id,
            category=incident.category,
            subcategory=incident.subcategory,
            created_at=now,
            updated_at=now,
        )
        db.add(problem_ticket)
        db.flush()

        # 6. Create ITSMProblemDetail record
        problem_detail = ITSMProblemDetail(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem_ticket.id,
            known_error=False,
            created_at=now,
            updated_at=now,
        )
        db.add(problem_detail)

        # 7. Associate originating Incident with the new Problem
        incident.linked_problem_id = problem_ticket.id
        incident.updated_at = now

        # 8. Record ITSMTicketActivity on Incident
        incident_activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=incident.id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="RECURRING_PROBLEM_REPORTED",
            content=f"Recurring problem reported: {problem_ticket.ticket_number} - {problem_ticket.title}",
            activity_metadata={
                "actor_email": actor_email,
                "problem_id": str(problem_ticket.id),
                "problem_number": problem_ticket.ticket_number,
                "reason": payload.recurring_reason.strip(),
            },
            created_at=now,
        )
        db.add(incident_activity)

        # 9. Record ITSMTicketActivity on Problem
        problem_activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem_ticket.id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="PROBLEM_CREATED",
            content=f"Problem raised from recurring incident {incident.ticket_number}: {payload.recurring_reason.strip()}",
            activity_metadata={
                "actor_email": actor_email,
                "incident_id": str(incident.id),
                "incident_number": incident.ticket_number,
            },
            created_at=now,
        )
        db.add(problem_activity)

        # 10. Audit event
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
                        "idempotency_key": f"itsm:incident:{incident.id}:report_recurring_problem:{problem_ticket.id}",
                        "tenant_id": str(tenant_id),
                        "timestamp": now,
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.problem.recurring_reported",
                        "request_id": str(problem_ticket.id),
                        "provider": "itsm",
                        "reason": "Service Agent reported a recurring problem from incident",
                        "response_status": 201,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"incident_id={incident.id}",
                            f"incident_number={incident.ticket_number}",
                            f"problem_id={problem_ticket.id}",
                            f"problem_number={problem_ticket.ticket_number}",
                        ],
                    },
                )
                sp.commit()
            except Exception:
                sp.rollback()
        except Exception:
            pass

        db.commit()
        db.refresh(problem_ticket)
        db.refresh(incident)

        return ReportRecurringProblemResponse(
            problem_id=problem_ticket.id,
            problem_ticket_number=problem_ticket.ticket_number,
            already_reported=False,
            message="Recurring problem reported successfully.",
        )

    @classmethod
    def search_known_errors(
        cls,
        db: Session,
        tenant_id: UUID,
        *,
        search: Optional[str] = None,
        service_id: Optional[UUID] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[KnownErrorLookupItem]:
        """Tenant-scoped search for approved Known Errors and active workarounds.

        LIFECYCLE & GOVERNANCE SAFEGUARDS (FAIL-CLOSED):
        1. Only tickets with known_error == True are considered.
        2. Workaround must be explicitly APPROVED (workaround_status == 'APPROVED').
           Legacy records without explicit approval action (defaulting to 'DRAFT') are excluded.
        3. Excludes expired workarounds (workaround_expires_at is None or > now()).
        4. Excludes overdue review records (review_due_at is None or >= now()).
        5. Workaround must be non-null and non-empty after trimming.
        6. Permitted active lifecycle statuses: 'OPEN', 'IN_PROGRESS', 'RESOLVED'.
        7. Excludes unassessed/pre-investigation tickets (status in ('NEW', 'ASSIGNED')).
        8. Excludes closed or cancelled tickets (status in ('CLOSED', 'CANCELLED')).
        """
        now = datetime.now(timezone.utc)
        query = (
            db.query(ITSMTicket, ITSMProblemDetail)
            .join(ITSMProblemDetail, ITSMProblemDetail.ticket_id == ITSMTicket.id)
            .options(joinedload(ITSMTicket.service))
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMProblemDetail.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
                ITSMProblemDetail.known_error.is_(True),
                ITSMProblemDetail.workaround_status == "APPROVED",
                or_(
                    ITSMProblemDetail.workaround_expires_at.is_(None),
                    ITSMProblemDetail.workaround_expires_at > now,
                ),
                or_(
                    ITSMProblemDetail.review_due_at.is_(None),
                    ITSMProblemDetail.review_due_at >= now,
                ),
                ITSMProblemDetail.workaround_summary.isnot(None),
                func.trim(ITSMProblemDetail.workaround_summary) != "",
                ITSMTicket.status.in_(["OPEN", "IN_PROGRESS", "RESOLVED"]),
            )
        )

        if service_id:
            query = query.filter(ITSMTicket.service_id == service_id)

        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    ITSMTicket.ticket_number.ilike(term),
                    ITSMTicket.title.ilike(term),
                    ITSMTicket.description.ilike(term),
                    ITSMProblemDetail.workaround_summary.ilike(term),
                    ITSMProblemDetail.root_cause_summary.ilike(term),
                    ITSMProblemDetail.permanent_solution.ilike(term),
                    ITSMProblemDetail.symptoms.ilike(term),
                )
            )

        rows = (
            query.order_by(ITSMTicket.updated_at.desc(), ITSMTicket.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        results: list[KnownErrorLookupItem] = []
        for ticket, detail in rows:
            service_name = ticket.service.name if ticket.service else None
            results.append(
                KnownErrorLookupItem(
                    id=ticket.id,
                    ticket_number=ticket.ticket_number,
                    title=ticket.title,
                    description=ticket.description,
                    symptoms=detail.symptoms,
                    status=ticket.status,
                    service_id=ticket.service_id,
                    service_name=service_name,
                    workaround_summary=detail.workaround_summary.strip(),
                    workaround_status=detail.workaround_status,
                    workaround_approved_at=detail.workaround_approved_at,
                    workaround_expires_at=detail.workaround_expires_at,
                    review_due_at=detail.review_due_at,
                    root_cause_summary=detail.root_cause_summary,
                    permanent_solution=detail.permanent_solution,
                    identified_at=detail.identified_at,
                    resolved_at=detail.resolved_at,
                    created_at=ticket.created_at,
                    updated_at=ticket.updated_at,
                )
            )
        return results

    @classmethod
    def publish_workaround(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
        actor_id: UUID,
        payload: Optional[PublishWorkaroundRequest] = None,
    ) -> WorkaroundGovernanceResponse:
        """Publish and approve a Known Error workaround.

        Requires non-empty workaround_summary. Sets workaround_status='APPROVED',
        records approval timestamp, approver ID, and emits activity/audit records.
        """
        ticket = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .with_for_update()
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem ticket '{problem_id}' not found",
            )

        if ticket.status == "CLOSED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot publish workaround for a CLOSED problem. Problem lifecycle has concluded.",
            )

        detail_rec = (
            db.query(ITSMProblemDetail)
            .filter(
                ITSMProblemDetail.tenant_id == tenant_id,
                ITSMProblemDetail.ticket_id == problem_id,
            )
            .with_for_update()
            .first()
        )
        if not detail_rec or not detail_rec.workaround_summary or not detail_rec.workaround_summary.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot publish workaround: workaround_summary is required and cannot be empty",
            )

        now = datetime.now(timezone.utc)
        actor_user = db.query(User).filter(User.id == actor_id).first()
        actor_email = actor_user.email if actor_user else None

        detail_rec.known_error = True
        detail_rec.workaround_status = "APPROVED"
        detail_rec.workaround_approved_at = now
        detail_rec.workaround_approved_by_id = actor_id
        if payload:
            if payload.workaround_expires_at is not None:
                detail_rec.workaround_expires_at = payload.workaround_expires_at
            if payload.review_due_at is not None:
                detail_rec.review_due_at = payload.review_due_at
            if payload.symptoms is not None:
                detail_rec.symptoms = payload.symptoms
        detail_rec.updated_at = now
        ticket.updated_at = now

        note_text = f" Note: {payload.notes.strip()}" if (payload and payload.notes and payload.notes.strip()) else ""
        activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem_id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="WORKAROUND_PUBLISHED",
            content=f"Workaround published and approved for Problem {ticket.ticket_number}.{note_text}",
            activity_metadata={
                "action": "publish_workaround",
                "actor_id": str(actor_id),
                "actor_email": actor_email,
                "workaround_status": "APPROVED",
                "workaround_approved_at": now.isoformat(),
                "workaround_expires_at": detail_rec.workaround_expires_at.isoformat() if detail_rec.workaround_expires_at else None,
                "review_due_at": detail_rec.review_due_at.isoformat() if detail_rec.review_due_at else None,
            },
            created_at=now,
        )
        db.add(activity)

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
                        "idempotency_key": f"itsm:problem:{problem_id}:publish_workaround:{now.timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": now,
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.problem.workaround_published",
                        "request_id": str(problem_id),
                        "provider": "itsm",
                        "reason": f"Workaround for Problem {ticket.ticket_number} published",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"problem_id={problem_id}",
                            "workaround_status=APPROVED",
                        ],
                    },
                )
                sp.commit()
            except Exception as e:
                sp.rollback()
                logger.warning(f"Failed to record audit event for workaround publish: {e}")
        except Exception:
            pass

        db.commit()

        return WorkaroundGovernanceResponse(
            problem_id=ticket.id,
            problem_ticket_number=ticket.ticket_number,
            known_error=detail_rec.known_error,
            workaround_status=detail_rec.workaround_status,
            workaround_summary=detail_rec.workaround_summary,
            workaround_approved_at=detail_rec.workaround_approved_at,
            workaround_approved_by_id=detail_rec.workaround_approved_by_id,
            workaround_expires_at=detail_rec.workaround_expires_at,
            review_due_at=detail_rec.review_due_at,
            symptoms=detail_rec.symptoms,
            message=f"Workaround for Problem {ticket.ticket_number} published and approved successfully.",
        )

    @classmethod
    def retire_workaround(
        cls,
        db: Session,
        tenant_id: UUID,
        problem_id: UUID,
        actor_id: UUID,
        payload: Optional[RetireWorkaroundRequest] = None,
    ) -> WorkaroundGovernanceResponse:
        """Retire a Known Error workaround.

        Transitions workaround_status to 'RETIRED'.
        CRITICAL: Retiring a workaround does NOT close or alter the problem ticket status.
        """
        ticket = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .with_for_update()
            .first()
        )
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem ticket '{problem_id}' not found",
            )

        detail_rec = (
            db.query(ITSMProblemDetail)
            .filter(
                ITSMProblemDetail.tenant_id == tenant_id,
                ITSMProblemDetail.ticket_id == problem_id,
            )
            .with_for_update()
            .first()
        )
        if not detail_rec:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem details for Problem '{problem_id}' not found",
            )

        now = datetime.now(timezone.utc)
        actor_user = db.query(User).filter(User.id == actor_id).first()
        actor_email = actor_user.email if actor_user else None

        reason = payload.reason.strip() if (payload and payload.reason and payload.reason.strip()) else "No reason provided"
        detail_rec.workaround_status = "RETIRED"
        detail_rec.updated_at = now
        ticket.updated_at = now
        # Crucial: ticket.status is preserved!

        activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem_id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="WORKAROUND_RETIRED",
            content=f"Workaround retired for Problem {ticket.ticket_number}. Reason: {reason}",
            activity_metadata={
                "action": "retire_workaround",
                "actor_id": str(actor_id),
                "actor_email": actor_email,
                "workaround_status": "RETIRED",
                "reason": reason,
            },
            created_at=now,
        )
        db.add(activity)

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
                        "idempotency_key": f"itsm:problem:{problem_id}:retire_workaround:{now.timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": now,
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.problem.workaround_retired",
                        "request_id": str(problem_id),
                        "provider": "itsm",
                        "reason": f"Workaround for Problem {ticket.ticket_number} retired: {reason}",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"problem_id={problem_id}",
                            "workaround_status=RETIRED",
                        ],
                    },
                )
                sp.commit()
            except Exception as e:
                sp.rollback()
                logger.warning(f"Failed to record audit event for workaround retirement: {e}")
        except Exception:
            pass

        db.commit()

        return WorkaroundGovernanceResponse(
            problem_id=ticket.id,
            problem_ticket_number=ticket.ticket_number,
            known_error=detail_rec.known_error,
            workaround_status=detail_rec.workaround_status,
            workaround_summary=detail_rec.workaround_summary or "",
            workaround_approved_at=detail_rec.workaround_approved_at,
            workaround_approved_by_id=detail_rec.workaround_approved_by_id,
            workaround_expires_at=detail_rec.workaround_expires_at,
            review_due_at=detail_rec.review_due_at,
            symptoms=detail_rec.symptoms,
            message=f"Workaround for Problem {ticket.ticket_number} retired successfully.",
        )

    @classmethod
    def link_incident_to_problem(
        cls,
        db: Session,
        tenant_id: UUID,
        incident_id: UUID,
        problem_id: UUID,
        actor_id: UUID,
        actor_email: Optional[str] = None,
    ) -> LinkIncidentProblemResponse:
        """Associate an Incident ticket with an existing Problem ticket."""
        incident = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == incident_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "INCIDENT",
            )
            .with_for_update()
            .first()
        )
        if not incident:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Incident '{incident_id}' not found",
            )

        problem = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == problem_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not problem:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Problem '{problem_id}' not found",
            )

        # Idempotency check
        if incident.linked_problem_id == problem_id:
            return LinkIncidentProblemResponse(
                incident_id=incident.id,
                incident_ticket_number=incident.ticket_number,
                linked_problem_id=problem.id,
                linked_problem_ticket_number=problem.ticket_number,
                already_linked=True,
                message=f"Incident is already linked to Problem {problem.ticket_number}.",
            )

        now = datetime.now(timezone.utc)
        old_problem_id = incident.linked_problem_id
        incident.linked_problem_id = problem.id
        incident.updated_at = now

        # Incident activity
        inc_act = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=incident.id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="UPDATE",
            content=f"Linked to Problem {problem.ticket_number} ({problem.title}).",
            activity_metadata={
                "actor_email": actor_email,
                "linked_problem_id": str(problem.id),
                "linked_problem_ticket_number": problem.ticket_number,
                "old_linked_problem_id": str(old_problem_id) if old_problem_id else None,
                "action": "link_problem",
            },
            created_at=now,
        )
        db.add(inc_act)

        # Problem activity
        prb_act = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=problem.id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="UPDATE",
            content=f"Incident {incident.ticket_number} linked to this Problem.",
            activity_metadata={
                "actor_email": actor_email,
                "linked_incident_id": str(incident.id),
                "linked_incident_ticket_number": incident.ticket_number,
                "action": "incident_linked",
            },
            created_at=now,
        )
        db.add(prb_act)

        db.commit()
        db.refresh(incident)

        # Audit trail
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
                        "idempotency_key": f"itsm:incident:{incident.id}:link_problem:{problem.id}:{now.timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": now,
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.incident.linked_problem",
                        "request_id": str(incident.id),
                        "provider": "itsm",
                        "reason": f"Incident {incident.ticket_number} linked to Problem {problem.ticket_number}",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"incident_id={incident.id}",
                            f"problem_id={problem.id}",
                            f"old_problem_id={old_problem_id}",
                        ],
                    },
                )
                sp.commit()
            except Exception:
                sp.rollback()
        except Exception:
            pass

        return LinkIncidentProblemResponse(
            incident_id=incident.id,
            incident_ticket_number=incident.ticket_number,
            linked_problem_id=problem.id,
            linked_problem_ticket_number=problem.ticket_number,
            already_linked=False,
            message=f"Incident successfully linked to Problem {problem.ticket_number}.",
        )

    @classmethod
    def unlink_incident_from_problem(
        cls,
        db: Session,
        tenant_id: UUID,
        incident_id: UUID,
        actor_id: UUID,
        actor_email: Optional[str] = None,
    ) -> LinkIncidentProblemResponse:
        """Remove link between an Incident ticket and its linked Problem ticket."""
        incident = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == incident_id,
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.ticket_type == "INCIDENT",
            )
            .with_for_update()
            .first()
        )
        if not incident:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Incident '{incident_id}' not found",
            )

        if incident.linked_problem_id is None:
            return LinkIncidentProblemResponse(
                incident_id=incident.id,
                incident_ticket_number=incident.ticket_number,
                linked_problem_id=None,
                linked_problem_ticket_number=None,
                already_linked=False,
                message="Incident is not linked to any problem.",
            )

        now = datetime.now(timezone.utc)
        old_problem_id = incident.linked_problem_id
        old_problem = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == old_problem_id,
                ITSMTicket.tenant_id == tenant_id,
            )
            .first()
        )
        old_prb_num = old_problem.ticket_number if old_problem else str(old_problem_id)

        incident.linked_problem_id = None
        incident.updated_at = now

        # Incident activity
        inc_act = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=incident.id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="UPDATE",
            content=f"Unlinked from Problem {old_prb_num}.",
            activity_metadata={
                "actor_email": actor_email,
                "unlinked_problem_id": str(old_problem_id),
                "action": "unlink_problem",
            },
            created_at=now,
        )
        db.add(inc_act)

        # Problem activity
        if old_problem:
            prb_act = ITSMTicketActivity(
                id=uuid4(),
                tenant_id=tenant_id,
                ticket_id=old_problem.id,
                actor_type="USER",
                actor_id=actor_id,
                activity_type="UPDATE",
                content=f"Incident {incident.ticket_number} unlinked from this Problem.",
                activity_metadata={
                    "actor_email": actor_email,
                    "unlinked_incident_id": str(incident.id),
                    "action": "incident_unlinked",
                },
                created_at=now,
            )
            db.add(prb_act)

        db.commit()
        db.refresh(incident)

        # Audit trail
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
                        "idempotency_key": f"itsm:incident:{incident.id}:unlink_problem:{old_problem_id}:{now.timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": now,
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.incident.unlinked_problem",
                        "request_id": str(incident.id),
                        "provider": "itsm",
                        "reason": f"Incident {incident.ticket_number} unlinked from Problem {old_prb_num}",
                        "response_status": 200,
                        "frameworks_affected": ["ITIL"],
                        "execution_trace": [
                            f"incident_id={incident.id}",
                            f"old_problem_id={old_problem_id}",
                        ],
                    },
                )
                sp.commit()
            except Exception:
                sp.rollback()
        except Exception:
            pass

        return LinkIncidentProblemResponse(
            incident_id=incident.id,
            incident_ticket_number=incident.ticket_number,
            linked_problem_id=None,
            linked_problem_ticket_number=None,
            already_linked=False,
            message=f"Incident unlinked from Problem {old_prb_num} successfully.",
        )


