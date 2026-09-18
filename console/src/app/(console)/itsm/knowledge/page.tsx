"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  ChevronRight,
  Eye,
  FileText,
  Plus,
  RefreshCw,
  Search,
  ThumbsUp,
  X,
  AlertCircle,
} from "lucide-react";

interface KBArticleSummary {
  id: string;
  title: string;
  slug: string;
  category: string;
  status: string;
  summary?: string | null;
  view_count: number;
  helpful_count: number;
  author_id?: string | null;
  author_email?: string | null;
  published_at?: string | null;
  updated_at: string;
}

interface KBArticleDetail extends KBArticleSummary {
  content_markdown: string;
  version_number: number;
  keywords: string[];
}

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

function KnowledgePageContent() {
  const searchParams = useSearchParams();
  const incidentParam = searchParams.get("incident");
  const requestParam = searchParams.get("request");
  const initialQuery = searchParams.get("search") || searchParams.get("q") || "";

  const [articles, setArticles] = useState<KBArticleSummary[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active article detail
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [articleDetail, setArticleDetail] = useState<KBArticleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [helpfulFeedback, setHelpfulFeedback] = useState<boolean | null>(null);

  const categories = ["All", "Networking", "Authentication", "Security", "Troubleshooting"];

  const fetchArticles = useCallback(async (query = searchQuery, category = selectedCategory) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (category && category !== "All") params.set("category", category);

      const res = await fetch(`/api/itsm/knowledge?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to load knowledge articles");
      }
      const data = await res.json();
      setArticles(Array.isArray(data) ? data : []);
    } catch {
      setError("Unable to load knowledge articles at this time. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedCategory]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const openArticle = async (id: string) => {
    setActiveArticleId(id);
    setDetailLoading(true);
    setDetailError(null);
    setHelpfulFeedback(null);
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

  const closeArticle = () => {
    setActiveArticleId(null);
    setArticleDetail(null);
    setDetailError(null);
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto" id="service-agent-knowledge-page">
      {/* Optional Incident Referencing Context Banner */}
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

      {/* Optional Request Referencing Context Banner */}
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

      {/* Hero Header */}
      <div className="bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] rounded-2xl p-6 sm:p-8 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <BookOpen className="w-3.5 h-3.5" />
            <span>Verified Knowledge Base</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            IT Operations &amp; Resolution Guides
          </h1>
          <p className="text-sm text-blue-100 max-w-xl">
            Search verified resolution procedures, VPN configurations, and SSO diagnostic steps while troubleshooting incidents.
          </p>
        </div>

        <div className="shrink-0">
          <Link
            href="/itsm/incidents/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#1E40AF] font-bold text-xs hover:bg-blue-50 transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Need Help? Report Issue</span>
          </Link>
        </div>
      </div>

      {/* Category Pills & Search */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-sm space-y-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[#F0F2F6]">
          {categories.map((cat) => {
            const active = selectedCategory.toLowerCase() === cat.toLowerCase();
            return (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  fetchArticles(searchQuery, cat);
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

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
            <input
              id="knowledge-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") fetchArticles(searchQuery, selectedCategory);
              }}
              placeholder="Search articles: VPN, Okta SSO, YubiKey, Network..."
              className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl pl-9 pr-8 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  fetchArticles("", selectedCategory);
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
            onClick={() => fetchArticles(searchQuery, selectedCategory)}
            className="px-4 py-2 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold rounded-xl transition shadow-xs"
          >
            Search
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        /* Loading State */
        <div id="knowledge-loading-state" className="py-12 text-center space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-[#6D28D9] mx-auto" />
          <p className="text-xs font-medium text-[#6B7488]">Loading knowledge articles...</p>
        </div>
      ) : error ? (
        /* Error State */
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
        searchQuery ? (
          /* Search Empty State */
          <div
            id="knowledge-search-empty-state"
            className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center space-y-3 shadow-xs"
          >
            <Search className="w-8 h-8 text-[#6B7488] mx-auto opacity-50" />
            <h3 className="text-sm font-bold text-[#0E1726]">No Articles Found</h3>
            <p className="text-xs text-[#6B7488]">
              No articles match your search for <span className="font-semibold text-[#0E1726]">"{searchQuery}"</span>.
            </p>
            <button
              id="clear-search-btn"
              onClick={() => {
                setSearchQuery("");
                setSelectedCategory("All");
                fetchArticles("", "All");
              }}
              className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl border border-[#E6E9F0] text-xs font-semibold text-[#0E1726] hover:bg-slate-50 transition"
            >
              Clear Search &amp; Show All
            </button>
          </div>
        ) : (
          /* Global Empty State */
          <div
            id="knowledge-empty-state"
            className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center space-y-3 shadow-xs"
          >
            <BookOpen className="w-8 h-8 text-[#6B7488] mx-auto opacity-50" />
            <h3 className="text-sm font-bold text-[#0E1726]">No Knowledge Articles Published Yet</h3>
            <p className="text-xs text-[#6B7488]">
              Verified IT guides and resolution documentation will appear here once published.
            </p>
          </div>
        )
      ) : (
        /* Articles Grid */
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
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                      {article.status}
                    </span>
                  </div>
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3 text-[#6B7488]" /> {article.view_count || 0} views
                  </span>
                </div>

                <h3 className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition">
                  {article.title}
                </h3>

                <p className="text-xs text-[#6B7488] leading-relaxed line-clamp-2">
                  {article.summary || "No summary provided."}
                </p>
              </div>

              <div className="pt-3 border-t border-[#F0F2F6] flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 text-[#6B7488] text-[11px]">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDate(article.updated_at)}
                  </span>
                  {article.author_email && (
                    <span className="truncate max-w-[140px]" title={`Author: ${article.author_email}`}>
                      By {article.author_email}
                    </span>
                  )}
                </div>
                <span className="font-semibold text-[#6D28D9] flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  Read Guide <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Article Detail View / Modal */}
      {activeArticleId && (
        <div
          id="article-detail-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div
            id="article-detail-modal"
            className="bg-white rounded-2xl border border-[#E6E9F0] shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden"
          >
            {detailLoading ? (
              <div className="p-12 text-center space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin text-[#6D28D9] mx-auto" />
                <p className="text-xs text-[#6B7488]">Loading article content...</p>
              </div>
            ) : detailError ? (
              <div className="p-8 text-center space-y-3">
                <AlertCircle className="w-6 h-6 text-rose-600 mx-auto" />
                <p className="text-xs text-rose-700">{detailError}</p>
                <div className="flex justify-center gap-2">
                  <button
                    onClick={() => openArticle(activeArticleId)}
                    className="px-3 py-1.5 bg-[#6D28D9] text-white rounded-xl text-xs font-semibold"
                  >
                    Retry
                  </button>
                  <button
                    onClick={closeArticle}
                    className="px-3 py-1.5 border border-[#E6E9F0] rounded-xl text-xs text-[#0E1726]"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : articleDetail ? (
              <>
                {/* Modal Header */}
                <div className="p-6 border-b border-[#E6E9F0] flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-full border border-[#A78BFA]">
                        {articleDetail.category}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                        {articleDetail.status}
                      </span>
                    </div>
                    <h2 className="text-lg font-extrabold text-[#0E1726]">{articleDetail.title}</h2>
                    <div className="flex items-center gap-3 text-xs text-[#6B7488] flex-wrap">
                      <span>Updated {formatDate(articleDetail.updated_at)}</span>
                      <span>•</span>
                      <span>{articleDetail.view_count || 0} views</span>
                      <span>•</span>
                      <span>v{articleDetail.version_number || 1}</span>
                      {articleDetail.author_email && (
                        <>
                          <span>•</span>
                          <span title={`Author ID: ${articleDetail.author_id}`}>
                            Author: {articleDetail.author_email}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={closeArticle}
                    id="close-article-detail-btn"
                    className="p-1.5 text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-lg transition"
                    title="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs" id="article-markdown-body">
                  {articleDetail.summary && (
                    <div className="p-3.5 bg-[#FBFAF9] rounded-xl border border-[#E6E9F0] text-[#475069] leading-relaxed italic">
                      {articleDetail.summary}
                    </div>
                  )}

                  <div className="prose prose-slate max-w-none text-xs leading-relaxed whitespace-pre-wrap text-[#0E1726] font-sans">
                    {articleDetail.content_markdown}
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="p-4 bg-[#F9FAFB] border-t border-[#E6E9F0] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[#6B7488]">Was this article helpful?</span>
                    <button
                      onClick={() => setHelpfulFeedback(true)}
                      className={`px-3 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
                        helpfulFeedback === true
                          ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                          : "bg-white text-[#475069] border-[#E6E9F0] hover:bg-[#F5F7FA]"
                      }`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" /> Yes
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {incidentParam && (
                      <Link
                        href={`/itsm/incidents/${incidentParam}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6D28D9] text-white rounded-xl text-xs font-bold hover:bg-[#5B21B6] transition"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back to Incident</span>
                      </Link>
                    )}
                    {requestParam && (
                      <Link
                        href={`/itsm/requests/${requestParam}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6D28D9] text-white rounded-xl text-xs font-bold hover:bg-[#5B21B6] transition"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back to Request</span>
                      </Link>
                    )}
                    <button
                      onClick={closeArticle}
                      id="back-to-knowledge-btn"
                      className="px-3.5 py-1.5 rounded-xl border border-[#E6E9F0] bg-white text-xs font-semibold text-[#0E1726] hover:bg-slate-50 transition"
                    >
                      Back to Knowledge
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-xs text-[#6B7488]">Loading Knowledge Base...</div>}>
      <KnowledgePageContent />
    </Suspense>
  );
}
