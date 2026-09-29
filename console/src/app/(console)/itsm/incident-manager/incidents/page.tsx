"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Bookmark, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import IncidentOversightDrawer from "@/components/itsm/incident-oversight-drawer";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";
import { formatDateTime } from "@/lib/itsm-format";
import type { IncidentOperationsDashboard, IncidentOperationsItem, IncidentOperationsQueueItem, IncidentSavedView, IncidentSavedViewFilters } from "@/lib/itsm-types";

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
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [attention, setAttention] = useState("");
  const [assignmentGroup, setAssignmentGroup] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
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
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showSaveView, setShowSaveView] = useState(false);

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
      const response = await fetch("/api/itsm/incidents/operations/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("context unavailable");
      setDashboard(await response.json());
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
  }, [assigneeId, assignmentGroup, attention, offset, priority, search, sortBy, status, unassigned]);

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
    if (unassigned) params.set("unassigned", "true");
    if (sortBy !== "priority") params.set("sort_by", sortBy);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [assigneeId, assignmentGroup, attention, priority, search, sortBy, status, unassigned]);

  const groups = dashboard?.workload.assignment_groups || [];
  const assignees = dashboard?.workload.assignees || [];
  const hasFilters = Boolean(search || status || priority || attention || assignmentGroup || assigneeId || unassigned || sortBy !== "priority");
  const advancedFilterCount = [assignmentGroup, assigneeId, unassigned, sortBy !== "priority"].filter(Boolean).length;
  const clearFilters = () => { setSearchInput(""); setSearch(""); setStatus(""); setPriority(""); setAttention(""); setAssignmentGroup(""); setAssigneeId(""); setUnassigned(false); setSortBy("priority"); setOffset(0); };
  const currentFilters = (): IncidentSavedViewFilters => ({
    ...(search.trim() ? {search: search.trim()} : {}), ...(status ? {status} : {}),
    ...(priority ? {priority} : {}), ...(attention ? {attention: attention as IncidentSavedViewFilters["attention"]} : {}),
    ...(assignmentGroup ? {assignment_group: assignmentGroup} : {}), ...(assigneeId ? {assignee_id: assigneeId} : {}),
    unassigned, sort_by: sortBy as IncidentSavedViewFilters["sort_by"],
  });
  const applyView = (view: IncidentSavedView) => {
    const filters=view.filters; setSearchInput(filters.search||""); setSearch(filters.search||""); setStatus(filters.status||""); setPriority(filters.priority||"");
    setAttention(filters.attention||""); setAssignmentGroup(filters.assignment_group||""); setAssigneeId(filters.assignee_id||"");
    setUnassigned(Boolean(filters.unassigned)); setSortBy(filters.sort_by||"priority"); setOffset(0);
  };
  const saveView = async () => {
    if (!viewName.trim()) return;
    setSavingView(true); setError(null);
    try {
      const response=await fetch("/api/itsm/incidents/operations/saved-views", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:viewName.trim(),filters:currentFilters()})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(typeof body.detail==="string"?body.detail:"Unable to save this queue view");
      setViewName(""); setShowSaveView(false); await loadSavedViews();
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

  return <div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-bold tracking-tight text-[#0E1726]">Incident Queue</h1><p className="mt-1 text-sm text-[#6B7488]">Prioritize and coordinate active incidents.</p></div>
      <button onClick={refreshAll} disabled={loading} className="inline-flex w-fit items-center gap-2 rounded-lg border border-[#E6E9F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#475069] shadow-sm transition hover:border-[#DDD6FE] hover:bg-[#F5F7FA] hover:text-[#0E1726] disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 text-[#6D28D9] ${loading ? "animate-spin" : ""}`}/>Refresh queue</button>
    </header>

    <section className="overflow-hidden rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)]">
      <div className="p-4">
        <div className="mb-3"><h2 className="text-sm font-bold text-[#0E1726]">Find incidents</h2><p className="mt-0.5 text-xs text-[#6B7488]">Use the core filters first. Open more filters only when you need a narrower operational view.</p></div>
        <div className="grid gap-2 lg:grid-cols-[minmax(280px,1fr)_repeat(3,minmax(135px,auto))_auto]">
          <label className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93A5]"/><span className="sr-only">Search incidents</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search ticket number, title, or description" className="w-full rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] py-2.5 pl-9 pr-3 text-xs outline-none transition focus:border-[#6D28D9] focus:bg-white focus:ring-2 focus:ring-[#6D28D9]/10"/></label>
          <Filter value={status} onChange={value=>{setStatus(value);setOffset(0);}} label="Filter by status" options={statuses.map(value => [value, value ? value.replaceAll("_", " ") : "All statuses"] as const)}/>
          <Filter value={priority} onChange={value=>{setPriority(value);setOffset(0);}} label="Filter by priority" options={priorities.map(value => [value, value || "All priorities"] as const)}/>
          <Filter value={attention} onChange={value=>{setAttention(value);setOffset(0);}} label="Filter by attention" options={attentionOptions}/>
          <button type="button" onClick={()=>setShowMoreFilters(value=>!value)} aria-expanded={showMoreFilters} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#E6E9F0] bg-white px-3 py-2.5 text-xs font-semibold text-[#475069] transition hover:border-[#DDD6FE] hover:bg-[#F5F7FA]"><SlidersHorizontal className="h-3.5 w-3.5 text-[#6D28D9]"/>More filters{advancedFilterCount ? <span className="rounded-full bg-[#F1ECFE] px-1.5 py-0.5 text-[9px] font-bold text-[#6D28D9]">{advancedFilterCount}</span> : null}<ChevronDown className={`h-3.5 w-3.5 transition ${showMoreFilters?"rotate-180":""}`}/></button>
        </div>
        {showMoreFilters ? <div className="mt-3 flex flex-col gap-2 border-t border-[#EEF1F5] pt-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Filter value={assignmentGroup} onChange={value=>{setAssignmentGroup(value);setOffset(0);}} label="Filter by assignment group" options={[["", "All groups"], ...groups.map(entry => [entry.key === "Unassigned" ? "__UNASSIGNED__" : entry.key, entry.label] as const)]}/>
          <Filter value={assigneeId} onChange={value=>{setAssigneeId(value);setUnassigned(false);setOffset(0);}} label="Filter by assignee" options={[["", "All assignees"], ...assignees.filter(entry => entry.key !== "Unassigned").map(entry => [entry.key, entry.label] as const)]}/>
          <button type="button" aria-pressed={unassigned} onClick={()=>{setUnassigned(value=>!value);setAssigneeId("");setOffset(0);}} className={`rounded-lg border px-3 py-2.5 text-xs font-semibold transition ${unassigned?"border-[#A78BFA] bg-[#F1ECFE] text-[#5B21B6]":"border-[#E6E9F0] bg-white text-[#475069] hover:border-[#DDD6FE] hover:bg-[#F5F7FA]"}`}>No individual assignee</button>
          <Filter value={sortBy} onChange={value=>{setSortBy(value);setOffset(0);}} label="Sort incidents" options={[["priority", "Priority first"], ["sla_due", "SLA due first"], ["updated", "Recently updated"]]}/>
        </div> : null}
        {hasFilters ? <div className="mt-3 flex items-center justify-between border-t border-[#EEF1F5] pt-3"><span className="text-[11px] text-[#6B7488]">Filtered operational view</span><button type="button" onClick={clearFilters} className="text-xs font-semibold text-[#6D28D9] hover:underline">Clear filters</button></div> : null}
      </div>
      <div className="flex flex-col gap-3 border-t border-[#E6E9F0] bg-[#F8FAFC] px-4 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7488]"><Bookmark className="h-3.5 w-3.5 text-[#6D28D9]"/>Saved views</span>{savedViews.length ? savedViews.map(view=><span key={view.id} className="inline-flex overflow-hidden rounded-lg border border-[#E6E9F0] bg-white"><button type="button" onClick={()=>applyView(view)} className="px-2.5 py-1.5 text-xs font-semibold text-[#475069] hover:bg-[#F1ECFE] hover:text-[#5B21B6]">{view.name}</button><button type="button" onClick={()=>void deleteView(view)} aria-label={`Delete ${view.name}`} className="border-l border-[#E6E9F0] px-2 text-[#8A93A5] hover:text-[#5B21B6]"><Trash2 className="h-3 w-3"/></button></span>) : <span className="text-xs text-[#8A93A5]">No saved views yet.</span>}</div>
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <button type="button" onClick={()=>setShowSaveView(value=>!value)} aria-expanded={showSaveView} className="whitespace-nowrap text-xs font-semibold text-[#6D28D9] hover:underline">{showSaveView?"Cancel":"Save current view"}</button>
          {showSaveView ? <div className="flex gap-2"><label className="sr-only" htmlFor="saved-view-name">Saved view name</label><input id="saved-view-name" value={viewName} onChange={event=>setViewName(event.target.value)} maxLength={100} placeholder="View name" className="min-w-0 rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-xs outline-none focus:border-[#6D28D9]"/><button type="button" onClick={()=>void saveView()} disabled={!viewName.trim()||savingView} className="rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-semibold text-white hover:bg-[#5B21B6] disabled:opacity-40">{savingView?"Saving…":"Save view"}</button></div> : null}
        </div>
      </div>
    </section>

    {contextWarning ? <div className="rounded-lg border border-[#F4D7A1] bg-[#FFF9ED] px-4 py-2.5 text-xs text-[#8A4B08]">{contextWarning}</div> : null}
    {error ? <div className="flex items-center gap-2 rounded-xl border border-[#F4C7C3] bg-[#FFF5F4] p-4 text-xs text-[#A61B1B]"><AlertCircle className="h-4 w-4"/>{error}<button onClick={load} className="ml-auto font-bold underline">Retry</button></div> : null}
    <section className="overflow-hidden rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)]">
      <div className="divide-y divide-[#EEF1F5] md:hidden">
        {loading ? Array.from({length:4}).map((_,index)=><div key={index} className="animate-pulse p-4"><div className="h-24 rounded-xl bg-[#EEF1F5]"/></div>) : rows.length === 0 ? <QueueEmptyState hasFilters={hasFilters} onClear={clearFilters}/> : rows.map(({incident,operations})=><button key={incident.id} type="button" onClick={()=>setSelected(incident.id)} className="block w-full p-4 text-left transition hover:bg-[#F8FAFC]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] font-bold text-[#6D28D9]">{incident.ticket_number}</span>{incident.is_major_incident?<span className="rounded bg-[#F1ECFE] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#5B21B6]">Major</span>:null}</div><p className="mt-1.5 text-sm font-semibold text-[#0E1726]">{incident.title}</p></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#8A93A5]"/></div><div className="mt-3 flex flex-wrap gap-2"><IncidentPriorityBadge priority={incident.priority}/><IncidentStatusBadge status={incident.status}/></div><div className="mt-3 border-t border-[#EEF1F5] pt-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-[#8A93A5]">Why attention</p><div className="mt-1"><AttentionCell item={operations||undefined}/></div></div><div className="mt-3 grid grid-cols-2 gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#8A93A5]">SLA</p><div className="mt-1"><SlaCell item={operations||undefined} fallback={incident.sla_status} showAttention={false}/></div></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#8A93A5]">Ownership</p><p className="mt-1 text-xs font-semibold text-[#475069]">{incident.assignment_group||"Unassigned group"}</p><p className="mt-1 truncate text-[10px] text-[#8A93A5]">{operations?.assignee_email||incident.assignee_id||"No assignee"}</p></div></div><p className="mt-3 text-[10px] text-[#8A93A5]">Updated {formatDateTime(incident.updated_at)}</p></button>)}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1120px] text-left">
          <thead className="border-b border-[#E6E9F0] bg-[#FBFAF9]"><tr>{["Incident","Why attention","Priority / state","SLA","Ownership","Updated","Action"].map(heading=><th key={heading} className={`px-4 py-3 text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488] ${heading==="Action"?"text-right":""}`}>{heading}</th>)}</tr></thead>
          <tbody className="divide-y divide-[#EEF1F5]">
            {loading ? Array.from({length:6}).map((_,index)=><tr key={index} className="animate-pulse"><td colSpan={7} className="px-4 py-4"><div className="h-5 rounded bg-[#EEF1F5]"/></td></tr>) : rows.length === 0 ? <tr><td colSpan={7} className="py-20 text-center"><SlidersHorizontal className="mx-auto h-8 w-8 text-[#A78BFA]"/><p className="mt-3 text-sm font-bold">{hasFilters ? "No incidents match these filters" : "No incidents in this queue"}</p><p className="mt-1 text-xs text-[#6B7488]">{hasFilters ? "Adjust or clear the supported operational filters." : "Incidents will appear here when they are created for this workspace."}</p>{hasFilters ? <button type="button" onClick={clearFilters} className="mt-4 rounded-lg border border-[#E6E9F0] bg-white px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]">Clear filters</button> : null}</td></tr> : rows.map(({incident, operations}) => (
              <tr key={incident.id} onClick={()=>setSelected(incident.id)} className="cursor-pointer transition hover:bg-[#F8FAFC]">
                <td className="px-4 py-4"><div className="flex items-center gap-2"><span className="font-mono text-[11px] font-bold text-[#6D28D9]">{incident.ticket_number}</span>{incident.is_major_incident ? <span className="rounded bg-[#F1ECFE] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#5B21B6]">Major</span> : null}</div><p className="mt-1 max-w-xs truncate text-xs font-semibold text-[#0E1726]">{incident.title}</p></td>
                <td className="px-4 py-4"><AttentionCell item={operations || undefined}/></td>
                <td className="px-4 py-4"><div className="flex flex-wrap gap-1.5"><IncidentPriorityBadge priority={incident.priority}/><IncidentStatusBadge status={incident.status}/></div></td>
                <td className="px-4 py-4"><SlaCell item={operations || undefined} fallback={incident.sla_status} showAttention={false}/></td>
                <td className="px-4 py-4 text-xs"><p className="font-semibold text-[#475069]">{incident.assignment_group || "Unassigned group"}</p><p className="mt-1 max-w-[170px] truncate text-[10px] text-[#8A93A5]">{operations?.assignee_email || incident.assignee_id || "No assignee"}</p></td>
                <td className="whitespace-nowrap px-4 py-4 text-[11px] text-[#6B7488]">{formatDateTime(incident.updated_at)}</td>
                <td className="px-4 py-4 text-right"><button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-[#6D28D9]">Review<ChevronRight className="h-3.5 w-3.5"/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between border-t border-[#E6E9F0] bg-[#FBFAF9] px-5 py-3 text-xs text-[#6B7488]"><span>{shownFrom}-{shownTo} of {total} incidents</span><div className="flex gap-2"><button disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-PAGE_SIZE))} className="inline-flex items-center gap-1 rounded-lg border border-[#E6E9F0] bg-white px-3 py-1.5 font-semibold text-[#475069] hover:border-[#DDD6FE] hover:bg-[#F5F7FA] disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5"/>Previous</button><button disabled={offset+rows.length>=total||loading} onClick={()=>setOffset(offset+PAGE_SIZE)} className="inline-flex items-center gap-1 rounded-lg border border-[#E6E9F0] bg-white px-3 py-1.5 font-semibold text-[#475069] hover:border-[#DDD6FE] hover:bg-[#F5F7FA] disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5"/></button></div></footer>
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

function AttentionCell({item}:{item?:IncidentOperationsItem}) {
  if (!item?.attention_reasons.length) return <span className="text-[11px] text-[#8A93A5]">No attention signals</span>;
  const tone = {
    HIGH_PRIORITY: "border-orange-200 bg-orange-50 text-orange-700",
    SLA_AT_RISK: "border-amber-200 bg-amber-50 text-amber-800",
    SLA_BREACHED: "border-red-200 bg-red-50 text-red-700",
    STUCK_IDLE: "border-slate-200 bg-slate-100 text-slate-700",
  } as const;
  return <div className="flex max-w-[190px] flex-wrap gap-1">{item.attention_reasons.map(reason=><span key={reason} className={`rounded-md border px-1.5 py-0.5 text-[9px] font-semibold ${tone[reason]}`}>{attentionLabels[reason]}</span>)}</div>;
}

function SlaCell({item,fallback,showAttention=true}:{item?:IncidentOperationsItem;fallback:string;showAttention?:boolean}) {
  const status=item?.sla.status||fallback||"NO_SLA";
  const tone=status==="BREACHED"?"border-red-200 bg-red-50 text-red-700":status==="AT_RISK"?"border-amber-200 bg-amber-50 text-amber-800":"border-[#E6E9F0] bg-[#F5F7FA] text-[#475069]";
  const duration=formatDuration(item?.sla.remaining_seconds);
  return <div className="max-w-[220px]"><div className="flex flex-wrap items-center gap-1.5"><span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${tone}`}>{status.replaceAll("_"," ")}</span>{duration ? <span className="text-[10px] text-[#6B7488]">{duration}</span> : null}</div>{showAttention && item?.attention_reasons.length ? <div className="mt-1.5"><AttentionCell item={item}/></div> : null}</div>;
}
