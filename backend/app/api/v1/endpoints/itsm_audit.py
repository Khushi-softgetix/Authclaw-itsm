"""Read-only ITSM audit evidence endpoints for the Auditor role."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, or_, text
from sqlalchemy.orm import Session

from app.api.v1.endpoints import audit as audit_api
from app.core.auth import get_tenant_db, require_itsm_roles, require_scopes
from app.db.models import AuditLogMetadata, User
from app.services.audit_store import append_audit_event, get_postgres_records, verify_audit_chain

logger = logging.getLogger(__name__)

router = APIRouter()


class AuditorOverviewResponse(BaseModel):
    total_events: int
    privileged_events: int
    denied_events: int
    ai_events: int
    exported_evidence: int
    administrative_changes: int
    integrity_valid: bool
    last_verified_at: Optional[datetime]
    source: str
    recent_events: list[Any]
    activity_trend: list[dict[str, Any]]
    top_actions: list[dict[str, Any]]


_SAFE_AUDIT_FIELDS = {
    "record_id", "tenant_id", "tenant_sequence", "timestamp", "created_at",
    "actor_id", "actor_display", "actor_type", "actor_role", "action",
    "request_id", "context_id", "event_category", "target_id", "target_type",
    "policy_id", "policy_decision", "approval_id", "approval_status",
    "before_summary", "after_summary", "evidence_references", "provider",
    "model", "reason", "response_status", "frameworks_affected",
    "execution_trace", "prior_hash", "integrity_hash", "chain_valid",
}

_SENSITIVE_EVIDENCE_KEYS = {
    "authorization", "cookie", "credential", "credentials", "password",
    "raw_prompt", "secret", "token",
}


def _sanitize_evidence_value(value: Any) -> Any:
    """Redact secret-bearing trace fields before Auditor evidence leaves the API."""
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]"
            if any(marker in str(key).lower() for marker in _SENSITIVE_EVIDENCE_KEYS)
            else _sanitize_evidence_value(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_evidence_value(item) for item in value]
    if isinstance(value, str):
        for separator in ("=", ":"):
            if separator not in value:
                continue
            key, _item = value.split(separator, 1)
            if any(marker in key.strip().lower() for marker in _SENSITIVE_EVIDENCE_KEYS):
                return f"{key.strip()}{separator}[REDACTED]"
    return value


def _auditor_safe_record(record: object) -> object:
    if not isinstance(record, dict):
        return record
    return {
        key: _sanitize_evidence_value(value)
        for key, value in record.items()
        if key in _SAFE_AUDIT_FIELDS
    }


def _prepare_auditor_result(
    db: Session,
    tenant_id: UUID,
    result: audit_api.AuditLogsResponse,
) -> audit_api.AuditLogsResponse:
    result.records = [_auditor_safe_record(record) for record in result.records]
    _attach_actor_displays(db, tenant_id, result.records)
    return result


def _action_matches(*patterns: str):
    return or_(*(AuditLogMetadata.action.ilike(pattern) for pattern in patterns))


def _auditor_summary(db: Session, tenant_id: UUID) -> dict[str, Any]:
    """Build tenant-scoped Auditor read models from the existing audit chain."""
    base = db.query(AuditLogMetadata).filter(AuditLogMetadata.tenant_id == tenant_id)
    privileged = _action_matches(
        "%privileged%", "%break%glass%", "%role%", "%permission%", "%admin%"
    )
    denied = or_(
        AuditLogMetadata.response_status == status.HTTP_403_FORBIDDEN,
        AuditLogMetadata.action.ilike("%denied%"),
    )
    ai_activity = or_(
        AuditLogMetadata.action.ilike("agent.%"),
        AuditLogMetadata.action.ilike("ai.%"),
        AuditLogMetadata.execution_trace.ilike('%"task_goal"%'),
    )
    administrative = _action_matches(
        "%tenant%", "%role%", "%permission%", "%config%", "%workflow%",
        "%feature%", "%retention%", "%purge%",
    )

    last_event_at = base.with_entities(func.max(AuditLogMetadata.created_at)).scalar()
    trend_start = (
        last_event_at - timedelta(days=13)
        if last_event_at
        else datetime.now(timezone.utc) - timedelta(days=13)
    )
    trend_rows = (
        base.with_entities(
            cast(AuditLogMetadata.created_at, Date).label("day"),
            func.count(AuditLogMetadata.id).label("count"),
        )
        .filter(AuditLogMetadata.created_at >= trend_start)
        .group_by(cast(AuditLogMetadata.created_at, Date))
        .order_by(cast(AuditLogMetadata.created_at, Date))
        .all()
    )
    top_action_rows = (
        base.with_entities(
            AuditLogMetadata.action,
            func.count(AuditLogMetadata.id).label("count"),
        )
        .group_by(AuditLogMetadata.action)
        .order_by(func.count(AuditLogMetadata.id).desc(), AuditLogMetadata.action.asc())
        .limit(6)
        .all()
    )
    records = get_postgres_records(db, str(tenant_id))
    verified_at = datetime.now(timezone.utc) if records else None

    return {
        "total_events": base.count(),
        "privileged_events": base.filter(privileged).count(),
        "denied_events": base.filter(denied).count(),
        "ai_events": base.filter(ai_activity).count(),
        "exported_evidence": base.filter(AuditLogMetadata.action == "itsm.audit.exported").count(),
        "administrative_changes": base.filter(administrative).count(),
        "integrity_valid": verify_audit_chain(records),
        "last_verified_at": verified_at,
        "source": "postgres",
        "activity_trend": [
            {"date": row.day.isoformat(), "count": int(row.count)} for row in trend_rows
        ],
        "top_actions": [
            {"action": row.action, "count": int(row.count)} for row in top_action_rows
        ],
    }


def _attach_actor_displays(
    db: Session,
    tenant_id: UUID,
    records: list[object],
) -> None:
    """Attach tenant-scoped user emails without changing immutable evidence."""
    actor_ids: set[UUID] = set()
    for record in records:
        if not isinstance(record, dict) or str(record.get("actor_type") or "").lower() != "user":
            continue
        try:
            actor_ids.add(UUID(str(record.get("actor_id") or "")))
        except ValueError:
            continue

    if not actor_ids:
        return

    users = (
        db.query(User.id, User.email)
        .filter(User.tenant_id == tenant_id, User.id.in_(actor_ids))
        .all()
    )
    displays = {str(user.id): user.email for user in users}
    for record in records:
        if isinstance(record, dict) and str(record.get("actor_id") or "") in displays:
            record["actor_display"] = displays[str(record["actor_id"])]


def _record_auditor_action(
    db: Session,
    request: Request,
    *,
    action: str,
    reason: str,
    trace: Any,
) -> None:
    """Append the documented audit-search/export evidence before responding."""
    tenant_id = str(request.state.tenant_id)
    correlation_id = request.headers.get("x-request-id") or str(uuid4())
    try:
        db.execute(
            text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
            {"tenant_id": tenant_id},
        )
        append_audit_event(
            db,
            {
                "id": str(uuid4()),
                "tenant_id": tenant_id,
                "timestamp": datetime.now(timezone.utc),
                "actor_id": str(request.state.user_id),
                "actor_type": "user",
                "action": action,
                "request_id": correlation_id,
                "context_id": correlation_id,
                "event_category": "action",
                "target_id": "tenant-audit-evidence",
                "target_type": "audit_store",
                "provider": "itsm",
                "reason": reason,
                "response_status": status.HTTP_200_OK,
                "frameworks_affected": [],
                "execution_trace": trace,
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to record Auditor evidence access: action=%s", action)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Audit evidence access could not be recorded",
        ) from exc


@router.get(
    "/events",
    response_model=audit_api.AuditLogsResponse,
    dependencies=[require_scopes(["read"])],
    summary="Search tenant audit evidence",
)
def search_audit_events(
    request: Request,
    db: Session = Depends(get_tenant_db),
    limit: int = Query(default=100, le=1000, ge=1),
    offset: int = Query(default=0, ge=0),
    action: Optional[str] = Query(default=None, max_length=255),
    action_prefix: Optional[str] = Query(default=None, max_length=255),
    actor: Optional[str] = Query(default=None, max_length=255),
    target_type: Optional[str] = Query(default=None, max_length=100),
    outcome: Optional[str] = Query(default=None, max_length=50),
    start: Optional[datetime] = Query(default=None),
    end: Optional[datetime] = Query(default=None),
    search: Optional[str] = Query(default=None, min_length=1, max_length=255),
    integrity_check: bool = Query(default=True),
    _auditor: None = require_itsm_roles(["AUDITOR"]),
):
    explicit_search = any(
        (action, action_prefix, actor, target_type, outcome, start, end, search)
    )
    if offset == 0 and explicit_search:
        _record_auditor_action(
            db,
            request,
            action="itsm.audit.searched",
            reason="Auditor searched tenant audit evidence",
            trace={
                "action_filter": action or "",
                "action_prefix_filter": action_prefix or "",
                "actor_filter": actor or "",
                "target_type_filter": target_type or "",
                "outcome_filter": outcome or "",
                "start_filter": bool(start),
                "end_filter": bool(end),
                "search_provided": bool(search),
                "integrity_check": integrity_check,
                "limit": limit,
            },
        )
    result = audit_api.get_chain_of_record_logs(
        request,
        db=db,
        limit=limit,
        offset=offset,
        action=action,
        action_prefix=action_prefix,
        actor=actor,
        target_type=target_type,
        outcome=outcome,
        start=start,
        end=end,
        integrity_check=integrity_check,
        search=search,
    )
    _prepare_auditor_result(db, request.state.tenant_id, result)
    return result


@router.get(
    "/overview",
    response_model=AuditorOverviewResponse,
    dependencies=[require_scopes(["read"])],
    summary="Get the tenant Auditor overview and reporting summary",
)
def get_auditor_overview(
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auditor: None = require_itsm_roles(["AUDITOR"]),
):
    summary = _auditor_summary(db, request.state.tenant_id)
    recent = audit_api.get_chain_of_record_logs(
        request,
        db=db,
        limit=6,
        offset=0,
        action=None,
        integrity_check=False,
    )
    _prepare_auditor_result(db, request.state.tenant_id, recent)
    summary["recent_events"] = recent.records
    return AuditorOverviewResponse(**summary)


@router.get(
    "/events/{record_id}",
    dependencies=[require_scopes(["read"])],
    summary="Inspect one authorized tenant audit event",
)
def get_audit_event(
    record_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auditor: None = require_itsm_roles(["AUDITOR"]),
):
    record = (
        db.query(AuditLogMetadata)
        .filter(
            AuditLogMetadata.tenant_id == request.state.tenant_id,
            AuditLogMetadata.record_id == record_id,
        )
        .first()
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit event not found")
    payload = audit_api.enrich_audit_record(
        {
            "record_id": str(record.record_id),
            "tenant_id": str(record.tenant_id),
            "tenant_sequence": record.tenant_sequence,
            "idempotency_key": record.idempotency_key,
            "chain_version": record.chain_version,
            "canonical_payload": record.canonical_payload,
            "timestamp": record.created_at.isoformat() if record.created_at else None,
            "actor_id": str(record.actor_id) if record.actor_id else "",
            "actor_type": record.actor_type,
            "action": record.action,
            "request_id": record.request_id or "",
            "policy_id": str(record.policy_id) if record.policy_id else "",
            "provider": record.provider or "",
            "model": record.model or "",
            "reason": record.reason or "",
            "response_status": record.response_status,
            "frameworks_affected": record.frameworks_affected or [],
            "execution_trace": record.execution_trace,
            "prior_hash": record.prior_hash or "",
            "integrity_hash": record.integrity_hash or "",
        }
    )
    payload = audit_api._verify_chain([payload])[0]
    payload = _auditor_safe_record(payload)
    records = [payload]
    _attach_actor_displays(db, request.state.tenant_id, records)
    return records[0]


@router.get(
    "/exports",
    response_model=audit_api.AuditLogsResponse,
    dependencies=[require_scopes(["read"])],
    summary="List authorized tenant audit export history",
)
def list_audit_exports(
    request: Request,
    db: Session = Depends(get_tenant_db),
    limit: int = Query(default=50, le=200, ge=1),
    offset: int = Query(default=0, ge=0),
    _auditor: None = require_itsm_roles(["AUDITOR"]),
):
    result = audit_api.get_chain_of_record_logs(
        request,
        db=db,
        limit=limit,
        offset=offset,
        action="itsm.audit.exported",
        integrity_check=True,
    )
    return _prepare_auditor_result(db, request.state.tenant_id, result)


@router.get(
    "/traces",
    response_model=audit_api.AuditLogsResponse,
    dependencies=[require_scopes(["read"])],
    summary="Search tenant agent execution traces",
)
def search_agent_traces(
    request: Request,
    db: Session = Depends(get_tenant_db),
    limit: int = Query(default=100, le=1000, ge=1),
    offset: int = Query(default=0, ge=0),
    search: Optional[str] = Query(default=None, min_length=1, max_length=255),
    outcome: Optional[str] = Query(default=None, max_length=50),
    actor: Optional[str] = Query(default=None, max_length=255),
    start: Optional[datetime] = Query(default=None),
    end: Optional[datetime] = Query(default=None),
    integrity_check: bool = Query(default=True),
    _auditor: None = require_itsm_roles(["AUDITOR"]),
):
    explicit_search = any((search, outcome, actor, start, end))
    if offset == 0 and explicit_search:
        _record_auditor_action(
            db,
            request,
            action="itsm.audit.traces.searched",
            reason="Auditor searched tenant agent execution traces",
            trace={
                "search_provided": bool(search),
                "outcome_filter": outcome or "",
                "actor_filter": actor or "",
                "start_filter": bool(start),
                "end_filter": bool(end),
                "integrity_check": integrity_check,
                "limit": limit,
            },
        )
    result = audit_api.get_chain_of_record_logs(
        request,
        db=db,
        limit=limit,
        offset=offset,
        action=None,
        actor=actor,
        start=start,
        end=end,
        outcome=outcome,
        integrity_check=integrity_check,
        search=search,
        trace_only=True,
    )
    _prepare_auditor_result(db, request.state.tenant_id, result)
    return result


@router.post(
    "/export",
    dependencies=[require_scopes(["read"])],
    summary="Create a signed tenant audit evidence export",
)
def export_audit_evidence(
    export_request: audit_api.SignedAuditExportRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auditor: None = require_itsm_roles(["AUDITOR"]),
):
    artifact = audit_api.create_signed_audit_export_artifact(
        request, export_request, db
    )
    manifest = artifact.get("manifest", {})
    export_id = str(manifest.get("export_id") or uuid4())
    _record_auditor_action(
        db,
        request,
        action="itsm.audit.exported",
        reason="Auditor created a signed tenant evidence export",
        trace={
            "export_id": export_id,
            "action_filter": export_request.action or "",
            "framework_filter": export_request.framework or "",
            "start_filter": bool(export_request.start),
            "end_filter": bool(export_request.end),
            "record_count": manifest.get("record_count", 0),
        },
    )
    return artifact
