"""
GET /audit-logs — Paginated audit log retrieval with optional ClickHouse backend
and hash-chain integrity verification.

Primary backend: ClickHouse (when CLICKHOUSE_HOST is configured).
Fallback: PostgreSQL audit_log_metadata table (Phase 6 compatibility preserved).
"""

import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session

from app.core.auth import (
    deny_itsm_auditor_generic_audit_access,
    get_tenant_db,
    require_roles,
    require_scopes,
)
from app.db.models import AuditLogMetadata, User
from app.services.audit_store import (
    build_consistency_report,
    clickhouse_configured,
    replay_postgres_to_clickhouse,
)
from app.services.audit_export import (
    build_signed_audit_export,
    signing_key_metadata,
    verify_signed_audit_export,
)
from app.services.audit_utils import (
    canonical_audit_record,
    standardize_timestamp,
    standardize_uuid,
)

logger = logging.getLogger(__name__)

_ACTION_SEARCH_SEPARATORS = re.compile(r"[\s._-]+")


def _action_search_candidate(value: str) -> str:
    """Normalize a displayed action label to the stored dotted action form."""
    return ".".join(
        part
        for part in _ACTION_SEARCH_SEPARATORS.split(value.strip().lower())
        if part
    )

router = APIRouter()

# ──────────────────────────────────────────────────────────────────────────────
# Response schemas
# ──────────────────────────────────────────────────────────────────────────────


class ClickHouseAuditEvent(BaseModel):
    record_id: str
    tenant_id: str
    timestamp: datetime
    actor_id: str
    actor_type: str
    action: str
    policy_id: str
    provider: str
    model: str
    reason: str
    prompt_count: int
    request_size: int
    response_status: int
    duration_ms: int
    frameworks_affected: List[str]
    execution_trace: str = "[]"
    request_id: str = ""  # propagated from X-Request-ID gateway header
    prior_hash: str
    integrity_hash: str
    # Populated when integrity_check=true
    chain_valid: Optional[bool] = None


class AuditLogsResponse(BaseModel):
    source: str  # "clickhouse" | "postgres"
    total: int
    records: List[Any]
    integrity_checked: bool = False


_EVIDENCE_FIELDS = (
    "event_category",
    "context_id",
    "actor_role",
    "target_id",
    "target_type",
    "policy_decision",
    "approval_id",
    "approval_status",
    "before_summary",
    "after_summary",
    "evidence_references",
)


def decode_execution_trace(value: Any) -> dict[str, Any]:
    """Return the structured trace envelope, including legacy key/value steps."""
    parsed = value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = [value]
    if isinstance(parsed, dict):
        return dict(parsed)
    if not isinstance(parsed, list):
        return {}

    result: dict[str, Any] = {"steps": parsed}
    for item in parsed:
        if not isinstance(item, str) or "=" not in item:
            continue
        key, raw_value = item.split("=", 1)
        if key and raw_value:
            result.setdefault(key.strip(), raw_value.strip())
    return result


def enrich_audit_record(record: dict[str, Any]) -> dict[str, Any]:
    """Expose evidence stored inside the immutable execution-trace envelope."""
    trace = decode_execution_trace(record.get("execution_trace"))
    # Preserve useful evidence from legacy ITSM records that predate the
    # structured envelope. New records write target_id directly.
    if not trace.get("target_id") and trace.get("ticket_id"):
        trace["target_id"] = trace["ticket_id"]
    if not trace.get("target_type") and trace.get("ticket_id"):
        action_parts = str(record.get("action") or "").lower().split(".")
        if "incident" in action_parts:
            trace["target_type"] = "incident"
        elif "request" in action_parts:
            trace["target_type"] = "service_request"
    if record.get("model") and not trace.get("model"):
        trace["model"] = record["model"]
    for field in _EVIDENCE_FIELDS:
        if trace.get(field) not in (None, "", [], {}):
            record[field] = trace[field]
    record["execution_trace"] = trace
    return record


class AuditStoreStatusResponse(BaseModel):
    analytics_store: str
    chain_of_record: str
    clickhouse_configured: bool
    clickhouse_available: bool
    detail: str


class AuditReplayRequest(BaseModel):
    dry_run: bool = False


class SignedAuditExportRequest(BaseModel):
    action: Optional[str] = None
    framework: Optional[str] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None


class SignedAuditVerifyRequest(BaseModel):
    artifact: Dict[str, Any]


class SignedAuditVerifyResponse(BaseModel):
    verified: bool
    signature_valid: bool
    digest_valid: bool
    chain_valid: bool
    record_count: int
    tenant_id: str
    key_id: str
    errors: List[str]
    first_record_id: str
    last_record_id: str
    first_hash: str
    last_hash: str


# ──────────────────────────────────────────────────────────────────────────────
# ClickHouse client factory
# ──────────────────────────────────────────────────────────────────────────────


def _get_clickhouse_client() -> Optional[Any]:
    """Return a ClickHouse client, or None if CLICKHOUSE_HOST is not configured.
    Bubbles up exceptions if host is configured but connection fails.
    """
    host = os.getenv("CLICKHOUSE_HOST")
    if not host:
        return None
    try:
        import clickhouse_connect
    except ImportError as exc:
        raise RuntimeError(
            "clickhouse_connect is required when CLICKHOUSE_HOST is configured"
        ) from exc
    return clickhouse_connect.get_client(
        host=host,
        port=int(os.getenv("CLICKHOUSE_PORT", "8123")),
        database=os.getenv("CLICKHOUSE_DB", "authclaw"),
        username=os.getenv("CLICKHOUSE_USER", "authclaw"),
        password=os.getenv("CLICKHOUSE_PASSWORD", ""),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Hash-chain verification
# ──────────────────────────────────────────────────────────────────────────────

_GENESIS_HASH = "GENESIS"


def _canonical_json(record: dict) -> str:
    return json.dumps(canonical_audit_record(record), sort_keys=True, separators=(",", ":"))


def _verify_chain(records: List[dict]) -> List[dict]:
    """Annotate each record with chain_valid=True/False (verifying chronologically)."""
    # Reverse records to go oldest -> newest for rolling verification
    asc_records = list(reversed(records))
    last_hash_by_tenant: Dict[str, str] = {}
    last_sequence_by_tenant: Dict[str, int] = {}

    for record in asc_records:
        tenant_id = record.get("tenant_id", "")
        prior_hash = record.get("prior_hash") or _GENESIS_HASH
        canonical = (
            record.get("canonical_payload")
            if int(record.get("chain_version") or 1) >= 2
            else None
        ) or _canonical_json(record)
        data = str(canonical) + prior_hash
        expected = hashlib.sha256(data.encode("utf-8")).hexdigest()
        actual = record.get("integrity_hash", "")
        previous_hash = last_hash_by_tenant.get(tenant_id)
        sequence = int(record.get("tenant_sequence") or 0)
        previous_sequence = last_sequence_by_tenant.get(tenant_id)
        adjacent_to_previous = bool(
            previous_sequence is not None
            and sequence
            and sequence == previous_sequence + 1
        )
        # Filters and pagination legitimately omit intervening records. The
        # canonical hash still proves each returned record; verify the direct
        # prior-hash link only when both adjacent records are in this result.
        link_valid = (
            previous_hash is None
            or not adjacent_to_previous
            or prior_hash == previous_hash
        )
        record["chain_valid"] = bool(actual) and expected == actual and link_valid
        if actual:
            last_hash_by_tenant[tenant_id] = actual
        if sequence:
            last_sequence_by_tenant[tenant_id] = sequence

    # Reverse back to keep original order (newest first)
    return list(reversed(asc_records))


# ──────────────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=AuditLogsResponse,
    dependencies=[require_scopes(["read"])],
)
def get_audit_logs(
    request: Request,
    db: Session = Depends(get_tenant_db),
    limit: int = Query(default=100, le=1000, ge=1),
    offset: int = Query(default=0, ge=0),
    action: Optional[str] = Query(default=None, description="Filter by exact action"),
    integrity_check: bool = Query(
        default=False,
        description="If true, verify SHA-256 hash chain and annotate each record with chain_valid",
    ),
    search: Optional[str] = Query(default=None, min_length=1, max_length=255),
    trace_only: bool = False,
):
    """
    Retrieve audit log records, tenant-scoped.

    - Primary source: ClickHouse (if CLICKHOUSE_HOST env var is set).
    - Fallback: PostgreSQL audit_log_metadata table.
    - Set integrity_check=true to verify the SHA-256 hash chain.
    """
    deny_itsm_auditor_generic_audit_access(
        request, db, "generic-audit-log.read"
    )
    tenant_id: str = str(request.state.tenant_id)
    # ── ClickHouse path ────────────────────────────────────────────────────────
    host = os.getenv("CLICKHOUSE_HOST")
    if host:
        try:
            ch = _get_clickhouse_client()
            if ch is not None:
                return _query_clickhouse(ch, tenant_id, limit, offset, action, integrity_check, search, trace_only)
        except Exception as exc:
            logger.error("ClickHouse connection or query failed: %s", exc)
            raise HTTPException(
                status_code=503,
                detail=f"ClickHouse audit storage configured but unavailable: {str(exc)}"
            )

    # ── PostgreSQL fallback ────────────────────────────────────────────────────
    return _query_postgres(db, tenant_id, limit, offset, action, integrity_check, search, trace_only)


@router.get(
    "/export/signing-key",
    dependencies=[require_scopes(["read"])],
)
def get_audit_export_signing_key():
    try:
        return signing_key_metadata()
    except Exception as exc:
        logger.error("Audit export signing key metadata failed: %s", exc)
        raise HTTPException(status_code=500, detail="Audit export signing key is not configured") from exc


@router.post(
    "/export",
    dependencies=[require_scopes(["read"])],
)
def create_signed_audit_export(
    request: Request,
    export_request: SignedAuditExportRequest,
    db: Session = Depends(get_tenant_db),
):
    deny_itsm_auditor_generic_audit_access(
        request, db, "generic-audit-export.create"
    )
    return create_signed_audit_export_artifact(request, export_request, db)


def create_signed_audit_export_artifact(
    request: Request,
    export_request: SignedAuditExportRequest,
    db: Session,
):
    try:
        return build_signed_audit_export(
            db,
            tenant_id=str(request.state.tenant_id),
            requested_by=str(getattr(request.state, "user_id", "")),
            action=export_request.action,
            framework=export_request.framework,
            start=export_request.start.astimezone(timezone.utc) if export_request.start else None,
            end=export_request.end.astimezone(timezone.utc) if export_request.end else None,
        )
    except Exception as exc:
        logger.error("Signed audit export failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Signed audit export failed: {str(exc)}") from exc


@router.post(
    "/export/verify",
    response_model=SignedAuditVerifyResponse,
    dependencies=[require_scopes(["read"])],
)
def verify_audit_export(verify_request: SignedAuditVerifyRequest):
    return verify_signed_audit_export(verify_request.artifact).as_dict()


@router.get(
    "/store/status",
    response_model=AuditStoreStatusResponse,
    dependencies=[require_scopes(["read"])],
)
def get_audit_store_status():
    if not clickhouse_configured():
        return AuditStoreStatusResponse(
            analytics_store="postgres_fallback",
            chain_of_record="postgres",
            clickhouse_configured=False,
            clickhouse_available=False,
            detail="CLICKHOUSE_HOST is not configured; audit reads use Postgres fallback.",
        )
    try:
        ch = _get_clickhouse_client()
        ch.query("SELECT 1")
    except Exception:
        return AuditStoreStatusResponse(
            analytics_store="clickhouse",
            chain_of_record="postgres",
            clickhouse_configured=True,
            clickhouse_available=False,
            detail="ClickHouse configured but unavailable.",
        )
    return AuditStoreStatusResponse(
        analytics_store="clickhouse",
        chain_of_record="postgres",
        clickhouse_configured=True,
        clickhouse_available=True,
        detail="ClickHouse is configured and reachable; Postgres remains chain-of-record.",
    )


@router.get(
    "/store/consistency",
    dependencies=[require_scopes(["read"])],
)
def get_audit_store_consistency(
    request: Request,
    db: Session = Depends(get_tenant_db),
):
    ch = _get_clickhouse_client()
    if ch is None:
        raise HTTPException(status_code=503, detail="ClickHouse is not configured")
    tenant_id = str(request.state.tenant_id)
    return build_consistency_report(db, ch, tenant_id).as_dict()


@router.post(
    "/store/replay",
    dependencies=[require_roles(["owner", "admin"]), require_scopes(["write"])],
)
def replay_audit_store(
    request: Request,
    replay: AuditReplayRequest,
    db: Session = Depends(get_tenant_db),
):
    ch = _get_clickhouse_client()
    if ch is None:
        raise HTTPException(status_code=503, detail="ClickHouse is not configured")
    tenant_id = str(request.state.tenant_id)
    return replay_postgres_to_clickhouse(db, ch, tenant_id, dry_run=replay.dry_run)


# ──────────────────────────────────────────────────────────────────────────────
# ClickHouse query
# ──────────────────────────────────────────────────────────────────────────────


def _query_clickhouse(
    ch: Any,
    tenant_id: str,
    limit: int,
    offset: int,
    action: Optional[str],
    integrity_check: bool,
    search: Optional[str] = None,
    trace_only: bool = False,
) -> AuditLogsResponse:
    action_filter = "AND action = {action:String}" if action else ""
    search_filter = """
        AND (
            positionCaseInsensitive(
                concat(
                    ifNull(ae.action, ''), ' ', ifNull(toString(ae.actor_id), ''),
                    ' ', ifNull(ae.request_id, ''),
                    ' ', ifNull(toString(ae.record_id), ''), ' ', ifNull(ae.reason, ''),
                    ' ', ifNull(ae.execution_trace, ''), ' ', ifNull(ae.model, '')
                ),
                {search:String}
            ) > 0
            OR positionCaseInsensitive(
                ifNull(ae.action, ''),
                {action_search:String}
            ) > 0
        )
    """ if search else ""
    trace_filter = """
        AND (
            positionCaseInsensitive(ifNull(ae.execution_trace, ''), 'task_goal') > 0
            OR positionCaseInsensitive(ifNull(ae.action, ''), 'agent.') = 1
            OR positionCaseInsensitive(ifNull(ae.action, ''), 'ai.') = 1
            OR positionCaseInsensitive(ifNull(ae.action, ''), 'tool.') = 1
            OR positionCaseInsensitive(ifNull(ae.action, ''), '.tool.') > 0
        )
    """ if trace_only else ""
    params: dict = {"tenant_id": tenant_id, "limit": limit, "offset": offset}
    if action:
        params["action"] = action
    if search:
        params["search"] = search.strip()
        params["action_search"] = _action_search_candidate(search) or search.strip()

    query = f"""
        SELECT
            toString(ae.record_id)    AS record_id,
            toString(ae.tenant_id)    AS tenant_id,
            ae.tenant_sequence        AS tenant_sequence,
            ae.idempotency_key        AS idempotency_key,
            ae.chain_version          AS chain_version,
            ae.canonical_payload      AS canonical_payload,
            ae.timestamp              AS timestamp,
            ae.actor_id               AS actor_id,
            ae.actor_type             AS actor_type,
            ae.action                 AS action,
            ae.policy_id              AS policy_id,
            ae.provider               AS provider,
            ae.model                  AS model,
            ae.reason                 AS reason,
            ae.prompt_count           AS prompt_count,
            ae.request_size           AS request_size,
            ae.response_status        AS response_status,
            ae.duration_ms            AS duration_ms,
            ae.frameworks_affected    AS frameworks_affected,
            ae.execution_trace        AS execution_trace,
            ae.request_id             AS request_id,
            ae.prior_hash             AS prior_hash,
            ae.integrity_hash         AS integrity_hash
        FROM authclaw.audit_events AS ae
        WHERE ae.tenant_id = {{tenant_id:UUID}}
        {action_filter}
        {search_filter}
        {trace_filter}
        ORDER BY ae.tenant_sequence DESC
        LIMIT {{limit:UInt32}}
        OFFSET {{offset:UInt32}}
    """

    try:
        count_query = f"SELECT count(*) FROM authclaw.audit_events AS ae WHERE ae.tenant_id = {{tenant_id:UUID}} {action_filter} {search_filter} {trace_filter}"
        count_result = ch.query(count_query, parameters=params)
        total_count = count_result.result_rows[0][0] if count_result.result_rows else 0

        result = ch.query(query, parameters=params)
    except Exception as exc:
        logger.error("ClickHouse query failed: %s", exc)
        raise HTTPException(status_code=503, detail="Audit storage temporarily unavailable")

    columns = result.column_names
    records = [dict(zip(columns, row)) for row in result.result_rows]

    # Normalise datetime objects to ISO strings for Pydantic
    for rec in records:
        if isinstance(rec.get("timestamp"), datetime):
            rec["timestamp"] = rec["timestamp"].isoformat()

    if integrity_check:
        records = _verify_chain(records)
    records = [enrich_audit_record(record) for record in records]

    return AuditLogsResponse(
        source="clickhouse",
        total=total_count,
        records=records,
        integrity_checked=integrity_check,
    )


# ──────────────────────────────────────────────────────────────────────────────
# PostgreSQL fallback
# ──────────────────────────────────────────────────────────────────────────────


def _query_postgres(
    db: Session,
    tenant_id: str,
    limit: int,
    offset: int,
    action: Optional[str],
    integrity_check: bool,
    search: Optional[str] = None,
    trace_only: bool = False,
    action_prefix: Optional[str] = None,
    actor: Optional[str] = None,
    target_type: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    outcome: Optional[str] = None,
) -> AuditLogsResponse:
    """Fallback: query PostgreSQL audit_log_metadata for Phase 6 compatibility."""
    try:
        q = db.query(AuditLogMetadata).filter(
            AuditLogMetadata.tenant_id == tenant_id
        )
        if action:
            q = q.filter(AuditLogMetadata.action == action)
        if action_prefix:
            q = q.filter(AuditLogMetadata.action.ilike(f"{action_prefix.strip()}%"))
        if actor and actor.strip():
            actor_pattern = f"%{actor.strip()}%"
            matching_user_ids = [
                row.id
                for row in (
                    db.query(User.id)
                    .filter(
                        User.tenant_id == tenant_id,
                        User.email.ilike(actor_pattern),
                    )
                    .all()
                )
            ]
            actor_conditions = [
                cast(AuditLogMetadata.actor_id, String).ilike(actor_pattern),
                AuditLogMetadata.actor_type.ilike(actor_pattern),
            ]
            if matching_user_ids:
                actor_conditions.append(
                    AuditLogMetadata.actor_id.in_(matching_user_ids)
                )
            q = q.filter(
                or_(*actor_conditions)
            )
        if target_type and target_type.strip():
            target_pattern = f"%target_type%{target_type.strip()}%"
            q = q.filter(AuditLogMetadata.execution_trace.ilike(target_pattern))
        if start:
            q = q.filter(AuditLogMetadata.created_at >= start)
        if end:
            q = q.filter(AuditLogMetadata.created_at <= end)
        if outcome and outcome.strip():
            normalized_outcome = outcome.strip().lower()
            if normalized_outcome == "success":
                q = q.filter(
                    AuditLogMetadata.response_status >= 200,
                    AuditLogMetadata.response_status < 400,
                )
            elif normalized_outcome == "denied":
                q = q.filter(
                    or_(
                        AuditLogMetadata.response_status == 403,
                        AuditLogMetadata.action.ilike("%denied%"),
                    )
                )
            elif normalized_outcome == "failed":
                q = q.filter(
                    or_(
                        AuditLogMetadata.response_status >= 400,
                        AuditLogMetadata.execution_trace.ilike("%fail%"),
                        AuditLogMetadata.execution_trace.ilike("%error%"),
                    )
                )
            else:
                q = q.filter(
                    AuditLogMetadata.execution_trace.ilike(
                        f"%{normalized_outcome}%"
                    )
                )
        if search and search.strip():
            pattern = f"%{search.strip()}%"
            action_candidate = _action_search_candidate(search) or search.strip()
            action_pattern = f"%{action_candidate}%"
            matching_search_user_ids = [
                row.id
                for row in (
                    db.query(User.id)
                    .filter(
                        User.tenant_id == tenant_id,
                        User.email.ilike(pattern),
                    )
                    .all()
                )
            ]
            search_conditions = [
                AuditLogMetadata.action.ilike(pattern),
                AuditLogMetadata.action.ilike(action_pattern),
                AuditLogMetadata.request_id.ilike(pattern),
                AuditLogMetadata.reason.ilike(pattern),
                cast(AuditLogMetadata.actor_id, String).ilike(pattern),
                cast(AuditLogMetadata.record_id, String).ilike(pattern),
                AuditLogMetadata.execution_trace.ilike(pattern),
                AuditLogMetadata.model.ilike(pattern),
            ]
            if matching_search_user_ids:
                search_conditions.append(
                    AuditLogMetadata.actor_id.in_(matching_search_user_ids)
                )
            q = q.filter(
                or_(*search_conditions)
            )
        if trace_only:
            q = q.filter(
                or_(
                    AuditLogMetadata.execution_trace.ilike('%"task_goal"%'),
                    AuditLogMetadata.action.ilike("agent.%"),
                    AuditLogMetadata.action.ilike("ai.%"),
                    AuditLogMetadata.action.ilike("tool.%"),
                    AuditLogMetadata.action.ilike("%.tool.%"),
                )
            )

        total_count = q.count()
        logs = q.order_by(AuditLogMetadata.tenant_sequence.desc()).offset(offset).limit(limit).all()

        records = [
            {
                "id": str(log.id),
                "record_id": str(log.record_id),
                "tenant_id": str(log.tenant_id),
                "tenant_sequence": log.tenant_sequence,
                "idempotency_key": log.idempotency_key,
                "chain_version": log.chain_version,
                "canonical_payload": log.canonical_payload,
                "timestamp": log.created_at.isoformat() if log.created_at else None,
                "actor_id": str(log.actor_id) if log.actor_id else "",
                "actor_type": getattr(log, "actor_type", None) or "gateway",
                "action": log.action,
                "policy_id": str(log.policy_id) if log.policy_id else "",
                "provider": log.provider or "",
                "model": log.model or "",
                "reason": log.reason or "",
                "prompt_count": log.prompt_count or 0,
                "request_size": log.request_size or 0,
                "response_status": log.response_status or 0,
                "duration_ms": log.duration_ms or 0,
                "frameworks_affected": log.frameworks_affected,
                "execution_trace": getattr(log, "execution_trace", "[]") or "[]",
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "request_id": log.request_id or "",
                "prior_hash": log.prior_hash or "",
                "integrity_hash": log.integrity_hash or "",
            }
            for log in logs
        ]
        if integrity_check:
            records = _verify_chain(records)
        records = [enrich_audit_record(record) for record in records]
        return AuditLogsResponse(
            source="postgres",
            total=total_count,
            records=records,
            integrity_checked=integrity_check,
        )
    except Exception as exc:
        logger.error("PostgreSQL audit query failed: %s", exc)
        raise HTTPException(status_code=500, detail="Audit log query failed")


def get_chain_of_record_logs(
    request: Request,
    *,
    db: Session,
    limit: int,
    offset: int,
    action: Optional[str],
    integrity_check: bool,
    search: Optional[str] = None,
    trace_only: bool = False,
    action_prefix: Optional[str] = None,
    actor: Optional[str] = None,
    target_type: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    outcome: Optional[str] = None,
) -> AuditLogsResponse:
    """Read the authoritative immutable store without analytics-replica lag."""
    return _query_postgres(
        db,
        str(request.state.tenant_id),
        limit,
        offset,
        action,
        integrity_check,
        search,
        trace_only,
        action_prefix,
        actor,
        target_type,
        start,
        end,
        outcome,
    )
