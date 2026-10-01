"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Clock,
  Filter,
  LifeBuoy,
  Plus,
  RefreshCw,
  Search,
  Ticket as TicketIcon,
  ChevronRight,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";
import { Incident } from "@/lib/itsm-types";
import IncidentPriorityBadge from "@/components/itsm/incident-priority-badge";
import IncidentStatusBadge from "@/components/itsm/incident-status-badge";

type FilterStatus = "ALL" | "OPEN" | "IN_PROGRESS" | "PENDING" | "RESOLVED" | "CLOSED";

export default function IncidentListPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<FilterStatus>("ALL");

  const fetchIncidents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      params.set("limit", "100");

      const [incRes, reqRes] = await Promise.all([
        fetch(`/api/itsm/incidents?${params.toString()}`),
        fetch(`/api/itsm/requests?${params.toString()}`).catch(() => null),
      ]);
      if (incRes.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (!incRes.ok) {
        const data = await incRes.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to load tickets");
      }

      const incData = await incRes.json();
      let allTickets: Incident[] = Array.isArray(incData) ? incData : [];

      if (reqRes && reqRes.ok) {
        const reqData = await reqRes.json().catch(() => []);
        if (Array.isArray(reqData)) {
          allTickets = [...allTickets, ...reqData];
        }
      }

      allTickets.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setIncidents(allTickets);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const request = window.setTimeout(() => void fetchIncidents(), 0);
    return () => window.clearTimeout(request);
  }, [fetchIncidents]);

  const filteredIncidents = incidents.filter((inc) => {
    if (activeFilter === "ALL") return true;
    if (activeFilter === "OPEN") {
      return inc.status === "NEW" || inc.status === "ASSIGNED";
    }
    if (activeFilter === "IN_PROGRESS") return inc.status === "IN_PROGRESS";
    if (activeFilter === "PENDING") return inc.status === "PENDING";
    if (activeFilter === "RESOLVED") return inc.status === "RESOLVED";
    if (activeFilter === "CLOSED") return inc.status === "CLOSED" || inc.status === "CANCELLED";
    return true;
  });

  const filterTabs: { label: string; key: FilterStatus; count?: number }[] = [
    { label: "All Tickets", key: "ALL", count: incidents.length },
    {
      label: "Open",
      key: "OPEN",
      count: incidents.filter((i) => i.status === "NEW" || i.status === "ASSIGNED").length,
    },
    {
      label: "In Progress",
      key: "IN_PROGRESS",
      count: incidents.filter((i) => i.status === "IN_PROGRESS").length,
    },
    {
      label: "Pending",
      key: "PENDING",
      count: incidents.filter((i) => i.status === "PENDING").length,
    },
    {
      label: "Resolved",
      key: "RESOLVED",
      count: incidents.filter((i) => i.status === "RESOLVED").length,
    },
    {
      label: "Closed",
      key: "CLOSED",
      count: incidents.filter((i) => i.status === "CLOSED" || i.status === "CANCELLED").length,
    },
  ];

  const getTicketHref = (ticket: Incident) => {
    return ticket.ticket_type === "SERVICE_REQUEST" || ticket.ticket_number?.startsWith("REQ-")
      ? `/itsm/requests/${ticket.id}`
      : `/itsm/incidents/${ticket.id}`;
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#F3E8FF] text-[#6D28D9] flex items-center justify-center shrink-0">
            <TicketIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-[#0E1726] tracking-tight">My Tickets</h1>
            <p className="text-xs text-[#6B7488] mt-1">
              View and track all IT requests, incidents, and issues submitted by you.
            </p>
          </div>
        </div>

        <Link
          href="/itsm/incidents/new"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          Report an Issue
        </Link>
      </div>

      {/* Filters & Search Controls */}
      <div className="bg-white rounded-[16px] border border-[#E6E9F0] p-4 shadow-sm space-y-4">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-[#F0F2F6]">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 flex items-center gap-1.5 ${
                activeFilter === tab.key
                  ? "bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]"
                  : "text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA]"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.2 text-[10px] rounded-full font-mono ${
                  activeFilter === tab.key ? "bg-[#6D28D9] text-white" : "bg-[#E6E9F0] text-[#6B7488]"
                }`}
              >
                {tab.count ?? 0}
              </span>
            </button>
          ))}
        </div>

        {/* Search Input & Refresh */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by ticket # or title..."
              className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl pl-9 pr-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
          </div>

          <button
            onClick={fetchIncidents}
            className="p-2 text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-xl border border-[#E6E9F0] transition"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {/* Tickets List Table */}
      <div className="bg-white rounded-[20px] border border-[#E6E9F0] shadow-sm overflow-hidden">
        {loading && incidents.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#6B7488]">Loading your tickets...</div>
        ) : filteredIncidents.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#F5F7FA] text-[#6B7488] flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-[#0E1726]">No tickets found</h3>
            <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
              {search
                ? "No tickets match your search criteria."
                : "You currently have no tickets matching the selected filter."}
            </p>
            <div className="pt-2">
              <Link
                href="/itsm/incidents/new"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Report an Issue
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#F0F2F6] text-[#8C95A8] font-bold uppercase tracking-wider bg-[#FBFAF9]">
                  <th className="py-3.5 px-4">Ticket ID</th>
                  <th className="py-3.5 px-4">Title / Problem</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Priority</th>
                  <th className="py-3.5 px-4">Created</th>
                  <th className="py-3.5 px-4">Updated</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F2F6]">
                {filteredIncidents.map((incident) => (
                  <tr key={incident.id} className="hover:bg-[#FBFAF9] transition">
                    <td className="py-3.5 px-4 font-mono font-bold text-[#6D28D9]">
                      <Link href={getTicketHref(incident)} className="hover:underline">
                        {incident.ticket_number}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-[#0E1726] max-w-[240px] truncate">
                      <Link href={getTicketHref(incident)} className="hover:text-[#6D28D9]">
                        {incident.title}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 text-[#6B7488]">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-[#475069] text-[11px] font-semibold">
                        {incident.ticket_type || "Incident"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <IncidentStatusBadge status={incident.status} />
                    </td>
                    <td className="py-3.5 px-4">
                      <IncidentPriorityBadge priority={incident.priority} />
                    </td>
                    <td className="py-3.5 px-4 text-[#6B7488] whitespace-nowrap">
                      {formatDateTime(incident.created_at)}
                    </td>
                    <td className="py-3.5 px-4 text-[#6B7488] whitespace-nowrap">
                      {formatDateTime(incident.updated_at || incident.created_at)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        href={getTicketHref(incident)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] bg-[#F1ECFE] hover:bg-[#E9D8FD] px-3 py-1 rounded-lg transition"
                      >
                        <span>View Details</span>
                        <ChevronRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
