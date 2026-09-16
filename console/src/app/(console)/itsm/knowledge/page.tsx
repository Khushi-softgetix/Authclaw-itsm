"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileText,
  HelpCircle,
  LifeBuoy,
  Plus,
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

const KNOWLEDGE_ARTICLES: KBArticle[] = [
  {
    id: "kb-001",
    title: "Connecting to Corporate WireGuard VPN",
    category: "Networking",
    readTime: "3 min read",
    views: "1,240 views",
    summary: "Step-by-step setup for WireGuard VPN client across macOS, Windows, and Linux workstations.",
    content: "AuthClaw corporate network access requires an encrypted WireGuard VPN tunnel for remote connectivity. Ensure you have your tenant client configuration file before starting.",
    steps: [
      "Download and install the official WireGuard client from wireguard.com.",
      "Open WireGuard and select 'Add Tunnel' -> 'Import Tunnel from File'.",
      "Select your '.conf' certificate downloaded from the Service Catalog.",
      "Toggle the tunnel active and verify connection status via ping 10.0.0.1.",
    ],
  },
  {
    id: "kb-002",
    title: "Requesting Temporary Cloud Sandbox IAM Roles",
    category: "DevOps & Cloud",
    readTime: "4 min read",
    views: "890 views",
    summary: "How to request time-bound AWS IAM credentials with pre-configured developer policies.",
    content: "Developer cloud sandboxes provide isolated AWS environments for testing AI models and microservices. Access expires automatically after 8 hours unless extended.",
    steps: [
      "Navigate to Service Catalog -> AWS Account & IAM Sandbox Access.",
      "Select your required cloud region and sandbox project code.",
      "Submit request for manager approval or automated entitlement check.",
      "Retrieve your short-lived STS credentials from the active session tab.",
    ],
  },
  {
    id: "kb-003",
    title: "Troubleshooting Okta Single Sign-On (SSO) Sessions",
    category: "Authentication",
    readTime: "2 min read",
    views: "2,410 views",
    summary: "Resolving session cookie timeouts, MFA loop prompts, and browser cache conflicts.",
    content: "If you experience infinite redirect loops during Okta authentication, follow these quick remediation steps before submitting an IT ticket.",
    steps: [
      "Clear browser cookies and cache for *.authclaw.com and your identity provider.",
      "Disable third-party tracking blocker extensions temporarily.",
      "Ensure your computer clock is synchronized with UTC network time.",
      "Attempt logging in using a private or incognito window.",
    ],
  },
  {
    id: "kb-004",
    title: "Setting Up Hardware Security Keys (YubiKey)",
    category: "Security",
    readTime: "5 min read",
    views: "640 views",
    summary: "Registering FIDO2 / WebAuthn YubiKey devices for passwordless MFA.",
    content: "Hardware security keys protect your account against phishing and credential theft by establishing cryptographic binding during sign-in.",
    steps: [
      "Plug your YubiKey into a USB-A / USB-C port on your workstation.",
      "Go to Account Settings -> Security & MFA -> Add Hardware Key.",
      "Touch the gold contact point on your key when prompted by the browser.",
      "Save your one-time backup recovery codes in a secure secret manager.",
    ],
  },
  {
    id: "kb-005",
    title: "Configuring Workstation WiFi & WPA3 Enterprise",
    category: "Networking",
    readTime: "2 min read",
    views: "520 views",
    summary: "Connecting your laptop to the secure office corporate WiFi network.",
    content: "AuthClaw office wireless networks utilize 802.1X EAP-TLS certificate authentication for high-speed local connectivity.",
    steps: [
      "Select 'AuthClaw-Corporate' from your operating system WiFi menu.",
      "Enter your SSO corporate username and current account password.",
      "Accept the network RADIUS root certificate when prompted.",
    ],
  },
];

export default function KnowledgePage() {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeArticle, setActiveArticle] = useState<KBArticle | null>(null);
  const [helpfulFeedback, setHelpfulFeedback] = useState<boolean | null>(null);

  const categories = ["All", "Networking", "Authentication", "Security", "DevOps & Cloud"];

  const filteredArticles = KNOWLEDGE_ARTICLES.filter((art) => {
    const matchesCategory = selectedCategory === "All" || art.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      art.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      art.summary.toLowerCase().includes(searchQuery.toLowerCase());
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

        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#6B7488]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search guides, VPN, Okta SSO, YubiKey..."
            className="w-full bg-[#FBFAF9] border border-[#E6E9F0] rounded-xl pl-9 pr-3 py-2 text-xs text-[#0E1726] focus:bg-white focus:ring-1 focus:ring-[#6D28D9] focus:outline-none"
          />
        </div>
      </div>

      {/* Articles Grid */}
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
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-[#F9FAFB] border-t border-[#E6E9F0] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[#6B7488]">Did this article solve your issue?</span>
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
