"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BellRing, ArrowLeft } from "lucide-react";
import { AlertDetail, Notice } from "@/components/itsm/alert-detail-ui";
import { apiErrorMessage } from "@/lib/errors";
import type { OutageAlert } from "@/lib/outage-alert-types";

export default function OutageAlertDetailPage() {
  const params = useParams();
  const router = useRouter();
  const alertId = params.id as string;
  const [alert, setAlert] = useState<OutageAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAlert() {
      try {
        const [meResponse, alertResponse] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store" }).catch(() => null),
          fetch(`/api/itsm/alerts/${alertId}`)
        ]);

        const me = meResponse?.ok ? await meResponse.json() : null;
        const role = me?.itsm_role;

        if (role === "INCIDENT_MANAGER" || role === "AUDITOR") {
          router.replace(`/itsm/outage-alerts?alert=${alertId}`);
          return;
        }

        const body = await alertResponse.json().catch(() => ({}));
        if (!alertResponse.ok) throw new Error(apiErrorMessage(body, "Unable to load alert details"));
        setAlert(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load alert details");
      } finally {
        setLoading(false);
      }
    }
    loadAlert();
  }, [alertId, router]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <button 
            type="button" 
            onClick={() => router.back()} 
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#6B7488] transition hover:text-[#0E1726]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#6D28D9]">
            <BellRing className="h-3.5 w-3.5" /> Outage Alert
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#0E1726]">Alert Details</h1>
        </div>
      </header>

      {error ? <Notice tone="error" message={error} /> : null}

      <div className="rounded-[20px] border border-[#E6E9F0] bg-white p-5 sm:p-8 shadow-[0_1px_2px_rgba(11,31,63,.05)]">
        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-6 w-1/3 bg-[#EEF1F5] rounded"></div>
            <div className="h-24 bg-[#EEF1F5] rounded"></div>
            <div className="h-24 bg-[#EEF1F5] rounded"></div>
          </div>
        ) : alert ? (
          <AlertDetail alert={alert} canMutate={false} />
        ) : (
          !error && <div className="text-center py-10 text-sm text-[#6B7488]">Alert not found.</div>
        )}
      </div>
    </div>
  );
}
