"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, ListPlus, MessageSquareText, Radio, RefreshCw, Search, ShieldAlert, Trash2 } from "lucide-react";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import ActivityTimeline from "@/components/itsm/activity-timeline";
import NotificationBell from "@/components/notification-bell";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/itsm-format";
import type { Incident, IncidentActivity, IncidentOperationsQueue, IncidentOperationsReferenceData, MajorIncident, MajorIncidentPayload, TenantUser } from "@/lib/itsm-types";

const COMMAND_PAGE_SIZE = 30;
const commandInputClass = "w-full rounded-lg border border-[#DDD6FE] bg-white px-3 py-2.5 text-xs font-normal outline-none transition focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10";

export default function MajorIncidentCommandPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [references, setReferences] = useState<IncidentOperationsReferenceData>({users:[],teams:[],services:[],configuration_items:[],categories:[]});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [record, setRecord] = useState<MajorIncident | null>(null);
  const [loading, setLoading] = useState(true);
  const [recordLoading, setRecordLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usersWarning, setUsersWarning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setUsersWarning(null);
    try {
      const params = new URLSearchParams({ command_scope: "true", limit: String(COMMAND_PAGE_SIZE), offset: String(offset), sort_by: "priority" });
      if (search.trim()) params.set("search", search.trim());
      const [incidentResponse, usersResponse] = await Promise.all([
        fetch(`/api/itsm/incidents/operations/queue?${params}`, { cache: "no-store" }), fetch("/api/itsm/incidents/operations/reference-data", { cache: "no-store" }).catch(() => null),
      ]);
      if (incidentResponse.status === 401) { window.location.assign("/itsm/login?next=%2Fitsm%2Fincident-manager%2Fmajor-incidents"); return; }
      if (!incidentResponse.ok) throw new Error("Unable to load incidents for command review");
      const queue: IncidentOperationsQueue = await incidentResponse.json();
      const list = Array.isArray(queue.items) ? queue.items.map(item => item.incident) : [];
      setTotal(typeof queue.total === "number" ? queue.total : 0);
      const requested = new URLSearchParams(window.location.search).get("incident");
      if (requested && !list.some(incident => incident.id === requested)) {
        const selectedResponse = await fetch(`/api/itsm/incidents/${encodeURIComponent(requested)}`, { cache: "no-store" });
        if (selectedResponse.ok) list.unshift(await selectedResponse.json());
      }
      setIncidents(list);
      if (usersResponse?.ok) { const result=await usersResponse.json(); setReferences(result); setUsers(Array.isArray(result.users)?result.users:[]); }
      else setUsersWarning("People could not be loaded. Existing ownership remains visible, but owner selection is unavailable.");
      if (requested) setSelectedId(requested);
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "Unable to load major incidents"); }
    finally { setLoading(false); }
  }, [offset, search]);

  useEffect(() => { const request=window.setTimeout(()=>void load(),0); return()=>window.clearTimeout(request); }, [load]);
  useEffect(() => {
    if (!selectedId) return;
    const selectedIncident=incidents.find(incident=>incident.id===selectedId);
    if (!selectedIncident?.is_major_incident) { const reset=window.setTimeout(()=>{setRecord(null);setRecordLoading(false);},0); return()=>window.clearTimeout(reset); }
    let active=true;
    const request=window.setTimeout(()=>{ setRecordLoading(true);
    fetch(`/api/itsm/incidents/${encodeURIComponent(selectedId)}/major-incident`, { cache:"no-store" }).then(async response => {
      if (response.status===404) return null;
      if (!response.ok) { const body=await response.json().catch(()=>({})); throw new Error(apiErrorMessage(body,"Unable to load command record")); }
      return response.json();
    }).then(data=>{if(active)setRecord(data);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:"Unable to load command record");}).finally(()=>{if(active)setRecordLoading(false);}); },0);
    return()=>{active=false;window.clearTimeout(request);};
  },[incidents,selectedId]);

  const visible=incidents;
  const selected=incidents.find(i=>i.id===selectedId)||null;
  const selectedRecord=record?.ticket_id===selectedId ? record : null;

  return <div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-3xl font-extrabold tracking-tight text-[#0E1726]">Command Workspace</h1><p className="mt-1 max-w-3xl text-sm text-[#6B7488]">Coordinate impact, ownership, restoration, and PIR evidence.</p></div><div className="flex items-center gap-2"><button onClick={load} className="inline-flex w-fit items-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-3.5 py-2 text-xs font-semibold text-[#5B21B6] shadow-sm transition hover:bg-[#F1ECFE]"><RefreshCw className={`h-3.5 w-3.5 text-[#6D28D9] ${loading?"animate-spin":""}`}/>Refresh</button><NotificationBell /></div></header>
    {usersWarning&&<div className="rounded-xl border border-[#DDD6FE] bg-[#FAF8FF] px-4 py-3 text-xs text-[#5B21B6]">{usersWarning}</div>}
    {error&&<div className="flex items-center gap-2 rounded-xl border border-[#DDD6FE] bg-[#F1ECFE] p-4 text-xs text-[#5B21B6]"><AlertCircle className="h-4 w-4"/>{error}</div>}
    <div className="grid items-start gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <section className="self-start overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-sm shadow-[#6D28D9]/5 xl:sticky xl:top-5">
        <div className="border-b border-[#DDD6FE] bg-[#FCFAFF] p-4"><div className="flex items-center justify-between"><div><h2 className="text-sm font-bold">Command queue</h2><p className="mt-1 text-[11px] text-[#6B7488]">Active majors and P1/P2 candidates</p></div><span className="rounded-full bg-[#F1ECFE] px-2.5 py-1 text-[10px] font-bold text-[#6D28D9]">{total}</span></div><label className="relative mt-3 block"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A93A5]"/><span className="sr-only">Search command queue</span><input value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}} placeholder="Search incident" className="w-full rounded-lg border border-[#DDD6FE] bg-white py-2 pl-8 pr-3 text-xs outline-none transition focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10"/></label></div>
        <div className="max-h-[630px] divide-y divide-[#EEF1F5] overflow-y-auto">{loading?Array.from({length:4}).map((_,i)=><div key={i} className="m-4 h-16 animate-pulse rounded bg-[#EEF1F5]"/>):visible.length===0?<div className="px-6 py-12 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-[#6D28D9]"/><p className="mt-3 text-sm font-bold">No active command items</p><p className="mt-1 text-xs text-[#6B7488]">No major incidents or P1/P2 candidates are currently open.</p></div>:visible.map(i=><button key={i.id} type="button" aria-pressed={selectedId===i.id} onClick={()=>{setRecord(null);setRecordLoading(true);setError(null);setSelectedId(i.id);}} className={`group w-full border-l-2 p-4 text-left transition hover:bg-[#FAF8FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6D28D9] ${selectedId===i.id?"border-[#6D28D9] bg-[#F1ECFE]":"border-transparent"}`}>
          <p className="text-[11px] font-semibold text-[#5B21B6]">{i.is_major_incident ? "Declared Major Incident" : "High-priority candidate"}</p>
          <p className="mt-2 break-words text-sm font-bold leading-5 text-[#0E1726]">{i.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] font-semibold text-[#6D28D9]">{i.ticket_number}</span><IncidentPriorityBadge priority={i.priority} showLabel={false} tone="brand"/></div>
          <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-[11px] text-[#6B7488]">Incident state</span><IncidentStatusBadge status={i.status} tone="brand"/></div>
          <p className="mt-2 break-words text-xs text-[#6B7488]">{i.assignment_group ? `Team: ${i.assignment_group}` : "No assignment group"}</p>
          <span className="mt-3 flex items-center justify-between text-xs font-semibold text-[#6D28D9]">{selectedId===i.id ? "Viewing command" : "Open command"}{selectedId!==i.id ? <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5"/> : null}</span>
        </button>)}</div>
        <div className="flex items-center justify-between border-t border-[#DDD6FE] bg-[#FCFAFF] px-4 py-2.5 text-[10px] text-[#6B7488]"><span>{total===0?0:offset+1}-{Math.min(offset+visible.length,total)} of {total}</span><div className="flex gap-1"><button type="button" disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-COMMAND_PAGE_SIZE))} className="rounded-md border border-[#DDD6FE] bg-white p-1.5 text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-40" aria-label="Previous command items"><ChevronLeft className="h-3.5 w-3.5"/></button><button type="button" disabled={offset+visible.length>=total||loading} onClick={()=>setOffset(offset+COMMAND_PAGE_SIZE)} className="rounded-md border border-[#DDD6FE] bg-white p-1.5 text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-40" aria-label="Next command items"><ChevronRight className="h-3.5 w-3.5"/></button></div></div>
      </section>
      {!selected?<EmptyCommand/>:<CommandRecord key={`${selected.id}-${selectedRecord?.updated_at||"new"}`} incident={selected} record={selectedRecord} users={users} references={references} loading={recordLoading} onSaved={(saved)=>{if(saved.ticket_id===selected.id)setRecord(saved);void load();}}/>}
    </div>
  </div>;
}

function EmptyCommand(){return <section className="flex min-h-[220px] self-start items-center justify-center rounded-2xl border border-[#DDD6FE] bg-[#FCFAFF] p-6 text-center sm:p-8"><div><span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#F1ECFE]"><Radio className="h-5 w-5 text-[#6D28D9]"/></span><h2 className="mt-3 text-base font-bold text-[#0E1726]">Open command details</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[#6B7488]">Select an incident from the command queue.</p></div></section>}

function CommandRecord({incident,record,users,references,loading,onSaved}:{incident:Incident;record:MajorIncident|null;users:TenantUser[];references:IncidentOperationsReferenceData;loading:boolean;onSaved:(value:MajorIncident)=>void}){
  const commanders = references.commanders || [];
  const sharedCommandOwner = Boolean(record?.incident_commander_id && record.incident_commander_id === record.communication_lead_id);
  const affectedServices = record?.affected_service_ids || (incident.service_id ? [incident.service_id] : []);
  const affectedCIs = record?.affected_configuration_item_ids || (incident.configuration_item_id ? [incident.configuration_item_id] : []);
  const [form,setForm]=useState<MajorIncidentPayload>({incident_commander_id:record?.incident_commander_id||"",communication_lead_id:record?.communication_lead_id||"",bridge_url:record?.bridge_url||"",communication_channel:record?.communication_channel||"",impacted_business_units:record?.impacted_business_units||[],affected_service_ids:record?.affected_service_ids||(incident.service_id?[incident.service_id]:[]),affected_configuration_item_ids:record?.affected_configuration_item_ids||(incident.configuration_item_id?[incident.configuration_item_id]:[]),customer_impact_description:record?.customer_impact_description||"",executive_summary:record?.executive_summary||"",restoration_checkpoints:record?.restoration_checkpoints||[],command_decisions:record?.command_decisions||[],command_tasks:record?.command_tasks||[],stakeholders:record?.stakeholders||[],command_communications:record?.command_communications||[],postmortem_status:record?.postmortem_status||"NOT_STARTED",postmortem_url:record?.postmortem_url||""});
  const [units,setUnits]=useState((record?.impacted_business_units||[]).join(", ")); const [saving,setSaving]=useState(false); const [message,setMessage]=useState<string|null>(null); const [error,setError]=useState<string|null>(null);
  const [checkpointTitle,setCheckpointTitle]=useState(""); const [checkpointOwner,setCheckpointOwner]=useState(""); const [checkpointTarget,setCheckpointTarget]=useState("");
  const [decisionSummary,setDecisionSummary]=useState(""); const [decisionOwner,setDecisionOwner]=useState(""); const [decisionContext,setDecisionContext]=useState(""); const [taskTitle,setTaskTitle]=useState(""); const [taskOwner,setTaskOwner]=useState(""); const [taskDue,setTaskDue]=useState("");
  const [stakeholderName,setStakeholderName]=useState(""); const [stakeholderRole,setStakeholderRole]=useState(""); const [stakeholderContact,setStakeholderContact]=useState("");
  const [communicationAudience,setCommunicationAudience]=useState(""); const [communicationChannel,setCommunicationChannel]=useState(""); const [communicationMessage,setCommunicationMessage]=useState(""); const [communicationApprover,setCommunicationApprover]=useState(""); const [communicationStatus,setCommunicationStatus]=useState<"DRAFT"|"APPROVED"|"COMMUNICATED">("DRAFT");
  const commander=record?.incident_commander_id ? users.find(user=>user.id===record.incident_commander_id)?.email || record.incident_commander_id : "Not assigned";
  const communicationLead=record?.communication_lead_id ? users.find(user=>user.id===record.communication_lead_id)?.email || record.communication_lead_id : "Not assigned";
  const openTasks=(record?.command_tasks||[]).filter(task=>!task.completed_at).length;
  const checkpointProgress=record?.restoration_checkpoints.length ? `${record.restoration_checkpoints.filter(item=>item.completed_at).length} of ${record.restoration_checkpoints.length} checkpoints complete` : "No checkpoints recorded";
  const save=async(e:React.FormEvent)=>{e.preventDefault();setSaving(true);setError(null);setMessage(null);try{const payload:MajorIncidentPayload={...form,incident_commander_id:form.incident_commander_id||null,communication_lead_id:form.communication_lead_id||null,bridge_url:form.bridge_url||null,communication_channel:form.communication_channel||null,customer_impact_description:form.customer_impact_description||null,executive_summary:form.executive_summary||null,postmortem_url:form.postmortem_url||null,impacted_business_units:units.split(",").map(v=>v.trim()).filter(Boolean)};if(!record){delete payload.postmortem_status;delete payload.postmortem_url;}const response=await fetch(`/api/itsm/incidents/${incident.id}/major-incident`,jsonRequest(record?"PATCH":"POST",payload));const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(apiErrorMessage(body,record?"Unable to update command record":"Unable to declare major incident"));onSaved(body);setMessage(record?"Command record updated.":"Major incident declared and command record created.");}catch(reason:unknown){setError(reason instanceof Error?reason.message:"Unable to save command record");}finally{setSaving(false);}};
  if(loading)return <div className="min-h-[560px] animate-pulse rounded-2xl border bg-white p-6"><div className="h-8 w-2/3 rounded bg-[#EEF1F5]"/><div className="mt-6 h-80 rounded bg-[#EEF1F5]"/></div>;
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-sm shadow-[#6D28D9]/5"><header className="space-y-2 border-b border-[#DDD6FE] bg-[#FCFAFF] p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#5B21B6]"><ShieldAlert className="h-4 w-4 shrink-0"/>{record ? "Major Incident" : "Major Incident candidate"}</div>
      <h2 className="break-words text-2xl font-bold leading-tight text-[#0E1726]">{incident.title}</h2>
      <div className="flex flex-wrap items-center gap-2"><span className="mr-1 font-mono text-xs font-bold text-[#6D28D9]">{incident.ticket_number}</span><IncidentPriorityBadge priority={incident.priority} tone="brand"/><IncidentStatusBadge status={incident.status} tone="brand"/></div>
      <p className="text-xs text-[#6B7488]">{record?`Declared ${formatDateTime(record.declared_at)}`:"Not yet declared as a major incident"}</p>
      {record?.executive_summary || record?.customer_impact_description ? <div className="space-y-3 border-t border-[#DDD6FE] pt-3">{record.executive_summary ? <div><h3 className="text-xs font-semibold text-[#6B7488]">Situation summary</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#475069]">{record.executive_summary}</p></div> : null}{record.customer_impact_description ? <div><h3 className="text-xs font-semibold text-[#6B7488]">Customer impact</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#475069]">{record.customer_impact_description}</p></div> : null}</div> : null}
    </header>
    <div className="grid gap-5 border-b border-[#E6E9F0] p-5 md:grid-cols-2">
      <section className="min-w-0"><h3 className="text-sm font-bold text-[#0E1726]">Impact</h3><dl className="mt-3 space-y-3"><CommandFact label="Severity" value={`${sentenceCase(incident.impact)} impact · ${sentenceCase(incident.urgency)} urgency`}/>{!affectedServices.length && !affectedCIs.length ? <div><dt className="sr-only">Affected scope</dt><dd className="text-xs leading-5 text-[#6B7488]">Affected services and configuration items not recorded.</dd></div> : <><CommandFact label="Affected services" value={referenceLabels(references.services,affectedServices)}/><CommandFact label="Affected CIs" value={referenceLabels(references.configuration_items,affectedCIs)}/></>}</dl></section>
      <section className="min-w-0 border-t border-[#E6E9F0] pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0"><h3 className="text-sm font-bold text-[#0E1726]">Command ownership</h3><dl className="mt-3 space-y-3">{sharedCommandOwner ? <CommandFact label="Commander & communication lead" value={commander}/> : <><CommandFact label="Commander" value={commander}/><CommandFact label="Communication lead" value={communicationLead}/></>}<CommandFact label="Supporting team" value={incident.assignment_group || "No assignment group"}/></dl></section>
    </div>
    <form onSubmit={save} className="space-y-5 p-5">{message&&<div className="rounded-lg border border-[#DDD6FE] bg-[#FAF8FF] p-3 text-xs font-semibold text-[#5B21B6]">{message}</div>}{error&&<div className="rounded-lg border border-[#DDD6FE] bg-[#F1ECFE] p-3 text-xs text-[#5B21B6]">{error}</div>}
      <details open={!record} className="border-b border-[#E6E9F0] pb-4"><summary className="cursor-pointer text-sm font-semibold text-[#5B21B6]">{record ? "Edit command details" : "Set up command details"}</summary><div className="mt-5 space-y-6">
      <section className="space-y-4"><h3 className="text-sm font-bold text-[#0E1726]">Command & coordination</h3><div className="grid gap-4 md:grid-cols-2"><Field label="Incident commander"><select value={form.incident_commander_id||""} onChange={e=>setForm({...form,incident_commander_id:e.target.value})} className="field"><option value="" disabled={Boolean(record)}>{record ? "Select Incident Manager" : "Current user (default)"}</option>{commanders.map(u=><option key={u.id} value={u.id}>{u.email}</option>)}</select></Field><Field label="Communication lead"><select value={form.communication_lead_id||""} onChange={e=>setForm({...form,communication_lead_id:e.target.value})} className="field"><option value="">Not assigned</option>{users.map(u=><option key={u.id} value={u.id}>{u.email}</option>)}</select></Field><Field label="Communication channel"><input value={form.communication_channel||""} onChange={e=>setForm({...form,communication_channel:e.target.value})} placeholder="Channel or conference reference" className="field"/></Field><Field label="Bridge URL"><input type="url" value={form.bridge_url||""} onChange={e=>setForm({...form,bridge_url:e.target.value})} placeholder="https://..." className="field"/></Field></div></section>
      <section className="space-y-4 border-t border-[#E6E9F0] pt-5"><h3 className="text-sm font-bold text-[#0E1726]">Business impact</h3><Field label="Impacted business units"><input value={units} onChange={e=>setUnits(e.target.value)} placeholder="Payments, Customer Support" className="field"/></Field>
      <div className="grid gap-4 md:grid-cols-2"><ReferenceChecklist title="Affected services" items={references.services} selected={form.affected_service_ids||[]} onChange={values=>setForm({...form,affected_service_ids:values})}/><ReferenceChecklist title="Affected configuration items" items={references.configuration_items} selected={form.affected_configuration_item_ids||[]} onChange={values=>setForm({...form,affected_configuration_item_ids:values})}/></div>
      <Field label="Executive summary"><textarea value={form.executive_summary||""} onChange={e=>setForm({...form,executive_summary:e.target.value})} rows={3} placeholder="Concise operational summary for leadership" className="field"/></Field><Field label="Customer impact"><textarea value={form.customer_impact_description||""} onChange={e=>setForm({...form,customer_impact_description:e.target.value})} rows={3} placeholder="Who is affected and how service is degraded" className="field"/></Field>
      </section></div></details>
      {record&&<div className="space-y-4">
        <details open className="rounded-xl border border-[#DDD6FE] bg-white"><summary className="cursor-pointer list-none px-4 py-3 marker:hidden"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-bold text-[#0E1726]">Restore service</h3><p className="mt-1 text-xs text-[#6B7488]">Owned work and milestones toward restoration.</p></div><div className="flex flex-wrap gap-3 text-xs font-semibold text-[#5B21B6]"><span>{checkpointProgress}</span><span>{openTasks} open response {openTasks===1 ? "task" : "tasks"}</span></div></div></summary><div className="space-y-4 border-t border-[#E6E9F0] p-4">
        <div className="grid gap-4 xl:grid-cols-2">
        <CommandList title="Restoration checkpoints" description="Concrete milestones toward service restoration." inputLabel="Checkpoint" inputValue={checkpointTitle} onInput={setCheckpointTitle} users={users} ownerValue={checkpointOwner} onOwner={setCheckpointOwner} dateLabel="Target time" dateValue={checkpointTarget} onDate={setCheckpointTarget} onAdd={()=>{if(checkpointTitle.trim()){setForm({...form,restoration_checkpoints:[...(form.restoration_checkpoints||[]),{id:crypto.randomUUID(),title:checkpointTitle.trim(),owner_id:checkpointOwner||null,target_at:checkpointTarget?new Date(checkpointTarget).toISOString():null}]});setCheckpointTitle("");setCheckpointOwner("");setCheckpointTarget("");}}}>
          {(form.restoration_checkpoints||[]).map(item=><CommandListRow key={item.id} title={item.title} meta={[item.owner_id?users.find(user=>user.id===item.owner_id)?.email||item.owner_id:null,item.target_at?`Target ${formatDateTime(item.target_at)}`:null].filter(Boolean).join(" · ")} complete={Boolean(item.completed_at)} onToggle={()=>setForm({...form,restoration_checkpoints:(form.restoration_checkpoints||[]).map(value=>value.id===item.id?{...value,completed_at:value.completed_at?null:new Date().toISOString()}:value)})} onRemove={()=>setForm({...form,restoration_checkpoints:(form.restoration_checkpoints||[]).filter(value=>value.id!==item.id)})}/>) }
        </CommandList>
        <CommandList title="Command tasks" description="Owned response work that still needs completion." inputLabel="Task" inputValue={taskTitle} onInput={setTaskTitle} users={users} ownerValue={taskOwner} onOwner={setTaskOwner} dateLabel="Due time" dateValue={taskDue} onDate={setTaskDue} onAdd={()=>{if(taskTitle.trim()){setForm({...form,command_tasks:[...(form.command_tasks||[]),{id:crypto.randomUUID(),title:taskTitle.trim(),owner_id:taskOwner||null,due_at:taskDue?new Date(taskDue).toISOString():null}]});setTaskTitle("");setTaskOwner("");setTaskDue("");}}}>
          {(form.command_tasks||[]).map(item=><CommandListRow key={item.id} title={item.title} meta={[item.owner_id?users.find(user=>user.id===item.owner_id)?.email||item.owner_id:null,item.due_at?`Due ${formatDateTime(item.due_at)}`:null].filter(Boolean).join(" · ")} complete={Boolean(item.completed_at)} onToggle={()=>setForm({...form,command_tasks:(form.command_tasks||[]).map(value=>value.id===item.id?{...value,completed_at:value.completed_at?null:new Date().toISOString()}:value)})} onRemove={()=>setForm({...form,command_tasks:(form.command_tasks||[]).filter(value=>value.id!==item.id)})}/>) }
        </CommandList>
        </div>
        </div></details>
        <details className="rounded-xl border border-[#DDD6FE] bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-[#0E1726]">Coordinate the response <span className="ml-2 text-xs font-normal text-[#6B7488]">Decisions, stakeholders, and communications</span></summary><div className="space-y-4 border-t border-[#E6E9F0] p-4">
        <div className="grid gap-4 xl:grid-cols-2">
        <CommandList title="Decisions" description="Authoritative choices, ownership, and command context." inputLabel="Decision" inputValue={decisionSummary} onInput={setDecisionSummary} users={users} ownerValue={decisionOwner} onOwner={setDecisionOwner} detailLabel="Decision context" detailValue={decisionContext} onDetail={setDecisionContext} onAdd={()=>{if(decisionSummary.trim()){setForm({...form,command_decisions:[...(form.command_decisions||[]),{id:crypto.randomUUID(),summary:decisionSummary.trim(),owner_id:decisionOwner||null,context:decisionContext.trim()||null,recorded_at:new Date().toISOString()}]});setDecisionSummary("");setDecisionOwner("");setDecisionContext("");}}}>
          {(form.command_decisions||[]).map(item=><CommandListRow key={item.id} title={item.summary} detail={item.context||undefined} meta={[item.owner_id?users.find(user=>user.id===item.owner_id)?.email||item.owner_id:null,item.recorded_at?formatDateTime(item.recorded_at):null].filter(Boolean).join(" · ")} onRemove={()=>setForm({...form,command_decisions:(form.command_decisions||[]).filter(value=>value.id!==item.id)})}/>) }
        </CommandList>
        <section className="rounded-xl border border-[#DDD6FE] bg-[#FCFAFF] p-4"><h3 className="text-xs font-bold uppercase tracking-wider text-[#475069]">Stakeholders</h3><p className="mt-1 text-[11px] text-[#6B7488]">People and groups who need command awareness.</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><input aria-label="Stakeholder name" value={stakeholderName} onChange={e=>setStakeholderName(e.target.value)} placeholder="Name" className={commandInputClass}/><input aria-label="Stakeholder role" value={stakeholderRole} onChange={e=>setStakeholderRole(e.target.value)} placeholder="Role" className={commandInputClass}/><input aria-label="Stakeholder contact" value={stakeholderContact} onChange={e=>setStakeholderContact(e.target.value)} placeholder="Contact" className={commandInputClass}/></div><button type="button" onClick={()=>{if(stakeholderName.trim()){setForm({...form,stakeholders:[...(form.stakeholders||[]),{id:crypto.randomUUID(),name:stakeholderName.trim(),role:stakeholderRole.trim()||null,contact:stakeholderContact.trim()||null}]});setStakeholderName("");setStakeholderRole("");setStakeholderContact("");}}} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-[10px] font-bold text-[#5B21B6] hover:bg-[#F1ECFE]"><ListPlus className="h-3.5 w-3.5"/>Add stakeholder</button><div className="mt-3 space-y-2">{(form.stakeholders||[]).length===0?<p className="rounded-lg bg-white p-3 text-center text-[11px] text-[#8A93A5]">No stakeholders recorded.</p>:(form.stakeholders||[]).map(item=><div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-white p-3"><div className="min-w-0"><p className="truncate text-xs font-semibold text-[#0E1726]">{item.name}</p><p className="mt-0.5 truncate text-[10px] text-[#6B7488]">{[item.role,item.contact].filter(Boolean).join(" · ")||"No role or contact"}</p></div><button type="button" onClick={()=>setForm({...form,stakeholders:(form.stakeholders||[]).filter(value=>value.id!==item.id)})} className="rounded p-1.5 text-[#8A93A5] hover:bg-[#F1ECFE] hover:text-[#5B21B6]" aria-label={`Remove ${item.name}`}><Trash2 className="h-3.5 w-3.5"/></button></div>)}</div></section>
        </div>
        <CommunicationLog
          records={form.command_communications||[]}
          users={commanders}
          audience={communicationAudience}
          channel={communicationChannel}
          message={communicationMessage}
          approver={communicationApprover}
          status={communicationStatus}
          onAudience={setCommunicationAudience}
          onChannel={setCommunicationChannel}
          onMessage={setCommunicationMessage}
          onApprover={setCommunicationApprover}
          onStatus={setCommunicationStatus}
          onAdd={()=>{if(communicationAudience.trim()&&communicationChannel.trim()&&communicationMessage.trim()){setForm({...form,command_communications:[...(form.command_communications||[]),{id:crypto.randomUUID(),audience:communicationAudience.trim(),channel:communicationChannel.trim(),message:communicationMessage.trim(),approver_id:communicationApprover||null,status:communicationStatus,recorded_at:new Date().toISOString()}]});setCommunicationAudience("");setCommunicationChannel("");setCommunicationMessage("");setCommunicationApprover("");setCommunicationStatus("DRAFT");}}}
          onStatusChange={(id,status)=>setForm({...form,command_communications:(form.command_communications||[]).map(item=>item.id===id?{...item,status}:item)})}
          onRemove={id=>setForm({...form,command_communications:(form.command_communications||[]).filter(item=>item.id!==id)})}
        />
        </div></details>
      </div>}
      {record&&<details className="rounded-xl border border-[#DDD6FE] bg-[#FCFAFF]"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-[#0E1726]">Restoration and PIR <span className="ml-2 text-xs font-normal text-[#6B7488]">{sentenceCase(String(form.postmortem_status||"PENDING").replaceAll("_"," "))}</span></summary><div className="border-t border-[#E6E9F0] p-4"><div className="grid gap-4 md:grid-cols-2"><Field label="PIR status"><select value={form.postmortem_status||"PENDING"} onChange={e=>setForm({...form,postmortem_status:e.target.value})} className="field"><option value="PENDING">Pending</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETE">Complete</option></select></Field><Field label="PIR document URL"><input type="url" value={form.postmortem_url||""} onChange={e=>setForm({...form,postmortem_url:e.target.value})} className="field"/></Field></div>{record.resolved_at&&<p className="mt-3 text-xs text-[#475069]">Service restored: <strong>{formatDateTime(record.resolved_at)}</strong></p>}{record.bridge_url&&<a href={record.bridge_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#6D28D9] hover:underline">Open response bridge<ExternalLink className="h-3 w-3"/></a>}</div></details>}
      <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end border-t border-[#E6E9F0] bg-white/95 px-5 py-4 backdrop-blur"><button disabled={saving} className="rounded-lg bg-[#6D28D9] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#5B21B6] disabled:opacity-50">{saving?"Saving...":record?"Update command record":"Declare major incident"}</button></div>
    </form>{record && <div className="border-t border-[#E6E9F0] bg-[#FBFAF9] p-5"><CommandActivity incidentId={incident.id} users={users}/></div>}</section>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block text-xs font-semibold text-[#0E1726]">{label}<span className="mt-1.5 block [&_.field]:w-full [&_.field]:rounded-lg [&_.field]:border [&_.field]:border-[#DDE1E8] [&_.field]:bg-white [&_.field]:px-3 [&_.field]:py-2.5 [&_.field]:text-xs [&_.field]:font-normal [&_.field]:outline-none focus-within:[&_.field]:border-[#6D28D9] focus-within:[&_.field]:ring-2 focus-within:[&_.field]:ring-[#6D28D9]/10">{children}</span></label>}

function sentenceCase(value:string){return value.toLowerCase().replace(/^./,letter=>letter.toUpperCase());}

function CommandFact({label,value}:{label:string;value:string}){return <div className="min-w-0"><dt className="text-xs text-[#6B7488]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-[#0E1726]">{value}</dd></div>}

function ReferenceChecklist({title,items,selected,onChange}:{title:string;items:IncidentOperationsReferenceData["services"];selected:string[];onChange:(values:string[])=>void}){return <fieldset className="rounded-xl border border-[#DDD6FE] bg-[#FCFAFF] p-4"><legend className="px-1 text-xs font-bold text-[#0E1726]">{title}</legend><div className="mt-1 max-h-32 space-y-1 overflow-y-auto">{items.length===0?<p className="text-[11px] text-[#8A93A5]">No active records available.</p>:items.map(item=><label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md bg-white px-2.5 py-2 text-xs text-[#475069]"><input type="checkbox" checked={selected.includes(item.id)} onChange={event=>onChange(event.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id))} className="h-3.5 w-3.5 accent-[#6D28D9]"/><span className="truncate">{item.name}</span></label>)}</div></fieldset>}

function referenceLabels(items:IncidentOperationsReferenceData["services"],ids:string[]|undefined){if(!ids?.length)return "Not recorded";return ids.map(id=>items.find(item=>item.id===id)?.name||id).join(", ");}

function CommandList({title,description,inputLabel,inputValue,onInput,onAdd,children,users,ownerValue,onOwner,dateLabel,dateValue,onDate,detailLabel,detailValue,onDetail}:{title:string;description:string;inputLabel:string;inputValue:string;onInput:(value:string)=>void;onAdd:()=>void;children:React.ReactNode;users?:TenantUser[];ownerValue?:string;onOwner?:(value:string)=>void;dateLabel?:string;dateValue?:string;onDate?:(value:string)=>void;detailLabel?:string;detailValue?:string;onDetail?:(value:string)=>void}){const inputId=`${inputLabel.toLowerCase().replaceAll(" ","-")}-date`;return <section id={title==="Restoration checkpoints" ? "command-checkpoints" : title==="Command tasks" ? "command-tasks" : undefined} className="scroll-mt-5 rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] p-4"><h3 className="text-xs font-bold uppercase tracking-wider text-[#475069]">{title}</h3><p className="mt-1 text-[11px] text-[#6B7488]">{description}</p><div className="mt-3 flex gap-2"><input aria-label={inputLabel} value={inputValue} onChange={event=>onInput(event.target.value)} placeholder={`Add ${inputLabel.toLowerCase()}`} className={`${commandInputClass} min-w-0 flex-1`}/><button type="button" onClick={onAdd} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#DDE1E8] bg-white px-3 py-2 text-[10px] font-bold text-[#475069] hover:bg-[#F5F7FA]"><ListPlus className="h-3.5 w-3.5"/>Add</button></div>{onOwner||onDate?<div className="mt-2 grid gap-2 sm:grid-cols-2">{users&&onOwner?<select aria-label={`${inputLabel} owner`} value={ownerValue} onChange={event=>onOwner(event.target.value)} className={commandInputClass}><option value="">No owner</option>{users.map(user=><option key={user.id} value={user.id}>{user.email}</option>)}</select>:null}{onDate?<><label className="sr-only" htmlFor={inputId}>{dateLabel}</label><input id={inputId} aria-label={dateLabel} type="datetime-local" value={dateValue} onChange={event=>onDate(event.target.value)} className={commandInputClass}/></>:null}</div>:null}{onDetail?<input aria-label={detailLabel} value={detailValue} onChange={event=>onDetail(event.target.value)} placeholder={detailLabel} className={`${commandInputClass} mt-2`}/>:null}<div className="mt-3 space-y-2">{React.Children.count(children)?children:<p className="rounded-lg bg-white p-3 text-center text-[11px] text-[#8A93A5]">Nothing recorded yet.</p>}</div></section>}

function CommandListRow({title,detail,meta,complete,onToggle,onRemove}:{title:string;detail?:string;meta?:string;complete?:boolean;onToggle?:()=>void;onRemove:()=>void}){return <div className="flex items-start gap-2 rounded-lg bg-white p-3">{onToggle&&<button type="button" onClick={onToggle} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${complete?"border-[#6D28D9] bg-[#6D28D9] text-white":"border-[#C9CFDA] text-transparent hover:border-[#6D28D9]"}`} aria-label={complete?"Mark incomplete":"Mark complete"}><Check className="h-3 w-3"/></button>}<div className="min-w-0 flex-1"><p className={`text-xs font-semibold ${complete?"text-[#8A93A5] line-through":"text-[#0E1726]"}`}>{title}</p>{detail?<p className="mt-1 text-[11px] leading-5 text-[#475069]">{detail}</p>:null}{meta&&<p className="mt-1 text-[10px] text-[#8A93A5]">{meta}</p>}</div><button type="button" onClick={onRemove} className="rounded p-1.5 text-[#8A93A5] hover:bg-[#F1ECFE] hover:text-[#5B21B6]" aria-label={`Remove ${title}`}><Trash2 className="h-3.5 w-3.5"/></button></div>}

type CommunicationStatus = "DRAFT" | "APPROVED" | "COMMUNICATED";

function CommunicationLog({
  records, users, audience, channel, message, approver, status,
  onAudience, onChannel, onMessage, onApprover, onStatus, onAdd,
  onStatusChange, onRemove,
}: {
  records: NonNullable<MajorIncidentPayload["command_communications"]>;
  users: TenantUser[];
  audience: string;
  channel: string;
  message: string;
  approver: string;
  status: CommunicationStatus;
  onAudience: (value: string) => void;
  onChannel: (value: string) => void;
  onMessage: (value: string) => void;
  onApprover: (value: string) => void;
  onStatus: (value: CommunicationStatus) => void;
  onAdd: () => void;
  onStatusChange: (id: string | undefined, status: CommunicationStatus) => void;
  onRemove: (id: string | undefined) => void;
}) {
  return <section className="rounded-xl border border-[#E6E9F0] bg-[#F8FAFC] p-4">
    <div className="flex items-start gap-2">
      <MessageSquareText className="mt-0.5 h-4 w-4 text-[#6D28D9]" />
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#475069]">Evidence-based communications</h3>
        <p className="mt-1 text-[11px] leading-5 text-[#6B7488]">Record audience, channel, approver, time, and status. This is coordination evidence; it does not send notifications.</p>
        <p className="mt-1 text-[11px] leading-5 text-[#6B7488]">New or changed content must be approved by the named Incident Manager. Communicated means manually recorded, not verified delivery.</p>
      </div>
    </div>
    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <input aria-label="Communication audience" value={audience} onChange={event=>onAudience(event.target.value)} placeholder="Audience" className={commandInputClass} />
      <input aria-label="Communication channel" value={channel} onChange={event=>onChannel(event.target.value)} placeholder="Channel" className={commandInputClass} />
      <select aria-label="Communication approver" value={approver} onChange={event=>onApprover(event.target.value)} className={commandInputClass}>
        <option value="">No approver</option>
        {users.map(user=><option key={user.id} value={user.id}>{user.email}</option>)}
      </select>
      <select aria-label="Communication status" value={status} onChange={event=>onStatus(event.target.value as CommunicationStatus)} className={commandInputClass}>
        <option value="DRAFT">Draft</option>
        <option value="APPROVED">Approved</option>
        <option value="COMMUNICATED">Communicated</option>
      </select>
    </div>
    <textarea aria-label="Communication message" value={message} onChange={event=>onMessage(event.target.value)} placeholder="Concise, evidence-based incident update" rows={3} className={`${commandInputClass} mt-2`} />
    <button type="button" onClick={onAdd} disabled={!audience.trim()||!channel.trim()||!message.trim()} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#DDE1E8] bg-white px-3 py-2 text-[10px] font-bold text-[#475069] hover:bg-[#F5F7FA] disabled:opacity-40"><ListPlus className="h-3.5 w-3.5" />Record communication</button>
    <div className="mt-4 space-y-2">
      {records.length===0 ? <p className="rounded-lg bg-white p-4 text-center text-[11px] text-[#8A93A5]">No command communications recorded.</p> : records.map(item=><article key={item.id} className="rounded-lg bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-[#0E1726]">{item.audience}</span><span className="rounded bg-[#F5F7FA] px-2 py-0.5 text-[9px] font-bold uppercase text-[#6B7488]">{item.channel}</span></div>
            <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-[#475069]">{item.message}</p>
            <p className="mt-2 text-[10px] text-[#8A93A5]">{item.approver_id?`Approver: ${users.find(user=>user.id===item.approver_id)?.email||item.approver_id}`:"No approver"}{item.recorded_at?` · ${formatDateTime(item.recorded_at)}`:""}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <select aria-label={`Status for communication to ${item.audience}`} value={item.status} onChange={event=>onStatusChange(item.id,event.target.value as CommunicationStatus)} className="rounded-md border border-[#DDE1E8] bg-white px-2 py-1.5 text-[10px] font-bold text-[#475069]"><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="COMMUNICATED">Communicated</option></select>
            <button type="button" onClick={()=>onRemove(item.id)} className="rounded p-1.5 text-[#8A93A5] hover:bg-[#F1ECFE] hover:text-[#5B21B6]" aria-label={`Remove communication to ${item.audience}`}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </article>)}
    </div>
  </section>;
}

function CommandActivity({incidentId,users}:{incidentId:string;users:TenantUser[]}){
  const [activities,setActivities]=useState<IncidentActivity[]>([]);
  const load=useCallback(async()=>{const response=await fetch(`/api/itsm/incidents/${incidentId}/activities`,{cache:"no-store"});if(response.ok)setActivities(await response.json());},[incidentId]);
  useEffect(()=>{const request=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(request);},[load]);
  return <ActivityTimeline incidentId={incidentId} activities={activities} onActivityAdded={load} oversight users={users}/>;
}
