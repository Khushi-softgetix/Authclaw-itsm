"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  Clock,
  Filter,
  RefreshCw,
  Ticket,
  TriangleAlert,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";

interface NotificationItem {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export default function RequesterNotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/notifications?limit=50", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load notifications");
      }
      const data = await res.json();
      const items: NotificationItem[] = data.items || [];
      // Filter out Governance Layer events to ensure strict ITSM Requester scope
      const requesterSafeItems = items.filter((item) => {
        const typeLower = (item.type || "").toLowerCase();
        const linkLower = (item.link || "").toLowerCase();
        const isGovernance =
          typeLower.includes("governance") ||
          typeLower.includes("compliance") ||
          typeLower.includes("audit") ||
          typeLower.includes("remediation") ||
          typeLower.includes("approval") ||
          typeLower.includes("trust_center") ||
          linkLower.startsWith("/compliance") ||
          linkLower.startsWith("/approvals") ||
          linkLower.startsWith("/audit");
        return !isGovernance;
      });
      setNotifications(requesterSafeItems);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read_at: new Date().toISOString() } : item))
    );
    await fetch(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => undefined);
  };

  const markAllRead = async () => {
    setNotifications((prev) =>
      prev.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() }))
    );
    await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => undefined);
  };

  const displayedNotifications = notifications.filter((item) => {
    if (filter === "unread") return !item.read_at;
    return true;
  });

  const unreadCount = notifications.filter((i) => !i.read_at).length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#F3E8FF] text-[#6D28D9] flex items-center justify-center shrink-0">
            <Bell className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-[#0E1726] tracking-tight">
              Requester Notifications
            </h1>
            <p className="text-xs text-[#6B7488] mt-1">
              Ticket updates, comments, and status notifications related to your IT requests.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs font-bold text-[#475069] hover:bg-[#F5F7FA] disabled:opacity-40 transition"
          >
            <CheckCheck className="w-4 h-4" />
            Mark All Read
          </button>
          <button
            onClick={fetchNotifications}
            className="p-2 text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-xl border border-[#E6E9F0] transition"
            title="Refresh notifications"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white rounded-[16px] border border-[#E6E9F0] p-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              filter === "all"
                ? "bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]"
                : "text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA]"
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              filter === "unread"
                ? "bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]"
                : "text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA]"
            }`}
          >
            Unread ({unreadCount})
          </button>
        </div>

        <div className="text-xs text-[#6B7488]">
          <span>Scope: </span>
          <span className="font-semibold text-[#0E1726]">My ITSM Tickets Only</span>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {/* Notification List */}
      <div className="space-y-3">
        {loading && notifications.length === 0 ? (
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-12 text-center text-xs text-[#6B7488]">
            Loading notifications...
          </div>
        ) : displayedNotifications.length === 0 ? (
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#F5F7FA] text-[#6B7488] flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <h3 className="text-sm font-bold text-[#0E1726]">No notifications</h3>
            <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
              {filter === "unread"
                ? "You have no unread ITSM notifications."
                : "No ticket updates or notifications to display at this time."}
            </p>
          </div>
        ) : (
          displayedNotifications.map((item) => {
            const isUnread = !item.read_at;
            return (
              <div
                key={item.id}
                onClick={() => {
                  if (isUnread) markRead(item.id);
                }}
                className={`bg-white rounded-[16px] border p-4 shadow-sm transition flex items-start gap-4 ${
                  isUnread
                    ? "border-[#A78BFA] bg-purple-50/20"
                    : "border-[#E6E9F0] hover:border-[#CBD5E1]"
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isUnread ? "bg-[#F1ECFE] text-[#6D28D9]" : "bg-[#F5F7FA] text-[#6B7488]"
                  }`}
                >
                  <Ticket className="w-4.5 h-4.5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-bold text-[#0E1726] flex items-center gap-2">
                      <span>{item.title}</span>
                      {isUnread && (
                        <span className="w-2 h-2 rounded-full bg-[#6D28D9] shrink-0" />
                      )}
                    </h4>
                    <span className="text-[10px] text-[#6B7488] whitespace-nowrap">
                      {formatDateTime(item.created_at)}
                    </span>
                  </div>

                  {item.body && (
                    <p className="text-xs text-[#475069] mt-1 leading-relaxed">{item.body}</p>
                  )}

                  {item.link && (
                    <div className="mt-2.5">
                      <Link
                        href={item.link}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-[#6D28D9] hover:underline"
                      >
                        <span>View Ticket Details &rarr;</span>
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
