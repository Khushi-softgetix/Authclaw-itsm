"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  PRIVACY_NOTICE_VERSION,
  TERMS_VERSION,
} from "@/marketing/legal-config";

function ItsmActivationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const inviteId = searchParams.get("invite") || "";
  const emailParam = searchParams.get("email") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<"validation" | "expired" | "revoked" | "used" | "locked" | "server" | null>(null);
  const [success, setSuccess] = useState(false);
  const [activatedRole, setActivatedRole] = useState<string | null>(null);
  const [redirectSeconds, setRedirectSeconds] = useState(4);

  // Auto-redirect to login on success
  useEffect(() => {
    if (!success) return;
    const interval = setInterval(() => {
      setRedirectSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          const loginUrl = emailParam
            ? `/itsm/login?email=${encodeURIComponent(emailParam)}&setup=success`
            : `/itsm/login?setup=success`;
          router.push(loginUrl);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [success, emailParam, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrorType(null);

    // Validation
    if (!token.trim()) {
      setError("Missing or invalid activation token. Please open the activation link directly from your invitation email.");
      setErrorType("validation");
      return;
    }

    if (!password) {
      setError("Please enter a new password.");
      setErrorType("validation");
      return;
    }

    if (password.length < 12) {
      setError("Password must be at least 12 characters long.");
      setErrorType("validation");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match. Please re-enter your confirmation password.");
      setErrorType("validation");
      return;
    }

    if (!termsAccepted) {
      setError("You must accept the Terms of Use and Privacy Notice to proceed.");
      setErrorType("validation");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/itsm/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          password: password,
          confirm_password: confirmPassword,
          signup_id: inviteId || undefined,
          email: emailParam || undefined,
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          privacy_notice_acknowledged: true,
          privacy_notice_version: PRIVACY_NOTICE_VERSION,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = (data.detail || data.message || "").toLowerCase();
        if (detail.includes("expired")) {
          setError("This activation link has expired (links are valid for 24 hours). Please contact your Platform Administrator to request a new invitation.");
          setErrorType("expired");
        } else if (detail.includes("revoked")) {
          setError("This invitation has been revoked by your administrator. Please contact your administrator for a new invitation.");
          setErrorType("revoked");
        } else if (detail.includes("already") || detail.includes("used")) {
          setError("This activation link has already been used. Your account is active. Please proceed to the sign-in page.");
          setErrorType("used");
        } else if (detail.includes("replaced") || detail.includes("superseded")) {
          setError("This invitation has been replaced by a newer invitation link. Please check your inbox for the most recent email.");
          setErrorType("revoked");
        } else if (detail.includes("locked") || detail.includes("too many")) {
          setError("Too many failed activation attempts. For security, this invitation is locked. Please request a new invitation from your administrator.");
          setErrorType("locked");
        } else {
          setError(data.detail || data.message || "Activation failed. Please ensure your link is valid or request a new invitation.");
          setErrorType("server");
        }
        return;
      }

      setSuccess(true);
      if (data.itsm_role) {
        setActivatedRole(data.itsm_role);
      }
    } catch {
      setError("Unable to connect to the activation service. Please check your internet connection and try again.");
      setErrorType("server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-[#E6E9F0] bg-white p-8 shadow-xl">
      {/* Brand Header */}
      <div className="flex items-center gap-3 pb-6 border-b border-[#F0F2F5]">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#4F46E5] flex items-center justify-center text-white shadow-md shadow-[#6D28D9]/20">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#6D28D9]">
            AuthClaw ITSM
          </span>
          <h1 className="text-lg font-bold text-[#0E1726]">
            Activate Your Account
          </h1>
        </div>
      </div>

      {/* Success State */}
      {success ? (
        <div className="py-6 space-y-5 text-center">
          <div className="w-14 h-14 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto text-[#059669]">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-[#0E1726]">
              Account Activated Successfully!
            </h2>
            <p className="text-xs text-[#6B7488] leading-relaxed">
              Your password has been configured. You are now ready to sign in to the AuthClaw ITSM portal.
            </p>
          </div>

          {emailParam && (
            <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-mono text-[#334155]">
              {emailParam}
            </div>
          )}

          {activatedRole && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]">
              <span>Assigned Role:</span>
              <span>{activatedRole.replace(/_/g, " ")}</span>
            </div>
          )}

          <div className="pt-3 space-y-3">
            <Link
              href={
                emailParam
                  ? `/itsm/login?email=${encodeURIComponent(emailParam)}&setup=success`
                  : `/itsm/login?setup=success`
              }
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition shadow-md shadow-[#6D28D9]/20"
            >
              <span>Continue to Sign In ({redirectSeconds}s)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        /* Form State */
        <div className="pt-6 space-y-5">
          <p className="text-xs text-[#6B7488] leading-relaxed">
            Welcome to the workspace! Please choose a secure password to complete your account activation.
          </p>

          {/* Account Email Display */}
          {emailParam && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#334155]">
              <Mail className="w-4 h-4 text-[#8E97A8] shrink-0" />
              <div className="flex-1 truncate">
                <span className="text-[#8E97A8]">Activating: </span>
                <span className="font-semibold text-[#0E1726]">{emailParam}</span>
              </div>
            </div>
          )}

          {/* Missing Token Alert */}
          {!token && (
            <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2.5 text-xs text-[#991B1B]">
              <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold">Missing Activation Token</p>
                <p className="text-[11px] text-[#B91C1C]">
                  Please open the exact activation link sent to your corporate email inbox.
                </p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex items-start gap-2.5 text-xs text-[#991B1B]">
              <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <span className="block leading-relaxed">{error}</span>
                {errorType === "used" && (
                  <Link
                    href={`/itsm/login?email=${encodeURIComponent(emailParam)}`}
                    className="inline-flex items-center gap-1 font-semibold text-[#6D28D9] hover:underline pt-0.5"
                  >
                    <span>Go to Sign In</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* New Password */}
            <div className="space-y-1">
              <label
                htmlFor="new-password"
                className="block text-xs font-semibold text-[#0E1726]"
              >
                New Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={12}
                  disabled={loading || !token}
                  placeholder="Minimum 12 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] placeholder-[#8E97A8] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1 rounded text-[#8E97A8] hover:text-[#0E1726] absolute right-2.5 top-1/2 -translate-y-1/2 transition"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1">
              <label
                htmlFor="confirm-password"
                className="block text-xs font-semibold text-[#0E1726]"
              >
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8E97A8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  minLength={12}
                  disabled={loading || !token}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-[#E6E9F0] bg-[#FBFAF9] text-xs text-[#0E1726] placeholder-[#8E97A8] focus:bg-white focus:outline-none focus:border-[#6D28D9] transition disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="p-1 rounded text-[#8E97A8] hover:text-[#0E1726] absolute right-2.5 top-1/2 -translate-y-1/2 transition"
                  aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Password Policy Indicator */}
            <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5 text-[11px]">
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                    password.length >= 12
                      ? "bg-[#10B981] text-white"
                      : "bg-[#E2E8F0] text-[#8E97A8]"
                  }`}
                >
                  <Check className="w-2.5 h-2.5" />
                </div>
                <span className={password.length >= 12 ? "text-[#059669] font-medium" : "text-[#6B7488]"}>
                  At least 12 characters
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                    password.length > 0 && password === confirmPassword
                      ? "bg-[#10B981] text-white"
                      : "bg-[#E2E8F0] text-[#8E97A8]"
                  }`}
                >
                  <Check className="w-2.5 h-2.5" />
                </div>
                <span
                  className={
                    password.length > 0 && password === confirmPassword
                      ? "text-[#059669] font-medium"
                      : "text-[#6B7488]"
                  }
                >
                  Passwords match
                </span>
              </div>
            </div>

            {/* Terms Acceptance */}
            <div className="pt-1">
              <label className="flex items-start gap-2 text-[11px] text-[#475069] cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  disabled={loading}
                  className="w-3.5 h-3.5 rounded border-[#D1D5DB] text-[#6D28D9] focus:ring-[#6D28D9] mt-0.5"
                />
                <span>
                  I agree to the{" "}
                  <Link href="/terms" target="_blank" className="font-semibold text-[#6D28D9] hover:underline">
                    Terms of Use
                  </Link>{" "}
                  and acknowledge the{" "}
                  <Link href="/privacy" target="_blank" className="font-semibold text-[#6D28D9] hover:underline">
                    Privacy Notice
                  </Link>
                  .
                </span>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !token || password.length < 12 || password !== confirmPassword || !termsAccepted}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#6D28D9] text-white text-xs font-semibold hover:bg-[#5B21B6] transition disabled:opacity-50 shadow-md shadow-[#6D28D9]/20"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Activating Account...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Activate Account & Set Password</span>
                </>
              )}
            </button>
          </form>

          {/* Footer note */}
          <p className="text-center text-[11px] text-[#8E97A8] pt-2">
            Already have your credentials?{" "}
            <Link
              href={emailParam ? `/itsm/login?email=${encodeURIComponent(emailParam)}` : "/itsm/login"}
              className="font-semibold text-[#6D28D9] hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

export default function ItsmSetupPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-2xl border border-[#E6E9F0] bg-white p-8 shadow-xl text-center space-y-3">
            <Loader2 className="w-6 h-6 animate-spin text-[#6D28D9] mx-auto" />
            <p className="text-xs text-[#6B7488]">Loading activation portal...</p>
          </div>
        }
      >
        <ItsmActivationContent />
      </Suspense>
    </div>
  );
}
