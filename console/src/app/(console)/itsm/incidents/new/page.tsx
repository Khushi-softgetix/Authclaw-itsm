"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck, Sparkles } from "lucide-react";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { IncidentCreatePayload, TenantUser } from "@/lib/itsm-types";

const IMPACTS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const URGENCIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const PRIORITIES = [
  { label: "Auto-derive from matrix", value: "" },
  { label: "P1 · Critical", value: "P1" },
  { label: "P2 · High", value: "P2" },
  { label: "P3 · Medium", value: "P3" },
  { label: "P4 · Low", value: "P4" },
];

const COMMON_CATEGORIES = [
  "GENERAL",
  "NETWORK",
  "IDENTITY",
  "INFRASTRUCTURE",
  "SOFTWARE",
  "HARDWARE",
  "SECURITY",
];

export default function CreateIncidentPage() {
  const router = useRouter();

  // Form State
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [impact, setImpact] = useState<string>("MEDIUM");
  const [urgency, setUrgency] = useState<string>("MEDIUM");
  const [priority, setPriority] = useState<string>("");
  const [priorityOverrideReason, setPriorityOverrideReason] = useState<string>("");
  const [category, setCategory] = useState<string>("GENERAL");
  const [subcategory, setSubcategory] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [assignmentGroup, setAssignmentGroup] = useState<string>("Service Desk");
  const [isMajorIncident, setIsMajorIncident] = useState<boolean>(false);

  // Tenant users
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(true);

  // Submission State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadUsers = async () => {
      try {
        setLoadingUsers(true);
        const res = await fetch("/api/users");
        if (res.ok) {
          const data = await res.json();
          if (mounted && Array.isArray(data)) {
            setUsers(data);
          }
        }
      } catch (err: unknown) {
        console.warn("Failed to load users:", err);
      } finally {
        if (mounted) setLoadingUsers(false);
      }
    };
    loadUsers();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Please provide both an incident title and description.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const payload: IncidentCreatePayload = {
        title: title.trim(),
        description: description.trim(),
        impact,
        urgency,
        category: category.trim() || "GENERAL",
        subcategory: subcategory.trim() ? subcategory.trim() : null,
        assignee_id: assigneeId ? assigneeId : null,
        assignment_group: assignmentGroup.trim() ? assignmentGroup.trim() : null,
        is_major_incident: isMajorIncident,
        source_channel: "PORTAL",
      };

      if (priority) {
        payload.priority = priority;
        payload.priority_override_reason = priorityOverrideReason.trim();
      }

      const res = await fetch("/api/itsm/incidents", jsonRequest("POST", payload));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to create incident"));
      }

      const created = await res.json();
      router.push(`/itsm/incidents/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create incident");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[#6B7488]">
        <Link href="/itsm/incidents" className="hover:text-[#0E1726] flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Incidents
        </Link>
        <span>/</span>
        <span className="text-[#0E1726] font-medium">Create Incident</span>
      </div>

      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-extrabold text-[#0E1726] tracking-tight">Log New Incident</h1>
        <p className="text-xs text-[#6B7488] mt-1">
          Submit an operational incident to trigger automated tracking, priority resolution, and SLA policy assignment.
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Column */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-5">
            <div>
              <label htmlFor="inc-title" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                Incident Summary *
              </label>
              <input
                id="inc-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Remote access VPN connection pool saturated in EU region"
                className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                required
              />
            </div>

            <div>
              <label htmlFor="inc-desc" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                Detailed Description *
              </label>
              <textarea
                id="inc-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the degradation symptoms, affected users, services, error codes, and troubleshooting steps taken so far..."
                rows={5}
                className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-lg p-3 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none leading-relaxed"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="inc-impact" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                  Impact *
                </label>
                <select
                  id="inc-impact"
                  value={impact}
                  onChange={(e) => setImpact(e.target.value)}
                  className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                >
                  {IMPACTS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="inc-urgency" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                  Urgency *
                </label>
                <select
                  id="inc-urgency"
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value)}
                  className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                >
                  {URGENCIES.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="inc-priority" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                  Priority Override
                </label>
                <select
                  id="inc-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {priority ? <div><label htmlFor="inc-priority-reason" className="mb-1.5 block text-xs font-semibold text-[#0E1726]">Priority override reason *</label><input id="inc-priority-reason" value={priorityOverrideReason} onChange={event=>setPriorityOverrideReason(event.target.value)} required placeholder="Explain why the calculated priority must be overridden" className="w-full rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] px-3 py-2 text-xs outline-none focus:border-[#6D28D9] focus:bg-white"/></div> : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="inc-cat" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                  Category
                </label>
                <input
                  id="inc-cat"
                  type="text"
                  list="category-suggestions"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
                <datalist id="category-suggestions">
                  {COMMON_CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label htmlFor="inc-subcat" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                  Subcategory
                </label>
                <input
                  id="inc-subcat"
                  type="text"
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  placeholder="e.g. Gateway, SSO, Token..."
                  className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="inc-assignee" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                  Assignee (Tenant Member)
                </label>
                <select
                  id="inc-assignee"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  disabled={loadingUsers}
                  className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} {u.role ? `(${u.role})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="inc-group" className="block text-xs font-semibold text-[#0E1726] mb-1.5">
                  Assignment Group
                </label>
                <input
                  id="inc-group"
                  type="text"
                  value={assignmentGroup}
                  onChange={(e) => setAssignmentGroup(e.target.value)}
                  className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                id="inc-major"
                type="checkbox"
                checked={isMajorIncident}
                onChange={(e) => setIsMajorIncident(e.target.checked)}
                className="w-4 h-4 rounded border-[#E6E9F0] text-[#6D28D9] focus:ring-[#6D28D9]"
              />
              <label htmlFor="inc-major" className="text-xs font-medium text-[#0E1726] cursor-pointer">
                Declare as Major Incident (Critical outage with widespread business impact)
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E6E9F0]">
              <Link
                href="/itsm/incidents"
                className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50"
              >
                {submitting ? "Logging Incident..." : "Create Incident"}
              </button>
            </div>
          </form>
        </div>

        {/* Guidance Column */}
        <div className="space-y-4">
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0E1726]">
              <Sparkles className="w-4 h-4 text-[#6D28D9]" />
              <span>Automated Backend Rules</span>
            </div>
            <p className="text-xs text-[#475069] leading-relaxed">
              When priority is omitted, the backend automatically evaluates the matrix derived from your specified <strong>Impact</strong> and <strong>Urgency</strong>:
            </p>
            <div className="text-[11px] bg-[#F5F7FA] p-3 rounded-lg border border-[#E6E9F0] space-y-1 font-mono text-[#475069]">
              <div>Critical Impact &rarr; P1 (Critical)</div>
              <div>High Impact + High Urgency &rarr; P1</div>
              <div>High Impact + Med Urgency &rarr; P2</div>
              <div>Med Impact + Med Urgency &rarr; P3</div>
            </div>
          </div>

          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0E1726]">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>SLA Policy Association</span>
            </div>
            <p className="text-xs text-[#475069] leading-relaxed">
              The backend automatically matches an active SLA policy for your tenant matching the incident priority. Response and resolution targets will attach seamlessly upon creation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
