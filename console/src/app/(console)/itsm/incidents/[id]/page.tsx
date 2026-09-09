"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Edit3,
  Flame,
  Layers,
  RefreshCw,
  Share2,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { Incident, IncidentActivity, MajorIncident } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import IncidentStepper from "@/components/itsm/incident-stepper";
import StatusModal from "@/components/itsm/status-modal";
import AssignModal from "@/components/itsm/assign-modal";
import EditModal from "@/components/itsm/edit-modal";
import ActivityTimeline from "@/components/itsm/activity-timeline";
import MajorIncidentModal from "@/components/itsm/major-incident-modal";

export default function IncidentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const incidentId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [incident, setIncident] = useState<Incident | null>(null);
  const [activities, setActivities] = useState<IncidentActivity[]>([]);
  const [majorIncident, setMajorIncident] = useState<MajorIncident | null>(null);
  const [isServiceLead, setIsServiceLead] = useState(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [statusModalOpen, setStatusModalOpen] = useState<boolean>(false);
  const [assignModalOpen, setAssignModalOpen] = useState<boolean>(false);
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [majorIncidentModalOpen, setMajorIncidentModalOpen] = useState<boolean>(false);

  const fetchIncidentData = useCallback(async () => {
    if (!incidentId) return;

    try {
      setLoading(true);
      setError(null);

      const [incRes, actRes, sessionRes] = await Promise.all([
        fetch(`/api/itsm/incidents/${incidentId}`),
        fetch(`/api/itsm/incidents/${incidentId}/activities`),
        fetch("/api/auth/session"),
      ]);

      if (incRes.status === 401 || actRes.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (!incRes.ok) {
        if (incRes.status === 404) {
          throw new Error("Incident not found or belongs to another tenant.");
        }
        const data = await incRes.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to load incident");
      }

      const incData = await incRes.json();
      setIncident(incData);

      const session = sessionRes.ok ? await sessionRes.json() : null;
      const canManageOperations = session?.itsmRole === "SERVICE_LEAD";
      setIsServiceLead(canManageOperations);
      if (canManageOperations && incData.is_major_incident) {
        const majorResponse = await fetch(`/api/itsm/incidents/${incidentId}/major-incident`);
        if (majorResponse.ok) setMajorIncident(await majorResponse.json());
      } else {
        setMajorIncident(null);
      }

      if (actRes.ok) {
        const actData = await actRes.json();
        setActivities(Array.isArray(actData) ? actData : []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load incident details");
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    fetchIncidentData();
  }, [fetchIncidentData]);

  if (loading && !incident) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin" />
        <span className="ml-3 text-xs text-[#475069]">Loading incident records...</span>
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-base font-bold text-[#0E1726]">Unable to display incident</h2>
        <p className="text-xs text-[#6B7488]">{error || "Incident record unavailable"}</p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href="/itsm/incidents"
            className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA]"
          >
            Back to Incidents
          </Link>
          <button
            onClick={() => fetchIncidentData()}
            className="px-4 py-2 bg-[#6D28D9] text-white rounded-lg text-xs font-semibold hover:bg-[#5B21B6]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#6B7488]">
          <Link href="/itsm/incidents" className="hover:text-[#0E1726] flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Incidents
          </Link>
          <span>/</span>
          <span className="font-mono text-[#0E1726] font-medium">{incident.ticket_number}</span>
        </div>

        <button
          onClick={() => fetchIncidentData()}
          className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
          title="Refresh record"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Record Header */}
      <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-sm font-extrabold text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-md border border-[#A78BFA]">
                {incident.ticket_number}
              </span>
              <IncidentStatusBadge status={incident.status} />
              <IncidentPriorityBadge priority={incident.priority} />
              {incident.is_major_incident && (
                <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 text-xs font-bold px-2 py-0.5 rounded-full">
                  <Flame className="w-3 h-3 text-red-600" /> Major Incident
                </span>
              )}
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-[#0E1726] tracking-tight">
              {incident.title}
            </h1>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setStatusModalOpen(true)}
              className="px-3.5 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold shadow-sm transition"
            >
              Change Status
            </button>
            <button
              onClick={() => setAssignModalOpen(true)}
              hidden={!isServiceLead}
              className="px-3.5 py-2 bg-white border border-[#E6E9F0] text-[#475069] hover:bg-[#F5F7FA] rounded-lg text-xs font-medium transition"
            >
              Assign
            </button>
            {isServiceLead && (
              <button
                onClick={() => setMajorIncidentModalOpen(true)}
                className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-sm transition"
              >
                {majorIncident ? "Command Room" : "Declare Major"}
              </button>
            )}
            <button
              onClick={() => setEditModalOpen(true)}
              className="p-2 bg-white border border-[#E6E9F0] text-[#475069] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-lg transition"
              title="Edit incident details"
            >
              <Edit3 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Lifecycle Progression Bar */}
      <IncidentStepper currentStatus={incident.status} />

      {/* Main Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (Details & Activity) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Overview Card */}
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
              Incident Overview
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Impact
                </span>
                <span className="text-xs font-semibold text-[#0E1726] mt-0.5 block">
                  {incident.impact}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Urgency
                </span>
                <span className="text-xs font-semibold text-[#0E1726] mt-0.5 block">
                  {incident.urgency}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Category
                </span>
                <span className="text-xs font-medium text-[#0E1726] mt-0.5 block">
                  {incident.category}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Subcategory
                </span>
                <span className="text-xs font-medium text-[#0E1726] mt-0.5 block">
                  {incident.subcategory || "None"}
                </span>
              </div>
            </div>

            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488] mb-1.5">
                Description
              </span>
              <p className="text-xs text-[#475069] leading-relaxed bg-[#FBFAF9] p-4 rounded-xl border border-[#E6E9F0] whitespace-pre-wrap">
                {incident.description}
              </p>
            </div>

            {incident.status_reason && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-yellow-800">
                  Status Reason ({incident.status})
                </span>
                <p className="text-xs text-yellow-900 mt-0.5">{incident.status_reason}</p>
              </div>
            )}
          </div>

          {/* Resolution Details Card (when resolved or closed) */}
          {(incident.status === "RESOLVED" || incident.status === "CLOSED") && (
            <div className="bg-white rounded-[20px] border border-emerald-200 bg-emerald-50/20 p-6 shadow-sm space-y-3">
              <h3 className="text-sm font-bold text-emerald-800 border-b border-emerald-100 pb-2">
                Resolution Information
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    Resolution Code
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-900 mt-0.5 block">
                    {incident.resolution_code || "N/A"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    Resolved At
                  </span>
                  <span className="text-xs font-mono text-emerald-900 mt-0.5 block">
                    {incident.resolved_at ? formatDateTime(incident.resolved_at) : "N/A"}
                  </span>
                </div>
              </div>
              {incident.resolution_summary && (
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-1">
                    Resolution Summary
                  </span>
                  <p className="text-xs text-emerald-950 bg-white p-3 rounded-lg border border-emerald-200 whitespace-pre-wrap">
                    {incident.resolution_summary}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Activity Stream & Composer */}
          <ActivityTimeline
            incidentId={incident.id}
            activities={activities}
            onActivityAdded={() => fetchIncidentData()}
          />
        </div>

        {/* Right Column (Sidebar Metadata & SLA) */}
        <div className="space-y-6">
          {/* Assignment Card */}
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <h3 className="text-sm font-bold text-[#0E1726]">Ownership</h3>
              {isServiceLead && <button
                onClick={() => setAssignModalOpen(true)}
                className="text-xs font-semibold text-[#6D28D9] hover:underline"
              >
                Reassign
              </button>}
            </div>

            <div className="space-y-3">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Assignment Group
                </span>
                <p className="text-xs font-semibold text-[#0E1726] mt-0.5">
                  {incident.assignment_group || "Unassigned Group"}
                </p>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Assignee
                </span>
                <p className="text-xs font-mono text-[#0E1726] mt-0.5">
                  {incident.assignee_id ? incident.assignee_id : "Unassigned"}
                </p>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Requester
                </span>
                <p className="text-xs font-mono text-[#475069] mt-0.5">
                  {incident.requester_id}
                </p>
              </div>
            </div>
          </div>

          {/* SLA Card */}
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
              SLA Commitments
            </h3>

            <div className="space-y-3">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  SLA Status
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 mt-1">
                  {incident.sla_status || "WITHIN_SLA"}
                </span>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  SLA Policy
                </span>
                <p className="text-xs font-mono text-[#475069] mt-0.5 truncate">
                  {incident.sla_policy_id || "Standard Priority Policy"}
                </p>
              </div>

              {incident.sla_response_due_at && (
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Response Target
                  </span>
                  <p className="text-xs font-mono text-[#475069] mt-0.5">
                    {formatDateTime(incident.sla_response_due_at)}
                  </p>
                </div>
              )}

              {incident.sla_resolution_due_at && (
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                    Resolution Target
                  </span>
                  <p className="text-xs font-mono text-[#475069] mt-0.5">
                    {formatDateTime(incident.sla_resolution_due_at)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {isServiceLead && majorIncident && (
            <div className="bg-red-50/60 rounded-[20px] border border-red-200 p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-red-200 pb-3"><h3 className="text-sm font-bold text-red-800">Major Incident Command</h3><button onClick={() => setMajorIncidentModalOpen(true)} className="text-xs font-semibold text-red-700 hover:underline">Update</button></div>
              <div className="space-y-2 text-xs text-[#475069]">
                <p><span className="font-semibold text-[#6B7488]">Commander:</span> {majorIncident.incident_commander_id || "Current Service Lead"}</p>
                {majorIncident.communication_channel && <p><span className="font-semibold text-[#6B7488]">Channel:</span> {majorIncident.communication_channel}</p>}
                {majorIncident.bridge_url && <a href={majorIncident.bridge_url} target="_blank" rel="noreferrer" className="inline-flex font-semibold text-red-700 hover:underline">Open command bridge</a>}
                {majorIncident.executive_summary && <p className="rounded-lg bg-white/80 p-3 border border-red-100">{majorIncident.executive_summary}</p>}
              </div>
            </div>
          )}

          {/* Metadata Card */}
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
              System Audit
            </h3>

            <div className="space-y-2.5 text-xs text-[#475069]">
              <div className="flex justify-between">
                <span className="text-[#6B7488]">Source Channel</span>
                <span className="font-medium text-[#0E1726]">{incident.source_channel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B7488]">Created At</span>
                <span className="font-mono text-[#0E1726]">{formatDateTime(incident.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B7488]">Last Updated</span>
                <span className="font-mono text-[#0E1726]">{formatDateTime(incident.updated_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {statusModalOpen && (
        <StatusModal
          incident={incident}
          onClose={() => setStatusModalOpen(false)}
          onSuccess={(updated) => {
            setIncident(updated);
            fetchIncidentData();
          }}
        />
      )}

      {assignModalOpen && isServiceLead && (
        <AssignModal
          incident={incident}
          onClose={() => setAssignModalOpen(false)}
          onSuccess={(updated) => {
            setIncident(updated);
            fetchIncidentData();
          }}
        />
      )}

      {majorIncidentModalOpen && isServiceLead && (
        <MajorIncidentModal
          incident={incident}
          majorIncident={majorIncident}
          onClose={() => setMajorIncidentModalOpen(false)}
          onSuccess={(updated) => {
            setMajorIncident(updated);
            fetchIncidentData();
          }}
        />
      )}

      {editModalOpen && (
        <EditModal
          incident={incident}
          canManageOperations={isServiceLead}
          onClose={() => setEditModalOpen(false)}
          onSuccess={(updated) => {
            setIncident(updated);
            fetchIncidentData();
          }}
        />
      )}
    </div>
  );
}
