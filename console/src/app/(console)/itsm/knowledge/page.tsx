"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileText,
  HelpCircle,
  LifeBuoy,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  ThumbsUp,
  X,
} from "lucide-react";

interface KBArticle {
  id: string;
  title: string;
  category: string;
  readTime: string;
  views: string;
  summary: string;
  content: string;
  steps: string[];
}

export default function KnowledgePage() {
  const [articles, setArticles] = useState<KBArticle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeArticle, setActiveArticle] = useState<KBArticle | null>(null);
  const [helpfulFeedback, setHelpfulFeedback] = useState<boolean | null>(null);

  const fetchArticles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/itsm/knowledge", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/itsm/login";
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "Failed to load knowledge base");
      }
      const data = await res.json();
      const mapped: KBArticle[] = (Array.isArray(data) ? data : []).map((item: any) => ({
        id: item.id,
        title: item.title,
        category: item.category || "General",
        readTime: item.read_time || "3 min read",
        views: item.views_label || `${item.view_count || 0} views`,
        summary: item.summary || item.title,
        content: item.content || "",
        steps: Array.isArray(item.steps) ? item.steps : [],
      }));
      setArticles(mapped);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge base");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const recordHelpful = async (articleId: string) => {
    setHelpfulFeedback(true);
    await fetch(`/api/itsm/knowledge/${articleId}/helpful`, { method: "POST" }).catch(() => undefined);
  };

  const categories = ["All", "Networking", "Authentication", "Security", "DevOps & Cloud"];

  const filteredArticles = articles.filter((art) => {
    const matchesCategory =
      selectedCategory === "All" ||
      art.category.toLowerCase().includes(selectedCategory.toLowerCase());
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      art.title.toLowerCase().includes(q) ||
      art.summary.toLowerCase().includes(q) ||
      art.content.toLowerCase().includes(q) ||
      art.category.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#1E40AF] to-[#3B82F6] rounded-2xl p-6 sm:p-8 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-semibold backdrop-blur-sm">
            <BookOpen className="w-3.5 h-3.5" />
            <span>Self-Service Knowledge Base</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Verified Resolution Guides &amp; Documentation
          </h1>
          <p className="text-sm text-blue-100 max-w-xl">
            Search verified IT operational guides, VPN configurations, and SSO troubleshooting steps before filing a support ticket.
          </p>
        </div>

        <div className="shrink-0">
          <Link
            href="/itsm/incidents/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#1E40AF] font-bold text-xs hover:bg-blue-50 transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Still Need Help? Report Issue</span>
          </Link>
        </div>
      </div>

      {/* Category Pills & Search */}
      <div className="bg-white rounded-2xl border border-[#E6E9F0] p-4 shadow-sm space-y-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[#F0F2F6]">
          {categories.map((cat) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
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

        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search guides, VPN, Okta SSO, YubiKey..."
              className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl pl-9 pr-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
            />
          </div>

          <button
            onClick={fetchArticles}
            className="p-2 text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-xl border border-[#E6E9F0] transition"
            title="Refresh knowledge base"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchArticles}
            className="text-xs font-bold text-red-800 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Articles Grid / Loading / Empty State */}
      {loading && articles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center text-xs text-[#6B7488]">
          <RefreshCw className="w-5 h-5 text-[#6D28D9] animate-spin mx-auto mb-2" />
          <span>Loading database-backed knowledge base articles...</span>
        </div>
      ) : filteredArticles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E6E9F0] p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#F5F7FA] text-[#6B7488] flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[#0E1726]">No articles found</h3>
          <p className="text-xs text-[#6B7488] max-w-sm mx-auto">
            {searchQuery
              ? "No knowledge base articles match your search criteria."
              : "No published articles available for this category."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredArticles.map((article) => (
            <div
              key={article.id}
              onClick={() => {
                setActiveArticle(article);
                setHelpfulFeedback(null);
              }}
              className="bg-white rounded-2xl border border-[#E6E9F0] hover:border-[#A78BFA] p-6 shadow-sm hover:shadow-md transition cursor-pointer flex flex-col justify-between space-y-4 group"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-[#6B7488]">
                  <span className="font-bold text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-full border border-[#A78BFA]">
                    {article.category}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3 text-[#6B7488]" /> {article.views}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-[#0E1726] group-hover:text-[#6D28D9] transition">
                  {article.title}
                </h3>

                <p className="text-xs text-[#6B7488] leading-relaxed line-clamp-2">
                  {article.summary}
                </p>
              </div>

              <div className="pt-3 border-t border-[#F0F2F6] flex items-center justify-between text-xs">
                <span className="text-[#6B7488] text-[11px]">{article.readTime}</span>
                <span className="font-semibold text-[#6D28D9] flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  Read Guide <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Article Detail Modal / Drawer */}
      {activeArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-[#E6E9F0] shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-[#E6E9F0] flex items-start justify-between gap-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#6D28D9] bg-[#F1ECFE] px-2.5 py-0.5 rounded-full border border-[#A78BFA]">
                  {activeArticle.category}
                </span>
                <h2 className="text-lg font-extrabold text-[#0E1726] mt-2">{activeArticle.title}</h2>
                <div className="flex items-center gap-3 text-xs text-[#6B7488] mt-1">
                  <span>{activeArticle.readTime}</span>
                  <span>•</span>
                  <span>{activeArticle.views}</span>
                </div>
              </div>

              <button
                onClick={() => setActiveArticle(null)}
                className="p-1 text-[#6B7488] hover:text-[#0E1726] hover:bg-[#F5F7FA] rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              <p className="text-[#475069] text-xs leading-relaxed bg-[#FBFAF9] p-4 rounded-xl border border-[#E6E9F0]">
                {activeArticle.content}
              </p>

              {activeArticle.steps.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase text-[#0E1726] tracking-wider mb-3">
                    Step-by-Step Resolution Steps
                  </h4>
                  <div className="space-y-2.5">
                    {activeArticle.steps.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 rounded-xl border border-[#F0F2F6] bg-white">
                        <span className="w-5 h-5 rounded-full bg-[#6D28D9] text-white font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="text-[#0E1726] text-xs leading-relaxed">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-[#F9FAFB] border-t border-[#E6E9F0] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[#6B7488]">Did this article solve your issue?</span>
                <button
                  onClick={() => recordHelpful(activeArticle.id)}
                  className={`px-3 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
                    helpfulFeedback === true
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : "bg-white text-[#475069] border-[#E6E9F0] hover:bg-[#F5F7FA]"
                  }`}
                >
                  <ThumbsUp className="w-3.5 h-3.5" /> {helpfulFeedback ? "Thanks!" : "Yes"}
                </button>
              </div>

              <Link
                href="/itsm/incidents/new"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#6D28D9] text-white rounded-xl text-xs font-bold hover:bg-[#5B21B6] transition"
              >
                <span>Report an Issue Instead</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
