import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function ProblemChangeManagerLayout({
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

  // 1. Enforce authenticated tenant context
  if (!principal.tenant_id) {
    redirect("/itsm/login?error=invalid_tenant");
  }

  // 2. Enforce ITSM product access
  if (!hasItsmAccess) {
    redirect("/itsm/login?error=access_denied");
  }

  // 3. Server-side guard: Only PROCESS_CHANGE_MANAGER is permitted in this portal
  if (itsmRole !== "PROCESS_CHANGE_MANAGER") {
    redirect("/itsm/incidents?error=problem_change_manager_required");
  }

  return <>{children}</>;
}
