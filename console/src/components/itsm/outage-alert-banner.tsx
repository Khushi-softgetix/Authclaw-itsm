"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, ChevronRight } from "lucide-react";
import { alertApi, type AlertSummary, formatAlertDate, formatPublicStatus } from "@/lib/outage-alerts";

export default function OutageAlertBanner({ itsmRole }: { itsmRole?: string | null }) {
  const [alerts, setAlerts] = useState<AlertSummary[]>([]);
  const normalizedRole = String(itsmRole || "").toUpperCase();
  const receivesBusinessAlerts = [
    "REQUESTER",
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "SERVICE_LEAD",
    "PROCESS_CHANGE_MANAGER",
    "PROBLEM_CHANGE_MANAGER",
    "CATALOG_MANAGER",
  ].includes(normalizedRole);

  useEffect(() => {
    if (!receivesBusinessAlerts) {
      return;
    }
    let mounted = true;
    const load = () => {
      alertApi<AlertSummary[]>("/active")
        .then((items) => {
          if (mounted) setAlerts(items);
        })
        .catch(() => {
          if (mounted) setAlerts([]);
        });
    };
    load();
    const refresh = window.setInterval(load, 45_000);
    return () => {
      mounted = false;
      window.clearInterval(refresh);
    };
  }, [receivesBusinessAlerts]);

  if (!receivesBusinessAlerts || !alerts.length) return null;
  const primary = alerts[0];

  return (
    <aside aria-label="Active service alerts" className="mb-5 rounded-2xl border border-[#DDD6FE] bg-[#F8F5FF] p-4 text-[#0E1726] shadow-[0_8px_24px_-22px_rgba(91,33,182,.65)]">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#6D28D9]"><BellRing className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#6D28D9]">Active service alert{alerts.length > 1 ? `s \u00B7 ${alerts.length}` : ""}</p>
            <p className="mt-1 truncate font-semibold">{primary.title}</p>
            <p className="mt-0.5 text-xs text-[#6B7488]">
              {formatPublicStatus(primary.public_status)} {"\u00B7"} {primary.affected_services.map((service) => service.name).join(", ")} {"\u00B7"} Updated {formatAlertDate(primary.latest_publication_at)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link href="/itsm/outage-alerts" className="text-sm font-semibold text-[#5B21B6] hover:text-[#6D28D9]">View all</Link>
          <Link href={`/itsm/outage-alerts/${primary.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#5B21B6] hover:text-[#6D28D9]">View status <ChevronRight className="h-4 w-4" /></Link>
        </div>
      </div>
    </aside>
  );
}
