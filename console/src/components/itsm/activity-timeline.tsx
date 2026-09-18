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
  apiEndpoint?: string;
}

export default function ActivityTimeline({
  incidentId,
  activities,
  onActivityAdded,
  oversight = false,
  users = [],
  apiEndpoint,
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

      const endpoint = apiEndpoint || `/api/itsm/incidents/${incidentId}/activities`;
      const res = await fetch(endpoint, jsonRequest("POST", payload));
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
        return <Lock className="w-3.5 h-3.5 text-amber-600" />;
      case "COMMENT":
      default:
        return <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />;
    }
  };

  const formatActor = (act: IncidentActivity) => {
    if (oversight && users.length > 0) {
      return activityActor(act, users);
    }
    if (act.actor_name) {
      return act.actor_email && act.actor_name !== act.actor_email
        ? `${act.actor_name} (${act.actor_email})`
        : act.actor_name;
    }
    if (act.actor_email) return act.actor_email;
    if (act.actor_id) return "Support Agent";
    return "System Automation";
  };

  const setVisibility = (internal: boolean) => {
    // Update visibility
    setIsInternal(internal);
    setActivityType(internal ? "NOTE" : "COMMENT");
  };

  return (
    <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-6" id="activity-timeline-container">
      <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
        <div>
          <h3 className="text-sm font-bold text-[#0E1726]">{oversight ? "Activity & Updates" : "Activity & Collaboration"}</h3>
          <p className="text-[11px] text-[#6B7488]">Audit trail, status updates, and discussion stream</p>
        </div>
        <span className="text-xs font-mono text-[#6B7488] bg-[#F5F7FA] px-2 py-0.5 rounded-full border border-[#E6E9F0]">
          {activities.length} {activities.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className={`space-y-3 p-4 rounded-xl border transition-colors ${
          isInternal ? "bg-amber-50/40 border-amber-200" : "bg-[#F8FAFC] border-[#E6E9F0]"
        }`}
        id="activity-composer-form"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-[#E6E9F0]/60">
          <div className="flex items-center gap-1.5 p-0.5 bg-white rounded-lg border border-[#E6E9F0] shadow-2xs" aria-label="Update visibility">
            <button
              type="button"
              onClick={() => setVisibility(false)}
              id="composer-public-tab"
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${
                !isInternal
                  ? "bg-[#6D28D9] text-white shadow-xs"
                  : "text-[#6B7488] hover:text-[#0E1726]"
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              Public Comment
            </button>
            <button
              type="button"
              onClick={() => setVisibility(true)}
              id="composer-internal-tab"
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${
                isInternal
                  ? "bg-amber-600 text-white shadow-xs"
                  : "text-[#6B7488] hover:text-[#0E1726]"
              }`}
            >
              <Lock className="w-3 h-3" />
              Internal Note
            </button>
          </div>

          <div className="text-[11px] font-medium">
            {isInternal ? (
              <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-100/70 border border-amber-300 px-2 py-0.5 rounded-full">
                <Lock className="w-2.5 h-2.5" /> Visible to IT staff only · Never exposed to Requester
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                <MessageSquare className="w-2.5 h-2.5" /> Visible to Requester and Support Team
              </span>
            )}
          </div>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="Incident activity content"
          id="activity-content-input"
          placeholder={
            isInternal
              ? "Add an internal investigation note, diagnosis finding, or handoff note (hidden from requester)..."
              : "Post an update or reply visible to the incident requester..."
          }
          rows={3}
          className="w-full bg-white border border-[#E6E9F0] rounded-lg p-3 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none transition resize-y"
          required
        />

        {error && (
          <div
            role="alert"
            className="flex items-center justify-between p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
            id="activity-composer-error"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-800 text-[11px] underline ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-[#8C95A6]">
            {isInternal ? "Protected internal note" : "Public customer communication"}
          </span>
          <button
            type="submit"
            disabled={submitting || !content.trim()}
            id="submit-activity-button"
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition shadow-sm disabled:opacity-50 ${
              isInternal ? "bg-amber-600 hover:bg-amber-700" : "bg-[#6D28D9] hover:bg-[#5B21B6]"
            }`}
          >
            <Send className="w-3 h-3" />
            {submitting ? "Posting..." : isInternal ? "Save Internal Note" : "Post Public Comment"}
          </button>
        </div>
      </form>

      {/* Timeline entries */}
      <div className="space-y-4" id="activity-stream">
        {activities.length === 0 ? (
          <div className="text-center py-8 bg-[#FBFBFC] rounded-xl border border-dashed border-[#E6E9F0]">
            <p className="text-xs text-[#6B7488]">No activity records found.</p>
          </div>
        ) : (
          <div className="relative pl-6 border-l-2 border-[#E6E9F0] ml-3 space-y-5">
            {(oversight ? latestActivities(activities) : activities).map((act) => (
              <div key={act.id} className="relative group" id={`activity-entry-${act.id}`}>
                <div className="absolute -left-[31px] top-0.5 w-6 h-6 rounded-full bg-white border border-[#E6E9F0] shadow-2xs flex items-center justify-center">
                  {oversight ? <MessageSquare className="h-3.5 w-3.5 text-[#6D28D9]"/> : getActivityIcon(act.activity_type)}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-[#0E1726]">
                      {formatActor(act)}
                    </span>
                    <span className="text-[10px] font-mono text-[#6B7488] bg-[#F5F7FA] px-2 py-0.5 rounded-md border border-[#E6E9F0]">
                      {oversight ? activityLabel(act.activity_type) : act.activity_type.replace(/_/g, " ")}
                    </span>
                    {act.is_internal ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full">
                        <Lock className="w-2.5 h-2.5" /> Internal Note
                      </span>
                    ) : act.activity_type === "COMMENT" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                        Public Comment
                      </span>
                    ) : null}
                    <span className="text-[11px] text-[#A8B0C0] ml-auto">
                      {formatDateTime(act.created_at)}
                    </span>
                  </div>

                  {act.content && (
                    <p
                      className={
                        act.is_internal
                          ? "break-words text-xs text-[#0E1726] leading-relaxed bg-amber-50/40 p-3.5 rounded-xl border border-amber-200 whitespace-pre-wrap"
                          : oversight && !["COMMENT", "NOTE"].includes(act.activity_type)
                          ? "break-words text-sm text-[#475069] leading-relaxed whitespace-pre-wrap"
                          : "break-words text-xs text-[#475069] leading-relaxed bg-[#FBFAF9] p-3.5 rounded-xl border border-[#E6E9F0] whitespace-pre-wrap"
                      }
                    >
                      {oversight ? activityContent(act, users) : act.content}
                    </p>
                  )}

                  {/* Transition diff pill if available */}
                  {Boolean(
                    (act.old_value?.status && act.new_value?.status) ||
                    (act.metadata?.old_status && act.metadata?.new_status)
                  ) && (
                    <div className="text-[11px] text-[#6B7488] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#F5F7FA] border border-[#E6E9F0]">
                      <span className="font-mono text-[#475069]">{String(act.old_value?.status || act.metadata?.old_status)}</span>
                      <span>&rarr;</span>
                      <span className="font-mono font-semibold text-[#0E1726]">{String(act.new_value?.status || act.metadata?.new_status)}</span>
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
