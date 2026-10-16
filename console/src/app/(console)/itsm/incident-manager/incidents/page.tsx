"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Bookmark, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import IncidentOversightDrawer from "@/components/itsm/incident-oversight-drawer";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import CompactDateCell from "@/components/itsm/compact-date-cell";
import { formatDateTime } from "@/lib/itsm-format";
import type { IncidentOperationsDashboard, IncidentOperationsItem, IncidentOperationsQueueItem, IncidentOperationsReferenceData, IncidentSavedView, IncidentSavedViewFilters } from "@/lib/itsm-types";

const PAGE_SIZE = 20;
const statuses = ["", "NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED", "CANCELLED"];
const priorities = ["", "P1", "P2", "P3", "P4"];
const attentionOptions = [
  ["", "All attention states"], ["WATCH", "Requires attention"], ["PRIORITY", "P1 / P2"],
  ["SLA_AT_RISK", "SLA at risk"], ["SLA_BREACHED", "SLA breached"], ["STUCK", "Stuck / idle"],
] as const;
const attentionLabels = {
  HIGH_PRIORITY: "High priority", SLA_AT_RISK: "SLA at risk",
  SLA_BREACHED: "SLA breached", STUCK_IDLE: "Stuck / idle",
} as const;

function formatDuration(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const absolute = Math.abs(Math.round(seconds));
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const value = hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  return seconds < 0 ? `${value} overdue` : `${value} remaining`;
}

export default function IncidentManagerQueuePage() {
  const [rows, setRows] = useState<IncidentOperationsQueueItem[]>([]);
  const [dashboard, setDashboard] = useState<IncidentOperationsDashboard | null>(null);
  const [references, setReferences] = useState<IncidentOperationsReferenceData | null>(null);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [attention, setAttention] = useState("");
  const [assignmentGroup, setAssignmentGroup] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const [sortBy, setSortBy] = useState("priority");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextWarning, setContextWarning] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<IncidentSavedView[]>([]);
  const [viewName, setViewName] = useState("");
  const [savingView, setSavingView] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

  const loadSavedViews = useCallback(async () => {
    const response = await fetch("/api/itsm/incidents/operations/saved-views", { cache: "no-store" });
    if (response.ok) setSavedViews(await response.json());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const request = window.setTimeout(() => {
      const initialSearch = params.get("search") || "";
      setSearchInput(initialSearch); setSearch(initialSearch); setStatus(params.get("status") || "");
      setPriority(params.get("priority") || ""); setAttention(params.get("attention") || "");
      setAssignmentGroup(params.get("assignment_group") || ""); setAssigneeId(params.get("assignee_id") || "");
      setServiceId(params.get("service_id") || ""); setCategoryId(params.get("category_id") || "");
      setUnassigned(params.get("unassigned") === "true");
      setSortBy(params.get("sort_by") || "priority");
    }, 0);
    return () => window.clearTimeout(request);
  }, []);

  useEffect(() => {
    const request = window.setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(request);
  }, [searchInput]);

  const loadContext = useCallback(async () => {
    setContextWarning(null);
    try {
      const [dashboardResponse, referenceResponse] = await Promise.all([
        fetch("/api/itsm/incidents/operations/dashboard", { cache: "no-store" }),
        fetch("/api/itsm/incidents/operations/reference-data", { cache: "no-store" }),
      ]);
      if (!dashboardResponse.ok || !referenceResponse.ok) throw new Error("context unavailable");
      setDashboard(await dashboardResponse.json());
      setReferences(await referenceResponse.json());
    } catch {
      setContextWarning("Workload filter options are temporarily unavailable; the incident queue is still usable.");
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), sort_by: sortBy });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (attention) params.set("attention", attention);
    if (assignmentGroup) params.set("assignment_group", assignmentGroup);
    if (assigneeId) params.set("assignee_id", assigneeId);
    if (serviceId) params.set("service_id", serviceId);
    if (categoryId) params.set("category_id", categoryId);
    if (unassigned) params.set("unassigned", "true");
    try {
      const queueResponse = await fetch(`/api/itsm/incidents/operations/queue?${params}`, { cache: "no-store" });
      if (queueResponse.status === 401) { window.location.assign("/itsm/login?next=%2Fitsm%2Fincident-manager%2Fincidents"); return; }
      if (!queueResponse.ok) throw new Error("Unable to load the operational incident queue");
      const queue = await queueResponse.json();
      setRows(Array.isArray(queue.items) ? queue.items : []);
      setTotal(typeof queue.total === "number" ? queue.total : 0);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Unable to load incidents");
    } finally { setLoading(false); }
  }, [assigneeId, assignmentGroup, attention, categoryId, offset, priority, search, serviceId, sortBy, status, unassigned]);

  useEffect(() => { const request = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(request); }, [load]);
  useEffect(() => { const request = window.setTimeout(() => void loadContext(), 0); return () => window.clearTimeout(request); }, [loadContext]);
  useEffect(() => { const request = window.setTimeout(() => void loadSavedViews(), 0); return () => window.clearTimeout(request); }, [loadSavedViews]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (attention) params.set("attention", attention);
    if (assignmentGroup) params.set("assignment_group", assignmentGroup);
    if (assigneeId) params.set("assignee_id", assigneeId);
    if (serviceId) params.set("service_id", serviceId);
    if (categoryId) params.set("category_id", categoryId);
    if (unassigned) params.set("unassigned", "true");
    if (sortBy !== "priority") params.set("sort_by", sortBy);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [assigneeId, assignmentGroup, attention, categoryId, priority, search, serviceId, sortBy, status, unassigned]);

  const groups = dashboard?.workload.assignment_groups || [];
  const assignees = dashboard?.workload.assignees || [];
  const hasFilters = Boolean(search || status || priority || attention || assignmentGroup || assigneeId || serviceId || categoryId || unassigned || sortBy !== "priority");
  const clearFilters = () => { setSearchInput(""); setSearch(""); setStatus(""); setPriority(""); setAttention(""); setAssignmentGroup(""); setAssigneeId(""); setServiceId(""); setCategoryId(""); setUnassigned(false); setSortBy("priority"); setOffset(0); };
  const currentFilters = (): IncidentSavedViewFilters => ({
    ...(search.trim() ? {search: search.trim()} : {}), ...(status ? {status} : {}),
    ...(priority ? {priority} : {}), ...(attention ? {attention: attention as IncidentSavedViewFilters["attention"]} : {}),
    ...(assignmentGroup ? {assignment_group: assignmentGroup} : {}), ...(assigneeId ? {assignee_id: assigneeId} : {}),
    ...(serviceId ? {service_id: serviceId} : {}), ...(categoryId ? {category_id: categoryId} : {}),
    unassigned, sort_by: sortBy as IncidentSavedViewFilters["sort_by"],
  });
  const applyView = (view: IncidentSavedView) => {
    const filters=view.filters; setSearchInput(filters.search||""); setSearch(filters.search||""); setStatus(filters.status||""); setPriority(filters.priority||"");
    setAttention(filters.attention||""); setAssignmentGroup(filters.assignment_group||""); setAssigneeId(filters.assignee_id||"");
    setServiceId(filters.service_id||""); setCategoryId(filters.category_id||"");
    setUnassigned(Boolean(filters.unassigned)); setSortBy(filters.sort_by||"priority"); setOffset(0);
  };
  const saveView = async () => {
    if (!viewName.trim()) return;
    setSavingView(true); setError(null);
    try {
      const response=await fetch("/api/itsm/incidents/operations/saved-views", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:viewName.trim(),filters:currentFilters()})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(typeof body.detail==="string"?body.detail:"Unable to save this queue view");
      setViewName(""); await loadSavedViews();
    } catch(reason:unknown) { setError(reason instanceof Error?reason.message:"Unable to save this queue view"); }
    finally { setSavingView(false); }
  };
  const deleteView = async (view: IncidentSavedView) => {
    if (!window.confirm(`Delete saved view "${view.name}"?`)) return;
    const response=await fetch(`/api/itsm/incidents/operations/saved-views/${view.id}`,{method:"DELETE"});
    if(response.ok) await loadSavedViews(); else setError("Unable to delete this saved view");
  };
  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + rows.length, total);
  const refreshAll = () => { void load(); void loadContext(); };

  return <div className="role-portal mx-auto max-w-[1440px] space-y-5">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.12em] text-[#6D28D9]">Incident operations</p><h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[#0E1726]">Incidents</h1><p className="mt-1 text-sm text-[#667085]">Prioritize, assign, and monitor the active incident queue.</p></div><button onClick={refreshAll} disabled={loading} className="inline-flex w-fit items-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] shadow-sm transition hover:border-[#A78BFA] hover:bg-[#F9FAFB] disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 text-[#6D28D9] ${loading ? "animate-spin" : ""}`}/>Refresh queue</button></header>

    <section className="rounded-2xl border border-[#E4E7EC] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)] sm:p-5">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-sm font-bold text-[#101828]">Find incidents</h2><p className="mt-1 text-xs text-[#667085]">Use the core filters first. Open more filters only when you need a narrower operational view.</p></div>{hasFilters ? <button type="button" onClick={clearFilters} className="w-fit text-xs font-semibold text-[#6941C6] hover:underline">Clear all filters</button> : null}</div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(340px,1.4fr)_repeat(4,minmax(132px,.55fr))]">
        <label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93A5]"/><span className="sr-only">Search incidents</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search ticket number, title, or description" className="w-full rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] py-2.5 pl-9 pr-3 text-xs outline-none transition focus:border-[#6D28D9] focus:bg-white focus:ring-2 focus:ring-[#6D28D9]/10"/></label>
        <Filter value={status} onChange={value=>{setStatus(value);setOffset(0);}} label="Filter by status" options={statuses.map(value => [value, value ? value.replaceAll("_", " ") : "All statuses"] as const)}/>
        <Filter value={priority} onChange={value=>{setPriority(value);setOffset(0);}} label="Filter by priority" options={priorities.map(value => [value, value || "All priorities"] as const)}/>
        <Filter value={attention} onChange={value=>{setAttention(value);setOffset(0);}} label="Filter by attention" options={attentionOptions}/>
        <button type="button" onClick={()=>setAdvancedFiltersOpen(open=>!open)} aria-expanded={advancedFiltersOpen} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#D0D5DD] bg-white px-3 py-2.5 text-xs font-semibold text-[#344054] transition hover:border-[#A78BFA] hover:bg-[#F9FAFB]"><SlidersHorizontal className="h-3.5 w-3.5 text-[#6941C6]"/>More filters<ChevronDown className={`h-3.5 w-3.5 transition ${advancedFiltersOpen?"rotate-180":""}`}/></button>
      </div>
      {advancedFiltersOpen ? <div className="mt-3 grid gap-2 border-t border-[#EEF1F5] pt-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(140px,1fr))_auto_auto]">
        <Filter value={assignmentGroup} onChange={value=>{setAssignmentGroup(value);setOffset(0);}} label="Filter by assignment group" options={[["", "All groups"], ...groups.map(entry => [entry.key === "Unassigned" ? "__UNASSIGNED__" : entry.key, entry.label] as const)]}/>
        <Filter value={assigneeId} onChange={value=>{setAssigneeId(value);setUnassigned(false);setOffset(0);}} label="Filter by assignee" options={[["", "All assignees"], ...assignees.filter(entry => entry.key !== "Unassigned").map(entry => [entry.key, entry.label] as const)]}/>
        <Filter value={serviceId} onChange={value=>{setServiceId(value);setOffset(0);}} label="Filter by service" options={[["", "All services"], ...(references?.services || []).map(item => [item.id, item.name] as const)]}/>
        <Filter value={categoryId} onChange={value=>{setCategoryId(value);setOffset(0);}} label="Filter by category" options={[["", "All categories"], ...(references?.categories || []).map(item => [item.id, item.name] as const)]}/>
        <button type="button" aria-pressed={unassigned} onClick={()=>{setUnassigned(value=>!value);setAssigneeId("");setOffset(0);}} className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition ${unassigned?"border-[#A78BFA] bg-[#F1ECFE] text-[#5B21B6]":"border-[#E6E9F0] bg-white text-[#475069] hover:border-[#DDD6FE] hover:bg-[#FAF8FF]"}`}>No individual assignee</button>
        <Filter value={sortBy} onChange={value=>{setSortBy(value);setOffset(0);}} label="Sort incidents" options={[["priority", "Priority first"], ["sla_due", "SLA due first"], ["updated", "Recently updated"]]}/>
      </div> : null}
      <div className="mt-4 flex flex-col gap-3 border-t border-[#EAECF0] pt-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#667085]"><Bookmark className="h-3.5 w-3.5 text-[#6941C6]"/>Saved views</span>{savedViews.length ? savedViews.map(view=><span key={view.id} className="inline-flex overflow-hidden rounded-full border border-[#E4E7EC] bg-[#F9FAFB]"><button type="button" onClick={()=>applyView(view)} className="px-3 py-1.5 text-xs font-semibold text-[#475467] hover:bg-[#F2F4F7] hover:text-[#6941C6]">{view.name}</button><button type="button" onClick={()=>void deleteView(view)} aria-label={`Delete ${view.name}`} className="border-l border-[#E4E7EC] px-2 text-[#98A2B3] hover:text-[#6941C6]"><Trash2 className="h-3 w-3"/></button></span>) : <span className="text-xs text-[#98A2B3]">No saved views yet.</span>}</div>
        <div className="flex gap-2"><label className="sr-only" htmlFor="saved-view-name">Saved view name</label><input id="saved-view-name" value={viewName} onChange={event=>setViewName(event.target.value)} maxLength={100} placeholder="View name" className="min-w-0 rounded-lg border border-[#E6E9F0] px-3 py-2 text-xs outline-none focus:border-[#6D28D9]"/><button type="button" onClick={()=>void saveView()} disabled={!viewName.trim()||savingView} className="rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-semibold text-white hover:bg-[#5B21B6] disabled:opacity-40">{savingView?"Saving…":"Save view"}</button></div>
      </div>
    </section>

    {contextWarning ? <div className="rounded-lg border border-[#E7DDBC] bg-[#FFFBF0] px-4 py-2.5 text-xs text-[#735B28]">{contextWarning}</div> : null}
    {error ? <div className="flex items-center gap-2 rounded-xl border border-[#E4D4DE] bg-[#FFF8FB] p-4 text-xs text-[#7B405C]"><AlertCircle className="h-4 w-4"/>{error}<button onClick={load} className="ml-auto font-bold underline">Retry</button></div> : null}
    <section className="overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]">
      <div className="flex flex-col gap-1 border-b border-[#EAECF0] px-5 py-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-sm font-bold text-[#101828]">Incident queue</h2><p className="mt-1 text-xs text-[#667085]">Select an incident to review its full operational context.</p></div><span className="text-xs font-medium text-[#667085]">{total} {total === 1 ? "incident" : "incidents"}</span></div>
      <div className="divide-y divide-[#EEF1F5] md:hidden">
        {loading ? Array.from({length:4}).map((_,index)=><div key={index} className="animate-pulse p-4"><div className="h-24 rounded-xl bg-[#EEF1F5]"/></div>) : rows.length === 0 ? <QueueEmptyState hasFilters={hasFilters} onClear={clearFilters}/> : rows.map(({incident,operations})=><button key={incident.id} type="button" onClick={()=>setSelected(incident.id)} className="block w-full p-4 text-left transition hover:bg-[#FAF8FF]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] font-bold text-[#6D28D9]">{incident.ticket_number}</span>{incident.is_major_incident?<span className="rounded bg-[#F1ECFE] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#5B21B6]">Major</span>:null}</div><p className="mt-1.5 text-sm font-semibold text-[#0E1726]">{incident.title}</p></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#8A93A5]"/></div><div className="mt-3 flex flex-wrap gap-2"><IncidentStatusBadge status={incident.status} tone="brand"/><IncidentPriorityBadge priority={incident.priority} tone="brand"/></div><div className="mt-3 grid grid-cols-2 gap-3 border-t border-[#EEF1F5] pt-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#8A93A5]">SLA / attention</p><div className="mt-1"><SlaCell item={operations||undefined} fallback={incident.sla_status}/></div></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#8A93A5]">Ownership</p><p className="mt-1 text-xs font-semibold text-[#475069]">{incident.assignment_group||"Unassigned group"}</p><p className="mt-1 truncate text-[10px] text-[#8A93A5]">{operations?.assignee_email||incident.assignee_id||"No assignee"}</p></div></div><p className="mt-3 text-[10px] text-[#8A93A5]">Updated {formatDateTime(incident.updated_at)}</p></button>)}
      </div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-left"><thead className="border-b border-[#EAECF0] bg-[#F9FAFB]"><tr>{["Incident","State","Priority","SLA / attention","Ownership","Created / Updated"].map(heading=><th key={heading} className="px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-[.09em] text-[#667085] whitespace-nowrap">{heading}</th>)}</tr></thead>
      <tbody className="divide-y divide-[#EEF1F5]">{loading ? Array.from({length:6}).map((_,index)=><tr key={index} className="animate-pulse"><td colSpan={6} className="px-3.5 py-3"><div className="h-5 rounded bg-[#EEF1F5]"/></td></tr>) : rows.length === 0 ? <tr><td colSpan={6} className="py-20 text-center"><SlidersHorizontal className="mx-auto h-8 w-8 text-[#A78BFA]"/><p className="mt-3 text-sm font-bold">{hasFilters ? "No incidents match these filters" : "No incidents in this queue"}</p><p className="mt-1 text-xs text-[#6B7488]">{hasFilters ? "Adjust or clear the supported operational filters." : "Incidents will appear here when they are created for this workspace."}</p>{hasFilters ? <button type="button" onClick={clearFilters} className="mt-4 rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]">Clear filters</button> : null}</td></tr> : rows.map(({incident, operations}) => <tr key={incident.id} onClick={()=>setSelected(incident.id)} className="cursor-pointer transition hover:bg-[#FAF8FF]"><td className="px-3.5 py-2.5"><div className="flex items-center gap-2"><span className="font-mono text-[11px] font-bold text-[#6D28D9]">{incident.ticket_number}</span>{incident.is_major_incident ? <span className="rounded bg-[#F1ECFE] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#5B21B6]">Major</span> : null}</div><p className="mt-1 max-w-sm truncate text-xs font-semibold text-[#0E1726]">{incident.title}</p></td><td className="px-3.5 py-2.5 whitespace-nowrap"><IncidentStatusBadge status={incident.status} tone="brand"/></td><td className="px-3.5 py-2.5 whitespace-nowrap"><IncidentPriorityBadge priority={incident.priority} tone="brand"/></td><td className="px-3.5 py-2.5"><SlaCell item={operations || undefined} fallback={incident.sla_status}/></td><td className="px-3.5 py-2.5 text-xs"><p className="font-semibold text-[#475069]">{incident.assignment_group || "Unassigned group"}</p><p className="mt-1 max-w-[170px] truncate text-[10px] text-[#8A93A5]">{operations?.assignee_email || incident.assignee_id || "No assignee"}</p></td><td className="whitespace-nowrap px-3.5 py-2.5"><CompactDateCell createdAt={incident.created_at} updatedAt={incident.updated_at} /></td></tr>)}</tbody></table></div>
      <footer className="flex items-center justify-between border-t border-[#EAECF0] bg-[#F9FAFB] px-5 py-3 text-xs text-[#667085]"><span>{offset===0&&total<=PAGE_SIZE?`${total} incidents`:`${shownFrom}-${shownTo} of ${total} incidents`}</span>{(offset>0||total>PAGE_SIZE)&&<div className="flex gap-2"><button disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-PAGE_SIZE))} className="inline-flex items-center gap-1 rounded-lg border border-[#D0D5DD] bg-white px-3 py-1.5 font-semibold text-[#344054] hover:bg-[#F9FAFB] disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5"/>Previous</button><button disabled={offset+rows.length>=total||loading} onClick={()=>setOffset(offset+PAGE_SIZE)} className="inline-flex items-center gap-1 rounded-lg border border-[#D0D5DD] bg-white px-3 py-1.5 font-semibold text-[#344054] hover:bg-[#F9FAFB] disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5"/></button></div>}</footer>
    </section>
    {selected ? <IncidentOversightDrawer incidentId={selected} operations={rows.find(row => row.incident.id === selected)?.operations || undefined} backLabel="Back to Incident Queue" onClose={()=>setSelected(null)} onChanged={load}/> : null}
  </div>;
}

function Filter({value,onChange,label,options}:{value:string;onChange:(value:string)=>void;label:string;options:ReadonlyArray<readonly [string,string]>}) {
  return <select aria-label={label} value={value} onChange={(event)=>onChange(event.target.value)} className="min-w-0 rounded-lg border border-[#E6E9F0] bg-white px-3 py-2.5 text-xs text-[#475069] outline-none transition focus:border-[#6D28D9] focus:ring-2 focus:ring-[#6D28D9]/10">{options.map(([optionValue,optionLabel])=><option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>;
}

function QueueEmptyState({hasFilters,onClear}:{hasFilters:boolean;onClear:()=>void}) {
  return <div className="px-5 py-14 text-center"><SlidersHorizontal className="mx-auto h-8 w-8 text-[#A78BFA]"/><p className="mt-3 text-sm font-bold">{hasFilters?"No incidents match these filters":"No incidents in this queue"}</p><p className="mt-1 text-xs text-[#6B7488]">{hasFilters?"Adjust or clear the supported operational filters.":"Incidents will appear here when they are created for this workspace."}</p>{hasFilters?<button type="button" onClick={onClear} className="mt-4 rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]">Clear filters</button>:null}</div>;
}

function SlaCell({item,fallback}:{item?:IncidentOperationsItem;fallback:string}) {
  const status=item?.sla.status||fallback||"NO_SLA";
  const tone=status==="BREACHED"?"border border-[#E4D4DE] bg-[#FFF8FB] text-[#7B405C]":status==="AT_RISK"?"border border-[#E7DDBC] bg-[#FFFBF0] text-[#735B28]":"border border-[#E4E7EC] bg-[#F9FAFB] text-[#475467]";
  const duration=formatDuration(item?.sla.remaining_seconds);
  return <div className="max-w-[220px]"><div className="flex flex-wrap items-center gap-1.5"><span className={`rounded-md px-2 py-1 text-[10px] font-bold ${tone}`}>{status.replaceAll("_"," ")}</span>{duration ? <span className="text-[10px] text-[#6B7488]">{duration}</span> : null}</div>{item?.attention_reasons.length ? <div className="mt-1.5 flex flex-wrap gap-1">{item.attention_reasons.map(reason=><span key={reason} className="rounded border border-[#E6E9F0] bg-white px-1.5 py-0.5 text-[9px] font-semibold text-[#6B7488]">{attentionLabels[reason]}</span>)}</div> : null}</div>;
}
