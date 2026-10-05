"""Service layer for ITSM Productivity Macros and Response Templates (WKS-003).

Reuses existing ITSMWorkflow and ITSMWorkflowVersion models with trigger_type="MACRO".
Zero new database migrations required.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import (
    ITSMTicket,
    ITSMTicketActivity,
    ITSMWorkflow,
    ITSMWorkflowVersion,
    Notification,
)
from app.schemas.itsm_macros import (
    MacroApplyRequest,
    MacroApplyResponse,
    MacroCreateRequest,
    MacroResponse,
    MacroUpdateRequest,
)
from app.services.itsm_sla_service import pause_sla
from app.services.notifications import create_notification

logger = logging.getLogger("itsm.macros")

DEFAULT_MACRO_DEFINITIONS = [
    {
        "name": "Laptop Troubleshooting",
        "slug": "laptop-troubleshooting",
        "description": "Standard laptop reboot and browser cache instructions for end-users",
        "applicable_ticket_type": "ALL",
        "response_template": "Please restart your laptop and clear your browser cache. If the issue continues, please reply to this request.",
        "status_change": "PENDING",
        "status_reason": "Pending Requester",
        "priority_change": None,
        "follow_up_hours": 24,
        "is_active": True,
    },
    {
        "name": "Awaiting User Verification",
        "slug": "awaiting-user-verification",
        "description": "Ask requester to verify applied fix before ticket closure",
        "applicable_ticket_type": "ALL",
        "response_template": "We have applied the resolution to your request. Please test and confirm if everything is working as expected so we can close this ticket.",
        "status_change": "PENDING",
        "status_reason": "Awaiting Requester Response",
        "priority_change": None,
        "follow_up_hours": 48,
        "is_active": True,
    },
    {
        "name": "Hardware Diagnostic Intake",
        "slug": "hardware-diagnostic-intake",
        "description": "Request device serial number, asset tag, and physical office location",
        "applicable_ticket_type": "INCIDENT",
        "response_template": "To diagnose this hardware issue, please provide your device asset tag, serial number, and physical office location/desk number.",
        "status_change": "IN_PROGRESS",
        "status_reason": "Hardware Diagnostic",
        "priority_change": None,
        "follow_up_hours": 24,
        "is_active": True,
    },
    {
        "name": "Access Provisioned Confirmation",
        "slug": "access-provisioned-confirmation",
        "description": "Notify requester that requested permissions or access have been provisioned",
        "applicable_ticket_type": "SERVICE_REQUEST",
        "response_template": "Your requested access has been provisioned. Please allow up to 15 minutes for permissions to replicate, then log in and verify access.",
        "status_change": "RESOLVED",
        "status_reason": "Access Provisioned",
        "priority_change": None,
        "follow_up_hours": None,
        "is_active": True,
    },
]


def _slugify(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return cleaned or "macro"


class ITSMMacroService:
    @classmethod
    def seed_default_macros_if_empty(cls, db: Session, tenant_id: UUID, actor_id: Optional[UUID] = None) -> None:
        """Seed default productivity macros for a tenant if none exist."""
        try:
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )
        except Exception:
            pass

        existing = (
            db.query(ITSMWorkflow.id)
            .filter(ITSMWorkflow.tenant_id == tenant_id, ITSMWorkflow.trigger_type == "MACRO")
            .first()
        )
        if existing:
            return

        now = datetime.now(timezone.utc)
        creator_id = actor_id

        # If no actor_id provided, pick any user in the tenant
        if not creator_id:
            try:
                row = db.execute(
                    text("SELECT id FROM users WHERE tenant_id = :tenant_id LIMIT 1"),
                    {"tenant_id": str(tenant_id)},
                ).first()
                if row:
                    creator_id = row[0]
            except Exception:
                pass

        if not creator_id:
            # Fallback to tenant_id or a system UUID if no user exists yet
            creator_id = tenant_id

        for item in DEFAULT_MACRO_DEFINITIONS:
            workflow = ITSMWorkflow(
                id=uuid4(),
                tenant_id=tenant_id,
                name=item["name"],
                slug=item["slug"],
                description=item["description"],
                trigger_type="MACRO",
                is_active=item["is_active"],
                current_published_version=1,
                created_at=now,
                updated_at=now,
            )
            db.add(workflow)

            definition = {
                "applicable_ticket_type": item["applicable_ticket_type"],
                "response_template": item["response_template"],
                "status_change": item["status_change"],
                "status_reason": item["status_reason"],
                "priority_change": item["priority_change"],
                "follow_up_hours": item["follow_up_hours"],
            }

            version = ITSMWorkflowVersion(
                id=uuid4(),
                tenant_id=tenant_id,
                workflow_id=workflow.id,
                version_number=1,
                definition=definition,
                changelog="Initial seed default macro",
                created_by=creator_id,
                created_at=now,
            )
            db.add(version)

        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.warning("Failed to seed default macros for tenant %s: %s", tenant_id, exc)

    @classmethod
    def _to_macro_response(cls, workflow: ITSMWorkflow, version: Optional[ITSMWorkflowVersion]) -> MacroResponse:
        definition = version.definition if version and version.definition else {}
        return MacroResponse(
            id=workflow.id,
            tenant_id=workflow.tenant_id,
            name=workflow.name,
            slug=workflow.slug,
            description=workflow.description,
            applicable_ticket_type=definition.get("applicable_ticket_type", "ALL"),
            response_template=definition.get("response_template", ""),
            status_change=definition.get("status_change"),
            status_reason=definition.get("status_reason"),
            priority_change=definition.get("priority_change"),
            follow_up_hours=definition.get("follow_up_hours"),
            is_active=workflow.is_active,
            current_published_version=workflow.current_published_version or 1,
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
        )

    @classmethod
    def list_macros(
        cls,
        db: Session,
        tenant_id: UUID,
        ticket_type: Optional[str] = None,
        active_only: bool = True,
        actor_id: Optional[UUID] = None,
    ) -> list[MacroResponse]:
        """List macros for a tenant, filtered by ticket type and active status."""
        cls.seed_default_macros_if_empty(db, tenant_id, actor_id=actor_id)

        query = db.query(ITSMWorkflow).filter(
            ITSMWorkflow.tenant_id == tenant_id,
            ITSMWorkflow.trigger_type == "MACRO",
        )
        if active_only:
            query = query.filter(ITSMWorkflow.is_active.is_(True))

        workflows = query.order_by(ITSMWorkflow.name.asc()).all()
        results: list[MacroResponse] = []

        for wf in workflows:
            version = (
                db.query(ITSMWorkflowVersion)
                .filter(
                    ITSMWorkflowVersion.tenant_id == tenant_id,
                    ITSMWorkflowVersion.workflow_id == wf.id,
                )
                .order_by(ITSMWorkflowVersion.version_number.desc())
                .first()
            )
            resp = cls._to_macro_response(wf, version)
            if ticket_type:
                target_type = ticket_type.strip().upper()
                if resp.applicable_ticket_type not in {"ALL", target_type}:
                    continue
            results.append(resp)

        return results

    @classmethod
    def get_macro(cls, db: Session, tenant_id: UUID, macro_id: UUID) -> MacroResponse:
        """Fetch a single macro by ID."""
        wf = (
            db.query(ITSMWorkflow)
            .filter(
                ITSMWorkflow.id == macro_id,
                ITSMWorkflow.tenant_id == tenant_id,
                ITSMWorkflow.trigger_type == "MACRO",
            )
            .first()
        )
        if not wf:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macro not found")

        version = (
            db.query(ITSMWorkflowVersion)
            .filter(
                ITSMWorkflowVersion.tenant_id == tenant_id,
                ITSMWorkflowVersion.workflow_id == wf.id,
            )
            .order_by(ITSMWorkflowVersion.version_number.desc())
            .first()
        )
        return cls._to_macro_response(wf, version)

    @classmethod
    def create_macro(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        payload: MacroCreateRequest,
    ) -> MacroResponse:
        """Create a new macro for a tenant (Platform Administrator only)."""
        try:
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(tenant_id)},
            )
        except Exception:
            pass

        base_slug = payload.slug or _slugify(payload.name)
        slug = base_slug
        count = 1
        while (
            db.query(ITSMWorkflow.id)
            .filter(ITSMWorkflow.tenant_id == tenant_id, ITSMWorkflow.slug == slug)
            .first()
        ):
            slug = f"{base_slug}-{count}"
            count += 1

        now = datetime.now(timezone.utc)
        workflow = ITSMWorkflow(
            id=uuid4(),
            tenant_id=tenant_id,
            name=payload.name.strip(),
            slug=slug,
            description=payload.description.strip() if payload.description else None,
            trigger_type="MACRO",
            is_active=payload.is_active,
            current_published_version=1,
            created_at=now,
            updated_at=now,
        )
        db.add(workflow)

        definition = {
            "applicable_ticket_type": (payload.applicable_ticket_type or "ALL").upper(),
            "response_template": payload.response_template.strip(),
            "status_change": payload.status_change.strip().upper() if payload.status_change else None,
            "status_reason": payload.status_reason.strip() if payload.status_reason else None,
            "priority_change": payload.priority_change.strip().upper() if payload.priority_change else None,
            "follow_up_hours": payload.follow_up_hours,
        }

        version = ITSMWorkflowVersion(
            id=uuid4(),
            tenant_id=tenant_id,
            workflow_id=workflow.id,
            version_number=1,
            definition=definition,
            changelog="Created macro",
            created_by=actor_id,
            created_at=now,
        )
        db.add(version)
        db.commit()
        db.refresh(workflow)

        return cls._to_macro_response(workflow, version)

    @classmethod
    def update_macro(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        macro_id: UUID,
        payload: MacroUpdateRequest,
    ) -> MacroResponse:
        """Update an existing macro (Platform Administrator only)."""
        wf = (
            db.query(ITSMWorkflow)
            .filter(
                ITSMWorkflow.id == macro_id,
                ITSMWorkflow.tenant_id == tenant_id,
                ITSMWorkflow.trigger_type == "MACRO",
            )
            .first()
        )
        if not wf:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macro not found")

        now = datetime.now(timezone.utc)
        if payload.name is not None:
            wf.name = payload.name.strip()
        if payload.description is not None:
            wf.description = payload.description.strip() if payload.description else None
        if payload.is_active is not None:
            wf.is_active = payload.is_active
        wf.updated_at = now

        current_version = (
            db.query(ITSMWorkflowVersion)
            .filter(
                ITSMWorkflowVersion.tenant_id == tenant_id,
                ITSMWorkflowVersion.workflow_id == wf.id,
            )
            .order_by(ITSMWorkflowVersion.version_number.desc())
            .first()
        )
        current_def = dict(current_version.definition) if current_version and current_version.definition else {}

        definition_changed = False
        if payload.applicable_ticket_type is not None:
            current_def["applicable_ticket_type"] = payload.applicable_ticket_type.strip().upper()
            definition_changed = True
        if payload.response_template is not None:
            current_def["response_template"] = payload.response_template.strip()
            definition_changed = True
        if payload.status_change is not None:
            current_def["status_change"] = payload.status_change.strip().upper() if payload.status_change else None
            definition_changed = True
        if payload.status_reason is not None:
            current_def["status_reason"] = payload.status_reason.strip() if payload.status_reason else None
            definition_changed = True
        if payload.priority_change is not None:
            current_def["priority_change"] = payload.priority_change.strip().upper() if payload.priority_change else None
            definition_changed = True
        if payload.follow_up_hours is not None:
            current_def["follow_up_hours"] = payload.follow_up_hours
            definition_changed = True

        new_version = current_version
        if definition_changed:
            next_num = (current_version.version_number + 1) if current_version else 1
            new_version = ITSMWorkflowVersion(
                id=uuid4(),
                tenant_id=tenant_id,
                workflow_id=wf.id,
                version_number=next_num,
                definition=current_def,
                changelog=f"Updated definition by {actor_id}",
                created_by=actor_id,
                created_at=now,
            )
            db.add(new_version)
            wf.current_published_version = next_num

        db.commit()
        db.refresh(wf)
        return cls._to_macro_response(wf, new_version)

    @classmethod
    def delete_macro(cls, db: Session, tenant_id: UUID, macro_id: UUID) -> None:
        """Delete a macro (Platform Administrator only)."""
        wf = (
            db.query(ITSMWorkflow)
            .filter(
                ITSMWorkflow.id == macro_id,
                ITSMWorkflow.tenant_id == tenant_id,
                ITSMWorkflow.trigger_type == "MACRO",
            )
            .first()
        )
        if not wf:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macro not found")

        db.delete(wf)
        db.commit()

    @classmethod
    def apply_macro(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        macro_id: UUID,
        payload: MacroApplyRequest,
    ) -> MacroApplyResponse:
        """Apply macro ticket-field changes and schedule follow-up reminder."""
        wf = (
            db.query(ITSMWorkflow)
            .filter(
                ITSMWorkflow.id == macro_id,
                ITSMWorkflow.tenant_id == tenant_id,
                ITSMWorkflow.trigger_type == "MACRO",
            )
            .first()
        )
        if not wf:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macro not found")

        if not wf.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Macro is deactivated and cannot be applied",
            )

        version = (
            db.query(ITSMWorkflowVersion)
            .filter(
                ITSMWorkflowVersion.tenant_id == tenant_id,
                ITSMWorkflowVersion.workflow_id == wf.id,
            )
            .order_by(ITSMWorkflowVersion.version_number.desc())
            .first()
        )
        definition = version.definition if version and version.definition else {}

        # 1. Ticket type compatibility check
        applicable = definition.get("applicable_ticket_type", "ALL").upper()
        target_ticket_type = payload.ticket_type.strip().upper()
        if applicable not in {"ALL", target_ticket_type}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Macro '{wf.name}' is only applicable to {applicable} tickets, not {target_ticket_type}",
            )

        # 2. Fetch ticket
        ticket = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == payload.ticket_id,
                ITSMTicket.tenant_id == tenant_id,
            )
            .first()
        )
        if not ticket:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")

        if ticket.status in {"CLOSED", "CANCELLED"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot apply macro to ticket in terminal status '{ticket.status}'",
            )

        now = datetime.now(timezone.utc)
        status_changed = False
        target_status = definition.get("status_change")

        # 3. Apply status update if configured
        if target_status:
            target_status = target_status.strip().upper()
            status_reason = definition.get("status_reason") or "Applied productivity macro"

            if ticket.status != target_status:
                ticket.status = target_status
                ticket.status_reason = status_reason
                if target_status == "PENDING":
                    pause_sla(ticket, now)
                ticket.updated_at = now
                status_changed = True

        # 4. Apply priority update if configured and valid
        target_priority = definition.get("priority_change")
        if target_priority:
            target_priority = target_priority.strip().upper()
            if target_priority in {"P1", "P2", "P3", "P4"} and ticket.priority != target_priority:
                ticket.priority = target_priority
                ticket.updated_at = now

        # 5. Follow-up reminder handling
        follow_up_hours = definition.get("follow_up_hours")
        reminder_created = False

        if follow_up_hours and follow_up_hours > 0:
            # Check for existing unread reminder for this ticket to avoid duplicates
            existing_reminder = (
                db.query(Notification)
                .filter(
                    Notification.tenant_id == tenant_id,
                    Notification.type == "macro_reminder",
                    Notification.link.like(f"%{ticket.id}%"),
                    Notification.read_at.is_(None),
                )
                .first()
            )

            if not existing_reminder:
                ticket_path = (
                    f"/itsm/incidents/{ticket.id}"
                    if ticket.ticket_type == "INCIDENT"
                    else f"/itsm/requests/{ticket.id}"
                )
                reminder_user = ticket.assignee_id or actor_id
                create_notification(
                    db=db,
                    tenant_id=tenant_id,
                    user_id=reminder_user,
                    type="macro_reminder",
                    severity="info",
                    title=f"Follow-up Reminder: {ticket.ticket_number}",
                    body=f"Macro '{wf.name}' follow-up scheduled for {ticket.ticket_number} in {follow_up_hours}h.",
                    link=ticket_path,
                )
                reminder_created = True

        # 6. Audit & Timeline Activity
        activity_parts = [f"Macro '{wf.name}' applied."]
        if status_changed:
            activity_parts.append(f"Status changed to {ticket.status}.")
        if follow_up_hours:
            if reminder_created:
                activity_parts.append(f"Follow-up reminder scheduled in {follow_up_hours}h.")
            else:
                activity_parts.append(f"Follow-up reminder already active ({follow_up_hours}h).")

        activity = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=tenant_id,
            ticket_id=ticket.id,
            actor_type="USER",
            actor_id=actor_id,
            activity_type="NOTE",
            content=" ".join(activity_parts),
            activity_metadata={
                "is_internal": True,
                "macro_id": str(wf.id),
                "macro_name": wf.name,
                "status_changed": status_changed,
                "new_status": ticket.status if status_changed else None,
                "follow_up_hours": follow_up_hours,
                "reminder_created": reminder_created,
            },
            created_at=now,
        )
        db.add(activity)

        db.commit()
        db.refresh(ticket)

        confirmation_msg = f"Macro '{wf.name}' applied."
        if status_changed:
            confirmation_msg += f" Status updated to {ticket.status}."
        if follow_up_hours:
            confirmation_msg += f" Follow-up reminder scheduled for {follow_up_hours}h."

        return MacroApplyResponse(
            macro_id=wf.id,
            macro_name=wf.name,
            response_template=definition.get("response_template", ""),
            status_changed=status_changed,
            new_status=ticket.status if status_changed else None,
            reminder_created=reminder_created,
            follow_up_hours=follow_up_hours,
            message=confirmation_msg,
        )
