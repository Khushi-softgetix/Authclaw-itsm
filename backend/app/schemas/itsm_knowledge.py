"""Pydantic schemas for ITSM Knowledge Base for Requesters."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


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
