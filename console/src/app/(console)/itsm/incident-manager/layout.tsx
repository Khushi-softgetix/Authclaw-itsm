import React from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Incident Manager | AuthClaw ITSM",
  description: "Incident Manager operational workspace in AuthClaw ITSM.",
};

export default async function IncidentManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;

  if (!sessionToken) {
    redirect("/itsm/login");
  }

  const response = await fetch(
    `${process.env.API_URL || "http://localhost:8000"}/v1/auth/me`,
    {
      headers: { Authorization: `Bearer ${sessionToken}` },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    redirect("/itsm/login");
  }

  const principal = await response.json();
  const hasItsmAccess = principal.product_access?.itsm ?? false;
  const itsmRole = principal.itsm_role || "";

  // 1. Enforce ITSM product access
  if (!hasItsmAccess) {
    redirect("/itsm/login?error=access_denied");
  }

  // 2. Server-side guard mirrors the backend Incident Manager authorization.
  if (itsmRole !== "INCIDENT_MANAGER") {
    redirect("/itsm/incidents?error=incident_manager_required");
  }

  return <>{children}</>;
}
