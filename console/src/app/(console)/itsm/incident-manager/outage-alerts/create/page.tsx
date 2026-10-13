"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BellRing, Check, CheckCircle2, FilePlus2, Link2, LoaderCircle, Save, Search, ShieldCheck, X } from "lucide-react";
import { alertApi, type AlertDetail, type AlertReferenceOption, type AlertReferenceOptionPage } from "@/lib/outage-alerts";

const intents = [
  ["INFORM", "Inform", "Share an outage or service-status message."],
  ["ACTION_REQUIRED", "Action required", "Recipients should take the stated action."],
  ["INVESTIGATE", "Investigate", "Authorized operational recipients should investigate."],
  ["RESOLVE", "Resolve", "Authorized responders should work toward resolution."],
] as const;
const audiences = [
  ["SERVICE_USERS", "Users of affected services", "People covered by the selected services' recipient rules."],
  ["SERVICE_AGENTS", "Service Agents", "Agents in support teams assigned to selected services."],
  ["PROBLEM_MANAGERS", "Problem Managers", "The assigned investigator for a linked Problem."],
  ["CHANGE_MANAGERS", "Change Managers", "The assigned manager for a linked Change."],
  ["SERVICE_OWNERS", "Service owners", "Active owners of selected services."],
] as const;

export default function CreateOutageAlertPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [editingAlert, setEditingAlert] = useState<AlertDetail | null>(null);
  const [selectedServices, setSelectedServices] = useState<AlertReferenceOption[]>([]);
  const [selectedCis, setSelectedCis] = useState<AlertReferenceOption[]>([]);
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<AlertReferenceOption[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<AlertReferenceOption[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<AlertReferenceOption[]>([]);
  const [relatedRecordType, setRelatedRecordType] = useState("");
  const [handling, setHandling] = useState("ALERT_ONLY");
  const [incidentPickerOpenRequest, setIncidentPickerOpenRequest] = useState(0);

  useEffect(() => {
    const request = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const editId = params.get("edit");
      const relatedType = params.get("related_type");
      const relatedId = params.get("related_id");
      if (editId) {
        setLoadingDraft(true);
        alertApi<AlertDetail>(`/${editId}`).then((draft) => {
          if (draft.status !== "DRAFT" || !draft.allowed_actions.includes("EDIT_DRAFT")) throw new Error("This alert is not an editable draft");
          const content = draft.content;
          const services = Array.isArray(content.affected_services) ? content.affected_services as Array<{ id: string; name: string }> : [];
          const cis = Array.isArray(content.configuration_items) ? content.configuration_items as Array<{ id: string; name: string }> : [];
          const audienceRows = Array.isArray(content.audiences) ? content.audiences as Array<{ type: string; team_id?: string | null; user_id?: string | null }> : [];
          setEditingAlert(draft);
          setSelectedServices(services.map((item) => ({ value: item.id, label: item.name, meta: "Affected service" })));
          setSelectedCis(cis.map((item) => ({ value: item.id, label: item.name, meta: "Configuration item" })));
          setSelectedAudiences(audienceRows.filter((item) => !["SELECTED_TEAM", "SPECIFIC_USER"].includes(item.type)).map((item) => item.type));
          setSelectedTeams(audienceRows.filter((item) => item.type === "SELECTED_TEAM" && item.team_id).map((item) => ({ value: String(item.team_id), label: "Selected team", meta: "Team / group" })));
          setSelectedUsers(audienceRows.filter((item) => item.type === "SPECIFIC_USER" && item.user_id).map((item) => ({ value: String(item.user_id), label: "Selected recipient", meta: "Independently authorized user" })));
          const draftLinks = draft.links.map((item) => ({ value: `${item.type}:${item.id}`, label: `Linked ${item.type.replaceAll("_", " ").toLowerCase()}`, meta: item.type.replaceAll("_", " ") }));
          const returnedLink = relatedType && relatedId
            ? { value: `${relatedType}:${relatedId}`, label: `Newly created ${relatedType.replaceAll("_", " ").toLowerCase()}`, meta: relatedType.replaceAll("_", " ") }
            : null;
          setSelectedLinks(returnedLink && !draftLinks.some((item) => item.value === returnedLink.value) ? [...draftLinks, returnedLink] : draftLinks);
          setHandling(content.service_agent_handling === "SOLVE" ? "SOLVE" : "ALERT_ONLY");
        }).catch((cause) => setError(cause instanceof Error ? cause.message : "Draft could not be loaded")).finally(() => setLoadingDraft(false));
      } else if (relatedType && relatedId) {
        setSelectedLinks([{ value: `${relatedType}:${relatedId}`, label: "Linked operational record", meta: relatedType.replaceAll("_", " ") }]);
      }
    }, 0);
    return () => window.clearTimeout(request);
  }, []);
  const showAgentHandling = selectedAudiences.includes("SERVICE_AGENTS");
  const selectedServiceIds = useMemo(() => selectedServices.map((item) => item.value), [selectedServices]);
  const hasIncidentLink = useMemo(() => selectedLinks.some((item) => item.value.startsWith("INCIDENT:")), [selectedLinks]);

  const toggle = (value: string, values: string[], setValues: (value: string[]) => void) => setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const afterSaveAction = submitter?.value === "CREATE_INCIDENT" ? "CREATE_INCIDENT" : "DETAIL";
    if (afterSaveAction === "CREATE_INCIDENT" && selectedServices.length === 0) {
      setError("Select at least one affected service before creating the Incident. The service keeps the new Incident and Alert in the same authorized scope.");
      document.getElementById("affected-services")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const alertAudiences = [
      ...selectedAudiences.map((audience_type) => ({ audience_type })),
      ...selectedTeams.map((team) => ({ audience_type: "SELECTED_TEAM", team_id: team.value })),
      ...selectedUsers.map((user) => ({ audience_type: "SPECIFIC_USER", user_id: user.value })),
    ];
    const links = selectedLinks.map(({ value }) => {
      const [target_type, target_id] = value.split(":");
      return { target_type, target_id };
    });
    const payload = {
      title: String(form.get("title") || ""), alert_type: form.get("alert_type"), severity: form.get("severity"), intent: form.get("intent"),
      public_summary: String(form.get("public_summary") || ""), impact_summary: String(form.get("impact_summary") || ""),
      recommended_action: String(form.get("recommended_action") || "") || null,
      service_agent_guidance: String(form.get("service_agent_guidance") || "") || null,
      internal_notes: String(form.get("internal_notes") || "") || null,
      service_agent_handling: showAgentHandling ? handling : "ALERT_ONLY",
      service_ids: selectedServiceIds, ci_ids: selectedCis.map((item) => item.value), audiences: alertAudiences, links,
      outage_started_at: form.get("outage_started_at") ? new Date(String(form.get("outage_started_at"))).toISOString() : null,
      next_update_at: form.get("next_update_at") ? new Date(String(form.get("next_update_at"))).toISOString() : null,
    };
    try {
      const created = await alertApi<AlertDetail>(editingAlert ? `/${editingAlert.id}` : "", { method: editingAlert ? "PUT" : "POST", body: JSON.stringify(payload) });
      if (afterSaveAction === "CREATE_INCIDENT") {
        router.push(`/itsm/incidents/new?outage_alert_id=${encodeURIComponent(created.id)}`);
      } else {
        router.push(`/itsm/incident-manager/outage-alerts/${created.id}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Draft could not be saved");
      setSaving(false);
    }
  }

  const inputClass = "mt-1.5 w-full rounded-xl border border-[#DCE1E8] bg-white px-3.5 py-2.5 text-sm text-[#0E1726] outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#6D28D9]/10";
  const sectionClass = "rounded-2xl border border-[#E6E9F0] bg-white p-5 sm:p-6";
  const draftContent = editingAlert?.content || {};
  if (loadingDraft) return <div className="mx-auto max-w-5xl space-y-4"><div className="h-8 w-44 animate-pulse rounded bg-[#EEF1F5]" /><div className="h-96 animate-pulse rounded-2xl bg-white" /></div>;
  return <div className="mx-auto max-w-5xl space-y-5">
    <Link href="/itsm/incident-manager/outage-alerts" className="inline-flex items-center gap-2 text-sm font-semibold text-[#5B21B6] hover:text-[#6D28D9]"><ArrowLeft className="h-4 w-4" /> Back to alerts</Link>
    <div><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#6D28D9]"><BellRing className="h-4 w-4" /> Private draft</p><h1 className="text-3xl font-bold tracking-tight">{editingAlert ? "Edit outage alert" : "Create outage alert"}</h1><p className="mt-1 text-sm text-[#475069]">Define the message and scope. You will preview the exact authorized audiences before publishing.</p></div>
    {error ? <div role="alert" className="rounded-xl border border-[#E7D9CF] bg-[#FFF9F5] p-4 text-sm text-[#704C3B]">{error}</div> : null}
    <form key={editingAlert?.id || "new-alert"} onSubmit={submit} className="space-y-5">
      <section className={sectionClass}><Step number="1" title="What happened?" description="Public facts and the affected operational scope." />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm font-semibold">Alert title<input required name="title" maxLength={255} className={inputClass} placeholder="Email service unavailable" defaultValue={String(draftContent.title || "")} /></label>
          <label className="text-sm font-semibold">Alert type<select name="alert_type" className={inputClass} defaultValue={String(draftContent.alert_type || "OUTAGE")}><option>OUTAGE</option><option>DEGRADATION</option><option>MAINTENANCE</option><option>INFORMATION</option></select></label>
          <label className="text-sm font-semibold">Severity<select name="severity" className={inputClass} defaultValue={String(draftContent.severity || "HIGH")}><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label>
          <label className="sm:col-span-2 text-sm font-semibold">Customer-safe summary<textarea required name="public_summary" rows={4} className={inputClass} placeholder="Explain what users are experiencing without internal or sensitive details." defaultValue={String(draftContent.public_summary || "")} /></label>
          <label className="sm:col-span-2 text-sm font-semibold">Business/user impact<textarea required name="impact_summary" rows={3} className={inputClass} defaultValue={String(draftContent.impact_summary || "")} /></label>
          <label className="sm:col-span-2 text-sm font-semibold">What should users do? <span className="font-normal text-[#8A93A5]">Optional</span><textarea name="recommended_action" rows={2} className={inputClass} defaultValue={String(draftContent.recommended_action || "")} /></label>
          <label className="text-sm font-semibold">Outage started <span className="font-normal text-[#8A93A5]">Optional</span><input name="outage_started_at" type="datetime-local" className={inputClass} defaultValue={localDateTime(draftContent.outage_started_at)} /></label>
          <label className="text-sm font-semibold">Next update <span className="font-normal text-[#8A93A5]">Optional</span><input name="next_update_at" type="datetime-local" className={inputClass} defaultValue={localDateTime(draftContent.next_update_at)} /></label>
        </div>
        <div id="affected-services"><SearchableChoicePicker title="Affected services" description="Search authorized services by name. Selected services remain visible without expanding the page." kind="SERVICE" selected={selectedServices} onChange={setSelectedServices} empty="No authorized services match your search." /></div>
        <SearchableChoicePicker title="Affected configuration items (optional)" description={selectedServiceIds.length ? "Results are limited to the selected services." : "Select a service first to narrow configuration items."} kind="CONFIGURATION_ITEM" serviceIds={selectedServiceIds} selected={selectedCis} onChange={setSelectedCis} empty="No authorized configuration items match your search." />
      </section>

      <section className={sectionClass}><Step number="2" title="Communication intent" description="Intent shapes available recipient actions; it never overrides permission checks." />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">{intents.map(([value,label,description]) => <label key={value} className="flex cursor-pointer gap-3 rounded-xl border border-[#E6E9F0] p-4 has-[:checked]:border-[#8B5CF6] has-[:checked]:bg-[#F8F5FF]"><input type="radio" name="intent" value={value} defaultChecked={value === String(draftContent.intent || "INFORM")} className="mt-1 accent-[#6D28D9]" /><span><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs text-[#6B7488]">{description}</span></span></label>)}</div>
      </section>

      <section className={sectionClass}><Step number="3" title="Who should receive it?" description="Choose business audiences. AuthClaw resolves actual people from service and team relationships." />
        <div className="mt-5 space-y-3">{audiences.map(([value,label,description]) => <label key={value} className="flex cursor-pointer gap-3 rounded-xl border border-[#E6E9F0] p-4 has-[:checked]:border-[#8B5CF6] has-[:checked]:bg-[#F8F5FF]"><input type="checkbox" checked={selectedAudiences.includes(value)} onChange={() => toggle(value, selectedAudiences, setSelectedAudiences)} className="mt-1 accent-[#6D28D9]" /><span><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs text-[#6B7488]">{description}</span></span></label>)}</div>
        <SearchableChoicePicker title="Selected teams/groups (optional)" description="Search authorized teams instead of scanning a long tenant-wide list." kind="TEAM" selected={selectedTeams} onChange={setSelectedTeams} empty="No authorized teams match your search." />
        <SearchableChoicePicker title="Specific people (optional)" description="Only people who already have an authorized relationship to the selected services or linked records are available." kind="RECIPIENT" serviceIds={selectedServiceIds} relatedRecords={selectedLinks.map((item) => item.value)} selected={selectedUsers} onChange={setSelectedUsers} empty="No eligible people match the selected services or linked records." />
      </section>

      {showAgentHandling ? <section className={sectionClass}><Step number="4" title="Service Agent handling" description="Receiving an alert does not grant new incident permissions." />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">{[["ALERT_ONLY","Alert only","Notify eligible support agents without creating or assigning work."],["SOLVE","Solve","Track resolution work in an Incident and direct authorized Service Agents to it."]].map(([value,label,description]) => <label key={value} className="flex cursor-pointer gap-3 rounded-xl border border-[#E6E9F0] p-4 transition has-[:checked]:border-[#8B5CF6] has-[:checked]:bg-[#F8F5FF]"><input type="radio" checked={handling === value} onChange={() => setHandling(value)} className="mt-1 accent-[#6D28D9]" /><span><span className="block font-semibold">{label}</span><span className="mt-1 block text-xs text-[#6B7488]">{description}</span></span></label>)}</div>
        {handling === "SOLVE" && !hasIncidentLink ? <div className="mt-4 rounded-xl border border-[#DDD6FE] bg-[#F8F5FF] p-4"><p className="text-sm font-semibold text-[#352A52]">How should the resolution work be tracked?</p><p className="mt-1 text-xs leading-5 text-[#5B5670]">Solve needs an Incident for ownership, assignment, and work history. Choose an existing Incident or explicitly create one. Publishing an alert never creates an Incident automatically.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => { setRelatedRecordType("INCIDENT"); setIncidentPickerOpenRequest((value) => value + 1); document.getElementById("related-operational-records")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#C4B5FD] bg-white px-3 py-2.5 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]"><Link2 className="h-4 w-4" /> Link existing Incident</button><button type="submit" name="save_action" value="CREATE_INCIDENT" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#6D28D9] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#5B21B6] disabled:opacity-60"><FilePlus2 className="h-4 w-4" /> {saving ? "Saving draft…" : "Create new Incident"}</button></div></div> : null}
        {handling === "SOLVE" && hasIncidentLink ? <p className="mt-3 text-xs font-semibold text-[#047857]">An Incident is linked. Authorized Service Agents can use it for assignment and resolution work.</p> : null}
        <label className="mt-4 block text-sm font-semibold">Approved support guidance <span className="font-normal text-[#8A93A5]">Not shown to Requesters</span><textarea name="service_agent_guidance" rows={3} className={inputClass} defaultValue={String(draftContent.service_agent_guidance || "")} /></label>
      </section> : null}

      <section id="related-operational-records" className={sectionClass}><Step number="5" title="Related operational records" description="Links are optional. Solve requires an Incident before the alert can be previewed or published." />
        <label className="mt-5 block max-w-xs text-sm font-semibold">Record type<select value={relatedRecordType} onChange={(event) => setRelatedRecordType(event.target.value)} className={inputClass}><option value="">All record types</option><option value="INCIDENT">Incidents</option><option value="MAJOR_INCIDENT">Major incidents</option><option value="PROBLEM">Problems</option><option value="CHANGE">Changes</option></select></label>
        <SearchableChoicePicker key={`related-records-${incidentPickerOpenRequest}`} title="Find records" description="Search by record number or title. Only records you are authorized to link are returned." kind="RELATED_RECORD" recordType={relatedRecordType} serviceIds={selectedServiceIds} selected={selectedLinks} onChange={setSelectedLinks} empty="No authorized operational records match your search." initiallyOpen={incidentPickerOpenRequest > 0} />
      </section>

      <section className={sectionClass}><Step number="6" title="Communication settings" description="Only verified channels are selectable. In-app and portal delivery are available in this release." />
        <div className="mt-5 flex flex-wrap gap-2"><span className="inline-flex items-center gap-2 rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-1.5 text-sm font-semibold text-[#5B21B6]"><CheckCircle2 className="h-4 w-4" /> In-app notification</span><span className="inline-flex items-center gap-2 rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-1.5 text-sm font-semibold text-[#5B21B6]"><CheckCircle2 className="h-4 w-4" /> Portal warning</span></div>
        <label className="mt-4 block text-sm font-semibold">Internal operational notes <span className="font-normal text-[#8A93A5]">Incident Manager and Auditor only</span><textarea name="internal_notes" rows={3} className={inputClass} defaultValue={String(draftContent.internal_notes || "")} /></label>
      </section>

      <section className="rounded-2xl border border-[#DDD6FE] bg-[#F8F5FF] p-5 sm:p-6"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#6D28D9]" /><div><h2 className="font-semibold">Save privately, then verify before publishing</h2><p className="mt-1 text-sm text-[#475069]">After saving, Preview recipients shows who is included, why, which fields they see, and their allowed actions. Publication recalculates the same policy and rejects stale previews.</p></div></div></section>
      <div className="flex justify-end gap-3"><Link href={editingAlert ? `/itsm/incident-manager/outage-alerts/${editingAlert.id}` : "/itsm/incident-manager/outage-alerts"} className="rounded-xl border border-[#E6E9F0] bg-white px-5 py-2.5 text-sm font-semibold text-[#475069]">Cancel</Link><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B21B6] disabled:opacity-60"><Save className="h-4 w-4" /> {saving ? "Saving…" : editingAlert ? "Save changes" : "Save draft"}</button></div>
    </form>
  </div>;
}

function Step({ number, title, description }: { number: string; title: string; description: string }) { return <div className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#F1ECFE] text-sm font-bold text-[#6D28D9]">{number}</span><div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-0.5 text-sm text-[#6B7488]">{description}</p></div></div>; }

function localDateTime(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

type PickerKind = "SERVICE" | "CONFIGURATION_ITEM" | "TEAM" | "RELATED_RECORD" | "RECIPIENT";

function SearchableChoicePicker({ title, description, kind, selected, onChange, empty, recordType = "", serviceIds = [], relatedRecords = [], initiallyOpen = false }: {
  title: string;
  description: string;
  kind: PickerKind;
  selected: AlertReferenceOption[];
  onChange: (items: AlertReferenceOption[]) => void;
  empty: string;
  recordType?: string;
  serviceIds?: string[];
  relatedRecords?: string[];
  initiallyOpen?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(initiallyOpen);
  const [page, setPage] = useState<AlertReferenceOptionPage>({ items: [], total: 0, offset: 0, limit: 20, has_more: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const serviceKey = serviceIds.join(",");
  const relatedKey = relatedRecords.join(",");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const request = window.setTimeout(async () => {
      setLoading(true);
      setLoadError("");
      const params = buildReferenceParams(kind, query, recordType, serviceKey ? serviceKey.split(",") : [], relatedKey ? relatedKey.split(",") : []);
      try {
        const result = await alertApi<AlertReferenceOptionPage>(`/reference-options?${params.toString()}`, { signal: controller.signal });
        setPage(result);
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Options could not be loaded");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(request);
    };
  }, [kind, open, query, recordType, serviceKey, relatedKey]);

  const selectedValues = useMemo(() => new Set(selected.map((item) => item.value)), [selected]);
  const toggleOption = (option: AlertReferenceOption) => onChange(
    selectedValues.has(option.value)
      ? selected.filter((item) => item.value !== option.value)
      : [...selected, option],
  );

  const loadMore = async () => {
    setLoading(true);
    setLoadError("");
    const params = buildReferenceParams(kind, query, recordType, serviceIds, relatedRecords, page.items.length);
    try {
      const result = await alertApi<AlertReferenceOptionPage>(`/reference-options?${params.toString()}`);
      const existing = new Set(page.items.map((item) => item.value));
      setPage({ ...result, items: [...page.items, ...result.items.filter((item) => !existing.has(item.value))] });
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "More options could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  return <div className="mt-5 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm font-semibold text-[#0E1726]">{title}</p><p className="mt-1 text-xs text-[#6B7488]">{description}</p></div>
      <div className="flex items-center gap-2"><span className="rounded-full border border-[#DDD6FE] bg-white px-2.5 py-1 text-xs font-semibold text-[#5B21B6]" aria-live="polite">{selected.length} selected</span><button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#DDD6FE] bg-white px-3 py-1.5 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"><Search className="h-3.5 w-3.5" />{open ? "Hide" : "Search"}</button></div>
    </div>
    {selected.length ? <div className="mt-3 flex flex-wrap gap-2" aria-label={`Selected ${title.toLowerCase()}`}>
      {selected.map((item) => <span key={item.value} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#DDD6FE] bg-[#F1ECFE] py-1 pl-2.5 pr-1.5 text-xs font-semibold text-[#5B21B6]"><span className="max-w-64 truncate">{item.label}</span><button type="button" onClick={() => toggleOption(item)} className="rounded-full p-0.5 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]" aria-label={`Remove ${item.label}`}><X className="h-3.5 w-3.5" /></button></span>)}
    </div> : null}
    {open ? <><label className="relative mt-3 block">
      <span className="sr-only">Search {title.toLowerCase()}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93A5]" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-xl border border-[#DCE1E8] bg-white py-2.5 pl-9 pr-9 text-sm outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#6D28D9]/10" placeholder={`Search ${title.toLowerCase()}…`} />
      {query ? <button type="button" onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#6B7488] hover:bg-[#F1ECFE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]" aria-label="Clear search"><X className="h-4 w-4" /></button> : null}
    </label>
    <div className="mt-3" role="listbox" aria-multiselectable="true" aria-label={title}>
      {loading && page.items.length === 0
        ? <p className="flex items-center gap-2 py-4 text-sm text-[#6B7488]"><LoaderCircle className="h-4 w-4 animate-spin" />Loading authorized options…</p>
        : loadError && page.items.length === 0
          ? <p role="alert" className="rounded-lg bg-[#FFF9F5] p-3 text-sm text-[#704C3B]">{loadError}</p>
          : page.items.length === 0
            ? <p className="py-4 text-sm text-[#6B7488]">{empty}</p>
            : <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">{page.items.map((item) => {
              const active = selectedValues.has(item.value);
              return <button type="button" role="option" aria-selected={active} key={item.value} onClick={() => toggleOption(item)} className={`flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] ${active ? "border-[#8B5CF6] bg-[#F8F5FF]" : "border-[#E6E9F0] bg-white hover:border-[#C4B5FD]"}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${active ? "border-[#6D28D9] bg-[#6D28D9] text-white" : "border-[#C7CDD8] text-transparent"}`}><Check className="h-3.5 w-3.5" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#0E1726]">{item.label}</span><span className="block truncate text-xs text-[#6B7488]">{item.meta}</span></span></button>;
            })}</div>}
    </div>
    {page.items.length ? <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#E6E9F0] pt-3"><p className="text-xs text-[#6B7488]">Showing {page.items.length} of {page.total} matching options</p>{page.has_more ? <button type="button" onClick={loadMore} disabled={loading} className="rounded-lg border border-[#DDD6FE] bg-white px-3 py-1.5 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-60">{loading ? "Loading…" : "Show more"}</button> : null}</div> : null}
    {loadError && page.items.length ? <p role="alert" className="mt-2 text-xs text-[#704C3B]">{loadError}</p> : null}
    </> : null}
  </div>;
}

function buildReferenceParams(kind: PickerKind, query: string, recordType: string, serviceIds: string[], relatedRecords: string[] = [], offset = 0) {
  const params = new URLSearchParams({ kind, limit: "20", offset: String(offset) });
  if (query.trim()) params.set("search", query.trim());
  if (recordType) params.set("record_type", recordType);
  serviceIds.forEach((id) => params.append("service_ids", id));
  relatedRecords.forEach((id) => params.append("related_records", id));
  return params;
}
