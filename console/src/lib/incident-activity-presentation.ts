import type { IncidentActivity, TenantUser } from "./itsm-types";

export function latestActivities(activities: IncidentActivity[]): IncidentActivity[] {
  return [...activities].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function activityActor(activity: IncidentActivity, users: TenantUser[]): string {
  if (!activity.actor_id) return "System";
  return users.find(user => user.id === activity.actor_id)?.email || "Recorded user (name unavailable)";
}

export function activityContent(activity: IncidentActivity, users: TenantUser[]): string {
  // Never rewrite a user's comment or investigation evidence.
  if (["COMMENT", "NOTE"].includes(activity.activity_type)) return activity.content || "";
  if (activity.activity_type === "ASSIGNMENT_CHANGE" && activity.new_value &&
      ("assignee_id" in activity.new_value || "assignment_group" in activity.new_value)) {
    const assignee = activity.new_value.assignee_id;
    const team = activity.new_value.assignment_group;
    const owner = assignee ? users.find(user => user.id === assignee)?.email || "Assigned engineer (name unavailable)" : "No engineer assigned";
    return `${owner} · ${typeof team === "string" && team ? `Team: ${team}` : "No assignment group selected"}`;
  }
  return (activity.content || "").replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    id => users.find(user => user.id.toLowerCase() === id.toLowerCase())?.email || "record (name unavailable)",
  ).replace(/group 'None'/g, "no assignment group");
}

export function activityLabel(type: string): string {
  return type.toLowerCase().replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
}
