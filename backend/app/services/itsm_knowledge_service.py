"""Service layer for ITSM Knowledge Management and Knowledge Governance."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload

from app.db.models import ITSMKnowledgeArticle, ITSMKnowledgeArticleVersion
from app.schemas.itsm_knowledge import (
    CreateKnowledgeArticleRequest,
    ITSMKnowledgeArticleDetailResponse,
    ITSMKnowledgeArticleSummaryResponse,
    ITSMKnowledgeArticleVersionSummary,
    UpdateKnowledgeArticleRequest,
)
from app.services.audit_store import append_audit_event

logger = logging.getLogger(__name__)


def generate_unique_slug(db: Session, tenant_id: UUID, title: str, exclude_id: Optional[UUID] = None) -> str:
    """Generate a clean, collision-free slug within the tenant's namespace."""
    base = re.sub(r"[^\w\s-]", "", title.lower().strip())
    base = re.sub(r"[\s_-]+", "-", base).strip("-")[:180]
    if not base:
        base = f"article-{uuid4().hex[:8]}"

    slug = base
    counter = 1
    while True:
        query = db.query(ITSMKnowledgeArticle.id).filter(
            ITSMKnowledgeArticle.tenant_id == tenant_id,
            ITSMKnowledgeArticle.slug == slug,
        )
        if exclude_id:
            query = query.filter(ITSMKnowledgeArticle.id != exclude_id)
        if not query.first():
            return slug
        slug = f"{base}-{counter}"
        counter += 1


class KnowledgeService:
    """Service methods for querying, creating, updating, and governing knowledge articles."""

    @staticmethod
    def list_articles(
        db: Session,
        tenant_id: UUID,
        search: Optional[str] = None,
        category: Optional[str] = None,
        status: Optional[str] = None,
        service_id: Optional[UUID] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> List[ITSMKnowledgeArticleSummaryResponse]:
        """List and search knowledge articles within tenant boundary."""
        query = (
            db.query(ITSMKnowledgeArticle)
            .options(joinedload(ITSMKnowledgeArticle.author))
            .filter(ITSMKnowledgeArticle.tenant_id == tenant_id)
        )

        if status:
            if status.strip().upper() != "ALL":
                query = query.filter(ITSMKnowledgeArticle.status == status.strip().upper())
        else:
            # Default to published articles for standard consumers
            query = query.filter(ITSMKnowledgeArticle.status == "PUBLISHED")

        if service_id:
            query = query.filter(ITSMKnowledgeArticle.service_id == service_id)

        if category and category.strip().upper() != "ALL":
            query = query.filter(
                func.upper(ITSMKnowledgeArticle.category) == category.strip().upper()
            )

        if search and search.strip():
            term = f"%{search.strip()}%"
            version_match_subquery = (
                db.query(ITSMKnowledgeArticleVersion.article_id)
                .filter(
                    ITSMKnowledgeArticleVersion.tenant_id == tenant_id,
                    or_(
                        ITSMKnowledgeArticleVersion.title.ilike(term),
                        ITSMKnowledgeArticleVersion.summary.ilike(term),
                        ITSMKnowledgeArticleVersion.content_markdown.ilike(term),
                    ),
                )
                .subquery()
            )

            query = query.filter(
                or_(
                    ITSMKnowledgeArticle.title.ilike(term),
                    ITSMKnowledgeArticle.slug.ilike(term),
                    ITSMKnowledgeArticle.category.ilike(term),
                    ITSMKnowledgeArticle.id.in_(version_match_subquery),
                )
            )

        articles = (
            query.order_by(ITSMKnowledgeArticle.updated_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        if not articles:
            return []

        article_ids = [a.id for a in articles]
        versions = (
            db.query(ITSMKnowledgeArticleVersion)
            .filter(
                ITSMKnowledgeArticleVersion.tenant_id == tenant_id,
                ITSMKnowledgeArticleVersion.article_id.in_(article_ids),
            )
            .order_by(ITSMKnowledgeArticleVersion.version_number.desc())
            .all()
        )

        version_summary_map = {}
        version_num_map = {}
        for v in versions:
            if v.article_id not in version_summary_map:
                version_summary_map[v.article_id] = v.summary
                version_num_map[v.article_id] = v.version_number

        results: List[ITSMKnowledgeArticleSummaryResponse] = []
        for a in articles:
            results.append(
                ITSMKnowledgeArticleSummaryResponse(
                    id=a.id,
                    title=a.title,
                    slug=a.slug,
                    category=a.category,
                    status=a.status,
                    summary=version_summary_map.get(a.id),
                    current_published_version=a.current_published_version,
                    version_number=version_num_map.get(a.id) or a.current_published_version or 1,
                    view_count=a.view_count or 0,
                    helpful_count=a.helpful_count or 0,
                    author_id=a.author_id,
                    author_email=a.author.email if a.author else None,
                    service_id=a.service_id,
                    published_at=a.published_at,
                    created_at=a.created_at,
                    updated_at=a.updated_at,
                )
            )

        return results

    @staticmethod
    def get_article(
        db: Session,
        tenant_id: UUID,
        article_id_or_slug: str,
    ) -> Optional[ITSMKnowledgeArticleDetailResponse]:
        """Fetch a single knowledge article with full markdown content, metadata, and version history."""
        query = (
            db.query(ITSMKnowledgeArticle)
            .options(joinedload(ITSMKnowledgeArticle.author))
            .filter(ITSMKnowledgeArticle.tenant_id == tenant_id)
        )

        parsed_uuid: Optional[UUID] = None
        try:
            parsed_uuid = UUID(article_id_or_slug)
        except (ValueError, TypeError):
            pass

        if parsed_uuid:
            query = query.filter(
                or_(
                    ITSMKnowledgeArticle.id == parsed_uuid,
                    ITSMKnowledgeArticle.slug == article_id_or_slug,
                )
            )
        else:
            query = query.filter(ITSMKnowledgeArticle.slug == article_id_or_slug)

        article = query.first()
        if not article:
            return None

        # Fetch all versions ordered descending
        versions = (
            db.query(ITSMKnowledgeArticleVersion)
            .options(joinedload(ITSMKnowledgeArticleVersion.creator))
            .filter(
                ITSMKnowledgeArticleVersion.tenant_id == tenant_id,
                ITSMKnowledgeArticleVersion.article_id == article.id,
            )
            .order_by(ITSMKnowledgeArticleVersion.version_number.desc())
            .all()
        )

        active_version: Optional[ITSMKnowledgeArticleVersion] = None
        if article.status == "PUBLISHED" and article.current_published_version:
            for v in versions:
                if v.version_number == article.current_published_version:
                    active_version = v
                    break
        if not active_version and versions:
            active_version = versions[0]

        version_summaries = [
            ITSMKnowledgeArticleVersionSummary(
                id=v.id,
                article_id=v.article_id,
                version_number=v.version_number,
                title=v.title,
                summary=v.summary,
                content_markdown=v.content_markdown,
                keywords=v.keywords or [],
                change_summary=v.change_summary,
                created_by=v.created_by,
                created_by_email=v.creator.email if v.creator else None,
                created_at=v.created_at,
            )
            for v in versions
        ]

        return ITSMKnowledgeArticleDetailResponse(
            id=article.id,
            title=article.title,
            slug=article.slug,
            category=article.category,
            status=article.status,
            summary=active_version.summary if active_version else None,
            content_markdown=active_version.content_markdown if active_version else "No content available.",
            current_published_version=article.current_published_version,
            version_number=active_version.version_number if active_version else 1,
            keywords=active_version.keywords if (active_version and active_version.keywords) else [],
            view_count=article.view_count or 0,
            helpful_count=article.helpful_count or 0,
            author_id=article.author_id,
            author_email=article.author.email if article.author else None,
            service_id=article.service_id,
            published_at=article.published_at,
            created_at=article.created_at,
            updated_at=article.updated_at,
            versions=version_summaries,
        )

    @staticmethod
    def get_article_versions(
        db: Session,
        tenant_id: UUID,
        article_id: UUID,
    ) -> List[ITSMKnowledgeArticleVersionSummary]:
        """Fetch all immutable historical versions for an article."""
        article = (
            db.query(ITSMKnowledgeArticle)
            .filter(
                ITSMKnowledgeArticle.id == article_id,
                ITSMKnowledgeArticle.tenant_id == tenant_id,
            )
            .first()
        )
        if not article:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge article '{article_id}' not found in current tenant",
            )

        versions = (
            db.query(ITSMKnowledgeArticleVersion)
            .options(joinedload(ITSMKnowledgeArticleVersion.creator))
            .filter(
                ITSMKnowledgeArticleVersion.tenant_id == tenant_id,
                ITSMKnowledgeArticleVersion.article_id == article_id,
            )
            .order_by(ITSMKnowledgeArticleVersion.version_number.desc())
            .all()
        )

        return [
            ITSMKnowledgeArticleVersionSummary(
                id=v.id,
                article_id=v.article_id,
                version_number=v.version_number,
                title=v.title,
                summary=v.summary,
                content_markdown=v.content_markdown,
                keywords=v.keywords or [],
                change_summary=v.change_summary,
                created_by=v.created_by,
                created_by_email=v.creator.email if v.creator else None,
                created_at=v.created_at,
            )
            for v in versions
        ]

    @classmethod
    def create_article(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        data: CreateKnowledgeArticleRequest,
    ) -> ITSMKnowledgeArticleDetailResponse:
        """Create a new knowledge article in DRAFT status with initial Version 1."""
        now = datetime.now(timezone.utc)
        clean_title = data.title.strip()
        slug = generate_unique_slug(db, tenant_id, clean_title)

        article = ITSMKnowledgeArticle(
            id=uuid4(),
            tenant_id=tenant_id,
            title=clean_title,
            slug=slug,
            category=data.category.strip() if data.category else "TROUBLESHOOTING",
            service_id=data.service_id,
            status="DRAFT",
            current_published_version=None,
            view_count=0,
            helpful_count=0,
            author_id=actor_id,
            published_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(article)
        db.flush()

        v1 = ITSMKnowledgeArticleVersion(
            id=uuid4(),
            tenant_id=tenant_id,
            article_id=article.id,
            version_number=1,
            title=clean_title,
            content_markdown=data.content_markdown,
            summary=data.summary.strip() if data.summary else None,
            keywords=data.keywords or [],
            change_summary="Initial draft created",
            created_by=actor_id,
            created_at=now,
        )
        db.add(v1)
        db.commit()

        # Audit event
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
                        "tenant_id": str(tenant_id),
                        "actor_id": str(actor_id),
                        "action": "itsm.knowledge.created",
                        "resource_type": "itsm_knowledge_article",
                        "resource_id": str(article.id),
                        "metadata": {
                            "title": article.title,
                            "slug": article.slug,
                            "category": article.category,
                            "status": article.status,
                            "version": 1,
                        },
                    },
                )
                sp.commit()
            except Exception as e:
                sp.rollback()
                logger.warning(f"Failed to record audit event for knowledge creation: {e}")
        except Exception as e:
            logger.warning(f"Audit transaction block failed: {e}")

        res = cls.get_article(db, tenant_id, str(article.id))
        if not res:
            raise HTTPException(status_code=500, detail="Failed to load newly created article")
        return res

    @classmethod
    def update_article(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        article_id: UUID,
        data: UpdateKnowledgeArticleRequest,
    ) -> ITSMKnowledgeArticleDetailResponse:
        """Update article content or metadata. Adds a new version revision in itsm_knowledge_article_versions."""
        article = (
            db.query(ITSMKnowledgeArticle)
            .filter(
                ITSMKnowledgeArticle.id == article_id,
                ITSMKnowledgeArticle.tenant_id == tenant_id,
            )
            .first()
        )
        if not article:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge article '{article_id}' not found in current tenant",
            )

        latest_v = (
            db.query(ITSMKnowledgeArticleVersion)
            .filter(
                ITSMKnowledgeArticleVersion.tenant_id == tenant_id,
                ITSMKnowledgeArticleVersion.article_id == article.id,
            )
            .order_by(ITSMKnowledgeArticleVersion.version_number.desc())
            .first()
        )

        next_version = (latest_v.version_number + 1) if latest_v else 1
        now = datetime.now(timezone.utc)

        if data.title and data.title.strip():
            article.title = data.title.strip()
        if data.category and data.category.strip():
            article.category = data.category.strip()
        if data.service_id is not None:
            article.service_id = data.service_id

        # Determine version data
        new_title = data.title.strip() if (data.title and data.title.strip()) else (latest_v.title if latest_v else article.title)
        new_content = data.content_markdown if data.content_markdown is not None else (latest_v.content_markdown if latest_v else "")
        new_summary = data.summary if data.summary is not None else (latest_v.summary if latest_v else None)
        new_keywords = data.keywords if data.keywords is not None else (latest_v.keywords if latest_v else [])
        change_note = data.change_summary.strip() if (data.change_summary and data.change_summary.strip()) else f"Updated to version {next_version}"

        new_version = ITSMKnowledgeArticleVersion(
            id=uuid4(),
            tenant_id=tenant_id,
            article_id=article.id,
            version_number=next_version,
            title=new_title,
            content_markdown=new_content,
            summary=new_summary,
            keywords=new_keywords,
            change_summary=change_note,
            created_by=actor_id,
            created_at=now,
        )
        db.add(new_version)
        article.updated_at = now
        db.commit()

        # Audit event
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
                        "tenant_id": str(tenant_id),
                        "actor_id": str(actor_id),
                        "action": "itsm.knowledge.updated",
                        "resource_type": "itsm_knowledge_article",
                        "resource_id": str(article.id),
                        "metadata": {
                            "title": article.title,
                            "category": article.category,
                            "status": article.status,
                            "new_version": next_version,
                            "change_summary": change_note,
                        },
                    },
                )
                sp.commit()
            except Exception as e:
                sp.rollback()
                logger.warning(f"Failed to record audit event for knowledge update: {e}")
        except Exception as e:
            logger.warning(f"Audit transaction block failed: {e}")

        res = cls.get_article(db, tenant_id, str(article.id))
        if not res:
            raise HTTPException(status_code=500, detail="Failed to load updated article")
        return res

    @classmethod
    def publish_article(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        article_id: UUID,
    ) -> ITSMKnowledgeArticleDetailResponse:
        """Approve and publish an article, setting current_published_version to latest revision."""
        article = (
            db.query(ITSMKnowledgeArticle)
            .filter(
                ITSMKnowledgeArticle.id == article_id,
                ITSMKnowledgeArticle.tenant_id == tenant_id,
            )
            .first()
        )
        if not article:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge article '{article_id}' not found in current tenant",
            )

        latest_v = (
            db.query(ITSMKnowledgeArticleVersion)
            .filter(
                ITSMKnowledgeArticleVersion.tenant_id == tenant_id,
                ITSMKnowledgeArticleVersion.article_id == article.id,
            )
            .order_by(ITSMKnowledgeArticleVersion.version_number.desc())
            .first()
        )
        pub_version = latest_v.version_number if latest_v else 1

        now = datetime.now(timezone.utc)
        article.status = "PUBLISHED"
        article.current_published_version = pub_version
        article.published_at = now
        article.updated_at = now
        db.commit()

        # Audit event
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
                        "tenant_id": str(tenant_id),
                        "actor_id": str(actor_id),
                        "action": "itsm.knowledge.published",
                        "resource_type": "itsm_knowledge_article",
                        "resource_id": str(article.id),
                        "metadata": {
                            "title": article.title,
                            "published_version": pub_version,
                            "status": "PUBLISHED",
                        },
                    },
                )
                sp.commit()
            except Exception as e:
                sp.rollback()
                logger.warning(f"Failed to record audit event for knowledge publication: {e}")
        except Exception as e:
            logger.warning(f"Audit transaction block failed: {e}")

        res = cls.get_article(db, tenant_id, str(article.id))
        if not res:
            raise HTTPException(status_code=500, detail="Failed to load published article")
        return res

    @classmethod
    def archive_article(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        article_id: UUID,
    ) -> ITSMKnowledgeArticleDetailResponse:
        """Retire / archive an outdated article without deleting historical records."""
        article = (
            db.query(ITSMKnowledgeArticle)
            .filter(
                ITSMKnowledgeArticle.id == article_id,
                ITSMKnowledgeArticle.tenant_id == tenant_id,
            )
            .first()
        )
        if not article:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge article '{article_id}' not found in current tenant",
            )

        now = datetime.now(timezone.utc)
        article.status = "ARCHIVED"
        article.updated_at = now
        db.commit()

        # Audit event
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
                        "tenant_id": str(tenant_id),
                        "actor_id": str(actor_id),
                        "action": "itsm.knowledge.archived",
                        "resource_type": "itsm_knowledge_article",
                        "resource_id": str(article.id),
                        "metadata": {
                            "title": article.title,
                            "status": "ARCHIVED",
                        },
                    },
                )
                sp.commit()
            except Exception as e:
                sp.rollback()
                logger.warning(f"Failed to record audit event for knowledge archive: {e}")
        except Exception as e:
            logger.warning(f"Audit transaction block failed: {e}")

        res = cls.get_article(db, tenant_id, str(article.id))
        if not res:
            raise HTTPException(status_code=500, detail="Failed to load archived article")
        return res

    @classmethod
    def draft_article(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        article_id: UUID,
    ) -> ITSMKnowledgeArticleDetailResponse:
        """Return an article to DRAFT status for maintenance / rework."""
        article = (
            db.query(ITSMKnowledgeArticle)
            .filter(
                ITSMKnowledgeArticle.id == article_id,
                ITSMKnowledgeArticle.tenant_id == tenant_id,
            )
            .first()
        )
        if not article:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge article '{article_id}' not found in current tenant",
            )

        now = datetime.now(timezone.utc)
        article.status = "DRAFT"
        article.updated_at = now
        db.commit()

        res = cls.get_article(db, tenant_id, str(article.id))
        if not res:
            raise HTTPException(status_code=500, detail="Failed to load draft article")
        return res
