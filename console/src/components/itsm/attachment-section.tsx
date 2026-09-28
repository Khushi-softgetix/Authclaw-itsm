"use client";

import React, { useState, useRef } from "react";
import {
  Paperclip,
  Download,
  Eye,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  UploadCloud,
  X,
  Plus,
  AlertCircle,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { formatDateTime } from "@/lib/itsm-format";

export interface AttachmentItem {
  id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  storage_backend?: string;
  checksum_sha256?: string;
  uploaded_by_id?: string;
  uploaded_by_email?: string;
  created_at: string;
}

interface AttachmentSectionProps {
  ticketId: string;
  ticketType?: "incidents" | "requests";
  attachments: AttachmentItem[];
  onAttachmentUploaded?: () => void;
  canUpload?: boolean;
}

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

function isImageAttachment(att: AttachmentItem): boolean {
  if (att.mime_type && att.mime_type.startsWith("image/")) return true;
  const ext = getFileExtension(att.file_name);
  return [".png", ".jpg", ".jpeg", ".webp"].includes(ext);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(filename: string, mime: string) {
  const ext = getFileExtension(filename);
  if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
    return <ImageIcon className="w-5 h-5 text-purple-600" />;
  }
  if (ext === ".pdf" || mime.includes("pdf")) {
    return <FileText className="w-5 h-5 text-red-500" />;
  }
  if ([".xlsx", ".xls", ".csv"].includes(ext) || mime.includes("spreadsheet") || mime.includes("csv")) {
    return <FileSpreadsheet className="w-5 h-5 text-emerald-600" />;
  }
  if ([".doc", ".docx"].includes(ext) || mime.includes("word")) {
    return <FileText className="w-5 h-5 text-blue-600" />;
  }
  return <FileCode className="w-5 h-5 text-gray-500" />;
}

function getFileTypeBadge(filename: string, mime: string): { label: string; color: string } {
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

export default function AttachmentSection({
  ticketId,
  ticketType = "incidents",
  attachments,
  onAttachmentUploaded,
  canUpload = true,
}: AttachmentSectionProps) {
  const [previewItem, setPreviewItem] = useState<AttachmentItem | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processSelectedFiles = (incoming: FileList | File[]) => {
    const valid: File[] = [];
    let errMessage: string | null = null;

    Array.from(incoming).forEach((file) => {
      const ext = getFileExtension(file.name);
      if (!ALLOWED_EXTS.includes(ext)) {
        errMessage = `File "${file.name}" has an unsupported format. Allowed formats: PNG, JPG, JPEG, WEBP, PDF, DOCX, XLSX, TXT, CSV.`;
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        errMessage = `File "${file.name}" exceeds the 10 MB limit.`;
        return;
      }
      if (uploadFiles.some((f) => f.name === file.name && f.size === file.size)) {
        return; // Prevent duplicate
      }
      valid.push(file);
    });

    if (errMessage) {
      setUploadError(errMessage);
    } else {
      setUploadError(null);
    }

    if (valid.length > 0) {
      setUploadFiles((prev) => [...prev, ...valid]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processSelectedFiles(e.target.files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      processSelectedFiles(e.dataTransfer.files);
    }
  };

  const removeUploadFile = (index: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadSubmit = async () => {
    if (uploadFiles.length === 0) return;

    try {
      setIsUploading(true);
      setUploadError(null);

      for (const file of uploadFiles) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`/api/itsm/${ticketType}/${ticketId}/attachments`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || data.error || `Failed to upload ${file.name}`);
        }
      }

      setUploadFiles([]);
      setShowUploadModal(false);
      if (onAttachmentUploaded) {
        onAttachmentUploaded();
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload attachments");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-xs space-y-4" id="attachment-section">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
        <div className="flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-[#6D28D9]" />
          <h2 className="text-sm font-bold text-[#0E1726]">Attachments</h2>
          <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-[#F3E8FF] text-[#6D28D9]">
            {attachments.length}
          </span>
        </div>

        {canUpload && (
          <button
            type="button"
            onClick={() => {
              setUploadFiles([]);
              setUploadError(null);
              setShowUploadModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#6D28D9] bg-[#F3E8FF] hover:bg-[#E9D5FF] rounded-lg transition"
            id="btn-add-attachment"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Attachment</span>
          </button>
        )}
      </div>

      {/* Attachment List / Grid */}
      {attachments.length === 0 ? (
        <div className="py-6 text-center text-xs text-[#6B7488] bg-[#FBFAF9] rounded-xl border border-dashed border-[#E6E9F0]">
          <Paperclip className="w-6 h-6 text-[#A0AABF] mx-auto mb-1.5" />
          <p className="font-medium text-[#475069]">No attachments yet</p>
          <p className="text-[11px] text-[#8C95A8] mt-0.5">
            Files attached by the requester or agent will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" id="attachments-grid">
          {attachments.map((att) => {
            const isImg = isAttachmentImage(att);
            const badge = getFileTypeBadge(att.file_name, att.mime_type);
            const downloadUrl = `/api/itsm/attachments/${att.id}/download`;
            const previewUrl = `/api/itsm/attachments/${att.id}/download?preview=true`;

            return (
              <div
                key={att.id}
                className="flex items-start gap-3 p-3.5 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] hover:bg-[#F8F7FC] hover:border-[#D8B4FE] transition group"
                id={`attachment-card-${att.id}`}
              >
                {/* Thumbnail / File Icon */}
                <div className="shrink-0 mt-0.5">
                  {isImg ? (
                    <button
                      type="button"
                      onClick={() => {
                        setZoomLevel(1);
                        setPreviewItem(att);
                      }}
                      className="relative block w-12 h-12 rounded-lg overflow-hidden border border-[#E6E9F0] bg-white group/thumb focus:outline-none focus:ring-2 focus:ring-[#6D28D9]"
                      title="Click to preview image"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt={att.file_name}
                        className="w-full h-full object-cover transition group-hover/thumb:scale-105"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition">
                        <Eye className="w-3.5 h-3.5 text-white drop-shadow" />
                      </div>
                    </button>
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-white border border-[#E6E9F0] flex items-center justify-center shrink-0">
                      {getFileIcon(att.file_name, att.mime_type)}
                    </div>
                  )}
                </div>

                {/* Metadata & Actions */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-xs font-semibold text-[#0E1726] truncate max-w-[200px]"
                      title={att.file_name}
                    >
                      {att.file_name}
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-1 text-[11px] text-[#6B7488]">
                    <span>{formatFileSize(att.file_size_bytes)}</span>
                    <span>•</span>
                    <span>{formatDateTime(att.created_at)}</span>
                  </div>

                  {att.uploaded_by_email && (
                    <p className="text-[10px] text-[#8C95A8] mt-0.5 truncate" title={att.uploaded_by_email}>
                      By: <span className="text-[#475069] font-medium">{att.uploaded_by_email}</span>
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 mt-2 pt-1 border-t border-[#E6E9F0]/60">
                    {isImg && (
                      <button
                        type="button"
                        onClick={() => {
                          setZoomLevel(1);
                          setPreviewItem(att);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6D28D9] hover:underline"
                        id={`btn-preview-${att.id}`}
                      >
                        <Eye className="w-3 h-3" />
                        <span>Preview</span>
                      </button>
                    )}

                    <a
                      href={downloadUrl}
                      download={att.file_name}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#475069] hover:text-[#0E1726] hover:underline"
                      id={`btn-download-${att.id}`}
                    >
                      <Download className="w-3 h-3" />
                      <span>Download</span>
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Image Preview Lightbox Modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setPreviewItem(null)}
          id="preview-lightbox-modal"
        >
          <div
            className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6E9F0] bg-[#FBFAF9]">
              <div className="flex items-center gap-2 truncate">
                <ImageIcon className="w-4 h-4 text-[#6D28D9] shrink-0" />
                <span className="text-sm font-bold text-[#0E1726] truncate">
                  {previewItem.file_name}
                </span>
                <span className="text-xs text-[#6B7488]">
                  ({formatFileSize(previewItem.file_size_bytes)})
                </span>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                  className="p-1.5 rounded-lg border border-[#E6E9F0] hover:bg-white text-[#475069] transition"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono text-[#6B7488] w-12 text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                  className="p-1.5 rounded-lg border border-[#E6E9F0] hover:bg-white text-[#475069] transition"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel(1)}
                  className="p-1.5 rounded-lg border border-[#E6E9F0] hover:bg-white text-[#475069] transition"
                  title="Reset Zoom"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <a
                  href={`/api/itsm/attachments/${previewItem.id}/download`}
                  download={previewItem.file_name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold shadow-xs transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="p-1.5 rounded-lg text-[#8C95A8] hover:text-[#0E1726] hover:bg-white transition"
                  title="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body / Image Viewer */}
            <div className="flex-1 overflow-auto p-6 bg-[#18181B] flex items-center justify-center min-h-[350px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/itsm/attachments/${previewItem.id}/download?preview=true`}
                alt={previewItem.file_name}
                style={{ transform: `scale(${zoomLevel})` }}
                className="max-h-[65vh] max-w-full object-contain transition-transform duration-100 shadow-md rounded"
              />
            </div>
          </div>
        </div>
      )}

      {/* Upload Attachment Modal */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => !isUploading && setShowUploadModal(false)}
          id="upload-attachment-modal"
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-[#6D28D9]" />
                <h3 className="text-sm font-bold text-[#0E1726]">Add Attachments</h3>
              </div>
              <button
                type="button"
                disabled={isUploading}
                onClick={() => setShowUploadModal(false)}
                className="text-[#8C95A8] hover:text-[#0E1726] p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {uploadError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Drag & Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                isDragging
                  ? "border-[#6D28D9] bg-[#F3E8FF]/40"
                  : "border-[#E6E9F0] bg-[#FBFAF9] hover:bg-white hover:border-[#6D28D9]"
              }`}
            >
              <UploadCloud className="w-8 h-8 text-[#6D28D9] mx-auto mb-2" />
              <p className="text-xs font-semibold text-[#0E1726]">
                Click to browse or drag and drop files here
              </p>
              <p className="text-[11px] text-[#6B7488] mt-1">
                Supported: PNG, JPG, JPEG, WEBP, PDF, DOCX, XLSX, TXT, CSV (Max 10 MB per file)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
                accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.doc,.xlsx,.xls,.txt,.csv,.log"
              />
            </div>

            {/* Selected Files Queue */}
            {uploadFiles.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                <span className="text-[11px] font-semibold text-[#6B7488] block">
                  Files to upload ({uploadFiles.length})
                </span>
                {uploadFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-[#FBFAF9] border border-[#E6E9F0] text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      {getFileIcon(file.name, file.type)}
                      <span className="font-medium text-[#0E1726] truncate">{file.name}</span>
                      <span className="text-[10px] text-[#6B7488] shrink-0">
                        ({formatFileSize(file.size)})
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeUploadFile(idx);
                      }}
                      className="text-[#8C95A8] hover:text-red-500 p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E6E9F0]">
              <button
                type="button"
                disabled={isUploading}
                onClick={() => setShowUploadModal(false)}
                className="px-4 py-2 bg-white border border-[#E6E9F0] text-[#475069] rounded-lg text-xs font-medium hover:bg-[#F5F7FA] transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={uploadFiles.length === 0 || isUploading}
                onClick={handleUploadSubmit}
                className="flex items-center gap-2 px-5 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
                id="btn-confirm-upload"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Upload {uploadFiles.length > 0 ? `(${uploadFiles.length})` : ""}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper alias
const isAttachmentImage = isImageAttachment;
