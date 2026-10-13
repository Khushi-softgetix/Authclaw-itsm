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
