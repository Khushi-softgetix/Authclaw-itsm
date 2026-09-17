"use client";

import React, { useMemo, useState } from "react";
import ModalShell from "@/components/modal-shell";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import type { Incident, IncidentOperationsReferenceData } from "@/lib/itsm-types";

interface Props {
  incident: Incident;
  references: IncidentOperationsReferenceData;
  onClose: () => void;
  onSuccess: (updated: Incident) => void;
}

const levels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const fieldClass = "w-full rounded-lg border border-[#E6E9F0] bg-white px-3 py-2.5 text-xs text-[#0E1726] outline-none transition focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10";

export default function IncidentClassificationModal({ incident, references, onClose, onSuccess }: Props) {
  const [serviceId, setServiceId] = useState(incident.service_id || "");
  const [categoryId, setCategoryId] = useState(incident.category_id || "");
  const [configurationItemId, setConfigurationItemId] = useState(incident.configuration_item_id || "");
  const [impact, setImpact] = useState(incident.impact);
  const [urgency, setUrgency] = useState(incident.urgency);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configurationItems = useMemo(
    () => references.configuration_items.filter(item => !serviceId || !item.service_id || item.service_id === serviceId),
    [references.configuration_items, serviceId],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/itsm/incidents/${incident.id}`, jsonRequest("PATCH", {
        service_id: serviceId || null,
        category_id: categoryId || null,
        configuration_item_id: configurationItemId || null,
        impact,
        urgency,
      }));
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(body, "Unable to update incident classification"));
      onSuccess(body);
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Unable to update incident classification");
    } finally {
      setSaving(false);
    }
  };

  return <ModalShell title={`Classify incident · ${incident.ticket_number}`} onClose={onClose} error={error} maxWidthClass="max-w-[560px]">
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Affected service" value={serviceId} onChange={value=>{setServiceId(value);if(configurationItemId&&!references.configuration_items.some(item=>item.id===configurationItemId&&(!value||!item.service_id||item.service_id===value)))setConfigurationItemId("");}} options={references.services.map(item=>[item.id,item.name])}/>
        <Select label="Category" value={categoryId} onChange={setCategoryId} options={references.categories.map(item=>[item.id,item.name])}/>
        <Select label="Configuration item" value={configurationItemId} onChange={setConfigurationItemId} options={configurationItems.map(item=>[item.id,item.name])}/>
        <Select label="Impact" value={impact} onChange={value=>setImpact(value as Incident["impact"])} options={levels.map(value=>[value,value])} allowEmpty={false}/>
        <Select label="Urgency" value={urgency} onChange={value=>setUrgency(value as Incident["urgency"])} options={levels.map(value=>[value,value])} allowEmpty={false}/>
      </div>
      <p className="rounded-lg bg-[#F7F8FA] px-3 py-2.5 text-[11px] leading-5 text-[#6B7488]">Priority remains a controlled Incident Manager action and is updated separately from classification.</p>
      <div className="flex justify-end gap-2 border-t border-[#E6E9F0] pt-4"><button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[#DDE1E8] bg-white px-4 py-2 text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA]">Cancel</button><button disabled={saving} className="rounded-lg bg-[#6D28D9] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#5B21B6] disabled:opacity-50">{saving?"Saving...":"Save classification"}</button></div>
    </form>
  </ModalShell>;
}

function Select({ label, value, onChange, options, allowEmpty=true }: { label: string; value: string; onChange: (value: string) => void; options: string[][]; allowEmpty?: boolean }) {
  return <label className="text-xs font-semibold text-[#0E1726]">{label}<select value={value} onChange={event=>onChange(event.target.value)} className={`${fieldClass} mt-1.5`}>{allowEmpty?<option value="">Not selected</option>:null}{options.map(([optionValue,optionLabel])=><option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}
