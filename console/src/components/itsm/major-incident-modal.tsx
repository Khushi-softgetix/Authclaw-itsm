"use client";

import React, { useEffect, useState } from "react";
import ModalShell from "@/components/modal-shell";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { Incident, MajorIncident, MajorIncidentPayload, TenantUser } from "@/lib/itsm-types";

interface MajorIncidentModalProps {
  incident: Incident;
  majorIncident?: MajorIncident | null;
  onClose: () => void;
  onSuccess: (majorIncident: MajorIncident) => void;
}

export default function MajorIncidentModal({ incident, majorIncident, onClose, onSuccess }: MajorIncidentModalProps) {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [commanderId, setCommanderId] = useState(majorIncident?.incident_commander_id || "");
  const [bridgeUrl, setBridgeUrl] = useState(majorIncident?.bridge_url || "");
  const [channel, setChannel] = useState(majorIncident?.communication_channel || "");
  const [businessUnits, setBusinessUnits] = useState((majorIncident?.impacted_business_units || []).join(", "));
  const [customerImpact, setCustomerImpact] = useState(majorIncident?.customer_impact_description || "");
  const [summary, setSummary] = useState(majorIncident?.executive_summary || "");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/users")
      .then(async (response) => response.ok ? response.json() : [])
      .then((data) => { if (active && Array.isArray(data)) setUsers(data); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoadingUsers(false); });
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload: MajorIncidentPayload = {
      incident_commander_id: commanderId || null,
      bridge_url: bridgeUrl.trim() || null,
      communication_channel: channel.trim() || null,
      impacted_business_units: businessUnits.split(",").map((unit) => unit.trim()).filter(Boolean),
      customer_impact_description: customerImpact.trim() || null,
      executive_summary: summary.trim() || null,
    };
    try {
      const method = majorIncident ? "PATCH" : "POST";
      const response = await fetch(`/api/itsm/incidents/${incident.id}/major-incident`, jsonRequest(method, payload));
      if (!response.ok) throw new Error(apiErrorMessage(await response.json().catch(() => ({})), "Failed to save major incident command details"));
      onSuccess(await response.json());
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save major incident command details");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`${majorIncident ? "Update" : "Declare"} Major Incident · ${incident.ticket_number}`} onClose={onClose} error={error} maxWidthClass="max-w-[560px]">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="major-commander" className="block text-xs font-semibold text-[#0E1726] mb-1.5">Incident Commander</label>
          <select id="major-commander" value={commanderId} onChange={(event) => setCommanderId(event.target.value)} disabled={loadingUsers} className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none">
            <option value="">Assign me as commander</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="major-bridge" className="block text-xs font-semibold text-[#0E1726] mb-1.5">Bridge URL</label><input id="major-bridge" type="url" value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} placeholder="https://..." className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs" /></div>
          <div><label htmlFor="major-channel" className="block text-xs font-semibold text-[#0E1726] mb-1.5">Communication Channel</label><input id="major-channel" value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="#incident-room" className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs" /></div>
        </div>
        <div><label htmlFor="major-units" className="block text-xs font-semibold text-[#0E1726] mb-1.5">Impacted Business Units</label><input id="major-units" value={businessUnits} onChange={(event) => setBusinessUnits(event.target.value)} placeholder="Engineering, Support" className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3 py-2 text-xs" /></div>
        <div><label htmlFor="major-impact" className="block text-xs font-semibold text-[#0E1726] mb-1.5">Customer Impact</label><textarea id="major-impact" rows={2} value={customerImpact} onChange={(event) => setCustomerImpact(event.target.value)} className="w-full bg-white border border-[#E6E9F0] rounded-lg p-2.5 text-xs" /></div>
        <div><label htmlFor="major-summary" className="block text-xs font-semibold text-[#0E1726] mb-1.5">Executive Summary</label><textarea id="major-summary" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} className="w-full bg-white border border-[#E6E9F0] rounded-lg p-2.5 text-xs" /></div>
        <div className="flex justify-end gap-2 pt-3 border-t border-[#E6E9F0]"><button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium">Cancel</button><button type="submit" disabled={submitting} className="px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold disabled:opacity-50">{submitting ? "Saving..." : majorIncident ? "Save Command Details" : "Declare Major Incident"}</button></div>
      </form>
    </ModalShell>
  );
}
