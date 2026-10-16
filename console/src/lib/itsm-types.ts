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
  linked_problem_id?: string | null;
  linked_problem_ticket_number?: string | null;
  sla_policy_id?: string | null;
  sla_response_due_at?: string | null;
  sla_response_met_at?: string | null;
  sla_resolution_due_at?: string | null;
  sla_resolution_met_at?: string | null;
  sla_status: string;
  sla_paused_at?: string | null;
  sla_accumulated_pause_seconds?: number;
  sla_due_at?: string | null;
  sla_started_at?: string | null;
  sla_remaining_seconds?: number | null;
  sla_warning_escalated_at?: string | null;
  sla_breach_escalated_at?: string | null;
  resolution_code?: string | null;
  resolution_summary?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  version: number;
  approval_status?: "PENDING" | "APPROVED" | "REJECTED" | "NOT_REQUIRED" | string | null;
  approval_required?: boolean;
  rejection_reason?: string | null;
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
  service_id?: string;
  category_id?: string;
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
    unassigned: number;
    active_major_incidents: number;
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

export interface OperationalKPIIncidentRecord {
  id: string;
  ticket_number: string;
  title: string;
  priority: string;
  status: string;
  service_id?: string | null;
  created_at: string;
  measured_at?: string | null;
  duration_seconds?: number | null;
  sla_dimension?: string | null;
  sla_outcome?: string | null;
  age_bucket?: string | null;
}

export interface OperationalSLAAdherence {
  dimension: "RESPONSE" | "RESOLUTION";
  total_with_commitment: number;
  evaluated_count: number;
  met_count: number;
  breached_count: number;
  pending_count: number;
  unavailable_count: number;
  compliance_rate_pct?: number | null;
}

export interface OperationalKPIDashboard {
  date_range: { start_time?: string | null; end_time: string; evaluated_at: string };
  filters: { service_id?: string | null; priority?: string | null; status?: string | null };
  mtta: { count: number; unacknowledged_count: number; total_tickets: number; mean_seconds?: number | null; definition: string };
  mttr: { count: number; mean_seconds?: number | null; definition: string };
  backlog_age: { total_open: number; mean_age_seconds?: number | null; distribution: Record<string, number>; definition: string };
  sla_response: OperationalSLAAdherence;
  sla_resolution: OperationalSLAAdherence;
  drilldowns: Record<string, OperationalKPIIncidentRecord[]>;
  drilldown_limit: number;
}

export interface MetricSnapshot {
  id: string;
  tenant_id: string;
  metric_key: string;
  period_grain: "DAILY" | "WEEKLY" | "MONTHLY";
  period_start: string;
  period_end: string;
  dimensions: { reporting_timezone?: string; week_start?: number; [key: string]: unknown };
  value: Record<string, unknown>;
  definition_version: string;
  source_events: Record<string, unknown>;
  generated_at: string;
}

export interface MetricSnapshotList {
  items: MetricSnapshot[];
  total: number;
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
  sla_paused_at?: string | null;
  sla_accumulated_pause_seconds?: number;
  sla_due_at?: string | null;
  sla_started_at?: string | null;
  sla_remaining_seconds?: number | null;
  resolution_code?: string | null;
  resolution_summary?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  request_detail?: ServiceRequestDetailData | null;
  approval_status?: "PENDING" | "APPROVED" | "REJECTED" | "NOT_REQUIRED" | string | null;
  approval_required?: boolean;
  rejection_reason?: string | null;
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

export interface RelatedIncidentItem {
  id: string;
  ticket_number: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
}

export interface ProblemDetailData {
  known_error: boolean;
  root_cause_summary?: string | null;
  workaround_summary?: string | null;
  permanent_solution?: string | null;
  rca_document_url?: string | null;
  assigned_investigator_id?: string | null;
  identified_at?: string | null;
  resolved_at?: string | null;
}

export interface ProblemSummary {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  service_id?: string | null;
  service_name?: string | null;
  assignment_group?: string | null;
  assignee_id?: string | null;
  assignee_email?: string | null;
  created_at: string;
  updated_at: string;
  related_incidents_count: number;
}

export interface ProblemDetail extends ProblemSummary {
  configuration_item_id?: string | null;
  resolution_summary?: string | null;
  resolution_code?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  closed_by_email?: string | null;
  related_incidents: RelatedIncidentItem[];
  problem_details?: ProblemDetailData | null;
  related_changes?: ChangeSummary[];
}

export interface ProblemStats {
  open: number;
  in_progress: number;
  resolved: number;
  total: number;
}

export interface ProblemInvestigationPayload {
  root_cause_summary?: string | null;
  workaround_summary?: string | null;
  known_error?: boolean;
  permanent_solution?: string | null;
  rca_document_url?: string | null;
  investigation_notes?: string | null;
  status?: string;
}

export interface ProblemResolvePayload {
  resolution_summary: string;
  resolution_notes?: string | null;
  permanent_solution?: string | null;
  workaround_summary?: string | null;
  root_cause_summary?: string | null;
  rca_document_url?: string | null;
}

export interface ProblemClosePayload {
  closure_notes?: string | null;
}

export interface ProblemActivity {
  id: string;
  ticket_id: string;
  activity_type: string;
  actor_id?: string | null;
  actor_email?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ReportRecurringProblemPayload {
  problem_short_description: string;
  recurring_reason: string;
  notes?: string | null;
}

export interface ReportRecurringProblemResponse {
  problem_id: string;
  problem_ticket_number: string;
  already_reported: boolean;
  message: string;
}

export interface ChangeSummary {
  id: string;
  change_number: string;
  title: string;
  description?: string | null;
  status: string;
  change_type?: string | null;
  risk_level?: string | null;
  impact_level?: string | null;
  service_id?: string | null;
  service_name?: string | null;
  assigned_team?: string | null;
  assigned_to_id?: string | null;
  assignee_email?: string | null;
  earliest_start_at?: string | null;
  latest_finish_at?: string | null;
  actual_start_at?: string | null;
  actual_finish_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangeStats {
  total: number;
  open: number;
  in_progress: number;
  scheduled: number;
  completed: number;
}

export interface ChangeAffectedCI {
  id: string;
  ci_id: string;
  name: string;
  ci_type: string;
  environment: string;
  status: string;
  impact_type: string;
  notes?: string | null;
}

export interface ChangeActivityItem {
  id: string;
  actor_id?: string | null;
  actor_email?: string | null;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  message: string;
  created_at: string;
}

export interface RelatedProblemSummary {
  id: string;
  ticket_number: string;
  title: string;
  status: string;
  priority: string;
  known_error?: boolean;
}

export interface ChangeDetail extends ChangeSummary {
  lead_time_hours?: number;
  outage_expected?: boolean;
  implementation_plan?: string | null;
  backout_plan?: string | null;
  test_plan?: string | null;
  affected_cis: ChangeAffectedCI[];
  activities?: ChangeActivityItem[];
  related_problem?: RelatedProblemSummary | null;
}

export interface ChangeAssessmentUpdatePayload {
  risk_level?: string;
  impact_level?: string;
  change_type?: string;
  description?: string;
  implementation_plan?: string;
  backout_plan?: string;
  test_plan?: string;
}

export interface ChangeLifecycleTransitionPayload {
  action: string;
  notes?: string | null;
  earliest_start_at?: string | null;
  latest_finish_at?: string | null;
  validation_notes?: string | null;
  implementation_notes?: string | null;
}

export interface LinkChangePayload {
  change_id: string;
}

export interface UnlinkChangePayload {
  change_id: string;
}

export interface CreateChangeFromProblemPayload {
  title: string;
  description?: string;
  change_type?: string;
  risk_level?: string;
  impact_level?: string;
  service_id?: string | null;
  implementation_plan?: string | null;
  backout_plan?: string | null;
  test_plan?: string | null;
  ci_ids?: string[];
}

export interface KBArticleVersionSummary {
  id: string;
  article_id: string;
  version_number: number;
  title: string;
  summary?: string | null;
  content_markdown: string;
  keywords: string[];
  change_summary?: string | null;
  created_by: string;
  created_by_email?: string | null;
  created_at: string;
}

export interface KBArticleItem {
  id: string;
  title: string;
  slug: string;
  category: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED" | string;
  summary?: string | null;
  current_published_version?: number | null;
  version_number: number;
  view_count: number;
  helpful_count: number;
  author_id?: string | null;
  author_email?: string | null;
  service_id?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at: string;
}

export interface KBArticleGovernanceDetail extends KBArticleItem {
  content_markdown: string;
  keywords: string[];
  versions: KBArticleVersionSummary[];
}

export interface CreateKBArticlePayload {
  title: string;
  category: string;
  content_markdown: string;
  summary?: string | null;
  keywords?: string[];
  service_id?: string | null;
}

export interface UpdateKBArticlePayload {
  title?: string;
  category?: string;
  content_markdown?: string;
  summary?: string | null;
  keywords?: string[];
  change_summary?: string | null;
  service_id?: string | null;
}

export interface ITSMProductivityMacro {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description?: string | null;
  applicable_ticket_type: "INCIDENT" | "SERVICE_REQUEST" | "ALL" | string;
  response_template: string;
  status_change?: string | null;
  status_reason?: string | null;
  priority_change?: string | null;
  follow_up_hours?: number | null;
  is_active: boolean;
  current_published_version?: number;
  created_at: string;
  updated_at: string;
}

export interface MacroApplyResult {
  macro_id: string;
  macro_name: string;
  response_template: string;
  status_changed: boolean;
  new_status?: string | null;
  reminder_created: boolean;
  follow_up_hours?: number | null;
  message: string;
}

export interface SupportScopeTeam {
  id: string;
  name: string;
  description?: string | null;
}

export interface SupportScopeService {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  tier: string;
  status: string;
  escalation_team?: string | null;
}

export interface SupportScopeCatalogItem {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  service_id: string;
  service_name?: string | null;
  fulfillment_group?: string | null;
  estimated_delivery_hours?: number | null;
}

export interface SupportScopeResponse {
  teams: SupportScopeTeam[];
  services: SupportScopeService[];
  catalog_items: SupportScopeCatalogItem[];
}

