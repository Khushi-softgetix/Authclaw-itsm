"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BellRing, Check, ChevronDown, FilePlus2, Link2, LoaderCircle, Save, Search, ShieldCheck, X } from "lucide-react";
import { alertApi, type AlertDetail, type AlertReferenceOption, type AlertReferenceOptionPage } from "@/lib/outage-alerts";

const intents = [
  ["INFORM", "Inform", "Share an outage or service-status message."],
  ["ACTION_REQUIRED", "Action required", "Recipients should take the stated action."],
  ["INVESTIGATE", "Investigate", "Authorized operational responders should investigate."],
  ["RESOLVE", "Resolve", "Authorized responders should work toward resolution."],
] as const;

const primaryAudiences = [
  ["SERVICE_USERS", "Users of affected services", "People covered by the selected services' recipient rules."],
  ["SERVICE_AGENTS", "Service Agents", "Agents in support teams assigned to selected services."],
  ["SERVICE_OWNERS", "Service owners", "Active owners of selected services."],
] as const;

export default function CreateOutageAlertPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [editingAlert, setEditingAlert] = useState<AlertDetail | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<string>("INFORM");
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
          if (draft.status !== "DRAFT" || !draft.allowed_actions.includes("EDIT_DRAFT")) {
            throw new Error("This alert is not an editable draft");
          }
          const content = draft.content;
          const services = Array.isArray(content.affected_services) ? content.affected_services as Array<{ id: string; name: string }> : [];
          const cis = Array.isArray(content.configuration_items) ? content.configuration_items as Array<{ id: string; name: string }> : [];
          const audienceRows = Array.isArray(content.audiences) ? content.audiences as Array<{ type: string; team_id?: string | null; user_id?: string | null }> : [];
          setEditingAlert(draft);
          setSelectedIntent(String(content.intent || "INFORM"));
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

  const toggle = (value: string, values: string[], setValues: (value: string[]) => void) =>
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const afterSaveAction = submitter?.value === "CREATE_INCIDENT" ? "CREATE_INCIDENT" : "DETAIL";
    if (afterSaveAction === "CREATE_INCIDENT" && selectedServices.length === 0) {
      setError("Select at least one affected service before creating the Incident. The service keeps the new Incident and Alert in the same authorized scope.");
      document.getElementById("affected-services")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSaving(true);
    setError("");
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
    const publicSummaryText = String(form.get("public_summary") || "");
    const impactSummaryText = String(form.get("impact_summary") || "").trim() || publicSummaryText;
    const payload = {
      title: String(form.get("title") || ""),
      alert_type: form.get("alert_type"),
      severity: form.get("severity"),
      intent: form.get("intent") || selectedIntent,
      public_summary: publicSummaryText,
      impact_summary: impactSummaryText,
      recommended_action: String(form.get("recommended_action") || "") || null,
      service_agent_guidance: String(form.get("service_agent_guidance") || "") || null,
      internal_notes: String(form.get("internal_notes") || "") || null,
      service_agent_handling: showAgentHandling ? handling : "ALERT_ONLY",
      service_ids: selectedServiceIds,
      ci_ids: selectedCis.map((item) => item.value),
      audiences: alertAudiences,
      links,
      outage_started_at: form.get("outage_started_at") ? new Date(String(form.get("outage_started_at"))).toISOString() : null,
      next_update_at: form.get("next_update_at") ? new Date(String(form.get("next_update_at"))).toISOString() : null,
    };
    try {
      const created = await alertApi<AlertDetail>(editingAlert ? `/${editingAlert.id}` : "", {
        method: editingAlert ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
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
  const draftContent = editingAlert?.content || {};

  if (loadingDraft) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-8 w-44 animate-pulse rounded bg-[#EEF1F5]" />
        <div className="h-96 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <div>
        <Link
          href="/itsm/incident-manager/outage-alerts"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5B21B6] hover:text-[#6D28D9]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to alerts
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-2.5 py-0.5 text-[11px] font-semibold text-[#6D28D9]">
              <BellRing className="h-3 w-3" /> Private draft
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-[#0E1726]">
              {editingAlert ? "Edit outage alert" : "Create outage alert"}
            </h1>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-[#6B7488]">
          Compose the public outage announcement and service scope. You will preview exact recipient rosters and permissions before publishing.
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-[#E7D9CF] bg-[#FFF9F5] p-3.5 text-sm text-[#704C3B]">
          {error}
        </div>
      ) : null}

      <form key={editingAlert?.id || "new-alert"} onSubmit={submit} className="space-y-4">
        {/* Card 1: Alert Details */}
        <section className="rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-sm">
          <div className="border-b border-[#EEF1F5] pb-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#6D28D9]">Alert Details</h2>
            <p className="text-xs text-[#6B7488]">Essential notice facts broadcast to affected recipients.</p>
          </div>

          <div className="mt-3.5 space-y-3.5">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">
                Alert title <span className="text-[#DC2626]">*</span>
              </label>
              <input
                required
                name="title"
                maxLength={255}
                className={inputClass}
                placeholder="e.g. Corporate Email Authentication Degraded"
                defaultValue={String(draftContent.title || "")}
              />
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">
                  Alert type <span className="text-[#DC2626]">*</span>
                </label>
                <select name="alert_type" className={inputClass} defaultValue={String(draftContent.alert_type || "OUTAGE")}>
                  <option value="OUTAGE">OUTAGE</option>
                  <option value="DEGRADATION">DEGRADATION</option>
                  <option value="MAINTENANCE">MAINTENANCE</option>
                  <option value="INFORMATION">INFORMATION</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">
                  Severity <span className="text-[#DC2626]">*</span>
                </label>
                <select name="severity" className={inputClass} defaultValue={String(draftContent.severity || "HIGH")}>
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">
                Customer-safe summary <span className="text-[#DC2626]">*</span>
              </label>
              <textarea
                required
                name="public_summary"
                rows={3}
                className={inputClass}
                placeholder="Explain what users are experiencing without internal jargon or sensitive configuration tokens."
                defaultValue={String(draftContent.public_summary || "")}
              />
            </div>
          </div>
        </section>

        {/* Card 2: Affected Services */}
        <section id="affected-services" className="rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-sm">
          <div className="border-b border-[#EEF1F5] pb-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#6D28D9]">Affected Services</h2>
            <p className="text-xs text-[#6B7488]">Services define recipient subscriber boundaries and configuration item scope.</p>
          </div>

          <div className="mt-2">
            <SearchableChoicePicker
              title="Select affected services"
              description="Search authorized services by name. Selected services stay accessible without full page reloads."
              kind="SERVICE"
              selected={selectedServices}
              onChange={setSelectedServices}
              empty="No authorized services match your search."
            />
          </div>
        </section>

        {/* Card 3: Audience and Communication Intent */}
        <section className="rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-sm">
          <div className="border-b border-[#EEF1F5] pb-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#6D28D9]">Audience & Communication Intent</h2>
            <p className="text-xs text-[#6B7488]">Intent shapes recipient actions; recipient rosters are resolved automatically from service ties.</p>
          </div>

          {/* Intent selector */}
          <div className="mt-3.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">Communication intent</label>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {intents.map(([value, label, description]) => {
                const isSelected = selectedIntent === value;
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer flex-col justify-between rounded-xl border p-3 transition ${
                      isSelected ? "border-[#8B5CF6] bg-[#F8F5FF] shadow-sm" : "border-[#E6E9F0] bg-white hover:border-[#DDD6FE]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#0E1726]">{label}</span>
                      <input
                        type="radio"
                        name="intent"
                        value={value}
                        checked={isSelected}
                        onChange={() => setSelectedIntent(value)}
                        className="accent-[#6D28D9]"
                      />
                    </div>
                    <span className="mt-1 text-[11px] leading-tight text-[#6B7488]">{description}</span>
                  </label>
                );
              })}
            </div>
            {selectedIntent === "ACTION_REQUIRED" ? (
              <p className="mt-2 rounded-lg border border-[#DDD6FE] bg-[#F8F5FF] p-2 text-xs text-[#5B21B6]">
                💡 <strong>Action required:</strong> Remember to specify recommended user steps in Optional Information below.
              </p>
            ) : null}
          </div>

          {/* Primary audiences */}
          <div className="mt-4 border-t border-[#EEF1F5] pt-3.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">Primary recipient audiences</label>
            <p className="mt-0.5 text-xs text-[#6B7488]">Authorized people are resolved dynamically from service entitlements and support rosters.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {primaryAudiences.map(([value, label, description]) => {
                const isChecked = selectedAudiences.includes(value);
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition ${
                      isChecked ? "border-[#8B5CF6] bg-[#F8F5FF]" : "border-[#E6E9F0] bg-white hover:border-[#DDD6FE]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(value, selectedAudiences, setSelectedAudiences)}
                      className="mt-0.5 accent-[#6D28D9]"
                    />
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-[#0E1726]">{label}</span>
                      <span className="block text-[11px] leading-snug text-[#6B7488]">{description}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Service Agent handling (conditional) */}
          {showAgentHandling ? (
            <div className="mt-4 rounded-xl border border-[#DDD6FE] bg-[#FAF5FF] p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-[#6D28D9]">Service Agent Handling</h3>
                <span className="text-[11px] text-[#6B7488]">Governs agent queue resolution workflow</span>
              </div>

              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                {[
                  ["ALERT_ONLY", "Alert only", "Notify eligible support agents without assigning incident work."],
                  ["SOLVE", "Solve", "Track resolution work in an Incident and direct authorized Service Agents to it."],
                ].map(([value, label, description]) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition bg-white ${
                      handling === value ? "border-[#8B5CF6] ring-1 ring-[#8B5CF6]" : "border-[#E6E9F0] hover:border-[#DDD6FE]"
                    }`}
                  >
                    <input
                      type="radio"
                      checked={handling === value}
                      onChange={() => setHandling(value)}
                      className="mt-0.5 accent-[#6D28D9]"
                    />
                    <div>
                      <span className="block text-xs font-semibold text-[#0E1726]">{label}</span>
                      <span className="block text-[11px] text-[#6B7488] leading-tight mt-0.5">{description}</span>
                    </div>
                  </label>
                ))}
              </div>

              {handling === "SOLVE" && !hasIncidentLink ? (
                <div className="mt-3 rounded-xl border border-[#DDD6FE] bg-white p-3.5 shadow-sm">
                  <p className="text-xs font-bold text-[#352A52]">How should the resolution work be tracked?</p>
                  <p className="mt-1 text-xs text-[#5B5670] leading-relaxed">
                    Solve needs an Incident for ownership, assignment, and work history. Choose an existing Incident or explicitly create one. Publishing an alert never creates an Incident automatically.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRelatedRecordType("INCIDENT");
                        setIncidentPickerOpenRequest((val) => val + 1);
                        document.getElementById("related-operational-records")?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#C4B5FD] bg-[#F8F5FF] px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]"
                    >
                      <Link2 className="h-3.5 w-3.5" /> Link existing Incident
                    </button>
                    <button
                      type="submit"
                      name="save_action"
                      value="CREATE_INCIDENT"
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#6D28D9] px-3 py-2 text-xs font-semibold text-white hover:bg-[#5B21B6] disabled:opacity-60"
                    >
                      <FilePlus2 className="h-3.5 w-3.5" /> {saving ? "Saving draft…" : "Create new Incident"}
                    </button>
                  </div>
                </div>
              ) : null}

              {handling === "SOLVE" && hasIncidentLink ? (
                <p className="mt-3 text-xs font-semibold text-[#047857] flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> An Incident is linked. Authorized Service Agents can use it for assignment and resolution work.
                </p>
              ) : null}

              <div className="mt-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">
                  Approved support guidance <span className="font-normal text-[#8A93A5]">(Internal to Service Agents)</span>
                </label>
                <textarea
                  name="service_agent_guidance"
                  rows={2}
                  className={inputClass}
                  placeholder="Guidance for tier-1/tier-2 support handling customer contacts."
                  defaultValue={String(draftContent.service_agent_guidance || "")}
                />
              </div>
            </div>
          ) : null}
        </section>

        {/* Card 4: Optional Information (Organized, Collapsible Drawers) */}
        <section className="rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-sm">
          <div className="border-b border-[#EEF1F5] pb-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#6D28D9]">Optional Information</h2>
            <p className="text-xs text-[#6B7488]">Supplementary operational notes, configuration assets, timeline, and advanced recipient targeting.</p>
          </div>

          <div className="mt-3.5 space-y-3">
            {/* Drawer 1: Business Impact & Timeline */}
            <details className="group rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] overflow-hidden transition">
              <summary className="flex cursor-pointer items-center justify-between p-3.5 font-semibold text-xs text-[#0E1726] hover:bg-[#F8F5FF] select-none">
                <span className="flex items-center gap-2">
                  <span>Business Impact & Schedule</span>
                  {draftContent.impact_summary || draftContent.recommended_action || draftContent.outage_started_at ? (
                    <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" />
                  ) : null}
                </span>
                <ChevronDown className="h-4 w-4 text-[#8A93A5] transition group-open:rotate-180" />
              </summary>
              <div className="p-4 pt-2 bg-white border-t border-[#EEF1F5] space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">Business/user impact</label>
                  <textarea
                    name="impact_summary"
                    rows={2}
                    className={inputClass}
                    placeholder="Describe specific business disruption (defaults to public summary if left blank)."
                    defaultValue={String(draftContent.impact_summary || "")}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">What should users do?</label>
                  <textarea
                    name="recommended_action"
                    rows={2}
                    className={inputClass}
                    placeholder="Clear guidance or safety actions for affected users."
                    defaultValue={String(draftContent.recommended_action || "")}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">Outage started</label>
                    <input
                      name="outage_started_at"
                      type="datetime-local"
                      className={inputClass}
                      defaultValue={localDateTime(draftContent.outage_started_at)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">Next update</label>
                    <input
                      name="next_update_at"
                      type="datetime-local"
                      className={inputClass}
                      defaultValue={localDateTime(draftContent.next_update_at)}
                    />
                  </div>
                </div>
              </div>
            </details>

            {/* Drawer 2: Affected Configuration Items */}
            <details className="group rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] overflow-hidden transition">
              <summary className="flex cursor-pointer items-center justify-between p-3.5 font-semibold text-xs text-[#0E1726] hover:bg-[#F8F5FF] select-none">
                <span className="flex items-center gap-2">
                  <span>Affected Configuration Items</span>
                  {selectedCis.length ? (
                    <span className="rounded-full bg-[#F1ECFE] px-2 py-0.5 text-[10px] font-bold text-[#5B21B6]">
                      {selectedCis.length} selected
                    </span>
                  ) : null}
                </span>
                <ChevronDown className="h-4 w-4 text-[#8A93A5] transition group-open:rotate-180" />
              </summary>
              <div className="p-4 pt-2 bg-white border-t border-[#EEF1F5]">
                <SearchableChoicePicker
                  title="Affected configuration items (optional)"
                  description={selectedServiceIds.length ? "Results are limited to the selected services." : "Select a service first to narrow configuration items."}
                  kind="CONFIGURATION_ITEM"
                  serviceIds={selectedServiceIds}
                  selected={selectedCis}
                  onChange={setSelectedCis}
                  empty="No authorized configuration items match your search."
                />
              </div>
            </details>

            {/* Drawer 3: Additional Recipients */}
            <details className="group rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] overflow-hidden transition">
              <summary className="flex cursor-pointer items-center justify-between p-3.5 font-semibold text-xs text-[#0E1726] hover:bg-[#F8F5FF] select-none">
                <span className="flex items-center gap-2">
                  <span>Additional Recipients (Managers, Teams, Specific People)</span>
                  {selectedTeams.length || selectedUsers.length || selectedAudiences.includes("PROBLEM_MANAGERS") || selectedAudiences.includes("CHANGE_MANAGERS") ? (
                    <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" />
                  ) : null}
                </span>
                <ChevronDown className="h-4 w-4 text-[#8A93A5] transition group-open:rotate-180" />
              </summary>
              <div className="p-4 pt-2 bg-white border-t border-[#EEF1F5] space-y-4">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">Process Managers</label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {[
                      ["PROBLEM_MANAGERS", "Problem Managers", "The assigned investigator for a linked Problem."],
                      ["CHANGE_MANAGERS", "Change Managers", "The assigned manager for a linked Change."],
                    ].map(([value, label, description]) => {
                      const isChecked = selectedAudiences.includes(value);
                      return (
                        <label
                          key={value}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition ${
                            isChecked ? "border-[#8B5CF6] bg-[#F8F5FF]" : "border-[#E6E9F0] hover:border-[#DDD6FE]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggle(value, selectedAudiences, setSelectedAudiences)}
                            className="mt-0.5 accent-[#6D28D9]"
                          />
                          <div>
                            <span className="block text-xs font-semibold text-[#0E1726]">{label}</span>
                            <span className="block text-[11px] text-[#6B7488] leading-tight">{description}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <SearchableChoicePicker
                  title="Selected teams/groups (optional)"
                  description="Search authorized teams instead of scanning a long tenant-wide list."
                  kind="TEAM"
                  selected={selectedTeams}
                  onChange={setSelectedTeams}
                  empty="No authorized teams match your search."
                />

                <SearchableChoicePicker
                  title="Specific people (optional)"
                  description="Only people who already have an authorized relationship to the selected services or linked records are available."
                  kind="RECIPIENT"
                  serviceIds={selectedServiceIds}
                  relatedRecords={selectedLinks.map((item) => item.value)}
                  selected={selectedUsers}
                  onChange={setSelectedUsers}
                  empty="No eligible people match the selected services or linked records."
                />
              </div>
            </details>

            {/* Drawer 4: Related Records & Internal Notes */}
            <details id="related-operational-records" open={incidentPickerOpenRequest > 0} className="group rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] overflow-hidden transition">
              <summary className="flex cursor-pointer items-center justify-between p-3.5 font-semibold text-xs text-[#0E1726] hover:bg-[#F8F5FF] select-none">
                <span className="flex items-center gap-2">
                  <span>Related Operational Records & Internal Notes</span>
                  {selectedLinks.length || draftContent.internal_notes ? (
                    <span className="rounded-full bg-[#F1ECFE] px-2 py-0.5 text-[10px] font-bold text-[#5B21B6]">
                      {selectedLinks.length} linked
                    </span>
                  ) : null}
                </span>
                <ChevronDown className="h-4 w-4 text-[#8A93A5] transition group-open:rotate-180" />
              </summary>
              <div className="p-4 pt-2 bg-white border-t border-[#EEF1F5] space-y-4">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">Filter by Record type</label>
                    <select
                      value={relatedRecordType}
                      onChange={(event) => setRelatedRecordType(event.target.value)}
                      className="rounded-lg border border-[#DCE1E8] bg-white px-2.5 py-1 text-xs text-[#0E1726] outline-none"
                    >
                      <option value="">All record types</option>
                      <option value="INCIDENT">Incidents</option>
                      <option value="MAJOR_INCIDENT">Major incidents</option>
                      <option value="PROBLEM">Problems</option>
                      <option value="CHANGE">Changes</option>
                    </select>
                  </div>

                  <SearchableChoicePicker
                    key={`related-records-${incidentPickerOpenRequest}`}
                    title="Find records"
                    description="Search by record number or title. Only records you are authorized to link are returned."
                    kind="RELATED_RECORD"
                    recordType={relatedRecordType}
                    serviceIds={selectedServiceIds}
                    selected={selectedLinks}
                    onChange={setSelectedLinks}
                    empty="No authorized operational records match your search."
                    initiallyOpen={incidentPickerOpenRequest > 0}
                  />
                </div>

                <div className="border-t border-[#EEF1F5] pt-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[#475069]">
                    Internal operational notes <span className="font-normal text-[#8A93A5]">(Incident Manager and Auditor only)</span>
                  </label>
                  <textarea
                    name="internal_notes"
                    rows={2}
                    className={inputClass}
                    placeholder="Private operational notes. Never published to customer-facing channels."
                    defaultValue={String(draftContent.internal_notes || "")}
                  />
                </div>
              </div>
            </details>
          </div>
        </section>

        {/* Safety banner & actions */}
        <section className="rounded-2xl border border-[#DDD6FE] bg-[#F8F5FF] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 shrink-0 text-[#6D28D9]" />
            <div>
              <h2 className="text-xs font-bold text-[#0E1726]">Save privately, then verify before publishing</h2>
              <p className="text-[11px] text-[#475069]">
                Preview recipients shows who is included, why, which fields they see, and their allowed actions. Active channels: In-app & Portal warnings.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            <Link
              href={editingAlert ? `/itsm/incident-manager/outage-alerts/${editingAlert.id}` : "/itsm/incident-manager/outage-alerts"}
              className="rounded-xl border border-[#E6E9F0] bg-white px-4 py-2 text-xs font-semibold text-[#475069] hover:bg-[#F8F5FF]"
            >
              Cancel
            </Link>
            <button
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-5 py-2 text-xs font-semibold text-white hover:bg-[#5B21B6] shadow-sm disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : editingAlert ? "Save changes" : "Save draft"}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}

type PickerKind = "SERVICE" | "CONFIGURATION_ITEM" | "TEAM" | "RELATED_RECORD" | "RECIPIENT";

function SearchableChoicePicker({
  title,
  description,
  kind,
  selected,
  onChange,
  empty,
  recordType = "",
  serviceIds = [],
  relatedRecords = [],
  initiallyOpen = false,
}: {
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
  const toggleOption = (option: AlertReferenceOption) =>
    onChange(
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

  return (
    <div className="rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-[#0E1726]">{title}</p>
          <p className="text-[11px] text-[#6B7488]">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[#DDD6FE] bg-white px-2 py-0.5 text-[10px] font-bold text-[#5B21B6]" aria-live="polite">
            {selected.length} selected
          </span>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((val) => !val)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#DDD6FE] bg-white px-2.5 py-1 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"
          >
            <Search className="h-3 w-3" />
            {open ? "Hide search" : "Search options"}
          </button>
        </div>
      </div>

      {selected.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label={`Selected ${title.toLowerCase()}`}>
          {selected.map((item) => (
            <span
              key={item.value}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#DDD6FE] bg-[#F1ECFE] py-0.5 pl-2.5 pr-1 text-xs font-semibold text-[#5B21B6]"
            >
              <span className="max-w-60 truncate">{item.label}</span>
              <button
                type="button"
                onClick={() => toggleOption(item)}
                className="rounded-full p-0.5 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"
                aria-label={`Remove ${item.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {open ? (
        <>
          <label className="relative mt-2.5 block">
            <span className="sr-only">Search {title.toLowerCase()}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A93A5]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-xl border border-[#DCE1E8] bg-white py-2 pl-8 pr-8 text-xs outline-none transition focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#6D28D9]/10"
              placeholder={`Search ${title.toLowerCase()}…`}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#6B7488] hover:bg-[#F1ECFE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <div className="mt-2.5" role="listbox" aria-multiselectable="true" aria-label={title}>
            {loading && page.items.length === 0 ? (
              <p className="flex items-center gap-2 py-3 text-xs text-[#6B7488]">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading authorized options…
              </p>
            ) : loadError && page.items.length === 0 ? (
              <p role="alert" className="rounded-lg bg-[#FFF9F5] p-2.5 text-xs text-[#704C3B]">
                {loadError}
              </p>
            ) : page.items.length === 0 ? (
              <p className="py-3 text-xs text-[#6B7488]">{empty}</p>
            ) : (
              <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {page.items.map((item) => {
                  const active = selectedValues.has(item.value);
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      key={item.value}
                      onClick={() => toggleOption(item)}
                      className={`flex min-w-0 items-center gap-2.5 rounded-lg border p-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] ${
                        active ? "border-[#8B5CF6] bg-[#F8F5FF]" : "border-[#E6E9F0] bg-white hover:border-[#C4B5FD]"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          active ? "border-[#6D28D9] bg-[#6D28D9] text-white" : "border-[#C7CDD8] text-transparent"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-[#0E1726]">{item.label}</span>
                        <span className="block truncate text-[10px] text-[#6B7488]">{item.meta}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {page.items.length ? (
            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[#EEF1F5] pt-2">
              <p className="text-[11px] text-[#6B7488]">
                Showing {page.items.length} of {page.total} matching options
              </p>
              {page.has_more ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loading}
                  className="rounded-lg border border-[#DDD6FE] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-60"
                >
                  {loading ? "Loading…" : "Show more"}
                </button>
              ) : null}
            </div>
          ) : null}

          {loadError && page.items.length ? (
            <p role="alert" className="mt-1.5 text-xs text-[#704C3B]">
              {loadError}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function localDateTime(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function buildReferenceParams(
  kind: PickerKind,
  query: string,
  recordType: string,
  serviceIds: string[],
  relatedRecords: string[] = [],
  offset = 0,
) {
  const params = new URLSearchParams({ kind, limit: "20", offset: String(offset) });
  if (query.trim()) params.set("search", query.trim());
  if (recordType) params.set("record_type", recordType);
  serviceIds.forEach((id) => params.append("service_ids", id));
  relatedRecords.forEach((id) => params.append("related_records", id));
  return params;
}
