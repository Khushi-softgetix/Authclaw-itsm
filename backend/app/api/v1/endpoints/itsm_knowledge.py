"""API Router for ITSM Knowledge Base and Knowledge Governance."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.db.models import ITSMKnowledgeArticle, ITSMKnowledgeArticleVersion, User
from app.schemas.itsm_knowledge import (
    CreateKnowledgeArticleRequest,
    ITSMKnowledgeArticleDetailResponse,
    ITSMKnowledgeArticleSummaryResponse,
    ITSMKnowledgeArticleVersionSummary,
    RequesterKBArticleResponse,
    UpdateKnowledgeArticleRequest,
)
from app.services.itsm_knowledge_service import KnowledgeService

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_ITSM_ROLES = {
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "SERVICE_LEAD",
    "REQUESTER",
    "ADMIN",
    "OWNER",
    "PROCESS_CHANGE_MANAGER",
    "CATALOG_MANAGER",
}

GOVERNANCE_ALLOWED_ROLES = {
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
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
            detail="Access forbidden: role not permitted for knowledge base",
        )
    return role


DEFAULT_SEED_KB_ARTICLES = [
    {
        "title": "Corporate VPN Connection & WireGuard Profile Guide",
        "slug": "vpn-wireguard-guide",
        "category": "Networking",
        "read_time": "3 min read",
        "summary": "Step-by-step instructions for downloading WireGuard client, importing corporate .conf profile, and verifying encrypted tunnel connection.",
        "content": "To connect to the corporate WireGuard VPN tunnel:\n1. Download the WireGuard client for macOS or Windows.\n2. Request a new VPN profile from the Service Catalog.\n3. Import the .conf profile into WireGuard and click Activate.",
        "steps": [
            "Download WireGuard client for your OS",
            "Generate or download your user .conf WireGuard profile",
            "Import .conf profile into WireGuard client",
            "Click Activate and verify status turns Green",
        ],
    },
    {
        "title": "MFA Authenticator Reset & YubiKey Registration",
        "slug": "mfa-reset-yubikey-guide",
        "category": "Authentication",
        "read_time": "2 min read",
        "summary": "How to clear locked TOTP authenticator tokens, re-register Google Authenticator / 1Password, or bind a hardware YubiKey.",
        "content": "If you lost your phone or MFA token is locked:\n1. Open a Security Token & MFA Reset ticket.\n2. Service Desk will issue a temporary 1-time bypass code.\n3. Log in and scan the new QR code under Security Settings.",
        "steps": [
            "Submit an MFA Reset request via the Service Catalog",
            "Retrieve 1-time emergency bypass passcode from IT",
            "Navigate to Profile > Security Settings in AuthClaw",
            "Scan new TOTP QR code with Google Authenticator or 1Password",
        ],
    },
    {
        "title": "AWS SSO Developer IAM Role Access Protocol",
        "slug": "aws-sso-iam-role-protocol",
        "category": "Security",
        "read_time": "4 min read",
        "summary": "Guidelines for requesting temporary sandbox AWS access, assuming IAM roles via AWS CLI, and security session timeouts.",
        "content": "AWS IAM sandbox access allows developers to deploy test cloud resources.\nUse `aws sso login --profile sandbox` to authenticate.",
        "steps": [
            "Request AWS Account & IAM Sandbox Access from Service Catalog",
            "Configure AWS CLI with AuthClaw SSO endpoint",
            "Run `aws sso login --profile sandbox`",
            "Verify session validity with `aws sts get-caller-identity`",
        ],
    },
    {
        "title": "Wi-Fi WPA3 Enterprise Credential Setup",
        "slug": "wifi-wpa3-enterprise-setup",
        "category": "Networking",
        "read_time": "2 min read",
        "summary": "Configuring corporate 802.1X EAP-TLS WiFi certificates on macOS, Windows 11, and Android devices.",
        "content": "Connect to AuthClaw-Secure Wi-Fi using your primary corporate email credentials.",
        "steps": [
            "Select 'AuthClaw-Secure' Wi-Fi network",
            "Choose WPA3-Enterprise / EAP-PEAP (MSCHAPv2)",
            "Enter corporate email and password",
            "Trust root radius certificate when prompted",
        ],
    },
]


def _seed_default_kb_if_empty(db: Session, tenant_id: UUID, author_id: UUID) -> None:
    count = db.query(ITSMKnowledgeArticle).filter(ITSMKnowledgeArticle.tenant_id == tenant_id).count()
    if count > 0:
        return

    now = datetime.now(timezone.utc)
    for seed in DEFAULT_SEED_KB_ARTICLES:
        article = ITSMKnowledgeArticle(
            id=uuid4(),
            tenant_id=tenant_id,
            title=seed["title"],
            slug=seed["slug"],
            category=seed["category"],
            status="PUBLISHED",
            summary=seed["summary"],
            view_count=42,
            helpful_count=12,
            author_id=author_id,
            published_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(article)
        db.flush()

        version = ITSMKnowledgeArticleVersion(
            id=uuid4(),
            tenant_id=tenant_id,
            article_id=article.id,
            version_number=1,
            title=seed["title"],
            summary=seed["summary"],
            content_markdown=f"{seed['content']}\n\n### Resolution Steps\n" + "\n".join([f"{i+1}. {step}" for i, step in enumerate(seed["steps"])]),
            keywords_json=json.dumps([seed["category"], "Guide", "Troubleshooting"]),
            created_by_user_id=author_id,
            created_at=now,
        )
        db.add(version)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Failed to auto-seed KB articles: %s", e)


def _format_views_label(views: int) -> str:
    if views >= 1000:
        val = views / 1000.0
        return f"{val:.1f}k views" if val % 1 != 0 else f"{int(val)}k views"
    return f"{views} views"


def _verify_governance_user(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    """Verify that the user possesses Problem and Change Manager or Admin role for governance actions."""
    role = _verify_itsm_user(db, tenant_id, user_id)
    if role not in GOVERNANCE_ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Knowledge Governance operations require Problem and Change Manager permissions",
        )
    return role


@router.get(
    "",
    summary="List and search knowledge articles",
    description="Retrieve published knowledge articles within tenant context with optional keyword search, category, status, and service filtering.",
)
def list_knowledge_articles(
    request: Request,
    search: Optional[str] = Query(default=None, description="Search term across title, summary, and content"),
    category: Optional[str] = Query(default=None, description="Category filter (e.g. Networking, Authentication)"),
    status_filter: Optional[str] = Query(default=None, alias="status", description="Publication status (e.g. ALL, DRAFT, PUBLISHED, ARCHIVED)"),
    service_id: Optional[UUID] = Query(default=None, description="Filter articles by related service"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id)) if getattr(request.state, "user_id", None) else None
    t_id = UUID(tenant_id)
    if actor_id:
        _verify_itsm_user(db, t_id, actor_id)

    return KnowledgeService.list_articles(
        db=db,
        tenant_id=t_id,
        search=search,
        category=category,
        status=status_filter,
        service_id=service_id,
        offset=offset,
        limit=limit,
    )


@router.post(
    "",
    response_model=ITSMKnowledgeArticleDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create knowledge article",
    description="Create a new knowledge article in DRAFT status with initial Version 1.",
)
def create_knowledge_article(
    payload: CreateKnowledgeArticleRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_governance_user(db, t_id, actor_id)

    return KnowledgeService.create_article(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        data=payload,
    )


@router.get(
    "/{article_id}",
    summary="Get knowledge article detail",
    description="Retrieve full markdown content, version history, and metadata for a specific knowledge article.",
)
def get_knowledge_article(
    article_id: str,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id)) if getattr(request.state, "user_id", None) else None
    t_id = UUID(tenant_id)
    if actor_id:
        _verify_itsm_user(db, t_id, actor_id)

    article = KnowledgeService.get_article(
        db=db,
        tenant_id=t_id,
        article_id_or_slug=article_id,
    )
    if not article:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Knowledge article not found",
        )
    return article


@router.post(
    "/{article_id}/helpful",
    status_code=status.HTTP_200_OK,
    summary="Record helpful feedback on an article",
)
def record_article_helpful(
    article_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    article = (
        db.query(ITSMKnowledgeArticle)
        .filter(ITSMKnowledgeArticle.id == article_id, ITSMKnowledgeArticle.tenant_id == tenant_id)
        .first()
    )
    if not article:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")

    article.helpful_count += 1
    db.commit()
    return {"status": "success", "helpful_count": article.helpful_count}


@router.patch(
    "/{article_id}",
    response_model=ITSMKnowledgeArticleDetailResponse,
    summary="Update knowledge article (create new version)",
    description="Update article content or metadata. Adds a new immutable version revision in itsm_knowledge_article_versions.",
)
def update_knowledge_article(
    article_id: UUID,
    payload: UpdateKnowledgeArticleRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_governance_user(db, t_id, actor_id)

    return KnowledgeService.update_article(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        article_id=article_id,
        data=payload,
    )


@router.get(
    "/{article_id}/versions",
    response_model=List[ITSMKnowledgeArticleVersionSummary],
    summary="List article version history",
    description="Retrieve all historical immutable revisions of a knowledge article.",
)
def get_article_versions(
    article_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_itsm_user(db, t_id, actor_id)

    return KnowledgeService.get_article_versions(
        db=db,
        tenant_id=t_id,
        article_id=article_id,
    )


@router.post(
    "/{article_id}/publish",
    response_model=ITSMKnowledgeArticleDetailResponse,
    summary="Publish knowledge article",
    description="Approve and publish article, updating current_published_version to latest revision.",
)
def publish_knowledge_article(
    article_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_governance_user(db, t_id, actor_id)

    return KnowledgeService.publish_article(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        article_id=article_id,
    )


@router.post(
    "/{article_id}/archive",
    response_model=ITSMKnowledgeArticleDetailResponse,
    summary="Archive / Retire knowledge article",
    description="Retire outdated article without deleting historical records.",
)
def archive_knowledge_article(
    article_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_governance_user(db, t_id, actor_id)

    return KnowledgeService.archive_article(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        article_id=article_id,
    )


@router.post(
    "/{article_id}/retire",
    response_model=ITSMKnowledgeArticleDetailResponse,
    summary="Alias for archive knowledge article",
    description="Retire outdated article without deleting historical records.",
)
def retire_knowledge_article(
    article_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_governance_user(db, t_id, actor_id)

    return KnowledgeService.archive_article(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        article_id=article_id,
    )


@router.post(
    "/{article_id}/draft",
    response_model=ITSMKnowledgeArticleDetailResponse,
    summary="Return knowledge article to DRAFT status",
    description="Transition an article back to DRAFT for maintenance or revision.",
)
def draft_knowledge_article(
    article_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_governance_user(db, t_id, actor_id)

    return KnowledgeService.draft_article(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        article_id=article_id,
    )
