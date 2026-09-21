from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ChangeSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    change_number: str
    title: str
    description: Optional[str] = None
    status: str
    change_type: Optional[str] = None
    risk_level: Optional[str] = None
    impact_level: Optional[str] = None
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None
    assigned_team: Optional[str] = None
    assigned_to_id: Optional[UUID] = None
    assignee_email: Optional[str] = None
    earliest_start_at: Optional[datetime] = None
    latest_finish_at: Optional[datetime] = None
    actual_start_at: Optional[datetime] = None
    actual_finish_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ChangeStatsResponse(BaseModel):
    total: int
    open: int
    in_progress: int
    scheduled: int
    completed: int


class ChangeAffectedCIItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ci_id: UUID
    name: str
    ci_type: str
    environment: str
    status: str
    impact_type: str
    notes: Optional[str] = None


class ChangeDetailResponse(ChangeSummaryResponse):
    lead_time_hours: Optional[int] = 0
    outage_expected: Optional[bool] = False
    implementation_plan: Optional[str] = ""
    backout_plan: Optional[str] = ""
    test_plan: Optional[str] = ""
    affected_cis: List[ChangeAffectedCIItem] = []


class ChangeAssessmentUpdateRequest(BaseModel):
    change_type: Optional[str] = None
    risk_level: Optional[str] = None
    impact_level: Optional[str] = None
    description: Optional[str] = None
    implementation_plan: Optional[str] = None
    backout_plan: Optional[str] = None
    test_plan: Optional[str] = None
