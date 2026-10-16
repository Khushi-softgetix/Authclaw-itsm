"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, BellRing, CheckCircle2, Clock3, ExternalLink, FileCheck2, GitPullRequest, Headphones, Radio, ShieldCheck, Users } from "lucide-react";
import {
  alertApi,
  type AlertDetail,
  canOpenLinkedIncident as canOpenAlertIncident,
  formatAlertDate,
  formatPublicStatus,
  getAlertIncidentLinks,
  getAlertProcessLinks,
  getPrimaryIncidentLink,
  getProcessLinkHref,
} from "@/lib/outage-alerts";

type Publication = {
  id?: string;
  version?: number;
  type?: string;
  published_at?: string;
  publisher_id?: string;
  publisher_display?: string;
  recipient_count?: number;
  audience_snapshot?: Array<Record<string, unknown>>;
  recipient_resolution?: Record<string, Record<string, number>>;
  delivery_channels?: string[];
  exclusion_evidence?: string;
  content?: Record<string, unknown>;
};

export default function RecipientAlertPage() {
  const { alertId } = useParams<{ alertId: string }>();
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setAlert(await alertApi<AlertDetail>(`/${alertId}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Alert unavailable");
    }
  }, [alertId]);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  async function acknowledge() {
    setBusy(true);
    try {
      await alertApi(`/${alertId}/acknowledge`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Acknowledgement failed");
    } finally {
      setBusy(false);
    }
  }

  if (!alert) {
    return (
      <div className="mx-auto max-w-4xl rounded-2xl border border-[#E6E9F0] bg-white p-8 text-center">
        {error ? (
          <>
            <AlertTriangle className="mx-auto h-6 w-6 text-[#8A5A2B]" />
            <p className="mt-3 font-semibold">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-4 text-sm font-semibold text-[#5B21B6]">Try again</button>
          </>
        ) : <p className="text-[#6B7488]">Loading authorized alert view...</p>}
      </div>
    );
  }

  const content = alert.content;
  const publicStatus = formatPublicStatus(content.public_status);
  const isRecovered = alert.status === "RECOVERED" || content.public_status === "RECOVERED";
  const publications = [...alert.publications].reverse() as Publication[];
  const backHref =
    alert.projection_type === "AUDITOR"
      ? "/itsm/dashboard/auditor/outage-alerts"
      : alert.projection_type === "DELIVERY_OPERATOR"
      ? "/itsm/admin-portal/broadcast-health"
      : "/itsm/outage-alerts";

  const incidentLinks = getAlertIncidentLinks(alert.links);
  const primaryIncidentLink = getPrimaryIncidentLink(alert.links);
  const canOpenLinkedIncident = canOpenAlertIncident(alert);
  const processLinks = getAlertProcessLinks(alert.links);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-[#5B21B6]">
        <ArrowLeft className="h-4 w-4" />
        {alert.projection_type === "AUDITOR"
          ? "Back to outage evidence"
          : alert.projection_type === "DELIVERY_OPERATOR"
          ? "Back to broadcast delivery health"
          : "Back to service alerts"}
      </Link>
      {error ? <div className="rounded-xl border border-[#E7D9CF] bg-[#FFF9F5] p-4 text-sm text-[#704C3B]">{error}</div> : null}

      <article className="overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-[0_18px_50px_-36px_rgba(91,33,182,.55)]">
        <header className="border-b border-[#DDD6FE] bg-[#F8F5FF] p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#6D28D9]">
            <BellRing className="h-4 w-4" />
            {isRecovered ? "Recovered service alert" : "Active service alert"}
            <span aria-hidden="true">·</span>
            <span>{publicStatus}</span>
            {content.severity ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="rounded-md border border-[#DDD6FE] bg-white px-2 py-0.5 text-[11px] font-bold text-[#5B21B6]">
                  {String(content.severity)}
                </span>
              </>
            ) : null}
            {content.intent ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{String(content.intent).replaceAll("_", " ")}</span>
              </>
            ) : null}
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{String(content.title || alert.alert_number)}</h1>
          <p className="mt-3 max-w-3xl text-[#475069]">{String(content.public_summary || "")}</p>
        </header>

        <div className="p-6 sm:p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Affected services" value={alert.affected_services.map((service) => service.name).join(", ") || "Service scope unavailable"} />
            <Field label="Current status" value={publicStatus} />
            {content.severity ? <Field label="Severity" value={content.severity} /> : null}
            {content.intent ? <Field label="Intent" value={String(content.intent).replaceAll("_", " ")} /> : null}
            <Field label="Outage started" value={content.outage_started_at ? formatAlertDate(String(content.outage_started_at)) : "Start time not announced"} />
            <Field label="Last public update" value={content.latest_publication_at ? formatAlertDate(String(content.latest_publication_at)) : "Not available"} />
            {isRecovered ? <Field label="Recovered at" value={content.recovered_at ? formatAlertDate(String(content.recovered_at)) : "Recovery time unavailable"} /> : null}
            <Field label="Next update" value={!isRecovered && content.next_update_at ? formatAlertDate(String(content.next_update_at)) : isRecovered ? "No further update scheduled" : "No time announced"} />
            <Field label="Business impact" value={content.impact_summary} wide />
            <Field label="What you should do" value={content.recommended_action || "No action is required at this time."} wide />
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            {alert.allowed_actions.includes("ACKNOWLEDGE") ? (
              <button disabled={busy} onClick={() => void acknowledge()} className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#5B21B6] disabled:opacity-60">
                <CheckCircle2 className="h-4 w-4" /> {busy ? "Recording..." : "Acknowledge"}
              </button>
            ) : null}
            {canOpenLinkedIncident && primaryIncidentLink ? (
              <Link
                href={`/itsm/incidents/${primaryIncidentLink.id}`}
                className="inline-flex items-center gap-2 rounded-xl border border-[#8B5CF6] bg-white px-4 py-2.5 text-sm font-semibold text-[#5B21B6] shadow-sm hover:bg-[#F8F5FF]"
              >
                <ExternalLink className="h-4 w-4" /> Open linked incident
              </Link>
            ) : null}
          </div>
        </div>
      </article>

      {alert.projection_type === "SERVICE_AGENT" ? (
        <section className="rounded-2xl border border-[#DDD6FE] bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 font-semibold text-[#0E1726]">
            <Headphones className="h-5 w-5 text-[#6D28D9]" /> Operational support guidance
          </h2>
          <p className="mt-1 text-xs text-[#6B7488]">Approved operational instructions and authorized resolution links for Service Agents.</p>

          <div className="mt-4 rounded-xl border border-[#DDD6FE] bg-[#F8F5FF] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6D28D9]">Approved guidance</p>
            {content.service_agent_guidance ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-[#352A52]">{String(content.service_agent_guidance)}</p>
            ) : (
              <p className="mt-2 text-sm italic text-[#6B7488]">No specific agent guidance was issued for this alert.</p>
            )}
            {content.service_agent_handling ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-[#5B5670]">
                <span className="font-semibold text-[#352A52]">Handling mode:</span>
                <span className="rounded border border-[#DDD6FE] bg-white px-2 py-0.5 font-medium">{String(content.service_agent_handling).replaceAll("_", " ")}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-5 border-t border-[#EEF1F5] pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8A93A5]">Authorized resolution incidents</h3>
            {incidentLinks.length ? (
              <ul className="mt-3 space-y-2">
                {incidentLinks.map((link) => (
                  <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] p-3 text-sm">
                    <div>
                      <span className="font-semibold text-[#0E1726]">{link.type.replaceAll("_", " ")}</span>
                      <span className="ml-2 font-mono text-xs text-[#6B7488]">{link.id}</span>
                    </div>
                    <Link
                      href={`/itsm/incidents/${link.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#DDD6FE] bg-white px-3 py-1.5 text-xs font-semibold text-[#5B21B6] hover:bg-[#F8F5FF]"
                    >
                      Open incident <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[#6B7488]">No authorized incidents are currently linked to this alert.</p>
            )}
          </div>
        </section>
      ) : null}

      {alert.projection_type === "PROCESS_MANAGER" ? (
        <section className="rounded-2xl border border-[#DDD6FE] bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 font-semibold text-[#0E1726]">
            <GitPullRequest className="h-5 w-5 text-[#6D28D9]" /> Associated investigation records
          </h2>
          <p className="mt-1 text-xs text-[#6B7488]">Problem and Change records assigned to your queue for this outage.</p>

          {processLinks.length ? (
            <ul className="mt-4 space-y-2">
              {processLinks.map((link) => {
                const isProblem = link.type === "PROBLEM";
                const targetHref = getProcessLinkHref(link);
                if (!targetHref) return null;
                return (
                  <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] p-3 text-sm">
                    <div>
                      <span className="font-semibold text-[#0E1726]">{isProblem ? "Problem Record" : "Change Request"}</span>
                      <span className="ml-2 font-mono text-xs text-[#6B7488]">{link.id}</span>
                    </div>
                    <Link
                      href={targetHref}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#DDD6FE] bg-white px-3 py-1.5 text-xs font-semibold text-[#5B21B6] hover:bg-[#F8F5FF]"
                    >
                      View {isProblem ? "problem" : "change"} <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[#6B7488]">No operational records are currently linked to your queue for this alert.</p>
          )}
        </section>
      ) : null}

      {alert.projection_type === "AUDITOR" ? (
        <AuditorEvidence alert={alert} content={content} publications={publications} />
      ) : null}

      {alert.projection_type === "DELIVERY_OPERATOR" ? (
        <DeliveryOperatorDiagnostics alert={alert} />
      ) : null}

      <section className="rounded-2xl border border-[#E6E9F0] bg-white p-6">
        <h2 className="flex items-center gap-2 font-semibold"><Clock3 className="h-5 w-5 text-[#6D28D9]" /> Communication history</h2>
        {publications.length ? (
          <ol className="mt-4 space-y-3">
            {publications.map((publication, index) => <HistoryEntry key={publication.id || publication.version || index} publication={publication} latest={index === 0} />)}
          </ol>
        ) : <p className="mt-4 rounded-xl bg-[#FBFAF9] p-4 text-sm text-[#6B7488]">No public communication has been published.</p>}
      </section>

      <p className="flex items-center gap-2 text-xs text-[#6B7488]"><ShieldCheck className="h-4 w-4" /> This view contains only information authorized for your role and scope. Restricted operational notes and recipient identities are not included.</p>
    </div>
  );
}

function displayLabel(value: unknown) {
  return String(value || "Unavailable").toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function AuditorEvidence({ alert, content, publications }: { alert: AlertDetail; content: Record<string, unknown>; publications: Publication[] }) {
  const evidence = alert.evidence;
  const checks = evidence?.summary?.checks || {};
  const auditEvents = evidence?.audit_events || [];
  const latestPublication = publications[0];
  const audienceSnapshot = latestPublication?.audience_snapshot || (Array.isArray(content.audiences) ? content.audiences as Array<Record<string, unknown>> : []);
  const audienceTypes = [...new Set(audienceSnapshot.map((item) => String(item.type || "UNKNOWN")))];
  const resolution = latestPublication?.recipient_resolution || {};
  const evidenceStatus = evidence?.summary?.status || "UNAVAILABLE";

  return <div className="space-y-5">
    <section className="rounded-2xl border border-[#DDD6FE] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-[#6D28D9]" /> Governance summary</h2><p className="mt-1 text-xs text-[#6B7488]">Read-only lifecycle and actor evidence for this canonical alert.</p></div>
        <span className="rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-1 text-xs font-bold text-[#5B21B6]">{displayLabel(evidenceStatus)}</span>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="Created" value={content.created_at ? formatAlertDate(String(content.created_at)) : "Not recorded"} />
        <Field label="Created by" value={evidence?.creator_display || content.created_by_id || "Actor unavailable"} />
        <Field label="Last updated" value={content.updated_at ? formatAlertDate(String(content.updated_at)) : "Not recorded"} />
        <Field label="Updated by" value={evidence?.updated_by_display || content.updated_by_id || "Actor unavailable"} />
        <Field label="Current lifecycle" value={`${alert.status} · ${formatPublicStatus(content.public_status)}`} />
        <Field label="Latest published version" value={latestPublication?.version ? `Version ${latestPublication.version} · ${displayLabel(latestPublication.type)}` : "Not published"} />
        <Field label="Related records" value={alert.links.map((link) => `${link.type}: ${link.id}`).join("\n") || "None linked"} wide />
      </div>
    </section>

    <section className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-2xl border border-[#E6E9F0] bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold"><Users className="h-5 w-5 text-[#6D28D9]" /> Audience &amp; recipient resolution</h2>
        <p className="mt-1 text-xs text-[#6B7488]">Categories and aggregate outcomes only. Recipient identities are intentionally hidden.</p>
        <div className="mt-4 flex flex-wrap gap-2">{audienceTypes.length ? audienceTypes.map((audience) => <span key={audience} className="rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-3 py-1 text-xs font-semibold text-[#5B21B6]">{displayLabel(audience)}</span>) : <span className="text-sm text-[#6B7488]">No audience configured.</span>}</div>
        <div className="mt-5 space-y-3">{Object.keys(resolution).length ? Object.entries(resolution).map(([audience, states]) => <div key={audience} className="rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-[#0E1726]">{displayLabel(audience)}</p><p className="text-xs font-semibold text-[#5B21B6]">{Object.values(states).reduce((total, count) => total + count, 0)} resolved</p></div><p className="mt-1 text-xs text-[#6B7488]">{Object.entries(states).map(([state, count]) => `${displayLabel(state)}: ${count}`).join(" · ")}</p></div>) : <p className="rounded-xl bg-[#FBFAF9] p-4 text-sm text-[#6B7488]">No resolved-recipient evidence is available for the latest version.</p>}</div>
        <p className="mt-4 text-xs text-[#8A5A2B]">Exclusion reasons: {displayLabel(latestPublication?.exclusion_evidence || "NOT_COLLECTED")}. A missing exclusion record does not prove that no one was excluded.</p>
      </div>

      <div className="rounded-2xl border border-[#E6E9F0] bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold"><Radio className="h-5 w-5 text-[#6D28D9]" /> Delivery evidence</h2>
        <p className="mt-1 text-xs text-[#6B7488]">Recorded application states—not provider delivery or message-read confirmation.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">{alert.delivery_summary && Object.keys(alert.delivery_summary).length ? Object.entries(alert.delivery_summary).map(([state, count]) => <div key={state} className="rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] p-3"><p className="text-2xl font-bold text-[#0E1726]">{count}</p><p className="mt-1 text-xs font-semibold text-[#6B7488]">{displayLabel(state)}</p></div>) : <p className="col-span-2 rounded-xl bg-[#FBFAF9] p-4 text-sm text-[#6B7488]">No delivery attempts are recorded.</p>}</div>
        <div className="mt-4 rounded-xl border border-[#E7E1F7] bg-[#FCFAFF] p-4 text-xs leading-5 text-[#5B5670]"><strong className="text-[#352A52]">Recorded channel:</strong> {latestPublication?.delivery_channels?.length ? latestPublication.delivery_channels.map(displayLabel).join(", ") : "No channel evidence"}. “Available” means an in-app notification record was created; it does not mean the user opened it.</div>
      </div>
    </section>

    <section className="rounded-2xl border border-[#E6E9F0] bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold"><FileCheck2 className="h-5 w-5 text-[#6D28D9]" /> Evidence completeness</h2>
      <p className="mt-1 text-xs text-[#6B7488]">“Not collected” is different from evidence that an event did not occur.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(checks).map(([name, state]) => <div key={name} className="rounded-xl border border-[#EEF1F5] p-3"><p className="text-xs font-semibold text-[#6B7488]">{displayLabel(name)}</p><p className={`mt-1 text-sm font-bold ${state === "PRESENT" ? "text-[#286044]" : state === "MISSING" || state === "INCOMPLETE" ? "text-[#9A4E31]" : "text-[#5B21B6]"}`}>{displayLabel(state)}</p></div>)}</div>
      {evidence?.authorization ? <div className="mt-4 rounded-xl border border-[#E7D9CF] bg-[#FFF9F5] p-4 text-sm text-[#704C3B]"><strong>Authorization evidence: {displayLabel(evidence.authorization.status)}</strong><p className="mt-1 text-xs leading-5">{evidence.authorization.explanation}</p></div> : null}
    </section>

    <section className="rounded-2xl border border-[#E6E9F0] bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Clock3 className="h-5 w-5 text-[#6D28D9]" /> Tamper-evident event timeline</h2>
      <p className="mt-1 text-xs text-[#6B7488]">Events are read from the tenant audit chain. A recorded hash is shown as evidence of chain participation; this page does not independently re-verify the full tenant chain.</p>
      {auditEvents.length ? <ol className="mt-4 space-y-3">{auditEvents.map((event, index) => <li key={String(event.record_id || index)} className="rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-[#0E1726]">{displayLabel(event.action)}</p><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#5B21B6]">{displayLabel(event.outcome)}</span></div><p className="mt-1 text-xs text-[#6B7488]">{formatAlertDate(String(event.timestamp || ""))} · {String(event.actor_display || event.actor_id || "System")}</p><p className="mt-2 text-xs text-[#6B7488]">Correlation: <span className="font-mono">{String(event.correlation_id || "Unavailable")}</span></p><p className="mt-1 text-xs text-[#6B7488]">Integrity hash: <span className="font-mono">{event.integrity_hash ? `${String(event.integrity_hash).slice(0, 16)}…` : "Not recorded"}</span></p></li>)}</ol> : <p className="mt-4 rounded-xl bg-[#FBFAF9] p-4 text-sm text-[#6B7488]">No matching alert lifecycle events were found in the audit chain.</p>}
    </section>
  </div>;
}

function HistoryEntry({ publication, latest }: { publication: Publication; latest: boolean }) {
  const content = publication.content || {};
  const publicationType = String(publication.type || "UPDATE").toUpperCase();
  const phase = content.public_status
    ? formatPublicStatus(content.public_status)
    : publicationType === "RECOVERY" ? "Recovered" : "Status not recorded";

  return (
    <li className="rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{phase}</p>
          <span className="text-xs text-[#6B7488]">{publicationType.toLowerCase().replaceAll("_", " ")}</span>
        </div>
        {latest ? <span className="rounded-full bg-[#F1ECFE] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#5B21B6]">Latest</span> : null}
      </div>
      <p className="mt-1 text-xs text-[#6B7488]">Published {formatAlertDate(publication.published_at)}</p>
      {publication.publisher_display || publication.publisher_id ? <p className="mt-1 text-xs text-[#6B7488]">Publisher: {publication.publisher_display || publication.publisher_id}</p> : null}
      {typeof publication.recipient_count === "number" ? <p className="mt-1 text-xs text-[#6B7488]">Resolved recipients: {publication.recipient_count}</p> : null}
      {publicationType === "RECOVERY" ? <p className="mt-1 text-xs font-semibold text-[#2F6B4F]">Recovered {formatAlertDate(String(content.recovered_at || publication.published_at || ""))}</p> : null}
      <HistoryField label="Update" value={content.public_summary} />
      <HistoryField label="Impact" value={content.impact_summary} />
      <HistoryField label="What to do" value={content.recommended_action} />
      <HistoryField label="Expected next update" value={content.next_update_at ? formatAlertDate(String(content.next_update_at)) : null} />
    </li>
  );
}

function HistoryField({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return <p className="mt-2 text-sm text-[#475069]"><span className="font-semibold text-[#0E1726]">{label}:</span> {String(value)}</p>;
}

function Field({ label, value, wide = false }: { label: string; value: unknown; wide?: boolean }) {
  return <div className={wide ? "sm:col-span-2" : ""}><p className="text-xs font-semibold uppercase tracking-wide text-[#8A93A5]">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm font-medium">{String(value || "Not provided")}</p></div>;
}

function DeliveryOperatorDiagnostics({ alert }: { alert: AlertDetail }) {
  const health = alert.delivery_health;
  const deliverySummary = health?.summary || {};
  const totalDelivered = deliverySummary.AVAILABLE || 0;
  const totalRetrying = deliverySummary.RETRYING || 0;
  const totalFailed = (deliverySummary.FAILED || 0) + (deliverySummary.PERMANENTLY_FAILED || 0);
  const status = totalFailed > 0 ? "FAILED" : totalRetrying > 0 ? "RETRYING" : (health?.total_recipients || 0) > 0 ? "HEALTHY" : "IDLE";
  const lastError = health?.recent_errors?.[0]?.error;
  const channels = health?.channels || [];
  const statusColor =
    status === "HEALTHY"
      ? "text-[#166534] bg-[#F0FDF4] border-[#BBF7D0]"
      : status === "RETRYING"
      ? "text-[#854D0E] bg-[#FEFCE8] border-[#FEF08A]"
      : status === "FAILED"
      ? "text-[#991B1B] bg-[#FEF2F2] border-[#FECACA]"
      : "text-[#6B7488] bg-[#F8F9FA] border-[#E6E9F0]";

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[#DDD6FE] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-[#0E1726]">
              <Radio className="h-5 w-5 text-[#6D28D9]" /> Broadcasting delivery diagnostics
            </h2>
            <p className="mt-1 text-xs text-[#6B7488]">
              Technical delivery metrics and channel states for Platform Administrators. Business content and recipient PII are excluded under Segregation of Duties.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusColor}`}>
            Delivery: {status}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] p-3 text-center">
            <p className="text-2xl font-bold text-[#0E1726]">{health?.total_recipients ?? 0}</p>
            <p className="mt-1 text-xs font-semibold text-[#6B7488]">Dispatched recipients</p>
          </div>
          <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-center">
            <p className="text-2xl font-bold text-[#166534]">{totalDelivered}</p>
            <p className="mt-1 text-xs font-semibold text-[#166534]">Delivered</p>
          </div>
          <div className="rounded-xl border border-[#FEF08A] bg-[#FEFCE8] p-3 text-center">
            <p className="text-2xl font-bold text-[#854D0E]">{totalRetrying}</p>
            <p className="mt-1 text-xs font-semibold text-[#854D0E]">Retrying in queue</p>
          </div>
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-center">
            <p className="text-2xl font-bold text-[#991B1B]">{totalFailed}</p>
            <p className="mt-1 text-xs font-semibold text-[#991B1B]">Failed / Dead-letter</p>
          </div>
        </div>

        {lastError ? (
          <div className="mt-5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#991B1B]">
            <p className="font-semibold">Last recorded transmission error:</p>
            <p className="mt-1 font-mono">{lastError}</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[#E6E9F0] bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-[#0E1726]">Notification transport channels</h3>
        <p className="mt-1 text-xs text-[#6B7488]">Delivery performance across enabled notification backends.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {channels.length ? (
            channels.map((chan) => (
              <div key={chan.channel} className="rounded-xl border border-[#EEF1F5] bg-[#FBFAF9] p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm text-[#0E1726]">{chan.channel.replaceAll("_", " ")}</p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      chan.status === "ACTIVE"
                        ? "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]"
                        : "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]"
                    }`}
                  >
                    {chan.status}
                  </span>
                </div>
                {chan.name ? <p className="mt-3 text-xs text-[#6B7488]">{chan.name}</p> : null}
              </div>
            ))
          ) : (
            <p className="col-span-2 text-sm text-[#6B7488]">No channel telemetry recorded for this alert.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[#DDD6FE] bg-[#F8F5FF] p-4 text-xs text-[#5B21B6]">
        <p className="font-bold uppercase tracking-wider">Operational Segregation of Duties (SoD)</p>
        <p className="mt-1 text-[#4C1D95]">
          Platform Administrators monitor broadcasting reliability, channel health, and retry pipelines. Drafting, editing, and publishing business outage notices is reserved exclusively for Incident Commanders and Incident Managers.
        </p>
      </section>
    </div>
  );
}
