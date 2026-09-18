"""API Router for ITSM Knowledge Base."""
from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.schemas.itsm_knowledge import (
    ITSMKnowledgeArticleDetailResponse,
    ITSMKnowledgeArticleSummaryResponse,
)
from app.services.itsm_knowledge_service import KnowledgeService

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
    "AUDITOR",
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
            detail="Unauthorized role for knowledge base access",
        )
    return role


@router.get(
    "",
    response_model=List[ITSMKnowledgeArticleSummaryResponse],
    summary="List and search knowledge articles",
    description="Retrieve published knowledge articles within tenant context with optional keyword search and category filtering.",
)
def list_knowledge_articles(
    request: Request,
    search: Optional[str] = Query(default=None, description="Search term across title, summary, and content"),
    category: Optional[str] = Query(default=None, description="Category filter (e.g. Networking, Authentication)"),
    status_filter: Optional[str] = Query(default=None, alias="status", description="Publication status"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_itsm_user(db, t_id, actor_id)

    return KnowledgeService.list_articles(
        db=db,
        tenant_id=t_id,
        search=search,
        category=category,
        status=status_filter,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/{article_id}",
    response_model=ITSMKnowledgeArticleDetailResponse,
    summary="Get knowledge article detail",
    description="Retrieve full markdown content and metadata for a specific knowledge article.",
)
def get_knowledge_article(
    article_id: str,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
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
