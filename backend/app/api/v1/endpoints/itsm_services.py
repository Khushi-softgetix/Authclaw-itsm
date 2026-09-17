"""API Router for ITSM Services & Service Catalog for Requesters."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.db.models import ITSMService, ITSMServiceCatalogItem
from app.schemas.itsm_services import RequesterServiceCatalogItemResponse

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_SEED_SERVICES = [
    {
        "service_name": "Workplace Technology",
        "service_slug": "workplace-technology",
        "category_label": "Hardware & Equipment",
        "items": [
            {
                "name": "New Developer Laptop / Workstation",
                "slug": "laptop-req",
                "description": "Request a standard developer laptop (MacBook Pro or ThinkPad) with pre-installed enterprise tools.",
                "estimated_delivery_hours": 48,
                "approval_required": True,
                "fulfillment_group": "IT Logistics",
            },
            {
                "name": "External Monitor & Peripheral Kit",
                "slug": "monitor-req",
                "description": "4K external monitor, ergonomic mechanical keyboard, mouse, and USB-C docking station.",
                "estimated_delivery_hours": 24,
                "approval_required": False,
                "fulfillment_group": "IT Hardware Triage",
            },
        ],
    },
    {
        "service_name": "Access & Identity",
        "service_slug": "access-identity",
        "category_label": "Software Access & SSO",
        "items": [
            {
                "name": "AWS Account & IAM Sandbox Access",
                "slug": "aws-sso",
                "description": "Temporary or permanent developer sandbox IAM role in AWS cloud infrastructure.",
                "estimated_delivery_hours": 2,
                "approval_required": False,
                "fulfillment_group": "Automated Cloud Provisioner",
            },
            {
                "name": "GitHub Enterprise Organization Seat",
                "slug": "github-access",
                "description": "Invite seat to AuthClaw GitHub repositories with team permissions.",
                "estimated_delivery_hours": 1,
                "approval_required": False,
                "fulfillment_group": "Automated Identity Sync",
            },
        ],
    },
    {
        "service_name": "IT Security",
        "service_slug": "it-security",
        "category_label": "Security & MFA Reset",
        "items": [
            {
                "name": "Security Token & MFA Reset",
                "slug": "mfa-reset",
                "description": "Reset lost authenticator app registration or locked hardware security token (YubiKey).",
                "estimated_delivery_hours": 1,
                "approval_required": False,
                "fulfillment_group": "SecOps Triage",
            },
            {
                "name": "Corporate VPN & WireGuard Profile",
                "slug": "vpn-cert",
                "description": "Generate or update encrypted WireGuard VPN client certificate for remote access.",
                "estimated_delivery_hours": 1,
                "approval_required": False,
                "fulfillment_group": "Automated PKI",
            },
        ],
    },
    {
        "service_name": "General IT Support",
        "service_slug": "general-it-support",
        "category_label": "General IT Assistance",
        "items": [
            {
                "name": "Office WiFi & Guest Network Passcode",
                "slug": "wifi-guest",
                "description": "High-speed office WPA3-Enterprise credential provision or temporary visitor codes.",
                "estimated_delivery_hours": 0,
                "approval_required": False,
                "fulfillment_group": "Network Operations",
            },
            {
                "name": "AV & Conference Room Setup",
                "slug": "zoom-room",
                "description": "Technical setup support for all-hands presentations or video conference equipment.",
                "estimated_delivery_hours": 2,
                "approval_required": False,
                "fulfillment_group": "AV Field Support",
            },
        ],
    },
]


def _seed_default_catalog_if_empty(db: Session, tenant_id: UUID) -> None:
    """Idempotently seed standard IT Service Catalog items for a tenant if none exist."""
    existing_count = (
        db.query(ITSMServiceCatalogItem)
        .filter(ITSMServiceCatalogItem.tenant_id == tenant_id)
        .count()
    )
    if existing_count > 0:
        return

    now = datetime.now(timezone.utc)
    for group in DEFAULT_SEED_SERVICES:
        # Check or create parent service
        service = (
            db.query(ITSMService)
            .filter(ITSMService.tenant_id == tenant_id, ITSMService.slug == group["service_slug"])
            .first()
        )
        if not service:
            service = ITSMService(
                id=uuid4(),
                tenant_id=tenant_id,
                name=group["service_name"],
                slug=group["service_slug"],
                description=f"Standard IT Service for {group['category_label']}",
                tier="TIER_2",
                status="OPERATIONAL",
                created_at=now,
                updated_at=now,
            )
            db.add(service)
            db.flush()

        for item_def in group["items"]:
            catalog_item = ITSMServiceCatalogItem(
                id=uuid4(),
                tenant_id=tenant_id,
                service_id=service.id,
                name=item_def["name"],
                slug=f"{item_def['slug']}-{str(tenant_id)[:6]}",
                description=item_def["description"],
                version=1,
                intake_schema={"type": "object", "properties": {}},
                approval_required=item_def["approval_required"],
                fulfillment_group=item_def["fulfillment_group"],
                estimated_delivery_hours=item_def["estimated_delivery_hours"],
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add(catalog_item)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Auto-seed catalog items failed: %s", e)


def _derive_category_label(service_name: str, item_name: str) -> str:
    combined = f"{service_name} {item_name}".lower()
    if "hardware" in combined or "laptop" in combined or "monitor" in combined:
        return "Hardware & Equipment"
    if "access" in combined or "sso" in combined or "aws" in combined or "github" in combined:
        return "Software Access & SSO"
    if "security" in combined or "mfa" in combined or "vpn" in combined:
        return "Security & MFA Reset"
    return "General IT Assistance"


def _derive_fulfillment_type(approval_required: bool, fulfillment_group: str | None) -> str:
    if approval_required:
        return "Manager Approval"
    if fulfillment_group and "Automated" in fulfillment_group:
        return "Automated"
    return "IT Triage"


def _derive_time_label(hours: int) -> str:
    if hours == 0:
        return "Immediate"
    if hours == 1:
        return "1 hr"
    if hours < 24:
        return f"{hours} hrs"
    days = hours // 24
    rem = hours % 24
    if rem == 0:
        return f"{days * 24} hrs" if days == 1 else f"{hours} hrs ({days} days)"
    return f"{hours} hrs"


@router.get(
    "",
    response_model=list[RequesterServiceCatalogItemResponse],
    summary="List active service catalog items for requesters",
    description="Retrieve database-backed service catalog items for the authenticated tenant.",
)
def list_requester_service_catalog(
    request: Request,
    category: Optional[str] = Query(default=None, description="Filter by category label"),
    search: Optional[str] = Query(default=None, description="Search in name or description"),
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)

    # Ensure tenant has active catalog items seeded
    _seed_default_catalog_if_empty(db, tenant_id)

    query = (
        db.query(ITSMServiceCatalogItem, ITSMService.name.label("service_name"))
        .join(
            ITSMService,
            (ITSMServiceCatalogItem.service_id == ITSMService.id)
            & (ITSMService.tenant_id == tenant_id),
        )
        .filter(
            ITSMServiceCatalogItem.tenant_id == tenant_id,
            ITSMServiceCatalogItem.is_active == True,
        )
    )

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            ITSMServiceCatalogItem.name.ilike(term)
            | ITSMServiceCatalogItem.description.ilike(term)
            | ITSMService.name.ilike(term)
        )

    results = query.order_by(ITSMServiceCatalogItem.created_at.asc()).all()

    items: list[RequesterServiceCatalogItemResponse] = []
    for item, service_name in results:
        cat_label = _derive_category_label(service_name, item.name)
        if category and category.strip().lower() != "all":
            if cat_label.lower() != category.strip().lower():
                continue

        ful_type = _derive_fulfillment_type(item.approval_required, item.fulfillment_group)
        time_label = _derive_time_label(item.estimated_delivery_hours)

        items.append(
            RequesterServiceCatalogItemResponse(
                id=item.id,
                tenant_id=item.tenant_id,
                service_id=item.service_id,
                service_name=service_name,
                category_label=cat_label,
                name=item.name,
                slug=item.slug,
                description=item.description,
                estimated_delivery_hours=item.estimated_delivery_hours,
                estimated_time_label=time_label,
                approval_required=item.approval_required,
                fulfillment_type=ful_type,
                fulfillment_group=item.fulfillment_group,
                is_active=item.is_active,
                created_at=item.created_at,
                updated_at=item.updated_at,
            )
        )

    return items
