"use client";

import React, { useState } from "react";
import { Lock, MessageSquare, Send, Shield, User } from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { IncidentActivity, TenantUser } from "@/lib/itsm-types";
import { activityActor, activityContent, activityLabel, latestActivities } from "@/lib/incident-activity-presentation";

interface ActivityTimelineProps {
  incidentId: string;
  activities: IncidentActivity[];
  onActivityAdded: () => void;
  oversight?: boolean;
  users?: TenantUser[];
}

export default function ActivityTimeline({
  incidentId,
  activities,
  onActivityAdded,
  oversight = false,
  users = [],
}: ActivityTimelineProps) {
  const [content, setContent] = useState<string>("");
  const [activityType, setActivityType] = useState<string>("COMMENT");
  const [isInternal, setIsInternal] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        content: content.trim(),
        activity_type: activityType,
        is_internal: isInternal,
      };

      const res = await fetch(`/api/itsm/incidents/${incidentId}/activities`, jsonRequest("POST", payload));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to post comment"));
      }

      setContent("");
      onActivityAdded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to post activity update");
    } finally {
      setSubmitting(false);
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "CREATED":
        return <Shield className="w-3.5 h-3.5 text-blue-500" />;
      case "STATUS_CHANGE":
        return <span className="w-2 h-2 rounded-full bg-amber-500" />;
      case "ASSIGNMENT_CHANGE":
        return <User className="w-3.5 h-3.5 text-purple-500" />;
      case "NOTE":
      case "COMMENT":
      default:
        return <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />;
    }
  };

  return (
    <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
        <h3 className="text-sm font-bold text-[#0E1726]">{oversight ? "Activity & Updates" : "Activity Stream & Notes"}</h3>
        <span className="text-xs text-[#6B7488]">{activities.length} updates{oversight ? " · Latest first" : " recorded"}</span>
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} className={oversight ? "space-y-2" : "space-y-3 bg-[#F5F7FA] p-4 rounded-xl border border-[#E6E9F0]"}>
        {oversight ? <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-[#475069]" htmlFor={`update-audience-${incidentId}`}>Update visibility</label>
          <select id={`update-audience-${incidentId}`} value={isInternal ? "INTERNAL" : "PUBLIC"}
            onChange={event => { const internal = event.target.value === "INTERNAL"; setIsInternal(internal); setActivityType(internal ? "NOTE" : "COMMENT"); }}
            className="rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs text-[#0E1726] focus:ring-2 focus:ring-[#6D28D9]">
            <option value="PUBLIC">Public comment — requester visible</option>
            <option value="INTERNAL">Internal note — team only</option>
          </select>
        </div> : <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <select
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
              className="bg-white border border-[#E6E9F0] rounded-lg px-2.5 py-1 text-xs text-[#0E1726] focus:outline-none"
            >
              <option value="COMMENT">Public Comment</option>
              <option value="NOTE">Work Note</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-[#475069] cursor-pointer ml-2">
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[#E6E9F0] text-[#6D28D9] focus:ring-[#6D28D9]"
              />
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3 text-[#6B7488]" /> Internal note
              </span>
            </label>
          </div>
          {isInternal && (
            <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded font-medium">
              Internal Only
            </span>
          )}
        </div>}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="Incident update"
          placeholder={oversight ? (isInternal ? "Add a team note…" : "Add a requester update…") :
            isInternal
              ? "Add an internal investigation note, diagnostic finding, or handoff note..."
              : "Post an update or response for the requester..."
          }
          rows={oversight ? 2 : 3}
          className="w-full bg-white border border-[#E6E9F0] rounded-lg p-2.5 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
          required
        />

        {error && <div role="alert" className={oversight ? "text-xs text-[#5B21B6]" : "text-xs text-red-600"}>{error}</div>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50"
          >
            <Send className="w-3 h-3" />
            {submitting ? "Posting..." : "Post Update"}
          </button>
        </div>
      </form>

      {/* Timeline entries */}
      <div className="space-y-4">
        {activities.length === 0 ? (
          <p className="text-xs text-[#6B7488] text-center py-6">No activity records found.</p>
        ) : (
          <div className="relative pl-6 border-l-2 border-[#E6E9F0] ml-3 space-y-6">
            {(oversight ? latestActivities(activities) : activities).map((act) => (
              <div key={act.id} className="relative group">
                <div className="absolute -left-[31px] top-0.5 w-6 h-6 rounded-full bg-white border border-[#E6E9F0] shadow-sm flex items-center justify-center">
                  {oversight ? <MessageSquare className="h-3.5 w-3.5 text-[#6D28D9]"/> : getActivityIcon(act.activity_type)}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-[#0E1726]">
                      {oversight ? activityActor(act, users) : act.actor_id ? "Team Member" : "System Automation"}
                    </span>
                    <span className="text-[10px] font-mono text-[#6B7488] bg-[#F5F7FA] px-1.5 py-0.5 rounded border border-[#E6E9F0]">
                      {oversight ? activityLabel(act.activity_type) : act.activity_type}
                    </span>
                    {act.is_internal && (
                      <span className={`inline-flex items-center gap-1 text-[10px] border px-1.5 py-0.5 rounded font-medium ${oversight ? "bg-[#F1ECFE] text-[#5B21B6] border-[#DDD6FE]" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                        <Lock className="w-2.5 h-2.5" /> Internal
                      </span>
                    )}
                    <span className="text-[11px] text-[#A8B0C0] ml-auto">
                      {formatDateTime(act.created_at)}
                    </span>
                  </div>

                  {act.content && (
                    <p className={oversight && !["COMMENT", "NOTE"].includes(act.activity_type) ? "break-words text-sm text-[#475069] leading-relaxed whitespace-pre-wrap" : "break-words text-xs text-[#475069] leading-relaxed bg-[#FBFAF9] p-3 rounded-lg border border-[#E6E9F0] whitespace-pre-wrap"}>
                      {oversight ? activityContent(act, users) : act.content}
                    </p>
                  )}

                  {/* Transition diff pill if available */}
                  {act.metadata && Boolean(act.metadata.old_status || act.metadata.new_status) && (
                    <div className="text-[11px] text-[#6B7488] flex items-center gap-1.5 pt-1">
                      <span className="font-medium text-[#475069]">{String(act.metadata.old_status)}</span>
                      <span>&rarr;</span>
                      <span className="font-semibold text-[#0E1726]">{String(act.metadata.new_status)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
