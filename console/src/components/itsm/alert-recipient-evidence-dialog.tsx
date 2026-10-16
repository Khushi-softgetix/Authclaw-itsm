"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Search, UsersRound, X } from "lucide-react";
import {
  alertApi,
  formatAlertDate,
  type AlertRecipientEvidencePage,
} from "@/lib/outage-alerts";

const PAGE_SIZE = 25;

type RecipientDialogProps = {
  alertId: string;
  publicationId?: string;
  audienceType?: string;
  projectionType?: string;
  title: string;
  onClose: () => void;
};

export default function AlertRecipientEvidenceDialog({
  alertId,
  publicationId,
  audienceType: initialAudience,
  projectionType: initialProjection,
  title,
  onClose,
}: RecipientDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState<AlertRecipientEvidencePage | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [audienceType, setAudienceType] = useState(initialAudience || "");
  const [projectionType, setProjectionType] = useState(initialProjection || "");
  const [deliveryStatus, setDeliveryStatus] = useState("");
  const [acknowledgement, setAcknowledgement] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
    if (publicationId) query.set("publication_id", publicationId);
    if (search) query.set("search", search);
    if (audienceType) query.set("audience_type", audienceType);
    if (projectionType) query.set("projection_type", projectionType);
    if (publicationId && deliveryStatus) query.set("delivery_status", deliveryStatus);
    if (publicationId && acknowledgement) query.set("acknowledgement", acknowledgement);
    try {
      setPage(await alertApi<AlertRecipientEvidencePage>(`/${alertId}/recipients?${query}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recipient evidence is unavailable");
    } finally {
      setLoading(false);
    }
  }, [acknowledgement, alertId, audienceType, deliveryStatus, offset, projectionType, publicationId, search]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  function clearAudienceScope() {
    setAudienceType("");
    setProjectionType("");
    setOffset(0);
  }

  const firstResult = page && page.total > 0 ? page.offset + 1 : 0;
  const lastResult = page ? Math.min(page.offset + page.items.length, page.total) : 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#0E1726]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="recipient-evidence-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-[#E6E9F0] bg-white shadow-2xl sm:max-h-[88vh] sm:rounded-3xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#E6E9F0] px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[#6D28D9]"><UsersRound className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-[.12em]">Recipient evidence</span></div>
            <h2 id="recipient-evidence-title" className="mt-2 truncate text-xl font-bold text-[#172033]">{title}</h2>
            <p className="mt-1 text-sm text-[#667085]">{publicationId ? "The immutable list targeted for this publication." : "The current people the authoritative resolver would target."}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="rounded-xl border border-[#E6E9F0] p-2 text-[#475069] transition hover:bg-[#F8F5FF] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/30" aria-label="Close recipient evidence"><X className="h-5 w-5" /></button>
        </header>

        <div className="border-b border-[#E6E9F0] bg-[#FBFAFF] px-5 py-4 sm:px-7">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <form onSubmit={applySearch} className="flex min-w-0 flex-1 gap-2">
              <label className="min-w-0 flex-1"><span className="sr-only">Search recipients</span><span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93A5]" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search by recipient email" className="w-full rounded-xl border border-[#D9DEE8] bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/10" /></span></label>
              <button type="submit" className="rounded-xl bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#5B21B6]">Search</button>
            </form>
            {publicationId ? <div className="grid grid-cols-2 gap-2 sm:flex">
              <FilterSelect label="Delivery" value={deliveryStatus} onChange={(value) => { setDeliveryStatus(value); setOffset(0); }} options={["AVAILABLE", "QUEUED", "RETRYING", "FAILED", "PERMANENTLY_FAILED"]} />
              <FilterSelect label="Acknowledgement" value={acknowledgement} onChange={(value) => { setAcknowledgement(value); setOffset(0); }} options={["ACKNOWLEDGED", "PENDING"]} />
            </div> : null}
          </div>
          {audienceType || projectionType ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-[#667085]">Focused on</span>{audienceType ? <ScopePill value={audienceType} /> : null}{projectionType ? <ScopePill value={`${projectionType} view`} /> : null}<button type="button" onClick={clearAudienceScope} className="font-semibold text-[#6D28D9] hover:underline">View all recipients</button></div> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {loading ? <LoadingRows /> : error ? <div role="alert" className="rounded-2xl border border-[#E7D9CF] bg-[#FFF9F5] p-6 text-center"><p className="font-semibold text-[#704C3B]">{error}</p><button type="button" onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#D7BBAA] bg-white px-4 py-2 text-sm font-semibold text-[#704C3B]"><RefreshCw className="h-4 w-4" /> Retry</button></div> : page && page.items.length ? <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[#172033]">{page.total.toLocaleString()} matching recipient{page.total === 1 ? "" : "s"}</p><p className="text-xs text-[#667085]">{page.source === "LIVE_PREVIEW" ? "Live eligibility" : `Published version ${page.publication_version}`}</p></div>
            {page.items.map((recipient) => <article key={recipient.user_id} className="rounded-2xl border border-[#E6E9F0] bg-white p-4 transition hover:border-[#D6C9FD] sm:p-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(180px,.85fr)_minmax(250px,1.35fr)_minmax(170px,.7fr)] lg:items-start">
                <div className="min-w-0"><p className="break-all text-sm font-semibold text-[#172033]">{recipient.email}</p><div className="mt-2 flex flex-wrap gap-1.5"><ScopePill value={recipient.role} /><ScopePill value={`${recipient.projection_type} view`} /></div></div>
                <div><p className="text-[11px] font-bold uppercase tracking-wide text-[#8A93A5]">Why included</p><ul className="mt-1.5 space-y-1 text-sm text-[#344054]">{recipient.audience_memberships.map((membership, index) => <li key={`${membership.audience_type}-${index}`}><span className="font-semibold">{label(membership.audience_type)}:</span> {membership.reason}</li>)}</ul></div>
                <RecipientState recipient={recipient} published={Boolean(publicationId)} />
              </div>
              <details className="mt-4 border-t border-[#EEF1F5] pt-3"><summary className="cursor-pointer text-xs font-semibold text-[#5B21B6] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20">Authorized information and actions</summary><div className="mt-3 grid gap-3 text-xs text-[#475069] sm:grid-cols-2"><p><strong className="text-[#172033]">Can see:</strong> {recipient.projection_fields.map(label).join(", ") || "No projected fields"}</p><p><strong className="text-[#172033]">Can do:</strong> {recipient.allowed_actions.map(label).join(", ") || "View only"}</p></div></details>
            </article>)}
          </div> : <div className="rounded-2xl border border-dashed border-[#D9DEE8] bg-[#FBFAF9] px-6 py-12 text-center"><UsersRound className="mx-auto h-8 w-8 text-[#8B5CF6]" /><h3 className="mt-3 font-semibold text-[#172033]">No matching recipients</h3><p className="mt-1 text-sm text-[#667085]">Adjust the search or filters. Audience-level exclusion reasons remain visible in the main preview.</p></div>}
        </div>

        <footer className="flex flex-col gap-3 border-t border-[#E6E9F0] bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <p className="text-xs text-[#667085]">Showing {firstResult.toLocaleString()} - {lastResult.toLocaleString()} of {(page?.total || 0).toLocaleString()}</p>
          <div className="flex gap-2"><button type="button" disabled={!page || page.offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} className="inline-flex items-center gap-1 rounded-xl border border-[#D9DEE8] px-3 py-2 text-sm font-semibold text-[#344054] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button><button type="button" disabled={!page?.has_more || loading} onClick={() => setOffset((value) => value + PAGE_SIZE)} className="inline-flex items-center gap-1 rounded-xl border border-[#D9DEE8] px-3 py-2 text-sm font-semibold text-[#344054] disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button></div>
        </footer>
      </section>
    </div>
  );
}

function FilterSelect({ label: filterLabel, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="text-xs font-semibold text-[#475069]"><span className="sr-only">{filterLabel}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-[#D9DEE8] bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/10"><option value="">All {filterLabel.toLowerCase()}</option>{options.map((option) => <option key={option} value={option}>{label(option)}</option>)}</select></label>;
}

function ScopePill({ value }: { value: string }) {
  return <span className="rounded-full border border-[#DDD6FE] bg-[#F8F5FF] px-2.5 py-1 text-[11px] font-semibold text-[#5B21B6]">{label(value)}</span>;
}

function RecipientState({ recipient, published }: { recipient: AlertRecipientEvidencePage["items"][number]; published: boolean }) {
  if (!published) return <div className="rounded-xl bg-[#F8F5FF] px-3 py-3 text-xs text-[#5B21B6]"><p className="font-semibold">Eligible in current preview</p><p className="mt-1 text-[#667085]">Delivery begins only after publication.</p></div>;
  return <div><p className="text-[11px] font-bold uppercase tracking-wide text-[#8A93A5]">Delivery and response</p><div className="mt-1.5 flex flex-wrap gap-1.5"><span className="rounded-full bg-[#EDF7F1] px-2.5 py-1 text-[11px] font-semibold text-[#2F6B4F]">{label(recipient.delivery_status || "Unknown")}</span>{recipient.acknowledged_at ? <span className="inline-flex items-center gap-1 rounded-full bg-[#F1ECFE] px-2.5 py-1 text-[11px] font-semibold text-[#5B21B6]"><CheckCircle2 className="h-3 w-3" /> Acknowledged</span> : <span className="rounded-full bg-[#F6F7F9] px-2.5 py-1 text-[11px] font-semibold text-[#667085]">Not acknowledged</span>}</div><p className="mt-2 text-xs text-[#667085]">Channels: {recipient.channels.map(label).join(", ") || "None recorded"}</p>{recipient.acknowledged_at ? <p className="mt-1 text-xs text-[#667085]">Acknowledged {formatAlertDate(recipient.acknowledged_at)}</p> : recipient.read_at ? <p className="mt-1 text-xs text-[#667085]">Read {formatAlertDate(recipient.read_at)}</p> : null}</div>;
}

function LoadingRows() {
  return <div className="space-y-3" aria-label="Loading recipients">{[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-[#F3F4F7]" />)}</div>;
}

function label(value: string) {
  if (value === "ALL_PORTAL_USERS") return "Everyone in the organization";
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
