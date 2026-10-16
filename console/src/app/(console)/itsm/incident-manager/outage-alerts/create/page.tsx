"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  FilePlus2,
  Headphones,
  Info,
  Link2,
  LoaderCircle,
  Megaphone,
  Save,
  Search,
  ShieldCheck,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { alertApi, type AlertDetail, type AlertReferenceOption, type AlertReferenceOptionPage } from "@/lib/outage-alerts";

const intents = [
  { value: "INFORM", label: "Inform", description: "Share an outage or service-status update.", icon: Megaphone },
  { value: "ACTION_REQUIRED", label: "Action required", description: "Ask recipients to complete the stated action.", icon: AlertTriangle },
  { value: "INVESTIGATE", label: "Investigate", description: "Ask authorized responders to investigate.", icon: Search },
  { value: "RESOLVE", label: "Resolve", description: "Direct authorized responders toward resolution.", icon: Wrench },
] as const;

const primaryAudiences = [
  {
    value: "ALL_PORTAL_USERS",
    label: "Everyone in the organization",
    description: "Notify all active employee-facing portal users in this organization. Auditor and Platform Administrator accounts are excluded.",
    source: "Tenant-wide scope",
    icon: Users,
  },
  {
    value: "SERVICE_USERS",
    label: "Users of affected services",
    description: "People entitled to use the selected services.",
    source: "Service access",
    icon: Users,
  },
  {
    value: "SERVICE_AGENTS",
    label: "Service Agents",
    description: "Agents in support teams assigned to the selected services.",
    source: "Support coverage",
    icon: Headphones,
  },
  {
    value: "SERVICE_OWNERS",
    label: "Service owners",
    description: "Active owners responsible for the selected services.",
    source: "Service ownership",
    icon: User,
  },
] as const;

const drawerClass =
  "group overflow-hidden rounded-xl border border-[#E4E7EC] bg-white transition hover:border-[#D0D5DD] open:border-[#D8CFF3] open:shadow-[0_1px_3px_rgba(16,24,40,0.06)]";
const drawerSummaryClass =
  "flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-left select-none transition hover:bg-[#FAFAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED] [&::-webkit-details-marker]:hidden";
const drawerBodyClass = "space-y-4 border-t border-[#EAECF0] bg-[#FCFCFD] p-4";
type DrawerId = "IMPACT" | "CIS" | "RECIPIENTS" | "RECORDS";

export default function CreateOutageAlertPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [requiredDetailsComplete, setRequiredDetailsComplete] = useState(false);
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
  const [openDrawer, setOpenDrawer] = useState<DrawerId | null>("IMPACT");

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
          const nextLinks = returnedLink && !draftLinks.some((item) => item.value === returnedLink.value) ? [...draftLinks, returnedLink] : draftLinks;
          const nextHandling = content.service_agent_handling === "SOLVE" ? "SOLVE" : "ALERT_ONLY";
          setSelectedLinks(nextLinks);
          setHandling(nextHandling);
          if (nextHandling === "SOLVE" && !nextLinks.some((item) => item.value.startsWith("INCIDENT:"))) {
            setOpenDrawer("RECORDS");
          }
          setRequiredDetailsComplete(Boolean(String(content.title || "").trim() && String(content.public_summary || "").trim()));
        }).catch((cause) => setError(cause instanceof Error ? cause.message : "Draft could not be loaded")).finally(() => setLoadingDraft(false));
      } else if (relatedType && relatedId) {
        setSelectedLinks([{ value: `${relatedType}:${relatedId}`, label: "Linked operational record", meta: relatedType.replaceAll("_", " ") }]);
      }
    }, 0);
    return () => window.clearTimeout(request);
  }, []);

  const showAgentHandling = selectedAudiences.includes("SERVICE_AGENTS");
  const hasTenantWideAudience = selectedAudiences.includes("ALL_PORTAL_USERS");
  const requiresAffectedService = selectedAudiences.some((audience) =>
    ["SERVICE_USERS", "SERVICE_AGENTS", "SERVICE_OWNERS"].includes(audience),
  ) || selectedUsers.length > 0;
  const selectedServiceIds = useMemo(() => selectedServices.map((item) => item.value), [selectedServices]);
  const linkedIncident = useMemo(
    () => selectedLinks.find((item) => item.value.startsWith("INCIDENT:")),
    [selectedLinks],
  );
  const hasIncidentLink = Boolean(linkedIncident);
  const selectedAudienceCount = selectedAudiences.length + selectedTeams.length + selectedUsers.length;
  const deliveryScopeReady = selectedAudienceCount > 0 && (!requiresAffectedService || selectedServices.length > 0);
  const readyChecks = [requiredDetailsComplete, deliveryScopeReady, selectedAudienceCount > 0];
  const readyCount = readyChecks.filter(Boolean).length;
  const recipientEligibilityError = /selected user is not currently eligible/i.test(error);
  const toggleDrawer = (drawer: DrawerId) => setOpenDrawer((current) => current === drawer ? null : drawer);

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
    setSuccessMessage("");
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
        setSuccessMessage(editingAlert ? "Draft changes saved. Opening the alert…" : "Draft saved privately. Opening the alert…");
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        router.push(`/itsm/incident-manager/outage-alerts/${created.id}`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Draft could not be saved";
      setError(message);
      if (/selected user is not currently eligible/i.test(message)) {
        setOpenDrawer("RECIPIENTS");
        window.setTimeout(() => {
          document.getElementById("specific-people")?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
      }
      setSaving(false);
    }
  }

  const inputClass = "mt-1.5 w-full rounded-xl border border-[#D7DCE5] bg-white px-3.5 py-3 text-sm text-[#0E1726] outline-none transition placeholder:text-[#98A2B3] hover:border-[#C5CBD6] focus:border-[#7C3AED] focus:ring-2 focus:ring-[#6D28D9]/10";
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
    <div className="mx-auto max-w-5xl space-y-5 pb-24">
      {/* Header */}
      <header>
        <Link
          href="/itsm/incident-manager/outage-alerts"
          className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#5B21B6] hover:text-[#6D28D9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to alerts
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-[#0E1726] sm:text-3xl">
            {editingAlert ? "Edit outage alert" : "Create outage alert"}
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1ECFE] px-3 py-1 text-xs font-semibold text-[#5B21B6]">
            <ShieldCheck className="h-3.5 w-3.5" /> Private draft
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#667085]">
          Add the customer-safe message, affected services, and intended audience. You will preview exact recipients before anything is published.
        </p>
      </header>

      {successMessage ? (
        <div role="status" aria-live="polite" className="fixed bottom-24 right-5 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-[#A7F3D0] bg-white p-4 text-sm text-[#065F46] shadow-xl">
          <Check className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[#059669] p-1 text-white" />
          <div><strong className="block">Saved successfully</strong><span>{successMessage}</span></div>
        </div>
      ) : null}

      <div className="rounded-xl border border-[#E6E9F0] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-semibold text-[#172033]">Draft readiness</p><p className="text-xs text-[#667085]">Complete the message, service scope, and audience before preview.</p></div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#5B21B6]"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F1ECFE]">{readyCount}</span> of 3 essentials ready</div>
        </div>
      </div>

      {error && !recipientEligibilityError ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#FECACA] bg-[#FFF7F7] p-4 text-sm text-[#991B1B]">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div><strong className="block">Draft could not be saved</strong>{error}</div>
        </div>
      ) : null}

      <form
        key={editingAlert?.id || "new-alert"}
        onSubmit={submit}
        onInput={(event) => {
          const form = event.currentTarget;
          const title = (form.elements.namedItem("title") as HTMLInputElement | null)?.value.trim();
          const summary = (form.elements.namedItem("public_summary") as HTMLTextAreaElement | null)?.value.trim();
          const complete = Boolean(title && summary);
          setRequiredDetailsComplete((current) => current === complete ? current : complete);
        }}
        className="space-y-5"
      >
        {/* Card 1: Alert Details */}
        <section className="rounded-2xl border border-[#E1E5EC] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6">
          <div className="border-b border-[#EEF1F5] pb-3">
            <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#6D28D9] text-sm font-bold text-white">1</span><h2 className="text-lg font-semibold tracking-tight text-[#172033]">Alert details</h2></div>
            <p className="mt-1 pl-11 text-sm text-[#667085]">The essential facts recipients need to understand the disruption.</p>
          </div>

          <div className="mt-3.5 space-y-3.5">
            <div>
              <label className="text-sm font-semibold text-[#344054]">
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
                <label className="text-sm font-semibold text-[#344054]">
                  Alert type <span className="text-[#DC2626]">*</span>
                </label>
                <select name="alert_type" className={inputClass} defaultValue={String(draftContent.alert_type || "OUTAGE")}>
                  <option value="OUTAGE">Outage</option>
                  <option value="DEGRADATION">Degradation</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="INFORMATION">Information</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold text-[#344054]">
                  Severity <span className="text-[#DC2626]">*</span>
                </label>
                <select name="severity" className={inputClass} defaultValue={String(draftContent.severity || "HIGH")}>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-[#344054]">
                Customer-safe summary <span className="text-[#DC2626]">*</span>
              </label>
              <textarea
                required
                name="public_summary"
                rows={4}
                className={inputClass}
                placeholder="Explain what users are experiencing without internal jargon or sensitive configuration tokens."
                defaultValue={String(draftContent.public_summary || "")}
              />
              <p className="mt-1.5 text-xs leading-5 text-[#667085]">Customer-facing content only. Do not include credentials, internal notes, or sensitive technical details.</p>
            </div>
          </div>
        </section>

        {/* Card 2: Affected Services */}
        <section id="affected-services" className="scroll-mt-24 rounded-2xl border border-[#E1E5EC] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6">
          <div className="border-b border-[#EEF1F5] pb-3">
            <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#6D28D9] text-sm font-bold text-white">2</span><h2 className="text-lg font-semibold tracking-tight text-[#172033]">Affected services</h2>{hasTenantWideAudience && !requiresAffectedService ? <span className="rounded-full bg-[#F1F3F7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#667085]">Optional</span> : null}</div>
            <p className="mt-1 pl-11 text-sm text-[#667085]">{hasTenantWideAudience && !requiresAffectedService ? "Affected services are optional for this audience. Add one only when the communication concerns a specific service." : "Services define recipient eligibility and keep related records within the correct scope."}</p>
          </div>

          <div className="mt-4">
            <SearchableChoicePicker
              title="Select affected services"
              description="Search by service name. You select the service; AuthClaw resolves eligible people automatically."
              kind="SERVICE"
              selected={selectedServices}
              onChange={setSelectedServices}
              empty="No authorized services match your search."
            />
          </div>
        </section>

        {/* Card 3: Audience and Communication Intent */}
        <section className="overflow-hidden rounded-2xl border border-[#E1E5EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex items-start gap-3 border-b border-[#E8EBF1] px-5 py-4 sm:px-6">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6D28D9] text-sm font-bold text-white">3</span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-[#172033]">Audience and intent</h2>
              <p className="mt-0.5 max-w-2xl text-sm leading-5 text-[#667085]">
                Choose why you are communicating and which business audiences should receive it.
              </p>
            </div>
          </div>

          <div className="space-y-5 p-5 sm:p-6">
            {/* Intent selector */}
            <fieldset className="min-w-0">
              <legend className="sr-only">Communication intent</legend>
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-[#172033]">Communication intent <span className="text-[#DC2626]">*</span></h3>
                <p className="mt-1 text-xs leading-5 text-[#667085]">What should recipients understand or do? Intent never overrides authorization.</p>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {intents.map(({ value, label, description, icon: Icon }) => {
                  const isSelected = selectedIntent === value;
                  return (
                    <label
                      key={value}
                      className={`group relative flex min-h-24 cursor-pointer flex-col rounded-xl border p-3.5 outline-none transition focus-within:ring-2 focus-within:ring-[#6D28D9]/20 ${
                        isSelected
                          ? "border-[#7C3AED] bg-[#F7F3FF] shadow-[0_1px_3px_rgba(109,40,217,0.12)]"
                          : "border-[#DDE2EA] bg-white hover:border-[#C4B5FD] hover:bg-[#FDFCFF]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="intent"
                        value={value}
                        checked={isSelected}
                        onChange={() => setSelectedIntent(value)}
                        className="sr-only"
                      />
                      <div className="flex items-start justify-between gap-3">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${isSelected ? "bg-[#6D28D9] text-white" : "bg-[#F1F3F7] text-[#536079] group-hover:bg-[#F3EEFF] group-hover:text-[#6D28D9]"}`}>
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${isSelected ? "border-[#6D28D9] bg-[#6D28D9] text-white" : "border-[#BCC4D0] bg-white"}`} aria-hidden="true">
                          {isSelected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                        </span>
                      </div>
                      <span className="mt-3 text-sm font-semibold text-[#172033]">{label}</span>
                      <span className="mt-1 text-xs leading-5 text-[#59657A]">{description}</span>
                    </label>
                  );
                })}
              </div>
              {selectedIntent === "ACTION_REQUIRED" ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#DDD6FE] bg-[#F7F3FF] p-3 text-xs leading-5 text-[#4C1D95]">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p><strong>Add clear instructions.</strong> Include the action recipients should take in Optional Information.</p>
                </div>
              ) : null}
            </fieldset>

            {/* Primary audiences */}
            <fieldset className="min-w-0 border-t border-[#EEF1F5] pt-5">
              <legend className="sr-only">Who should receive this alert?</legend>
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-[#172033]">Who should receive this alert? <span className="text-[#DC2626]">*</span></h3>
                <p className="mt-1 text-xs leading-5 text-[#667085]">Select audience groups—not individual people.</p>
              </div>
              {hasTenantWideAudience ? (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-[#DDD6FE] bg-[#F8F5FF] p-3 text-xs leading-5 text-[#4C1D95]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p><strong>Broad audience selected.</strong> AuthClaw will show the exact eligible count before publication and require a separate confirmation. People without an AuthClaw portal account cannot receive the in-app alert.</p>
                </div>
              ) : null}
              <div className="space-y-2.5">
                {primaryAudiences.map(({ value, label, description, source, icon: Icon }) => {
                  const isChecked = selectedAudiences.includes(value);
                  return (
                    <label
                      key={value}
                      className={`group flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 outline-none transition focus-within:ring-2 focus-within:ring-[#6D28D9]/20 ${
                        isChecked
                          ? "border-[#7C3AED] bg-[#F7F3FF] shadow-[0_1px_3px_rgba(109,40,217,0.1)]"
                          : "border-[#DDE2EA] bg-white hover:border-[#C4B5FD] hover:bg-[#FDFCFF]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(value, selectedAudiences, setSelectedAudiences)}
                        className="sr-only"
                      />
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isChecked ? "bg-[#EDE9FE] text-[#6D28D9]" : "bg-[#F1F3F7] text-[#536079] group-hover:bg-[#F3EEFF] group-hover:text-[#6D28D9]"}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-3">
                          <span className="text-sm font-semibold text-[#172033]">{label}</span>
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${isChecked ? "border-[#6D28D9] bg-[#6D28D9] text-white" : "border-[#BCC4D0] bg-white"}`} aria-hidden="true">
                            {isChecked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-[#59657A]">{description}</span>
                        <span className="mt-1.5 inline-flex rounded-full bg-[#F1F3F7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#667085]">{source}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <div className="mx-5 mb-5 flex items-start gap-2.5 rounded-xl bg-[#F8FAFC] px-3.5 py-3 sm:mx-6">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#6D28D9]" aria-hidden="true" />
            <p className="text-xs leading-5 text-[#59657A]">
              <strong className="font-semibold text-[#344054]">Recipients are resolved automatically.</strong>{" "}
              Eligibility comes from the selected tenant-wide scope, service access, support-team coverage, and service ownership when you preview or publish.
            </p>
          </div>

          {/* Service Agent handling (conditional) */}
          {showAgentHandling ? (
            <div className="mx-5 mb-5 rounded-xl border border-[#DDD6FE] bg-[#FAF8FF] p-4 sm:mx-6">
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
                      onChange={() => {
                        setHandling(value);
                        if (value === "SOLVE" && !hasIncidentLink) {
                          setRelatedRecordType("INCIDENT");
                          setOpenDrawer("RECORDS");
                          setIncidentPickerOpenRequest((request) => request + 1);
                        }
                      }}
                      className="mt-0.5 accent-[#6D28D9]"
                    />
                    <div>
                      <span className="block text-xs font-semibold text-[#0E1726]">{label}</span>
                      <span className="block text-[11px] text-[#6B7488] leading-tight mt-0.5">{description}</span>
                    </div>
                  </label>
                ))}
              </div>

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

        {/* Communication and advanced context */}
        <section className="rounded-2xl border border-[#E1E5EC] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6">
          <div className="border-b border-[#EEF1F5] pb-3">
            <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#6D28D9] text-sm font-bold text-white">4</span><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold tracking-tight text-[#172033]">Communication details</h2><span className="rounded-full bg-[#F1F3F7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#667085]">Optional</span></div></div>
            <p className="mt-1 pl-11 text-sm text-[#667085]">Add impact, recommended action, and timing when they help recipients.</p>
          </div>

          <div className="mt-3.5 space-y-3">
            {/* Drawer 1: Business Impact & Timeline */}
            <details open={openDrawer === "IMPACT"} className={drawerClass}>
              <summary className={drawerSummaryClass} onClick={(event) => { event.preventDefault(); toggleDrawer("IMPACT"); }}>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[#1D2939]">
                    Customer impact and timing
                  {draftContent.impact_summary || draftContent.recommended_action || draftContent.outage_started_at ? (
                    <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" />
                  ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-[#667085]">Impact, user guidance, and expected update times</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[#667085] transition group-open:rotate-180 group-open:text-[#6D28D9]" />
              </summary>
              <div className={drawerBodyClass}>
                <div>
                  <label className="text-sm font-semibold text-[#344054]">Business or user impact <span className="ml-2 text-xs font-normal text-[#8A93A5]">Optional</span></label>
                  <textarea
                    name="impact_summary"
                    rows={2}
                    className={inputClass}
                    placeholder="Describe specific business disruption (defaults to public summary if left blank)."
                    defaultValue={String(draftContent.impact_summary || "")}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[#344054]">What should users do? <span className="ml-2 text-xs font-normal text-[#8A93A5]">Optional</span></label>
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
                    <label className="text-sm font-semibold text-[#344054]">Outage started <span className="ml-2 text-xs font-normal text-[#8A93A5]">Optional</span></label>
                    <input
                      name="outage_started_at"
                      type="datetime-local"
                      className={inputClass}
                      defaultValue={localDateTime(draftContent.outage_started_at)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[#344054]">Expected next update <span className="ml-2 text-xs font-normal text-[#8A93A5]">Optional</span></label>
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

            <div className="flex items-start gap-3 pt-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6D28D9] text-sm font-bold text-white">5</span>
              <div><h3 className="text-base font-semibold text-[#172033]">Related records and advanced options</h3><p className="mt-0.5 text-xs leading-5 text-[#667085]">Open only the optional areas you need.</p></div>
            </div>

            {/* Drawer 2: Affected Configuration Items */}
            <details open={openDrawer === "CIS"} className={drawerClass}>
              <summary className={drawerSummaryClass} onClick={(event) => { event.preventDefault(); toggleDrawer("CIS"); }}>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#1D2939]">
                    Affected configuration items
                  {selectedCis.length ? (
                    <span className="rounded-full bg-[#F1ECFE] px-2 py-0.5 text-[10px] font-bold text-[#5B21B6]">
                      {selectedCis.length} selected
                    </span>
                  ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-[#667085]">Optionally identify impacted infrastructure or applications</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[#667085] transition group-open:rotate-180 group-open:text-[#6D28D9]" />
              </summary>
              <div className={drawerBodyClass}>
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
            <details
              open={openDrawer === "RECIPIENTS"}
              className={drawerClass}
            >
              <summary className={drawerSummaryClass} onClick={(event) => { event.preventDefault(); toggleDrawer("RECIPIENTS"); }}>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#1D2939]">
                    Additional recipients
                  {selectedTeams.length || selectedUsers.length || selectedAudiences.includes("PROBLEM_MANAGERS") || selectedAudiences.includes("CHANGE_MANAGERS") ? (
                    <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" />
                  ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-[#667085]">Managers, authorized teams, or specific eligible people</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[#667085] transition group-open:rotate-180 group-open:text-[#6D28D9]" />
              </summary>
              <div className={drawerBodyClass}>
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

                <div id="specific-people" className="scroll-mt-24">
                  <SearchableChoicePicker
                    title="Specific people (optional)"
                    description="Use only for an exception. The person must already be eligible through the selected services or linked records."
                    kind="RECIPIENT"
                    serviceIds={selectedServiceIds}
                    relatedRecords={selectedLinks.map((item) => item.value)}
                    selected={selectedUsers}
                    onChange={(items) => {
                      setSelectedUsers(items);
                      if (recipientEligibilityError) setError("");
                    }}
                    empty="No eligible people match the selected services or linked records."
                    error={recipientEligibilityError ? "This person is not eligible for the selected services or linked records. Check the affected service, add a related record, or remove this recipient." : ""}
                  />
                </div>
              </div>
            </details>

            {/* Drawer 4: Related Records & Internal Notes */}
            <details
              id="related-operational-records"
              open={openDrawer === "RECORDS"}
              className={drawerClass}
            >
              <summary className={drawerSummaryClass} onClick={(event) => { event.preventDefault(); toggleDrawer("RECORDS"); }}>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#1D2939]">
                    Related records and internal notes
                  {handling === "SOLVE" && !hasIncidentLink ? (
                    <span className="rounded-full bg-[#F1ECFE] px-2 py-0.5 text-[10px] font-semibold text-[#5B21B6]">
                      Incident needed
                    </span>
                  ) : selectedLinks.length ? (
                    <span className="rounded-full bg-[#F1ECFE] px-2 py-0.5 text-[10px] font-bold text-[#5B21B6]">
                      {selectedLinks.length} linked
                    </span>
                  ) : draftContent.internal_notes ? (
                    <span className="rounded-full bg-[#F1F3F7] px-2 py-0.5 text-[10px] font-bold text-[#59657A]">
                      Notes added
                    </span>
                  ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-[#667085]">Link operational work and add restricted context when needed</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[#667085] transition group-open:rotate-180 group-open:text-[#6D28D9]" />
              </summary>
              <div className={drawerBodyClass}>
                {handling === "SOLVE" ? (
                  hasIncidentLink ? (
                    <div className="flex items-start gap-2.5 rounded-xl border border-[#A7F3D0] bg-[#F0FDF4] p-3.5 text-[#065F46]">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="text-xs font-bold">Resolution work is tracked in {linkedIncident?.label}</p>
                        <p className="mt-0.5 text-[11px] leading-5">Authorized Service Agents can use the linked Incident for ownership, assignment, and work history.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[#DDD6FE] bg-[#F8F7FC] p-4">
                      <div className="flex items-start gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EDE9FE] text-[#6D28D9]">
                          <Link2 className="h-3.5 w-3.5" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-[#2D2450]">Choose how resolution work will be tracked</p>
                          <p className="mt-1 text-xs leading-5 text-[#625A7A]">Solve uses an Incident for ownership, assignment, and work history.</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRelatedRecordType("INCIDENT");
                            setOpenDrawer("RECORDS");
                            setIncidentPickerOpenRequest((request) => request + 1);
                          }}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#CFC5EC] bg-white px-3 text-xs font-semibold text-[#5B21B6] transition hover:border-[#A78BFA] hover:bg-[#F5F3FF]"
                        >
                          <Link2 className="h-3.5 w-3.5" /> Link existing Incident
                        </button>
                        <button
                          type="submit"
                          name="save_action"
                          value="CREATE_INCIDENT"
                          disabled={saving}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#6D28D9] px-3 text-xs font-semibold text-white hover:bg-[#5B21B6] disabled:opacity-60"
                        >
                          <FilePlus2 className="h-3.5 w-3.5" /> {saving ? "Saving draft…" : "Create new Incident"}
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-[#667085]">Creating an Incident saves this Alert as a private draft. It never publishes the Alert automatically.</p>
                    </div>
                  )
                ) : null}

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#475069]">Related records</p>
                      <p className="mt-0.5 text-[11px] leading-5 text-[#667085]">Link only records that provide useful operational context for this alert.</p>
                    </div>
                    <select
                      aria-label="Filter related records by type"
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
                    description="Search by record number or title. Results are restricted to authorized records for the affected services."
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
                    Internal operational notes <span className="font-normal normal-case tracking-normal text-[#8A93A5]">Optional</span>
                  </label>
                  <p className="mt-1 text-[11px] leading-5 text-[#667085]">Visible only to authorized Incident Managers and Auditors. Never included in recipient communications.</p>
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
        <section className="sticky bottom-3 z-20 flex flex-col items-start justify-between gap-3 rounded-2xl border border-[#D8DDE6] bg-white/95 p-4 shadow-[0_10px_30px_rgba(16,24,40,0.12)] backdrop-blur sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 shrink-0 text-[#6D28D9]" />
            <div>
              <h2 className="text-sm font-semibold text-[#172033]">Save privately, then preview recipients</h2>
              <p className="text-xs leading-5 text-[#667085]">
                Publishing remains a separate, intentional action on the alert detail page.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
            <Link
              href={editingAlert ? `/itsm/incident-manager/outage-alerts/${editingAlert.id}` : "/itsm/incident-manager/outage-alerts"}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#D8DDE6] bg-white px-4 text-sm font-semibold text-[#475069] hover:bg-[#F8F5FF]"
            >
              Cancel
            </Link>
            <button
              disabled={saving}
              className="inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-xl bg-[#6D28D9] px-5 text-sm font-semibold text-white shadow-sm hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {saving ? "Saving…" : editingAlert ? "Save changes" : "Save draft"}
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
  error = "",
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
  error?: string;
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
    <div className={error ? "rounded-xl border border-[#FCA5A5] bg-[#FFF7F7] p-4 ring-1 ring-[#FECACA]" : "rounded-xl border border-[#E1E5EC] bg-[#FCFCFD] p-4"} aria-invalid={error ? "true" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[#172033]">{title}</p>
          <p className="mt-0.5 text-xs leading-5 text-[#667085]">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[#DDD6FE] bg-white px-2 py-0.5 text-[10px] font-bold text-[#5B21B6]" aria-live="polite">
            {selected.length} selected
          </span>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((val) => !val)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#DDD6FE] bg-white px-3 text-xs font-semibold text-[#5B21B6] hover:bg-[#F1ECFE] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]"
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

      {error ? (
        <p role="alert" className="mt-2.5 flex items-start gap-2 rounded-lg bg-white p-2.5 text-xs leading-5 text-[#B42318]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      ) : null}

      {open ? (
        <>
          <label className="relative mt-2.5 block">
            <span className="sr-only">Search {title.toLowerCase()}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A93A5]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-xl border border-[#D7DCE5] bg-white py-3 pl-9 pr-9 text-sm outline-none transition placeholder:text-[#98A2B3] focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#6D28D9]/10"
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
              <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {page.items.map((item) => {
                  const active = selectedValues.has(item.value);
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      key={item.value}
                      onClick={() => toggleOption(item)}
                      className={`flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg border p-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9] ${
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
