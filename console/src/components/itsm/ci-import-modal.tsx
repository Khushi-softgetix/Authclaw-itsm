"use client";

import React, { useState, useId } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";

export interface CIImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

interface RawRecord {
  [key: string]: any;
}

interface DiffItem {
  old: any;
  new: any;
}

interface RowResult {
  row_number: number;
  action: "INSERT" | "UPDATE" | "CONFLICT" | "ERROR";
  name: string | null;
  ci_type: string | null;
  environment: string | null;
  status: string | null;
  service_id: string | null;
  service_name: string | null;
  external_resource_id: string | null;
  existing_ci_id: string | null;
  changes: Record<string, DiffItem> | null;
  errors: string[];
  conflicts: string[];
  raw_data: Record<string, any>;
}

interface DryRunResponse {
  source_filename: string;
  source_type: string;
  total_records: number;
  valid_records: number;
  invalid_records: number;
  insert_count: number;
  update_count: number;
  conflict_count: number;
  error_count: number;
  rows: RowResult[];
}

interface CommitResponse {
  batch_id: string;
  source_filename: string;
  total_records: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  error_queue: {
    row_number: number;
    name: string | null;
    action: string;
    errors: string[];
    conflicts: string[];
    raw_data: Record<string, any>;
  }[];
}

const TARGET_FIELDS = [
  { key: "", label: "-- Ignore / Do Not Map --" },
  { key: "name", label: "CI Name (Required)", required: true },
  { key: "ci_type", label: "CI Class / Type (Required)", required: true },
  { key: "environment", label: "Environment (e.g. PRODUCTION, STAGING)" },
  { key: "status", label: "Status (e.g. ACTIVE, MAINTENANCE, DECOMMISSIONED)" },
  { key: "service_name", label: "Associated Service Name" },
  { key: "service_id", label: "Associated Service UUID" },
  { key: "external_resource_id", label: "External Resource Identifier / ARN" },
];

function autoDetectField(colName: string): string {
  const norm = colName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["name", "ciname", "hostname", "servername", "resourcename", "itemname", "title"].includes(norm)) {
    return "name";
  }
  if (["citype", "type", "class", "ciclass", "category", "componenttype"].includes(norm)) {
    return "ci_type";
  }
  if (["environment", "env", "stage", "tier"].includes(norm)) {
    return "environment";
  }
  if (["status", "state", "operationalstatus", "lifecyclestatus"].includes(norm)) {
    return "status";
  }
  if (["servicename", "service", "appservice", "applicationservice"].includes(norm)) {
    return "service_name";
  }
  if (["serviceid"].includes(norm)) {
    return "service_id";
  }
  if (["externalresourceid", "externalid", "resourceid", "arn", "instanceid", "assettag", "serialnumber"].includes(norm)) {
    return "external_resource_id";
  }
  return "";
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map((h) => h.replace(/^["']|["']$/g, "").trim());

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const rowObj: Record<string, string> = {};
    headers.forEach((h, colIdx) => {
      rowObj[h] = values[colIdx] ? values[colIdx].replace(/^["']|["']$/g, "").trim() : "";
    });
    rows.push(rowObj);
  }

  return { headers, rows };
}

export function CIImportModal({ isOpen, onClose, onImportComplete }: CIImportModalProps) {
  const fileInputId = useId();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // File state
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState<"csv" | "json">("csv");
  const [fileError, setFileError] = useState<string | null>(null);
  const [rawRecords, setRawRecords] = useState<RawRecord[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);

  // Mapping state
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});

  // Dry run state
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  // Commit state
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setStep(1);
    setFileName("");
    setFileType("csv");
    setFileError(null);
    setRawRecords([]);
    setHeaders([]);
    setFieldMapping({});
    setDryRunLoading(false);
    setDryRunError(null);
    setDryRunResult(null);
    setUpdateExisting(true);
    setExpandedRows({});
    setCommitLoading(false);
    setCommitError(null);
    setCommitResult(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // Sample downloads
  const downloadSampleCSV = () => {
    const csvContent =
      "name,ci_class,status,environment,service_name,external_resource_id\n" +
      "web-frontend-01,SERVER,ACTIVE,PRODUCTION,Customer Portal,i-0a1b2c3d4e5f001\n" +
      "postgres-primary,DATABASE,ACTIVE,PRODUCTION,Identity Core,arn:aws:rds:us-east-1:123456789:db:id-prod\n" +
      "redis-cache-cluster,LOAD_BALANCER,MAINTENANCE,STAGING,Search API,arn:aws:elasticache:cluster-cache-01\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "sample_configuration_items.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadSampleJSON = () => {
    const sample = [
      {
        name: "web-frontend-01",
        ci_class: "SERVER",
        status: "ACTIVE",
        environment: "PRODUCTION",
        service_name: "Customer Portal",
        external_resource_id: "i-0a1b2c3d4e5f001",
      },
      {
        name: "postgres-primary",
        ci_class: "DATABASE",
        status: "ACTIVE",
        environment: "PRODUCTION",
        service_name: "Identity Core",
        external_resource_id: "arn:aws:rds:us-east-1:123456789:db:id-prod",
      },
      {
        name: "redis-cache-cluster",
        ci_class: "LOAD_BALANCER",
        status: "MAINTENANCE",
        environment: "STAGING",
        service_name: "Search API",
        external_resource_id: "arn:aws:elasticache:cluster-cache-01",
      },
    ];
    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "sample_configuration_items.json");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // File parsing
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setFileName(file.name);

    const isJson = file.name.endsWith(".json");
    const isCsv = file.name.endsWith(".csv");

    if (!isJson && !isCsv) {
      setFileError("Only .csv and .json files are supported. Please choose a valid file.");
      return;
    }

    setFileType(isJson ? "json" : "csv");

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      try {
        if (isJson) {
          const parsed = JSON.parse(content);
          const records: RawRecord[] = Array.isArray(parsed)
            ? parsed
            : parsed.items && Array.isArray(parsed.items)
            ? parsed.items
            : parsed.records && Array.isArray(parsed.records)
            ? parsed.records
            : [];

          if (records.length === 0) {
            setFileError("The JSON file must contain a non-empty array of configuration items.");
            return;
          }

          const discoveredKeys = Array.from(
            new Set(records.flatMap((r) => (typeof r === "object" && r !== null ? Object.keys(r) : [])))
          );
          setHeaders(discoveredKeys);
          setRawRecords(records);

          // Auto-map detected keys
          const initialMap: Record<string, string> = {};
          discoveredKeys.forEach((k) => {
            const detected = autoDetectField(k);
            if (detected) initialMap[k] = detected;
          });
          setFieldMapping(initialMap);
        } else {
          const { headers: parsedHeaders, rows: parsedRows } = parseCSV(content);
          if (parsedRows.length === 0) {
            setFileError("The CSV file must contain a header row and at least one data row.");
            return;
          }

          setHeaders(parsedHeaders);
          setRawRecords(parsedRows);

          // Auto-map detected keys
          const initialMap: Record<string, string> = {};
          parsedHeaders.forEach((k) => {
            const detected = autoDetectField(k);
            if (detected) initialMap[k] = detected;
          });
          setFieldMapping(initialMap);
        }
      } catch (err) {
        setFileError(`Failed to parse file: ${err instanceof Error ? err.message : "Invalid syntax"}`);
      }
    };
    reader.readAsText(file);
  };

  // Perform Dry Run
  const executeDryRun = async () => {
    setDryRunLoading(true);
    setDryRunError(null);
    setStep(3);

    try {
      const res = await fetch("/api/itsm/admin/configuration-items/import/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_filename: fileName,
          source_type: fileType,
          raw_records: rawRecords,
          field_mapping: fieldMapping,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Dry-run failed with status ${res.status}`);
      }

      const data: DryRunResponse = await res.json();
      setDryRunResult(data);
    } catch (err) {
      setDryRunError(err instanceof Error ? err.message : "Dry-run validation failed");
    } finally {
      setDryRunLoading(false);
    }
  };

  // Perform Commit
  const executeCommit = async () => {
    setCommitLoading(true);
    setCommitError(null);

    try {
      const res = await fetch("/api/itsm/admin/configuration-items/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_filename: fileName,
          source_type: fileType,
          raw_records: rawRecords,
          field_mapping: fieldMapping,
          update_existing: updateExisting,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Commit import failed with status ${res.status}`);
      }

      const data: CommitResponse = await res.json();
      setCommitResult(data);
      setStep(4);
      onImportComplete();
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : "Commit import failed");
    } finally {
      setCommitLoading(false);
    }
  };

  // Download Error Queue
  const downloadErrorQueueCSV = () => {
    if (!commitResult || commitResult.error_queue.length === 0) return;

    const rows = commitResult.error_queue.map((item) => ({
      batch_id: commitResult.batch_id,
      row_number: item.row_number,
      ci_name: item.name || "",
      action: item.action,
      errors: item.errors.join("; "),
      conflicts: item.conflicts.join("; "),
      raw_payload: JSON.stringify(item.raw_data),
    }));

    const csvHeaders = ["batch_id", "row_number", "ci_name", "action", "errors", "conflicts", "raw_payload"];
    const csvContent =
      csvHeaders.join(",") +
      "\n" +
      rows
        .map((r) =>
          csvHeaders
            .map((h) => `"${String((r as any)[h] || "").replace(/"/g, '""')}"`)
            .join(",")
        )
        .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `import_errors_${commitResult.batch_id.slice(0, 8)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Validation for Step 2
  const mappedTargets = Object.values(fieldMapping);
  const hasMappedName = mappedTargets.includes("name");
  const hasMappedType = mappedTargets.includes("ci_type");
  const isMappingValid = hasMappedName && hasMappedType;

  return (
    <div className="fixed inset-0 bg-[#0E1726]/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E6E9F0] bg-[#FAFBFD]">
          <div>
            <h2 className="text-base font-bold text-[#0E1726] flex items-center gap-2">
              <Upload className="w-4 h-4 text-[#6D28D9]" />
              <span>Bulk CI Import (CMDB-005)</span>
            </h2>
            <p className="text-xs text-[#6B7488] mt-0.5">
              Upload CSV or JSON configuration items with field mapping, deterministic transformation, dry-run, and reconciliation.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-[#8E97A8] hover:text-[#0E1726] hover:bg-[#F0F2F6] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper Progress */}
        <div className="px-6 py-3 border-b border-[#E6E9F0] bg-white">
          <div className="flex items-center justify-between">
            {[
              { num: 1, label: "1. Upload File" },
              { num: 2, label: "2. Map Fields" },
              { num: 3, label: "3. Dry Run Preview" },
              { num: 4, label: "4. Confirmation & Results" },
            ].map((s, idx) => {
              const isActive = step === s.num;
              const isPast = step > s.num;
              return (
                <div key={s.num} className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition ${
                      isActive
                        ? "bg-[#6D28D9] text-white"
                        : isPast
                        ? "bg-[#059669] text-white"
                        : "bg-[#F0F2F6] text-[#8E97A8]"
                    }`}
                  >
                    {isPast ? <Check className="w-3.5 h-3.5" /> : s.num}
                  </div>
                  <span
                    className={`text-xs font-semibold ${
                      isActive ? "text-[#0E1726]" : isPast ? "text-[#059669]" : "text-[#8E97A8]"
                    }`}
                  >
                    {s.label}
                  </span>
                  {idx < 3 && <div className="w-8 h-px bg-[#E6E9F0] mx-2 hidden sm:block" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* ================= STEP 1: Upload File ================= */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-xl border border-[#E6E9F0] bg-[#FAFBFD] gap-3">
                <div className="text-xs text-[#475069]">
                  <p className="font-semibold text-[#0E1726]">Need a template to get started?</p>
                  <p className="text-[#6B7488] mt-0.5">
                    Download sample formats with standard CI classes (SERVER, DATABASE, APPLICATION) and environments.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={downloadSampleCSV}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition"
                  >
                    <Download className="w-3.5 h-3.5 text-[#6D28D9]" />
                    <span>Sample CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={downloadSampleJSON}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA] transition"
                  >
                    <Download className="w-3.5 h-3.5 text-[#6D28D9]" />
                    <span>Sample JSON</span>
                  </button>
                </div>
              </div>

              {/* Upload Dropzone */}
              <div className="border-2 border-dashed border-[#D2D7E0] hover:border-[#6D28D9] rounded-2xl p-8 text-center bg-[#FAFBFD] hover:bg-white transition flex flex-col items-center justify-center cursor-pointer relative">
                <input
                  type="file"
                  id={fileInputId}
                  accept=".csv,.json"
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <div className="w-12 h-12 rounded-full bg-[#EDE9FE] flex items-center justify-center text-[#6D28D9] mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-[#0E1726]">
                  {fileName ? fileName : "Click or drag CSV or JSON file here"}
                </h3>
                <p className="text-xs text-[#6B7488] mt-1 max-w-sm">
                  Supports comma-separated (.csv) and structured JSON (.json) records. Maximum recommended batch: 500 items per import.
                </p>
              </div>

              {fileError && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FCA5A5] flex items-center gap-2 text-xs text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{fileError}</span>
                </div>
              )}

              {/* Parsed Preview */}
              {rawRecords.length > 0 && !fileError && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#0E1726] flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-[#059669]" />
                      <span>Parsed {rawRecords.length} records successfully</span>
                    </span>
                    <span className="text-[11px] font-medium text-[#6B7488]">
                      Detected {headers.length} columns: {headers.join(", ")}
                    </span>
                  </div>

                  {/* 3-row preview table */}
                  <div className="overflow-x-auto rounded-lg border border-[#E6E9F0]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#FAFBFD] text-[#6B7488] font-semibold border-b border-[#E6E9F0]">
                        <tr>
                          <th className="py-2 px-3 w-12">#</th>
                          {headers.slice(0, 6).map((h) => (
                            <th key={h} className="py-2 px-3">
                              {h}
                            </th>
                          ))}
                          {headers.length > 6 && <th className="py-2 px-3">...</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6E9F0]">
                        {rawRecords.slice(0, 3).map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#FAFBFD]">
                            <td className="py-2 px-3 text-[#8E97A8] font-mono">{idx + 1}</td>
                            {headers.slice(0, 6).map((h) => (
                              <td key={h} className="py-2 px-3 text-[#0E1726] font-mono">
                                {String(row[h] ?? "")}
                              </td>
                            ))}
                            {headers.length > 6 && <td className="py-2 px-3 text-[#8E97A8]">...</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= STEP 2: Field Mapping ================= */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-start gap-2 p-3.5 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] text-xs text-[#1E40AF]">
                <AlertCircle className="w-4 h-4 text-[#2563EB] shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Automatic Field Detection & Deterministic Transformations</p>
                  <p className="mt-0.5 text-[#3B82F6]">
                    AuthClaw automatically mapped detected columns based on standard CI conventions. Values will be trimmed and normalized (e.g. &apos;vm&apos; → &apos;SERVER&apos;, &apos;prod&apos; → &apos;PRODUCTION&apos;, &apos;running&apos; → &apos;ACTIVE&apos;). Unmapped fields are safely preserved in the CI JSONB attributes.
                  </p>
                </div>
              </div>

              {!isMappingValid && (
                <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FCA5A5] flex items-center gap-2 text-xs text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>Both CI Name and CI Class/Type must be mapped before running dry-run.</span>
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-[#E6E9F0]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#FAFBFD] text-[#6B7488] font-semibold border-b border-[#E6E9F0]">
                    <tr>
                      <th className="py-2.5 px-4 w-1/3">Source Column in File</th>
                      <th className="py-2.5 px-4 w-1/3">Target CI Field</th>
                      <th className="py-2.5 px-4 w-1/3">Sample Value (Row 1)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E9F0]">
                    {headers.map((col) => {
                      const sampleVal = rawRecords[0] ? String(rawRecords[0][col] ?? "") : "";
                      const currentTarget = fieldMapping[col] || "";
                      return (
                        <tr key={col} className="hover:bg-[#FAFBFD]">
                          <td className="py-2.5 px-4 font-mono font-medium text-[#0E1726]">
                            {col}
                          </td>
                          <td className="py-2.5 px-4">
                            <select
                              value={currentTarget}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFieldMapping((prev) => {
                                  const updated = { ...prev };
                                  if (val) {
                                    // Remove this target from any other column if it's a 1-to-1 required field
                                    if (["name", "ci_type", "external_resource_id"].includes(val)) {
                                      Object.keys(updated).forEach((k) => {
                                        if (updated[k] === val) delete updated[k];
                                      });
                                    }
                                    updated[col] = val;
                                  } else {
                                    delete updated[col];
                                  }
                                  return updated;
                                });
                              }}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] focus:bg-white focus:outline-none focus:border-[#6D28D9]"
                            >
                              {TARGET_FIELDS.map((t) => (
                                <option key={t.key} value={t.key}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-4 text-[#6B7488] font-mono truncate max-w-xs">
                            {sampleVal || <span className="italic text-[#8E97A8]">&lt;empty&gt;</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ================= STEP 3: Dry Run Preview ================= */}
          {step === 3 && (
            <div className="space-y-6">
              {dryRunLoading && (
                <div className="py-16 flex flex-col items-center justify-center space-y-3">
                  <Loader2 className="w-8 h-8 text-[#6D28D9] animate-spin" />
                  <p className="text-xs font-semibold text-[#0E1726]">
                    Executing CMDB Dry-Run (modifies ZERO database records)...
                  </p>
                  <p className="text-[11px] text-[#6B7488]">
                    Reconciling {rawRecords.length} incoming CIs with existing inventory and detecting conflicts.
                  </p>
                </div>
              )}

              {dryRunError && !dryRunLoading && (
                <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] flex items-center justify-between text-xs text-red-800">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{dryRunError}</span>
                  </div>
                  <button onClick={executeDryRun} className="underline font-semibold">
                    Retry Dry Run
                  </button>
                </div>
              )}

              {dryRunResult && !dryRunLoading && (
                <div className="space-y-6">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                    <div className="p-3 rounded-xl border border-[#E6E9F0] bg-white">
                      <span className="text-[10px] font-bold text-[#6B7488] uppercase tracking-wider">Total</span>
                      <p className="text-lg font-black text-[#0E1726] mt-0.5">{dryRunResult.total_records}</p>
                    </div>
                    <div className="p-3 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5]">
                      <span className="text-[10px] font-bold text-[#059669] uppercase tracking-wider">Valid</span>
                      <p className="text-lg font-black text-[#059669] mt-0.5">{dryRunResult.valid_records}</p>
                    </div>
                    <div className="p-3 rounded-xl border border-[#DDD6FE] bg-[#F5F3FF]">
                      <span className="text-[10px] font-bold text-[#6D28D9] uppercase tracking-wider">New (Insert)</span>
                      <p className="text-lg font-black text-[#6D28D9] mt-0.5">{dryRunResult.insert_count}</p>
                    </div>
                    <div className="p-3 rounded-xl border border-[#C7D2FE] bg-[#EEF2FF]">
                      <span className="text-[10px] font-bold text-[#4338CA] uppercase tracking-wider">Update</span>
                      <p className="text-lg font-black text-[#4338CA] mt-0.5">{dryRunResult.update_count}</p>
                    </div>
                    <div className="p-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB]">
                      <span className="text-[10px] font-bold text-[#D97706] uppercase tracking-wider">Conflicts</span>
                      <p className="text-lg font-black text-[#D97706] mt-0.5">{dryRunResult.conflict_count}</p>
                    </div>
                    <div className="p-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2]">
                      <span className="text-[10px] font-bold text-[#DC2626] uppercase tracking-wider">Errors</span>
                      <p className="text-lg font-black text-[#DC2626] mt-0.5">{dryRunResult.error_count}</p>
                    </div>
                  </div>

                  {/* Options */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-[#E6E9F0] bg-[#FAFBFD]">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="update-existing-check"
                        checked={updateExisting}
                        onChange={(e) => setUpdateExisting(e.target.checked)}
                        className="rounded border-[#D2D7E0] text-[#6D28D9] focus:ring-[#6D28D9]"
                      />
                      <label htmlFor="update-existing-check" className="text-xs font-semibold text-[#0E1726] cursor-pointer">
                        Update existing CIs when name or external resource ID matches
                      </label>
                    </div>
                    <span className="text-[11px] text-[#6B7488]">
                      {updateExisting
                        ? `${dryRunResult.update_count} existing CIs will be modified`
                        : "Existing CIs will be safely skipped"}
                    </span>
                  </div>

                  {/* Preview Table */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-[#0E1726]">Item-Level Evaluation & Reconciliation</span>
                    <div className="overflow-x-auto rounded-xl border border-[#E6E9F0] max-h-72">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-[#FAFBFD] text-[#6B7488] font-semibold border-b border-[#E6E9F0] sticky top-0 z-10">
                          <tr>
                            <th className="py-2.5 px-3 w-12">#</th>
                            <th className="py-2.5 px-3">Action</th>
                            <th className="py-2.5 px-3">CI Name</th>
                            <th className="py-2.5 px-3">Type</th>
                            <th className="py-2.5 px-3">Environment</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Service</th>
                            <th className="py-2.5 px-3">Details / Reasons</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E6E9F0]">
                          {dryRunResult.rows.map((row) => {
                            const isExpanded = !!expandedRows[row.row_number];
                            const badgeColor =
                              row.action === "INSERT"
                                ? "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]"
                                : row.action === "UPDATE"
                                ? "bg-[#EEF2FF] text-[#4338CA] border-[#C7D2FE]"
                                : row.action === "CONFLICT"
                                ? "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]"
                                : "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]";

                            return (
                              <React.Fragment key={row.row_number}>
                                <tr className="hover:bg-[#FAFBFD]">
                                  <td className="py-2.5 px-3 text-[#8E97A8] font-mono">{row.row_number}</td>
                                  <td className="py-2.5 px-3">
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeColor}`}
                                    >
                                      {row.action}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold text-[#0E1726]">
                                    {row.name || <span className="italic text-[#8E97A8]">&lt;none&gt;</span>}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-[#475069]">{row.ci_type || "-"}</td>
                                  <td className="py-2.5 px-3 text-[#475069]">{row.environment || "-"}</td>
                                  <td className="py-2.5 px-3 text-[#475069]">{row.status || "-"}</td>
                                  <td className="py-2.5 px-3 text-[#475069]">
                                    {row.service_name || <span className="text-[#8E97A8]">-</span>}
                                  </td>
                                  <td className="py-2.5 px-3 text-[#475069]">
                                    {row.errors.length > 0 && (
                                      <div className="text-red-700 text-[11px] font-medium">
                                        {row.errors.join(", ")}
                                      </div>
                                    )}
                                    {row.conflicts.length > 0 && (
                                      <div className="text-amber-800 text-[11px] font-medium">
                                        {row.conflicts.join(", ")}
                                      </div>
                                    )}
                                    {row.changes && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedRows((prev) => ({
                                            ...prev,
                                            [row.row_number]: !prev[row.row_number],
                                          }))
                                        }
                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6D28D9] hover:underline"
                                      >
                                        <span>{Object.keys(row.changes).length} field change(s)</span>
                                        {isExpanded ? (
                                          <ChevronUp className="w-3 h-3" />
                                        ) : (
                                          <ChevronDown className="w-3 h-3" />
                                        )}
                                      </button>
                                    )}
                                    {!row.changes && row.errors.length === 0 && row.conflicts.length === 0 && (
                                      <span className="text-[11px] text-[#059669]">Ready to insert</span>
                                    )}
                                  </td>
                                </tr>
                                {isExpanded && row.changes && (
                                  <tr className="bg-[#F8FAFC]">
                                    <td colSpan={8} className="p-3 pl-12">
                                      <div className="text-xs space-y-1">
                                        <p className="font-semibold text-[#0E1726]">Planned attribute updates:</p>
                                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                                          {Object.entries(row.changes).map(([fKey, diff]) => (
                                            <div
                                              key={fKey}
                                              className="p-2 rounded bg-white border border-[#E6E9F0] flex items-center justify-between"
                                            >
                                              <span className="font-mono text-[#6B7488]">{fKey}:</span>
                                              <span className="text-[#DC2626] line-through mr-1">
                                                {String(diff.old ?? "null")}
                                              </span>
                                              <ArrowRight className="w-3 h-3 text-[#8E97A8] shrink-0" />
                                              <span className="text-[#059669] font-semibold ml-1">
                                                {String(diff.new ?? "null")}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= STEP 4: Results & Error Queue ================= */}
          {step === 4 && commitResult && (
            <div className="space-y-6">
              <div className="p-6 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-full bg-[#D1FAE5] flex items-center justify-center text-[#059669] mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-[#065F46]">Configuration Items Imported Successfully</h3>
                <p className="text-xs text-[#047857] mt-1 max-w-md">
                  All valid records have been saved with immutable source attribution and logged to the ITSM audit trail.
                </p>
                <div className="mt-3 text-[11px] font-mono text-[#065F46] bg-white/60 px-3 py-1 rounded-full border border-[#A7F3D0]">
                  Batch ID: {commitResult.batch_id}
                </div>
              </div>

              {/* Outcome summary stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-white">
                  <span className="text-[10px] font-bold text-[#6B7488] uppercase tracking-wider">Inserted</span>
                  <p className="text-xl font-black text-[#059669] mt-0.5">{commitResult.inserted_count}</p>
                </div>
                <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-white">
                  <span className="text-[10px] font-bold text-[#6B7488] uppercase tracking-wider">Updated</span>
                  <p className="text-xl font-black text-[#4338CA] mt-0.5">{commitResult.updated_count}</p>
                </div>
                <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-white">
                  <span className="text-[10px] font-bold text-[#6B7488] uppercase tracking-wider">Skipped</span>
                  <p className="text-xl font-black text-[#6B7488] mt-0.5">{commitResult.skipped_count}</p>
                </div>
                <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-white">
                  <span className="text-[10px] font-bold text-[#6B7488] uppercase tracking-wider">Errors / Conflicts</span>
                  <p className="text-xl font-black text-[#DC2626] mt-0.5">{commitResult.error_count}</p>
                </div>
              </div>

              {/* Error Queue */}
              {commitResult.error_queue.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#DC2626] flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
                      <span>Error Queue ({commitResult.error_queue.length} records retained for review)</span>
                    </span>
                    <button
                      type="button"
                      onClick={downloadErrorQueueCSV}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] text-xs font-semibold text-[#DC2626] hover:bg-[#FEE2E2] transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Error Queue (CSV)</span>
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-[#FCA5A5] max-h-56">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#FEF2F2] text-[#991B1B] font-semibold border-b border-[#FCA5A5]">
                        <tr>
                          <th className="py-2 px-3 w-12">Row</th>
                          <th className="py-2 px-3">CI Identifier</th>
                          <th className="py-2 px-3">Action</th>
                          <th className="py-2 px-3">Failure Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#FEE2E2] bg-white">
                        {commitResult.error_queue.map((errItem) => (
                          <tr key={errItem.row_number} className="hover:bg-[#FFF5F5]">
                            <td className="py-2 px-3 font-mono text-[#991B1B]">{errItem.row_number}</td>
                            <td className="py-2 px-3 font-semibold text-[#0E1726]">
                              {errItem.name || "<unnamed>"}
                            </td>
                            <td className="py-2 px-3">
                              <span className="inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
                                {errItem.action}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-[#991B1B]">
                              {[...errItem.errors, ...errItem.conflicts].join("; ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#E6E9F0] bg-[#FAFBFD]">
          <div>
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA]"
              >
                Back to Upload
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={commitLoading}
                className="px-3.5 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-semibold text-[#475069] hover:bg-[#F5F7FA] disabled:opacity-50"
              >
                Back to Mapping
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {step < 4 && (
              <button
                type="button"
                onClick={handleClose}
                disabled={commitLoading}
                className="px-4 py-2 rounded-lg border border-[#E6E9F0] bg-white text-xs font-medium text-[#475069] hover:bg-[#F5F7FA]"
              >
                Cancel
              </button>
            )}

            {step === 1 && (
              <button
                type="button"
                disabled={rawRecords.length === 0 || !!fileError}
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] disabled:opacity-50 transition"
              >
                <span>Next: Map Fields</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                disabled={!isMappingValid}
                onClick={executeDryRun}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] disabled:opacity-50 transition"
              >
                <span>Execute Dry Run</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                disabled={dryRunLoading || !dryRunResult || dryRunResult.valid_records === 0 || commitLoading}
                onClick={executeCommit}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] disabled:opacity-50 transition"
              >
                {commitLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Importing CIs...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>
                      Confirm Import ({dryRunResult ? dryRunResult.valid_records : 0} CIs)
                    </span>
                  </>
                )}
              </button>
            )}

            {step === 4 && (
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2 rounded-lg bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
