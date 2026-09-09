import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

  // 2. Server-side guard: Only INCIDENT_MANAGER (and SERVICE_LEAD for internal compatibility) is allowed
  if (itsmRole !== "INCIDENT_MANAGER" && itsmRole !== "SERVICE_LEAD") {
    redirect("/itsm/incidents?error=incident_manager_required");
  }

  return <>{children}</>;
}
