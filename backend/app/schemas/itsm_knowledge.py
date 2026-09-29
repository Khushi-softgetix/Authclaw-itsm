"""Pydantic schemas for ITSM Knowledge Management."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

class ITSMKnowledgeArticleVersionSummary(BaseModel):
    """Summary of an immutable version entry of a knowledge article."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    article_id: UUID
    version_number: int
    title: str
    summary: Optional[str] = None
    content_markdown: str
    keywords: List[str] = []
    change_summary: Optional[str] = None
    created_by: UUID
    created_by_email: Optional[str] = None
    created_at: datetime


class ITSMKnowledgeArticleSummaryResponse(BaseModel):
    """Compact summary of a knowledge article for catalog and search listings."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    slug: str
    category: str
    status: str
    summary: Optional[str] = None
    current_published_version: Optional[int] = None
    version_number: int = 1
    view_count: int = 0
    helpful_count: int = 0
    author_id: Optional[UUID] = None
    author_email: Optional[str] = None
    service_id: Optional[UUID] = None
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: datetime


class ITSMKnowledgeArticleDetailResponse(BaseModel):
    """Full detail of a knowledge article including markdown content and version history."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    slug: str
    category: str
    status: str
    summary: Optional[str] = None
    content_markdown: str
    current_published_version: Optional[int] = None
    version_number: int = 1
    keywords: List[str] = []
    view_count: int = 0
    helpful_count: int = 0
    author_id: UUID
    author_email: Optional[str] = None
    service_id: Optional[UUID] = None
    published_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    versions: List[ITSMKnowledgeArticleVersionSummary] = []


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


class CreateKnowledgeArticleRequest(BaseModel):
    """Payload for creating a new knowledge article."""
    title: str = Field(..., min_length=3, max_length=512, description="Article title")
    category: str = Field(default="TROUBLESHOOTING", max_length=100, description="Article category")
    content_markdown: str = Field(..., min_length=1, description="Markdown body content")
    summary: Optional[str] = Field(default=None, max_length=1024, description="Brief summary / excerpt")
    keywords: List[str] = Field(default_factory=list, description="Keywords for search indexing")
    service_id: Optional[UUID] = Field(default=None, description="Linked service in service catalog")


class UpdateKnowledgeArticleRequest(BaseModel):
    """Payload for updating / editing an existing knowledge article."""
    title: Optional[str] = Field(default=None, min_length=3, max_length=512)
    category: Optional[str] = Field(default=None, max_length=100)
    content_markdown: Optional[str] = Field(default=None, min_length=1)
    summary: Optional[str] = Field(default=None, max_length=1024)
    keywords: Optional[List[str]] = None
    change_summary: Optional[str] = Field(default=None, max_length=512, description="Reason / note for this revision")
    service_id: Optional[UUID] = None
