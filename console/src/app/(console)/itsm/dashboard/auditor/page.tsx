"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Copy,
  Cpu,
  Download,
  Eye,
  FileCheck2,
  Filter,
  GitBranch,
  Hash,
  Link2,
  ListFilter,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { buildReadableAuditEvidenceReport } from "@/lib/audit-evidence-report";

const PAGE_SIZE = 25;

type WorkspaceView = "audit" | "traces";
type AuditorSection = "overview" | "audit-log" | "evidence" | "reports" | "exports";

type AuditorFilters = {
  category: string;
  actor: string;
  targetType: string;
  outcome: string;
  startDate: string;
  endDate: string;
};

const EMPTY_FILTERS: AuditorFilters = {
  category: "",
  actor: "",
  targetType: "",
  outcome: "",
  startDate: "",
  endDate: "",
};

type AuditEvent = {
  record_id?: string;
  action?: string;
  reason?: string | null;
  actor_id?: string | null;
  actor_display?: string | null;
  actor_type?: string | null;
  actor_role?: string | null;
  target_id?: string | null;
  target_type?: string | null;
  tenant_id?: string | null;
  context_id?: string | null;
  policy_id?: string | null;
  policy_decision?: string | null;
  approval_id?: string | null;
  approval_status?: string | null;
  before_summary?: unknown;
  after_summary?: unknown;
  evidence_references?: string[] | null;
  request_id?: string | null;
  timestamp?: string | null;
  integrity_hash?: string | null;
  prior_hash?: string | null;
  response_status?: number | null;
  chain_valid?: boolean | null;
  execution_trace?: unknown;
};

type AuditEventsResponse = {
  source: "clickhouse" | "postgres";
  total: number;
  records: AuditEvent[];
  integrity_checked: boolean;
};

type AuditorOverview = {
  total_events: number;
  privileged_events: number;
  denied_events: number;
  ai_events: number;
  exported_evidence: number;
  administrative_changes: number;
  integrity_valid: boolean;
  last_verified_at?: string | null;
  source: string;
  recent_events: AuditEvent[];
  activity_trend: { date: string; count: number }[];
  top_actions: { action: string; count: number }[];
};

type AgentTrace = {
  id: string;
  event: AuditEvent;
  goal: string;
  evidenceReferences: string[];
  tools: string[];
  approvals: string[];
  model: string;
  version: string;
  cost: string;
  outcome: string;
  failures: string[];
};

function displayAction(value?: string) {
  if (!value) return "Audit event";
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function shorten(value?: string | null, start = 8, end = 4) {
  if (!value) return "Not recorded";
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function displayIdentifier(value?: string | null) {
  if (!value) return "Not recorded";
  return displayAction(value);
}

function actorPresentation(event: AuditEvent) {
  const type = displayIdentifier(event.actor_type || "system");
  if (!event.actor_id) return { primary: type, secondary: "No identifier recorded" };
  if (event.actor_display) return { primary: event.actor_display, secondary: type };
  if (event.actor_id.includes("@")) return { primary: event.actor_id, secondary: type };
  return { primary: `${type} account`, secondary: shorten(event.actor_id, 10, 5) };
}

function targetPresentation(event: AuditEvent) {
  if (!event.target_id) return { primary: "Target not recorded", secondary: "No record identifier" };
  return {
    primary: displayIdentifier(event.target_type || "record"),
    secondary: shorten(event.target_id, 12, 6),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (Array.isArray(value)) {
    const entries = value.flatMap((item) => {
      if (typeof item !== "string") return [];
      const separator = item.includes("=") ? "=" : item.includes(":") ? ":" : "";
      if (!separator) return [];
      const [key, ...parts] = item.split(separator);
      return key.trim() ? [[key.trim(), parts.join(separator).trim()] as const] : [];
    });
    return entries.length ? Object.fromEntries(entries) : { steps: value };
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) ?? { outcome: value };
  } catch {
    return { outcome: value };
  }
}

function textValue(record: Record<string, unknown> | null, keys: string[], fallback = "Not recorded") {
  if (!record) return fallback;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return fallback;
}

function listValue(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .map((item) => typeof item === "string" ? item : item && typeof item === "object" ? textValue(item as Record<string, unknown>, ["name", "id", "reference", "tool", "status"], "") : String(item))
        .filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) return [value.trim()];
  }
  return [];
}

function costValue(record: Record<string, unknown> | null) {
  if (!record) return "Not recorded";
  for (const key of ["cost_usd", "cost", "estimated_cost"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return `$${value.toFixed(4)} USD`;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Not recorded";
}

function targetLabel(event: AuditEvent) {
  const target = event.target_id;
  if (!target) return "Not recorded";
  return event.target_type ? `${event.target_type}: ${target}` : target;
}

function traceOutcomeKind(trace: AgentTrace) {
  if (trace.failures.length > 0 || /fail|error/i.test(trace.outcome)) return "failed";
  if (/complete|success/i.test(trace.outcome)) return "completed";
  return "open";
}

function startOfDate(value: string) {
  return value ? `${value}T00:00:00.000Z` : "";
}

function endOfDate(value: string) {
  return value ? `${value}T23:59:59.999Z` : "";
}

function displaySummary(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function createTrace(event: AuditEvent, index: number): AgentTrace | null {
  const trace = asRecord(event.execution_trace);
  const isAgentEvent = /(^|[._-])(agent|ai|tool)([._-]|$)/i.test(event.action || "");
  if (!trace && !isAgentEvent) return null;

  const model = textValue(trace, ["model", "model_name"]);
  const version = textValue(trace, ["model_version", "version"], "");
  return {
    id: event.record_id || event.request_id || `trace-${index}`,
    event,
    goal: textValue(trace, ["task_goal", "goal", "objective"], event.reason || "Not recorded"),
    evidenceReferences: listValue(trace, ["evidence_refs", "evidence_references", "evidence"]),
    tools: listValue(trace, ["tools", "tool_calls", "tool_names"]),
    approvals: listValue(trace, ["approvals", "approval_refs", "approval_evidence"]),
    model,
    version,
    cost: costValue(trace),
    outcome: textValue(trace, ["outcome", "result", "status"]),
    failures: listValue(trace, ["failures", "failure", "errors", "error"]),
  };
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}));
  return typeof body?.detail === "string"
    ? body.detail
    : typeof body?.error === "string"
      ? body.error
      : fallback;
}

export default function AuditorDashboardPage() {
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("section");
  const section: AuditorSection = requestedSection === "audit-log" || requestedSection === "evidence" || requestedSection === "reports" || requestedSection === "exports"
    ? requestedSection
    : "overview";
  const [activeView, setActiveView] = useState<WorkspaceView>("audit");
  const [auditData, setAuditData] = useState<AuditEventsResponse | null>(null);
  const [overview, setOverview] = useState<AuditorOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [exportHistory, setExportHistory] = useState<AuditEventsResponse | null>(null);
  const [exportHistoryLoading, setExportHistoryLoading] = useState(false);
  const [exportOffset, setExportOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterDraft, setFilterDraft] = useState<AuditorFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<AuditorFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedEventDetail, setSelectedEventDetail] = useState<AuditEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"all" | "date">("all");
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [exportAction, setExportAction] = useState("");
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const listScrollPosition = useRef(0);
  const copyResetTimer = useRef<number | null>(null);

  const hasStructuredFilters = Object.values(filters).some(Boolean);

  const loadAuditEvents = useCallback(async () => {
    if (section !== "audit-log" && section !== "evidence") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      integrity_check: String(activeView === "audit" && !search && !hasStructuredFilters),
    });
    if (search) params.set("search", search);
    if (filters.actor) params.set("actor", filters.actor);
    if (filters.startDate) params.set("start", startOfDate(filters.startDate));
    if (filters.endDate) params.set("end", endOfDate(filters.endDate));
    if (activeView === "audit") {
      if (filters.category) params.set("action_prefix", filters.category);
      if (filters.targetType) params.set("target_type", filters.targetType);
    }
    if (filters.outcome) params.set("outcome", filters.outcome);

    try {
      const endpoint = activeView === "audit" ? "events" : "traces";
      const response = await fetch(`/api/itsm/audit/${endpoint}?${params}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign("/itsm/login?next=%2Fitsm%2Fdashboard%2Fauditor");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Unable to load audit evidence"));
      setAuditData((await response.json()) as AuditEventsResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load audit evidence");
    } finally {
      setLoading(false);
    }
  }, [activeView, filters, hasStructuredFilters, offset, search, section]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/itsm/audit/overview", { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign("/itsm/login?next=%2Fitsm%2Fdashboard%2Fauditor");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Unable to load the audit overview"));
      setOverview((await response.json()) as AuditorOverview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the audit overview");
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadExportHistory = useCallback(async (requestedOffset = exportOffset) => {
    setExportHistoryLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/itsm/audit/exports?limit=${PAGE_SIZE}&offset=${requestedOffset}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign("/itsm/login?next=%2Fitsm%2Fdashboard%2Fauditor");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Unable to load export history"));
      setExportHistory((await response.json()) as AuditEventsResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load export history");
    } finally {
      setExportHistoryLoading(false);
    }
  }, [exportOffset]);

  useEffect(() => {
    const request = window.setTimeout(() => void loadAuditEvents(), 0);
    return () => window.clearTimeout(request);
  }, [loadAuditEvents]);

  useEffect(() => {
    const request = window.setTimeout(() => {
      if (section === "overview" || section === "reports") void loadOverview();
      if (section === "exports") void loadExportHistory();
    }, 0);
    return () => window.clearTimeout(request);
  }, [loadExportHistory, loadOverview, section]);

  useEffect(() => {
    const request = window.setTimeout(() => {
      setActiveView("audit");
      setSelectedRecordId(null);
      setSelectedEventDetail(null);
      setDetailError(null);
      setOffset(0);
      setExportOffset(0);
      setSearch("");
      setSearchInput("");
      setError(null);
    }, 0);
    return () => window.clearTimeout(request);
  }, [section]);

  useEffect(() => () => {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
  }, []);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSelectedRecordId(null);
    setOffset(0);
    setSearch(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
    setOffset(0);
    setSelectedRecordId(null);
    setSelectedEventDetail(null);
    setDetailError(null);
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (filterDraft.startDate && filterDraft.endDate && filterDraft.startDate > filterDraft.endDate) {
      setError("The start date must be before the end date");
      return;
    }
    setError(null);
    setFilters({ ...filterDraft });
    setOffset(0);
    setSelectedRecordId(null);
  };

  const clearFilters = () => {
    setFilterDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setOffset(0);
    setSelectedRecordId(null);
    setSelectedEventDetail(null);
    setDetailError(null);
    setError(null);
  };

  const changeView = (view: WorkspaceView) => {
    setActiveView(view);
    setSearchInput("");
    setSearch("");
    setFilterDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setOffset(0);
    setSelectedRecordId(null);
    setSelectedEventDetail(null);
    setDetailError(null);
    setExportNotice(null);
  };

  const loadEventDetail = useCallback(async (recordId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await fetch(`/api/itsm/audit/events/${encodeURIComponent(recordId)}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.assign("/itsm/login?next=%2Fitsm%2Fdashboard%2Fauditor");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Unable to load this audit event"));
      setSelectedEventDetail((await response.json()) as AuditEvent);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught.message : "Unable to load this audit event");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openDetail = useCallback((recordId: string) => {
    listScrollPosition.current = window.scrollY;
    setSelectedRecordId(recordId);
    setSelectedEventDetail(null);
    setDetailError(null);
    setExportOpen(false);
    if (activeView === "audit") void loadEventDetail(recordId);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }, [activeView, loadEventDetail]);

  const closeDetail = useCallback(() => {
    setSelectedRecordId(null);
    setSelectedEventDetail(null);
    setDetailError(null);
    window.requestAnimationFrame(() => window.scrollTo({ top: listScrollPosition.current, behavior: "auto" }));
  }, []);

  const copyEvidenceValue = useCallback(async (field: string, value?: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = window.setTimeout(() => setCopiedField(null), 1800);
    } catch {
      setError("Unable to copy this evidence identifier");
    }
  }, []);

  const viewRelatedEvents = useCallback((correlationId?: string | null) => {
    if (!correlationId) return;
    setActiveView("audit");
    setSearchInput(correlationId);
    setSearch(correlationId);
    setFilterDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setOffset(0);
    setSelectedRecordId(null);
    setSelectedEventDetail(null);
    setDetailError(null);
    setError(null);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }, []);

  const handleExport = async () => {
    setExporting(true);
    setExportNotice(null);
    setError(null);
    try {
      if (exportScope === "date" && exportStartDate && exportEndDate && exportStartDate > exportEndDate) {
        throw new Error("The export start date must be before the end date");
      }
      const exportBody = {
        ...(exportScope === "date" ? {
          start: exportStartDate ? startOfDate(exportStartDate) : null,
          end: exportEndDate ? endOfDate(exportEndDate) : null,
        } : {}),
        ...(exportAction.trim() ? { action: exportAction.trim() } : {}),
      };
      const response = await fetch("/api/itsm/audit/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportBody),
      });
      if (response.status === 401) {
        window.location.assign("/itsm/login?next=%2Fitsm%2Fdashboard%2Fauditor");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Unable to export audit evidence"));
      const artifact = await response.json();
      const report = buildReadableAuditEvidenceReport(artifact);
      const blob = new Blob([report], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `itsm-audit-evidence-report-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      const recordCount = artifact?.manifest?.record_count;
      setExportNotice(typeof recordCount === "number" ? `Readable signed evidence report created with ${recordCount} records.` : "Readable signed evidence report created.");
      setExportOpen(false);
      setExportOffset(0);
      await loadExportHistory(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to export audit evidence");
    } finally {
      setExporting(false);
    }
  };

  const events = useMemo(() => auditData?.records ?? [], [auditData]);
  const traces = useMemo(() => events.map(createTrace).filter((trace): trace is AgentTrace => trace !== null), [events]);
  const selectedEvent = selectedEventDetail;
  const selectedTrace = traces.find((trace) => trace.id === selectedRecordId) ?? null;
  const invalidLinks = events.filter((event) => event.chain_valid === false).length;
  const integrityState = loading && !auditData ? "Checking" : !auditData?.integrity_checked ? "Not checked" : events.length === 0 ? "No records" : invalidLinks > 0 ? "Needs review" : "Verified";
  const completedTraces = traces.filter((trace) => traceOutcomeKind(trace) === "completed").length;
  const failedTraces = traces.filter((trace) => traceOutcomeKind(trace) === "failed").length;
  const openTraces = traces.filter((trace) => traceOutcomeKind(trace) === "open").length;
  const shownFrom = (auditData?.total ?? 0) === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + events.length, auditData?.total ?? 0);
  const hasPreviousPage = offset > 0;
  const hasNextPage = offset + events.length < (auditData?.total ?? 0);
  const detailOpen = Boolean(selectedRecordId);

  if (section === "overview") {
    return <div className="role-portal mx-auto max-w-[1440px] space-y-6">
      <AuditorPageHeader title="Audit overview" description="Independent, read-only visibility into platform activity and evidence." onRefresh={() => void loadOverview()} loading={overviewLoading} />
      {error ? <ErrorNotice message={error} onRetry={() => void loadOverview()} /> : null}
      <section className="overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-sm shadow-[#6D28D9]/5" aria-label="Audit overview metrics">
        <div className="grid divide-y divide-[#E6E9F0] xl:grid-cols-[minmax(270px,.8fr)_minmax(0,2.2fr)] xl:divide-x xl:divide-y-0">
          <OverviewMetric icon={FileCheck2} label="Total audit events" value={overviewLoading ? "—" : String(overview?.total_events ?? 0)} detail="Tenant-scoped records available for review" primary />
          <div className="grid divide-y divide-[#E6E9F0] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <OverviewMetric icon={LockKeyhole} label="Privileged actions" value={overviewLoading ? "—" : String(overview?.privileged_events ?? 0)} detail="Role, permission, and admin activity" />
            <OverviewMetric icon={CircleX} label="Denied actions" value={overviewLoading ? "—" : String(overview?.denied_events ?? 0)} detail="Authorization failures" warning={Boolean(overview?.denied_events)} />
            <OverviewMetric icon={ShieldCheck} label="Integrity" value={overviewLoading ? "Checking" : !overview?.total_events ? "No records" : overview.integrity_valid ? "Verified" : "Needs review"} detail="Complete tenant hash chain" verified={Boolean(overview?.total_events && overview.integrity_valid)} warning={Boolean(overview?.total_events && !overview.integrity_valid)} />
          </div>
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <RecentActivity events={overview?.recent_events ?? []} loading={overviewLoading} />
        <IntegrityPanel overview={overview} loading={overviewLoading} />
      </div>
      <ActivityTrend points={overview?.activity_trend ?? []} loading={overviewLoading} />
    </div>;
  }

  if (section === "reports") {
    return <div className="role-portal mx-auto max-w-[1440px] space-y-6">
      <AuditorPageHeader title="Audit reports" description="Review summarized governance activity, then drill into the supporting audit evidence." onRefresh={() => void loadOverview()} loading={overviewLoading} />
      {error ? <ErrorNotice message={error} onRetry={() => void loadOverview()} /> : null}
      <section className="overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-sm shadow-[#6D28D9]/5">
        <div className="border-b border-[#E6E9F0] px-5 py-4"><h2 className="text-sm font-bold text-[#0E1726]">Governance summary</h2><p className="mt-1 text-xs text-[#6B7488]">Counts are derived from the authoritative tenant audit chain.</p></div>
        <div className="grid divide-y divide-[#E6E9F0] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          <OverviewMetric icon={BarChart3} label="Audit activity" value={overviewLoading ? "—" : String(overview?.total_events ?? 0)} detail="All recorded events" />
          <OverviewMetric icon={LockKeyhole} label="Privileged activity" value={overviewLoading ? "—" : String(overview?.privileged_events ?? 0)} detail="Role, permission, and admin activity" />
          <OverviewMetric icon={CircleX} label="Authorization failures" value={overviewLoading ? "—" : String(overview?.denied_events ?? 0)} detail="Denied actions" warning={Boolean(overview?.denied_events)} />
          <OverviewMetric icon={Wrench} label="Administrative changes" value={overviewLoading ? "—" : String(overview?.administrative_changes ?? 0)} detail="Configuration and governance activity" />
        </div>
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ActivityTrend points={overview?.activity_trend ?? []} loading={overviewLoading} compact />
        <TopActions actions={overview?.top_actions ?? []} loading={overviewLoading} />
      </div>
      <div className="flex justify-end"><Link href="/itsm/dashboard/auditor?section=audit-log" className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#5B21B6]">Investigate in Audit Log <ChevronRight className="h-4 w-4" /></Link></div>
    </div>;
  }

  if (section === "exports") {
    const history = exportHistory?.records ?? [];
    return <div className="role-portal mx-auto max-w-[1440px] space-y-6">
      <AuditorPageHeader title="Evidence exports" description="Create authorized, tenant-scoped evidence packages and review export history." onRefresh={() => void loadExportHistory()} loading={exportHistoryLoading} />
      {error ? <ErrorNotice message={error} onRetry={() => void loadExportHistory()} /> : null}
      <section className="rounded-2xl border border-[#DDD6FE] bg-white p-6 shadow-sm shadow-[#6D28D9]/5" aria-label="Create evidence export">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-start gap-3"><span className="rounded-lg bg-[#F1ECFE] p-2.5 text-[#6D28D9]"><Download className="h-4 w-4" /></span><div><h2 className="text-base font-bold text-[#0E1726]">Create signed evidence report</h2><p className="mt-1 text-xs leading-5 text-[#6B7488]">The readable report includes the unchanged signed evidence artifact for technical verification. Export creation is recorded in the audit log.</p></div></div>
            <div className="mt-5 flex flex-wrap gap-5 border-t border-[#EEF1F5] pt-4"><label className="inline-flex items-center gap-2 text-xs font-semibold text-[#475069]"><input type="radio" name="exportScopePage" checked={exportScope === "all"} onChange={() => setExportScope("all")} className="accent-[#6D28D9]" />All tenant evidence</label><label className="inline-flex items-center gap-2 text-xs font-semibold text-[#475069]"><input type="radio" name="exportScopePage" checked={exportScope === "date"} onChange={() => setExportScope("date")} className="accent-[#6D28D9]" />Selected date range</label></div>
            <div className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-3">
              <TextFilterField label="Exact action (optional)" value={exportAction} placeholder="e.g. itsm.incident.updated" onChange={setExportAction} />
              {exportScope === "date" ? <><DateField label="Export from" value={exportStartDate} onChange={setExportStartDate} /><DateField label="Export through" value={exportEndDate} onChange={setExportEndDate} /></> : null}
            </div>
          </div>
          <button type="button" onClick={() => void handleExport()} disabled={exporting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#6D28D9] px-5 py-3 text-xs font-semibold text-white hover:bg-[#5B21B6] disabled:opacity-60"><Download className="h-4 w-4" />{exporting ? "Preparing report…" : "Create evidence report"}</button>
        </div>
      </section>
      {exportNotice ? <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800" role="status"><CheckCircle2 className="h-4 w-4" />{exportNotice}</div> : null}
      <ExportHistoryTable events={history} data={exportHistory} loading={exportHistoryLoading} offset={exportOffset} onPageChange={setExportOffset} />
    </div>;
  }

  return (
    <div className="role-portal mx-auto max-w-[1440px] space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#F1ECFE] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#5B21B6]"><LockKeyhole className="h-3 w-3" />Read-only</div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0E1726]">{section === "audit-log" ? "Audit log" : "Evidence explorer"}</h1>
          <p className="mt-1 text-sm text-[#6B7488]">{section === "audit-log" ? "Search and inspect the tenant activity you are authorized to review." : "Reconstruct platform and AI activity from connected, immutable evidence."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadAuditEvents()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#5B21B6] shadow-sm transition hover:bg-[#FAF8FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]/30 disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          <Link href="/itsm/dashboard/auditor?section=exports" className="inline-flex items-center gap-2 rounded-lg bg-[#6D28D9] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#5B21B6]"><Download className="h-3.5 w-3.5" /> Export evidence</Link>
        </div>
      </header>

      {exportOpen ? (
        <section className="rounded-xl border border-[#DDD6FE] bg-white p-5 shadow-sm shadow-[#6D28D9]/5" aria-label="Evidence export scope">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <div>
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-[#F1ECFE] p-2 text-[#6D28D9]"><FileCheck2 className="h-4 w-4" /></span>
                <div>
                  <h2 className="text-sm font-bold text-[#0E1726]">Create a readable evidence report</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-[#6B7488]">The report opens like a document, shows audit events in a clear table, and can be printed or saved as PDF. The unchanged signed JSON is included for technical verification.</p>
                </div>
              </div>
              <div className="mt-4 border-t border-[#EEF1F5] pt-4">
                <p className="text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488]">Choose export scope</p>
                <p className="mt-1 text-xs text-[#6B7488]">The export is tenant-scoped. Table paging and search text do not silently limit it.</p>
                <div className="mt-3 flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#475069]"><input type="radio" name="exportScope" checked={exportScope === "all"} onChange={() => setExportScope("all")} className="accent-[#6D28D9]" />All tenant evidence</label>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#475069]"><input type="radio" name="exportScope" checked={exportScope === "date"} onChange={() => setExportScope("date")} className="accent-[#6D28D9]" />Selected date range</label>
                </div>
                {exportScope === "date" ? <div className="mt-3 grid max-w-xl gap-2 sm:grid-cols-2"><DateField label="Export from" value={exportStartDate} onChange={setExportStartDate} /><DateField label="Export through" value={exportEndDate} onChange={setExportEndDate} /></div> : null}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setExportOpen(false)} className="rounded-lg border border-[#E6E9F0] px-3.5 py-2.5 text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA]">Cancel</button>
              <button type="button" onClick={() => void handleExport()} disabled={exporting} className="rounded-lg bg-[#6D28D9] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#5B21B6] disabled:opacity-60">{exporting ? "Preparing report..." : "Create readable report"}</button>
            </div>
          </div>
        </section>
      ) : null}

      {detailOpen ? <>{activeView === "audit" ? detailLoading ? <DetailLoading onBack={closeDetail} /> : detailError ? <DetailFailure message={detailError} onBack={closeDetail} onRetry={() => selectedRecordId && void loadEventDetail(selectedRecordId)} /> : selectedEvent ? <EvidenceDetail event={selectedEvent} copiedField={copiedField} onClose={closeDetail} onCopy={copyEvidenceValue} onViewRelated={viewRelatedEvents} /> : null : null}{activeView === "traces" && selectedTrace ? <TraceDetail trace={selectedTrace} copiedField={copiedField} onClose={closeDetail} onCopy={copyEvidenceValue} onViewRelated={viewRelatedEvents} /> : null}</> : <>
      {section === "evidence" ? <nav className="flex gap-6 border-b border-[#E6E9F0]" aria-label="Evidence types" role="tablist">
        <ViewTab active={activeView === "audit"} icon={FileCheck2} label="Platform evidence" onClick={() => changeView("audit")} />
        <ViewTab active={activeView === "traces"} icon={GitBranch} label="AI activity evidence" onClick={() => changeView("traces")} />
      </nav> : null}

      <section className="overflow-hidden rounded-xl border border-[#DDD6FE] bg-white shadow-sm shadow-[#6D28D9]/5" aria-label={activeView === "audit" ? "Audit evidence summary" : "Agent trace summary"}>
        {activeView === "audit" ? <div className="grid divide-y divide-[#E6E9F0] sm:grid-cols-3 sm:divide-x sm:divide-y-0"><EvidenceSummary icon={FileCheck2} label="Tenant records" value={loading && !auditData ? "-" : String(auditData?.total ?? 0)} detail={hasStructuredFilters || search ? "Matching immutable events" : "Immutable audit events"} /><EvidenceSummary icon={ShieldCheck} label="Integrity" value={integrityState} detail={hasStructuredFilters || search ? "Clear filters to verify the chain" : "Current page hash-chain check"} verified={integrityState === "Verified"} warning={integrityState === "Needs review"} /><EvidenceSummary icon={AlertCircle} label="Integrity exceptions" value={auditData?.integrity_checked ? String(invalidLinks) : "Not checked"} detail="Broken links on the verified page" verified={auditData?.integrity_checked && invalidLinks === 0} warning={invalidLinks > 0} /></div> : <div className="grid divide-y divide-[#E6E9F0] sm:grid-cols-2 lg:grid-cols-4 lg:divide-y-0 lg:divide-x"><EvidenceSummary icon={Bot} label="Recorded traces" value={loading && !auditData ? "-" : String(auditData?.total ?? 0)} detail="Matching tenant agent traces" /><EvidenceSummary icon={CheckCircle2} label="Completed" value={String(completedTraces)} detail="Successful on this page" verified={completedTraces > 0} /><EvidenceSummary icon={RefreshCw} label="In progress" value={String(openTraces)} detail="Running or incomplete on this page" /><EvidenceSummary icon={CircleX} label="Failed" value={String(failedTraces)} detail="Failed on this page" warning={failedTraces > 0} /></div>}
      </section>

      <section className="rounded-xl border border-[#DDD6FE] bg-white p-3 shadow-sm shadow-[#6D28D9]/5">
        <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1"><span className="sr-only">Search {activeView === "audit" ? "audit evidence" : "agent traces"}</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93A5]" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={activeView === "audit" ? "Search action, actor, target, workflow reference, or reason" : "Search goal, tool, model, outcome, or workflow reference"} className="w-full rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] py-2.5 pl-9 pr-9 text-xs text-[#0E1726] outline-none transition placeholder:text-[#8A93A5] focus:border-[#6D28D9] focus:bg-white focus:ring-2 focus:ring-[#6D28D9]/10" />{searchInput ? <button type="button" onClick={clearSearch} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#8A93A5] hover:bg-[#F1ECFE] hover:text-[#5B21B6]"><X className="h-3.5 w-3.5" /></button> : null}</label>
          <button type="submit" disabled={loading} className="rounded-lg border border-[#DDD6FE] bg-[#FAF8FF] px-4 py-2.5 text-xs font-semibold text-[#5B21B6] transition hover:bg-[#F1ECFE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]/30 disabled:opacity-60">Search</button>
          <button type="button" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-4 py-2.5 text-xs font-semibold text-[#5B21B6] transition hover:bg-[#F1ECFE]"><Filter className="h-3.5 w-3.5" />Filters{hasStructuredFilters ? <span className="rounded-full bg-[#6D28D9] px-1.5 py-0.5 text-[9px] text-white">On</span> : null}</button>
        </form>
        {search ? <div className="mt-2 flex items-center justify-between border-t border-[#EEF1F5] px-1 pt-2 text-xs text-[#6B7488]"><span>Showing results for <strong className="text-[#0E1726]">{search}</strong></span><button type="button" onClick={clearSearch} className="font-semibold text-[#6D28D9] hover:underline">Clear search</button></div> : null}
        {filtersOpen ? <form onSubmit={applyFilters} className="mt-3 border-t border-[#EEF1F5] pt-3"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{activeView === "audit" ? <><SelectField label="Event category" value={filterDraft.category} onChange={(value) => setFilterDraft((current) => ({ ...current, category: value }))} options={[{ value: "", label: "All event categories" }, { value: "auth", label: "Authentication" }, { value: "itsm.authorization.", label: "Authorization decisions" }, { value: "itsm.incident.", label: "Incident activity" }, { value: "itsm.request.", label: "Request activity" }, { value: "itsm.audit.", label: "Auditor activity" }, { value: "agent", label: "Agent activity" }]} /><SelectField label="Target type" value={filterDraft.targetType} onChange={(value) => setFilterDraft((current) => ({ ...current, targetType: value }))} options={[{ value: "", label: "All target types" }, { value: "incident", label: "Incident" }, { value: "service_request", label: "Service request" }, { value: "audit_store", label: "Audit store" }, { value: "agent_action", label: "Agent action" }]} /><SelectField label="Result" value={filterDraft.outcome} onChange={(value) => setFilterDraft((current) => ({ ...current, outcome: value }))} options={[{ value: "", label: "All results" }, { value: "success", label: "Successful" }, { value: "denied", label: "Denied" }, { value: "failed", label: "Failed" }]} /></> : <SelectField label="Outcome" value={filterDraft.outcome} onChange={(value) => setFilterDraft((current) => ({ ...current, outcome: value }))} options={[{ value: "", label: "All outcomes" }, { value: "completed", label: "Completed" }, { value: "running", label: "In progress" }, { value: "failed", label: "Failed" }]} />}<TextFilterField label="Actor" value={filterDraft.actor} placeholder="Name, email, ID, or actor type" onChange={(value) => setFilterDraft((current) => ({ ...current, actor: value }))} /><DateField label="From date" value={filterDraft.startDate} onChange={(value) => setFilterDraft((current) => ({ ...current, startDate: value }))} /><DateField label="Through date" value={filterDraft.endDate} onChange={(value) => setFilterDraft((current) => ({ ...current, endDate: value }))} /></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-[#8A93A5]">Filters apply to the complete tenant evidence set, not only the visible page.</p><div className="flex gap-2"><button type="button" onClick={clearFilters} disabled={!hasStructuredFilters && !Object.values(filterDraft).some(Boolean)} className="rounded-lg px-3 py-2 text-xs font-semibold text-[#6B7488] hover:bg-[#F5F7FA] disabled:opacity-40">Clear filters</button><button type="submit" className="rounded-lg bg-[#6D28D9] px-4 py-2 text-xs font-semibold text-white hover:bg-[#5B21B6]">Apply filters</button></div></div></form> : null}
        {hasStructuredFilters ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#EEF1F5] pt-3"><span className="text-[10px] font-bold uppercase tracking-[.08em] text-[#8A93A5]">Active filters</span>{filters.category ? <FilterChip label={`Category: ${displayAction(filters.category)}`} /> : null}{filters.targetType ? <FilterChip label={`Target: ${displayIdentifier(filters.targetType)}`} /> : null}{filters.outcome ? <FilterChip label={`Outcome: ${displayAction(filters.outcome)}`} /> : null}{filters.actor ? <FilterChip label={`Actor: ${filters.actor}`} /> : null}{filters.startDate ? <FilterChip label={`From: ${filters.startDate}`} /> : null}{filters.endDate ? <FilterChip label={`Through: ${filters.endDate}`} /> : null}<button type="button" onClick={clearFilters} className="ml-auto text-xs font-semibold text-[#6D28D9] hover:underline">Clear all</button></div> : null}
      </section>

      {exportNotice ? <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800" role="status"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{exportNotice}</div> : null}
      {error ? <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800" role="alert"><AlertCircle className="h-4 w-4 text-red-600" /><span className="font-semibold">{error}</span><button type="button" onClick={() => void loadAuditEvents()} className="ml-auto font-bold underline">Retry</button></div> : null}

      <div>
        {activeView === "audit" ? <AuditTable events={events} auditData={auditData} error={error} loading={loading} offset={offset} search={search} selectedRecordId={selectedRecordId} shownFrom={shownFrom} shownTo={shownTo} hasPreviousPage={hasPreviousPage} hasNextPage={hasNextPage} onClearSearch={clearSearch} onSelect={openDetail} onPageChange={(nextOffset) => { setOffset(nextOffset); setSelectedRecordId(null); }} /> : <TraceTable traces={traces} loading={loading} error={error} search={search} selectedRecordId={selectedRecordId} totalTraces={auditData?.total ?? 0} offset={offset} hasPreviousPage={hasPreviousPage} hasNextPage={hasNextPage} onClearSearch={clearSearch} onSelect={openDetail} onPageChange={(nextOffset) => { setOffset(nextOffset); setSelectedRecordId(null); }} />}
      </div>
      </>}
    </div>
  );
}

function AuditorPageHeader({ title, description, onRefresh, loading }: { title: string; description: string; onRefresh: () => void; loading: boolean }) {
  return <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#F1ECFE] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#5B21B6]"><LockKeyhole className="h-3 w-3" />Read-only Auditor workspace</div><h1 className="text-3xl font-extrabold tracking-tight text-[#0E1726]">{title}</h1><p className="mt-1 text-sm text-[#6B7488]">{description}</p></div><button type="button" onClick={onRefresh} disabled={loading} className="inline-flex self-start items-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#5B21B6] shadow-sm hover:bg-[#FAF8FF] disabled:opacity-60 lg:self-auto"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button></header>;
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800" role="alert"><AlertCircle className="h-4 w-4 text-red-600" /><span className="font-semibold">{message}</span><button type="button" onClick={onRetry} className="ml-auto font-bold underline">Retry</button></div>;
}

function OverviewMetric({ icon: Icon, label, value, detail, verified = false, warning = false, primary = false }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail: string; verified?: boolean; warning?: boolean; primary?: boolean }) {
  const valueClass = verified ? "text-emerald-700" : warning ? "text-red-700" : "text-[#0E1726]";
  return <div className={`flex items-center gap-4 px-5 ${primary ? "min-h-36 py-6" : "min-h-28 py-5"}`}><span className={`rounded-xl bg-[#F1ECFE] text-[#6D28D9] ${primary ? "p-4" : "p-3"}`}><Icon className={primary ? "h-6 w-6" : "h-5 w-5"} /></span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488]">{label}</p><p className={`mt-1 font-extrabold ${primary ? "text-4xl" : "text-2xl"} ${valueClass}`}>{value}</p><p className="mt-1 text-[11px] leading-4 text-[#8A93A5]">{detail}</p></div></div>;
}

function eventResult(event: AuditEvent) {
  if (event.response_status === 403 || /denied/i.test(event.action || "")) return { label: "Denied", className: "bg-red-50 text-red-700" };
  if ((event.response_status ?? 0) >= 400 || /fail|error/i.test(event.action || "")) return { label: "Failed", className: "bg-amber-50 text-amber-800" };
  return { label: "Success", className: "bg-emerald-50 text-emerald-700" };
}

function RecentActivity({ events, loading }: { events: AuditEvent[]; loading: boolean }) {
  return <section className="overflow-hidden rounded-2xl border border-[#E6E9F0] bg-white shadow-sm"><div className="flex items-center justify-between border-b border-[#E6E9F0] px-5 py-4"><div><h2 className="text-sm font-bold text-[#0E1726]">Recent activity</h2><p className="mt-1 text-xs text-[#6B7488]">Newest tenant audit events.</p></div><Link href="/itsm/dashboard/auditor?section=audit-log" className="text-xs font-semibold text-[#6D28D9] hover:underline">View all</Link></div><div className="sm:hidden">{loading ? Array.from({ length: 4 }).map((_, index) => <div key={index} className="border-b border-[#EEF1F5] p-4"><div className="h-16 animate-pulse rounded bg-[#EEF1F5]" /></div>) : null}{!loading && events.length === 0 ? <p className="px-5 py-12 text-center text-xs text-[#8A93A5]">No tenant audit activity has been recorded.</p> : null}{!loading ? events.map((event, index) => { const actor = actorPresentation(event); const result = eventResult(event); return <article key={event.record_id || `${event.action}-${index}`} className="border-b border-[#EEF1F5] px-5 py-4 last:border-b-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold leading-5 text-[#0E1726]">{displayAction(event.action)}</p><p className="mt-1 truncate text-[11px] font-semibold text-[#475069]">{actor.primary}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${result.className}`}>{result.label}</span></div><p className="mt-2 text-[10px] text-[#8A93A5]">{event.timestamp ? formatDateTime(event.timestamp) : "Time not recorded"}</p></article>; }) : null}</div><div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[720px] text-left"><thead className="bg-[#FCFAFF]"><tr>{["Time", "Actor", "Action", "Resource", "Result"].map((heading) => <th key={heading} className="px-4 py-3 text-[10px] font-bold uppercase tracking-[.08em] text-[#6B7488]">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#EEF1F5]">{loading ? Array.from({ length: 5 }).map((_, index) => <tr key={index} className="animate-pulse"><td colSpan={5} className="px-4 py-3"><div className="h-6 rounded bg-[#EEF1F5]" /></td></tr>) : null}{!loading && events.length === 0 ? <tr><td colSpan={5} className="px-5 py-12 text-center text-xs text-[#8A93A5]">No tenant audit activity has been recorded.</td></tr> : null}{!loading ? events.map((event, index) => { const actor = actorPresentation(event); const target = targetPresentation(event); const result = eventResult(event); return <tr key={event.record_id || `${event.action}-${index}`}><td className="whitespace-nowrap px-4 py-3 text-[11px] text-[#6B7488]">{event.timestamp ? formatDateTime(event.timestamp) : "Not recorded"}</td><td className="px-4 py-3 text-xs font-semibold text-[#475069]">{actor.primary}</td><td className="px-4 py-3 text-xs font-semibold text-[#0E1726]">{displayAction(event.action)}</td><td className="px-4 py-3 text-xs text-[#475069]">{target.primary}<span className="ml-1 text-[10px] text-[#8A93A5]">{target.secondary}</span></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${result.className}`}>{result.label}</span></td></tr>; }) : null}</tbody></table></div></section>;
}

function IntegrityPanel({ overview, loading }: { overview: AuditorOverview | null; loading: boolean }) {
  const hasRecords = Boolean(overview?.total_events);
  const verified = hasRecords && Boolean(overview?.integrity_valid);
  const title = loading ? "Verifying audit chain" : !hasRecords ? "No evidence to verify" : verified ? "Audit chain verified" : "Integrity needs review";
  const detail = !hasRecords ? "Integrity can be checked after the first tenant audit event is recorded." : verified ? "The complete tenant chain passed verification." : "Review the integrity result before relying on this evidence.";
  return <aside className="rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-sm"><h2 className="text-sm font-bold text-[#0E1726]">Integrity status</h2><div className="mt-5 flex items-start gap-3"><span className={`rounded-xl p-3 ${verified ? "bg-emerald-50 text-emerald-700" : "bg-[#F1ECFE] text-[#6D28D9]"}`}><ShieldCheck className="h-5 w-5" /></span><div><p className="text-sm font-bold text-[#0E1726]">{title}</p><p className="mt-1 text-xs leading-5 text-[#6B7488]">{detail}</p></div></div><dl className="mt-6 space-y-4 border-y border-[#EEF1F5] py-5 text-xs"><div className="flex items-start justify-between gap-4"><dt className="text-[#6B7488]">Last checked</dt><dd className="text-right font-semibold text-[#475069]">{overview?.last_verified_at ? formatDateTime(overview.last_verified_at) : "No records"}</dd></div><div className="flex items-start justify-between gap-4"><dt className="text-[#6B7488]">Evidence source</dt><dd className="font-semibold text-[#475069]">{overview?.source === "postgres" ? "PostgreSQL" : overview?.source || "Unavailable"}</dd></div></dl><p className="mt-5 rounded-xl bg-[#F8F5FF] p-3 text-[11px] leading-5 text-[#5B21B6]">This view is read-only and reflects the authoritative tenant audit store.</p></aside>;
}

function ActivityTrend({ points, loading, compact = false }: { points: { date: string; count: number }[]; loading: boolean; compact?: boolean }) {
  const max = Math.max(...points.map((point) => point.count), 1);
  return <section className={`rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-sm ${compact ? "min-h-[330px]" : ""}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-bold text-[#0E1726]">Audit activity trend</h2><p className="mt-1 text-xs text-[#6B7488]">Recorded events over the latest 14-day evidence window.</p></div>{!compact ? <Link href="/itsm/dashboard/auditor?section=audit-log" className="text-xs font-semibold text-[#6D28D9] hover:underline">Review in Audit Log</Link> : null}</div><div className="mt-7 flex h-44 items-end gap-2 border-b border-[#E6E9F0] px-1" aria-label="Audit events by day">{loading ? Array.from({ length: 10 }).map((_, index) => <div key={index} className="h-full flex-1 animate-pulse rounded-t bg-[#F1ECFE]" />) : points.length ? points.map((point) => <div key={point.date} className="group relative flex h-full flex-1 items-end"><div className="w-full rounded-t bg-[#7C3AED] transition hover:bg-[#5B21B6]" style={{ height: `${Math.max(8, (point.count / max) * 100)}%` }} /><span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#0E1726] px-2 py-1 text-[9px] text-white group-hover:block">{point.count} events</span></div>) : <div className="flex h-full w-full items-center justify-center text-xs text-[#8A93A5]">No activity is available for this period.</div>}</div>{points.length ? <div className="mt-2 flex justify-between text-[9px] text-[#8A93A5]"><span>{points[0]?.date}</span><span>{points[points.length - 1]?.date}</span></div> : null}</section>;
}

function TopActions({ actions, loading }: { actions: { action: string; count: number }[]; loading: boolean }) {
  const max = Math.max(...actions.map((item) => item.count), 1);
  return <section className="rounded-2xl border border-[#E6E9F0] bg-white p-5 shadow-sm"><h2 className="text-sm font-bold text-[#0E1726]">Most recorded actions</h2><p className="mt-1 text-xs text-[#6B7488]">Use these groups as a starting point for investigation.</p><div className="mt-5 space-y-4">{loading ? Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-9 animate-pulse rounded bg-[#EEF1F5]" />) : actions.map((item) => <div key={item.action}><div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="truncate font-semibold text-[#475069]">{displayAction(item.action)}</span><span className="font-bold text-[#0E1726]">{item.count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#F1ECFE]"><div className="h-full rounded-full bg-[#6D28D9]" style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }} /></div></div>)}{!loading && !actions.length ? <p className="py-10 text-center text-xs text-[#8A93A5]">No actions recorded.</p> : null}</div></section>;
}

function ExportHistoryTable({ events, data, loading, offset, onPageChange }: { events: AuditEvent[]; data: AuditEventsResponse | null; loading: boolean; offset: number; onPageChange: (offset: number) => void }) {
  const total = data?.total ?? 0;
  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + events.length, total);
  return <section className="overflow-hidden rounded-2xl border border-[#E6E9F0] bg-white shadow-sm"><div className="border-b border-[#E6E9F0] px-5 py-4"><h2 className="text-sm font-bold text-[#0E1726]">Authorized export history</h2><p className="mt-1 text-xs text-[#6B7488]">Every generated evidence package is itself recorded as audit evidence.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-[#FCFAFF]"><tr>{["Export", "Created by", "Created", "Scope", "Records", "Integrity"].map((heading) => <th key={heading} className="px-5 py-3 text-[10px] font-bold uppercase tracking-[.08em] text-[#6B7488]">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#EEF1F5]">{loading ? Array.from({ length: 4 }).map((_, index) => <tr key={index} className="animate-pulse"><td colSpan={6} className="px-5 py-4"><div className="h-7 rounded bg-[#EEF1F5]" /></td></tr>) : null}{!loading && !events.length ? <tr><td colSpan={6} className="px-5 py-12 text-center text-xs text-[#8A93A5]">No authorized exports have been created.</td></tr> : null}{!loading ? events.map((event, index) => { const trace = asRecord(event.execution_trace); const actor = actorPresentation(event); const exportId = textValue(trace, ["export_id"], event.record_id || `export-${index + 1}`); const start = textValue(trace, ["start_filter"], "false"); const end = textValue(trace, ["end_filter"], "false"); const action = textValue(trace, ["action_filter"], ""); const scope = action ? `Action: ${displayAction(action)}` : start === "true" || end === "true" ? "Selected date range" : "All tenant evidence"; return <tr key={event.record_id || exportId}><td className="px-5 py-4"><p className="text-xs font-bold text-[#0E1726]">Evidence export</p><p className="mt-1 font-mono text-[10px] text-[#8A93A5]">{shorten(exportId, 12, 6)}</p></td><td className="px-5 py-4 text-xs font-semibold text-[#475069]">{actor.primary}</td><td className="whitespace-nowrap px-5 py-4 text-xs text-[#6B7488]">{event.timestamp ? formatDateTime(event.timestamp) : "Not recorded"}</td><td className="px-5 py-4 text-xs text-[#475069]">{scope}</td><td className="px-5 py-4 text-xs font-semibold text-[#475069]">{textValue(trace, ["record_count"], "Not recorded")}</td><td className="px-5 py-4"><IntegrityStatus value={event.chain_valid} /></td></tr>; }) : null}</tbody></table></div><TableFooter shownFrom={shownFrom} shownTo={shownTo} total={total} noun="exports" loading={loading} offset={offset} hasPreviousPage={offset > 0} hasNextPage={offset + events.length < total} onPageChange={onPageChange} /></section>;
}

function ViewTab({ active, icon: Icon, label, onClick }: { active: boolean; icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`relative inline-flex items-center gap-2 px-1 pb-3 pt-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]/30 ${active ? "text-[#6D28D9]" : "text-[#6B7488] hover:text-[#0E1726]"}`}><Icon className="h-4 w-4" />{label}{active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[#6D28D9]" /> : null}</button>;
}

function AuditTable({ events, auditData, error, loading, offset, search, selectedRecordId, shownFrom, shownTo, hasPreviousPage, hasNextPage, onClearSearch, onSelect, onPageChange }: { events: AuditEvent[]; auditData: AuditEventsResponse | null; error: string | null; loading: boolean; offset: number; search: string; selectedRecordId: string | null; shownFrom: number; shownTo: number; hasPreviousPage: boolean; hasNextPage: boolean; onClearSearch: () => void; onSelect: (id: string) => void; onPageChange: (offset: number) => void }) {
  return <section className="min-w-0 overflow-hidden rounded-xl border border-[#DDD6FE] bg-white shadow-sm shadow-[#6D28D9]/5"><div className="flex items-center justify-between border-b border-[#E6E9F0] px-5 py-4"><div><h2 className="text-sm font-bold text-[#0E1726]">Audit events</h2><p className="mt-0.5 text-xs text-[#6B7488]">Newest tenant events first. Inspect an event to reconstruct what happened.</p></div><span className="text-xs text-[#6B7488]">{events.length} shown</span></div><div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left"><thead className="border-b border-[#DDD6FE] bg-[#FCFAFF]"><tr>{["Time", "Actor", "Action", "Resource", "Result", "Integrity", ""].map((heading, index) => <th key={`${heading}-${index}`} className="px-4 py-3 text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488]">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#EEF1F5]">{loading && !auditData ? Array.from({ length: 6 }).map((_, index) => <tr key={index} className="animate-pulse"><td colSpan={7} className="px-4 py-4"><div className="h-7 rounded bg-[#EEF1F5]" /></td></tr>) : null}{!loading && !error && events.length === 0 ? <EmptyRow colSpan={7} title={search ? "No audit events match this search" : "No audit events are available"} detail={search ? "Try another actor, action, resource, workflow reference, or reason." : "Tenant audit events will appear here when they are recorded."} showClear={Boolean(search)} onClear={onClearSearch} /> : null}{events.map((event, index) => { const recordId = event.record_id || event.request_id || `event-${offset + index}`; const selected = recordId === selectedRecordId; const actor = actorPresentation(event); const target = targetPresentation(event); const result = eventResult(event); return <tr key={recordId} onClick={() => onSelect(recordId)} className={`cursor-pointer border-l-2 transition ${selected ? "border-[#6D28D9] bg-[#F1ECFE]" : "border-transparent hover:bg-[#FAF8FF]"}`}><td className="whitespace-nowrap px-4 py-3.5 text-[11px] text-[#6B7488]">{event.timestamp ? formatDateTime(event.timestamp) : "Not recorded"}</td><td className="px-4 py-3.5" title={event.actor_id || undefined}><p className="max-w-[165px] truncate text-xs font-semibold text-[#475069]">{actor.primary}</p><p className="mt-1 text-[10px] text-[#8A93A5]">{actor.secondary}</p></td><td className="px-4 py-3.5"><p className="text-xs font-bold text-[#0E1726]">{displayAction(event.action)}</p><p className="mt-1 max-w-[240px] truncate text-[11px] text-[#6B7488]">{event.reason || "No reason recorded"}</p></td><td className="px-4 py-3.5" title={targetLabel(event)}><p className="text-xs font-semibold text-[#475069]">{target.primary}</p><p className="mt-1 font-mono text-[10px] text-[#8A93A5]">{target.secondary}</p></td><td className="px-4 py-3.5"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${result.className}`}>{result.label}</span></td><td className="px-4 py-3.5"><IntegrityStatus value={event.chain_valid} /></td><td className="px-4 py-3.5 text-right"><InspectButton selected={selected} onClick={() => onSelect(recordId)} /></td></tr>; })}</tbody></table></div><TableFooter shownFrom={shownFrom} shownTo={shownTo} total={auditData?.total ?? 0} noun="records" loading={loading} offset={offset} hasPreviousPage={hasPreviousPage} hasNextPage={hasNextPage} onPageChange={onPageChange} /></section>;
}

function TraceTable({ traces, loading, error, search, selectedRecordId, totalTraces, offset, hasPreviousPage, hasNextPage, onClearSearch, onSelect, onPageChange }: { traces: AgentTrace[]; loading: boolean; error: string | null; search: string; selectedRecordId: string | null; totalTraces: number; offset: number; hasPreviousPage: boolean; hasNextPage: boolean; onClearSearch: () => void; onSelect: (id: string) => void; onPageChange: (offset: number) => void }) {
  const shownFrom = totalTraces === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + traces.length, totalTraces);
  return <section className="min-w-0 overflow-hidden rounded-xl border border-[#DDD6FE] bg-white shadow-sm shadow-[#6D28D9]/5"><div className="flex items-center justify-between border-b border-[#E6E9F0] px-5 py-4"><div><h2 className="text-sm font-bold text-[#0E1726]">Agent execution traces</h2><p className="mt-0.5 text-xs text-[#6B7488]">Read-only evidence explaining why an agent action occurred. Use Inspect for the complete trace.</p></div><span className="text-xs text-[#6B7488]">{traces.length} shown</span></div><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left"><thead className="border-b border-[#DDD6FE] bg-[#FCFAFF]"><tr>{["Goal", "Tools", "Model", "Outcome", "Time", ""].map((heading, index) => <th key={`${heading}-${index}`} className="px-4 py-3 text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488]">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#EEF1F5]">{loading ? Array.from({ length: 5 }).map((_, index) => <tr key={index} className="animate-pulse"><td colSpan={6} className="px-4 py-4"><div className="h-7 rounded bg-[#EEF1F5]" /></td></tr>) : null}{!loading && !error && traces.length === 0 ? <EmptyRow colSpan={6} title={search ? "No agent traces match this search" : "No agent execution traces are available"} detail={search ? "Try another goal, tool, model, outcome, or workflow reference." : "V1.5 execution traces will appear here when agent actions are recorded."} showClear={Boolean(search)} onClear={onClearSearch} icon={Bot} /> : null}{!loading ? traces.map((trace) => { const selected = trace.id === selectedRecordId; return <tr key={trace.id} onClick={() => onSelect(trace.id)} className={`cursor-pointer border-l-2 transition ${selected ? "border-[#6D28D9] bg-[#F1ECFE]" : "border-transparent hover:bg-[#FAF8FF]"}`}><td className="px-4 py-3.5"><p className="max-w-[300px] truncate text-xs font-bold text-[#0E1726]">{trace.goal}</p><p className="mt-1 font-mono text-[10px] text-[#8A93A5]">Workflow: {shorten(trace.event.request_id, 9, 5)}</p></td><td className="max-w-[180px] truncate px-4 py-3.5 text-xs text-[#475069]" title={trace.tools.join(", ")}>{trace.tools.length ? trace.tools.map(displayIdentifier).join(", ") : "Not recorded"}</td><td className="px-4 py-3.5 text-xs text-[#475069]">{displayIdentifier(trace.model)}{trace.version ? <span className="block text-[10px] text-[#8A93A5]">{trace.version}</span> : null}</td><td className="px-4 py-3.5"><OutcomeStatus trace={trace} /></td><td className="whitespace-nowrap px-4 py-3.5 text-[11px] text-[#6B7488]">{trace.event.timestamp ? formatDateTime(trace.event.timestamp) : "Not recorded"}</td><td className="px-4 py-3.5 text-right"><InspectButton selected={selected} onClick={() => onSelect(trace.id)} /></td></tr>; }) : null}</tbody></table></div><TableFooter shownFrom={shownFrom} shownTo={shownTo} total={totalTraces} noun="traces" loading={loading} offset={offset} hasPreviousPage={hasPreviousPage} hasNextPage={hasNextPage} onPageChange={onPageChange} /></section>;
}

function InspectButton({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  return <button type="button" onClick={(event) => { event.stopPropagation(); onClick(); }} aria-label={selected ? "Evidence inspector open" : "Inspect evidence"} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${selected ? "border-[#6D28D9] bg-[#6D28D9] text-white" : "border-[#DDD6FE] bg-white text-[#5B21B6] hover:bg-[#F1ECFE]"}`}><Eye className="h-3.5 w-3.5" />{selected ? "Open" : "Inspect"}</button>;
}

function TableFooter({ shownFrom, shownTo, total, noun, loading, offset, hasPreviousPage, hasNextPage, onPageChange }: { shownFrom: number; shownTo: number; total: number; noun: string; loading: boolean; offset: number; hasPreviousPage: boolean; hasNextPage: boolean; onPageChange: (offset: number) => void }) {
  return <footer className="flex flex-col gap-2 border-t border-[#DDD6FE] bg-[#FCFAFF] px-5 py-3 text-xs text-[#6B7488] sm:flex-row sm:items-center sm:justify-between"><span>{shownFrom}-{shownTo} of {total} {noun}</span>{hasPreviousPage || hasNextPage ? <div className="flex gap-2"><button type="button" disabled={!hasPreviousPage || loading} onClick={() => onPageChange(Math.max(0, offset - PAGE_SIZE))} className="inline-flex items-center gap-1 rounded-lg border border-[#DDD6FE] bg-white px-3 py-1.5 font-semibold text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Previous</button><button type="button" disabled={!hasNextPage || loading} onClick={() => onPageChange(offset + PAGE_SIZE)} className="inline-flex items-center gap-1 rounded-lg border border-[#DDD6FE] bg-white px-3 py-1.5 font-semibold text-[#5B21B6] hover:bg-[#F1ECFE] disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" /></button></div> : null}</footer>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="space-y-1.5"><span className="block text-[10px] font-bold uppercase tracking-[.08em] text-[#6B7488]">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] px-3 py-2.5 text-xs text-[#0E1726] outline-none focus:border-[#6D28D9] focus:bg-white focus:ring-2 focus:ring-[#6D28D9]/10">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function TextFilterField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="space-y-1.5"><span className="block text-[10px] font-bold uppercase tracking-[.08em] text-[#6B7488]">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] px-3 py-2.5 text-xs text-[#0E1726] outline-none placeholder:text-[#8A93A5] focus:border-[#6D28D9] focus:bg-white focus:ring-2 focus:ring-[#6D28D9]/10" /></label>;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1.5"><span className="block text-[10px] font-bold uppercase tracking-[.08em] text-[#6B7488]">{label}</span><span className="relative block"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A93A5]" /><input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] py-2.5 pl-9 pr-3 text-xs text-[#0E1726] outline-none focus:border-[#6D28D9] focus:bg-white focus:ring-2 focus:ring-[#6D28D9]/10" /></span></label>;
}

function FilterChip({ label }: { label: string }) {
  return <span className="rounded-full border border-[#DDD6FE] bg-[#FAF8FF] px-2.5 py-1 text-[10px] font-semibold text-[#5B21B6]">{label}</span>;
}

function EmptyRow({ colSpan, title, detail, showClear, onClear, icon: Icon = FileCheck2 }: { colSpan: number; title: string; detail: string; showClear: boolean; onClear: () => void; icon?: React.ComponentType<{ className?: string }> }) {
  return <tr><td colSpan={colSpan} className="px-5 py-16 text-center"><Icon className="mx-auto h-8 w-8 text-[#A78BFA]" /><p className="mt-3 text-sm font-bold text-[#0E1726]">{title}</p><p className="mt-1 text-xs text-[#6B7488]">{detail}</p>{showClear ? <button type="button" onClick={onClear} className="mt-4 rounded-lg border border-[#DDD6FE] px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#FAF8FF]">Clear search</button> : null}</td></tr>;
}

function EvidenceSummary({ icon: Icon, label, value, detail, verified = false, warning = false }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail: string; verified?: boolean; warning?: boolean }) {
  const valueTone = verified ? "text-emerald-700" : warning ? "text-red-700" : "text-[#0E1726]";
  return <div className="flex items-start gap-3 px-5 py-4"><div className="mt-0.5 rounded-lg bg-[#F1ECFE] p-2 text-[#6D28D9]"><Icon className="h-4 w-4" /></div><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488]">{label}</p><p className={`mt-1 text-base font-bold ${valueTone}`}>{value}</p><p className="mt-0.5 text-[11px] text-[#8A93A5]">{detail}</p></div></div>;
}

function IntegrityStatus({ value }: { value?: boolean | null }) {
  if (value === true) return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Verified</span>;
  if (value === false) return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-700"><AlertCircle className="h-3.5 w-3.5" />Needs review</span>;
  return <span className="text-[11px] text-[#8A93A5]">Not checked</span>;
}

function OutcomeStatus({ trace }: { trace: AgentTrace }) {
  const kind = traceOutcomeKind(trace);
  const label = trace.outcome === "Not recorded" ? (kind === "failed" ? "Failed" : "Incomplete") : displayAction(trace.outcome);
  if (kind === "failed") return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-700"><CircleX className="h-3.5 w-3.5" />{label}</span>;
  if (kind === "completed") return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{label}</span>;
  return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#475069]"><RefreshCw className="h-3.5 w-3.5" />{label}</span>;
}

function EvidenceDetail({ event, copiedField, onClose, onCopy, onViewRelated }: { event: AuditEvent; copiedField: string | null; onClose: () => void; onCopy: (field: string, value?: string | null) => void; onViewRelated: (correlationId?: string | null) => void }) {
  const actor = actorPresentation(event);
  const target = targetPresentation(event);
  const relatedEvidence = Array.isArray(event.evidence_references) ? event.evidence_references.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
  return (
    <div className="space-y-4">
      <BackToListButton label="Back to Audit Trail" onClick={onClose} />
      <article className="overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-sm shadow-[#6D28D9]/5">
        <DetailPageHeading eyebrow="Audit evidence record" title={displayAction(event.action)} meta={event.timestamp ? formatDateTime(event.timestamp) : "Time not recorded"}>
          <IntegrityStatus value={event.chain_valid} />
        </DetailPageHeading>
        <section className="grid border-b border-[#E6E9F0] bg-[#FCFAFF] md:grid-cols-2 md:divide-x md:divide-[#E6E9F0] xl:grid-cols-4">
          <DetailSummary label="Actor" value={actor.primary} detail={actor.secondary} copyValue={event.actor_id} copyLabel="Copy actor ID" copied={copiedField === "actor"} onCopy={() => onCopy("actor", event.actor_id)} />
          <DetailSummary label="Target" value={target.primary} detail={target.secondary} />
          <DetailSummary label="Event reference" value={event.record_id || "Not recorded"} detail="Identifies this individual audit event" mono copyValue={event.record_id} copyLabel="Copy event reference" copied={copiedField === "event-reference"} onCopy={() => onCopy("event-reference", event.record_id)} />
          <DetailSummary label="Workflow reference" value={event.request_id || "Not recorded"} detail="Connects related workflow events" mono copyValue={event.request_id} copyLabel="Copy workflow reference" copied={copiedField === "workflow-reference"} onCopy={() => onCopy("workflow-reference", event.request_id)} actionLabel="View workflow events" onAction={() => onViewRelated(event.request_id)} />
        </section>
        <div className="grid divide-y divide-[#EEF1F5] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <InspectorSection icon={FileCheck2} title="Reason & context">
            <p className="text-sm leading-6 text-[#475069]">{event.reason || "No reason was recorded for this event."}</p>
            <dl className="mt-4 grid grid-cols-[100px_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs"><DetailRow label="Actor role" value={event.actor_role ? displayIdentifier(event.actor_role) : "Not recorded"} /><DetailRow label="Actor ID" value={event.actor_id || "Not recorded"} mono /><DetailRow label="Context" value={event.context_id || "Not recorded"} mono /><DetailRow label="Tenant" value={event.tenant_id || "Not recorded"} mono /><DetailRow label="Target" value={targetLabel(event)} mono /></dl>
          </InspectorSection>
          <InspectorSection icon={ShieldCheck} title="Policy & approval"><dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs"><DetailRow label="Policy" value={event.policy_id || "Not recorded"} mono /><DetailRow label="Decision" value={event.policy_decision ? displayIdentifier(event.policy_decision) : "Not recorded"} /><DetailRow label="Approval" value={event.approval_id || "Not recorded"} mono /><DetailRow label="Status" value={event.approval_status || "Not recorded"} /><DetailRow label="Response" value={event.response_status ? String(event.response_status) : "Not recorded"} /></dl></InspectorSection>
        </div>
        {relatedEvidence.length > 0 ? <section className="border-t border-[#E6E9F0] px-6 py-5"><EvidenceReferenceList items={relatedEvidence} copiedField={copiedField} onCopy={onCopy} onFind={onViewRelated} /></section> : null}
        <section className="border-t border-[#E6E9F0] px-6 py-5"><div className="mb-4 flex items-center gap-2"><GitBranch className="h-4 w-4 text-[#6D28D9]" /><h3 className="text-sm font-bold text-[#0E1726]">Before and after</h3></div><div className="grid gap-4 lg:grid-cols-2"><SummaryBlock label="Before" value={displaySummary(event.before_summary)} /><SummaryBlock label="After" value={displaySummary(event.after_summary)} /></div></section>
        <section className="border-t border-[#E6E9F0] px-6 py-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Hash className="h-4 w-4 text-[#6D28D9]" /><h3 className="text-sm font-bold text-[#0E1726]">Hash-chain evidence</h3></div><IntegrityStatus value={event.chain_valid} /></div><div className="grid gap-4 lg:grid-cols-2"><TechnicalValue label="Record hash" value={event.integrity_hash || "Hash not recorded"} /><TechnicalValue label="Previous hash" value={event.prior_hash || "Not recorded"} /></div></section>
      </article>
    </div>
  );
}

function TraceDetail({ trace, copiedField, onClose, onCopy, onViewRelated }: { trace: AgentTrace; copiedField: string | null; onClose: () => void; onCopy: (field: string, value?: string | null) => void; onViewRelated: (correlationId?: string | null) => void }) {
  const approvalEvidence = trace.approvals.length ? trace.approvals : trace.event.approval_id ? [trace.event.approval_id] : [];
  const actor = actorPresentation(trace.event);
  const outcomeKind = traceOutcomeKind(trace);
  const outcomeLabel = trace.outcome === "Not recorded" ? (outcomeKind === "open" ? "Incomplete" : displayAction(outcomeKind)) : displayAction(trace.outcome);
  const approvalStatus = trace.event.approval_status
    ? displayAction(trace.event.approval_status)
    : approvalEvidence.length > 0
      ? "Evidence recorded"
      : "Not recorded";
  const reason = trace.event.reason && trace.event.reason !== trace.goal
    ? trace.event.reason
    : "No separate reason was recorded for this action.";
  const modelRecorded = trace.model !== "Not recorded";

  return <div className="space-y-4"><BackToListButton label="Back to Agent Traces" onClick={onClose} /><article className="overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-sm shadow-[#6D28D9]/5"><DetailPageHeading eyebrow="Agent execution trace" title={trace.goal} meta={trace.event.timestamp ? formatDateTime(trace.event.timestamp) : "Time not recorded"}><OutcomeStatus trace={trace} /></DetailPageHeading><section className="border-y border-[#E6E9F0] bg-[#FCFAFF]" aria-labelledby="trace-audit-summary"><div className="px-6 pt-5"><h3 id="trace-audit-summary" className="text-sm font-bold text-[#0E1726]">Audit summary</h3><p className="mt-1 text-xs text-[#6B7488]">The key facts needed to review this agent action.</p></div><div className="mt-4 grid divide-y divide-[#E6E9F0] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4"><TraceSummaryFact icon={Bot} label="Performed by" value={actor.primary} detail={actor.secondary} /><TraceSummaryFact icon={CheckCircle2} label="Outcome" value={outcomeLabel} detail={outcomeKind === "completed" ? "Execution completed successfully" : outcomeKind === "failed" ? "Execution recorded a failure" : "Execution has not completed"} tone={outcomeKind === "completed" ? "success" : outcomeKind === "failed" ? "danger" : "neutral"} /><TraceSummaryFact icon={ShieldCheck} label="Integrity" value={trace.event.chain_valid === true ? "Verified" : trace.event.chain_valid === false ? "Needs review" : "Not checked"} detail={trace.event.chain_valid === true ? "Evidence chain is valid" : trace.event.chain_valid === false ? "Evidence chain requires attention" : "Integrity was not checked for this result"} tone={trace.event.chain_valid === true ? "success" : trace.event.chain_valid === false ? "danger" : "neutral"} /><TraceSummaryFact icon={FileCheck2} label="Approval status" value={approvalStatus} detail={approvalEvidence.length > 0 ? `${approvalEvidence.length} approval reference${approvalEvidence.length === 1 ? "" : "s"} attached` : "No approval evidence is attached"} tone={approvalEvidence.length > 0 ? "success" : "neutral"} /></div></section><section className="px-6 py-6" aria-labelledby="decision-review"><div className="mb-4"><h3 id="decision-review" className="text-sm font-bold text-[#0E1726]">Decision review</h3><p className="mt-1 text-xs text-[#6B7488]">Read the action as an audit decision before opening its technical record.</p></div><div className="grid gap-3 lg:grid-cols-3"><AuditQuestion icon={Bot} title="What happened" text={trace.goal} /><AuditQuestion icon={FileCheck2} title="Why it happened" text={reason} /><AuditQuestion icon={CheckCircle2} title="Outcome" text={trace.outcome === "Not recorded" ? "No outcome was recorded for this action." : displayAction(trace.outcome)} tone={outcomeKind === "failed" ? "danger" : outcomeKind === "completed" ? "success" : "neutral"} /></div></section><section className="border-t border-[#E6E9F0] px-6 py-6" aria-labelledby="trace-evidence"><div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h3 id="trace-evidence" className="text-sm font-bold text-[#0E1726]">Evidence and approvals</h3><p className="mt-1 text-xs text-[#6B7488]">Open the supporting audit records without changing operational data.</p></div>{trace.event.request_id ? <button type="button" onClick={() => onViewRelated(trace.event.request_id)} className="mt-2 inline-flex items-center gap-1.5 self-start rounded-lg bg-[#F1ECFE] px-3 py-2 text-xs font-semibold text-[#5B21B6] hover:bg-[#E9E1FD] sm:mt-0"><ListFilter className="h-3.5 w-3.5" />View workflow events</button> : null}</div><div className="grid overflow-hidden rounded-xl border border-[#E6E9F0] divide-y divide-[#E6E9F0] lg:grid-cols-3 lg:divide-x lg:divide-y-0"><EvidenceReferenceList items={trace.evidenceReferences} copiedField={copiedField} onCopy={onCopy} onFind={onViewRelated} /><InspectorList icon={Wrench} title="Tools used" items={trace.tools.map(displayIdentifier)} empty="No tools were recorded for this action" /><ApprovalReferenceList items={approvalEvidence} copiedField={copiedField} status={approvalStatus} onCopy={onCopy} onFind={onViewRelated} /></div></section>{trace.failures.length > 0 ? <section className="border-t border-red-100 bg-red-50/40 px-6 py-5"><InspectorList icon={AlertCircle} title="Failure details" items={trace.failures} empty="" danger /></section> : null}<details className="group border-t border-[#E6E9F0]"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-sm font-bold text-[#0E1726] hover:bg-[#FAF8FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6D28D9]/30"><span className="flex items-center gap-2"><Cpu className="h-4 w-4 text-[#6D28D9]" />Technical details for investigation</span><span className="flex items-center gap-2 text-xs font-semibold text-[#6B7488]">References and recorded model data<ChevronDown className="h-4 w-4 transition group-open:rotate-180" /></span></summary><div className="border-t border-[#E6E9F0] bg-[#FCFAFF] px-6 py-6"><p className="mb-4 text-xs leading-5 text-[#6B7488]">Use these references to match this agent run with signed exports, related audit events, or an engineering investigation.</p><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><TechnicalIdentifier label="Actor ID" value={trace.event.actor_id || "Not recorded"} detail="Matches this action to the immutable actor record." copyLabel="Copy actor ID" copied={copiedField === "trace-actor"} onCopy={() => onCopy("trace-actor", trace.event.actor_id)} /><TechnicalIdentifier label="Agent run reference" value={trace.id} detail="Identifies this exact execution in an evidence export." copyLabel="Copy agent run reference" copied={copiedField === "trace"} onCopy={() => onCopy("trace", trace.id)} /><TechnicalIdentifier label="Workflow reference" value={trace.event.request_id || "Not recorded"} detail="Connects actions from the same workflow." copyLabel="Copy workflow reference" copied={copiedField === "trace-correlation"} onCopy={() => onCopy("trace-correlation", trace.event.request_id)} actionLabel="View workflow events" onAction={() => onViewRelated(trace.event.request_id)} /></div>{modelRecorded ? <dl className="mt-5 grid gap-4 rounded-xl border border-[#E6E9F0] bg-white p-4 sm:grid-cols-3"><TechnicalDatum label="Model" value={displayIdentifier(trace.model)} /><TechnicalDatum label="Version" value={trace.version || "Not recorded"} /><TechnicalDatum label="Cost" value={trace.cost} /></dl> : null}</div></details></article></div>;
}

function TraceSummaryFact({ icon: Icon, label, value, detail, tone = "neutral" }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail: string; tone?: "neutral" | "success" | "danger" }) {
  const toneClass = tone === "success" ? "text-emerald-700" : tone === "danger" ? "text-red-700" : "text-[#0E1726]";
  return <div className="flex min-w-0 items-start gap-3 px-6 py-4"><span className="rounded-lg bg-white p-2 text-[#6D28D9] shadow-sm"><Icon className="h-4 w-4" /></span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488]">{label}</p><p className={`mt-1 break-words text-sm font-bold ${toneClass}`}>{value}</p><p className="mt-1 text-[11px] leading-4 text-[#8A93A5]">{detail}</p></div></div>;
}

function AuditQuestion({ icon: Icon, title, text, tone = "neutral" }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; tone?: "neutral" | "success" | "danger" }) {
  const iconClass = tone === "success" ? "text-emerald-700" : tone === "danger" ? "text-red-700" : "text-[#6D28D9]";
  return <div className="rounded-xl border border-[#E6E9F0] bg-[#FAFBFC] p-4"><div className="flex items-center gap-2"><Icon className={`h-4 w-4 ${iconClass}`} /><h4 className="text-xs font-bold text-[#0E1726]">{title}</h4></div><p className="mt-3 text-sm leading-6 text-[#475069]">{text}</p></div>;
}

function EvidenceReferenceList({ items, copiedField, onCopy, onFind }: { items: string[]; copiedField: string | null; onCopy: (field: string, value?: string | null) => void; onFind: (reference?: string | null) => void }) {
  return <InspectorSection icon={Link2} title="Evidence references">{items.length ? <ol className="space-y-3">{items.map((item, index) => { const field = `evidence-${index}`; return <li key={`${item}-${index}`} className="rounded-lg border border-[#E6E9F0] bg-[#FAFBFC] p-3"><p className="text-[10px] font-bold uppercase tracking-[.06em] text-[#8A93A5]">Supporting record {index + 1}</p><p className="mt-1 font-mono text-[11px] text-[#475069]" title={item}>{shorten(item, 12, 6)}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onFind(item)} className="inline-flex items-center gap-1.5 rounded-md bg-[#F1ECFE] px-2.5 py-1.5 text-[10px] font-semibold text-[#5B21B6] hover:bg-[#E9E1FD]"><Search className="h-3 w-3" />Find in audit trail</button><button type="button" onClick={() => onCopy(field, item)} className="inline-flex items-center gap-1.5 rounded-md border border-[#DDD6FE] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]" aria-label={`Copy evidence reference ${index + 1}`}>{copiedField === field ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copiedField === field ? "Copied" : "Copy reference"}</button></div></li>; })}</ol> : <p className="text-xs leading-5 text-[#8A93A5]">No supporting evidence references are attached to this trace.</p>}</InspectorSection>;
}

function ApprovalReferenceList({ items, copiedField, status, onCopy, onFind }: { items: string[]; copiedField: string | null; status: string; onCopy: (field: string, value?: string | null) => void; onFind: (reference?: string | null) => void }) {
  return <InspectorSection icon={ShieldCheck} title="Approval evidence"><p className="mb-3 text-xs font-semibold text-[#475069]">Status: {status}</p>{items.length ? <ol className="space-y-3">{items.map((item, index) => { const field = `approval-${index}`; return <li key={`${item}-${index}`} className="rounded-lg border border-[#E6E9F0] bg-[#FAFBFC] p-3"><p className="text-[10px] font-bold uppercase tracking-[.06em] text-[#8A93A5]">Approval reference {index + 1}</p><p className="mt-1 font-mono text-[11px] text-[#475069]" title={item}>{shorten(item, 12, 6)}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onFind(item)} className="inline-flex items-center gap-1.5 rounded-md bg-[#F1ECFE] px-2.5 py-1.5 text-[10px] font-semibold text-[#5B21B6] hover:bg-[#E9E1FD]"><Search className="h-3 w-3" />Find in audit trail</button><button type="button" onClick={() => onCopy(field, item)} className="inline-flex items-center gap-1.5 rounded-md border border-[#DDD6FE] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]" aria-label={`Copy approval reference ${index + 1}`}>{copiedField === field ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copiedField === field ? "Copied" : "Copy reference"}</button></div></li>; })}</ol> : <p className="text-xs leading-5 text-[#8A93A5]">No approval evidence is attached. The interface does not assume whether approval was required.</p>}</InspectorSection>;
}

function TechnicalIdentifier({ label, value, detail, copyLabel, copied, onCopy, actionLabel, onAction }: { label: string; value: string; detail: string; copyLabel: string; copied: boolean; onCopy: () => void; actionLabel?: string; onAction?: () => void }) {
  return <div className="rounded-xl border border-[#E6E9F0] bg-white p-4"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#6B7488]">{label}</p><p className="mt-2 break-all font-mono text-[11px] leading-5 text-[#475069]">{value}</p><p className="mt-2 text-[11px] leading-4 text-[#8A93A5]">{detail}</p>{value !== "Not recorded" ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onCopy} className="inline-flex items-center gap-1.5 rounded-md border border-[#DDD6FE] px-2.5 py-1.5 text-[10px] font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]" aria-label={copyLabel}>{copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "Copied" : copyLabel}</button>{actionLabel && onAction ? <button type="button" onClick={onAction} className="inline-flex items-center gap-1.5 rounded-md bg-[#F1ECFE] px-2.5 py-1.5 text-[10px] font-semibold text-[#5B21B6] hover:bg-[#E9E1FD]"><ListFilter className="h-3 w-3" />{actionLabel}</button> : null}</div> : null}</div>;
}

function TechnicalDatum({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] font-bold uppercase tracking-[.08em] text-[#6B7488]">{label}</dt><dd className="mt-1 break-words text-xs font-semibold text-[#475069]">{value}</dd></div>;
}

function BackToListButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-lg border border-[#DDD6FE] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#5B21B6] shadow-sm transition hover:bg-[#F1ECFE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]/30"><ArrowLeft className="h-4 w-4" />{label}</button>;
}

function DetailLoading({ onBack }: { onBack: () => void }) {
  return <div className="space-y-4"><BackToListButton label="Back to Audit Trail" onClick={onBack} /><section className="overflow-hidden rounded-2xl border border-[#DDD6FE] bg-white shadow-sm" aria-label="Loading audit event"><div className="space-y-4 p-6"><div className="h-4 w-36 animate-pulse rounded bg-[#F1ECFE]" /><div className="h-8 w-2/3 animate-pulse rounded bg-[#EEF1F5]" /><div className="grid gap-3 pt-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-[#F5F7FA]" />)}</div></div></section></div>;
}

function DetailFailure({ message, onBack, onRetry }: { message: string; onBack: () => void; onRetry: () => void }) {
  return <div className="space-y-4"><BackToListButton label="Back to Audit Trail" onClick={onBack} /><ErrorNotice message={message} onRetry={onRetry} /></div>;
}

function DetailPageHeading({ eyebrow, title, meta, children }: { eyebrow: string; title: string; meta: string; children: React.ReactNode }) {
  return <header className="flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-[#6D28D9]">{eyebrow}</p><h2 className="mt-2 max-w-4xl text-2xl font-extrabold leading-tight text-[#0E1726]">{title}</h2><p className="mt-2 text-xs text-[#8A93A5]">{meta}</p></div><div className="shrink-0 rounded-full border border-[#E6E9F0] bg-[#FAFBFC] px-3 py-2">{children}</div></header>;
}

function DetailSummary({ label, value, detail, mono = false, copyValue, copyLabel, copied = false, onCopy, actionLabel, onAction }: { label: string; value: string; detail: string; mono?: boolean; copyValue?: string | null; copyLabel?: string; copied?: boolean; onCopy?: () => void; actionLabel?: string; onAction?: () => void }) {
  return <div className="min-w-0 px-6 py-4"><p className="text-[10px] font-bold uppercase tracking-[.09em] text-[#6B7488]">{label}</p><p className={`mt-1 break-all text-sm font-bold text-[#0E1726] ${mono ? "font-mono text-xs" : ""}`}>{value}</p><p className="mt-1 break-all text-[11px] text-[#8A93A5]">{detail}</p>{copyValue || actionLabel ? <div className="mt-3 flex flex-wrap gap-2">{copyValue && onCopy ? <button type="button" onClick={onCopy} className="inline-flex items-center gap-1.5 rounded-md border border-[#DDD6FE] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#5B21B6] hover:bg-[#F1ECFE]" aria-label={copyLabel}>{copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "Copied" : copyLabel}</button> : null}{actionLabel && onAction ? <button type="button" onClick={onAction} className="inline-flex items-center gap-1.5 rounded-md bg-[#F1ECFE] px-2.5 py-1.5 text-[10px] font-semibold text-[#5B21B6] hover:bg-[#E9E1FD]"><ListFilter className="h-3 w-3" />{actionLabel}</button> : null}</div> : null}</div>;
}

function TechnicalValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[#E6E9F0] bg-[#FAFBFC] p-4"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#6B7488]">{label}</p><p className="mt-2 break-all font-mono text-[11px] leading-5 text-[#475069]">{value}</p></div>;
}

function InspectorSection({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return <section className="px-5 py-4"><div className="mb-3 flex items-center gap-2"><Icon className="h-4 w-4 text-[#6D28D9]" /><h3 className="text-xs font-bold text-[#0E1726]">{title}</h3></div>{children}</section>;
}

function InspectorList({ icon, title, items, empty, danger = false }: { icon: React.ComponentType<{ className?: string }>; title: string; items: string[]; empty: string; danger?: boolean }) {
  return <InspectorSection icon={icon} title={title}>{items.length ? <ul className="space-y-2">{items.map((item, index) => <li key={`${item}-${index}`} className={`text-xs leading-5 ${danger ? "text-red-700" : "text-[#475069]"}`}>{item}</li>)}</ul> : <p className="text-xs text-[#8A93A5]">{empty}</p>}</InspectorSection>;
}

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[#E6E9F0] bg-[#FAFBFC] p-3"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-[#6B7488]">{label}</p><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[#475069]">{value}</pre></div>;
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <><dt className="text-[#8A93A5]">{label}</dt><dd className={`min-w-0 break-all font-semibold text-[#475069] ${mono ? "font-mono text-[10px]" : ""}`}>{value}</dd></>;
}
