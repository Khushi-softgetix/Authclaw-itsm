"use client";

import React, { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Lock, Mail, ShieldAlert, Ticket } from "lucide-react";
import { marketingRoutes } from "@/marketing/config";

export default function ItsmLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("email") || "";
  });
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [resetMode, setResetMode] = useState<"login" | "request" | "confirm">("login");
  const [resetSignupId, setResetSignupId] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "access_denied") {
      return "Your account does not have access to AuthClaw ITSM. Please contact your workspace administrator or sign in to AuthClaw Governance.";
    }
    return params.get("sso_error");
  });
  const [message, setMessage] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("setup") === "success") {
      return "Account setup completed! Please sign in with your new password.";
    }
    return null;
  });
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      window.sessionStorage.removeItem("authclaw_onboarding_result");
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, tenantName: tenantName || undefined }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.detail || "Authentication failed");
      }

      if (data.user?.productAccess && data.user.productAccess.itsm === false) {
        setError("Your account does not have access to AuthClaw ITSM. Please contact your workspace administrator or sign in to AuthClaw Governance.");
        return;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const explicitReturnTo = searchParams.get("returnTo") || searchParams.get("redirect");
      const role = (data.user?.itsmRole || "REQUESTER").toUpperCase();
      let defaultRoute = "/itsm/dashboard/service-agent";
      switch (role) {
        case "PLATFORM_ADMINISTRATOR":
          defaultRoute = "/itsm/admin-portal";
          break;
        case "INCIDENT_MANAGER":
        case "SERVICE_LEAD":
          defaultRoute = "/itsm/incident-manager";
          break;
        case "SERVICE_AGENT":
          defaultRoute = "/itsm/dashboard/service-agent";
          break;
        case "REQUESTER":
          defaultRoute = "/itsm/dashboard/requester";
          break;
        case "PROCESS_CHANGE_MANAGER":
          defaultRoute = "/itsm/dashboard/process-change";
          break;
        case "AUDITOR":
          defaultRoute = "/itsm/dashboard/auditor";
          break;
      }
      const returnTo = explicitReturnTo || defaultRoute;
      const safeRedirect = returnTo.startsWith("/itsm") && !returnTo.startsWith("//") ? returnTo : defaultRoute;
      router.push(safeRedirect);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const startSso = () => {
    setError(null);
    setMessage(null);
    const params = new URLSearchParams();
    if (tenantName.trim()) params.set("tenantName", tenantName.trim());
    params.set("returnTo", "/itsm/incidents");
    window.location.href = `/api/auth/oidc/start?${params.toString()}`;
  };

  const requestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tenantName: tenantName || undefined }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.detail || "Could not start password reset");
      }
      if (data.signup_id) {
        setResetSignupId(data.signup_id);
        setResetMode("confirm");
        setMessage(
          data.delivery === "local_outbox"
            ? "Reset email written to .authclaw/email-outbox.jsonl."
            : "Check your email for the password reset code."
        );
      } else {
        setResetMode("login");
        setMessage("If that account exists, a reset code has been sent.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start password reset");
    } finally {
      setLoading(false);
    }
  };

  const confirmPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      if (newPassword.length < 12) throw new Error("Password must be at least 12 characters.");
      if (newPassword !== confirmPassword) throw new Error("Passwords do not match.");
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signup_id: resetSignupId, otp: resetOtp, password: newPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.detail || "Could not reset password");
      }
      setPassword("");
      setResetOtp("");
      setNewPassword("");
      setConfirmPassword("");
      setResetSignupId("");
      setResetMode("login");
      setMessage("Password updated. Sign in with your new password.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen w-full bg-[#FBFAF9] text-[#0E1726] font-sans">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-5 py-12">
        <div className="w-full max-w-[440px] rounded-[20px] border border-[#E6E9F0] bg-white px-6 py-8 shadow-[0_1px_2px_rgba(11,31,63,.05),0_12px_30px_-12px_rgba(11,31,63,.18)]">
          {/* Header */}
          <div className="flex flex-col items-center mb-8 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-[14px] bg-[#6D28D9] shadow-[0_8px_20px_-8px_rgba(109,40,217,.6)] mb-3">
              <Ticket className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0E1726]">
              AuthClaw ITSM
            </h1>
            <p className="text-xs text-[#6B7488] mt-1">
              Sign in to your ITSM workspace
            </p>
          </div>

          {error && (
            <div className={`p-4 mb-6 rounded-[12px] text-xs space-y-2.5 ${
              error.includes("does not have access")
                ? "bg-amber-50/90 border border-amber-200 text-amber-900"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}>
              <div className="flex items-start gap-2.5">
                <ShieldAlert className={`w-4.5 h-4.5 flex-shrink-0 mt-0.5 ${
                  error.includes("does not have access") ? "text-amber-600" : "text-red-600"
                }`} />
                <div>
                  {error.includes("does not have access") && (
                    <p className="font-semibold text-amber-950 mb-0.5">ITSM Access Denied</p>
                  )}
                  <span className="leading-relaxed">{error}</span>
                </div>
              </div>
              {error.includes("does not have access") && (
                <div className="pt-2 border-t border-amber-200/60 flex flex-col gap-1.5 pl-7">
                  <Link
                    href="/overview"
                    className="font-semibold text-[#6D28D9] hover:underline inline-flex items-center gap-1"
                  >
                    Go to AuthClaw AI Governance Console &rarr;
                  </Link>
                  <Link
                    href="/"
                    className="text-[#6B7488] hover:text-[#0E1726] hover:underline"
                  >
                    Return to AuthClaw Home
                  </Link>
                </div>
              )}
            </div>
          )}

          {message && (
            <div className="mb-6 rounded-[10px] border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800">
              {message}
            </div>
          )}

          {resetMode === "login" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="itsm-email">
                  Work Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6B7488]">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="itsm-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@company.com"
                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-[#0E1726]" htmlFor="itsm-password">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetMode("request");
                      setError(null);
                      setMessage(null);
                    }}
                    className="text-[11px] font-medium text-[#6D28D9] hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6B7488]">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="itsm-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="itsm-tenant">
                  Workspace / Tenant <span className="text-[#6B7488] font-normal">(Optional)</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6B7488]">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <input
                    id="itsm-tenant"
                    type="text"
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    placeholder="your-company (if shared email)"
                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 px-4 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold rounded-[10px] shadow-[0_8px_20px_-8px_rgba(109,40,217,.6)] transition flex items-center justify-center disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Login to ITSM"
                )}
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#E6E9F0]" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase">
                  <span className="bg-white px-2 text-[#6B7488] font-semibold tracking-wider">Or</span>
                </div>
              </div>

              <button
                type="button"
                onClick={startSso}
                className="w-full py-2.5 px-4 bg-white hover:bg-[#F5F7FA] text-[#0E1726] border border-[#E6E9F0] text-xs font-semibold rounded-[10px] transition"
              >
                Sign in with Single Sign-On (SSO)
              </button>
            </form>
          ) : resetMode === "request" ? (
            <form onSubmit={requestPasswordReset} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="itsm-reset-email">
                  Account Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6B7488]">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="itsm-reset-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@company.com"
                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="itsm-reset-tenant">
                  Workspace / Tenant <span className="text-[#6B7488] font-normal">(Optional)</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6B7488]">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <input
                    id="itsm-reset-tenant"
                    type="text"
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    placeholder="your-company (if shared email)"
                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold rounded-[10px] transition flex items-center justify-center disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Send Reset Code"
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setResetMode("login");
                  setError(null);
                  setMessage(null);
                }}
                className="w-full py-2 text-xs font-medium text-[#475069] hover:text-[#0E1726]"
              >
                Back to Sign In
              </button>
            </form>
          ) : (
            <form onSubmit={confirmPasswordReset} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="itsm-reset-otp">
                  Verification Code
                </label>
                <input
                  id="itsm-reset-otp"
                  type="text"
                  required
                  value={resetOtp}
                  onChange={(e) => setResetOtp(e.target.value)}
                  placeholder="6-digit reset code"
                  className="w-full px-3 py-2.5 bg-white border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="itsm-new-password">
                  New Password <span className="text-[#6B7488] font-normal">(min 12 chars)</span>
                </label>
                <input
                  id="itsm-new-password"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2.5 bg-white border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="itsm-confirm-password">
                  Confirm Password
                </label>
                <input
                  id="itsm-confirm-password"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2.5 bg-white border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold rounded-[10px] transition flex items-center justify-center disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Update Password & Sign In"
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setResetMode("login");
                  setError(null);
                  setMessage(null);
                }}
                className="w-full py-2 text-xs font-medium text-[#475069] hover:text-[#0E1726]"
              >
                Cancel
              </button>
            </form>
          )}

          {/* Product links & context footer */}
          <div className="mt-8 pt-6 border-t border-[#E6E9F0] text-center space-y-2">
            <p className="text-xs text-[#6B7488]">
              Looking for AI Governance?{" "}
              <Link href={marketingRoutes.login} className="text-[#6D28D9] font-semibold hover:underline">
                Sign in to Governance Console
              </Link>
            </p>
            <p className="text-[11px] text-[#6B7488]">
              <Link href={marketingRoutes.itsm} className="hover:text-[#0E1726] hover:underline">
                ← Back to AuthClaw ITSM
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
