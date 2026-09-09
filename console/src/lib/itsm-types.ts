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
  assignment_group?: string | null;
  service_id?: string | null;
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
  activity_type: string;
  content?: string | null;
  metadata?: Record<string, unknown>;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  is_internal: boolean;
  created_at: string;
}

export interface MajorIncident {
  id: string;
  tenant_id: string;
  ticket_id: string;
  incident_commander_id?: string | null;
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
  customer_impact_description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MajorIncidentPayload {
  incident_commander_id?: string | null;
  bridge_url?: string | null;
  communication_channel?: string | null;
  impacted_business_units?: string[];
  customer_impact_description?: string | null;
  executive_summary?: string | null;
  postmortem_status?: string | null;
  postmortem_url?: string | null;
}

export interface IncidentCreatePayload {
  title: string;
  description: string;
  impact?: string;
  urgency?: string;
  priority?: string;
  service_id?: string | null;
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
  service_id?: string | null;
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
