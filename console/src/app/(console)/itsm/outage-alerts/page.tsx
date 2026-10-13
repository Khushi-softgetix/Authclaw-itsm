"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BellRing, CheckCircle2, ChevronRight, RefreshCw } from "lucide-react";
import { alertApi, type AlertSummary, formatAlertDate, formatPublicStatus } from "@/lib/outage-alerts";

type View = "ACTIVE" | "RECOVERED";

export default function ServiceAlertsPage() {
  const [alerts, setAlerts] = useState<AlertSummary[]>([]);
  const [view, setView] = useState<View>("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [active, recovered] = await Promise.all([
        alertApi<AlertSummary[]>("?status=ACTIVE"),
        alertApi<AlertSummary[]>("?status=RECOVERED"),
      ]);
      setAlerts([...active, ...recovered]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Service alerts are unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  const visible = useMemo(() => alerts.filter((alert) => alert.status === view), [alerts, view]);
  const counts = useMemo(() => ({
    ACTIVE: alerts.filter((alert) => alert.status === "ACTIVE").length,
    RECOVERED: alerts.filter((alert) => alert.status === "RECOVERED").length,
  }), [alerts]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#6D28D9]">Service status</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Outage and service alerts</h1>
          <p className="mt-2 text-sm text-[#6B7488]">Updates for services you are authorized to use or support.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E6E9F0] bg-white px-4 py-2.5 text-sm font-semibold text-[#475069]">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      <div role="tablist" aria-label="Service alert history" className="flex gap-2 border-b border-[#E6E9F0]">
        {(["ACTIVE", "RECOVERED"] as View[]).map((status) => (
          <button key={status} type="button" role="tab" aria-selected={view === status} onClick={() => setView(status)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${view === status ? "border-[#6D28D9] text-[#5B21B6]" : "border-transparent text-[#6B7488]"}`}>
            {status === "ACTIVE" ? "Active alerts" : "Recovered"} <span className="ml-1 rounded-full bg-[#F1ECFE] px-2 py-0.5 text-xs">{counts[status]}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-[#E7D9CF] bg-[#FFF9F5] p-6 text-center text-[#704C3B]">
          <AlertTriangle className="mx-auto h-6 w-6" />
          <p className="mt-2 font-semibold">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 text-sm font-semibold text-[#5B21B6]">Try again</button>
        </div>
      ) : null}

      {loading ? <div className="h-40 animate-pulse rounded-2xl bg-white" /> : null}

      {!loading && !error && visible.length ? (
        <ul className="overflow-hidden rounded-2xl border border-[#E6E9F0] bg-white divide-y divide-[#EEF1F5]">
          {visible.map((alert) => (
            <li key={alert.id}>
              <Link href={`/itsm/outage-alerts/${alert.id}`} className="flex items-center justify-between gap-4 p-5 transition hover:bg-[#FCFAFF]">
                <div className="flex min-w-0 gap-4">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${alert.status === "RECOVERED" ? "bg-[#EDF7F1] text-[#2F6B4F]" : "bg-[#F1ECFE] text-[#6D28D9]"}`}>
                    {alert.status === "RECOVERED" ? <CheckCircle2 className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#6B7488]">
                      <span>{formatPublicStatus(alert.public_status)}</span><span aria-hidden="true">·</span><span>{alert.alert_number}</span>
                    </div>
                    <p className="mt-1 truncate font-semibold text-[#0E1726]">{alert.title || "Service alert"}</p>
                    <p className="mt-1 truncate text-xs text-[#6B7488]">{alert.affected_services.map((service) => service.name).join(", ") || "Service scope unavailable"} · Updated {formatAlertDate(alert.latest_publication_at)}</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-[#8B5CF6]" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && !error && !visible.length ? (
        <div className="rounded-2xl border border-[#E6E9F0] bg-white p-10 text-center">
          {view === "ACTIVE" ? <BellRing className="mx-auto h-7 w-7 text-[#8B5CF6]" /> : <CheckCircle2 className="mx-auto h-7 w-7 text-[#2F6B4F]" />}
          <p className="mt-3 font-semibold">{view === "ACTIVE" ? "No active service alerts" : "No recovered alerts available"}</p>
          <p className="mt-1 text-sm text-[#6B7488]">Only alerts matching your current service access and audience are shown.</p>
        </div>
      ) : null}
    </div>
  );
}
