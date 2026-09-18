"""Service layer for ITSM Knowledge Management."""
from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.db.models import ITSMKnowledgeArticle, ITSMKnowledgeArticleVersion
from app.schemas.itsm_knowledge import (
    ITSMKnowledgeArticleDetailResponse,
    ITSMKnowledgeArticleSummaryResponse,
)


class KnowledgeService:
    """Service methods for querying knowledge articles and revisions."""

    @staticmethod
    def list_articles(
        db: Session,
        tenant_id: UUID,
        search: Optional[str] = None,
        category: Optional[str] = None,
        status: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> List[ITSMKnowledgeArticleSummaryResponse]:
        """List and search published knowledge articles within tenant boundary."""
        query = (
            db.query(ITSMKnowledgeArticle)
            .options(joinedload(ITSMKnowledgeArticle.author))
            .filter(ITSMKnowledgeArticle.tenant_id == tenant_id)
        )

        if status:
            query = query.filter(ITSMKnowledgeArticle.status == status.upper())
        else:
            # Default to published articles for standard consumers
            query = query.filter(ITSMKnowledgeArticle.status == "PUBLISHED")

        if category and category.strip().upper() != "ALL":
            query = query.filter(
                func.upper(ITSMKnowledgeArticle.category) == category.strip().upper()
            )

        if search and search.strip():
            term = f"%{search.strip()}%"
            # Subquery matching versions with title, summary, or content
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

        # Batch-fetch active version summaries
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
        for v in versions:
            if v.article_id not in version_summary_map:
                version_summary_map[v.article_id] = v.summary

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
                    view_count=a.view_count or 0,
                    helpful_count=a.helpful_count or 0,
                    author_id=a.author_id,
                    author_email=a.author.email if a.author else None,
                    published_at=a.published_at,
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
        """Fetch a single knowledge article with full markdown content by ID or slug."""
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

        # Increment view count
        article.view_count = (article.view_count or 0) + 1
        try:
            db.commit()
        except Exception:
            db.rollback()

        # Fetch active published version (or latest available version)
        version = (
            db.query(ITSMKnowledgeArticleVersion)
            .filter(
                ITSMKnowledgeArticleVersion.tenant_id == tenant_id,
                ITSMKnowledgeArticleVersion.article_id == article.id,
            )
            .order_by(ITSMKnowledgeArticleVersion.version_number.desc())
            .first()
        )

        return ITSMKnowledgeArticleDetailResponse(
            id=article.id,
            title=article.title,
            slug=article.slug,
            category=article.category,
            status=article.status,
            summary=version.summary if version else None,
            content_markdown=version.content_markdown if version else "No content available.",
            version_number=version.version_number if version else 1,
            keywords=version.keywords if (version and version.keywords) else [],
            view_count=article.view_count or 0,
            helpful_count=article.helpful_count or 0,
            author_id=article.author_id,
            author_email=article.author.email if article.author else None,
            published_at=article.published_at,
            created_at=article.created_at,
            updated_at=article.updated_at,
        )
