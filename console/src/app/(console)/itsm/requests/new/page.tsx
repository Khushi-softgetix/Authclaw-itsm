"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  HelpCircle,
  Layers,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Ticket,
  Zap,
} from "lucide-react";

interface CatalogQuestion {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "dropdown" | "radio" | "multiselect" | string;
  required?: boolean;
  description?: string;
  placeholder?: string;
  options?: string[];
  default_value?: any;
}

interface CatalogIntakeSchema {
  version?: number;
  questions?: CatalogQuestion[];
  properties?: Record<string, { type?: string; title?: string; description?: string; required?: boolean }>;
  required?: string[];
}

interface CatalogItem {
  id: string;
  service_id: string;
  service_name?: string;
  category_label?: string;
  name: string;
  slug?: string;
  description?: string;
  estimated_delivery_hours?: number;
  estimated_time_label?: string;
  approval_required?: boolean;
  fulfillment_type?: string;
  fulfillment_group?: string;
  intake_schema?: CatalogIntakeSchema;
}

interface CreatedRequestResult {
  id: string;
  ticket_number: string;
  ticket_type: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  service_name?: string;
}

const URGENCY_OPTIONS = [
  { value: "LOW", label: "Low", desc: "Routine request, no immediate time pressure" },
  { value: "MEDIUM", label: "Medium", desc: "Standard business need for upcoming work" },
  { value: "HIGH", label: "High", desc: "Urgent need, needed for active deliverables" },
  { value: "CRITICAL", label: "Critical", desc: "Work-blocking dependency for critical operations" },
];

function RequestServiceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedItemId = searchParams.get("item") || searchParams.get("catalog_item_id");

  // State
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(true);
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [urgency, setUrgency] = useState<string>("MEDIUM");
  const [description, setDescription] = useState<string>("");
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [createdResult, setCreatedResult] = useState<CreatedRequestResult | null>(null);

  // Fetch Service Catalog Items
  const loadCatalog = useCallback(async () => {
    try {
      setLoadingCatalog(true);
      setError(null);
      const res = await fetch("/api/itsm/service-catalog", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to load service catalog");
      }
      const data: CatalogItem[] = await res.json();
      const items = Array.isArray(data) ? data : [];
      setCatalogItems(items);

      // Pre-select item from query param if available, otherwise first item
      if (preselectedItemId) {
        const normalizedPre = preselectedItemId.trim().toLowerCase();
        const match = items.find(
          (it) =>
            it.id === preselectedItemId ||
            it.slug?.toLowerCase() === normalizedPre ||
            it.name.toLowerCase() === normalizedPre ||
            it.name.toLowerCase().replace(/\s+/g, "-") === normalizedPre
        );
        if (match) {
          setSelectedItemId(match.id);
        } else {
          // If not in the list, attempt direct fetch by ID or slug
          try {
            const singleRes = await fetch(`/api/itsm/service-catalog/${encodeURIComponent(preselectedItemId)}`, { cache: "no-store" });
            if (singleRes.ok) {
              const singleItem = await singleRes.json();
              if (singleItem && singleItem.id) {
                setCatalogItems((prev) => {
                  const exists = prev.some((p) => p.id === singleItem.id);
                  return exists ? prev : [singleItem, ...prev];
                });
                setSelectedItemId(singleItem.id);
                return;
              }
            }
          } catch {
            // Ignore and fall back to first item
          }
          if (items.length > 0) {
            setSelectedItemId(items[0].id);
          }
        }
      } else if (items.length > 0) {
        setSelectedItemId(items[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load service catalog");
    } finally {
      setLoadingCatalog(false);
    }
  }, [preselectedItemId]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Fetch fresh catalog item detail whenever selected item changes to guarantee up-to-date intake_schema
  useEffect(() => {
    if (!selectedItemId) return;
    let isCancelled = false;
    fetch(`/api/itsm/service-catalog/${encodeURIComponent(selectedItemId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((detail) => {
        if (detail && !isCancelled) {
          setCatalogItems((prev) =>
            prev.map((it) => (it.id === detail.id ? { ...it, ...detail } : it))
          );
        }
      })
      .catch(() => {});
    return () => {
      isCancelled = true;
    };
  }, [selectedItemId]);

  const selectedItem = catalogItems.find((it) => it.id === selectedItemId);

  const rawSchema = selectedItem?.intake_schema;
  const parsedSchema: CatalogIntakeSchema =
    typeof rawSchema === "string"
      ? (() => {
          try {
            return JSON.parse(rawSchema);
          } catch {
            return {};
          }
        })()
      : (rawSchema || {});
  const rawQuestions = parsedSchema?.questions;
  const dynamicQuestions: CatalogQuestion[] | undefined = Array.isArray(rawQuestions)
    ? rawQuestions.map((q: any) => ({
        ...q,
        id: q.id || q.key || (q.label ? q.label.toLowerCase().replace(/\s+/g, "_") : "field"),
        options: Array.isArray(q.options) ? (q.options as string[]) : undefined,
      }))
    : undefined;
  const hasDynamicQuestions = Array.isArray(dynamicQuestions) && dynamicQuestions.length > 0;
  const hasQuantityQuestion = hasDynamicQuestions && dynamicQuestions.some((q) => q.id === "quantity");
  const hasDescriptionQuestion =
    hasDynamicQuestions &&
    dynamicQuestions.some((q) =>
      ["business_justification", "justification", "reason", "description"].includes(q.id)
    );

  // Initialize form data when selected catalog item changes
  useEffect(() => {
    if (!selectedItem) {
      setFormData({});
      return;
    }
    const questions = dynamicQuestions;
    const initial: Record<string, any> = {};
    if (Array.isArray(questions)) {
      questions.forEach((q) => {
        if (q.default_value !== undefined && q.default_value !== "") {
          initial[q.id] = q.default_value;
        } else if (q.type === "multiselect") {
          initial[q.id] = [];
        } else {
          initial[q.id] = "";
        }
      });
    }
    setFormData(initial);
  }, [selectedItemId, selectedItem, hasDynamicQuestions]);

  const handleCustomFieldChange = (fieldKey: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [fieldKey]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 1. Validate Dynamic Questions if present
    if (hasDynamicQuestions && dynamicQuestions) {
      for (const q of dynamicQuestions) {
        const val = formData[q.id];
        const isRequired = Boolean(q.required);
        const isEmpty =
          val === undefined ||
          val === null ||
          (typeof val === "string" && !val.trim()) ||
          (Array.isArray(val) && val.length === 0);

        if (isRequired && isEmpty) {
          setError(`${q.label} is required.`);
          return;
        }

        if (q.type === "number" && val !== undefined && val !== null && val !== "") {
          if (isNaN(Number(val))) {
            setError(`${q.label} must be a valid number.`);
            return;
          }
        }
      }
    } else {
      // Basic validation when no dynamic questions
      if (!description.trim()) {
        setError("Please provide a reason / business justification for this request.");
        return;
      }
      if (quantity < 1) {
        setError("Quantity must be at least 1.");
        return;
      }
    }

    // 2. Resolve effective description and quantity
    let effectiveDescription = description.trim();
    if (hasDynamicQuestions && dynamicQuestions) {
      for (const k of ["business_justification", "justification", "reason", "description"]) {
        if (formData[k] && String(formData[k]).trim()) {
          effectiveDescription = String(formData[k]).trim();
          break;
        }
      }
    }
    if (!effectiveDescription) {
      effectiveDescription = selectedItem ? `Request for ${selectedItem.name}` : "Service Request";
    }

    let effectiveQuantity = Number(quantity) || 1;
    if (hasDynamicQuestions && formData["quantity"] !== undefined && formData["quantity"] !== "") {
      const parsedQ = Number(formData["quantity"]);
      if (!isNaN(parsedQ) && parsedQ > 0) {
        effectiveQuantity = parsedQ;
      }
    }

    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        catalog_item_id: selectedItem?.id || undefined,
        service_id: selectedItem?.service_id || undefined,
        title: selectedItem ? `Request: ${selectedItem.name}` : "Service Request",
        description: effectiveDescription,
        quantity: effectiveQuantity,
        urgency,
        impact: urgency === "CRITICAL" ? "HIGH" : "MEDIUM",
        priority: urgency === "CRITICAL" ? "P1" : urgency === "HIGH" ? "P2" : urgency === "LOW" ? "P4" : "P3",
        form_data: {
          ...formData,
          quantity: effectiveQuantity,
          reason: effectiveDescription,
          catalog_item_name: selectedItem?.name,
          category: selectedItem?.category_label,
        },
        source_channel: "PORTAL",
      };

      const res = await fetch("/api/itsm/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          errorData.detail || errorData.error || "Failed to submit service request. Please try again."
        );
      }

      const created: CreatedRequestResult = await res.json();
      setCreatedResult(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create service request");
    } finally {
      setSubmitting(false);
    }
  };

  const copyTicketNumber = () => {
    if (!createdResult?.ticket_number) return;
    navigator.clipboard.writeText(createdResult.ticket_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // SUCCESS CONFIRMATION VIEW
  if (createdResult) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4 space-y-6" id="service-request-success">
        <div className="bg-white rounded-[24px] border border-[#E6E9F0] p-8 shadow-sm text-center space-y-6">
          {/* Success Icon */}
          <div className="w-16 h-16 bg-[#F1ECFE] text-[#6D28D9] rounded-2xl flex items-center justify-center mx-auto shadow-inner border border-[#DDD6FE]">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <span className="text-[11px] font-bold text-[#6D28D9] uppercase tracking-wider bg-[#F1ECFE] px-3 py-1 rounded-full border border-[#DDD6FE]">
              Service Request Created
            </span>
            <h1 className="text-2xl font-extrabold text-[#0E1726] tracking-tight">
              Request Submitted Successfully!
            </h1>
            <p className="text-xs sm:text-sm text-[#6B7488] max-w-md mx-auto">
              Your service request has been logged and routed to IT fulfillment. You can track progress in real-time.
            </p>
          </div>

          {/* Ticket Number Highlight Card */}
          <div className="bg-[#FAF9FD] border border-[#E9D8FD] rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-left space-y-0.5">
              <span className="text-[10px] font-bold text-[#8C95A8] uppercase tracking-wider">
                Request Number
              </span>
              <div className="font-mono text-xl font-extrabold text-[#6D28D9] tracking-wider">
                {createdResult.ticket_number}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyTicketNumber}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#DDD6FE] bg-white text-xs font-semibold text-[#6D28D9] hover:bg-[#F3E8FF] transition shadow-2xs"
                title="Copy request number"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied" : "Copy #"}</span>
              </button>
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                {createdResult.status || "ASSIGNED"}
              </span>
            </div>
          </div>

          {/* Details summary */}
          <div className="bg-[#FBFAF9] rounded-2xl p-4 border border-[#F0F2F6] text-xs space-y-2.5 text-left">
            <div className="flex items-center justify-between">
              <span className="text-[#6B7488]">Request Title:</span>
              <span className="font-semibold text-[#0E1726]">{createdResult.title}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#6B7488]">Type:</span>
              <span className="font-semibold text-[#6D28D9]">{createdResult.ticket_type}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#6B7488]">Quantity:</span>
              <span className="font-semibold text-[#0E1726]">{quantity}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#6B7488]">Urgency:</span>
              <span className="font-semibold text-[#0E1726]">{urgency}</span>
            </div>
          </div>

          {/* Action Links */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href={`/itsm/requests/${createdResult.id}`}
              id="view-request-details-button"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-bold rounded-xl transition shadow-sm"
            >
              <span>View Request Details</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>

            <Link
              href="/itsm/incidents"
              id="view-my-tickets-button"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-[#E6E9F0] text-[#0E1726] hover:bg-[#F5F7FA] text-xs font-semibold rounded-xl transition"
            >
              <span>My Tickets &amp; Requests</span>
            </Link>

            <button
              type="button"
              onClick={() => {
                setCreatedResult(null);
                setDescription("");
                setQuantity(1);
                setFormData({});
              }}
              className="w-full sm:w-auto px-4 py-2.5 text-xs text-[#6B7488] hover:text-[#0E1726] font-semibold transition"
            >
              Submit Another Request
            </button>
          </div>
        </div>
      </div>
    );
  }

  // MAIN FORM VIEW
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12" id="request-service-page">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/itsm/services"
          id="back-to-catalog-link"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] hover:text-[#5B21B6] transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Service Catalog</span>
        </Link>

        <Link
          href="/itsm/incidents/new"
          id="report-issue-fallback-link"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7488] hover:text-[#0E1726] transition"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Experiencing an issue? Report a Bug</span>
        </Link>
      </div>

      {/* Page Title Header */}
      <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]">
            <Package className="w-3.5 h-3.5" />
            <span>Service Request</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight">
            Request an IT Service
          </h1>
          <p className="text-xs text-[#6B7488]">
            Order hardware, software licenses, account access, or standard IT services from the enterprise catalog.
          </p>
        </div>
      </div>

      {/* Main Content Form & Sidebar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Form (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          <form onSubmit={handleSubmit} className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-6">
            {error && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Catalog Item Selection */}
            <div className="space-y-2">
              <label htmlFor="catalog-item-select" className="block text-xs font-bold text-[#0E1726] uppercase tracking-wider">
                Select Service Item <span className="text-red-500">*</span>
              </label>

              {loadingCatalog ? (
                <div className="flex items-center gap-2 py-3 px-3 text-xs text-[#6B7488] bg-[#FBFAF9] rounded-xl border border-[#E6E9F0]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#6D28D9]" />
                  <span>Loading available catalog services...</span>
                </div>
              ) : catalogItems.length === 0 ? (
                <div className="p-4 text-xs text-amber-800 bg-amber-50 rounded-xl border border-amber-200">
                  No catalog items found. You can still submit a general service request.
                </div>
              ) : (
                <div className="space-y-3">
                  <select
                    id="catalog-item-select"
                    value={selectedItemId}
                    onChange={(e) => setSelectedItemId(e.target.value)}
                    className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3.5 py-2.5 text-xs text-[#0E1726] font-medium focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none transition shadow-2xs"
                  >
                    {catalogItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} {item.category_label ? `(${item.category_label})` : ""} — SLA: {item.estimated_time_label || `${item.estimated_delivery_hours || 24}h`}
                      </option>
                    ))}
                  </select>

                  {/* Selected Item Preview Box */}
                  {selectedItem && (
                    <div className="bg-[#FAF9FD] rounded-xl border border-[#E9D8FD] p-3.5 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-xs font-bold text-[#6D28D9]">
                          {selectedItem.name}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-[#6B7488] bg-white px-2 py-0.5 rounded border border-[#E6E9F0] flex items-center gap-1">
                            <Clock className="w-3 h-3 text-[#6D28D9]" />
                            {selectedItem.estimated_time_label || `${selectedItem.estimated_delivery_hours || 24} hrs`}
                          </span>
                          {selectedItem.approval_required && (
                            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              Requires Approval
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-[#6B7488] leading-relaxed">
                        {selectedItem.description || "Standard service provisioning."}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quantity Stepper (Rendered if not part of dynamic questions) */}
            {!hasQuantityQuestion && (
              <div className="space-y-2">
                <label htmlFor="request-quantity-input" className="block text-xs font-bold text-[#0E1726] uppercase tracking-wider">
                  Quantity <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-[#E6E9F0] rounded-xl bg-[#FBFAF9] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      disabled={quantity <= 1}
                      className="px-3.5 py-2 text-sm font-bold text-[#475069] hover:bg-[#F0F2F6] disabled:opacity-40 transition"
                    >
                      -
                    </button>
                    <input
                      id="request-quantity-input"
                      type="number"
                      min={1}
                      max={100}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                      className="w-16 text-center bg-transparent text-xs font-bold text-[#0E1726] py-2 focus:outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.min(100, q + 1))}
                      disabled={quantity >= 100}
                      className="px-3.5 py-2 text-sm font-bold text-[#475069] hover:bg-[#F0F2F6] disabled:opacity-40 transition"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[11px] text-[#8C95A8]">
                    Number of units or licenses needed (max 100)
                  </span>
                </div>
              </div>
            )}

            {/* Urgency Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-[#0E1726] uppercase tracking-wider">
                Urgency Level <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {URGENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setUrgency(opt.value)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      urgency === opt.value
                        ? "border-[#6D28D9] bg-[#F1ECFE] text-[#6D28D9] ring-1 ring-[#6D28D9]"
                        : "border-[#E6E9F0] bg-[#FBFAF9] text-[#475069] hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-[#0E1726]">{opt.label}</span>
                      {urgency === opt.value && <CheckCircle2 className="w-3.5 h-3.5 text-[#6D28D9]" />}
                    </div>
                    <p className="text-[11px] text-[#6B7488] leading-tight">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Reason / Business Justification (Rendered if not part of dynamic questions) */}
            {!hasDescriptionQuestion && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="request-description" className="block text-xs font-bold text-[#0E1726] uppercase tracking-wider">
                    Reason / Business Justification <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[11px] text-[#8C95A8]">Required for approval</span>
                </div>
                <textarea
                  id="request-description"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain why this service is required (e.g. new team hire onboarding, developer access for Project Phoenix, replacement of damaged hardware)..."
                  className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl p-3 text-xs text-[#0E1726] leading-relaxed placeholder:text-[#8C95A8] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none transition shadow-2xs"
                  required={!hasDynamicQuestions}
                />
              </div>
            )}

            {/* Dynamic Intake Schema Questions (Metadata-Driven Form Engine - PLT-006) */}
            {hasDynamicQuestions && dynamicQuestions ? (
              <div className="border-t border-[#F0F2F6] pt-5 space-y-4" id="dynamic-questions-section">
                <div className="flex items-center justify-between border-b border-[#F0F2F6] pb-2.5">
                  <div>
                    <h3 className="text-xs font-bold text-[#0E1726] uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#6D28D9]" />
                      <span>Request Details</span>
                    </h3>
                    <p className="text-[11px] text-[#6B7488]">
                      Please answer the following specifications configured for this service.
                    </p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-[#6D28D9] border border-purple-200">
                    {dynamicQuestions.length} {dynamicQuestions.length === 1 ? "question" : "questions"}
                  </span>
                </div>

                <div className="space-y-4">
                  {dynamicQuestions.map((q, qIdx) => {
                    const fieldId = `dynamic-field-${q.id}`;
                    const isRequired = Boolean(q.required);
                    return (
                      <div key={q.id || qIdx} className="space-y-1.5" id={`dynamic-question-${q.id}`}>
                        <div className="flex items-center justify-between">
                          <label htmlFor={fieldId} className="block text-xs font-bold text-[#0E1726]">
                            {q.label} {isRequired && <span className="text-red-500">*</span>}
                          </label>
                        </div>

                        {q.description && (
                          <p className="text-[11px] text-[#6B7488] leading-tight mb-1">
                            {q.description}
                          </p>
                        )}

                        {/* Short Text */}
                        {q.type === "text" && (
                          <input
                            type="text"
                            id={fieldId}
                            value={formData[q.id] || ""}
                            onChange={(e) => handleCustomFieldChange(q.id, e.target.value)}
                            placeholder={q.placeholder || `Enter ${q.label}...`}
                            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3.5 py-2.5 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none transition shadow-2xs font-medium"
                          />
                        )}

                        {/* Long Text */}
                        {q.type === "textarea" && (
                          <textarea
                            id={fieldId}
                            rows={3}
                            value={formData[q.id] || ""}
                            onChange={(e) => handleCustomFieldChange(q.id, e.target.value)}
                            placeholder={q.placeholder || `Provide details for ${q.label}...`}
                            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl p-3 text-xs text-[#0E1726] leading-relaxed placeholder:text-[#8C95A8] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none transition shadow-2xs"
                          />
                        )}

                        {/* Number */}
                        {q.type === "number" && (
                          <input
                            type="number"
                            id={fieldId}
                            value={formData[q.id] !== undefined ? formData[q.id] : ""}
                            onChange={(e) => handleCustomFieldChange(q.id, e.target.value === "" ? "" : Number(e.target.value))}
                            placeholder={q.placeholder || "0"}
                            className="w-full sm:w-48 bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3.5 py-2.5 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none transition shadow-2xs font-mono font-medium"
                          />
                        )}

                        {/* Dropdown */}
                        {q.type === "dropdown" && (
                          <select
                            id={fieldId}
                            value={formData[q.id] || ""}
                            onChange={(e) => handleCustomFieldChange(q.id, e.target.value)}
                            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3.5 py-2.5 text-xs text-[#0E1726] font-medium focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none transition shadow-2xs"
                          >
                            <option value="" disabled>
                              {q.placeholder || "Select an option..."}
                            </option>
                            {q.options && q.options.length > 0 ? (
                              q.options.map((opt, optIdx) => (
                                <option key={optIdx} value={opt}>
                                  {opt}
                                </option>
                              ))
                            ) : (
                              <option disabled value="">
                                No options configured.
                              </option>
                            )}
                          </select>
                        )}

                        {/* Radio */}
                        {q.type === "radio" && (
                          <div className="space-y-2 pt-1" id={`radio-group-${q.id}`}>
                            {q.options && q.options.length > 0 ? (
                              q.options.map((opt, optIdx) => (
                                <label
                                  key={optIdx}
                                  className="flex items-center gap-2.5 text-xs text-[#0E1726] cursor-pointer"
                                >
                                  <input
                                    type="radio"
                                    id={`${fieldId}-${optIdx}`}
                                    name={`radio-${q.id}`}
                                    value={opt}
                                    checked={formData[q.id] === opt}
                                    onChange={(e) => handleCustomFieldChange(q.id, e.target.value)}
                                    className="w-4 h-4 text-[#6D28D9] focus:ring-[#6D28D9]"
                                  />
                                  <span>{opt}</span>
                                </label>
                              ))
                            ) : (
                              <p className="text-xs text-[#8C95A8] italic">No options configured.</p>
                            )}
                          </div>
                        )}

                        {/* Multi-Select */}
                        {q.type === "multiselect" && (
                          <div className="space-y-2 pt-1" id={`multiselect-group-${q.id}`}>
                            {q.options && q.options.length > 0 ? (
                              q.options.map((opt, optIdx) => {
                                const sel: string[] = Array.isArray(formData[q.id]) ? formData[q.id] : [];
                                const isChecked = sel.includes(opt);
                                return (
                                  <label
                                    key={optIdx}
                                    className="flex items-center gap-2.5 text-xs text-[#0E1726] cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      id={`${fieldId}-${optIdx}`}
                                      checked={isChecked}
                                      onChange={(e) => {
                                        const next = e.target.checked
                                          ? [...sel, opt]
                                          : sel.filter((item) => item !== opt);
                                        handleCustomFieldChange(q.id, next);
                                      }}
                                      className="w-4 h-4 rounded text-[#6D28D9] focus:ring-[#6D28D9]"
                                    />
                                    <span>{opt}</span>
                                  </label>
                                );
                              })
                            ) : (
                              <p className="text-xs text-[#8C95A8] italic">No options configured.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : selectedItem?.intake_schema?.properties && Object.keys(selectedItem.intake_schema.properties).length > 0 ? (
              // Legacy properties fallback
              <div className="border-t border-[#F0F2F6] pt-4 space-y-4">
                <h3 className="text-xs font-bold text-[#0E1726] uppercase tracking-wider">
                  Additional Item Specifications
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(selectedItem.intake_schema.properties).map(([key, schema]: [string, any]) => (
                    <div key={key} className="space-y-1.5">
                      <label className="block text-xs font-medium text-[#475069]">
                        {schema.title || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        {selectedItem.intake_schema?.required?.includes(key) && <span className="text-red-500"> *</span>}
                      </label>
                      <input
                        type="text"
                        value={formData[key] || ""}
                        onChange={(e) => handleCustomFieldChange(key, e.target.value)}
                        placeholder={schema.description || `Enter ${key}...`}
                        className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : selectedItem ? (
              <div className="border-t border-[#F0F2F6] pt-4" id="no-dynamic-questions-notice">
                <p className="text-xs text-[#6B7488] bg-[#FBFAF9] p-3 rounded-xl border border-[#E6E9F0]">
                  This catalog item has no additional questions.
                </p>
              </div>
            ) : null}

            {/* Submit Action Button */}
            <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#F0F2F6]">
              <Link
                href="/itsm/services"
                className="px-4 py-2.5 rounded-xl border border-[#E6E9F0] text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA] transition"
              >
                Cancel
              </Link>
              <button
                type="submit"
                id="submit-service-request-button"
                disabled={submitting || loadingCatalog}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting Request...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Submit Service Request</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Information & Summary Sidebar (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Live Request Summary */}
          <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-5 shadow-xs space-y-4">
            <h2 className="text-xs font-bold text-[#0E1726] uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-[#6D28D9]" />
              <span>Request Summary</span>
            </h2>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-[#F0F2F6]">
                <span className="text-[#6B7488]">Service Item:</span>
                <span className="font-semibold text-[#0E1726] text-right max-w-[180px] truncate">
                  {selectedItem?.name || "General Request"}
                </span>
              </div>

              <div className="flex items-center justify-between pb-2 border-b border-[#F0F2F6]">
                <span className="text-[#6B7488]">Category:</span>
                <span className="font-semibold text-[#475069]">
                  {selectedItem?.category_label || "IT Services"}
                </span>
              </div>

              <div className="flex items-center justify-between pb-2 border-b border-[#F0F2F6]">
                <span className="text-[#6B7488]">Quantity:</span>
                <span className="font-bold text-[#6D28D9] font-mono">{quantity}</span>
              </div>

              <div className="flex items-center justify-between pb-2 border-b border-[#F0F2F6]">
                <span className="text-[#6B7488]">Estimated SLA:</span>
                <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {selectedItem?.estimated_time_label || "24-48 hrs"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[#6B7488]">Fulfillment Group:</span>
                <span className="font-semibold text-[#0E1726]">
                  {selectedItem?.fulfillment_group || "IT Operations"}
                </span>
              </div>
            </div>
          </div>

          {/* IT Help / Incident notice */}
          <div className="bg-[#FAF9FD] rounded-[20px] border border-[#E9D8FD] p-5 space-y-3">
            <div className="flex items-center gap-2 text-[#6D28D9]">
              <Sparkles className="w-4 h-4" />
              <h3 className="text-xs font-bold">Is something broken?</h3>
            </div>
            <p className="text-[11px] text-[#6B7488] leading-relaxed">
              Use this page only for ordering new equipment, software seats, or access. If an existing system is malfunctioning or down, please log an incident instead.
            </p>
            <div className="pt-1">
              <Link
                href="/itsm/incidents/new"
                id="sidebar-report-issue-link"
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-[#F3E8FF] border border-[#DDD6FE] text-[#6D28D9] text-xs font-bold rounded-xl transition shadow-2xs"
              >
                <span>Report an Issue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewServiceRequestPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24" id="request-service-loading">
          <Loader2 className="w-6 h-6 text-[#6D28D9] animate-spin" />
          <span className="ml-3 text-xs text-[#475069]">Loading Service Request portal...</span>
        </div>
      }
    >
      <RequestServiceContent />
    </Suspense>
  );
}
