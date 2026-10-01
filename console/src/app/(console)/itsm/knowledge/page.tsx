"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Edit3,
  Eye,
  FileCheck,
  FileText,
  History,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Tag,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  KBArticleItem,
  KBArticleGovernanceDetail,
  KBArticleVersionSummary,
  CreateKBArticlePayload,
  UpdateKBArticlePayload,
} from "@/lib/itsm-types";

function formatDate(isoString?: string | null): string {
  if (!isoString) return "Recently updated";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "Recently updated";
  }
}

function formatDateTime(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function KnowledgePageContent() {
  const searchParams = useSearchParams();
  const incidentParam = searchParams.get("incident");
  const requestParam = searchParams.get("request");
  const initialQuery = searchParams.get("search") || searchParams.get("q") || "";

  // Session / Role
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  // Articles & Filters
  const [articles, setArticles] = useState<KBArticleItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active article detail (for both Consumer Modal and Governance Drawer)
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [articleDetail, setArticleDetail] = useState<KBArticleGovernanceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [helpfulFeedback, setHelpfulFeedback] = useState<boolean | null>(null);
  const [selectedPreviewVersion, setSelectedPreviewVersion] = useState<KBArticleVersionSummary | null>(null);

  // Modals for PCM
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Create Form State
  const [createTitle, setCreateTitle] = useState("");
  const [createCategory, setCreateCategory] = useState("Troubleshooting");
  const [createSummary, setCreateSummary] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [createKeywords, setCreateKeywords] = useState("");

  // Edit Form State
  const [editArticleId, setEditArticleId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("Troubleshooting");
  const [editSummary, setEditSummary] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editChangeNote, setEditChangeNote] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const categories = ["All", "Networking", "Authentication", "Security", "Troubleshooting", "DevOps & Cloud"];
  const statusTabs = [
    { label: "All", value: "ALL" },
    { label: "Published", value: "PUBLISHED" },
    { label: "Draft", value: "DRAFT" },
    { label: "Archived", value: "ARCHIVED" },
  ];

  const isPCM = currentUserRole === "PROCESS_CHANGE_MANAGER";
  const isServiceAgent = currentUserRole === "SERVICE_AGENT";

  // Check current session role
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.itsmRole) {
          setCurrentUserRole(data.itsmRole);
        }
      })
      .catch(() => {});
  }, []);

  const fetchArticles = useCallback(
    async (query = searchQuery, category = selectedCategory, statusFilter = selectedStatus) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("search", query.trim());
        if (category && category !== "All") params.set("category", category);
        if (statusFilter && statusFilter !== "ALL") {
          params.set("status", statusFilter);
        } else if (isPCM) {
          params.set("status", "ALL");
        }

        const res = await fetch(`/api/itsm/knowledge?${params.toString()}`);
        if (res.status === 401) {
          window.location.href = "/itsm/login";
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || data.detail || "Failed to load knowledge articles");
        }
        const data = await res.json();
        setArticles(Array.isArray(data) ? data : []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to load knowledge articles at this time. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [searchQuery, selectedCategory, selectedStatus, isPCM]
  );

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const openArticle = async (id: string) => {
    setActiveArticleId(id);
    setDetailLoading(true);
    setDetailError(null);
    setHelpfulFeedback(null);
    setSelectedPreviewVersion(null);
    try {
      const res = await fetch(`/api/itsm/knowledge/${encodeURIComponent(id)}`);
      if (!res.ok) {
        throw new Error("Failed to load article detail");
      }
      const data = await res.json();
      setArticleDetail(data);
    } catch {
      setDetailError("Unable to load the requested article. Please try again.");
    } finally {
      setDetailLoading(false);
    }
  };

  const recordHelpful = async (articleId: string) => {
    setHelpfulFeedback(true);
    await fetch(`/api/itsm/knowledge/${articleId}/helpful`, { method: "POST" }).catch(() => undefined);
  };

  const closeArticle = () => {
    setActiveArticleId(null);
    setArticleDetail(null);
    setDetailError(null);
    setSelectedPreviewVersion(null);
  };

  const handleOpenEdit = (article: KBArticleItem | KBArticleGovernanceDetail) => {
    setEditArticleId(article.id);
    setEditTitle(article.title);
    setEditCategory(article.category);
    setEditSummary(article.summary || "");
    setEditChangeNote("");
    if ("content_markdown" in article) {
      setEditContent(article.content_markdown);
      setEditKeywords(Array.isArray(article.keywords) ? article.keywords.join(", ") : "");
    } else {
      // Fetch detail if needed
      fetch(`/api/itsm/knowledge/${encodeURIComponent(article.id)}`)
        .then((r) => r.json())
        .then((detail) => {
          setEditContent(detail.content_markdown || "");
          setEditKeywords(Array.isArray(detail.keywords) ? detail.keywords.join(", ") : "");
        })
        .catch(() => {});
    }
    setShowEditModal(true);
  };

  const handleCreateArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createTitle.trim() || !createContent.trim()) return;

    setActionLoading(true);
    setActionError(null);
    try {
      const payload: CreateKBArticlePayload = {
        title: createTitle.trim(),
        category: createCategory,
        summary: createSummary.trim() || null,
        content_markdown: createContent,
        keywords: createKeywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      };

      const res = await fetch("/api/itsm/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to create knowledge article");
      }

      setShowCreateModal(false);
      setCreateTitle("");
      setCreateSummary("");
      setCreateContent("");
      setCreateKeywords("");
      await fetchArticles();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to create article");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editArticleId || !editTitle.trim()) return;

    setActionLoading(true);
    setActionError(null);
    try {
      const payload: UpdateKBArticlePayload = {
        title: editTitle.trim(),
        category: editCategory,
        summary: editSummary.trim() || null,
        content_markdown: editContent,
        change_summary: editChangeNote.trim() || undefined,
        keywords: editKeywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      };

      const res = await fetch(`/api/itsm/knowledge/${encodeURIComponent(editArticleId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to update knowledge article");
      }

      const updated = await res.json();
      setShowEditModal(false);
      setArticleDetail(updated);
      await fetchArticles();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to update article");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePublish = async (articleId: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/itsm/knowledge/${encodeURIComponent(articleId)}/publish`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to publish article");
      }
      const updated = await res.json();
      setArticleDetail(updated);
      await fetchArticles();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to publish article");
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchive = async (articleId: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/itsm/knowledge/${encodeURIComponent(articleId)}/archive`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to archive article");
      }
      const updated = await res.json();
      setArticleDetail(updated);
      await fetchArticles();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to archive article");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDraft = async (articleId: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/itsm/knowledge/${encodeURIComponent(articleId)}/draft`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to return article to draft");
      }
      const updated = await res.json();
      setArticleDetail(updated);
      await fetchArticles();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to return article to draft");
    } finally {
      setActionLoading(false);
    }
  };

  // Render Status Badge
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "PUBLISHED":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> Published
          </span>
        );
      case "DRAFT":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200">
            <Clock className="w-3 h-3" /> Draft
          </span>
        );
      case "ARCHIVED":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-300">
            <Archive className="w-3 h-3" /> Archived
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto" id="itsm-knowledge-container">
      {/* Context Banners for Incident / Request References */}
      {incidentParam && (
        <div
          id="incident-context-banner"
          className="bg-[#F1ECFE] border border-[#A78BFA] text-[#4C1D95] rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            <BookOpen className="w-4 h-4 text-[#6D28D9] shrink-0" />
            <span>Consulting Knowledge for Incident reference</span>
          </div>
          <Link
            href={`/itsm/incidents/${incidentParam}`}
            id="return-to-incident-link"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold transition shadow-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Incident</span>
          </Link>
        </div>
      )}

      {requestParam && (
        <div
          id="request-context-banner"
          className="bg-[#F1ECFE] border border-[#A78BFA] text-[#4C1D95] rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            <BookOpen className="w-4 h-4 text-[#6D28D9] shrink-0" />
            <span>Consulting Knowledge for Service Request reference</span>
          </div>
          <Link
            href={`/itsm/requests/${requestParam}`}
            id="return-to-request-link"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold transition shadow-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Request</span>
          </Link>
        </div>
      )}

      {/* HEADER SECTION */}
      {isPCM ? (
        /* Problem and Change Manager Governance Header */
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#DDCEFB] text-[#6D28D9] flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-[11px] font-semibold mb-1 border border-[#DDD6FE]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Knowledge Governance</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight">
                Knowledge
              </h1>
              <p className="text-xs text-[#6B7488] mt-1">
                Review, maintain, and govern ITSM knowledge.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              id="pcm-create-article-btn"
              onClick={() => {
                setShowCreateModal(true);
                setActionError(null);
              }}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Article</span>
            </button>
          </div>
        </div>
      ) : isServiceAgent ? (
        /* Standard Consumer Hero Header (Service Agents) */
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#DDCEFB] text-[#6D28D9] flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-[11px] font-semibold mb-1 border border-[#DDD6FE]">
                <span>Verified Knowledge Base</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-[#0E1726] tracking-tight">
                IT Operations &amp; Resolution Guides
              </h1>
              <p className="text-xs text-[#6B7488] mt-1 max-w-xl">
                Search verified resolution procedures, VPN configurations, and SSO diagnostic steps while troubleshooting incidents.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <Link
              href="/itsm/incidents/new"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>Need Help? Report Issue</span>
            </Link>
          </div>
        </div>
      ) : (
        /* Requester Portal Hero Header */
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white rounded-[20px] border border-[#E6E9F0] p-6 shadow-sm">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#DDCEFB] text-[#6D28D9] flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F1ECFE] text-[#6D28D9] text-[11px] font-semibold mb-1 border border-[#DDD6FE]">
                <span>Verified Knowledge Base</span>
              </div>
              <h1 className="text-xl font-extrabold text-[#0E1726] tracking-tight">
                IT Operations &amp; Resolution Guides
              </h1>
              <p className="text-xs text-[#6B7488] mt-1 max-w-xl">
                Search verified resolution procedures, VPN configurations, and SSO diagnostic steps while troubleshooting incidents.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <Link
              href="/itsm/incidents/new"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#6D28D9] hover:bg-[#5B21B6] text-white rounded-xl text-xs font-bold shadow-sm transition"
            >
              <Plus className="w-4 h-4" />
              <span>Need Help? Report Issue</span>
            </Link>
          </div>
        </div>
      )}

      {/* FILTER & SEARCH CONTROLS */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-xs space-y-4">
        {/* Governance Status Tabs for Problem and Change Manager */}
        {isPCM && (
          <div className="flex items-center gap-2 pb-3 border-b border-[#F0F2F6] overflow-x-auto">
            <span className="text-xs font-bold text-[#6B7488] uppercase tracking-wider mr-2 shrink-0">
              Status:
            </span>
            {statusTabs.map((tab) => {
              const active = selectedStatus === tab.value;
              return (
                <button
                  key={tab.value}
                  id={`pcm-status-tab-${tab.value.toLowerCase()}`}
                  onClick={() => {
                    setSelectedStatus(tab.value);
                    fetchArticles(searchQuery, selectedCategory, tab.value);
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition shrink-0 ${
                    active
                      ? "bg-[#6D28D9] text-white shadow-xs"
                      : "text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA]"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Category Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[#F0F2F6]">
          <span className="text-xs font-bold text-[#6B7488] uppercase tracking-wider mr-2 shrink-0">
            Category:
          </span>
          {categories.map((cat) => {
            const active = selectedCategory.toLowerCase() === cat.toLowerCase();
            return (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  fetchArticles(searchQuery, cat, selectedStatus);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                  active
                    ? "bg-[#F1ECFE] text-[#6D28D9] border border-[#A78BFA]"
                    : "text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA]"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
            <input
              id="knowledge-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") fetchArticles(searchQuery, selectedCategory, selectedStatus);
              }}
              placeholder="Search articles by title, keyword, slug, or content..."
              className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl pl-9 pr-8 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  fetchArticles("", selectedCategory, selectedStatus);
                }}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            id="knowledge-search-button"
            onClick={() => fetchArticles(searchQuery, selectedCategory, selectedStatus)}
            className="px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold rounded-xl transition shadow-xs"
          >
            Search
          </button>
        </div>
      </div>

      {/* CONTENT LIST / TABLE */}
      {loading ? (
        <div id="knowledge-loading-state" className="py-16 text-center space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-[#6D28D9] mx-auto" />
          <p className="text-xs font-medium text-[#6B7488]">Loading knowledge articles...</p>
        </div>
      ) : error ? (
        <div
          id="knowledge-error-state"
          className="bg-rose-50/70 border border-rose-200 rounded-2xl p-6 text-center space-y-3"
        >
          <AlertCircle className="w-6 h-6 text-rose-600 mx-auto" />
          <h3 className="text-sm font-bold text-rose-900">Unable to Load Knowledge Articles</h3>
          <p className="text-xs text-rose-700">{error}</p>
          <button
            id="retry-knowledge-btn"
            onClick={() => fetchArticles()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : articles.length === 0 ? (
        <div
          id="knowledge-empty-state"
          className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center space-y-3 shadow-xs"
        >
          <BookOpen className="w-8 h-8 text-[#6B7488] mx-auto opacity-50" />
          <h3 className="text-sm font-bold text-[#0E1726]">No Articles Found</h3>
          <p className="text-xs text-[#6B7488]">
            {searchQuery
              ? `No articles match "${searchQuery}".`
              : "No knowledge articles match the current filter criteria."}
          </p>
          {isPCM && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#6D28D9] text-white rounded-xl text-xs font-semibold shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Article</span>
            </button>
          )}
        </div>
      ) : isPCM ? (
        /* Problem and Change Manager Governance Queue Table */
        <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse" id="pcm-knowledge-queue-table">
              <thead>
                <tr className="border-b border-[#E6E9F0] bg-[#FAFBFD] text-[11px] font-bold text-[#6B7488] uppercase tracking-wider">
                  <th className="py-3 px-4">Article</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Version</th>
                  <th className="py-3 px-3">Author</th>
                  <th className="py-3 px-3">Views</th>
                  <th className="py-3 px-3">Updated</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F2F6] text-xs">
                {articles.map((article) => (
                  <tr
                    key={article.id}
                    id={`pcm-article-row-${article.id}`}
                    className="hover:bg-[#F9FAFC] transition cursor-pointer"
                    onClick={() => openArticle(article.id)}
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-[#0E1726] hover:text-[#6D28D9] transition">
                        {article.title}
                      </div>
                      <div className="text-[11px] text-[#6B7488] font-mono mt-0.5 truncate max-w-xs">
                        {article.slug}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      {renderStatusBadge(article.status)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="font-semibold text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-full text-[11px]">
                        {article.category}
                      </span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-[#475069]">
                      v{article.current_published_version || article.version_number || 1}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-[#475069] text-[11px]">
                      {article.author_email || "System"}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-[#475069] text-[11px]">
                      {article.view_count || 0}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-[#6B7488] text-[11px]">
                      {formatDate(article.updated_at)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        id={`pcm-view-article-btn-${article.id}`}
                        onClick={() => openArticle(article.id)}
                        className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-[#E6E9F0] text-[#0E1726] font-semibold rounded-lg text-[11px] transition shadow-2xs"
                      >
                        Review
                      </button>
                      <button
                        id={`pcm-edit-article-btn-${article.id}`}
                        onClick={() => handleOpenEdit(article)}
                        className="px-2.5 py-1 bg-[#F1ECFE] hover:bg-[#E4DAFB] text-[#6D28D9] font-semibold rounded-lg text-[11px] transition shadow-2xs"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Standard Consumer Card Grid (Service Agent / Requester) */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="knowledge-articles-grid">
          {articles.map((article) => (
            <div
              key={article.id}
              id={`article-card-${article.id}`}
              onClick={() => openArticle(article.id)}
              className="bg-white rounded-2xl border border-[#E6E9F0] hover:border-[#A78BFA] p-6 shadow-xs hover:shadow-md transition cursor-pointer flex flex-col justify-between space-y-4 group"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-[#6B7488]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-full border border-[#A78BFA]">
                      {article.category}
                    </span>
                    {article.status ? renderStatusBadge(article.status) : null}
                  </div>
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3 text-[#6B7488]" /> {article.view_count || 0} views
                  </span>
                </div>

                <h3 className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition">
                  {article.title}
                </h3>

                <p className="text-xs text-[#6B7488] leading-relaxed line-clamp-2">
                  {article.summary || "Click to view full troubleshooting instructions and resolution steps."}
                </p>
              </div>

              <div className="pt-3 border-t border-[#F0F2F6] flex items-center justify-between text-[11px] text-[#6B7488]">
                <span>Updated {formatDate(article.updated_at)}</span>
                <span className="flex items-center gap-1 text-[#6D28D9] font-bold group-hover:translate-x-0.5 transition">
                  Read Guide <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ARTICLE DETAIL MODAL (Supports both Governance Drawer and Consumer View) */}
      {activeArticleId && (
        <div
          id={isPCM ? "pcm-article-governance-modal" : "article-detail-modal"}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] shadow-xl flex flex-col overflow-hidden border border-[#E6E9F0]">
            {detailLoading ? (
              <div className="p-12 text-center space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin text-[#6D28D9] mx-auto" />
                <p className="text-xs text-[#6B7488]">Loading article details...</p>
              </div>
            ) : detailError ? (
              <div className="p-8 text-center space-y-3">
                <AlertCircle className="w-6 h-6 text-rose-600 mx-auto" />
                <p className="text-xs text-rose-700">{detailError}</p>
                <button
                  onClick={closeArticle}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-xs font-semibold rounded-xl"
                >
                  Close
                </button>
              </div>
            ) : articleDetail ? (
              <>
                {/* Modal Header */}
                <div className="p-6 border-b border-[#E6E9F0] flex items-start justify-between gap-4 bg-[#FAFBFD]">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-full border border-[#A78BFA]">
                        {articleDetail.category}
                      </span>
                      {articleDetail.status ? renderStatusBadge(articleDetail.status) : null}
                      <span className="text-[11px] font-mono text-[#6B7488] bg-slate-100 px-2 py-0.5 rounded">
                        v{articleDetail.current_published_version || articleDetail.version_number || 1}
                      </span>
                    </div>
                    <h2 className="text-lg font-extrabold text-[#0E1726]">{articleDetail.title}</h2>
                    <div className="flex items-center gap-3 text-xs text-[#6B7488] flex-wrap">
                      <span>Updated {formatDate(articleDetail.updated_at)}</span>
                      <span>•</span>
                      <span>{articleDetail.view_count || 0} views</span>
                      {articleDetail.author_email && (
                        <>
                          <span>•</span>
                          <span>Author: {articleDetail.author_email}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={closeArticle}
                    id="close-article-detail-btn"
                    className="p-1.5 text-[#6B7488] hover:text-[#0E1726] hover:bg-slate-100 rounded-lg transition"
                    title="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
                  {/* Governance Quality Assessment Banner for PCM */}
                  {isPCM && (
                    <div className="bg-[#FAFBFD] border border-[#E6E9F0] rounded-xl p-4 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#0E1726]">
                        <FileCheck className="w-4 h-4 text-[#6D28D9]" />
                        <span>Knowledge Quality &amp; Governance Review</span>
                      </div>
                      <p className="text-[11px] text-[#6B7488] leading-relaxed">
                        Verify this article meets ITSM documentation standards: accurate, current, useful, and properly categorized. Revisions preserve complete version history.
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-[11px]">
                        <div className="bg-white p-2 rounded-lg border border-[#E6E9F0]">
                          <span className="text-[#6B7488] block text-[10px]">Current Status</span>
                          <span className="font-bold text-[#0E1726]">{articleDetail.status}</span>
                        </div>
                        <div className="bg-white p-2 rounded-lg border border-[#E6E9F0]">
                          <span className="text-[#6B7488] block text-[10px]">Published Rev</span>
                          <span className="font-bold text-[#0E1726]">
                            {articleDetail.current_published_version ? `v${articleDetail.current_published_version}` : "Not Published"}
                          </span>
                        </div>
                        <div className="bg-white p-2 rounded-lg border border-[#E6E9F0]">
                          <span className="text-[#6B7488] block text-[10px]">Latest Rev</span>
                          <span className="font-bold text-[#0E1726]">v{articleDetail.version_number}</span>
                        </div>
                        <div className="bg-white p-2 rounded-lg border border-[#E6E9F0]">
                          <span className="text-[#6B7488] block text-[10px]">Published Date</span>
                          <span className="font-bold text-[#0E1726]">{formatDate(articleDetail.published_at)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Summary Box */}
                  {articleDetail.summary && (
                    <div className="p-3.5 bg-[#FBFAF9] rounded-xl border border-[#E6E9F0] text-[#475069] leading-relaxed italic">
                      {articleDetail.summary}
                    </div>
                  )}

                  {/* Version Preview Alert if viewing an old version */}
                  {selectedPreviewVersion && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Viewing historical <strong>Version {selectedPreviewVersion.version_number}</strong> ({formatDateTime(selectedPreviewVersion.created_at)})</span>
                      </div>
                      <button
                        onClick={() => setSelectedPreviewVersion(null)}
                        className="text-xs font-bold text-amber-800 underline hover:text-amber-900"
                      >
                        Reset to Current
                      </button>
                    </div>
                  )}

                  {/* Markdown Content */}
                  <div className="prose prose-slate max-w-none text-xs leading-relaxed whitespace-pre-wrap text-[#0E1726] font-sans border-b border-[#F0F2F6] pb-6" id="article-markdown-body">
                    {selectedPreviewVersion
                      ? selectedPreviewVersion.content_markdown
                      : articleDetail.content_markdown}
                  </div>

                  {/* Version History Section (for PCM) */}
                  {isPCM && articleDetail.versions && articleDetail.versions.length > 0 && (
                    <div className="space-y-3 pt-2" id="pcm-version-history-section">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#0E1726]">
                        <History className="w-4 h-4 text-[#6D28D9]" />
                        <span>Revision History ({articleDetail.versions.length} versions)</span>
                      </div>
                      <div className="space-y-2">
                        {articleDetail.versions.map((ver) => {
                          const isCurrentActive =
                            ver.version_number ===
                            (articleDetail.current_published_version || articleDetail.version_number);
                          const isPreviewing =
                            selectedPreviewVersion?.version_number === ver.version_number;

                          return (
                            <div
                              key={ver.id}
                              className={`p-3 rounded-xl border text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition ${
                                isPreviewing
                                  ? "bg-amber-50/60 border-amber-300"
                                  : isCurrentActive
                                  ? "bg-[#F1ECFE]/40 border-[#A78BFA]"
                                  : "bg-white border-[#E6E9F0]"
                              }`}
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-[#0E1726]">v{ver.version_number}</span>
                                  {isCurrentActive && (
                                    <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
                                      Active Version
                                    </span>
                                  )}
                                  <span className="text-[#6B7488]">• {formatDateTime(ver.created_at)}</span>
                                  {ver.created_by_email && (
                                    <span className="text-[#6B7488]">• by {ver.created_by_email}</span>
                                  )}
                                </div>
                                <p className="text-[#475069] italic">
                                  {ver.change_summary || "Revision update"}
                                </p>
                              </div>

                              <button
                                onClick={() =>
                                  setSelectedPreviewVersion(
                                    isPreviewing ? null : ver
                                  )
                                }
                                className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-[#E6E9F0] text-[#0E1726] rounded-lg font-semibold text-[11px] shrink-0"
                              >
                                {isPreviewing ? "View Active" : "Preview Revision"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Modal Footer & Governance Actions */}
                <div className="p-4 bg-[#F9FAFB] border-t border-[#E6E9F0] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  {isPCM ? (
                    /* Problem and Change Manager Governance Action Bar */
                    <div className="flex items-center gap-2 w-full justify-between flex-wrap">
                      <div className="text-[11px] text-[#6B7488]">
                        Governed under ITSM Problem &amp; Change policy
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Edit Button */}
                        <button
                          id="pcm-edit-article-btn"
                          onClick={() => handleOpenEdit(articleDetail)}
                          disabled={actionLoading}
                          className="px-3.5 py-1.5 bg-[#F1ECFE] hover:bg-[#E4DAFB] text-[#6D28D9] font-bold rounded-xl transition shadow-2xs inline-flex items-center gap-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Article</span>
                        </button>

                        {/* Publish Button (Draft or Updated) */}
                        {articleDetail.status !== "PUBLISHED" ? (
                          <button
                            id="pcm-publish-article-btn"
                            onClick={() => handlePublish(articleDetail.id)}
                            disabled={actionLoading}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition shadow-2xs inline-flex items-center gap-1.5"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Publish Article</span>
                          </button>
                        ) : (
                          /* Archive Button */
                          <button
                            id="pcm-archive-article-btn"
                            onClick={() => handleArchive(articleDetail.id)}
                            disabled={actionLoading}
                            className="px-3.5 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl transition shadow-2xs inline-flex items-center gap-1.5"
                          >
                            <Archive className="w-3.5 h-3.5" />
                            <span>Retire / Archive</span>
                          </button>
                        )}

                        {/* Return to Draft if Archived */}
                        {articleDetail.status === "ARCHIVED" && (
                          <button
                            id="pcm-draft-article-btn"
                            onClick={() => handleDraft(articleDetail.id)}
                            disabled={actionLoading}
                            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl transition shadow-2xs inline-flex items-center gap-1.5"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>Return to Draft</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Standard Consumer Feedback Bar */
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[#6B7488]">Was this article helpful?</span>
                        <button
                          onClick={() => activeArticleId && recordHelpful(activeArticleId)}
                          className={`px-3 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
                            helpfulFeedback === true
                              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                              : "bg-white text-[#475069] border-[#E6E9F0] hover:bg-[#F5F7FA]"
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" /> {helpfulFeedback ? "Thanks!" : "Yes"}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={closeArticle}
                          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-xs font-semibold rounded-xl text-[#0E1726] transition"
                        >
                          Done Reading
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* CREATE ARTICLE MODAL */}
      {showCreateModal && (
        <div
          id="pcm-create-article-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-xl flex flex-col overflow-hidden border border-[#E6E9F0]">
            <div className="p-5 border-b border-[#E6E9F0] flex items-center justify-between bg-[#FAFBFD]">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#6D28D9]" />
                <h3 className="text-sm font-extrabold text-[#0E1726]">Create Knowledge Article</h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-[#6B7488] hover:text-[#0E1726] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateArticle} className="p-5 space-y-4 text-xs overflow-y-auto max-h-[80vh]">
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl">
                  {actionError}
                </div>
              )}

              <div className="space-y-1">
                <label className="font-bold text-[#0E1726]">Title *</label>
                <input
                  id="pcm-new-title-input"
                  type="text"
                  required
                  placeholder="e.g. VPN Connectivity Diagnostics & MTU Tuning"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-[#0E1726]">Category *</label>
                  <select
                    id="pcm-new-category-select"
                    value={createCategory}
                    onChange={(e) => setCreateCategory(e.target.value)}
                    className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  >
                    <option value="Networking">Networking</option>
                    <option value="Authentication">Authentication</option>
                    <option value="Security">Security</option>
                    <option value="Troubleshooting">Troubleshooting</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-[#0E1726]">Keywords (comma-separated)</label>
                  <input
                    id="pcm-new-keywords-input"
                    type="text"
                    placeholder="vpn, wireguard, network, mtu"
                    value={createKeywords}
                    onChange={(e) => setCreateKeywords(e.target.value)}
                    className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#0E1726]">Summary (Optional excerpt)</label>
                <textarea
                  id="pcm-new-summary-input"
                  rows={2}
                  placeholder="Brief synopsis displayed in article search cards..."
                  value={createSummary}
                  onChange={(e) => setCreateSummary(e.target.value)}
                  className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#0E1726]">Article Content (Markdown) *</label>
                <textarea
                  id="pcm-new-content-input"
                  rows={8}
                  required
                  placeholder="# Guide Title&#10;&#10;## Diagnostic Steps&#10;1. Check ping latency&#10;2. Verify route table"
                  value={createContent}
                  onChange={(e) => setCreateContent(e.target.value)}
                  className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs font-mono text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-[#E6E9F0] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-xs font-semibold rounded-xl text-[#0E1726]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="pcm-submit-create-article-btn"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-bold rounded-xl shadow-xs transition"
                >
                  {actionLoading ? "Creating Draft..." : "Save as Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT ARTICLE MODAL (CREATES NEW IMMUTABLE VERSION) */}
      {showEditModal && (
        <div
          id="pcm-edit-article-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-xl flex flex-col overflow-hidden border border-[#E6E9F0]">
            <div className="p-5 border-b border-[#E6E9F0] flex items-center justify-between bg-[#FAFBFD]">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#6D28D9]" />
                <h3 className="text-sm font-extrabold text-[#0E1726]">Edit Knowledge Article (New Revision)</h3>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-[#6B7488] hover:text-[#0E1726] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateArticle} className="p-5 space-y-4 text-xs overflow-y-auto max-h-[80vh]">
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl">
                  {actionError}
                </div>
              )}

              <div className="space-y-1">
                <label className="font-bold text-[#0E1726]">Title *</label>
                <input
                  id="pcm-edit-title-input"
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-[#0E1726]">Category *</label>
                  <select
                    id="pcm-edit-category-select"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                  >
                    <option value="Networking">Networking</option>
                    <option value="Authentication">Authentication</option>
                    <option value="Security">Security</option>
                    <option value="Troubleshooting">Troubleshooting</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-[#0E1726]">Change Note / Revision Summary *</label>
                  <input
                    id="pcm-edit-change-note-input"
                    type="text"
                    required
                    placeholder="e.g. Updated diagnostic MTU steps following CHG-001"
                    value={editChangeNote}
                    onChange={(e) => setEditChangeNote(e.target.value)}
                    className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none font-semibold text-purple-900"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#0E1726]">Summary (Excerpt)</label>
                <textarea
                  id="pcm-edit-summary-input"
                  rows={2}
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#0E1726]">Article Content (Markdown) *</label>
                <textarea
                  id="pcm-edit-content-input"
                  rows={8}
                  required
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs font-mono text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#0E1726]">Keywords (comma-separated)</label>
                <input
                  id="pcm-edit-keywords-input"
                  type="text"
                  value={editKeywords}
                  onChange={(e) => setEditKeywords(e.target.value)}
                  className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl px-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-[#E6E9F0] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-xs font-semibold rounded-xl text-[#0E1726]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="pcm-submit-edit-article-btn"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-bold rounded-xl shadow-xs transition"
                >
                  {actionLoading ? "Saving Revision..." : "Save Revision"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-xs text-[#6B7488]">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#6D28D9] mb-2" />
          <span>Loading knowledge management...</span>
        </div>
      }
    >
      <KnowledgePageContent />
    </Suspense>
  );
}
