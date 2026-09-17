import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function ServiceAgentLayout({
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
  const itsmRole = (principal.itsm_role || "").toUpperCase();

  // 1. Enforce ITSM product access
  if (!hasItsmAccess) {
    redirect("/itsm/login?error=access_denied");
  }

  // 2. Server-side guard: Only SERVICE_AGENT is allowed in the Agent Workspace
  if (itsmRole !== "SERVICE_AGENT") {
    redirect("/itsm/dashboard?error=service_agent_required");
  }

  return <>{children}</>;
}
