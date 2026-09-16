"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Edit3,
  Flame,
  LifeBuoy,
  RefreshCw,
  ShieldAlert,
  Ticket as TicketIcon,
  User,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { Incident, IncidentActivity } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import IncidentStepper from "@/components/itsm/incident-stepper";
import StatusModal from "@/components/itsm/status-modal";
import AssignModal from "@/components/itsm/assign-modal";
import EditModal from "@/components/itsm/edit-modal";
import ActivityTimeline from "@/components/itsm/activity-timeline";

export default function IncidentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const incidentId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const [incident, setIncident] = useState<Incident | null>(null);
  const [activities, setActivities] = useState<IncidentActivity[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isRequester, setIsRequester] = useState<boolean>(true);

  // Operational Modals (agent/admin only)
  const [statusModalOpen, setStatusModalOpen] = useState<boolean>(false);
  const [assignModalOpen, setAssignModalOpen] = useState<boolean>(false);
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);

  const fetchIncidentData = useCallback(async () => {
    if (!incidentId) return;

    try {
      setLoading(true);
      setError(null);

      const [incRes, actRes] = await Promise.all([
        fetch(`/api/itsm/incidents/${incidentId}`),
        fetch(`/api/itsm/incidents/${incidentId}/activities`),
      ]);

      if (incRes.status === 401 || actRes.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }

      if (!incRes.ok) {
        if (incRes.status === 404) {
          throw new Error("Ticket not found or belongs to another workspace.");
        }
        const data = await incRes.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to load ticket details");
      }

      const incData = await incRes.json();
      setIncident(incData);

      if (actRes.ok) {
        const actData = await actRes.json();
        setActivities(Array.isArray(actData) ? actData : []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load ticket details");
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        if (session) {
          const role = session.itsmRole?.toUpperCase() || (session.platformRole === "SUPER_ADMIN" ? "PLATFORM_ADMINISTRATOR" : "REQUESTER");
          setIsRequester(role === "REQUESTER");
        }
        fetchIncidentData();
      })
      .catch(() => {
        fetchIncidentData();
      });
  }, [fetchIncidentData]);

  if (loading && !incident) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 text-[#6D28D9] animate-spin" />
        <span className="ml-3 text-xs text-[#475069]">Loading ticket records...</span>
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-base font-bold text-[#0E1726]">Unable to display ticket</h2>
        <p className="text-xs text-[#6B7488]">{error || "Ticket record unavailable"}</p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            href="/itsm/incidents"
            className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA]"
          >
            Back to My Tickets
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
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Navigation Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#6B7488]">
          <Link href="/itsm/incidents" className="hover:text-[#0E1726] flex items-center gap-1 font-semibold text-[#6D28D9]">
            <ArrowLeft className="w-3.5 h-3.5" /> My Tickets
          </Link>
          <span>/</span>
          <span className="font-mono text-[#0E1726] font-medium">{incident.ticket_number}</span>
        </div>

        <button
          onClick={() => fetchIncidentData()}
          className="p-1.5 rounded-lg border border-[#E6E9F0] text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] transition"
          title="Refresh ticket"
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
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-[#0E1726] tracking-tight">
              {incident.title}
            </h1>
          </div>

          {/* Operational Actions (only for non-requester agents/leads) */}
          {!isRequester && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setStatusModalOpen(true)}
                className="px-3.5 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold shadow-sm transition"
              >
                Change Status
              </button>
              <button
                onClick={() => setAssignModalOpen(true)}
                className="px-3.5 py-2 bg-white border border-[#E6E9F0] text-[#475069] hover:bg-[#F5F7FA] rounded-lg text-xs font-medium transition"
              >
                Assign
              </button>
              <button
                onClick={() => setEditModalOpen(true)}
                className="p-2 bg-white border border-[#E6E9F0] text-[#475069] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-lg transition"
                title="Edit incident details"
              >
                <Edit3 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Lifecycle Stepper */}
      <IncidentStepper currentStatus={incident.status} />

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (Ticket Details & Public Timeline) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Summary / Description */}
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
              Ticket Details
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Category
                </span>
                <span className="text-xs font-medium text-[#0E1726] mt-0.5 block">
                  {incident.category || "General IT"}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Urgency
                </span>
                <span className="text-xs font-semibold text-[#0E1726] mt-0.5 block">
                  {incident.urgency || "MEDIUM"}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Ticket Type
                </span>
                <span className="text-xs font-medium text-[#0E1726] mt-0.5 block">
                  {incident.ticket_type || "Incident"}
                </span>
              </div>
            </div>

            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488] mb-1.5">
                Description &amp; Context
              </span>
              <p className="text-xs text-[#475069] leading-relaxed bg-[#FBFAF9] p-4 rounded-xl border border-[#E6E9F0] whitespace-pre-wrap">
                {incident.description}
              </p>
            </div>
          </div>

          {/* Resolution Information Card */}
          {(incident.status === "RESOLVED" || incident.status === "CLOSED") && (
            <div className="bg-white rounded-[20px] border border-emerald-200 bg-emerald-50/20 p-6 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-emerald-800 border-b border-emerald-100 pb-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold">Resolution Details</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    Resolution Status
                  </span>
                  <span className="text-xs font-bold text-emerald-900 mt-0.5 block">
                    {incident.status}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    Resolved At
                  </span>
                  <span className="text-xs font-mono text-emerald-900 mt-0.5 block">
                    {incident.resolved_at ? formatDateTime(incident.resolved_at) : "Completed"}
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

          {/* Activity Timeline & Public Discussion */}
          <ActivityTimeline
            incidentId={incident.id}
            activities={activities}
            onActivityAdded={() => fetchIncidentData()}
          />
        </div>

        {/* Right Column (Requester Metadata Sidebar) */}
        <div className="space-y-6">
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-[#0E1726] border-b border-[#E6E9F0] pb-3">
              Ticket Information
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Created Date
                </span>
                <p className="font-medium text-[#0E1726] mt-0.5">{formatDateTime(incident.created_at)}</p>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Last Updated
                </span>
                <p className="font-medium text-[#0E1726] mt-0.5">
                  {formatDateTime(incident.updated_at || incident.created_at)}
                </p>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Current Status
                </span>
                <div className="mt-1">
                  <IncidentStatusBadge status={incident.status} />
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6B7488]">
                  Priority Level
                </span>
                <div className="mt-1">
                  <IncidentPriorityBadge priority={incident.priority} />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-[20px] border border-purple-100 p-5 space-y-3">
            <div className="flex items-center gap-2 text-[#6D28D9]">
              <LifeBuoy className="w-4 h-4" />
              <h4 className="text-xs font-bold">Need Urgent Support?</h4>
            </div>
            <p className="text-[11px] text-[#475069] leading-relaxed">
              Our IT Support team is investigating your request. You can add public comments or updates in the discussion timeline on the left.
            </p>
          </div>
        </div>
      </div>

      {/* Operational Modals (non-requester only) */}
      {!isRequester && statusModalOpen && (
        <StatusModal
          incident={incident}
          onClose={() => setStatusModalOpen(false)}
          onSuccess={(updated) => {
            setIncident(updated);
            fetchIncidentData();
          }}
        />
      )}

      {!isRequester && assignModalOpen && (
        <AssignModal
          incident={incident}
          onClose={() => setAssignModalOpen(false)}
          onSuccess={(updated) => {
            setIncident(updated);
            fetchIncidentData();
          }}
        />
      )}

      {!isRequester && editModalOpen && (
        <EditModal
          incident={incident}
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
