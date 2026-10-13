"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BellRing, Plus, RefreshCw } from "lucide-react";
import { alertApi, type AlertSummary, formatAlertDate, formatPublicStatus } from "@/lib/outage-alerts";

const tabs = [
  { label: "Active Alerts", status: "ACTIVE" },
  { label: "Draft Alerts", status: "DRAFT" },
  { label: "Recovered", status: "RECOVERED" },
] as const;

export default function OutageAlertsPage() {
  const [alerts, setAlerts] = useState<AlertSummary[]>([]);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["status"]>("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAlerts(await alertApi<AlertSummary[]>(""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const request = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(request); }, [load]);
  const visible = useMemo(() => alerts.filter((alert) => alert.status === activeTab), [alerts, activeTab]);

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[#6D28D9]"><BellRing className="h-4 w-4" /> Incident operations</p>
          <h1 className="text-3xl font-bold tracking-tight text-[#0E1726]">Outage &amp; Alerts</h1>
          <p className="mt-1 text-sm text-[#475069]">Publish one controlled message, target authorized audiences, and preserve its complete history.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-[#DDD6FE] bg-white px-4 py-2.5 text-sm font-semibold text-[#5B21B6] shadow-sm hover:bg-[#F8F5FF] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/30"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          <Link href="/itsm/incident-manager/outage-alerts/create" className="inline-flex items-center gap-2 rounded-xl bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#5B21B6] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/40"><Plus className="h-4 w-4" /> Create alert</Link>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#E6E9F0] bg-white shadow-[0_12px_30px_-24px_rgba(14,23,38,.35)]">
        <div className="flex overflow-x-auto border-b border-[#E6E9F0] px-3 pt-3" role="tablist" aria-label="Alert lifecycle">
          {tabs.map((tab) => {
            const count = alerts.filter((alert) => alert.status === tab.status).length;
            const selected = tab.status === activeTab;
            return <button key={tab.status} type="button" role="tab" aria-selected={selected} onClick={() => setActiveTab(tab.status)} className={`whitespace-nowrap rounded-t-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#6D28D9]/30 ${selected ? "border-b-2 border-[#6D28D9] bg-[#F8F5FF] text-[#5B21B6]" : "text-[#6B7488] hover:bg-[#FBFAF9] hover:text-[#0E1726]"}`}>{tab.label} <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs">{count}</span></button>;
          })}
        </div>

        {error ? <div className="m-6 flex items-start gap-3 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] p-4"><AlertTriangle className="mt-0.5 h-5 w-5 text-[#8A5A2B]" /><div><p className="font-semibold">Alerts could not be loaded</p><p className="text-sm text-[#475069]">{error}</p></div></div> : null}
        {loading ? <div className="grid gap-3 p-6 md:grid-cols-2 xl:grid-cols-3">{[0,1,2].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-[#F3F4F7]" />)}</div> : null}
        {!loading && !error && visible.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F1ECFE] text-[#6D28D9]"><BellRing className="h-6 w-6" /></span>
            <h2 className="text-lg font-semibold">No {activeTab.toLowerCase()} alerts</h2>
            <p className="mt-1 max-w-md text-sm text-[#6B7488]">{activeTab === "DRAFT" ? "Create a private draft, verify the recipient preview, then publish when ready." : "Alerts appear here when they reach this lifecycle state."}</p>
          </div>
        ) : null}
        {!loading && visible.length > 0 ? <div className="divide-y divide-[#EEF1F5]">
          {visible.map((alert) => <article key={alert.id} className="grid gap-4 p-5 transition hover:bg-[#FBFAF9] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#6B7488]"><span className="rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-2.5 py-1 text-[#5B21B6]">{alert.status}</span><span>{formatPublicStatus(alert.public_status)}</span><span>{alert.alert_number}</span><span>·</span><span>{alert.severity}</span></div>
              <h2 className="truncate text-lg font-semibold text-[#0E1726]">{alert.title}</h2>
              <p className="mt-1 truncate text-sm text-[#475069]">{alert.affected_services.map((service) => service.name).join(", ") || "No service scope"}</p>
              <p className="mt-2 text-xs text-[#8A93A5]">Last public update {formatAlertDate(alert.latest_publication_at)}</p>
            </div>
            <Link href={`/itsm/incident-manager/outage-alerts/${alert.id}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#DDD6FE] bg-white px-4 py-2.5 text-sm font-semibold text-[#5B21B6] hover:bg-[#F8F5FF] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/30">View alert <ArrowRight className="h-4 w-4" /></Link>
          </article>)}
        </div> : null}
      </section>
    </div>
  );
}
