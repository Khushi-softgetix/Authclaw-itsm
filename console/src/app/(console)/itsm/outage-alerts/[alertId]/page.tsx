"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, BellRing, CheckCircle2, Clock3, ExternalLink, GitPullRequest, Headphones, ShieldCheck } from "lucide-react";
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
  const backHref = alert.projection_type === "AUDITOR" ? "/itsm/dashboard/auditor/outage-alerts" : "/itsm/outage-alerts";

  const incidentLinks = getAlertIncidentLinks(alert.links);
  const primaryIncidentLink = getPrimaryIncidentLink(alert.links);
  const canOpenLinkedIncident = canOpenAlertIncident(alert);
  const processLinks = getAlertProcessLinks(alert.links);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-[#5B21B6]">
        <ArrowLeft className="h-4 w-4" />
        {alert.projection_type === "AUDITOR" ? "Back to outage evidence" : "Back to service alerts"}
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
        <section className="rounded-2xl border border-[#DDD6FE] bg-white p-6">
          <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-[#6D28D9]" /> Auditor evidence</h2>
          <p className="mt-1 text-xs text-[#6B7488]">Read-only operational and delivery evidence for this canonical alert.</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Severity" value={content.severity} />
            <Field label="Intent" value={content.intent} />
            <Field label="Created" value={content.created_at ? formatAlertDate(String(content.created_at)) : "Not recorded"} />
            <Field label="Created by" value={content.created_by_id} />
            <Field label="Internal operational notes" value={content.internal_notes || "None recorded"} wide />
            <Field label="Related records" value={alert.links.map((link) => `${link.type}: ${link.id}`).join("\n") || "None linked"} wide />
            <Field label="Delivery results" value={alert.delivery_summary ? Object.entries(alert.delivery_summary).map(([state, count]) => `${state}: ${count}`).join("\n") : "No delivery evidence"} wide />
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[#E6E9F0] bg-white p-6">
        <h2 className="flex items-center gap-2 font-semibold"><Clock3 className="h-5 w-5 text-[#6D28D9]" /> Communication history</h2>
        {publications.length ? (
          <ol className="mt-4 space-y-3">
            {publications.map((publication, index) => <HistoryEntry key={publication.id || publication.version || index} publication={publication} latest={index === 0} />)}
          </ol>
        ) : <p className="mt-4 rounded-xl bg-[#FBFAF9] p-4 text-sm text-[#6B7488]">No public communication has been published.</p>}
      </section>

      <p className="flex items-center gap-2 text-xs text-[#6B7488]"><ShieldCheck className="h-4 w-4" /> This view contains only information authorized for your role and service relationship.</p>
    </div>
  );
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
