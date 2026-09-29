"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileCode,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  LifeBuoy,
  Loader2,
  Paperclip,
  Send,
  UploadCloud,
  X,
} from "lucide-react";
import { jsonRequest } from "@/lib/client-fetch";
import { apiErrorMessage } from "@/lib/errors";

const ALLOWED_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".txt",
  ".csv",
  ".log",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx !== -1 ? filename.slice(idx).toLowerCase() : "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeBadge(filename: string): { label: string; color: string } {
  const ext = getFileExtension(filename).replace(".", "").toUpperCase();
  if (["PNG", "JPG", "JPEG", "WEBP"].includes(ext)) {
    return { label: ext, color: "bg-purple-50 text-purple-700 border-purple-200" };
  }
  if (ext === "PDF") {
    return { label: "PDF", color: "bg-red-50 text-red-700 border-red-200" };
  }
  if (["XLSX", "XLS", "CSV"].includes(ext)) {
    return { label: ext, color: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  }
  if (["DOCX", "DOC"].includes(ext)) {
    return { label: ext, color: "bg-blue-50 text-blue-700 border-blue-200" };
  }
  return { label: ext || "FILE", color: "bg-gray-100 text-gray-700 border-gray-200" };
}

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
  attached_files?: string[];
  failed_uploads?: string[];
}

export default function CreateIncidentPage() {
  // Form State
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [impact, setImpact] = useState<string>("MEDIUM");
  const [urgency, setUrgency] = useState<string>("");
  const [category, setCategory] = useState<string>("GENERAL");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<{ [name: string]: string }>({});

  // Submission State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachmentValidationError, setAttachmentValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [createdIncident, setCreatedIncident] = useState<CreatedIncidentSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = (files: FileList | File[]) => {
    const valid: File[] = [];
    let validationErr: string | null = null;

    Array.from(files).forEach((file) => {
      const ext = getFileExtension(file.name);
      if (!ALLOWED_EXTS.includes(ext)) {
        validationErr = `File "${file.name}" has an unsupported format. Allowed formats: PNG, JPG, JPEG, WEBP, PDF, DOCX, XLSX, TXT, CSV.`;
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        validationErr = `File "${file.name}" exceeds the 10 MB limit.`;
        return;
      }
      if (attachments.some((f) => f.name === file.name && f.size === file.size)) {
        return; // Prevent duplicate
      }
      valid.push(file);

      // Create preview URL if image
      if (file.type.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
        const url = URL.createObjectURL(file);
        setAttachmentPreviews((prev) => ({ ...prev, [file.name]: url }));
      }
    });

    if (validationErr) {
      setAttachmentValidationError(validationErr);
    } else {
      setAttachmentValidationError(null);
    }

    if (valid.length > 0) {
      setAttachments((prev) => [...prev, ...valid]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (index: number) => {
    const file = attachments[index];
    if (file && attachmentPreviews[file.name]) {
      URL.revokeObjectURL(attachmentPreviews[file.name]);
      setAttachmentPreviews((prev) => {
        const next = { ...prev };
        delete next[file.name];
        return next;
      });
    }
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

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
      setUploadProgress(null);

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
      const uploadedNames: string[] = [];
      const failedNames: string[] = [];

      if (attachments.length > 0 && data.id) {
        for (let i = 0; i < attachments.length; i++) {
          const file = attachments[i];
          setUploadProgress(`Uploading attachment ${i + 1} of ${attachments.length}: ${file.name}...`);
          try {
            const formData = new FormData();
            formData.append("file", file);
            const uploadRes = await fetch(`/api/itsm/incidents/${data.id}/attachments`, {
              method: "POST",
              body: formData,
            });
            if (uploadRes.ok) {
              uploadedNames.push(file.name);
            } else {
              failedNames.push(file.name);
            }
          } catch {
            failedNames.push(file.name);
          }
        }
      }

      setCreatedIncident({
        id: data.id,
        ticket_number: data.ticket_number,
        title: data.title,
        status: data.status || "NEW",
        created_at: data.created_at || new Date().toISOString(),
        attached_files: uploadedNames,
        failed_uploads: failedNames.length > 0 ? failedNames : undefined,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit issue");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setImpact("MEDIUM");
    setUrgency("");
    setCategory("GENERAL");
    Object.values(attachmentPreviews).forEach((url) => URL.revokeObjectURL(url));
    setAttachmentPreviews({});
    setAttachments([]);
    setAttachmentValidationError(null);
    setUploadProgress(null);
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

            {/* Attached Files List */}
            {createdIncident.attached_files && createdIncident.attached_files.length > 0 && (
              <div className="pt-2 border-t border-[#E6E9F0] space-y-1.5">
                <span className="text-[11px] font-semibold text-[#6B7488] block">
                  Attached Files ({createdIncident.attached_files.length})
                </span>
                <div className="space-y-1">
                  {createdIncident.attached_files.map((name, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-[#0E1726]">
                      <Paperclip className="w-3.5 h-3.5 text-[#6D28D9] shrink-0" />
                      <span className="truncate">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {createdIncident.failed_uploads && createdIncident.failed_uploads.length > 0 && (
              <div className="pt-2 border-t border-red-100 text-xs text-red-600">
                <span>Some attachments could not be uploaded: {createdIncident.failed_uploads.join(", ")}</span>
              </div>
            )}
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

        {/* Attachments Section */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-[#0E1726]">
            Attachments (Optional)
          </label>

          {attachmentValidationError && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{attachmentValidationError}</span>
            </div>
          )}

          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition ${
              isDragging
                ? "border-[#6D28D9] bg-[#F3E8FF]/40"
                : "border-[#E6E9F0] bg-[#FBFAF9] hover:bg-white hover:border-[#6D28D9]"
            }`}
          >
            <div className="flex flex-col items-center justify-center gap-2">
              <UploadCloud className="w-7 h-7 text-[#6D28D9]" />
              <div className="text-xs text-[#0E1726]">
                <span className="font-semibold text-[#6D28D9]">Choose files</span> or drag &amp; drop
              </div>
              <p className="text-[11px] text-[#6B7488]">
                PNG, JPG, JPEG, WEBP, PDF, DOCX, XLSX, TXT, CSV (up to 10 MB per file)
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.doc,.xlsx,.xls,.txt,.csv,.log"
            />
          </div>

          {/* Selected Attachments List */}
          {attachments.length > 0 && (
            <div className="mt-3 space-y-2">
              {attachments.map((file, idx) => {
                const ext = getFileExtension(file.name);
                const isImg = file.type.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
                const badge = getFileTypeBadge(file.name);
                const previewSrc = attachmentPreviews[file.name];

                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[#FBFAF9] border border-[#E6E9F0] text-xs hover:border-[#D8B4FE] transition"
                  >
                    <div className="flex items-center gap-3 truncate">
                      {isImg && previewSrc ? (
                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-[#E6E9F0] bg-white shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewSrc}
                            alt={file.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-white border border-[#E6E9F0] flex items-center justify-center shrink-0">
                          {ext === ".pdf" ? (
                            <FileText className="w-4 h-4 text-red-500" />
                          ) : [".xlsx", ".xls", ".csv"].includes(ext) ? (
                            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <FileCode className="w-4 h-4 text-gray-500" />
                          )}
                        </div>
                      )}

                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-[#0E1726] truncate max-w-[220px]">
                            {file.name}
                          </span>
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${badge.color}`}>
                            {badge.label}
                          </span>
                        </div>
                        <span className="text-[10px] text-[#6B7488]">
                          {formatFileSize(file.size)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-[#8C95A8] hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 transition"
                      title="Remove file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upload Progress Status Banner */}
        {uploadProgress && (
          <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 text-[#6D28D9] text-xs flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span className="font-medium">{uploadProgress}</span>
          </div>
        )}

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
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{uploadProgress ? "Uploading..." : "Submitting..."}</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit Issue</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

