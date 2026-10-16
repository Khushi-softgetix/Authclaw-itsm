from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload

from app.db.models import (
    AuditLogMetadata,
    ITSMChangeRequest,
    ITSMChangeRequestCI,
    ITSMMetricSourceEvent,
    ITSMTicket,
    ITSMTicketActivity,
    User,
)
from app.schemas.itsm_changes import (
    ChangeActivityItem,
    ChangeAffectedCIItem,
    ChangeAssessmentUpdateRequest,
    ChangeDetailResponse,
    ChangeLifecycleTransitionRequest,
    ChangeStatsResponse,
    ChangeSummaryResponse,
    RelatedProblemSummary,
)
from app.services.audit_store import append_audit_event

OPEN_STATUSES = {"DRAFT", "SUBMITTED", "CAB_REVIEW", "AWAITING_APPROVAL", "APPROVED", "OPEN"}
IN_PROGRESS_STATUSES = {"IN_PROGRESS", "IMPLEMENTING"}
SCHEDULED_STATUSES = {"SCHEDULED"}
COMPLETED_STATUSES = {"COMPLETED", "CLOSED"}

VALID_RISK_LEVELS = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_IMPACT_LEVELS = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_CHANGE_TYPES = {"STANDARD", "NORMAL", "EMERGENCY"}


class ITSMChangeService:
    @staticmethod
    def _audit_operation_exists(
        db: Session,
        tenant_id: UUID,
        idempotency_key: str,
    ) -> bool:
        """Treat a previously committed request identifier as a safe replay."""
        return (
            db.query(AuditLogMetadata.record_id)
            .filter(
                AuditLogMetadata.tenant_id == tenant_id,
                AuditLogMetadata.idempotency_key == idempotency_key,
            )
            .first()
            is not None
        )

    @staticmethod
    def _assessment_audit_summary(values: dict[str, object]) -> dict[str, object]:
        """Keep classification evidence readable without copying plan content."""
        safe_fields = {"risk_level", "impact_level", "change_type"}
        summary: dict[str, object] = {}
        for field, value in values.items():
            if field in safe_fields:
                summary[field] = value
                continue
            serialized = json.dumps(value, sort_keys=True, default=str)
            summary[field] = {
                "changed": True,
                "length": len(serialized),
                "sha256": hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
            }
        return summary

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
            activities=cls.get_change_activities(db, tenant_id, change_id),
            related_problem=cls.get_related_problem(db, tenant_id, change_id),
            created_at=chg.created_at,
            updated_at=chg.updated_at,
        )

    @staticmethod
    def generate_change_number(db: Session, tenant_id: UUID) -> str:
        """Concurrency-safe atomic sequential change number generation per tenant using itsm_ticket_counters."""
        query = text(
            """
            INSERT INTO public.itsm_ticket_counters (id, tenant_id, ticket_type, prefix, last_number, updated_at)
            VALUES (gen_random_uuid(), :tenant_id, 'CHANGE', 'CHG', 1, clock_timestamp())
            ON CONFLICT (tenant_id, ticket_type)
            DO UPDATE SET
                last_number = public.itsm_ticket_counters.last_number + 1,
                updated_at = clock_timestamp()
            RETURNING prefix, last_number
            """
        )
        row = db.execute(query, {"tenant_id": str(tenant_id)}).fetchone()
        if not row:
            raise RuntimeError("Failed to generate change number")
        prefix, number = row[0], row[1]
        candidate = f"{prefix}-{number:06d}"

        # If candidate already exists in itsm_change_requests (e.g. from seed data), advance counter past max existing
        exists = db.query(ITSMChangeRequest.id).filter(
            ITSMChangeRequest.tenant_id == tenant_id,
            ITSMChangeRequest.change_number == candidate,
        ).first()
        if exists:
            all_nums = db.query(ITSMChangeRequest.change_number).filter(
                ITSMChangeRequest.tenant_id == tenant_id,
                ITSMChangeRequest.change_number.like(f"{prefix}-%"),
            ).all()
            max_num = number
            for (cn,) in all_nums:
                try:
                    num_part = int(cn.split("-")[-1])
                    if num_part > max_num:
                        max_num = num_part
                except (ValueError, IndexError):
                    pass
            new_last = max_num + 1
            db.execute(
                text(
                    """
                    UPDATE public.itsm_ticket_counters
                    SET last_number = :new_last, updated_at = clock_timestamp()
                    WHERE tenant_id = :tenant_id AND ticket_type = 'CHANGE'
                    """
                ),
                {"new_last": new_last, "tenant_id": str(tenant_id)},
            )
            candidate = f"{prefix}-{new_last:06d}"

        return candidate

    @classmethod
    def get_related_problem(
        cls, db: Session, tenant_id: UUID, change_id: UUID
    ) -> Optional[RelatedProblemSummary]:
        """Find the active problem linked to this change via activity audit trail."""
        activities = (
            db.query(ITSMTicketActivity)
            .filter(
                ITSMTicketActivity.tenant_id == tenant_id,
                ITSMTicketActivity.activity_type.in_(["CHANGE_LINKED", "CHANGE_UNLINKED"]),
            )
            .order_by(ITSMTicketActivity.created_at.asc())
            .all()
        )
        target_str = str(change_id)
        linked_problem_id: Optional[UUID] = None
        for act in activities:
            meta = act.activity_metadata or {}
            if meta.get("change_id") == target_str:
                if act.activity_type == "CHANGE_LINKED":
                    linked_problem_id = act.ticket_id
                elif act.activity_type == "CHANGE_UNLINKED":
                    if linked_problem_id == act.ticket_id:
                        linked_problem_id = None

        if not linked_problem_id:
            return None

        problem = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.id == linked_problem_id,
                ITSMTicket.ticket_type == "PROBLEM",
            )
            .first()
        )
        if not problem:
            return None

        return RelatedProblemSummary(
            id=problem.id,
            ticket_number=problem.ticket_number,
            title=problem.title,
            status=problem.status,
            priority=problem.priority,
        )

    @classmethod
    def update_assessment(
        cls,
        db: Session,
        tenant_id: UUID,
        change_id: UUID,
        payload: ChangeAssessmentUpdateRequest,
        actor_id: UUID,
        operation_id: str | None = None,
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

        stable_operation_id = (operation_id or str(uuid4()))[:255]
        audit_key = f"itsm:change:{chg.id}:assessment:{stable_operation_id}"
        if operation_id and cls._audit_operation_exists(db, tenant_id, audit_key):
            return cls.get_change(db, tenant_id, change_id)

        original_values = {
            "risk_level": chg.risk_level,
            "impact_level": chg.impact_level,
            "change_type": chg.change_type,
            "description": chg.description,
            "implementation_plan": chg.implementation_plan,
            "backout_plan": chg.backout_plan,
            "test_plan": chg.test_plan,
        }

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
        current_values = {
            "risk_level": chg.risk_level,
            "impact_level": chg.impact_level,
            "change_type": chg.change_type,
            "description": chg.description,
            "implementation_plan": chg.implementation_plan,
            "backout_plan": chg.backout_plan,
            "test_plan": chg.test_plan,
        }
        changed_fields = set(payload.model_fields_set)
        before_summary = cls._assessment_audit_summary(
            {field: original_values[field] for field in changed_fields}
        )
        after_summary = cls._assessment_audit_summary(
            {field: current_values[field] for field in changed_fields}
        )
        # Assessment changes and their required audit evidence are one atomic
        # operation. Never leave a changed business record without evidence.
        try:
            if "change_type" in changed_fields and original_values["change_type"] != current_values["change_type"]:
                db.add(
                    ITSMMetricSourceEvent(
                        id=uuid4(),
                        tenant_id=tenant_id,
                        event_type="CHANGE_TYPE_CHANGED",
                        source_type="CHANGE",
                        source_id=chg.id,
                        occurred_at=chg.updated_at,
                        event_key=f"{audit_key}:metric-change-type",
                        payload={
                            "old_change_type": original_values["change_type"],
                            "change_type": current_values["change_type"],
                        },
                    )
                )
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )
            append_audit_event(
                db,
                {
                    "id": str(uuid4()),
                    "idempotency_key": audit_key,
                    "tenant_id": str(tenant_id),
                    "timestamp": datetime.now(timezone.utc),
                    "actor_id": str(actor_id),
                    "actor_type": "user",
                    "action": "itsm.change.assessed",
                    "request_id": stable_operation_id,
                    "event_category": "change_assessment",
                    "target_id": str(chg.id),
                    "target_type": "change_request",
                    "before_summary": before_summary,
                    "after_summary": after_summary,
                    "policy_id": str(chg.id),
                    "provider": "itsm",
                    "reason": f"Change {chg.change_number} assessment updated: Risk={chg.risk_level}, Impact={chg.impact_level}, Type={chg.change_type}",
                    "response_status": 200,
                    "frameworks_affected": ["ITIL"],
                },
            )
            db.commit()
        except Exception:
            db.rollback()
            raise

        db.refresh(chg)

        return cls.get_change(db, tenant_id, change_id)

    @classmethod
    def get_change_activities(
        cls,
        db: Session,
        tenant_id: UUID,
        change_id: UUID,
    ) -> list[ChangeActivityItem]:
        """Fetch audit and lifecycle history for a Change Request."""
        records = (
            db.query(AuditLogMetadata)
            .filter(
                AuditLogMetadata.tenant_id == tenant_id,
                AuditLogMetadata.policy_id == change_id,
            )
            .order_by(AuditLogMetadata.created_at.desc())
            .limit(50)
            .all()
        )

        activities: list[ChangeActivityItem] = []
        user_ids = {r.actor_id for r in records if r.actor_id}
        users_map = {}
        if user_ids:
            user_rows = db.query(User.id, User.email).filter(User.id.in_(user_ids)).all()
            users_map = {u.id: u.email for u in user_rows}

        for r in records:
            actor_email = users_map.get(r.actor_id) if r.actor_id else None
            activities.append(
                ChangeActivityItem(
                    id=r.record_id or r.id,
                    actor_id=r.actor_id,
                    actor_email=actor_email,
                    action=r.action,
                    message=r.reason or r.action,
                    created_at=r.created_at,
                )
            )

        if not activities:
            chg = (
                db.query(ITSMChangeRequest.created_at, ITSMChangeRequest.change_number)
                .filter(
                    ITSMChangeRequest.id == change_id,
                    ITSMChangeRequest.tenant_id == tenant_id,
                )
                .first()
            )
            if chg:
                activities.append(
                    ChangeActivityItem(
                        id=uuid4(),
                        action="itsm.change.created",
                        message=f"Change Request {chg.change_number} registered in system",
                        created_at=chg.created_at,
                    )
                )

        return activities

    @classmethod
    def transition_lifecycle(
        cls,
        db: Session,
        tenant_id: UUID,
        change_id: UUID,
        payload: ChangeLifecycleTransitionRequest,
        actor_id: UUID,
        operation_id: str | None = None,
    ) -> ChangeDetailResponse:
        """Enforce transition rules and progress Change Request through supported lifecycle states."""
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

        current_status = chg.status.upper() if chg.status else "DRAFT"
        action = payload.action.strip().lower()
        stable_operation_id = (operation_id or str(uuid4()))[:255]
        audit_key = f"itsm:change:{chg.id}:lifecycle:{stable_operation_id}"
        if operation_id and cls._audit_operation_exists(db, tenant_id, audit_key):
            return cls.get_change(db, tenant_id, change_id)

        # Terminal state validation
        if current_status in {"CLOSED", "CANCELLED"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot transition change from terminal state '{current_status}'",
            )

        # Transition matrix matching ITIL lifecycle
        transitions = {
            "submit_review": {
                "allowed_from": {"DRAFT", "OPEN"},
                "target_status": "CAB_REVIEW",
                "default_msg": "Submitted for CAB review",
            },
            "approve": {
                "allowed_from": {"CAB_REVIEW", "AWAITING_APPROVAL", "SUBMITTED", "DRAFT"},
                "target_status": "APPROVED",
                "default_msg": "Change approved for implementation",
            },
            "reject": {
                "allowed_from": {"CAB_REVIEW", "AWAITING_APPROVAL", "SUBMITTED"},
                "target_status": "DRAFT",
                "default_msg": "Change rejected / returned for revisions",
            },
            "schedule": {
                "allowed_from": {"APPROVED", "DRAFT", "OPEN", "SCHEDULED"},
                "target_status": "SCHEDULED",
                "default_msg": "Change scheduled for execution window",
            },
            "start_implementation": {
                "allowed_from": {"SCHEDULED", "APPROVED"},
                "target_status": "IMPLEMENTING",
                "default_msg": "Change implementation started",
            },
            "complete": {
                "allowed_from": {"IMPLEMENTING", "IN_PROGRESS"},
                "target_status": "COMPLETED",
                "default_msg": "Change implementation completed and validated",
            },
            "close": {
                "allowed_from": {"COMPLETED"},
                "target_status": "CLOSED",
                "default_msg": "Change closed",
            },
            "cancel": {
                "allowed_from": {"DRAFT", "OPEN", "CAB_REVIEW", "AWAITING_APPROVAL", "APPROVED", "SCHEDULED"},
                "target_status": "CANCELLED",
                "default_msg": "Change cancelled",
            },
        }

        if action not in transitions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported lifecycle action '{payload.action}'. Supported actions: {sorted(transitions.keys())}",
            )

        rule = transitions[action]
        if current_status not in rule["allowed_from"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot perform action '{payload.action}' on change in status '{current_status}'. Allowed from: {sorted(rule['allowed_from'])}",
            )

        old_status = current_status
        new_status = rule["target_status"]
        chg.status = new_status
        now = datetime.now(timezone.utc)
        chg.updated_at = now

        # Action-specific side effects
        if action == "schedule":
            if payload.earliest_start_at:
                chg.earliest_start_at = payload.earliest_start_at
            if payload.latest_finish_at:
                chg.latest_finish_at = payload.latest_finish_at

        if action == "start_implementation":
            if not chg.actual_start_at:
                chg.actual_start_at = now
            if payload.implementation_notes:
                chg.implementation_plan = payload.implementation_notes

        if action == "complete":
            if not chg.actual_finish_at:
                chg.actual_finish_at = now
            if payload.validation_notes:
                chg.test_plan = payload.validation_notes

        reason_text = payload.notes.strip() if payload.notes and payload.notes.strip() else rule["default_msg"]
        try:
            if action in {"complete", "cancel"}:
                db.add(
                    ITSMMetricSourceEvent(
                        id=uuid4(),
                        tenant_id=tenant_id,
                        event_type="CHANGE_OUTCOME",
                        source_type="CHANGE",
                        source_id=chg.id,
                        occurred_at=now,
                        event_key=f"{audit_key}:metric-outcome",
                        payload={
                            "status": new_status,
                            "change_type": chg.change_type,
                        },
                    )
                )
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )
            append_audit_event(
                db,
                {
                    "id": str(uuid4()),
                    "idempotency_key": audit_key,
                    "tenant_id": str(tenant_id),
                    "timestamp": now,
                    "actor_id": str(actor_id),
                    "actor_type": "user",
                    "action": f"itsm.change.{action}",
                    "request_id": stable_operation_id,
                    "event_category": "change_lifecycle",
                    "target_id": str(chg.id),
                    "target_type": "change_request",
                    "before_summary": {"status": old_status},
                    "after_summary": {"status": new_status},
                    "policy_id": str(chg.id),
                    "provider": "itsm",
                    "reason": f"Change {chg.change_number} transitioned from {old_status} to {new_status}: {reason_text}",
                    "response_status": 200,
                    "frameworks_affected": ["ITIL"],
                },
            )
            db.commit()
        except Exception:
            db.rollback()
            raise

        db.refresh(chg)

        return cls.get_change(db, tenant_id, change_id)
