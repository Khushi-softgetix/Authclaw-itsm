// REQ-003: No-Code Form Question Builder (Prompt 3)
"use client";

import React, { Suspense, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  FileCheck,
  ArrowLeft,
  Boxes,
  Sparkles,
  LayoutDashboard,
  Layers,
  HelpCircle,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Plus,
  Trash2,
  Copy,
  Edit2,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Type,
  AlignLeft,
  Hash,
  ListFilter,
  CheckSquare,
  Radio as RadioIcon,
  Save,
  Loader2,
  X,
  ExternalLink,
  Info,
  Check,
} from "lucide-react";

// Supported Question Types
export type QuestionType =
  | "text"
  | "textarea"
  | "number"
  | "dropdown"
  | "radio"
  | "multiselect";

export interface FormQuestion {
  id: string; // Machine-friendly field key (e.g., "laptop_type")
  label: string; // Requester-facing question label
  type: QuestionType;
  required: boolean;
  description?: string;
  placeholder?: string;
  options?: string[]; // For dropdown, radio, multiselect
  default_value?: string | number;
}

interface CatalogItemInfo {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  fulfillment_group?: string;
  intake_schema?: {
    version?: number;
    type?: string;
    questions?: FormQuestion[];
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

const QUESTION_TYPE_META: Record<
  QuestionType,
  { label: string; icon: React.ElementType; description: string; color: string }
> = {
  text: {
    label: "Short Text",
    icon: Type,
    description: "Single-line text input for names, titles, codes",
    color: "bg-blue-50 text-blue-700 border-blue-200",
  },
  textarea: {
    label: "Long Text",
    icon: AlignLeft,
    description: "Multi-line text box for justifications, notes",
    color: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  number: {
    label: "Number",
    icon: Hash,
    description: "Numeric input for quantities, amounts, durations",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  dropdown: {
    label: "Dropdown",
    icon: ListFilter,
    description: "Select one option from a collapsible menu",
    color: "bg-purple-50 text-purple-700 border-purple-200",
  },
  radio: {
    label: "Radio",
    icon: RadioIcon,
    description: "Select one option from visible radio buttons",
    color: "bg-amber-50 text-amber-700 border-amber-200",
  },
  multiselect: {
    label: "Multi-Select",
    icon: CheckSquare,
    description: "Select multiple options with checkboxes",
    color: "bg-teal-50 text-teal-700 border-teal-200",
  },
};

function slugifyFieldKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "field";
  if (!/^[a-z]/.test(slug)) return `q_${slug}`;
  return slug;
}

function FormBuilderCoreContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const itemId = searchParams.get("item");

  const [item, setItem] = useState<CatalogItemInfo | null>(null);
  const [loading, setLoading] = useState(Boolean(itemId));
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Form Questions State
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [rawIntakeSchema, setRawIntakeSchema] = useState<Record<string, any>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Modal State for Add / Edit
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // null = add, number = edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalQuestion, setModalQuestion] = useState<FormQuestion>({
    id: "",
    label: "",
    type: "text",
    required: false,
    description: "",
    placeholder: "",
    options: [],
    default_value: "",
  });
  const [modalKeyManuallyEdited, setModalKeyManuallyEdited] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [newOptionInput, setNewOptionInput] = useState("");

  // Delete Confirmation Modal State
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  // Available offerings list for quick item switching when no item or selector is used
  const [catalogItemsList, setCatalogItemsList] = useState<
    Array<{ id: string; name: string; slug: string }>
  >([]);

  // Load Item Details
  useEffect(() => {
    if (!itemId) {
      setLoading(false);
      // Fetch available catalog items for empty state picker
      fetch("/api/itsm/admin/service-catalog")
        .then((r) => (r.ok ? r.json() : []))
        .then((items) => {
          if (Array.isArray(items)) {
            setCatalogItemsList(
              items.map((it: any) => ({
                id: it.id,
                name: it.name,
                slug: it.slug,
              }))
            );
          }
        })
        .catch(() => {});
      return;
    }

    let isMounted = true;
    async function loadItem() {
      try {
        setLoading(true);
        setFetchError(null);
        setSaveSuccess(false);
        const res = await fetch(`/api/itsm/admin/service-catalog/${itemId}`);
        if (!res.ok) {
          throw new Error("Unable to load catalog item details");
        }
        const data: CatalogItemInfo = await res.json();
        if (isMounted) {
          setItem(data);
          const rawSchema = data.intake_schema || {};
          setRawIntakeSchema(rawSchema);

          // Parse questions
          if (Array.isArray(rawSchema.questions)) {
            setQuestions(
              rawSchema.questions.map((q) => ({
                id: q.id || slugifyFieldKey(q.label || "question"),
                label: q.label || q.id || "Question",
                type: (q.type as QuestionType) || "text",
                required: Boolean(q.required),
                description: q.description || "",
                placeholder: q.placeholder || "",
                options: Array.isArray(q.options) ? q.options : [],
                default_value: q.default_value ?? "",
              }))
            );
          } else if (rawSchema.properties && typeof rawSchema.properties === "object") {
            // Backward-compatibility: synthesize initial questions from legacy properties
            const requiredSet = new Set(
              Array.isArray(rawSchema.required) ? rawSchema.required : []
            );
            const synthesized: FormQuestion[] = Object.entries(
              rawSchema.properties
            ).map(([key, prop]: [string, any]) => {
              let qType: QuestionType = "text";
              if (prop.enum && Array.isArray(prop.enum)) {
                qType = "dropdown";
              } else if (prop.type === "number" || prop.type === "integer") {
                qType = "number";
              } else if (prop.type === "string" && (prop.format === "textarea" || prop.maxLength > 200)) {
                qType = "textarea";
              }
              return {
                id: key,
                label: prop.title || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                type: qType,
                required: requiredSet.has(key),
                description: prop.description || "",
                placeholder: prop.placeholder || "",
                options: prop.enum && Array.isArray(prop.enum) ? prop.enum : [],
              };
            });
            setQuestions(synthesized);
          } else {
            setQuestions([]);
          }
          setIsDirty(false);
        }
      } catch (err) {
        if (isMounted) {
          setFetchError(err instanceof Error ? err.message : "Failed to load item");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadItem();
    return () => {
      isMounted = false;
    };
  }, [itemId]);

  // Handle BeforeUnload when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Open Add Question Modal
  const handleOpenAddModal = () => {
    setEditingIndex(null);
    setModalQuestion({
      id: "",
      label: "",
      type: "text",
      required: false,
      description: "",
      placeholder: "",
      options: [],
      default_value: "",
    });
    setModalKeyManuallyEdited(false);
    setModalError(null);
    setNewOptionInput("");
    setIsModalOpen(true);
  };

  // Open Edit Question Modal
  const handleOpenEditModal = (idx: number) => {
    setEditingIndex(idx);
    const target = questions[idx];
    setModalQuestion({
      ...target,
      options: target.options ? [...target.options] : [],
    });
    setModalKeyManuallyEdited(true);
    setModalError(null);
    setNewOptionInput("");
    setIsModalOpen(true);
  };

  // Duplicate Question
  const handleDuplicateQuestion = (idx: number) => {
    const target = questions[idx];
    let candidateKey = `${target.id}_copy`;
    let counter = 2;
    while (questions.some((q) => q.id === candidateKey)) {
      candidateKey = `${target.id}_copy_${counter}`;
      counter++;
    }

    const duplicated: FormQuestion = {
      ...target,
      id: candidateKey,
      label: `${target.label} (Copy)`,
      options: target.options ? [...target.options] : undefined,
    };

    const nextQuestions = [...questions];
    nextQuestions.splice(idx + 1, 0, duplicated);
    setQuestions(nextQuestions);
    setIsDirty(true);
    setSaveSuccess(false);
  };

  // Reorder Questions: Move Up
  const handleMoveUp = (idx: number) => {
    if (idx <= 0) return;
    const nextQuestions = [...questions];
    const temp = nextQuestions[idx - 1];
    nextQuestions[idx - 1] = nextQuestions[idx];
    nextQuestions[idx] = temp;
    setQuestions(nextQuestions);
    setIsDirty(true);
    setSaveSuccess(false);
  };

  // Reorder Questions: Move Down
  const handleMoveDown = (idx: number) => {
    if (idx >= questions.length - 1) return;
    const nextQuestions = [...questions];
    const temp = nextQuestions[idx + 1];
    nextQuestions[idx + 1] = nextQuestions[idx];
    nextQuestions[idx] = temp;
    setQuestions(nextQuestions);
    setIsDirty(true);
    setSaveSuccess(false);
  };

  // Save Modal Question
  const handleSaveModalQuestion = () => {
    setModalError(null);
    const cleanLabel = modalQuestion.label.trim();
    if (!cleanLabel) {
      setModalError("Question label cannot be empty.");
      return;
    }

    const cleanKey = (modalQuestion.id || slugifyFieldKey(cleanLabel)).trim();
    if (!cleanKey) {
      setModalError("Internal field key cannot be empty.");
      return;
    }

    if (!/^[a-z][a-z0-9_]*$/.test(cleanKey)) {
      setModalError(
        "Field key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores (e.g. laptop_type)."
      );
      return;
    }

    // Check key uniqueness
    const isDuplicateKey = questions.some((q, idx) => {
      if (editingIndex !== null && idx === editingIndex) return false;
      return q.id === cleanKey;
    });
    if (isDuplicateKey) {
      setModalError(`The field key "${cleanKey}" is already in use by another question.`);
      return;
    }

    // Validate options for choice types
    let finalOptions: string[] | undefined = undefined;
    if (["dropdown", "radio", "multiselect"].includes(modalQuestion.type)) {
      const rawOpts = modalQuestion.options || [];
      if (rawOpts.length === 0) {
        setModalError(
          `Please provide at least one option for the ${QUESTION_TYPE_META[modalQuestion.type].label} question.`
        );
        return;
      }
      if (rawOpts.some((o) => !o.trim())) {
        setModalError("Option value cannot be empty.");
        return;
      }
      const trimmedOpts = rawOpts.map((o) => o.trim());
      const lowerSet = new Set<string>();
      for (const o of trimmedOpts) {
        const lower = o.toLowerCase();
        if (lowerSet.has(lower)) {
          setModalError("Option already exists.");
          return;
        }
        lowerSet.add(lower);
      }
      finalOptions = trimmedOpts;
    }

    const updatedQuestion: FormQuestion = {
      id: cleanKey,
      label: cleanLabel,
      type: modalQuestion.type,
      required: Boolean(modalQuestion.required),
      description: modalQuestion.description?.trim() || undefined,
      placeholder: modalQuestion.placeholder?.trim() || undefined,
      options: finalOptions,
      default_value: modalQuestion.default_value !== "" ? modalQuestion.default_value : undefined,
    };

    if (editingIndex === null) {
      // Add new question
      setQuestions([...questions, updatedQuestion]);
    } else {
      // Edit existing question in-place
      const nextQuestions = [...questions];
      nextQuestions[editingIndex] = updatedQuestion;
      setQuestions(nextQuestions);
    }

    setIsModalOpen(false);
    setIsDirty(true);
    setSaveSuccess(false);
  };

  // Add Option to Modal Question
  const handleAddOption = () => {
    const trimmed = newOptionInput.trim();
    if (!trimmed) {
      setModalError("Option value cannot be empty.");
      return;
    }
    const currentOptions = modalQuestion.options || [];
    if (currentOptions.some((o) => o.trim().toLowerCase() === trimmed.toLowerCase())) {
      setModalError("Option already exists.");
      return;
    }
    setModalQuestion({
      ...modalQuestion,
      options: [...currentOptions, trimmed],
    });
    setNewOptionInput("");
    setModalError(null);
  };

  // Edit Existing Option in Modal Question
  const handleEditOption = (optIndex: number, newValue: string) => {
    const currentOptions = [...(modalQuestion.options || [])];
    currentOptions[optIndex] = newValue;
    setModalQuestion({
      ...modalQuestion,
      options: currentOptions,
    });
    if (modalError) setModalError(null);
  };

  // Remove Option from Modal Question
  const handleRemoveOption = (optIndex: number) => {
    const currentOptions = modalQuestion.options || [];
    setModalQuestion({
      ...modalQuestion,
      options: currentOptions.filter((_, idx) => idx !== optIndex),
    });
  };

  // Confirm Delete Question
  const handleConfirmDelete = () => {
    if (deletingIndex === null) return;
    const nextQuestions = questions.filter((_, idx) => idx !== deletingIndex);
    setQuestions(nextQuestions);
    setDeletingIndex(null);
    setIsDirty(true);
    setSaveSuccess(false);
  };

  // Save Complete Form Configuration
  const handleSaveForm = async () => {
    if (!itemId) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      // Validate all questions
      const seen = new Set<string>();
      for (const q of questions) {
        if (!q.label.trim()) throw new Error(`Question "${q.id}" has an empty label.`);
        if (!/^[a-z][a-z0-9_]*$/.test(q.id)) {
          throw new Error(`Field key "${q.id}" does not match safe format [a-z][a-z0-9_]*.`);
        }
        if (seen.has(q.id)) {
          throw new Error(`Duplicate field key "${q.id}" found.`);
        }
        seen.add(q.id);
        if (["dropdown", "radio", "multiselect"].includes(q.type)) {
          if (!q.options || q.options.length === 0) {
            throw new Error(`Question "${q.label}" requires at least one option.`);
          }
        }
      }

      // Generate properties map for backward compatibility with json schema consumers
      const properties: Record<string, any> = {};
      questions.forEach((q) => {
        if (q.type === "number") {
          properties[q.id] = {
            type: "number",
            title: q.label,
            description: q.description || undefined,
            placeholder: q.placeholder || undefined,
          };
        } else if (["dropdown", "radio", "multiselect"].includes(q.type)) {
          properties[q.id] = {
            type: q.type === "multiselect" ? "array" : "string",
            title: q.label,
            description: q.description || undefined,
            enum: q.options,
          };
        } else {
          properties[q.id] = {
            type: "string",
            title: q.label,
            description: q.description || undefined,
            placeholder: q.placeholder || undefined,
            format: q.type === "textarea" ? "textarea" : undefined,
          };
        }
      });

      // Construct non-destructive intake_schema
      const updatedIntakeSchema = {
        ...rawIntakeSchema,
        version: rawIntakeSchema.version || 1,
        type: rawIntakeSchema.type || "object",
        questions: questions.map((q) => ({
          id: q.id,
          label: q.label.trim(),
          type: q.type,
          required: Boolean(q.required),
          description: q.description?.trim() || undefined,
          placeholder: q.placeholder?.trim() || undefined,
          options: ["dropdown", "radio", "multiselect"].includes(q.type) ? q.options : undefined,
          default_value: q.default_value !== "" ? q.default_value : undefined,
        })),
        properties: {
          ...(rawIntakeSchema.properties || {}),
          ...properties,
        },
        required: questions.filter((q) => q.required).map((q) => q.id),
      };

      const res = await fetch(`/api/itsm/admin/service-catalog/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake_schema: updatedIntakeSchema }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to save form schema.");
      }

      const updatedItem = await res.json();
      setItem(updatedItem);
      setRawIntakeSchema(updatedItem.intake_schema || updatedIntakeSchema);
      setIsDirty(false);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error saving form");
    } finally {
      setSaving(false);
    }
  };

  // Safe navigation out if dirty
  const handleSafeNavigate = (destination: string) => {
    if (isDirty) {
      const confirmLeave = window.confirm(
        "You have unsaved changes in the form builder. Are you sure you want to leave without saving?"
      );
      if (!confirmLeave) return;
    }
    router.push(destination);
  };

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const total = questions.length;
    const required = questions.filter((q) => q.required).length;
    const optional = total - required;
    const typesBreakdown = questions.reduce((acc, q) => {
      acc[q.type] = (acc[q.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return { total, required, optional, typesBreakdown };
  }, [questions]);

  // EMPTY STATE: No item selected
  if (!itemId) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-2 text-xs text-[#6B7488]">
          <Link
            href="/itsm/catalog-manager/studio"
            className="font-semibold text-[#6D28D9] hover:underline inline-flex items-center gap-1"
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>Catalog Studio</span>
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[#0E1726] font-medium">Form Builder</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-10 shadow-xs text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-purple-50 text-[#6D28D9] border border-purple-200 flex items-center justify-center mx-auto shadow-xs">
            <FileCheck className="w-8 h-8" />
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <h1 className="text-xl font-extrabold text-[#0E1726]">
              No-Code Form Question Builder
            </h1>
            <p className="text-xs text-[#6B7488] leading-relaxed">
              Select a catalog item to configure its request form.
            </p>
          </div>

          {/* Quick Offering Selector */}
          {catalogItemsList.length > 0 && (
            <div className="max-w-md mx-auto pt-2 text-left space-y-2">
              <label className="text-[11px] font-bold text-[#475069] block">
                Choose a Catalog Offering to Configure:
              </label>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Select Catalog Item"
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] bg-[#F9FAFB] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition font-medium"
                  onChange={(e) => {
                    if (e.target.value) {
                      router.push(`/itsm/catalog-manager/form-builder?item=${e.target.value}`);
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    -- Select Catalog Offering --
                  </option>
                  {catalogItemsList.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} (/{it.slug})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="pt-4 flex items-center justify-center gap-3">
            <Link
              href="/itsm/catalog-manager/studio"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#6D28D9] text-white font-bold text-xs hover:bg-[#5B21B6] transition shadow-xs"
            >
              <Boxes className="w-4 h-4" />
              <span>Browse Catalog Items in Studio</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // LOADING STATE
  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-[#6B7488]">
        <Loader2 className="w-6 h-6 animate-spin text-[#6D28D9]" />
        <p className="text-xs font-semibold">Loading Form Builder studio...</p>
      </div>
    );
  }

  // FETCH ERROR STATE
  if (fetchError && !item) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Link
          href="/itsm/catalog-manager/studio"
          className="inline-flex items-center gap-2 text-xs font-bold text-[#6D28D9] hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Catalog Studio</span>
        </Link>
        <div className="p-6 rounded-2xl border border-red-200 bg-red-50 text-red-700 text-xs space-y-2">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>Unable to load offering</span>
          </div>
          <p>{fetchError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-[#6B7488]">
          <Link
            href="/itsm/catalog-manager/studio"
            className="font-semibold text-[#6D28D9] hover:underline inline-flex items-center gap-1"
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>Catalog Studio</span>
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          {item && (
            <>
              <button
                type="button"
                onClick={() => handleSafeNavigate(`/itsm/catalog-manager/studio/${item.id}`)}
                className="text-[#6D28D9] hover:underline truncate max-w-xs text-left"
              >
                {item.name}
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            </>
          )}
          <span className="text-[#0E1726] font-medium">Form Builder</span>
        </div>

        {/* Global Action Bar */}
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold animate-pulse">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>You have unsaved changes</span>
            </span>
          )}

          {saveSuccess && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
              <Check className="w-3.5 h-3.5" />
              <span>Saved to intake_schema</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => handleSafeNavigate(`/itsm/catalog-manager/studio/${itemId}`)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#0E1726] hover:bg-slate-50 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Offering</span>
          </button>

          <button
            type="button"
            onClick={handleSaveForm}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] disabled:opacity-50 text-white text-xs font-bold transition shadow-xs"
            id="save-form-button"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving Form...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save Form</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Target Offering Banner */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center shrink-0 text-[#6D28D9]">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#6B7488]">
              Configuring Request Form For
            </span>
            <h1 className="text-base font-extrabold text-[#0E1726]">
              {item?.name || "Catalog Offering"}
            </h1>
            <div className="flex items-center gap-2 mt-1 text-[11px] text-[#6B7488]">
              <span className="font-mono text-slate-500">/{item?.slug}</span>
              <span>·</span>
              <span>
                Questions: <strong className="text-[#0E1726]">{questions.length}</strong>
              </span>
              <span>·</span>
              <span>
                Required: <strong className="text-[#0E1726]">{summaryMetrics.required}</strong>
              </span>
              <span>·</span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  item?.is_active
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {item?.is_active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 text-[#6D28D9] text-xs font-bold border border-purple-200 self-start sm:self-center">
          <Sparkles className="w-3.5 h-3.5" />
          <span>No-Code Form Question Builder</span>
        </div>
      </div>

      {/* Save Error Banner if any */}
      {saveError && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-semibold">{saveError}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-red-500 hover:text-red-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Builder Grid: Left (Questions List) + Right (Live Preview) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Form Questions Configuration (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-sm font-bold text-[#0E1726] flex items-center gap-2">
                <span>Form Questions</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                  {questions.length}
                </span>
              </h2>
              <p className="text-[11px] text-[#6B7488]">
                Define questions requesters must answer when ordering this catalog item.
              </p>
            </div>

            <button
              type="button"
              onClick={handleOpenAddModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-bold transition shadow-xs"
              id="add-question-btn"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Question</span>
            </button>
          </div>

          {/* Questions List or Empty State */}
          {questions.length === 0 ? (
            <div
              className="bg-white rounded-2xl border border-dashed border-[#CBD5E1] p-10 text-center space-y-4 shadow-xs"
              id="questions-empty-state"
            >
              <div className="w-12 h-12 rounded-xl bg-purple-50 text-[#6D28D9] flex items-center justify-center mx-auto">
                <FileCheck className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-[#0E1726]">
                  No questions configured yet.
                </h3>
                <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
                  Add questions to define what information Requesters must provide.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenAddModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#6D28D9] text-white text-xs font-bold hover:bg-[#5B21B6] transition shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Question</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3" id="questions-list">
              {questions.map((question, idx) => {
                const typeMeta = QUESTION_TYPE_META[question.type];
                const TypeIcon = typeMeta.icon;

                return (
                  <div
                    key={question.id}
                    className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-xs hover:border-[#CBD5E1] transition group"
                    id={`question-card-${question.id}`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Reorder Buttons & Index */}
                      <div className="flex flex-col items-center gap-1 text-slate-400 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleMoveUp(idx)}
                          disabled={idx === 0}
                          aria-label={`Move question ${idx + 1} up`}
                          className="p-1 rounded-md hover:bg-slate-100 hover:text-[#0E1726] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] font-bold font-mono text-slate-500">
                          #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleMoveDown(idx)}
                          disabled={idx === questions.length - 1}
                          aria-label={`Move question ${idx + 1} down`}
                          className="p-1 rounded-md hover:bg-slate-100 hover:text-[#0E1726] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Question Details */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-[#0E1726]">
                            {question.label}
                          </span>

                          {/* Type Badge */}
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold ${typeMeta.color}`}
                          >
                            <TypeIcon className="w-3 h-3" />
                            <span>{typeMeta.label}</span>
                          </span>

                          {/* Required / Optional Badge */}
                          {question.required ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                              * Required
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-50 text-slate-600 border border-slate-200 text-[10px] font-medium">
                              Optional
                            </span>
                          )}

                          {/* Field Key Badge */}
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                            key: {question.id}
                          </span>
                        </div>

                        {/* Description / Help text if present */}
                        {question.description && (
                          <p className="text-[11px] text-[#6B7488]">
                            {question.description}
                          </p>
                        )}

                        {/* Options preview for choice questions */}
                        {question.options && question.options.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[10px] font-bold uppercase text-slate-400">
                              Options:
                            </span>
                            {question.options.map((opt, optIdx) => (
                              <span
                                key={optIdx}
                                className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 text-[#6D28D9] border border-purple-200 text-[10px] font-medium"
                              >
                                {opt}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Actions: Edit, Duplicate, Delete */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(idx)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs font-semibold text-[#0E1726] hover:bg-slate-50 transition"
                          id={`edit-question-${question.id}`}
                        >
                          <Edit2 className="w-3 h-3 text-[#6D28D9]" />
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDuplicateQuestion(idx)}
                          className="p-1.5 rounded-lg border border-[#E6E9F0] bg-white text-slate-500 hover:text-[#0E1726] hover:bg-slate-50 transition"
                          title="Duplicate question"
                          aria-label={`Duplicate question ${question.label}`}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeletingIndex(idx)}
                          className="p-1.5 rounded-lg border border-[#E6E9F0] bg-white text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition"
                          title="Delete question"
                          aria-label={`Delete question ${question.label}`}
                          id={`delete-question-${question.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Live Requester Preview & Summary Foundation (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] p-5 shadow-xs space-y-4 sticky top-6">
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#0E1726] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#6D28D9]" />
                  <span>Requester Live Preview</span>
                </h3>
                <p className="text-[11px] text-[#6B7488]">
                  How questions will render on the request submission form.
                </p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-[#6D28D9] border border-purple-200">
                Live Preview
              </span>
            </div>

            {/* Preview Form Card */}
            <div className="space-y-4 max-h-[550px] overflow-y-auto pr-1">
              {questions.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[#CBD5E1] rounded-xl text-slate-400 space-y-2">
                  <FileCheck className="w-8 h-8 mx-auto opacity-50" />
                  <p className="text-xs">No questions configured yet.</p>
                  <p className="text-[11px] text-slate-400">
                    Questions added on the left will appear here in real time.
                  </p>
                </div>
              ) : (
                questions.map((q) => (
                  <div key={`preview-${q.id}`} className="space-y-1.5">
                    <label className="block text-xs font-bold text-[#0E1726]">
                      {q.label}
                      {q.required && <span className="text-red-500"> *</span>}
                    </label>

                    {q.description && (
                      <p className="text-[11px] text-[#6B7488] leading-tight">
                        {q.description}
                      </p>
                    )}

                    {/* Input Renderers based on type */}
                    {q.type === "text" && (
                      <input
                        type="text"
                        disabled
                        placeholder={q.placeholder || "Enter text..."}
                        className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] placeholder:text-[#8C95A8] cursor-not-allowed"
                      />
                    )}

                    {q.type === "textarea" && (
                      <textarea
                        rows={2}
                        disabled
                        placeholder={q.placeholder || "Provide details..."}
                        className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] placeholder:text-[#8C95A8] cursor-not-allowed"
                      />
                    )}

                    {q.type === "number" && (
                      <input
                        type="number"
                        disabled
                        placeholder={q.placeholder || "0"}
                        className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] placeholder:text-[#8C95A8] cursor-not-allowed"
                      />
                    )}

                    {q.type === "dropdown" && (
                      <select
                        disabled
                        className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] cursor-not-allowed"
                        defaultValue=""
                      >
                        <option value="" disabled>
                          {q.placeholder || "Select an option..."}
                        </option>
                        {q.options?.map((opt, i) => (
                          <option key={i} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    )}

                    {q.type === "radio" && (
                      <div className="space-y-1.5 pt-0.5">
                        {q.options && q.options.length > 0 ? (
                          q.options.map((opt, i) => (
                            <label
                              key={i}
                              className="flex items-center gap-2 text-xs text-[#475069] cursor-not-allowed"
                            >
                              <input
                                type="radio"
                                name={`preview-${q.id}`}
                                disabled
                                className="w-3.5 h-3.5 text-[#6D28D9]"
                              />
                              <span>{opt}</span>
                            </label>
                          ))
                        ) : (
                          <p className="text-[11px] text-slate-400 italic">No options configured yet.</p>
                        )}
                      </div>
                    )}

                    {q.type === "multiselect" && (
                      <div className="space-y-1.5 pt-0.5">
                        {q.options && q.options.length > 0 ? (
                          q.options.map((opt, i) => (
                            <label
                              key={i}
                              className="flex items-center gap-2 text-xs text-[#475069] cursor-not-allowed"
                            >
                              <input
                                type="checkbox"
                                disabled
                                className="w-3.5 h-3.5 rounded text-[#6D28D9]"
                              />
                              <span>{opt}</span>
                            </label>
                          ))
                        ) : (
                          <p className="text-[11px] text-slate-400 italic">No options configured yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Summary Foundation Metrics */}
            <div className="border-t border-[#E6E9F0] pt-3 text-[11px] text-[#6B7488] space-y-1">
              <div className="flex items-center justify-between">
                <span>Total Form Questions:</span>
                <span className="font-bold text-[#0E1726]">{summaryMetrics.total}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Required Questions:</span>
                <span className="font-bold text-rose-600">{summaryMetrics.required}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Optional Questions:</span>
                <span className="font-bold text-slate-600">{summaryMetrics.optional}</span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span>Storage Schema:</span>
                <span className="font-mono text-[#6D28D9] font-semibold text-[10px]">
                  intake_schema.questions[]
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ADD / EDIT QUESTION MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            className="bg-white rounded-2xl border border-[#E6E9F0] shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-5"
            id="question-editor-modal"
          >
            <div className="flex items-center justify-between border-b border-[#E6E9F0] pb-3">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-[#6D28D9]" />
                <h3 className="text-sm font-bold text-[#0E1726]">
                  {editingIndex === null ? "Add Form Question" : "Edit Form Question"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-[#0E1726] transition p-1"
                aria-label="Close question editor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs flex items-center gap-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Question Label */}
              <div>
                <label className="block text-xs font-bold text-[#0E1726] mb-1">
                  Question Label <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={modalQuestion.label}
                  placeholder="e.g. Laptop Type, Department, Justification"
                  onChange={(e) => {
                    const nextLabel = e.target.value;
                    const nextState: FormQuestion = {
                      ...modalQuestion,
                      label: nextLabel,
                    };
                    if (!modalKeyManuallyEdited) {
                      nextState.id = slugifyFieldKey(nextLabel);
                    }
                    setModalQuestion(nextState);
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition font-medium"
                  id="modal-question-label-input"
                />
              </div>

              {/* Internal Field Key */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-[#0E1726]">
                    Internal Field Key <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">
                    regex: ^[a-z][a-z0-9_]*$
                  </span>
                </div>
                <input
                  type="text"
                  required
                  value={modalQuestion.id}
                  placeholder="e.g. laptop_type, department"
                  onChange={(e) => {
                    setModalKeyManuallyEdited(true);
                    setModalQuestion({
                      ...modalQuestion,
                      id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
                    });
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] font-mono focus:outline-none focus:border-[#6D28D9] transition"
                  id="modal-field-key-input"
                />
                <span className="text-[10px] text-[#6B7488] mt-1 block">
                  Machine-friendly identifier stored in schema (e.g., &quot;quantity&quot;).
                </span>
              </div>

              {/* Question Type Selection */}
              <div>
                <label className="block text-xs font-bold text-[#0E1726] mb-1">
                  Question Type <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(Object.keys(QUESTION_TYPE_META) as QuestionType[]).map((typeKey) => {
                    const meta = QUESTION_TYPE_META[typeKey];
                    const Icon = meta.icon;
                    const isSelected = modalQuestion.type === typeKey;

                    return (
                      <button
                        key={typeKey}
                        type="button"
                        onClick={() => {
                          setModalQuestion({
                            ...modalQuestion,
                            type: typeKey,
                            options: modalQuestion.options || [],
                          });
                        }}
                        className={`p-2.5 rounded-xl border text-left transition flex items-start gap-2 ${
                          isSelected
                            ? "border-[#6D28D9] bg-purple-50/50 text-[#0E1726]"
                            : "border-[#E6E9F0] bg-white text-[#475069] hover:bg-slate-50"
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 shrink-0 mt-0.5 ${
                            isSelected ? "text-[#6D28D9]" : "text-slate-400"
                          }`}
                        />
                        <div className="min-w-0">
                          <span className="text-xs font-bold block">{meta.label}</span>
                          <span className="text-[10px] text-[#6B7488] line-clamp-1">
                            {meta.description}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Options Editor (Only for Dropdown, Radio, Multi-Select) */}
              {["dropdown", "radio", "multiselect"].includes(modalQuestion.type) && (
                <div className="p-4 rounded-xl border border-[#E6E9F0] bg-[#F9FAFB] space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#0E1726]">
                      Answer Options <span className="text-red-500">*</span>
                    </label>
                    <span className="text-[10px] text-[#6B7488]" id="modal-options-count">
                      {(modalQuestion.options || []).length} configured
                    </span>
                  </div>

                  {/* Options List */}
                  {(modalQuestion.options || []).length > 0 && (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5" id="modal-options-list">
                      {(modalQuestion.options || []).map((opt, optIdx) => (
                        <div
                          key={optIdx}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E6E9F0] text-xs text-[#0E1726] shadow-2xs group focus-within:border-[#6D28D9] transition"
                        >
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => handleEditOption(optIdx, e.target.value)}
                            className="flex-1 min-w-0 bg-transparent text-xs text-[#0E1726] font-medium focus:outline-none"
                            placeholder="Option text..."
                            id={`modal-option-input-${optIdx}`}
                            aria-label={`Option ${optIdx + 1}`}
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveOption(optIdx)}
                            className="text-slate-400 hover:text-red-600 transition p-1 rounded hover:bg-slate-50 shrink-0"
                            title="Remove option"
                            aria-label={`Remove option ${opt || optIdx + 1}`}
                            id={`modal-remove-option-${optIdx}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Option Input */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Add an option..."
                      value={newOptionInput}
                      onChange={(e) => {
                        setNewOptionInput(e.target.value);
                        if (modalError) setModalError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddOption();
                        }
                      }}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-[#E6E9F0] bg-white text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9]"
                      id="modal-new-option-input"
                    />
                    <button
                      type="button"
                      onClick={handleAddOption}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#0E1726] transition shrink-0"
                      id="modal-add-option-btn"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Option</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Required Toggle */}
              <div className="p-3.5 rounded-xl border border-[#E6E9F0] bg-[#F9FAFB] flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-[#0E1726] block">
                    Required Question
                  </span>
                  <span className="text-[11px] text-[#6B7488] block">
                    Requesters must answer this question to submit the request.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={modalQuestion.required}
                  onChange={(e) =>
                    setModalQuestion({
                      ...modalQuestion,
                      required: e.target.checked,
                    })
                  }
                  className="w-4 h-4 rounded text-[#6D28D9] focus:ring-[#6D28D9]"
                  id="modal-required-toggle"
                />
              </div>

              {/* Description / Help text (optional) */}
              <div>
                <label className="block text-xs font-bold text-[#0E1726] mb-1">
                  Help Text / Description <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={modalQuestion.description || ""}
                  placeholder="e.g. Specify any accessories needed"
                  onChange={(e) =>
                    setModalQuestion({
                      ...modalQuestion,
                      description: e.target.value,
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                />
              </div>

              {/* Placeholder text (optional for text/textarea/number/dropdown) */}
              <div>
                <label className="block text-xs font-bold text-[#0E1726] mb-1">
                  Placeholder Text <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={modalQuestion.placeholder || ""}
                  placeholder="e.g. Select option or enter value..."
                  onChange={(e) =>
                    setModalQuestion({
                      ...modalQuestion,
                      placeholder: e.target.value,
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E6E9F0] text-xs text-[#0E1726] focus:outline-none focus:border-[#6D28D9] transition"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#E6E9F0]">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#475069] hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModalQuestion}
                className="px-4 py-2 rounded-xl bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-bold transition shadow-xs"
                id="modal-save-question-btn"
              >
                {editingIndex === null ? "Add Question" : "Update Question"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            className="bg-white rounded-2xl border border-[#E6E9F0] shadow-xl w-full max-w-md p-6 space-y-4"
            id="delete-confirm-modal"
          >
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#0E1726]">Delete this question?</h3>
            </div>

            <p className="text-xs text-[#6B7488] leading-relaxed">
              Removing this question will remove it from the catalog item&apos;s request form:
              <br />
              <strong className="text-[#0E1726] mt-1 block">
                &ldquo;{questions[deletingIndex]?.label}&rdquo;
              </strong>
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#E6E9F0]">
              <button
                type="button"
                onClick={() => setDeletingIndex(null)}
                className="px-4 py-2 rounded-xl border border-[#E6E9F0] bg-white text-xs font-bold text-[#475069] hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-xs"
                id="confirm-delete-btn"
              >
                Delete Question
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CatalogManagerFormBuilderPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-xs text-[#6B7488]">
          Loading Form Builder studio...
        </div>
      }
    >
      <FormBuilderCoreContent />
    </Suspense>
  );
}
