"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowLeft, Radio, Tags, UserRoundCog } from "lucide-react";
import AssignModal from "@/components/itsm/assign-modal";
import IncidentClassificationModal from "@/components/itsm/incident-classification-modal";
import StatusModal from "@/components/itsm/status-modal";
import ActivityTimeline from "@/components/itsm/activity-timeline";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import { formatDateTime } from "@/lib/itsm-format";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import type { Incident, IncidentActivity, IncidentOperationsItem, IncidentOperationsReferenceData } from "@/lib/itsm-types";

interface Props {
  incidentId: string;
  operations?: IncidentOperationsItem;
  onClose: () => void;
  onChanged?: () => void;
  backLabel?: string;
}

export default function IncidentOversightDrawer({ incidentId, operations, onClose, onChanged, backLabel = "Back to Overview" }: Props) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [activities, setActivities] = useState<IncidentActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [classificationOpen, setClassificationOpen] = useState(false);
  const [references, setReferences] = useState<IncidentOperationsReferenceData | null>(null);
  const [priority, setPriority] = useState("P3");
  const [priorityReason, setPriorityReason] = useState("");
  const [prioritySaving, setPrioritySaving] = useState(false);
  const attentionReasons = operations?.attention_reasons.filter(reason => reason !== "HIGH_PRIORITY") || [];

  const load = useCallback(async () => {
    setError(null);
    try {
      const [incidentResponse, activityResponse, referenceResponse] = await Promise.all([
        fetch(`/api/itsm/incidents/${encodeURIComponent(incidentId)}`, { cache: "no-store" }),
        fetch(`/api/itsm/incidents/${encodeURIComponent(incidentId)}/activities`, { cache: "no-store" }),
        fetch("/api/itsm/incidents/operations/reference-data", { cache: "no-store" }),
      ]);
      if (!incidentResponse.ok) throw new Error("Unable to load incident details");
      const loaded: Incident = await incidentResponse.json();
      setIncident(loaded);
      setPriority(loaded.priority);
      setActivities(activityResponse.ok ? await activityResponse.json() : []);
      if (referenceResponse.ok) setReferences(await referenceResponse.json());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Unable to load incident details");
    }
  }, [incidentId]);

  useEffect(() => { const request=window.setTimeout(()=>void load(),0); return()=>window.clearTimeout(request); }, [load]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !assignOpen && !statusOpen && !classificationOpen) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, assignOpen, statusOpen, classificationOpen]);
  const changed = (updated: Incident) => { setIncident(updated); void load(); onChanged?.(); };
  const savePriority = async () => {
    if (!incident || priority === incident.priority) return;
    setPrioritySaving(true); setError(null);
    try {
      const response = await fetch(
        `/api/itsm/incidents/${incident.id}`,
        jsonRequest(
          "PATCH",
          { priority, priority_override_reason: priorityReason.trim() || undefined },
          { "If-Match": String(incident.version) },
        ),
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(body, "Unable to update incident priority"));
      setPriorityReason(""); changed(body);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Unable to update priority"); }
    finally { setPrioritySaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Incident details">
      <aside className="relative flex h-full w-full flex-col bg-[#FBFAF9]">
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-[#E6E9F0] bg-white px-5 sm:px-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
            <button onClick={onClose} className="inline-flex items-center gap-2 rounded-lg border border-[#DDD6FE] px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]"><ArrowLeft className="h-4 w-4"/>{backLabel}</button>
            <h2 className="text-sm font-bold text-[#0E1726]">Incident Response</h2>
          </div>
          <span className="hidden text-xs text-[#6B7488] sm:block">Incident Manager</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
          <div className="mx-auto w-full max-w-7xl">
          {error ? <div className="rounded-xl border border-[#DDD6FE] bg-[#F1ECFE] p-4 text-sm text-[#5B21B6]">{error}</div> : !incident ? (
            <div className="space-y-3 animate-pulse"><div className="h-5 w-32 rounded bg-[#E6E9F0]"/><div className="h-9 w-4/5 rounded bg-[#E6E9F0]"/><div className="h-48 rounded-xl bg-white"/></div>
          ) : <div className="space-y-5">
            <section className="min-w-0 rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-sm sm:p-6">
              <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${incident.is_major_incident ? "border-[#A78BFA] bg-[#F1ECFE]" : "border-[#E6E9F0] bg-[#F7F8FA]"}`}>
                <div className="flex flex-wrap items-center gap-3"><Radio className="h-5 w-5 text-[#6D28D9]"/><p className="text-base font-bold text-[#5B21B6]">{incident.is_major_incident ? "Major Incident" : "Normal Incident"}</p><span className="font-mono text-xs font-semibold text-[#6D28D9]">{incident.ticket_number}</span></div>
                <div className="flex flex-wrap gap-2"><IncidentPriorityBadge priority={incident.priority} tone="brand"/><IncidentStatusBadge status={incident.status} tone="brand"/></div>
              </div>
              <p className="text-xs text-[#475069]">Impact {incident.impact.toLowerCase()} · Urgency {incident.urgency.toLowerCase()}</p>
              <h3 className="mt-3 text-2xl font-bold text-[#0E1726]">{incident.title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#475069]">{incident.description}</p>
              {attentionReasons.length ? <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#DDD6FE] bg-[#FAF8FF] px-4 py-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#6D28D9]"/><div><p className="text-sm font-semibold text-[#5B21B6]">Requires review</p><p className="mt-1 text-sm text-[#475069]">{attentionReasons.map(reason => reason === "STUCK_IDLE" && operations?.idle_seconds != null ? `No activity for ${formatIdle(operations.idle_seconds)}` : attentionLabel(reason)).join(" · ")}</p><p className="mt-1 text-xs text-[#6B7488]">Watch information only — not a triggered escalation.</p></div></div> : null}
              <div className="mt-5 flex flex-wrap gap-2">
                {incident.is_major_incident ? <Link href={`/itsm/incident-manager/major-incidents?incident=${encodeURIComponent(incident.id)}`} className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#5B21B6]"><Radio className="h-4 w-4"/>Open Command Workspace</Link> : null}
                <button onClick={() => setAssignOpen(true)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${incident.is_major_incident ? "border-[#DDD6FE] bg-white text-[#5B21B6] hover:bg-[#F1ECFE]" : "border-[#6D28D9] bg-[#6D28D9] text-white hover:bg-[#5B21B6]"}`}><UserRoundCog className="h-3.5 w-3.5"/>Assign / Reassign</button>
                <button onClick={() => setStatusOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]"><Activity className="h-3.5 w-3.5"/>Change status</button>
                {!incident.is_major_incident ? <Link href={`/itsm/incident-manager/major-incidents?incident=${encodeURIComponent(incident.id)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[#DDD6FE] px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]"><Radio className="h-3.5 w-3.5"/>Assess as Major Incident</Link> : null}
              </div>
              <div className="mt-6 grid gap-5 border-t border-[#E6E9F0] pt-5 md:grid-cols-3">
                <div><h4 className="text-sm font-bold text-[#0E1726]">Ownership</h4><dl className="mt-3 space-y-3 text-sm"><div><dt className="text-xs text-[#6B7488]">Responsible engineer</dt><dd className="mt-1 break-words font-semibold">{references?.users.find(user=>user.id===incident.assignee_id)?.email || operations?.assignee_email || (incident.assignee_id ? "Assigned engineer (name unavailable)" : "No engineer assigned")}</dd></div><div><dt className="text-xs text-[#6B7488]">Supporting team</dt><dd className="mt-1 font-semibold">{incident.assignment_group || "No team selected"}</dd></div></dl></div>
                <div><h4 className="text-sm font-bold text-[#0E1726]">SLA Commitments</h4>{!incident.sla_response_due_at && !incident.sla_resolution_due_at ? <p className="mt-3 text-sm text-[#6B7488]">No SLA attached</p> : <><p className="mt-3 text-sm font-semibold text-[#5B21B6]">{(operations?.sla.status || incident.sla_status || "NO_SLA").replaceAll("_", " ")}</p><dl className="mt-3 space-y-3 text-sm">{incident.sla_response_due_at ? <div><dt className="text-xs text-[#6B7488]">Response due</dt><dd className="mt-1">{formatOptionalDate(incident.sla_response_due_at)}</dd></div> : null}{incident.sla_resolution_due_at ? <div><dt className="text-xs text-[#6B7488]">Resolution due</dt><dd className="mt-1">{formatOptionalDate(incident.sla_resolution_due_at)}</dd></div> : null}</dl></>}</div>
                <div><h4 className="text-sm font-bold text-[#0E1726]">Recent Activity</h4><p className="mt-3 text-sm font-semibold">{operations?.idle_seconds != null ? `${formatIdle(operations.idle_seconds)} ago` : formatOptionalDate(operations?.last_activity_at || incident.updated_at)}</p>{operations?.idle_seconds != null ? <p className="mt-1 text-xs text-[#6B7488]">{formatOptionalDate(operations.last_activity_at || incident.updated_at)}</p> : null}{incident.status_reason ? <p className="mt-2 text-sm text-[#475069]">{incident.status_reason.replaceAll("_", " ")}</p> : null}</div>
              </div>
              <details className="mt-6 border-t border-[#E6E9F0] pt-4"><summary className="cursor-pointer text-sm font-semibold text-[#5B21B6]">Classification & Priority</summary>
                <div className="mt-4 flex flex-wrap items-center gap-2"><div className="flex flex-wrap overflow-hidden rounded-lg border border-[#DDD6FE] bg-white"><label className="sr-only" htmlFor="manager-priority">Priority</label><select id="manager-priority" value={priority} onChange={event=>setPriority(event.target.value)} className="bg-white px-3 py-2 text-xs font-semibold">{["P1","P2","P3","P4"].map(value=><option key={value}>{value}</option>)}</select>{priority!==incident.priority ? <input aria-label="Priority override reason" value={priorityReason} onChange={event=>setPriorityReason(event.target.value)} placeholder="Reason for override" className="border-l border-[#DDD6FE] px-3 py-2 text-xs"/> : null}<button type="button" onClick={savePriority} disabled={prioritySaving||priority===incident.priority} className="border-l border-[#DDD6FE] px-3 py-2 text-xs font-semibold text-[#5B21B6] disabled:opacity-40">{prioritySaving?"Saving":"Set priority"}</button></div><button onClick={()=>setClassificationOpen(true)} disabled={!references} className="inline-flex items-center gap-2 rounded-lg border border-[#DDD6FE] px-3 py-2 text-xs font-semibold text-[#5B21B6] disabled:opacity-40"><Tags className="h-4 w-4"/>Classify</button></div>
                <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3"><Detail label="Category" value={referenceName(references?.categories, incident.category_id) || [incident.category, incident.subcategory].filter(Boolean).join(" / ")}/><Detail label="Service" value={referenceName(references?.services, incident.service_id) || "Not classified"}/><Detail label="Configuration item" value={referenceName(references?.configuration_items, incident.configuration_item_id) || "Not classified"}/></div>
              </details>
              <details className="mt-4 border-t border-[#E6E9F0] pt-4"><summary className="cursor-pointer text-sm font-semibold text-[#5B21B6]">Resolution Evidence</summary><div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">{incident.resolution_code || incident.resolution_summary ? <><Detail label="Resolution code" value={incident.resolution_code || "Not recorded"}/><Detail label="Resolution summary" value={incident.resolution_summary || "Not recorded"}/></> : <p className="text-[#6B7488]">No resolution evidence recorded.</p>}</div></details>
            </section>
            <ActivityTimeline incidentId={incident.id} activities={activities} onActivityAdded={load} oversight users={references?.users || []}/>
          </div>}
          </div>
        </div>
      </aside>
      {incident && assignOpen && (
        <AssignModal
          incident={incident}
          referenceEndpoint="/api/itsm/incidents/operations/reference-data"
          onClose={() => setAssignOpen(false)}
          onSuccess={changed}
        />
      )}
      {incident && references && classificationOpen && (
        <IncidentClassificationModal
          incident={incident}
          references={references}
          onClose={() => setClassificationOpen(false)}
          onSuccess={changed}
        />
      )}
      {incident && statusOpen && (
        <StatusModal
          incident={incident}
          onClose={() => setStatusOpen(false)}
          onSuccess={changed}
        />
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg bg-[#F7F8FA] p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-[#8A93A5]">{label}</p><p className="mt-1 break-words font-semibold text-[#0E1726]" title={value}>{value}</p></div>;
}

function formatOptionalDate(value?: string | null) {
  return value ? formatDateTime(value) : "Not available";
}

function formatIdle(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "Not available";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function attentionLabel(reason: IncidentOperationsItem["attention_reasons"][number]) {
  return {
    HIGH_PRIORITY: "High priority",
    SLA_AT_RISK: "SLA at risk",
    SLA_BREACHED: "SLA breached",
    STUCK_IDLE: "No recent activity",
  }[reason];
}

function referenceName(items: IncidentOperationsReferenceData["services"] | undefined, id?: string | null) {
  return id ? items?.find(item => item.id === id)?.name : undefined;
}
