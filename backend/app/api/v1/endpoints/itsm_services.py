"""API router for ITSM Services workspace (Step 7)."""
from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.schemas.itsm_services import (
    ITSMServiceDetailResponse,
    ITSMServiceSummaryResponse,
)
from app.services.itsm_service_service import ITSMServiceManager

router = APIRouter()

ALLOWED_ITSM_ROLES = {
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "SERVICE_LEAD",
    "PROCESS_CHANGE_MANAGER",
    "REQUESTER",
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
            detail="Unauthorized role for ITSM services access",
        )
    return role


@router.get(
    "",
    response_model=List[ITSMServiceSummaryResponse],
    summary="List ITSM services",
    description="Retrieve all operational ITSM services for the current tenant with keyword search and filtering.",
)
def list_services(
    request: Request,
    search: Optional[str] = Query(default=None, description="Search term for service name or description"),
    status_filter: Optional[str] = Query(default=None, alias="status", description="Filter by service status"),
    tier_filter: Optional[str] = Query(default=None, alias="tier", description="Filter by service tier"),
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    user_id_val = getattr(request.state, "user_id", None)
    if not user_id_val:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    tenant_id = UUID(tenant_id_str)
    user_id = UUID(str(user_id_val))
    _verify_itsm_user(db, tenant_id, user_id)

    return ITSMServiceManager.list_services(
        db=db,
        tenant_id=tenant_id,
        search=search,
        status_filter=status_filter,
        tier_filter=tier_filter,
    )


@router.get(
    "/{service_id}",
    response_model=ITSMServiceDetailResponse,
    summary="Get ITSM service detail",
    description="Retrieve complete service detail including linked configuration items and recent ticket context.",
)
def get_service_detail(
    service_id: str,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    user_id_val = getattr(request.state, "user_id", None)
    if not user_id_val:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    tenant_id = UUID(tenant_id_str)
    user_id = UUID(str(user_id_val))
    _verify_itsm_user(db, tenant_id, user_id)

    return ITSMServiceManager.get_service_detail(
        db=db,
        tenant_id=tenant_id,
        service_id_or_slug=service_id,
    )
