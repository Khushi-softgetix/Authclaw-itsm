"""Domain service for CMDB-002: Typed Configuration Item (CI) Relationships."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any, List, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import (
    ITSMConfigurationItem,
    ITSMConfigurationItemRelationship,
    ITSMService,
)
from app.schemas.itsm_admin import (
    CMDB_AUDIT_ACTION_RELATIONSHIP_CREATED,
    CMDB_AUDIT_ACTION_RELATIONSHIP_DELETED,
    VALID_CI_RELATIONSHIP_TYPES,
    ITSMConfigurationItemRelationshipCreateRequest,
    ITSMConfigurationItemRelationshipResponse,
    ITSMRelatedCIDetails,
)
from app.services.audit_store import append_audit_event

logger = logging.getLogger(__name__)


def _emit_relationship_audit(
    db: Session,
    tenant_id: UUID,
    actor_id: Optional[UUID],
    action: str,
    target_id: UUID,
    reason: str,
    details: dict[str, Any],
) -> None:
    now = datetime.now(timezone.utc)
    try:
        db.execute(
            text("SELECT set_config('app.current_tenant_id', :t, true)"),
            {"t": str(tenant_id)},
        )
        append_audit_event(
            db,
            {
                "id": str(uuid4()),
                "idempotency_key": f"itsm:cmdb:{action}:{tenant_id}:{target_id}:{uuid4().hex[:8]}",
                "tenant_id": str(tenant_id),
                "timestamp": now,
                "actor_id": str(actor_id) if actor_id else None,
                "actor_type": "user",
                "action": action,
                "request_id": str(target_id),
                "provider": "itsm",
                "reason": reason,
                "response_status": 200,
                "frameworks_affected": ["ITIL"],
                "execution_trace": [
                    {
                        "step": action,
                        "target_id": str(target_id),
                        "target_type": "ci_relationship",
                        **details,
                    }
                ],
            },
        )
        db.commit()
    except Exception as e:
        logger.warning("[CMDB_AUDIT_WARNING] Could not append CMDB relationship audit event for %s (%s): %s", action, target_id, e)


# Direction rule helpers
def determine_relationship_direction(rel_type: str, is_parent: bool) -> str:
    """Determine whether a relationship represents an upstream or downstream dependency relative to the queried CI."""
    if rel_type in ("DEPENDS_ON", "RUNS_ON", "HOSTED_ON", "PART_OF"):
        # Parent relies on Child -> Child is downstream dependency of Parent
        # From Child's perspective -> Parent is upstream consumer/dependent
        return "downstream" if is_parent else "upstream"
    elif rel_type == "SUPPORTS":
        # Parent provides support to Child -> Parent is downstream support provider of Child
        # From Parent's perspective -> Child is upstream dependent
        return "upstream" if is_parent else "downstream"
    elif rel_type == "CONNECTS_TO":
        # Outgoing connection is downstream; incoming is upstream
        return "downstream" if is_parent else "upstream"
    elif rel_type == "OWNED_BY":
        return "downstream" if is_parent else "upstream"
    return "downstream" if is_parent else "upstream"


def format_display_label(rel_type: str, is_parent: bool, related_ci_name: str) -> str:
    """Return a human-readable display string describing the relationship."""
    forward_labels = {
        "DEPENDS_ON": f"Depends on {related_ci_name}",
        "RUNS_ON": f"Runs on {related_ci_name}",
        "HOSTED_ON": f"Hosted on {related_ci_name}",
        "CONNECTS_TO": f"Connects to {related_ci_name}",
        "OWNED_BY": f"Owned by {related_ci_name}",
        "SUPPORTS": f"Supports {related_ci_name}",
        "PART_OF": f"Part of {related_ci_name}",
    }
    inverse_labels = {
        "DEPENDS_ON": f"Depended on by {related_ci_name}",
        "RUNS_ON": f"Hosts / Runs {related_ci_name}",
        "HOSTED_ON": f"Hosts {related_ci_name}",
        "CONNECTS_TO": f"Connected from {related_ci_name}",
        "OWNED_BY": f"Owns {related_ci_name}",
        "SUPPORTS": f"Supported by {related_ci_name}",
        "PART_OF": f"Contains {related_ci_name}",
    }
    if is_parent:
        return forward_labels.get(rel_type, f"{rel_type} {related_ci_name}")
    return inverse_labels.get(rel_type, f"{rel_type} (from {related_ci_name})")


def validate_ci_class_compatibility(parent: ITSMConfigurationItem, child: ITSMConfigurationItem, rel_type: str) -> None:
    """Enforce CI class compatibility and direction rules."""
    p_type = parent.ci_type.upper()
    c_type = child.ci_type.upper()

    # Rule 1: No self-links
    if parent.id == child.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A Configuration Item cannot have a relationship with itself (self-link is prohibited)",
        )

    # Rule 2: RUNS_ON direction rule
    # Infrastructure (SERVER, CONTAINER_CLUSTER, CLOUD_SERVICE) does not "run on" high-level software/DB
    if rel_type == "RUNS_ON":
        if p_type in ("SERVER", "NETWORK_DEVICE") and c_type in ("APPLICATION", "DATABASE"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid direction rule: {p_type} cannot run on {c_type}",
            )

    # Rule 3: HOSTED_ON direction rule
    # Host infrastructure must be a hosting provider/compute/cloud
    if rel_type == "HOSTED_ON":
        if c_type in ("DATABASE", "APPLICATION") and p_type in ("CLOUD_SERVICE", "SERVER"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid direction rule: {p_type} cannot be hosted on {c_type}",
            )


class CIRelationshipService:
    @classmethod
    def create_relationship(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: Optional[UUID],
        payload: ITSMConfigurationItemRelationshipCreateRequest,
    ) -> ITSMConfigurationItemRelationshipResponse:
        """Create a typed relationship between two CIs in the current tenant."""
        # 1. Self-link check
        if payload.parent_ci_id == payload.child_ci_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A Configuration Item cannot have a relationship with itself (self-link is prohibited)",
            )

        # 2. Type validation
        rel_type = payload.relationship_type.strip().upper()
        if rel_type not in VALID_CI_RELATIONSHIP_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid relationship type '{rel_type}'. Supported types: {', '.join(VALID_CI_RELATIONSHIP_TYPES)}",
            )

        # 3. Tenant-scoped validation for both CIs
        parent_ci = (
            db.query(ITSMConfigurationItem)
            .filter(
                ITSMConfigurationItem.tenant_id == tenant_id,
                ITSMConfigurationItem.id == payload.parent_ci_id,
            )
            .first()
        )
        if not parent_ci:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent Configuration Item not found in this tenant",
            )

        child_ci = (
            db.query(ITSMConfigurationItem)
            .filter(
                ITSMConfigurationItem.tenant_id == tenant_id,
                ITSMConfigurationItem.id == payload.child_ci_id,
            )
            .first()
        )
        if not child_ci:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Child Configuration Item not found in this tenant",
            )

        # 4. Enforce class compatibility / direction rules
        validate_ci_class_compatibility(parent_ci, child_ci, rel_type)

        # 5. Duplicate check
        existing = (
            db.query(ITSMConfigurationItemRelationship)
            .filter(
                ITSMConfigurationItemRelationship.tenant_id == tenant_id,
                ITSMConfigurationItemRelationship.parent_ci_id == payload.parent_ci_id,
                ITSMConfigurationItemRelationship.child_ci_id == payload.child_ci_id,
                ITSMConfigurationItemRelationship.relationship_type == rel_type,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Relationship already exists between these Configuration Items with type '{rel_type}'",
            )

        # 6. Insert relationship record
        now = datetime.now(timezone.utc)
        rel = ITSMConfigurationItemRelationship(
            tenant_id=tenant_id,
            parent_ci_id=payload.parent_ci_id,
            child_ci_id=payload.child_ci_id,
            relationship_type=rel_type,
            source=payload.source.strip() if payload.source else "MANUAL",
            confidence=payload.confidence if payload.confidence is not None else 1.0,
            status="ACTIVE",
            created_at=now,
            updated_at=now,
        )
        db.add(rel)
        db.commit()
        db.refresh(rel)

        # 7. Emit CMDB audit event
        _emit_relationship_audit(
            db=db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            action=CMDB_AUDIT_ACTION_RELATIONSHIP_CREATED,
            target_id=rel.id,
            reason=f"Created relationship '{rel.relationship_type}' from CI '{parent_ci.name}' to CI '{child_ci.name}'",
            details={
                "relationship_id": str(rel.id),
                "parent_ci_id": str(rel.parent_ci_id),
                "parent_ci_name": parent_ci.name,
                "child_ci_id": str(rel.child_ci_id),
                "child_ci_name": child_ci.name,
                "relationship_type": rel.relationship_type,
                "source": rel.source,
                "confidence": rel.confidence,
            },
        )

        logger.info(
            "[ITSM_ADMIN_AUDIT] action=relationship_created tenant_id=%s actor_id=%s rel_id=%s type=%s parent=%s child=%s",
            tenant_id,
            actor_id,
            rel.id,
            rel.relationship_type,
            rel.parent_ci_id,
            rel.child_ci_id,
        )

        # Build response with related CI (from parent perspective, child is the related CI)
        child_service_name = None
        if child_ci.service_id:
            srv = db.query(ITSMService.name).filter(ITSMService.id == child_ci.service_id, ITSMService.tenant_id == tenant_id).first()
            if srv:
                child_service_name = srv[0]

        related_details = ITSMRelatedCIDetails(
            id=child_ci.id,
            name=child_ci.name,
            ci_type=child_ci.ci_type,
            environment=child_ci.environment,
            status=child_ci.status,
            service_id=child_ci.service_id,
            service_name=child_service_name,
        )

        return ITSMConfigurationItemRelationshipResponse(
            id=rel.id,
            tenant_id=rel.tenant_id,
            parent_ci_id=rel.parent_ci_id,
            child_ci_id=rel.child_ci_id,
            relationship_type=rel.relationship_type,
            source=rel.source,
            confidence=rel.confidence,
            status=rel.status,
            created_at=rel.created_at,
            updated_at=rel.updated_at,
            direction="downstream",
            display_label=format_display_label(rel.relationship_type, True, child_ci.name),
            related_ci=related_details,
        )

    @classmethod
    def list_relationships_for_ci(
        cls,
        db: Session,
        tenant_id: UUID,
        ci_id: UUID,
        direction: Optional[str] = None,
        relationship_type: Optional[str] = None,
    ) -> List[ITSMConfigurationItemRelationshipResponse]:
        """List relationships for a CI with related CI details, direction metadata, and upstream/downstream filters."""
        # 1. Ensure target CI exists in tenant
        target_ci = (
            db.query(ITSMConfigurationItem)
            .filter(ITSMConfigurationItem.tenant_id == tenant_id, ITSMConfigurationItem.id == ci_id)
            .first()
        )
        if not target_ci:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Configuration Item not found in this tenant",
            )

        # Validate direction if provided
        norm_direction = direction.strip().lower() if direction and direction.strip() else None
        if norm_direction and norm_direction not in ("upstream", "downstream", "all"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid direction '{direction}'. Supported directions: 'upstream', 'downstream', 'all'",
            )

        # Validate relationship_type if provided
        norm_rel_type = relationship_type.strip().upper() if relationship_type and relationship_type.strip() else None
        if norm_rel_type and norm_rel_type not in VALID_CI_RELATIONSHIP_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid relationship type '{relationship_type}'. Supported types: {', '.join(VALID_CI_RELATIONSHIP_TYPES)}",
            )

        # 2. Query all relationships where target_ci is either parent or child
        query = db.query(ITSMConfigurationItemRelationship).filter(
            ITSMConfigurationItemRelationship.tenant_id == tenant_id,
            (ITSMConfigurationItemRelationship.parent_ci_id == ci_id)
            | (ITSMConfigurationItemRelationship.child_ci_id == ci_id),
        )

        if norm_rel_type:
            query = query.filter(
                ITSMConfigurationItemRelationship.relationship_type == norm_rel_type
            )

        relationships = query.order_by(ITSMConfigurationItemRelationship.created_at.desc()).all()
        if not relationships:
            return []

        # 3. Collect all related CI IDs and fetch their details in bulk
        related_ci_ids = {
            rel.child_ci_id if rel.parent_ci_id == ci_id else rel.parent_ci_id
            for rel in relationships
        }
        ci_map = {
            ci.id: ci
            for ci in db.query(ITSMConfigurationItem)
            .filter(
                ITSMConfigurationItem.tenant_id == tenant_id,
                ITSMConfigurationItem.id.in_(related_ci_ids),
            )
            .all()
        }

        # Collect service names
        service_ids = {ci.service_id for ci in ci_map.values() if ci.service_id}
        service_map = {}
        if service_ids:
            service_map = {
                srv.id: srv.name
                for srv in db.query(ITSMService.id, ITSMService.name)
                .filter(ITSMService.tenant_id == tenant_id, ITSMService.id.in_(service_ids))
                .all()
            }

        # 4. Build enriched responses and apply direction filter
        norm_direction = direction.strip().lower() if direction else None
        results: List[ITSMConfigurationItemRelationshipResponse] = []

        for rel in relationships:
            is_parent = rel.parent_ci_id == ci_id
            other_ci_id = rel.child_ci_id if is_parent else rel.parent_ci_id
            other_ci = ci_map.get(other_ci_id)
            if not other_ci:
                continue

            rel_direction = determine_relationship_direction(rel.relationship_type, is_parent)

            # Direction filtering
            if norm_direction in ("upstream", "downstream") and rel_direction != norm_direction:
                continue

            related_details = ITSMRelatedCIDetails(
                id=other_ci.id,
                name=other_ci.name,
                ci_type=other_ci.ci_type,
                environment=other_ci.environment,
                status=other_ci.status,
                service_id=other_ci.service_id,
                service_name=service_map.get(other_ci.service_id),
            )

            results.append(
                ITSMConfigurationItemRelationshipResponse(
                    id=rel.id,
                    tenant_id=rel.tenant_id,
                    parent_ci_id=rel.parent_ci_id,
                    child_ci_id=rel.child_ci_id,
                    relationship_type=rel.relationship_type,
                    source=rel.source,
                    confidence=rel.confidence,
                    status=rel.status,
                    created_at=rel.created_at,
                    updated_at=rel.updated_at,
                    direction=rel_direction,
                    display_label=format_display_label(rel.relationship_type, is_parent, other_ci.name),
                    related_ci=related_details,
                )
            )

        return results

    @classmethod
    def delete_relationship(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: Optional[UUID],
        relationship_id: UUID,
    ) -> None:
        """Delete a relationship by its stable UUID, enforcing tenant isolation and audit logging."""
        rel = (
            db.query(ITSMConfigurationItemRelationship)
            .filter(
                ITSMConfigurationItemRelationship.tenant_id == tenant_id,
                ITSMConfigurationItemRelationship.id == relationship_id,
            )
            .first()
        )
        if not rel:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Relationship not found in this tenant",
            )

        parent_ci = db.query(ITSMConfigurationItem).filter(ITSMConfigurationItem.id == rel.parent_ci_id, ITSMConfigurationItem.tenant_id == tenant_id).first()
        child_ci = db.query(ITSMConfigurationItem).filter(ITSMConfigurationItem.id == rel.child_ci_id, ITSMConfigurationItem.tenant_id == tenant_id).first()

        parent_name = parent_ci.name if parent_ci else "Unknown CI"
        child_name = child_ci.name if child_ci else "Unknown CI"

        db.delete(rel)
        db.commit()

        # Emit audit event
        _emit_relationship_audit(
            db=db,
            tenant_id=tenant_id,
            actor_id=actor_id,
            action=CMDB_AUDIT_ACTION_RELATIONSHIP_DELETED,
            target_id=rel.id,
            reason=f"Deleted relationship '{rel.relationship_type}' between CI '{parent_name}' and CI '{child_name}'",
            details={
                "relationship_id": str(rel.id),
                "parent_ci_id": str(rel.parent_ci_id),
                "parent_ci_name": parent_name,
                "child_ci_id": str(rel.child_ci_id),
                "child_ci_name": child_name,
                "relationship_type": rel.relationship_type,
            },
        )

        logger.info(
            "[ITSM_ADMIN_AUDIT] action=relationship_deleted tenant_id=%s actor_id=%s rel_id=%s type=%s",
            tenant_id,
            actor_id,
            relationship_id,
            rel.relationship_type,
        )

    @classmethod
    def list_all_relationships(
        cls,
        db: Session,
        tenant_id: UUID,
        relationship_type: Optional[str] = None,
    ) -> List[ITSMConfigurationItemRelationshipResponse]:
        """List all relationships in tenant with basic attributes."""
        query = db.query(ITSMConfigurationItemRelationship).filter(
            ITSMConfigurationItemRelationship.tenant_id == tenant_id
        )
        norm_rel_type = relationship_type.strip().upper() if relationship_type and relationship_type.strip() else None
        if norm_rel_type and norm_rel_type not in VALID_CI_RELATIONSHIP_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid relationship type '{relationship_type}'. Supported types: {', '.join(VALID_CI_RELATIONSHIP_TYPES)}",
            )
        if norm_rel_type:
            query = query.filter(
                ITSMConfigurationItemRelationship.relationship_type == norm_rel_type
            )
        rels = query.order_by(ITSMConfigurationItemRelationship.created_at.desc()).all()

        return [
            ITSMConfigurationItemRelationshipResponse(
                id=r.id,
                tenant_id=r.tenant_id,
                parent_ci_id=r.parent_ci_id,
                child_ci_id=r.child_ci_id,
                relationship_type=r.relationship_type,
                source=r.source,
                confidence=r.confidence,
                status=r.status,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
            for r in rels
        ]
