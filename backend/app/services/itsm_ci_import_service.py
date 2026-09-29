"""Domain service for CMDB-005: Bulk Configuration Item (CI) Import."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import ITSMConfigurationItem, ITSMService
from app.schemas.itsm_admin import (
    CIBulkImportCommitResponse,
    CIBulkImportDryRunResponse,
    CIBulkImportErrorQueueItem,
    CIBulkImportRowDiff,
    CIBulkImportRowResult,
)
from app.services.audit_store import append_audit_event

logger = logging.getLogger(__name__)

STANDARD_CI_TYPES = {
    "SERVER",
    "DATABASE",
    "APPLICATION",
    "CLOUD_SERVICE",
    "NETWORK_DEVICE",
    "STORAGE",
    "LOAD_BALANCER",
    "CONTAINER_CLUSTER",
}

STANDARD_ENVIRONMENTS = {
    "PRODUCTION",
    "STAGING",
    "DEVELOPMENT",
    "DISASTER_RECOVERY",
}

STANDARD_STATUSES = {
    "ACTIVE",
    "MAINTENANCE",
    "DECOMMISSIONED",
}

CI_TYPE_SYNONYMS = {
    "vm": "SERVER",
    "virtualmachine": "SERVER",
    "virtual_machine": "SERVER",
    "host": "SERVER",
    "compute": "SERVER",
    "instance": "SERVER",
    "ec2": "SERVER",
    "server": "SERVER",
    "db": "DATABASE",
    "database": "DATABASE",
    "rds": "DATABASE",
    "sql": "DATABASE",
    "postgres": "DATABASE",
    "mysql": "DATABASE",
    "app": "APPLICATION",
    "application": "APPLICATION",
    "service": "APPLICATION",
    "microservice": "APPLICATION",
    "api": "APPLICATION",
    "s3": "STORAGE",
    "bucket": "STORAGE",
    "ebs": "STORAGE",
    "disk": "STORAGE",
    "volume": "STORAGE",
    "storage": "STORAGE",
    "vpc": "CLOUD_SERVICE",
    "cloud": "CLOUD_SERVICE",
    "aws": "CLOUD_SERVICE",
    "azure": "CLOUD_SERVICE",
    "gcp": "CLOUD_SERVICE",
    "cloudservice": "CLOUD_SERVICE",
    "cloud_service": "CLOUD_SERVICE",
    "lb": "LOAD_BALANCER",
    "alb": "LOAD_BALANCER",
    "nlb": "LOAD_BALANCER",
    "elb": "LOAD_BALANCER",
    "loadbalancer": "LOAD_BALANCER",
    "load_balancer": "LOAD_BALANCER",
    "k8s": "CONTAINER_CLUSTER",
    "eks": "CONTAINER_CLUSTER",
    "gke": "CONTAINER_CLUSTER",
    "cluster": "CONTAINER_CLUSTER",
    "container": "CONTAINER_CLUSTER",
    "docker": "CONTAINER_CLUSTER",
    "containercluster": "CONTAINER_CLUSTER",
    "container_cluster": "CONTAINER_CLUSTER",
    "router": "NETWORK_DEVICE",
    "switch": "NETWORK_DEVICE",
    "firewall": "NETWORK_DEVICE",
    "vpn": "NETWORK_DEVICE",
    "gateway": "NETWORK_DEVICE",
    "network": "NETWORK_DEVICE",
    "networkdevice": "NETWORK_DEVICE",
    "network_device": "NETWORK_DEVICE",
}

ENVIRONMENT_SYNONYMS = {
    "prod": "PRODUCTION",
    "production": "PRODUCTION",
    "live": "PRODUCTION",
    "stage": "STAGING",
    "staging": "STAGING",
    "uat": "STAGING",
    "preprod": "STAGING",
    "dev": "DEVELOPMENT",
    "development": "DEVELOPMENT",
    "test": "DEVELOPMENT",
    "testing": "DEVELOPMENT",
    "sandbox": "DEVELOPMENT",
    "dr": "DISASTER_RECOVERY",
    "disasterrecovery": "DISASTER_RECOVERY",
    "disaster_recovery": "DISASTER_RECOVERY",
    "backup": "DISASTER_RECOVERY",
}

STATUS_SYNONYMS = {
    "active": "ACTIVE",
    "running": "ACTIVE",
    "online": "ACTIVE",
    "enabled": "ACTIVE",
    "operational": "ACTIVE",
    "up": "ACTIVE",
    "in_service": "ACTIVE",
    "maintenance": "MAINTENANCE",
    "stopped": "MAINTENANCE",
    "offline": "MAINTENANCE",
    "paused": "MAINTENANCE",
    "disabled": "MAINTENANCE",
    "maintenance_mode": "MAINTENANCE",
    "decommissioned": "DECOMMISSIONED",
    "retired": "DECOMMISSIONED",
    "terminated": "DECOMMISSIONED",
    "deleted": "DECOMMISSIONED",
    "archived": "DECOMMISSIONED",
    "destroyed": "DECOMMISSIONED",
    "inactive": "DECOMMISSIONED",
}


def normalize_ci_type(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    cleaned = val.strip().lower()
    if cleaned in CI_TYPE_SYNONYMS:
        return CI_TYPE_SYNONYMS[cleaned]
    upper = val.strip().upper()
    if upper in STANDARD_CI_TYPES:
        return upper
    # Allow custom extensible CI class if 2-50 chars alphanumeric/underscore
    if 2 <= len(upper) <= 50 and re.match(r"^[A-Z0-9_-]+$", upper):
        return upper
    return upper


def normalize_environment(val: Optional[str]) -> str:
    if not val:
        return "PRODUCTION"
    cleaned = val.strip().lower()
    if cleaned in ENVIRONMENT_SYNONYMS:
        return ENVIRONMENT_SYNONYMS[cleaned]
    upper = val.strip().upper()
    if upper in STANDARD_ENVIRONMENTS:
        return upper
    return "PRODUCTION"


def normalize_status(val: Optional[str]) -> str:
    if not val:
        return "ACTIVE"
    cleaned = val.strip().lower()
    if cleaned in STATUS_SYNONYMS:
        return STATUS_SYNONYMS[cleaned]
    upper = val.strip().upper()
    if upper in STANDARD_STATUSES:
        return upper
    return "ACTIVE"


def auto_detect_field(column_name: str) -> Optional[str]:
    norm = re.sub(r"[^a-z0-9]", "", column_name.lower())
    if norm in ("name", "ciname", "hostname", "servername", "resourcename", "itemname", "title"):
        return "name"
    if norm in ("citype", "type", "class", "ciclass", "category", "componenttype"):
        return "ci_type"
    if norm in ("environment", "env", "stage", "tier"):
        return "environment"
    if norm in ("status", "state", "operationalstatus", "lifecyclestatus"):
        return "status"
    if norm in ("servicename", "service", "appservice", "applicationservice"):
        return "service_name"
    if norm in ("serviceid",):
        return "service_id"
    if norm in ("externalresourceid", "externalid", "resourceid", "arn", "instanceid", "assettag", "serialnumber"):
        return "external_resource_id"
    return None


class CIImportService:
    @staticmethod
    def map_and_transform_record(
        raw: dict[str, Any],
        field_mapping: Optional[dict[str, str]] = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Map raw incoming record keys to canonical CI fields and extra attributes."""
        canonical: dict[str, Any] = {
            "name": None,
            "ci_type": None,
            "environment": "PRODUCTION",
            "status": "ACTIVE",
            "service_name": None,
            "service_id": None,
            "external_resource_id": None,
        }
        extra_attrs: dict[str, Any] = {}

        effective_mapping: dict[str, str] = {}
        if field_mapping:
            effective_mapping = field_mapping
        else:
            for k in raw.keys():
                detected = auto_detect_field(k)
                if detected:
                    effective_mapping[k] = detected

        for raw_k, raw_v in raw.items():
            target = effective_mapping.get(raw_k)
            str_val = str(raw_v).strip() if raw_v is not None else ""
            if target == "name":
                canonical["name"] = str_val or None
            elif target == "ci_type":
                canonical["ci_type"] = normalize_ci_type(str_val)
            elif target == "environment":
                canonical["environment"] = normalize_environment(str_val)
            elif target == "status":
                canonical["status"] = normalize_status(str_val)
            elif target == "service_name":
                canonical["service_name"] = str_val or None
            elif target == "service_id":
                if str_val:
                    try:
                        canonical["service_id"] = UUID(str_val)
                    except ValueError:
                        canonical["service_id"] = None
                        extra_attrs[raw_k] = raw_v
            elif target == "external_resource_id":
                canonical["external_resource_id"] = str_val or None
            else:
                if raw_v is not None and str_val != "":
                    extra_attrs[raw_k] = raw_v

        return canonical, extra_attrs

    @classmethod
    def evaluate_batch(
        cls,
        db: Session,
        tenant_id: UUID,
        raw_records: list[dict[str, Any]],
        field_mapping: Optional[dict[str, str]] = None,
    ) -> list[CIBulkImportRowResult]:
        """Dry-run evaluation of the incoming CI batch against tenant state."""
        # Load tenant services
        services = db.query(ITSMService).filter(ITSMService.tenant_id == tenant_id).all()
        service_by_id = {s.id: s for s in services}
        service_by_name = {s.name.strip().lower(): s for s in services}

        # Load existing tenant CIs
        existing_cis = db.query(ITSMConfigurationItem).filter(ITSMConfigurationItem.tenant_id == tenant_id).all()
        ci_by_name = {ci.name.strip().lower(): ci for ci in existing_cis}
        ci_by_ext_id = {
            ci.external_resource_id.strip().lower(): ci
            for ci in existing_cis
            if ci.external_resource_id and ci.external_resource_id.strip()
        }

        row_results: list[CIBulkImportRowResult] = []
        batch_seen_names: dict[str, int] = {}
        batch_seen_ext_ids: dict[str, int] = {}

        for idx, raw in enumerate(raw_records, start=1):
            canonical, _ = cls.map_and_transform_record(raw, field_mapping)
            errors: list[str] = []
            conflicts: list[str] = []
            action: str = "INSERT"
            target_ci: Optional[ITSMConfigurationItem] = None
            changes: Optional[dict[str, CIBulkImportRowDiff]] = None

            # Validate Required Fields
            name = canonical.get("name")
            if not name:
                errors.append("Missing required field 'name'")
            elif len(name) < 2 or len(name) > 255:
                errors.append(f"Field 'name' length must be between 2 and 255 characters (got {len(name)})")

            ci_type = canonical.get("ci_type")
            if not ci_type:
                errors.append("Missing required field 'ci_type'")
            elif len(ci_type) < 2 or len(ci_type) > 50:
                errors.append(f"Field 'ci_type' length must be between 2 and 50 characters (got {len(ci_type)})")

            # Resolve Service
            service_id: Optional[UUID] = canonical.get("service_id")
            service_name: Optional[str] = canonical.get("service_name")
            resolved_service_name: Optional[str] = None

            if service_id:
                if service_id in service_by_id:
                    resolved_service_name = service_by_id[service_id].name
                else:
                    errors.append(f"Associated service ID '{service_id}' not found in this tenant")
            elif service_name:
                srv = service_by_name.get(service_name.strip().lower())
                if srv:
                    service_id = srv.id
                    resolved_service_name = srv.name
                else:
                    errors.append(f"Associated service name '{service_name}' not found in this tenant")

            ext_id = canonical.get("external_resource_id")

            # In-Batch Duplicate Detection
            if name:
                name_key = name.strip().lower()
                if name_key in batch_seen_names:
                    conflicts.append(f"Duplicate CI name '{name}' already present in row {batch_seen_names[name_key]} of this import file")
                else:
                    batch_seen_names[name_key] = idx

            if ext_id:
                ext_key = ext_id.strip().lower()
                if ext_key in batch_seen_ext_ids:
                    conflicts.append(f"Duplicate external resource ID '{ext_id}' already present in row {batch_seen_ext_ids[ext_key]} of this import file")
                else:
                    batch_seen_ext_ids[ext_key] = idx

            # Existing Database Match & Reconciliation
            matched_by_ext: Optional[ITSMConfigurationItem] = None
            matched_by_name: Optional[ITSMConfigurationItem] = None

            if ext_id:
                matched_by_ext = ci_by_ext_id.get(ext_id.strip().lower())
            if name:
                matched_by_name = ci_by_name.get(name.strip().lower())

            if matched_by_ext and matched_by_name and matched_by_ext.id != matched_by_name.id:
                conflicts.append(
                    f"Ambiguous CI match: name '{name}' matches CI '{matched_by_name.name}' ({matched_by_name.id}), "
                    f"but external ID '{ext_id}' matches a different CI '{matched_by_ext.name}' ({matched_by_ext.id})"
                )
                action = "CONFLICT"
            elif matched_by_ext or matched_by_name:
                target_ci = matched_by_ext or matched_by_name
                action = "UPDATE"
            else:
                action = "INSERT"

            # Check Differences for Updates
            if target_ci and not conflicts:
                diff_map: dict[str, CIBulkImportRowDiff] = {}
                if name and name.strip() != target_ci.name:
                    diff_map["name"] = CIBulkImportRowDiff(old=target_ci.name, new=name.strip())
                if ci_type and ci_type.strip() != target_ci.ci_type:
                    diff_map["ci_type"] = CIBulkImportRowDiff(old=target_ci.ci_type, new=ci_type.strip())
                if canonical["environment"] != target_ci.environment:
                    diff_map["environment"] = CIBulkImportRowDiff(old=target_ci.environment, new=canonical["environment"])
                if canonical["status"] != target_ci.status:
                    diff_map["status"] = CIBulkImportRowDiff(old=target_ci.status, new=canonical["status"])
                if service_id != target_ci.service_id:
                    old_srv_name = service_by_id[target_ci.service_id].name if target_ci.service_id in service_by_id else None
                    diff_map["service"] = CIBulkImportRowDiff(old=old_srv_name, new=resolved_service_name)
                if ext_id != target_ci.external_resource_id:
                    diff_map["external_resource_id"] = CIBulkImportRowDiff(old=target_ci.external_resource_id, new=ext_id)

                changes = diff_map if diff_map else None

            # Determine Final Row Action
            if errors:
                action = "ERROR"
            elif conflicts:
                action = "CONFLICT"

            row_results.append(
                CIBulkImportRowResult(
                    row_number=idx,
                    action=action,
                    name=name,
                    ci_type=ci_type,
                    environment=canonical.get("environment"),
                    status=canonical.get("status"),
                    service_id=service_id,
                    service_name=resolved_service_name or service_name,
                    external_resource_id=ext_id,
                    existing_ci_id=target_ci.id if target_ci else None,
                    changes=changes,
                    errors=errors,
                    conflicts=conflicts,
                    raw_data=raw,
                )
            )

        return row_results

    @classmethod
    def dry_run(
        cls,
        db: Session,
        tenant_id: UUID,
        source_filename: str,
        source_type: str,
        raw_records: list[dict[str, Any]],
        field_mapping: Optional[dict[str, str]] = None,
    ) -> CIBulkImportDryRunResponse:
        """Execute dry-run without altering any database records."""
        rows = cls.evaluate_batch(db, tenant_id, raw_records, field_mapping)

        total = len(rows)
        errors = sum(1 for r in rows if r.action == "ERROR")
        conflicts = sum(1 for r in rows if r.action == "CONFLICT")
        updates = sum(1 for r in rows if r.action == "UPDATE")
        inserts = sum(1 for r in rows if r.action == "INSERT")
        valid = inserts + updates
        invalid = errors + conflicts

        return CIBulkImportDryRunResponse(
            source_filename=source_filename,
            source_type=source_type.lower(),
            total_records=total,
            valid_records=valid,
            invalid_records=invalid,
            insert_count=inserts,
            update_count=updates,
            conflict_count=conflicts,
            error_count=errors,
            rows=rows,
        )

    @classmethod
    def commit_import(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        source_filename: str,
        source_type: str,
        raw_records: list[dict[str, Any]],
        field_mapping: Optional[dict[str, str]] = None,
        update_existing: bool = True,
    ) -> CIBulkImportCommitResponse:
        """Commit valid CIs into the database within an isolated transaction and record audit evidence."""
        batch_id = str(uuid4())
        now = datetime.now(timezone.utc)

        rows = cls.evaluate_batch(db, tenant_id, raw_records, field_mapping)

        inserted_count = 0
        updated_count = 0
        skipped_count = 0
        error_count = 0
        error_queue: list[CIBulkImportErrorQueueItem] = []

        # Load existing CIs for updates
        existing_cis = {
            ci.id: ci
            for ci in db.query(ITSMConfigurationItem).filter(ITSMConfigurationItem.tenant_id == tenant_id).all()
        }

        for row in rows:
            if row.action in ("ERROR", "CONFLICT"):
                error_count += 1
                error_queue.append(
                    CIBulkImportErrorQueueItem(
                        row_number=row.row_number,
                        name=row.name,
                        action=row.action,
                        errors=row.errors,
                        conflicts=row.conflicts,
                        raw_data=row.raw_data,
                    )
                )
                continue

            _, extra_attrs = cls.map_and_transform_record(row.raw_data, field_mapping)

            if row.action == "INSERT":
                ci_attrs = {
                    "source": "bulk_import",
                    "source_file": source_filename,
                    "import_batch_id": batch_id,
                    "imported_at": now.isoformat(),
                    "imported_by": str(actor_id),
                }
                if extra_attrs:
                    ci_attrs["custom_fields"] = extra_attrs

                new_ci = ITSMConfigurationItem(
                    id=uuid4(),
                    tenant_id=tenant_id,
                    service_id=row.service_id,
                    name=row.name.strip(),
                    ci_type=row.ci_type.strip().upper(),
                    environment=row.environment or "PRODUCTION",
                    status=row.status or "ACTIVE",
                    external_resource_id=row.external_resource_id.strip() if row.external_resource_id else None,
                    attributes=ci_attrs,
                    created_at=now,
                    updated_at=now,
                )
                db.add(new_ci)
                inserted_count += 1

            elif row.action == "UPDATE":
                if not update_existing or not row.existing_ci_id:
                    skipped_count += 1
                    continue

                existing_ci = existing_cis.get(row.existing_ci_id)
                if not existing_ci:
                    skipped_count += 1
                    continue

                if row.name:
                    existing_ci.name = row.name.strip()
                if row.ci_type:
                    existing_ci.ci_type = row.ci_type.strip().upper()
                if row.environment:
                    existing_ci.environment = row.environment
                if row.status:
                    existing_ci.status = row.status
                if row.service_id is not None:
                    existing_ci.service_id = row.service_id
                if row.external_resource_id:
                    existing_ci.external_resource_id = row.external_resource_id.strip()

                existing_ci.updated_at = now
                merged_attrs = dict(existing_ci.attributes or {})
                merged_attrs["last_import_batch_id"] = batch_id
                merged_attrs["last_imported_at"] = now.isoformat()
                merged_attrs["last_imported_by"] = str(actor_id)
                merged_attrs["last_source_file"] = source_filename
                if extra_attrs:
                    custom = merged_attrs.get("custom_fields", {})
                    custom.update(extra_attrs)
                    merged_attrs["custom_fields"] = custom
                existing_ci.attributes = merged_attrs
                updated_count += 1

        db.commit()

        # Audit Event Logging
        try:
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :t, true)"),
                {"t": str(tenant_id)},
            )
            append_audit_event(
                db,
                {
                    "id": str(uuid4()),
                    "idempotency_key": f"itsm:cmdb:bulk_import:{tenant_id}:{batch_id}",
                    "tenant_id": str(tenant_id),
                    "timestamp": now,
                    "actor_id": str(actor_id),
                    "actor_type": "user",
                    "action": "itsm.cmdb.bulk_import",
                    "request_id": batch_id,
                    "provider": "itsm",
                    "reason": f"Bulk imported {inserted_count} CIs, updated {updated_count}, skipped {skipped_count}, errors {error_count} from '{source_filename}'",
                    "response_status": 200,
                    "frameworks_affected": ["ITIL"],
                    "execution_trace": [
                        {
                            "batch_id": batch_id,
                            "source_filename": source_filename,
                            "source_type": source_type,
                            "total_records": len(raw_records),
                            "inserted_count": inserted_count,
                            "updated_count": updated_count,
                            "skipped_count": skipped_count,
                            "error_count": error_count,
                        }
                    ],
                },
            )
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning("Failed to record audit event for CMDB bulk import: %s", e)

        logger.info(
            "[ITSM_CMDB_AUDIT] action=bulk_import tenant_id=%s admin_id=%s batch_id=%s inserted=%d updated=%d skipped=%d errors=%d",
            tenant_id,
            actor_id,
            batch_id,
            inserted_count,
            updated_count,
            skipped_count,
            error_count,
        )

        return CIBulkImportCommitResponse(
            batch_id=batch_id,
            source_filename=source_filename,
            total_records=len(raw_records),
            inserted_count=inserted_count,
            updated_count=updated_count,
            skipped_count=skipped_count,
            error_count=error_count,
            error_queue=error_queue,
        )
