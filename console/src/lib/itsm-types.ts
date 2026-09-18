export type IncidentImpact = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IncidentUrgency = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IncidentPriority = "P1" | "P2" | "P3" | "P4";
export type IncidentStatus =
  | "NEW"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "PENDING"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED";

export interface Incident {
  id: string;
  tenant_id: string;
  ticket_number: string;
  ticket_type: string;
  title: string;
  description: string;
  impact: IncidentImpact;
  urgency: IncidentUrgency;
  priority: IncidentPriority;
  status: IncidentStatus;
  status_reason?: string | null;
  source_channel: string;
  requester_id: string;
  assignee_id?: string | null;
  assignee_email?: string | null;
  assignment_group?: string | null;
  service_id?: string | null;
  service_name?: string | null;
  configuration_item_id?: string | null;
  category_id?: string | null;
  category: string;
  subcategory?: string | null;
  is_major_incident: boolean;
  sla_policy_id?: string | null;
  sla_response_due_at?: string | null;
  sla_response_met_at?: string | null;
  sla_resolution_due_at?: string | null;
  sla_resolution_met_at?: string | null;
  sla_status: string;
  resolution_code?: string | null;
  resolution_summary?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentActivity {
  id: string;
  tenant_id: string;
  ticket_id: string;
  actor_type: string;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  activity_type: string;
  content?: string | null;
  metadata?: Record<string, unknown>;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  is_internal: boolean;
  created_at: string;
}

export interface IncidentCreatePayload {
  title: string;
  description: string;
  impact?: string;
  urgency?: string;
  priority?: string;
  priority_override_reason?: string;
  service_id?: string | null;
  configuration_item_id?: string | null;
  category_id?: string | null;
  category?: string;
  subcategory?: string | null;
  assignee_id?: string | null;
  assignment_group?: string | null;
  is_major_incident?: boolean;
  source_channel?: string;
}

export interface IncidentUpdatePayload {
  title?: string;
  description?: string;
  impact?: string;
  urgency?: string;
  priority?: string;
  priority_override_reason?: string;
  service_id?: string | null;
  configuration_item_id?: string | null;
  category_id?: string | null;
  category?: string;
  subcategory?: string | null;
  assignee_id?: string | null;
  assignment_group?: string | null;
  is_major_incident?: boolean;
}

export interface IncidentStatusUpdatePayload {
  status: string;
  status_reason?: string | null;
  resolution_code?: string | null;
  resolution_summary?: string | null;
}

export interface IncidentAssignPayload {
  assignee_id?: string | null;
  assignment_group?: string | null;
}

export interface IncidentActivityCreatePayload {
  content: string;
  activity_type?: string;
  is_internal?: boolean;
}

export interface TenantUser {
  id: string;
  email: string;
  role?: string;
  is_active?: boolean;
}

export interface IncidentSavedViewFilters {
  search?: string;
  status?: string;
  priority?: string;
  attention?: "WATCH" | "PRIORITY" | "SLA_AT_RISK" | "SLA_BREACHED" | "STUCK";
  assignment_group?: string;
  assignee_id?: string;
  unassigned?: boolean;
  sort_by?: "priority" | "sla_due" | "updated";
}

export interface IncidentSavedView {
  id: string;
  name: string;
  filters: IncidentSavedViewFilters;
  created_at: string;
  updated_at: string;
}

export interface IncidentReferenceItem {
  id: string;
  name: string;
  code?: string | null;
  parent_id?: string | null;
  service_id?: string | null;
  status?: string | null;
}

export interface IncidentOperationsReferenceData {
  users: TenantUser[];
  commanders?: TenantUser[];
  teams: IncidentReferenceItem[];
  services: IncidentReferenceItem[];
  configuration_items: IncidentReferenceItem[];
  categories: IncidentReferenceItem[];
}

export type IncidentSlaEvaluationStatus =
  | "NO_SLA"
  | "WITHIN_SLA"
  | "AT_RISK"
  | "BREACHED";

export interface IncidentOperationsItem {
  incident_id: string;
  ticket_number: string;
  title: string;
  priority: IncidentPriority;
  status: IncidentStatus;
  assignment_group?: string | null;
  assignee_id?: string | null;
  assignee_email?: string | null;
  last_activity_at?: string | null;
  idle_seconds?: number | null;
  sla: {
    status: IncidentSlaEvaluationStatus;
    remaining_seconds?: number | null;
  };
  attention_reasons: Array<"HIGH_PRIORITY" | "SLA_AT_RISK" | "SLA_BREACHED" | "STUCK_IDLE">;
  watch: "REQUIRES_ATTENTION" | "NONE";
}

export interface IncidentOperationsDashboard {
  summary: {
    open_incidents: number;
    p1_p2: number;
    sla_at_risk: number;
    sla_breached: number;
    stuck: number;
    escalation_watch: number;
  };
  priority_watch: IncidentOperationsItem[];
  sla_at_risk: IncidentOperationsItem[];
  sla_breached: IncidentOperationsItem[];
  stuck: IncidentOperationsItem[];
  escalation_watch: IncidentOperationsItem[];
  workload: {
    by_assignment_group: Record<string, number>;
    by_assignee: Record<string, number>;
    assignment_groups: IncidentWorkloadEntry[];
    assignees: IncidentWorkloadEntry[];
  };
  policy: {
    risk_remaining_fraction: number;
    idle_threshold_seconds: number;
    escalation_note: string;
  };
}

export interface IncidentOperationsQueueItem {
  incident: Incident;
  operations?: IncidentOperationsItem | null;
}

export interface IncidentOperationsQueue {
  items: IncidentOperationsQueueItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface IncidentWorkloadEntry {
  key: string;
  label: string;
  open_incidents: number;
  p1_p2: number;
  sla_at_risk: number;
  sla_breached: number;
  stuck: number;
}

export interface MajorIncident {
  id: string;
  tenant_id: string;
  ticket_id: string;
  incident_commander_id?: string | null;
  communication_lead_id?: string | null;
  bridge_url?: string | null;
  communication_channel?: string | null;
  declared_at: string;
  declared_by_id: string;
  postmortem_status: string;
  postmortem_url?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  executive_summary?: string | null;
  impacted_business_units: string[];
  affected_service_ids: string[];
  affected_configuration_item_ids: string[];
  customer_impact_description?: string | null;
  restoration_checkpoints: MajorIncidentRestorationCheckpoint[];
  command_decisions: MajorIncidentDecision[];
  command_tasks: MajorIncidentTask[];
  stakeholders: MajorIncidentStakeholder[];
  command_communications: MajorIncidentCommunication[];
  created_at: string;
  updated_at: string;
}

export interface MajorIncidentPayload {
  incident_commander_id?: string | null;
  communication_lead_id?: string | null;
  bridge_url?: string | null;
  communication_channel?: string | null;
  impacted_business_units?: string[];
  affected_service_ids?: string[];
  affected_configuration_item_ids?: string[];
  customer_impact_description?: string | null;
  executive_summary?: string | null;
  restoration_checkpoints?: MajorIncidentRestorationCheckpoint[];
  command_decisions?: MajorIncidentDecision[];
  command_tasks?: MajorIncidentTask[];
  stakeholders?: MajorIncidentStakeholder[];
  command_communications?: MajorIncidentCommunication[];
  postmortem_status?: string;
  postmortem_url?: string | null;
}

export interface MajorIncidentRestorationCheckpoint {
  id?: string;
  title: string;
  owner_id?: string | null;
  target_at?: string | null;
  completed_at?: string | null;
  note?: string | null;
}

export interface MajorIncidentDecision {
  id?: string;
  summary: string;
  owner_id?: string | null;
  context?: string | null;
  recorded_at?: string;
}

export interface MajorIncidentTask {
  id?: string;
  title: string;
  owner_id?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  note?: string | null;
}

export interface MajorIncidentStakeholder {
  id?: string;
  name: string;
  role?: string | null;
  contact?: string | null;
}

export interface MajorIncidentCommunication {
  id?: string;
  audience: string;
  channel: string;
  message: string;
  approver_id?: string | null;
  status: "DRAFT" | "APPROVED" | "COMMUNICATED";
  recorded_at?: string;
}

export interface ServiceRequestDetailData {
  catalog_item_id?: string | null;
  catalog_item_name?: string | null;
  catalog_item_version?: number | null;
  intake_schema_snapshot?: Record<string, unknown>;
  submitted_form_data?: Record<string, unknown>;
}

export interface ServiceRequest {
  id: string;
  tenant_id: string;
  ticket_number: string;
  ticket_type: "SERVICE_REQUEST";
  title: string;
  description: string;
  impact?: string;
  urgency?: string;
  priority: string;
  status: string;
  status_reason?: string | null;
  source_channel?: string;
  requester_id: string;
  requester_email?: string | null;
  assignee_id?: string | null;
  assignee_email?: string | null;
  assignment_group?: string | null;
  service_id?: string | null;
  service_name?: string | null;
  category?: string;
  sla_status?: string;
  sla_response_due_at?: string | null;
  sla_response_met_at?: string | null;
  sla_resolution_due_at?: string | null;
  sla_resolution_met_at?: string | null;
  resolution_code?: string | null;
  resolution_summary?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  request_detail?: ServiceRequestDetailData | null;
}

export interface ITSMServiceCIData {
  id: string;
  name: string;
  ci_type: string;
  environment: string;
  status: string;
  attributes?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ITSMServiceTicketSummary {
  id: string;
  ticket_number: string;
  title: string;
  priority: string;
  status: string;
  ticket_type: string;
  created_at: string;
}

export interface ITSMServiceSummary {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  tier: string;
  status: string;
  escalation_team?: string | null;
  owner_user_id?: string | null;
  owner_email?: string | null;
  ci_count: number;
  active_ticket_count: number;
  created_at: string;
  updated_at: string;
}

export interface ITSMServiceDetail extends ITSMServiceSummary {
  configuration_items: ITSMServiceCIData[];
  recent_incidents: ITSMServiceTicketSummary[];
  recent_requests: ITSMServiceTicketSummary[];
}
