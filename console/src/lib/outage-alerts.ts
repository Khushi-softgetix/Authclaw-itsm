export type AlertSummary = {
  id: string;
  alert_number: string;
  title?: string | null;
  alert_type?: string | null;
  severity?: string | null;
  intent?: string | null;
  status: string;
  public_status?: string | null;
  affected_services: Array<{ id: string; name: string }>;
  updated_at: string;
  published_at?: string | null;
  latest_publication_at?: string | null;
  recovered_at?: string | null;
};

export type AlertEvidenceSummary = AlertSummary & {
  created_by_id: string;
  created_by_display?: string | null;
  created_at: string;
  published_by_id?: string | null;
  published_by_display?: string | null;
  intended_audiences: string[];
  publication_count: number;
  recipient_count: number;
  delivery_summary: Record<string, number>;
  broadcast_outcome: string;
  audit_event_count: number;
  evidence_status: string;
};

export type AlertEvidencePage = {
  items: AlertEvidenceSummary[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
};

export type AlertDeliveryHealthSummary = AlertSummary & {
  publication_count: number;
  recipient_count: number;
  delivery_summary: Record<string, number>;
  channels: string[];
  failed_recipient_count: number;
  retrying_recipient_count: number;
  delivery_health_status: "HEALTHY" | "RETRYING" | "FAILED" | "IDLE" | string;
  last_error?: string | null;
};

export type AlertDeliveryHealthMetrics = {
  total_broadcasts: number;
  active_broadcasts: number;
  total_recipients: number;
  total_delivered: number;
  total_retrying: number;
  total_failed: number;
};

export type NotificationChannelInfo = {
  channel: string;
  status: string;
  name: string;
  description: string;
};

export type AlertDeliveryHealthPage = {
  items: AlertDeliveryHealthSummary[];
  total: number;
  metrics: AlertDeliveryHealthMetrics;
  channels: NotificationChannelInfo[];
  offset: number;
  limit: number;
  has_more: boolean;
};

export type AlertDetail = {
  id: string;
  alert_number: string;
  status: string;
  projection_type: string;
  content: Record<string, unknown>;
  allowed_actions: string[];
  affected_services: Array<{ id: string; name: string }>;
  links: Array<{ type: string; id: string }>;
  publications: Array<Record<string, unknown>>;
  delivery_summary?: Record<string, number> | null;
  delivery_health?: {
    summary?: Record<string, number>;
    total_recipients?: number;
    channels?: Array<{ channel: string; status: string; name?: string }>;
    recent_errors?: Array<{ version?: number; attempt_count?: number; error?: string; status?: string }>;
    publications_diagnostics?: Array<Record<string, unknown>>;
  } | null;
  evidence?: {
    summary?: { status?: string; checks?: Record<string, string> };
    creator_display?: string | null;
    updated_by_display?: string | null;
    audit_events?: Array<Record<string, unknown>>;
    authorization?: { status?: string; explanation?: string };
    recipient_identities_exposed?: boolean;
  } | null;
};

export type AlertReferenceData = {
  services: Array<{ id: string; name: string; status: string }>;
  configuration_items: Array<{ id: string; name: string; service_id?: string | null; status: string }>;
  teams: Array<{ id: string; name: string }>;
  related_records: Array<{ id: string; type: string; number: string; title: string }>;
  supported_channels: string[];
};

export type AlertReferenceOption = {
  value: string;
  label: string;
  meta: string;
};

export type AlertReferenceOptionPage = {
  items: AlertReferenceOption[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
};

export type AlertRecipientEvidenceItem = {
  user_id: string;
  email: string;
  role: string;
  projection_type: string;
  audience_memberships: Array<{ audience_type: string; reason: string }>;
  inclusion_reason: string;
  projection_fields: string[];
  allowed_actions: string[];
  channels: string[];
  delivery_status?: string | null;
  available_at?: string | null;
  read_at?: string | null;
  acknowledged_at?: string | null;
};

export type AlertRecipientEvidencePage = {
  source: "LIVE_PREVIEW" | "PUBLICATION_SNAPSHOT";
  publication_id?: string | null;
  publication_version?: number | null;
  items: AlertRecipientEvidenceItem[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
};

export async function alertApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/itsm/outage-alerts${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers || {}) } : init?.headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = typeof data.detail === "string"
      ? data.detail
      : typeof data.error === "string"
        ? data.error
        : "Unable to complete this alert action";
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function formatAlertDate(value?: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function formatPublicStatus(value?: unknown) {
  const status = String(value || "").trim().toUpperCase();
  if (!status) return "Status unavailable";
  return status.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function getAlertIncidentLinks(links?: Array<{ type: string; id: string }> | null): Array<{ type: string; id: string }> {
  return (links || []).filter((link) => link.type === "INCIDENT" || link.type === "MAJOR_INCIDENT");
}

export function getPrimaryIncidentLink(links?: Array<{ type: string; id: string }> | null): { type: string; id: string } | null {
  const incidentLinks = getAlertIncidentLinks(links);
  return incidentLinks.find((link) => link.type === "INCIDENT") || incidentLinks[0] || null;
}

export function canOpenLinkedIncident(alert?: Pick<AlertDetail, "allowed_actions" | "links"> | null): boolean {
  if (!alert || !Array.isArray(alert.allowed_actions) || !alert.allowed_actions.includes("OPEN_LINKED_INCIDENT")) {
    return false;
  }
  return Boolean(getPrimaryIncidentLink(alert.links));
}

export function getAlertProcessLinks(links?: Array<{ type: string; id: string }> | null): Array<{ type: string; id: string }> {
  return (links || []).filter((link) => link.type === "PROBLEM" || link.type === "CHANGE");
}

export function getProcessLinkHref(link?: { type: string; id: string } | null): string | null {
  if (!link || !link.id) return null;
  if (link.type === "PROBLEM") {
    return `/itsm/problem-change-manager/problems/${link.id}`;
  }
  if (link.type === "CHANGE") {
    return `/itsm/problem-change-manager/changes/${link.id}`;
  }
  return null;
}
