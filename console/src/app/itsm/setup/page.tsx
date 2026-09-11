"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Lock,
  ShieldCheck,
} from "lucide-react";
import {
  PRIVACY_NOTICE_VERSION,
  TERMS_VERSION,
} from "@/marketing/legal-config";

function isUuid(value: string | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function ItsmSetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteId = searchParams.get("invite");
  const emailParam = searchParams.get("email") || "";

  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [redirectSeconds, setRedirectSeconds] = useState(3);

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

    if (!inviteId || !isUuid(inviteId)) {
      setError("Invalid or missing invitation reference. Please use the exact link sent to your email.");
      return;
    }

    const cleanOtp = otp.trim().replace(/\s+/g, "");
    if (!/^\d{6}$/.test(cleanOtp)) {
      setError("Please enter the 6-digit verification code from your email.");
      return;
    }

    if (password.length < 12) {
      setError("Password must be at least 12 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Password and confirmation do not match.");
      return;
    }

    if (!termsAccepted) {
      setError("You must accept the Terms of Use and acknowledge the Privacy Notice.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/onboarding/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signup_id: inviteId,
          otp: cleanOtp,
          password: password,
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          privacy_notice_acknowledged: true,
          privacy_notice_version: PRIVACY_NOTICE_VERSION,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const rawDetail = data.detail || data.message || "";
        if (rawDetail.includes("invalid") || response.status === 400) {
          if (rawDetail.includes("expired")) {
            throw new Error("This invitation has expired (15 minutes). Please contact your administrator for a new invite.");
          }
          throw new Error("Invalid verification code. Please check your email and enter the correct 6-digit code.");
        } else if (response.status === 429) {
          throw new Error("Too many incorrect attempts. This invitation has been locked for security. Please request a new invite.");
        } else {
          throw new Error(rawDetail || `Account setup failed (${response.status})`);
        }
      }

      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Account setup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FBFAF9] text-[#0E1726] font-sans flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-[14px] bg-[#6D28D9] shadow-[0_8px_20px_-6px_rgba(109,40,217,0.5)] mb-3">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0E1726]">AuthClaw ITSM</h1>
          <p className="text-xs text-[#6B7488] mt-1 font-medium">Enterprise IT Service Management</p>
        </div>

        {/* Main Card */}
        <div className="bg-white border border-[#E6E9F0] rounded-[18px] p-6 sm:p-8 shadow-[0_4px_24px_rgba(11,31,63,0.06)]">
          {success ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-bold text-[#0E1726] mb-1.5">Account Setup Complete!</h2>
              <p className="text-xs text-[#475069] leading-relaxed mb-6">
                Your password has been securely created and your ITSM account is activated.
                {emailParam && (
                  <span className="block mt-1 font-medium text-[#0E1726]">
                    Account: {emailParam}
                  </span>
                )}
              </p>

              <div className="bg-[#F5F7FA] border border-[#E6E9F0] rounded-[10px] p-3 text-xs text-[#6B7488] mb-6">
                Redirecting you to the sign-in page in <span className="font-bold text-[#6D28D9]">{redirectSeconds}</span> seconds...
              </div>

              <Link
                href={
                  emailParam
                    ? `/itsm/login?email=${encodeURIComponent(emailParam)}&setup=success`
                    : `/itsm/login?setup=success`
                }
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold rounded-[10px] shadow-[0_8px_20px_-8px_rgba(109,40,217,0.6)] transition"
              >
                <span>Proceed to Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-[#0E1726]">Complete Account Setup</h2>
                <p className="text-xs text-[#6B7488] mt-1">
                  {emailParam ? (
                    <>
                      Setting up access for <strong className="text-[#0E1726]">{emailParam}</strong>. Please enter the verification code from your email and create your password.
                    </>
                  ) : (
                    "Please enter the verification code sent to your email and create your password."
                  )}
                </p>
              </div>

              {/* Error Alert */}
              {error && (
                <div className="mb-5 p-3.5 rounded-[12px] bg-red-50 border border-red-200 flex items-start gap-2.5 text-red-700 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 font-medium">{error}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
                {/* 6-Digit OTP */}
                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="setup-otp">
                    6-Digit Verification Code
                  </label>
                  <div className="relative">
                    <input
                      id="setup-otp"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      required
                      autoFocus
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                      placeholder="123456"
                      className="w-full px-3 py-2.5 bg-[#F5F7FA] border border-[#E6E9F0] rounded-[10px] text-center text-lg font-bold tracking-[6px] text-[#0E1726] placeholder-[#9CA3AF] focus:bg-white focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition font-mono"
                    />
                  </div>
                  <p className="text-[11px] text-[#6B7488] mt-1">
                    Check your inbox for the code sent by your platform administrator.
                  </p>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="setup-password">
                    Create Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6B7488]">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="setup-password"
                      type="password"
                      required
                      minLength={12}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 12 characters"
                      className="w-full pl-9 pr-3 py-2.5 bg-[#F5F7FA] border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:bg-white focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#6B7488] mt-1">
                    <span>Minimum 12 characters</span>
                    <span className={password.length >= 12 ? "text-emerald-600 font-medium" : "text-[#6B7488]"}>
                      {password.length}/12
                    </span>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-xs font-semibold text-[#0E1726] mb-1.5" htmlFor="setup-confirm-password">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6B7488]">
                      <KeyRound className="w-4 h-4" />
                    </div>
                    <input
                      id="setup-confirm-password"
                      type="password"
                      required
                      minLength={12}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      className="w-full pl-9 pr-3 py-2.5 bg-[#F5F7FA] border border-[#E6E9F0] rounded-[10px] text-xs text-[#0E1726] placeholder-[#6B7488] focus:bg-white focus:outline-none focus:border-[#6D28D9] focus:ring-1 focus:ring-[#6D28D9] transition"
                    />
                  </div>
                </div>

                {/* Legal Acceptance */}
                <label className="flex items-start gap-2.5 pt-1 text-xs text-[#475069] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    required
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-[#6D28D9] rounded cursor-pointer"
                  />
                  <span>
                    I accept the{" "}
                    <Link href="/terms" target="_blank" className="font-semibold text-[#6D28D9] underline hover:text-[#5B21B6]">
                      Terms of Use
                    </Link>{" "}
                    and acknowledge the{" "}
                    <Link href="/privacy" target="_blank" className="font-semibold text-[#6D28D9] underline hover:text-[#5B21B6]">
                      Privacy Notice
                    </Link>
                    .
                  </span>
                </label>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-3 py-2.5 px-4 bg-[#6D28D9] hover:bg-[#5B21B6] text-white text-xs font-semibold rounded-[10px] shadow-[0_8px_20px_-8px_rgba(109,40,217,0.6)] transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Activating Account...</span>
                    </>
                  ) : (
                    <>
                      <span>Complete Account Setup</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-[#F1F3F7] text-center">
                <p className="text-xs text-[#6B7488]">
                  Already have your password configured?{" "}
                  <Link href="/itsm/login" className="font-semibold text-[#6D28D9] hover:text-[#5B21B6]">
                    Sign in to ITSM
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-[#9CA3AF] mt-6">
          AuthClaw ITSM &bull; Protected enterprise workspace
        </p>
      </div>
    </main>
  );
}

export default function ItsmSetupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#FBFAF9] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#6D28D9] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ItsmSetupContent />
    </Suspense>
  );
}
