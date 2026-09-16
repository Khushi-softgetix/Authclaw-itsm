"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, HelpCircle, LifeBuoy, Send } from "lucide-react";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";

const IMPACT_OPTIONS = [
  { value: "LOW", label: "Only me", desc: "Minimal impact, only affecting my individual workstation or account" },
  { value: "MEDIUM", label: "My team or department", desc: "Affecting several colleagues or a specific group" },
  { value: "HIGH", label: "Multiple departments", desc: "Affecting multiple teams across the business" },
  { value: "CRITICAL", label: "Entire organization", desc: "Major outage affecting all company operations" },
];

const URGENCY_OPTIONS = [
  { value: "HIGH", label: "High", desc: "Blocking critical work, work cannot proceed without a fix" },
  { value: "MEDIUM", label: "Medium", desc: "Impacting work, performance is slowed or partially disrupted" },
  { value: "LOW", label: "Low", desc: "Can work around it or minimal impact on current tasks" },
];

const CATEGORY_OPTIONS = [
  { value: "GENERAL", label: "General IT Support" },
  { value: "SOFTWARE", label: "Software & Applications" },
  { value: "HARDWARE", label: "Hardware & Devices" },
  { value: "NETWORK", label: "Network & VPN" },
  { value: "SECURITY", label: "Access & Password" },
];

interface CreatedIncidentSummary {
  id: string;
  ticket_number: string;
  title: string;
  status: string;
  created_at: string;
}

export default function CreateIncidentPage() {
  // Form State
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [impact, setImpact] = useState<string>("MEDIUM");
  const [urgency, setUrgency] = useState<string>("");
  const [category, setCategory] = useState<string>("GENERAL");

  // Submission State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [createdIncident, setCreatedIncident] = useState<CreatedIncidentSummary | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Please provide both a title and description for your issue.");
      return;
    }
    if (!urgency) {
      setError("Please select an Urgency level (High, Medium, or Low).");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        title: title.trim(),
        description: description.trim(),
        impact,
        urgency,
        category,
        source_channel: "PORTAL",
      };

      const res = await fetch("/api/itsm/incidents", jsonRequest("POST", payload));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, "Failed to submit issue"));
      }

      const data = await res.json();
      setCreatedIncident({
        id: data.id,
        ticket_number: data.ticket_number,
        title: data.title,
        status: data.status || "NEW",
        created_at: data.created_at || new Date().toISOString(),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit issue");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setImpact("MEDIUM");
    setUrgency("");
    setCategory("GENERAL");
    setError(null);
    setCreatedIncident(null);
  };

  // Render Success State after Incident Creation
  if (createdIncident) {
    return (
      <div className="max-w-2xl mx-auto py-8 space-y-6">
        <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-8 shadow-sm text-center space-y-6">
          <div className="w-16 h-16 bg-[#F3E8FF] rounded-full flex items-center justify-center mx-auto text-[#6D28D9]">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <span className="inline-block px-3 py-1 bg-[#F3E8FF] text-[#6D28D9] text-xs font-bold rounded-full uppercase tracking-wider">
              Submitted
            </span>
            <h1 className="text-2xl font-extrabold text-[#0E1726]">Incident Reported Successfully</h1>
            <p className="text-xs text-[#6B7488]">
              Your issue has been logged and assigned to the IT support team.
            </p>
          </div>

          {/* Ticket Details Card */}
          <div className="bg-[#FBFAF9] rounded-xl border border-[#E6E9F0] p-5 text-left space-y-3">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <span className="text-xs text-[#6B7488]">Incident Number</span>
              <span className="font-mono text-sm font-extrabold text-[#6D28D9] bg-[#F3E8FF] px-2.5 py-1 rounded-md">
                {createdIncident.ticket_number}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-[#6B7488] block">Problem Description</span>
              <p className="text-xs font-semibold text-[#0E1726] mt-0.5">{createdIncident.title}</p>
            </div>
            <div className="flex items-center justify-between pt-2 text-xs">
              <span className="text-[#6B7488]">Status</span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                {createdIncident.status}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href="/itsm/dashboard/requester"
              className="w-full sm:w-auto px-6 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold shadow-sm transition text-center"
            >
              View My Incidents
            </Link>
            <button
              onClick={resetForm}
              className="w-full sm:w-auto px-6 py-2.5 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition"
            >
              Report Another Issue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-[#6B7488]">
        <Link href="/itsm/dashboard/requester" className="hover:text-[#0E1726] flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Requester Dashboard
        </Link>
        <span>/</span>
        <span className="text-[#0E1726] font-medium">Report an Issue</span>
      </div>

      {/* Page Header */}
      <div className="flex items-start gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-[#F3E8FF] text-[#6D28D9] flex items-center justify-center shrink-0">
          <LifeBuoy className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-[#0E1726] tracking-tight">Report an IT Issue</h1>
          <p className="text-xs text-[#6B7488] mt-1">
            Need help? Tell us what went wrong and our IT support team will investigate and resolve it for you.
          </p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm space-y-6">
        {/* Title / Problem */}
        <div>
          <label htmlFor="req-title" className="block text-xs font-bold text-[#0E1726] mb-1.5">
            What is the problem? *
          </label>
          <input
            id="req-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., VPN is not connecting or Outlook is frozen"
            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-lg px-3.5 py-2.5 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="req-desc" className="block text-xs font-bold text-[#0E1726] mb-1.5">
            Describe what happened *
          </label>
          <textarea
            id="req-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Please describe the issue, any error messages displayed, or steps leading up to the problem..."
            rows={5}
            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-lg p-3.5 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none leading-relaxed"
            required
          />
        </div>

        {/* Category */}
        <div>
          <label htmlFor="req-cat" className="block text-xs font-bold text-[#0E1726] mb-1.5">
            Category
          </label>
          <select
            id="req-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-white border border-[#E6E9F0] rounded-lg px-3.5 py-2.5 text-xs text-[#0E1726] focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Impact */}
        <div>
          <label className="block text-xs font-bold text-[#0E1726] mb-2">
            How many people or services are affected? *
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {IMPACT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                  impact === opt.value
                    ? "border-[#6D28D9] bg-[#F3E8FF]/30 ring-1 ring-[#6D28D9]"
                    : "border-[#E6E9F0] bg-[#FBFAF9] hover:bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="impact"
                  value={opt.value}
                  checked={impact === opt.value}
                  onChange={(e) => setImpact(e.target.value)}
                  className="mt-0.5 text-[#6D28D9] focus:ring-[#6D28D9]"
                />
                <div>
                  <div className="text-xs font-bold text-[#0E1726]">{opt.label}</div>
                  <div className="text-[11px] text-[#6B7488] mt-0.5">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Urgency */}
        <div>
          <label className="block text-xs font-bold text-[#0E1726] mb-2">
            How urgent is the problem? *
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {URGENCY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                  urgency === opt.value
                    ? "border-[#6D28D9] bg-[#F3E8FF]/30 ring-1 ring-[#6D28D9]"
                    : "border-[#E6E9F0] bg-[#FBFAF9] hover:bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="urgency"
                  value={opt.value}
                  checked={urgency === opt.value}
                  onChange={(e) => setUrgency(e.target.value)}
                  className="mt-0.5 text-[#6D28D9] focus:ring-[#6D28D9]"
                />
                <div>
                  <div className="text-xs font-bold text-[#0E1726]">{opt.label}</div>
                  <div className="text-[11px] text-[#6B7488] mt-0.5">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-[#E6E9F0]">
          <div className="flex items-center gap-1.5 text-xs text-[#6B7488]">
            <HelpCircle className="w-4 h-4 text-[#6D28D9]" />
            <span>Need urgent phone help? Contact IT Extension #4357</span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/itsm/dashboard/requester"
              className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {submitting ? "Submitting..." : "Submit Issue"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
