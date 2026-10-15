from __future__ import annotations

import json
import logging
import os
import smtplib
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailDeliveryResult:
    method: str
    detail: str


class EmailDeliveryError(RuntimeError):
    pass


def demo_otp_visible() -> bool:
    return os.getenv("DEMO_OTP_VISIBLE", "false").lower() == "true"


def smtp_configured() -> bool:
    smtp_host = (
        os.getenv("SMTP_HOST", "").strip()
        or ("smtp.gmail.com" if (os.getenv("GMAIL_USER") or os.getenv("GMAIL_APP_PASSWORD")) else "")
    )
    smtp_user = os.getenv(
        "SMTP_USER",
        os.getenv("SMTP_USERNAME", os.getenv("GMAIL_USER", "")),
    ).strip()
    smtp_password = os.getenv(
        "SMTP_PASSWORD",
        os.getenv("SMTP_PASS", os.getenv("GMAIL_APP_PASSWORD", "")),
    ).strip()
    if not smtp_host:
        return False
    if smtp_user and not smtp_password:
        return False
    return True


def _send_smtp_message(message: EmailMessage) -> None:
    smtp_host = (
        os.getenv("SMTP_HOST", "").strip()
        or ("smtp.gmail.com" if (os.getenv("GMAIL_USER") or os.getenv("GMAIL_APP_PASSWORD")) else "")
    )
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv(
        "SMTP_USER",
        os.getenv("SMTP_USERNAME", os.getenv("GMAIL_USER", "")),
    ).strip()
    smtp_password = os.getenv(
        "SMTP_PASSWORD",
        os.getenv("SMTP_PASS", os.getenv("GMAIL_APP_PASSWORD", "")),
    )
    smtp_tls = (
        os.getenv("SMTP_TLS", os.getenv("SMTP_STARTTLS", "true")).lower() == "true"
    )

    if (smtp_host and "gmail" in smtp_host.lower()) or os.getenv("GMAIL_APP_PASSWORD"):
        if smtp_password:
            smtp_password = smtp_password.replace(" ", "")

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            if smtp_tls:
                server.starttls()
            if smtp_user and smtp_password:
                server.login(smtp_user, smtp_password)
            server.send_message(message)
    except Exception as exc:
        logger.error("SMTP delivery failed for host=%s port=%s tls=%s: %s", smtp_host, smtp_port, smtp_tls, exc)
        raise EmailDeliveryError("Could not send email") from exc


def send_email(
    email: str, subject: str, body: str, html_body: str | None = None
) -> EmailDeliveryResult:
    """Send a non-OTP email through the existing SMTP transport."""
    if not smtp_configured():
        if os.getenv("AUTHCLAW_ENV", "").lower() != "production":
            return _write_local_email(email, subject, body, html_body=html_body)
        raise EmailDeliveryError("Email delivery is not configured")

    default_from = os.getenv("GMAIL_USER") or os.getenv("SMTP_USER") or "no-reply@authclaw.local"
    configured_from = os.getenv("SMTP_FROM", os.getenv("EMAIL_FROM", "")).strip()
    smtp_from = default_from if (not configured_from or "example.com" in configured_from.lower()) else configured_from

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp_from
    message["To"] = email
    message.set_content(body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    try:
        _send_smtp_message(message)
        if os.getenv("AUTHCLAW_ENV", "").lower() != "production":
            _write_local_email(email, subject, body, html_body=html_body)
        return EmailDeliveryResult(method="smtp", detail="Email sent by SMTP")
    except EmailDeliveryError:
        raise


def send_otp_email(
    email: str,
    otp: str,
    tenant_name: str,
    *,
    purpose: str = "tenant setup",
    action_url: str | None = None,
) -> EmailDeliveryResult:
    if not smtp_configured():
        if os.getenv("AUTHCLAW_ENV", "").lower() != "production":
            return _write_local_outbox(
                email, otp, tenant_name, purpose=purpose, action_url=action_url
            )
        raise EmailDeliveryError("Email delivery is not configured")

    default_from = os.getenv("GMAIL_USER") or os.getenv("SMTP_USER") or "no-reply@authclaw.local"
    configured_from = os.getenv("SMTP_FROM", os.getenv("EMAIL_FROM", "")).strip()
    smtp_from = default_from if (not configured_from or "example.com" in configured_from.lower()) else configured_from

    message = EmailMessage()
    message["From"] = smtp_from
    message["To"] = email

    if action_url:
        message["Subject"] = f"You're invited to join {tenant_name} on AuthClaw ITSM"
        plain_body = (
            f"Hello,\n\n"
            f"You have been invited to join {tenant_name} on AuthClaw ITSM.\n\n"
            f"Please use the link below to complete your account setup and create your password:\n\n"
            f"Complete Account Setup:\n{action_url}\n\n"
            f"Your 6-digit verification code:\n{otp}\n\n"
            f"(This code and invitation link expire in 15 minutes.)\n\n"
            f"Once your account setup is complete, you can sign in to AuthClaw ITSM with your email and newly created password.\n\n"
            f"If you did not request this invitation, you can safely ignore this email.\n\n"
            f"Best regards,\n"
            f"The {tenant_name} Team"
        )
        message.set_content(plain_body)

        html_body = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    <div style="margin-bottom:24px;">
      <span style="font-size:18px;font-weight:700;color:#6D28D9;letter-spacing:-0.02em;">AuthClaw ITSM</span>
    </div>
    <h1 style="font-size:20px;font-weight:700;color:#0e1726;margin:0 0 12px 0;">Welcome to {tenant_name}</h1>
    <p style="font-size:14px;line-height:22px;color:#475069;margin:0 0 24px 0;">
      You have been invited by your platform administrator to join <strong>{tenant_name}</strong> on AuthClaw ITSM. Please complete your account setup to create your password and activate your access.
    </p>
    <div style="background-color:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:20px;margin-bottom:28px;text-align:center;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6d28d9;margin-bottom:8px;">6-Digit Verification Code</div>
      <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#0e1726;font-family:monospace;">{otp}</div>
      <div style="font-size:12px;color:#6b7488;margin-top:6px;">Expires in 15 minutes</div>
    </div>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="{action_url}" style="display:inline-block;background-color:#6D28D9;color:#ffffff;padding:13px 32px;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;box-shadow:0 4px 14px rgba(109,40,217,0.35);">Complete Account Setup &rarr;</a>
    </div>
    <p style="font-size:12px;color:#6b7488;line-height:18px;margin:28px 0 0 0;border-top:1px solid #f1f3f7;padding-top:20px;">
      If the button above does not work, copy and paste this link into your browser:<br/>
      <a href="{action_url}" style="color:#6D28D9;word-break:break-all;text-decoration:underline;">{action_url}</a>
    </p>
  </div>
</body>
</html>"""
        message.add_alternative(html_body, subtype="html")
    else:
        message["Subject"] = "Your AuthClaw verification code"
        body = (
            f"Your AuthClaw verification code is {otp}.\n\n"
            f"It expires in 15 minutes for {purpose}: {tenant_name}.\n\n"
            f"If you did not request this code, you can ignore this email."
        )
        message.set_content(body)

    try:
        _send_smtp_message(message)
        return EmailDeliveryResult(method="smtp", detail="OTP sent by SMTP")
    except EmailDeliveryError:
        raise


def send_activation_email(
    email: str,
    tenant_name: str,
    action_url: str,
    role: str | None = None,
    expires_in_hours: int = 24,
) -> EmailDeliveryResult:
    """Send an account activation email containing a secure one-time activation link without credentials."""
    role_label = role.replace("_", " ").title() if role else "Employee"
    subject = f"Activate Your AuthClaw ITSM Account ({tenant_name})"

    plain_body = (
        f"Hello,\n\n"
        f"An administrator has invited you to AuthClaw ITSM for {tenant_name} with the role '{role_label}'.\n\n"
        f"Account Email: {email}\n\n"
        f"Please open the secure link below to create your password and activate your account:\n\n"
        f"Activation Link:\n"
        f"{action_url}\n\n"
        f"(This activation link will expire in {expires_in_hours} hours.)\n\n"
        f"Security Notice: This activation link is single-use, strictly confidential, and should not be shared with anyone.\n\n"
        f"If you did not expect this invitation, you can safely ignore this email.\n\n"
        f"Best regards,\n"
        f"The {tenant_name} Team"
    )

    html_body = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    <div style="margin-bottom:24px;">
      <span style="font-size:18px;font-weight:700;color:#6D28D9;letter-spacing:-0.02em;">AuthClaw ITSM</span>
    </div>
    <h1 style="font-size:20px;font-weight:700;color:#0e1726;margin:0 0 12px 0;">Activate Your AuthClaw ITSM Account</h1>
    <p style="font-size:14px;line-height:22px;color:#475069;margin:0 0 16px 0;">
      An administrator has invited you to AuthClaw ITSM for <strong>{tenant_name}</strong> with the role <strong>{role_label}</strong>.
    </p>
    <p style="font-size:14px;line-height:22px;color:#475069;margin:0 0 16px 0;">
      <strong>Account Email:</strong> {email}
    </p>
    <p style="font-size:14px;line-height:22px;color:#475069;margin:0 0 28px 0;">
      Please click the button below to open the activation page, create your password, and activate your account. This link will expire in {expires_in_hours} hours.
    </p>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="{action_url}" style="display:inline-block;background-color:#6D28D9;color:#ffffff;padding:13px 32px;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;box-shadow:0 4px 14px rgba(109,40,217,0.35);">Activate Account & Set Password &rarr;</a>
    </div>
    <div style="font-size:12px;color:#6b7488;margin-top:20px;padding:12px 16px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;line-height:18px;">
      <strong>Security Notice:</strong> This activation link is single-use, strictly confidential, and should not be shared with anyone.
    </div>
    <p style="font-size:12px;color:#6b7488;line-height:18px;margin:24px 0 0 0;border-top:1px solid #f1f3f7;padding-top:20px;">
      If the button above does not work, copy and paste this link into your browser:<br/>
      <a href="{action_url}" style="color:#6D28D9;word-break:break-all;text-decoration:underline;">{action_url}</a>
    </p>
  </div>
</body>
</html>"""

    return send_email(email, subject, plain_body, html_body=html_body)


def _write_local_outbox(
    email: str,
    otp: str,
    tenant_name: str,
    *,
    purpose: str,
    action_url: str | None,
) -> EmailDeliveryResult:
    event = {
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "to": email,
        "tenant_name": tenant_name,
        "purpose": purpose,
        "otp": otp,
        "action_url": action_url,
    }
    return _write_local_outbox_event(event)


def _write_local_email(
    email: str, subject: str, body: str, html_body: str | None = None
) -> EmailDeliveryResult:
    event: dict[str, str | None] = {
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "to": email,
        "subject": subject,
        "body": body,
    }
    if html_body:
        event["html"] = html_body
    return _write_local_outbox_event(event)


def _write_local_outbox_event(event: dict[str, str | None]) -> EmailDeliveryResult:
    outbox_path = Path(
        os.getenv("AUTHCLAW_EMAIL_OUTBOX_PATH", ".authclaw/email-outbox.jsonl")
    )
    outbox_path.parent.mkdir(parents=True, exist_ok=True)
    with outbox_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, sort_keys=True) + "\n")
    return EmailDeliveryResult(method="local_outbox", detail=str(outbox_path))


def read_local_outbox() -> list[dict]:
    outbox_path = Path(
        os.getenv("AUTHCLAW_EMAIL_OUTBOX_PATH", ".authclaw/email-outbox.jsonl")
    )
    if not outbox_path.exists():
        return []
    with outbox_path.open("r", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def clear_local_outbox() -> None:
    outbox_path = Path(
        os.getenv("AUTHCLAW_EMAIL_OUTBOX_PATH", ".authclaw/email-outbox.jsonl")
    )
    if outbox_path.exists():
        try:
            outbox_path.unlink()
        except OSError:
            pass

