"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, LoaderCircle, Search, Trash2, X } from "lucide-react";
import {
  alertApi,
  type AlertReferenceOption,
  type AlertReferenceOptionPage,
} from "@/lib/outage-alerts";

type AlertLink = { type: string; id: string };

export default function AlertLinkManager({
  alertId,
  serviceIds,
  links,
  canManage,
  status,
  onChanged,
}: {
  alertId: string;
  serviceIds: string[];
  links: AlertLink[];
  canManage: boolean;
  status: string;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [recordType, setRecordType] = useState("");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AlertReferenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const linkedKeys = useMemo(
    () => new Set(links.map((link) => `${link.type}:${link.id}`)),
    [links],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const request = window.setTimeout(async () => {
      const params = new URLSearchParams({ kind: "RELATED_RECORD", limit: "20" });
      if (query.trim()) params.set("search", query.trim());
      if (recordType) params.set("record_type", recordType);
      serviceIds.forEach((id) => params.append("service_ids", id));
      setLoading(true);
      setError("");
      try {
        const page = await alertApi<AlertReferenceOptionPage>(
          `/reference-options?${params.toString()}`,
          { signal: controller.signal },
        );
        setOptions(page.items);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Related records could not be loaded");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(request);
    };
  }, [open, query, recordType, serviceIds]);

  async function addLink(option: AlertReferenceOption) {
    const [targetType, targetId] = option.value.split(":", 2);
    if (!targetType || !targetId) return;
    setBusyKey(option.value);
    setError("");
    try {
      await alertApi(`/${alertId}/links`, {
        method: "POST",
        body: JSON.stringify({ target_type: targetType, target_id: targetId }),
      });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Record could not be linked");
    } finally {
      setBusyKey("");
    }
  }

  async function removeLink(link: AlertLink) {
    if (status === "ACTIVE" && !window.confirm(
      "Remove this relationship? Existing publications remain unchanged, but recipient eligibility for future updates may change.",
    )) return;
    const key = `${link.type}:${link.id}`;
    setBusyKey(key);
    setError("");
    try {
      await alertApi(
        `/${alertId}/links/${encodeURIComponent(link.type)}/${encodeURIComponent(link.id)}`,
        { method: "DELETE" },
      );
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Record could not be unlinked");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <section className="rounded-2xl border border-[#E6E9F0] bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Link2 className="h-5 w-5 text-[#6D28D9]" /> Operational links</h2>
          <p className="mt-1 text-xs leading-5 text-[#667085]">Optional relationships. The Alert remains independent from linked work.</p>
        </div>
        {canManage ? <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-lg border border-[#DDD6FE] bg-white px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#F8F5FF]">{open ? "Close" : "Add link"}</button> : null}
      </div>

      {links.length ? <ul className="mt-4 space-y-2">{links.map((link) => {
        const key = `${link.type}:${link.id}`;
        return <li key={key} className="flex items-center justify-between gap-3 rounded-xl bg-[#FBFAF9] px-3 py-2.5 text-sm"><div className="min-w-0"><span className="font-semibold">{label(link.type)}</span><span className="mt-1 block truncate text-xs text-[#8A93A5]">{link.id}</span></div>{canManage ? <button type="button" disabled={Boolean(busyKey)} onClick={() => void removeLink(link)} className="rounded-lg p-2 text-[#7B405C] hover:bg-[#FFF1F3] disabled:opacity-40" aria-label={`Unlink ${label(link.type)}`}>{busyKey === key ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button> : null}</li>;
      })}</ul> : <p className="mt-3 text-sm text-[#6B7488]">This alert has no linked operational record.</p>}

      {open ? <div className="mt-4 rounded-xl border border-[#DDD6FE] bg-[#FAF8FF] p-3">
        <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-[#475069]">Find an authorized record for the affected services</p><button type="button" onClick={() => setOpen(false)} className="p-1 text-[#667085]" aria-label="Close record search"><X className="h-4 w-4" /></button></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
          <select value={recordType} onChange={(event) => setRecordType(event.target.value)} className="rounded-lg border border-[#D9DEE8] bg-white px-3 py-2 text-sm outline-none focus:border-[#8B5CF6]"><option value="">All types</option><option value="INCIDENT">Incident</option><option value="MAJOR_INCIDENT">Major incident</option><option value="PROBLEM">Problem</option><option value="CHANGE">Change</option></select>
          <label className="relative"><span className="sr-only">Search related records</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93A5]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search number or title" className="w-full rounded-lg border border-[#D9DEE8] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#8B5CF6]" /></label>
        </div>
        {error ? <p role="alert" className="mt-3 rounded-lg bg-[#FFF1F3] px-3 py-2 text-xs text-[#8A2942]">{error}</p> : null}
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {loading ? <p className="py-4 text-center text-xs text-[#667085]">Loading authorized records...</p> : options.length ? options.map((option) => {
            const linked = linkedKeys.has(option.value);
            return <div key={option.value} className="flex items-center justify-between gap-3 rounded-lg border border-[#E6E9F0] bg-white px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#172033]">{option.label}</p><p className="text-xs text-[#667085]">{label(option.meta)}</p></div><button type="button" disabled={linked || Boolean(busyKey)} onClick={() => void addLink(option)} className="rounded-lg bg-[#6D28D9] px-3 py-1.5 text-xs font-semibold text-white disabled:bg-[#E6E9F0] disabled:text-[#8A93A5]">{linked ? "Linked" : busyKey === option.value ? "Linking..." : "Link"}</button></div>;
          }) : <p className="py-4 text-center text-xs text-[#667085]">No authorized records match this service scope.</p>}
        </div>
        {status === "ACTIVE" ? <p className="mt-3 text-[11px] leading-4 text-[#667085]">Changes are audited and apply to future previews and publications. Existing publication snapshots are never rewritten.</p> : null}
      </div> : null}
    </section>
  );
}

function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
