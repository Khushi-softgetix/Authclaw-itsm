"use client";

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle, ChevronDown, Clock, Lock, MessageSquare, Send, Shield, User, Zap } from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { IncidentActivity, ITSMProductivityMacro, TenantUser } from "@/lib/itsm-types";
import { activityActor, activityContent, activityLabel, latestActivities } from "@/lib/incident-activity-presentation";

interface ActivityTimelineProps {
  incidentId: string;
  activities: IncidentActivity[];
  onActivityAdded: () => void;
  oversight?: boolean;
  embedded?: boolean;
  users?: TenantUser[];
  apiEndpoint?: string;
  ticketType?: "INCIDENT" | "SERVICE_REQUEST";
}

export default function ActivityTimeline({
  incidentId,
  activities,
  onActivityAdded,
  oversight = false,
  embedded = false,
  users = [],
  apiEndpoint,
  ticketType,
}: ActivityTimelineProps) {
  const [content, setContent] = useState<string>("");
  const [activityType, setActivityType] = useState<string>("COMMENT");
  const [isInternal, setIsInternal] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedTicketType =
    ticketType || (apiEndpoint && apiEndpoint.includes("/requests/") ? "SERVICE_REQUEST" : "INCIDENT");

  const [macros, setMacros] = useState<ITSMProductivityMacro[]>([]);
  const [macrosOpen, setMacrosOpen] = useState<boolean>(false);
  const [applyingMacro, setApplyingMacro] = useState<boolean>(false);
  const [appliedMacroBanner, setAppliedMacroBanner] = useState<{
    name: string;
    status?: string | null;
    followUp?: number | null;
  } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    fetch(`/api/itsm/macros?ticket_type=${resolvedTicketType}&active_only=true`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return [];
        return res.json();
      })
      .then((data) => {
        if (isMounted && Array.isArray(data)) {
          setMacros(data);
        }
      })
      .catch(() => {
        if (isMounted) setMacros([]);
      });
    return () => {
      isMounted = false;
    };
  }, [resolvedTicketType]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMacrosOpen(false);
      }
    }
    if (macrosOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [macrosOpen]);

  const handleApplyMacro = async (macro: ITSMProductivityMacro) => {
    try {
      setApplyingMacro(true);
      setError(null);
      setMacrosOpen(false);

      // 1. Insert predefined response template into existing comment box
      setContent(macro.response_template);

      // 2. Ensure public comment mode is active so customer communication is selected
      setVisibility(false);

      // 3. Automatically apply supported ticket fields & create follow-up reminder
      const res = await fetch(`/api/itsm/macros/${macro.id}/apply`, jsonRequest("POST", {
        ticket_id: incidentId,
        ticket_type: resolvedTicketType,
      }));

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to apply macro"));
      }

      const result = await res.json();
      setAppliedMacroBanner({
        name: macro.name,
        status: result.new_status || macro.status_change,
        followUp: result.follow_up_hours || macro.follow_up_hours,
      });

      // 4. Reload activities so timeline reflects field changes & reminder note
      onActivityAdded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to execute macro");
    } finally {
      setApplyingMacro(false);
    }
  };

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
      setAppliedMacroBanner(null);
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
    <div className={embedded ? "space-y-6" : "bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-6"} id="activity-timeline-container">
      {!embedded && (
        <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
          <div>
            <h3 className="text-sm font-bold text-[#0E1726]">{oversight ? "Activity & Updates" : "Activity & Collaboration"}</h3>
            <p className="text-[11px] text-[#6B7488]">Audit trail, status updates, and discussion stream</p>
          </div>
          <span className="text-xs font-mono text-[#6B7488] bg-[#F5F7FA] px-2 py-0.5 rounded-full border border-[#E6E9F0]">
            {activities.length} {activities.length === 1 ? "entry" : "entries"}
          </span>
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className={`space-y-3 p-4 rounded-xl border transition-colors ${
          isInternal ? "bg-amber-50/40 border-amber-200" : "bg-[#F8FAFC] border-[#E6E9F0]"
        }`}
        id="activity-composer-form"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-[#E6E9F0]/60">
          <div className="flex items-center gap-2 flex-wrap">
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

            {/* ⚡ Macros / Quick Actions Dropdown */}
            {macros.length > 0 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setMacrosOpen(!macrosOpen)}
                  disabled={applyingMacro}
                  id="composer-macros-button"
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-white border border-[#E6E9F0] text-[#0E1726] hover:bg-purple-50 hover:text-[#6D28D9] hover:border-purple-300 transition shadow-2xs disabled:opacity-50"
                  aria-expanded={macrosOpen}
                  aria-haspopup="true"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                  <span>{applyingMacro ? "Applying..." : "Macros"}</span>
                  <ChevronDown className="w-3 h-3 text-[#6B7488]" />
                </button>

                {macrosOpen && (
                  <div
                    className="absolute left-0 top-full mt-1.5 w-80 bg-white rounded-xl border border-[#E6E9F0] shadow-xl z-50 overflow-hidden divide-y divide-[#E6E9F0]"
                    id="composer-macros-dropdown"
                  >
                    <div className="px-3.5 py-2.5 bg-[#FAFBFD] flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                        <span className="text-[11px] font-bold text-[#0E1726] uppercase tracking-wider">Quick Actions &amp; Macros</span>
                      </div>
                      <span className="text-[10px] text-[#6B7488] font-mono">{macros.length} available</span>
                    </div>

                    <div className="max-h-72 overflow-y-auto divide-y divide-[#F1F3F7]">
                      {macros.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleApplyMacro(m)}
                          className="w-full text-left p-3 hover:bg-[#F8FAFC] transition group block space-y-1"
                          id={`macro-option-${m.slug}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition">
                              {m.name}
                            </span>
                            <span className="text-[9px] font-mono text-[#6D28D9] bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
                              1-Click
                            </span>
                          </div>

                          {m.description && (
                            <p className="text-[11px] text-[#6B7488] line-clamp-1">{m.description}</p>
                          )}

                          <div className="flex items-center gap-2 pt-1 flex-wrap text-[10px]">
                            {m.status_change && (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                Status: {m.status_change.replace(/_/g, " ")}
                              </span>
                            )}
                            {m.follow_up_hours && (
                              <span className="inline-flex items-center gap-1 font-medium text-blue-800 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                                <Clock className="w-2.5 h-2.5" /> Follow-up: {m.follow_up_hours}h
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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

        {/* Macro Applied Confirmation Banner */}
        {appliedMacroBanner && (
          <div
            role="status"
            id="macro-applied-banner"
            className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 animate-in fade-in duration-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <div>
                <span className="font-bold">⚡ Macro Applied:</span> {appliedMacroBanner.name}
                <span className="ml-1 text-[11px] text-emerald-800">
                  {appliedMacroBanner.status && `· Status set to ${appliedMacroBanner.status.replace(/_/g, " ")} `}
                  {appliedMacroBanner.followUp && `· Follow-up reminder set for ${appliedMacroBanner.followUp}h `}
                  — Response template inserted below. You can review or edit it before sending.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAppliedMacroBanner(null)}
              className="text-emerald-700 hover:text-emerald-950 text-sm font-bold ml-2 px-1"
              aria-label="Dismiss banner"
            >
              ×
            </button>
          </div>
        )}

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
