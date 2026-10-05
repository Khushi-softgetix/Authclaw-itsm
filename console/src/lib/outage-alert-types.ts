export type OutageAlertStatus = "DRAFT" | "ACTIVE" | "RECOVERED";
export type OutageAlertPublicationType = "INITIAL" | "UPDATE" | "RECOVERY";

export interface OutageAlertServiceRef {
  id: string;
  name: string;
  slug: string;
}

export interface OutageAlertPublication {
  id: string;
  sequence_number: number;
  publication_type: OutageAlertPublicationType;
  message: string;
  audience_policy_ref?: string | null;
  published_by_id: string;
  correlation_id: string;
  published_at: string;
}

export interface OutageAlertHistory {
  id: string;
  from_state?: string | null;
  to_state: string;
  action: string;
  actor_id?: string | null;
  correlation_id: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export interface OutageAlertLink {
  id: string;
  incident_id?: string | null;
  major_incident_id?: string | null;
  linked_by_id: string;
  correlation_id: string;
  created_at: string;
}

export interface OutageAlertDeliveryAttempt {
  id: string;
  attempt_number: number;
  status: string;
  provider_reference?: string | null;
  error_detail?: string | null;
  correlation_id: string;
  attempted_at: string;
}

export interface OutageAlertDelivery {
  id: string;
  publication_id: string;
  channel_ref?: string | null;
  status: string;
  idempotency_key: string;
  correlation_id: string;
  created_at: string;
  updated_at: string;
  attempts: OutageAlertDeliveryAttempt[];
}

export interface OutageAlertReadiness {
  ready: boolean;
  publication_policy: string;
  delivery: string;
  detail: string;
}

export interface OutageAlertSummary {
  id: string;
  title: string;
  status: OutageAlertStatus;
  affected_services: OutageAlertServiceRef[];
  latest_publication?: OutageAlertPublication | null;
  activated_at?: string | null;
  recovered_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutageAlert extends OutageAlertSummary {
  draft_message: string;
  audience_policy_ref?: string | null;
  created_by_id: string;
  readiness: OutageAlertReadiness;
  links: OutageAlertLink[];
  publications: OutageAlertPublication[];
  state_history: OutageAlertHistory[];
  deliveries: OutageAlertDelivery[];
}

export interface OutageAlertList {
  items: OutageAlert[];
  visibility_note?: string | null;
}

export interface OutageAlertLinkableRecords {
  incidents: Array<{ id: string; ticket_number: string; title: string; status: string }>;
  major_incidents: Array<{ id: string; ticket_id: string; ticket_number: string; title: string; declared_at: string }>;
}
