from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload

from app.db.models import ITSMChangeRequest, ITSMChangeRequestCI
from app.schemas.itsm_changes import (
    ChangeAffectedCIItem,
    ChangeAssessmentUpdateRequest,
    ChangeDetailResponse,
    ChangeStatsResponse,
    ChangeSummaryResponse,
)
from app.services.audit_store import append_audit_event

logger = logging.getLogger(__name__)

OPEN_STATUSES = {"DRAFT", "SUBMITTED", "CAB_REVIEW", "AWAITING_APPROVAL", "APPROVED", "OPEN"}
IN_PROGRESS_STATUSES = {"IN_PROGRESS", "IMPLEMENTING"}
SCHEDULED_STATUSES = {"SCHEDULED"}
COMPLETED_STATUSES = {"COMPLETED", "CLOSED"}

VALID_RISK_LEVELS = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_IMPACT_LEVELS = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_CHANGE_TYPES = {"STANDARD", "NORMAL", "EMERGENCY"}


class ITSMChangeService:
    @classmethod
    def list_changes(
        cls,
        db: Session,
        tenant_id: UUID,
        status_filter: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ChangeSummaryResponse]:
        query = (
            db.query(ITSMChangeRequest)
            .options(
                joinedload(ITSMChangeRequest.service),
                joinedload(ITSMChangeRequest.assigned_to),
            )
            .filter(ITSMChangeRequest.tenant_id == tenant_id)
        )

        if status_filter:
            st = status_filter.strip().upper()
            if st == "OPEN":
                query = query.filter(ITSMChangeRequest.status.in_(OPEN_STATUSES))
            elif st in ("IN_PROGRESS", "IMPLEMENTING"):
                query = query.filter(ITSMChangeRequest.status.in_(IN_PROGRESS_STATUSES))
            elif st == "SCHEDULED":
                query = query.filter(ITSMChangeRequest.status.in_(SCHEDULED_STATUSES))
            elif st in ("COMPLETED", "CLOSED"):
                query = query.filter(ITSMChangeRequest.status.in_(COMPLETED_STATUSES))
            else:
                query = query.filter(ITSMChangeRequest.status == st)

        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    ITSMChangeRequest.change_number.ilike(term),
                    ITSMChangeRequest.title.ilike(term),
                )
            )

        query = query.order_by(ITSMChangeRequest.created_at.desc())
        items = query.offset(offset).limit(limit).all()

        results: list[ChangeSummaryResponse] = []
        for chg in items:
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
    def get_change_stats(cls, db: Session, tenant_id: UUID) -> ChangeStatsResponse:
        records = (
            db.query(ITSMChangeRequest.status, func.count(ITSMChangeRequest.id))
            .filter(ITSMChangeRequest.tenant_id == tenant_id)
            .group_by(ITSMChangeRequest.status)
            .all()
        )

        counts = {status_str: count for status_str, count in records}
        total = sum(counts.values())

        open_count = sum(count for st, count in counts.items() if st in OPEN_STATUSES)
        in_progress_count = sum(count for st, count in counts.items() if st in IN_PROGRESS_STATUSES)
        scheduled_count = sum(count for st, count in counts.items() if st in SCHEDULED_STATUSES)
        completed_count = sum(count for st, count in counts.items() if st in COMPLETED_STATUSES)

        return ChangeStatsResponse(
            total=total,
            open=open_count,
            in_progress=in_progress_count,
            scheduled=scheduled_count,
            completed=completed_count,
        )

    @classmethod
    def get_change(cls, db: Session, tenant_id: UUID, change_id: UUID) -> ChangeDetailResponse:
        chg = (
            db.query(ITSMChangeRequest)
            .options(
                joinedload(ITSMChangeRequest.service),
                joinedload(ITSMChangeRequest.assigned_to),
            )
            .filter(
                ITSMChangeRequest.id == change_id,
                ITSMChangeRequest.tenant_id == tenant_id,
            )
            .first()
        )
        if not chg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Change request '{change_id}' not found",
            )

        service_name = chg.service.name if chg.service else None
        assignee_email = chg.assigned_to.email if chg.assigned_to else None

        # Fetch affected Configuration Items
        affected_cis: list[ChangeAffectedCIItem] = []
        ci_records = (
            db.query(ITSMChangeRequestCI)
            .options(joinedload(ITSMChangeRequestCI.ci))
            .filter(
                ITSMChangeRequestCI.change_id == change_id,
                ITSMChangeRequestCI.tenant_id == tenant_id,
            )
            .all()
        )
        for rec in ci_records:
            if rec.ci:
                affected_cis.append(
                    ChangeAffectedCIItem(
                        id=rec.id,
                        ci_id=rec.ci_id,
                        name=rec.ci.name,
                        ci_type=rec.ci.ci_type,
                        environment=rec.ci.environment,
                        status=rec.ci.status,
                        impact_type=rec.impact_type,
                        notes=rec.notes,
                    )
                )

        return ChangeDetailResponse(
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
            lead_time_hours=chg.lead_time_hours,
            outage_expected=chg.outage_expected,
            implementation_plan=chg.implementation_plan,
            backout_plan=chg.backout_plan,
            test_plan=chg.test_plan,
            affected_cis=affected_cis,
            created_at=chg.created_at,
            updated_at=chg.updated_at,
        )

    @classmethod
    def update_assessment(
        cls,
        db: Session,
        tenant_id: UUID,
        change_id: UUID,
        payload: ChangeAssessmentUpdateRequest,
        actor_id: UUID,
    ) -> ChangeDetailResponse:
        chg = (
            db.query(ITSMChangeRequest)
            .filter(
                ITSMChangeRequest.id == change_id,
                ITSMChangeRequest.tenant_id == tenant_id,
            )
            .first()
        )
        if not chg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Change request '{change_id}' not found",
            )

        # Validate enums if provided
        if payload.risk_level is not None:
            norm_risk = payload.risk_level.strip().upper()
            if norm_risk not in VALID_RISK_LEVELS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid risk_level '{payload.risk_level}'. Valid options: {sorted(VALID_RISK_LEVELS)}",
                )
            chg.risk_level = norm_risk

        if payload.impact_level is not None:
            norm_impact = payload.impact_level.strip().upper()
            if norm_impact not in VALID_IMPACT_LEVELS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid impact_level '{payload.impact_level}'. Valid options: {sorted(VALID_IMPACT_LEVELS)}",
                )
            chg.impact_level = norm_impact

        if payload.change_type is not None:
            norm_type = payload.change_type.strip().upper()
            if norm_type not in VALID_CHANGE_TYPES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid change_type '{payload.change_type}'. Valid options: {sorted(VALID_CHANGE_TYPES)}",
                )
            chg.change_type = norm_type

        if payload.description is not None:
            chg.description = payload.description.strip()

        if payload.implementation_plan is not None:
            chg.implementation_plan = payload.implementation_plan

        if payload.backout_plan is not None:
            chg.backout_plan = payload.backout_plan

        if payload.test_plan is not None:
            chg.test_plan = payload.test_plan

        chg.updated_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(chg)

        # Emit audit event to compliance audit store
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
                        "idempotency_key": f"itsm:change:{chg.id}:assessment:{datetime.now(timezone.utc).timestamp()}",
                        "tenant_id": str(tenant_id),
                        "timestamp": datetime.now(timezone.utc),
                        "actor_id": str(actor_id),
                        "actor_type": "user",
                        "action": "itsm.change.assessed",
                        "policy_id": str(chg.id),
                        "reason": f"Change {chg.change_number} assessment updated: Risk={chg.risk_level}, Impact={chg.impact_level}, Type={chg.change_type}",
                    },
                )
                sp.commit()
            except Exception as audit_err:
                sp.rollback()
                logger.warning("Failed to emit audit event for change assessment: %s", audit_err)
        except Exception:
            pass

        return cls.get_change(db, tenant_id, change_id)
