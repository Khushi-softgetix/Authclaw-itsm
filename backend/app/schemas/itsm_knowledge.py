"""Pydantic schemas for ITSM Knowledge Management."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ITSMKnowledgeArticleSummaryResponse(BaseModel):
    """Compact summary of a knowledge article for catalog and search listings."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    slug: str
    category: str
    status: str
    summary: Optional[str] = None
    view_count: int = 0
    helpful_count: int = 0
    author_id: Optional[UUID] = None
    author_email: Optional[str] = None
    published_at: Optional[datetime] = None
    updated_at: datetime


class ITSMKnowledgeArticleDetailResponse(BaseModel):
    """Full detail of a knowledge article including markdown content."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    slug: str
    category: str
    status: str
    summary: Optional[str] = None
    content_markdown: str
    version_number: int = 1
    keywords: List[str] = []
    view_count: int = 0
    helpful_count: int = 0
    author_id: UUID
    author_email: Optional[str] = None
    published_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class RequesterKBArticleResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    title: str
    slug: str
    category: str
    status: str
    view_count: int
    helpful_count: int
    read_time: str
    views_label: str
    summary: str
    content: str
    steps: list[str]
    published_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
