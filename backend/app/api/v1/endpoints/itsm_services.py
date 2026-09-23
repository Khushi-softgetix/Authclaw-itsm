"""API router for ITSM Services & Service Catalog."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.db.models import ITSMService, ITSMServiceCatalogItem
from app.schemas.itsm_services import (
    ITSMServiceDetailResponse,
    ITSMServiceSummaryResponse,
    RequesterServiceCatalogItemResponse,
)
from app.services.itsm_service_service import ITSMServiceManager

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_ITSM_ROLES = {
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "SERVICE_LEAD",
    "PROCESS_CHANGE_MANAGER",
    "REQUESTER",
    "AUDITOR",
    "ADMIN",
    "OWNER",
}


def _verify_itsm_user(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    """Verify tenant-scoped ITSM entitlement and return effective ITSM role."""
    access_row = db.execute(
        text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
        {"tenant_id": str(tenant_id), "user_id": str(user_id)},
    ).first()

    if access_row:
        if not access_row.has_itsm_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="ITSM access disabled for this user",
            )
        role = str(access_row.itsm_role).upper() if access_row.itsm_role else "REQUESTER"
    else:
        role = "REQUESTER"

    if role not in ALLOWED_ITSM_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized role for ITSM services access",
        )
    return role

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
    count = db.query(ITSMServiceCatalogItem).filter(ITSMServiceCatalogItem.tenant_id == tenant_id).count()
    if count > 0:
        return

    now = datetime.now(timezone.utc)
    service_seeds = [
        {
            "name": "Identity & Access Management",
            "slug": "iam-service",
            "description": "Enterprise authentication, SSO, and user provisioning services.",
            "tier": "tier1",
            "items": [
                {
                    "name": "New Employee Account Provisioning",
                    "slug": "new-employee-account-provisioning",
                    "description": "Provision G-Suite, Slack, GitHub, and AuthClaw IAM access for new hires.",
                    "hours": 24,
                    "approval": True,
                    "group": "IAM Team",
                },
                {
                    "name": "Password & MFA Reset Request",
                    "slug": "password-mfa-reset-request",
                    "description": "Reset corporate credentials or re-register MFA authenticator tokens.",
                    "hours": 1,
                    "approval": False,
                    "group": "Service Desk",
                },
            ],
        },
        {
            "name": "Network & Remote Connectivity",
            "slug": "network-connectivity",
            "description": "Office Wi-Fi, VPN gateway, and cloud network infrastructure.",
            "tier": "tier1",
            "items": [
                {
                    "name": "VPN Gateway & Access Troubleshooting",
                    "slug": "vpn-access-troubleshooting",
                    "description": "Request dedicated VPN profile or troubleshoot gateway timeout errors.",
                    "hours": 4,
                    "approval": False,
                    "group": "Network Operations",
                },
                {
                    "name": "Static IP & Firewall Rule Change",
                    "slug": "static-ip-firewall-rule-change",
                    "description": "Request whitelist entry or static IP assignment for developer environments.",
                    "hours": 48,
                    "approval": True,
                    "group": "Security Operations",
                },
            ],
        },
        {
            "name": "Workstation & Hardware Support",
            "slug": "hardware-workstation-support",
            "description": "Laptop procurement, peripheral replacement, and physical repair.",
            "tier": "tier2",
            "items": [
                {
                    "name": "New Developer Laptop Procurement",
                    "slug": "new-developer-laptop-procurement",
                    "description": "Request a standard M3 MacBook Pro or Dell Precision workstation.",
                    "hours": 72,
                    "approval": True,
                    "group": "IT Logistics",
                },
                {
                    "name": "Monitor & Peripheral Replacement",
                    "slug": "monitor-peripheral-replacement",
                    "description": "Request replacement keyboard, mouse, dock, or external 4K monitor.",
                    "hours": 24,
                    "approval": False,
                    "group": "IT Helpdesk",
                },
            ],
        },
        {
            "name": "Cloud & Infrastructure Access",
            "slug": "cloud-infrastructure-access",
            "description": "AWS, GCP, Kubernetes cluster, and database access requests.",
            "tier": "tier1",
            "items": [
                {
                    "name": "AWS Sandbox Account Request",
                    "slug": "aws-sandbox-account-request",
                    "description": "Provision an isolated AWS sandbox environment with spending guardrails.",
                    "hours": 12,
                    "approval": True,
                    "group": "Cloud Platform Team",
                },
                {
                    "name": "Database Read Replica Access",
                    "slug": "database-read-replica-access",
                    "description": "Request read-only access to staging or production analytics database.",
                    "hours": 24,
                    "approval": True,
                    "group": "Database Reliability Team",
                },
            ],
        },
    ]

    for s_seed in service_seeds:
        service = db.query(ITSMService).filter(
            ITSMService.tenant_id == tenant_id,
            ITSMService.slug == s_seed["slug"],
        ).first()

        if not service:
            service = ITSMService(
                id=uuid4(),
                tenant_id=tenant_id,
                name=s_seed["name"],
                slug=s_seed["slug"],
                description=s_seed["description"],
                tier=s_seed["tier"],
                status="OPERATIONAL",
                created_at=now,
                updated_at=now,
            )
            db.add(service)
            db.flush()

        for item_seed in s_seed["items"]:
            item = ITSMServiceCatalogItem(
                id=uuid4(),
                tenant_id=tenant_id,
                service_id=service.id,
                name=item_seed["name"],
                slug=item_seed["slug"],
                description=item_seed["description"],
                estimated_delivery_hours=item_seed["hours"],
                approval_required=item_seed["approval"],
                fulfillment_group=item_seed["group"],
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add(item)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Failed to auto-seed service catalog: %s", e)


def _derive_category_label(service_name: str, item_name: str) -> str:
    combined = f"{service_name} {item_name}".lower()
    if "hardware" in combined or "laptop" in combined or "monitor" in combined:
        return "Hardware & Devices"
    if "software" in combined or "license" in combined or "saas" in combined:
        return "Software & SaaS"
    if "access" in combined or "iam" in combined or "account" in combined or "password" in combined:
        return "Access & Accounts"
    if "vpn" in combined or "network" in combined or "wi-fi" in combined or "firewall" in combined:
        return "Network & Connectivity"
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


@router.get(
    "/{service_id}",
    response_model=ITSMServiceDetailResponse,
    summary="Get ITSM service detail",
    description="Retrieve complete service detail including linked configuration items and recent ticket context.",
)
def get_service_detail(
    service_id: str,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    user_id_val = getattr(request.state, "user_id", None)
    if not user_id_val:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    tenant_id = UUID(tenant_id_str)
    user_id = UUID(str(user_id_val))
    _verify_itsm_user(db, tenant_id, user_id)

    return ITSMServiceManager.get_service_detail(
        db=db,
        tenant_id=tenant_id,
        service_id_or_slug=service_id,
    )
