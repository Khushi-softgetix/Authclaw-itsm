"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Clock,
  Database,
  Layers,
  Server,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  Zap,
} from "lucide-react";

export default function AdminPortalPage() {
  const adminCards = [
    {
      title: "User Management",
      desc: "Manage ITSM users, product access permissions, and business roles.",
      href: "/itsm/admin-portal/users",
      actionText: "Manage Users",
      icon: Users,
      badge: "Active",
      iconBg: "bg-[#F1ECFE]",
      iconColor: "text-[#6D28D9]",
    },
    {
      title: "Teams & Groups",
      desc: "Configure operational teams, support groups, and member assignments.",
      href: "/itsm/admin-portal/teams",
      actionText: "Manage Teams",
      icon: UsersRound,
      badge: "Active",
      iconBg: "bg-[#EFF6FF]",
      iconColor: "text-[#1D4ED8]",
    },
    {
      title: "Services",
      desc: "Define business and technical services for incident and request categorization.",
      href: "/itsm/admin-portal/services",
      actionText: "Manage Services",
      icon: Server,
      badge: "Active",
      iconBg: "bg-[#ECFDF5]",
      iconColor: "text-[#059669]",
    },
    {
      title: "Configuration Items (CMDB)",
      desc: "Maintain the foundational inventory of infrastructure and application CIs.",
      href: "/itsm/admin-portal/configuration-items",
      actionText: "Manage CMDB",
      icon: Database,
      badge: "Active",
      iconBg: "bg-[#FFF7ED]",
      iconColor: "text-[#C2410C]",
    },
    {
      title: "Service Catalog",
      desc: "Manage requestable items, dynamic intake schemas, fulfillment groups, and delivery SLAs.",
      href: "/itsm/admin-portal/service-catalog",
      actionText: "Manage Catalog",
      icon: Layers,
      badge: "Active",
      iconBg: "bg-[#EEF2FF]",
      iconColor: "text-[#4F46E5]",
    },
    {
      title: "SLA Configuration",
      desc: "Configure response/resolution SLA policies per priority and operational business calendars.",
      href: "/itsm/admin-portal/sla",
      actionText: "Manage SLAs",
      icon: Clock,
      badge: "Active",
      iconBg: "bg-[#FEF2F2]",
      iconColor: "text-[#DC2626]",
    },
    {
      title: "Macros & Templates",
      desc: "Configure 1-click productivity macros, canned responses, status transitions, and follow-up reminders.",
      href: "/itsm/admin-portal/macros",
      actionText: "Manage Macros",
      icon: Zap,
      badge: "Active",
      iconBg: "bg-[#FEF3C7]",
      iconColor: "text-[#D97706]",
    },
    {
      title: "Platform Settings",
      desc: "Review active tenant architecture, in-app notification infrastructure, and operational policy defaults.",
      href: "/itsm/admin-portal/settings",
      actionText: "Manage Settings",
      icon: Settings,
      badge: "Active",
      iconBg: "bg-[#F3F4F6]",
      iconColor: "text-[#4B5563]",
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-[#6B7488] mb-1">
          <span>AuthClaw ITSM</span>
          <span>/</span>
          <span className="text-[#0E1726] font-medium">Platform Administration</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#F1ECFE] border border-[#DDD6FE] flex items-center justify-center text-[#6D28D9]">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#0E1726]">Platform Administration</h1>
            <p className="text-xs text-[#6B7488]">
              Configure ITSM organizational structures, services, CMDB items, and user access.
            </p>
          </div>
        </div>
      </div>

      {/* Admin Modules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {adminCards.map((card) => (
          <div
            key={card.title}
            className="p-6 rounded-[20px] border border-[#E6E9F0] bg-white shadow-[0_1px_2px_rgba(11,31,63,.05)] flex flex-col justify-between hover:border-[#DDD6FE] hover:shadow-[0_8px_24px_-8px_rgba(109,40,217,.12)] transition-all duration-200"
          >
            <div>
              <div className="flex items-start justify-between">
                <div
                  className={`w-11 h-11 rounded-xl ${card.iconBg} ${card.iconColor} flex items-center justify-center`}
                >
                  <card.icon className="w-5 h-5" />
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                  {card.badge}
                </span>
              </div>

              <div className="mt-4">
                <h2 className="text-base font-semibold text-[#0E1726]">{card.title}</h2>
                <p className="text-xs text-[#475069] mt-1 line-clamp-2">{card.desc}</p>
              </div>
            </div>

            <div className="mt-6 pt-3.5 border-t border-[#F5F7FA] flex items-center justify-between">
              <Link
                href={card.href}
                className="group inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold shadow-[0_2px_8px_-2px_rgba(109,40,217,0.35)] hover:shadow-[0_4px_14px_-2px_rgba(109,40,217,0.5)] transition-all duration-150 active:scale-[0.98]"
                style={{ color: "#ffffff" }}
              >
                <span className="text-white font-semibold text-xs" style={{ color: "#ffffff" }}>
                  {card.actionText}
                </span>
                <ArrowRight
                  className="w-3.5 h-3.5 text-white transition-transform duration-150 group-hover:translate-x-0.5"
                  style={{ color: "#ffffff" }}
                />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
