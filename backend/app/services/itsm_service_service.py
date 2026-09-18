"""Domain service for ITSM Services management (Step 7)."""
from __future__ import annotations

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.db.models import ITSMConfigurationItem, ITSMService, ITSMTicket, User
from app.schemas.itsm_services import (
    ITSMServiceCIData,
    ITSMServiceDetailResponse,
    ITSMServiceSummaryResponse,
    ITSMServiceTicketSummary,
)

logger = logging.getLogger(__name__)


class ITSMServiceManager:
    """Business logic for querying ITSM Services, CIs, and service ticket context."""

    @classmethod
    def list_services(
        cls,
        db: Session,
        tenant_id: UUID,
        search: Optional[str] = None,
        status_filter: Optional[str] = None,
        tier_filter: Optional[str] = None,
    ) -> List[ITSMServiceSummaryResponse]:
        """List services for tenant with search, filtering, and aggregation."""
        query = (
            db.query(ITSMService)
            .options(joinedload(ITSMService.owner))
            .filter(ITSMService.tenant_id == tenant_id)
        )

        if status_filter:
            norm_status = status_filter.strip().upper()
            if norm_status != "ALL":
                query = query.filter(func.upper(ITSMService.status) == norm_status)

        if tier_filter:
            norm_tier = tier_filter.strip().upper()
            if norm_tier != "ALL":
                query = query.filter(func.upper(ITSMService.tier) == norm_tier)

        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    ITSMService.name.ilike(term),
                    ITSMService.description.ilike(term),
                    ITSMService.slug.ilike(term),
                    ITSMService.escalation_team.ilike(term),
                )
            )

        services = query.order_by(ITSMService.name.asc()).all()
        if not services:
            return []

        service_ids = [s.id for s in services]

        # Aggregate CI counts per service
        ci_counts = dict(
            db.query(
                ITSMConfigurationItem.service_id,
                func.count(ITSMConfigurationItem.id),
            )
            .filter(
                ITSMConfigurationItem.tenant_id == tenant_id,
                ITSMConfigurationItem.service_id.in_(service_ids),
            )
            .group_by(ITSMConfigurationItem.service_id)
            .all()
        )

        # Aggregate active tickets per service
        ticket_counts = dict(
            db.query(
                ITSMTicket.service_id,
                func.count(ITSMTicket.id),
            )
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.service_id.in_(service_ids),
                ITSMTicket.status.notin_(["RESOLVED", "CLOSED", "CANCELLED"]),
            )
            .group_by(ITSMTicket.service_id)
            .all()
        )

        results = []
        for s in services:
            owner_email = s.owner.email if s.owner else None
            results.append(
                ITSMServiceSummaryResponse(
                    id=s.id,
                    name=s.name,
                    slug=s.slug,
                    description=s.description,
                    tier=s.tier,
                    status=s.status,
                    escalation_team=s.escalation_team,
                    owner_user_id=s.owner_user_id,
                    owner_email=owner_email,
                    ci_count=ci_counts.get(s.id, 0),
                    active_ticket_count=ticket_counts.get(s.id, 0),
                    created_at=s.created_at,
                    updated_at=s.updated_at,
                )
            )
        return results

    @classmethod
    def get_service_detail(
        cls,
        db: Session,
        tenant_id: UUID,
        service_id_or_slug: str,
    ) -> ITSMServiceDetailResponse:
        """Retrieve service detail with linked CIs and recent tickets."""
        query = (
            db.query(ITSMService)
            .options(joinedload(ITSMService.owner))
            .filter(ITSMService.tenant_id == tenant_id)
        )

        try:
            val_uuid = UUID(service_id_or_slug)
            service = query.filter(
                or_(ITSMService.id == val_uuid, ITSMService.slug == service_id_or_slug)
            ).first()
        except ValueError:
            service = query.filter(ITSMService.slug == service_id_or_slug).first()

        if not service:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="ITSM service not found",
            )

        # Fetch linked Configuration Items
        cis = (
            db.query(ITSMConfigurationItem)
            .filter(
                ITSMConfigurationItem.tenant_id == tenant_id,
                ITSMConfigurationItem.service_id == service.id,
            )
            .order_by(ITSMConfigurationItem.name.asc())
            .all()
        )

        ci_data = [
            ITSMServiceCIData(
                id=c.id,
                name=c.name,
                ci_type=c.ci_type,
                environment=c.environment,
                status=c.status,
                attributes=c.attributes or {},
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c in cis
        ]

        # Fetch recent incidents
        recent_incidents_db = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.service_id == service.id,
                ITSMTicket.ticket_type == "INCIDENT",
            )
            .order_by(ITSMTicket.created_at.desc())
            .limit(10)
            .all()
        )

        recent_incidents = [
            ITSMServiceTicketSummary(
                id=t.id,
                ticket_number=t.ticket_number,
                title=t.title,
                priority=t.priority,
                status=t.status,
                ticket_type=t.ticket_type,
                created_at=t.created_at,
            )
            for t in recent_incidents_db
        ]

        # Fetch recent requests
        recent_requests_db = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.tenant_id == tenant_id,
                ITSMTicket.service_id == service.id,
                ITSMTicket.ticket_type == "SERVICE_REQUEST",
            )
            .order_by(ITSMTicket.created_at.desc())
            .limit(10)
            .all()
        )

        recent_requests = [
            ITSMServiceTicketSummary(
                id=t.id,
                ticket_number=t.ticket_number,
                title=t.title,
                priority=t.priority,
                status=t.status,
                ticket_type=t.ticket_type,
                created_at=t.created_at,
            )
            for t in recent_requests_db
        ]

        owner_email = service.owner.email if service.owner else None

        return ITSMServiceDetailResponse(
            id=service.id,
            name=service.name,
            slug=service.slug,
            description=service.description,
            tier=service.tier,
            status=service.status,
            escalation_team=service.escalation_team,
            owner_user_id=service.owner_user_id,
            owner_email=owner_email,
            created_at=service.created_at,
            updated_at=service.updated_at,
            configuration_items=ci_data,
            recent_incidents=recent_incidents,
            recent_requests=recent_requests,
        )
