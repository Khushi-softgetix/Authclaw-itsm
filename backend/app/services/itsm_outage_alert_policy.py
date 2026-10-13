"""Pure authorization and projection rules for Outage & Alerts.

Recipient resolution supplies an eligible role and audience relationship. This
module then applies the same field/action policy to preview, publication,
notifications, and portal reads.
"""
from __future__ import annotations

from typing import Any


MANAGE_ROLES = {"INCIDENT_MANAGER"}
AUDIT_ROLES = {"AUDITOR"}

ALERT_PERMISSIONS = {
    "OUTAGE_ALERT:READ",
    "OUTAGE_ALERT:CREATE",
    "OUTAGE_ALERT:EDIT",
    "OUTAGE_ALERT:PREVIEW",
    "OUTAGE_ALERT:PUBLISH",
    "OUTAGE_ALERT:UPDATE",
    "OUTAGE_ALERT:RECOVER",
    "OUTAGE_ALERT:CANCEL",
    "OUTAGE_ALERT:LINK",
}

ACTION_PERMISSIONS = {
    "VIEW": "OUTAGE_ALERT:READ",
    "PREVIEW": "OUTAGE_ALERT:PREVIEW",
    "EDIT_DRAFT": "OUTAGE_ALERT:EDIT",
    "PUBLISH": "OUTAGE_ALERT:PUBLISH",
    "PUBLISH_UPDATE": "OUTAGE_ALERT:UPDATE",
    "PUBLISH_RECOVERY": "OUTAGE_ALERT:RECOVER",
    "CANCEL_DRAFT": "OUTAGE_ALERT:CANCEL",
    "LINK_RECORD": "OUTAGE_ALERT:LINK",
}

PUBLIC_FIELDS = {
    "alert_number", "title", "alert_type", "public_summary", "impact_summary",
    "recommended_action", "status", "affected_services", "outage_started_at",
    "public_status", "next_update_at", "published_at", "latest_publication_at",
    "recovered_at", "updated_at",
}
SERVICE_AGENT_FIELDS = PUBLIC_FIELDS | {
    "severity", "intent", "service_agent_guidance", "service_agent_handling",
    "authorized_links",
}
PROCESS_FIELDS = PUBLIC_FIELDS | {"severity", "intent", "authorized_links"}
MANAGER_FIELDS = SERVICE_AGENT_FIELDS | {
    "internal_notes", "audiences", "configuration_items", "links",
    "created_by_id", "updated_by_id", "created_at",
}
AUDITOR_FIELDS = PUBLIC_FIELDS | {
    "severity", "intent", "audiences", "configuration_items", "links",
    "created_by_id", "updated_by_id", "created_at",
}


def normalize_role(role: str | None) -> str:
    value = str(role or "").strip().upper().replace(" ", "_").replace("&", "AND")
    aliases = {
        "PROBLEM_MANAGER": "PROBLEM_AND_CHANGE_MANAGER",
        "CHANGE_MANAGER": "PROBLEM_AND_CHANGE_MANAGER",
        "PROCESS_CHANGE_MANAGER": "PROBLEM_AND_CHANGE_MANAGER",
        "PROBLEM_CHANGE_MANAGER": "PROBLEM_AND_CHANGE_MANAGER",
        "PLATFORM_ADMINISTRATOR": "PLATFORM_ADMIN",
        "CATALOG_MANAGER": "SERVICE_OWNER",
    }
    return aliases.get(value, value)


def can_manage(role: str | None) -> bool:
    return normalize_role(role) in MANAGE_ROLES


def projection_type_for_role(role: str | None) -> str:
    role = normalize_role(role)
    if role == "REQUESTER":
        return "REQUESTER"
    if role == "SERVICE_AGENT":
        return "SERVICE_AGENT"
    if role == "PROBLEM_AND_CHANGE_MANAGER":
        return "PROCESS_MANAGER"
    if role == "SERVICE_OWNER":
        return "SERVICE_OWNER"
    if role == "AUDITOR":
        return "AUDITOR"
    if role == "INCIDENT_MANAGER":
        return "INCIDENT_MANAGER"
    if role == "PLATFORM_ADMIN":
        return "DELIVERY_OPERATOR"
    return "NONE"


def allowed_actions_for(role: str | None, *, intent: str, handling: str, has_incident_link: bool) -> list[str]:
    role = normalize_role(role)
    if role == "REQUESTER":
        return ["VIEW", "ACKNOWLEDGE"]
    if role == "SERVICE_AGENT":
        actions = ["VIEW", "ACKNOWLEDGE"]
        if handling == "SOLVE" and has_incident_link and intent in {"ACTION_REQUIRED", "INVESTIGATE", "RESOLVE"}:
            actions.append("OPEN_LINKED_INCIDENT")
        return actions
    if role in {"PROBLEM_AND_CHANGE_MANAGER", "SERVICE_OWNER"}:
        return ["VIEW", "ACKNOWLEDGE"]
    if role == "INCIDENT_MANAGER":
        return ["VIEW", "PREVIEW", "EDIT_DRAFT", "PUBLISH", "PUBLISH_UPDATE", "PUBLISH_RECOVERY", "CANCEL_DRAFT", "LINK_RECORD"]
    if role == "AUDITOR":
        return ["VIEW_EVIDENCE"]
    if role == "PLATFORM_ADMIN":
        return ["VIEW_DELIVERY_HEALTH"]
    return []


def project_alert(content: dict[str, Any], role: str | None) -> dict[str, Any]:
    role = normalize_role(role)
    if role == "REQUESTER":
        fields = PUBLIC_FIELDS
    elif role == "SERVICE_AGENT":
        fields = SERVICE_AGENT_FIELDS
    elif role in {"PROBLEM_AND_CHANGE_MANAGER", "SERVICE_OWNER"}:
        fields = PROCESS_FIELDS
    elif role == "INCIDENT_MANAGER":
        fields = MANAGER_FIELDS
    elif role == "AUDITOR":
        # Audit access is not operational-content access. Published snapshots,
        # lifecycle actors, audience configuration and delivery evidence are
        # exposed separately by the evidence read model; restricted support
        # guidance and internal notes remain excluded.
        fields = AUDITOR_FIELDS
    elif role == "PLATFORM_ADMIN":
        fields = {"alert_number", "status", "published_at", "latest_publication_at", "updated_at"}
    else:
        fields = set()
    return {key: value for key, value in content.items() if key in fields}


def projection_fields(role: str | None) -> list[str]:
    return sorted(project_alert({name: True for name in MANAGER_FIELDS}, role).keys())
