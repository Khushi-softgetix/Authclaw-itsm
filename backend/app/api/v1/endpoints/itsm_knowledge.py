"""API Router for ITSM Knowledge Base for Requesters."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.db.models import ITSMKnowledgeArticle, ITSMKnowledgeArticleVersion, User
from app.schemas.itsm_knowledge import RequesterKBArticleResponse

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_SEED_ARTICLES = [
    {
        "title": "Connecting to Corporate WireGuard VPN",
        "slug": "connecting-to-corporate-wireguard-vpn",
        "category": "Networking",
        "read_time": "3 min read",
        "views": 1240,
        "summary": "Step-by-step setup for WireGuard VPN client across macOS, Windows, and Linux workstations.",
        "content": "AuthClaw corporate network access requires an encrypted WireGuard VPN tunnel for remote connectivity. Ensure you have your tenant client configuration file before starting.",
        "steps": [
            "Download and install the official WireGuard client from wireguard.com.",
            "Open WireGuard and select 'Add Tunnel' -> 'Import Tunnel from File'.",
            "Select your '.conf' certificate downloaded from the Service Catalog.",
            "Toggle the tunnel active and verify connection status via ping 10.0.0.1.",
        ],
    },
    {
        "title": "Requesting Temporary Cloud Sandbox IAM Roles",
        "slug": "requesting-temporary-cloud-sandbox-iam-roles",
        "category": "DevOps & Cloud",
        "read_time": "4 min read",
        "views": 890,
        "summary": "How to request time-bound AWS IAM credentials with pre-configured developer policies.",
        "content": "Developer cloud sandboxes provide isolated AWS environments for testing AI models and microservices. Access expires automatically after 8 hours unless extended.",
        "steps": [
            "Navigate to Service Catalog -> AWS Account & IAM Sandbox Access.",
            "Select your required cloud region and sandbox project code.",
            "Submit request for manager approval or automated entitlement check.",
            "Retrieve your short-lived STS credentials from the active session tab.",
        ],
    },
    {
        "title": "Troubleshooting Okta Single Sign-On (SSO) Sessions",
        "slug": "troubleshooting-okta-sso-sessions",
        "category": "Authentication",
        "read_time": "2 min read",
        "views": 2410,
        "summary": "Resolving session cookie timeouts, MFA loop prompts, and browser cache conflicts.",
        "content": "If you experience infinite redirect loops during Okta authentication, follow these quick remediation steps before submitting an IT ticket.",
        "steps": [
            "Clear browser cookies and cache for *.authclaw.com and your identity provider.",
            "Disable third-party tracking blocker extensions temporarily.",
            "Ensure your computer clock is synchronized with UTC network time.",
            "Attempt logging in using a private or incognito window.",
        ],
    },
    {
        "title": "Setting Up Hardware Security Keys (YubiKey)",
        "slug": "setting-up-hardware-security-keys-yubikey",
        "category": "Security",
        "read_time": "5 min read",
        "views": 640,
        "summary": "Registering FIDO2 / WebAuthn YubiKey devices for passwordless MFA.",
        "content": "Hardware security keys protect your account against phishing and credential theft by establishing cryptographic binding during sign-in.",
        "steps": [
            "Plug your YubiKey into a USB-A / USB-C port on your workstation.",
            "Go to Account Settings -> Security & MFA -> Add Hardware Key.",
            "Touch the gold contact point on your key when prompted by the browser.",
            "Save your one-time backup recovery codes in a secure secret manager.",
        ],
    },
    {
        "title": "Configuring Workstation WiFi & WPA3 Enterprise",
        "slug": "configuring-workstation-wifi-wpa3-enterprise",
        "category": "Networking",
        "read_time": "2 min read",
        "views": 520,
        "summary": "Connecting your laptop to the secure office corporate WiFi network.",
        "content": "AuthClaw office wireless networks utilize 802.1X EAP-TLS certificate authentication for high-speed local connectivity.",
        "steps": [
            "Select 'AuthClaw-Corporate' from your operating system WiFi menu.",
            "Enter your SSO corporate username and current account password.",
            "Accept the network RADIUS root certificate when prompted.",
        ],
    },
]


def _seed_default_kb_if_empty(db: Session, tenant_id: UUID, actor_id: UUID) -> None:
    """Idempotently seed standard published knowledge base articles for a tenant if none exist."""
    existing_count = (
        db.query(ITSMKnowledgeArticle)
        .filter(ITSMKnowledgeArticle.tenant_id == tenant_id)
        .count()
    )
    if existing_count > 0:
        return

    author = db.query(User).filter(User.id == actor_id, User.tenant_id == tenant_id).first()
    if not author:
        author = db.query(User).filter(User.tenant_id == tenant_id).first()
    if not author:
        logger.warning("No user found in tenant %s for seeding KB articles", tenant_id)
        return

    now = datetime.now(timezone.utc)
    for seed in DEFAULT_SEED_ARTICLES:
        art_id = uuid4()
        art_slug = f"{seed['slug']}-{str(tenant_id)[:6]}"
        article = ITSMKnowledgeArticle(
            id=art_id,
            tenant_id=tenant_id,
            title=seed["title"],
            slug=art_slug,
            category=seed["category"],
            status="PUBLISHED",
            current_published_version=1,
            view_count=seed["views"],
            helpful_count=0,
            author_id=author.id,
            published_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(article)
        db.flush()

        payload_json = json.dumps({
            "summary": seed["summary"],
            "content": seed["content"],
            "read_time": seed["read_time"],
            "steps": seed["steps"],
        })

        version = ITSMKnowledgeArticleVersion(
            id=uuid4(),
            tenant_id=tenant_id,
            article_id=art_id,
            version_number=1,
            title=seed["title"],
            content_markdown=payload_json,
            summary=seed["summary"],
            keywords=[seed["category"].lower(), "help", "guide"],
            created_by=author.id,
            created_at=now,
        )
        db.add(version)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Failed to auto-seed knowledge base: %s", e)


def _format_views_label(views: int) -> str:
    if views >= 1000:
        val = views / 1000.0
        return f"{val:.1f}k views" if val % 1 != 0 else f"{int(val)}k views"
    return f"{views} views"


@router.get(
    "",
    response_model=list[RequesterKBArticleResponse],
    summary="List published knowledge articles for requesters",
    description="Retrieve published, database-backed knowledge base articles for the authenticated tenant.",
)
def list_requester_knowledge_articles(
    request: Request,
    category: Optional[str] = Query(default=None, description="Filter by category"),
    search: Optional[str] = Query(default=None, description="Search in title, summary, or content"),
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    tenant_id = UUID(tenant_id_str)

    _seed_default_kb_if_empty(db, tenant_id, actor_id)

    query = (
        db.query(ITSMKnowledgeArticle, ITSMKnowledgeArticleVersion)
        .join(
            ITSMKnowledgeArticleVersion,
            (ITSMKnowledgeArticleVersion.article_id == ITSMKnowledgeArticle.id)
            & (ITSMKnowledgeArticleVersion.tenant_id == tenant_id)
            & (ITSMKnowledgeArticleVersion.version_number == ITSMKnowledgeArticle.current_published_version),
        )
        .filter(
            ITSMKnowledgeArticle.tenant_id == tenant_id,
            ITSMKnowledgeArticle.status == "PUBLISHED",
        )
    )

    if category and category.strip() and category.strip().lower() != "all":
        query = query.filter(ITSMKnowledgeArticle.category.ilike(category.strip()))

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            ITSMKnowledgeArticle.title.ilike(term)
            | ITSMKnowledgeArticle.category.ilike(term)
            | ITSMKnowledgeArticleVersion.summary.ilike(term)
            | ITSMKnowledgeArticleVersion.content_markdown.ilike(term)
        )

    results = query.order_by(ITSMKnowledgeArticle.view_count.desc()).all()

    items: list[RequesterKBArticleResponse] = []
    for article, version in results:
        # Extract payload from version content_markdown
        summary_text = version.summary or article.title
        content_text = ""
        read_time_text = "3 min read"
        steps_list: list[str] = []

        if version.content_markdown:
            try:
                parsed = json.loads(version.content_markdown)
                if isinstance(parsed, dict):
                    summary_text = parsed.get("summary", summary_text)
                    content_text = parsed.get("content", "")
                    read_time_text = parsed.get("read_time", "3 min read")
                    steps_list = parsed.get("steps", [])
                else:
                    content_text = str(version.content_markdown)
            except Exception:
                content_text = str(version.content_markdown)

        if not steps_list and content_text:
            # Fallback steps parser if stored as plain text
            lines = [l.strip() for l in content_text.split("\n") if l.strip()]
            steps_list = [l for l in lines if l.startswith("1.") or l.startswith("2.") or l.startswith("3.") or l.startswith("4.")]

        items.append(
            RequesterKBArticleResponse(
                id=article.id,
                tenant_id=article.tenant_id,
                title=article.title,
                slug=article.slug,
                category=article.category,
                status=article.status,
                view_count=article.view_count,
                helpful_count=article.helpful_count,
                read_time=read_time_text,
                views_label=_format_views_label(article.view_count),
                summary=summary_text,
                content=content_text,
                steps=steps_list,
                published_at=article.published_at,
                created_at=article.created_at,
                updated_at=article.updated_at,
            )
        )

    return items


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
