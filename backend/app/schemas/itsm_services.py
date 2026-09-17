"""Pydantic schemas for ITSM Services and Service Catalog."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class RequesterServiceCatalogItemResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    service_id: UUID
    service_name: str
    category_label: str
    name: str
    slug: str
    description: Optional[str] = None
    estimated_delivery_hours: int
    estimated_time_label: str
    approval_required: bool
    fulfillment_type: str
    fulfillment_group: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
