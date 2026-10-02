"""FastAPI endpoints for ITSM Productivity Macros and Response Templates (WKS-003)."""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.schemas.itsm_macros import (
    MacroApplyRequest,
    MacroApplyResponse,
    MacroCreateRequest,
    MacroResponse,
    MacroUpdateRequest,
)
from app.services.itsm_macro_service import ITSMMacroService

router = APIRouter()

AGENT_ALLOWED_ROLES = {
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PROBLEM_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "SERVICE_LEAD",
    "ADMIN",
}

ADMIN_ONLY_ROLES = {
    "PLATFORM_ADMINISTRATOR",
    "ADMIN",
}


def _resolve_itsm_role(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    """Retrieve and validate the active ITSM business role for the requesting user."""
    try:
        row = db.execute(
            text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
            {"tenant_id": str(tenant_id), "user_id": str(user_id)},
        ).first()
        if row and row.has_itsm_access and row.itsm_role:
            return str(row.itsm_role).upper()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify ITSM access",
        ) from exc

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="User does not have active ITSM access in this tenant",
    )


@router.get("", response_model=list[MacroResponse], summary="List available productivity macros")
def list_macros(
    request: Request,
    ticket_type: Optional[str] = Query(None, description="Filter by ticket type: 'INCIDENT' or 'SERVICE_REQUEST'"),
    active_only: bool = Query(True, description="Only return active macros"),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _resolve_itsm_role(db, t_id, actor_id)

    if role not in AGENT_ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authorized service agents and administrators can access productivity macros",
        )

    # Regular agents can only see active macros; admins can see all if requested
    effective_active_only = active_only if role in ADMIN_ONLY_ROLES else True

    return ITSMMacroService.list_macros(
        db=db,
        tenant_id=t_id,
        ticket_type=ticket_type,
        active_only=effective_active_only,
        actor_id=actor_id,
    )


@router.get("/{macro_id}", response_model=MacroResponse, summary="Get details for a specific macro")
def get_macro(
    macro_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _resolve_itsm_role(db, t_id, actor_id)

    if role not in AGENT_ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authorized service agents and administrators can access productivity macros",
        )

    macro = ITSMMacroService.get_macro(db=db, tenant_id=t_id, macro_id=macro_id)
    if not macro.is_active and role not in ADMIN_ONLY_ROLES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macro not found")

    return macro


@router.post(
    "/{macro_id}/apply",
    response_model=MacroApplyResponse,
    summary="Apply a macro to an active incident or service request",
)
def apply_macro(
    macro_id: UUID,
    payload: MacroApplyRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _resolve_itsm_role(db, t_id, actor_id)

    if role not in AGENT_ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only authorized service agents and administrators can execute productivity macros",
        )

    return ITSMMacroService.apply_macro(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        macro_id=macro_id,
        payload=payload,
    )


@router.post(
    "",
    response_model=MacroResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new productivity macro (Admin only)",
)
def create_macro(
    payload: MacroCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _resolve_itsm_role(db, t_id, actor_id)

    if role not in ADMIN_ONLY_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Platform Administrators can create macros",
        )

    return ITSMMacroService.create_macro(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        payload=payload,
    )


@router.patch("/{macro_id}", response_model=MacroResponse, summary="Update an existing macro (Admin only)")
def update_macro(
    macro_id: UUID,
    payload: MacroUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _resolve_itsm_role(db, t_id, actor_id)

    if role not in ADMIN_ONLY_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Platform Administrators can modify macros",
        )

    return ITSMMacroService.update_macro(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        macro_id=macro_id,
        payload=payload,
    )


@router.delete("/{macro_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a macro (Admin only)")
def delete_macro(
    macro_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _resolve_itsm_role(db, t_id, actor_id)

    if role not in ADMIN_ONLY_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Platform Administrators can delete macros",
        )

    ITSMMacroService.delete_macro(db=db, tenant_id=t_id, macro_id=macro_id)
