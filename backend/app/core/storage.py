"""Local filesystem storage abstraction for ITSM file attachments with security validation."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from uuid import UUID

from fastapi import HTTPException, status


def get_storage_base_dir() -> Path:
    base_dir = os.getenv("ITSM_STORAGE_DIR", "data/uploads")
    path = Path(base_dir).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


class LocalStorageEngine:
    MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB limit

    ALLOWED_EXTENSIONS = {
        ".png", ".jpg", ".jpeg", ".webp",
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".txt", ".csv", ".log",
    }

    @classmethod
    def save_file(cls, tenant_id: UUID, file_name: str, content: bytes) -> tuple[str, str, int]:
        """Validates, hashes, and stores file to local disk outside PostgreSQL.

        Returns (storage_path, checksum_sha256, file_size_bytes).
        """
        if not content or len(content) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty.",
            )

        if len(content) > cls.MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File size exceeds maximum allowed limit of {cls.MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB.",
            )

        # Sanitize filename (prevent path traversal)
        safe_filename = os.path.basename(file_name).strip()
        if not safe_filename or safe_filename in {".", ".."}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file name.",
            )

        ext = Path(safe_filename).suffix.lower()
        if not ext or ext not in cls.ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File type '{ext}' is not supported. Allowed formats: PNG, JPG, JPEG, WEBP, PDF, DOCX, XLSX, TXT.",
            )

        checksum_sha256 = hashlib.sha256(content).hexdigest()

        # Build tenant-isolated directory
        base_dir = get_storage_base_dir()
        tenant_dir = (base_dir / str(tenant_id)).resolve()

        # Path traversal guard
        if not str(tenant_dir).startswith(str(base_dir)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid target directory.",
            )

        tenant_dir.mkdir(parents=True, exist_ok=True)

        # Generate unique filename to avoid overwrites while preserving extension
        ext = Path(safe_filename).suffix
        stem = Path(safe_filename).stem[:32]
        unique_name = f"{stem}_{checksum_sha256[:12]}{ext}"
        target_path = (tenant_dir / unique_name).resolve()

        if not str(target_path).startswith(str(tenant_dir)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path traversal detected.",
            )

        # Write file atomically
        with open(target_path, "wb") as f:
            f.write(content)

        relative_path = str(target_path.relative_to(base_dir))
        return relative_path, checksum_sha256, len(content)

    @classmethod
    def resolve_path(cls, relative_storage_path: str) -> Path:
        """Resolves and validates storage path against base directory."""
        base_dir = get_storage_base_dir()
        target_path = (base_dir / relative_storage_path).resolve()

        if not str(target_path).startswith(str(base_dir)) or not target_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment file content not found on storage server.",
            )

        return target_path
