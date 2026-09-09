import React from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import ConsoleShell from "@/components/console-shell";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  const headerList = await headers();
  const currentPath = headerList.get("x-authclaw-pathname") || "";
  const isItsmPath = currentPath.startsWith("/itsm");

  if (!sessionToken) {
    redirect(isItsmPath ? "/itsm/login" : "/login");
  }

  const response = await fetch(
    `${process.env.API_URL || "http://localhost:8000"}/v1/auth/me`,
    { headers: { Authorization: `Bearer ${sessionToken}` }, cache: "no-store" },
  );

  if (!response.ok) {
    redirect(isItsmPath ? "/itsm/login" : "/login");
  }

  const principal = await response.json();
  const userEmail = principal.email;
  const tenantId = principal.tenant_id;
  const tenantName = "Current Tenant";
  const userRole = principal.role;
  const itsmRole = principal.itsm_role || null;
  const productAccess = principal.product_access || { governance: true, itsm: false };

  if (isItsmPath && !productAccess.itsm) {
    redirect("/itsm/login?error=access_denied");
  } else if (!isItsmPath && currentPath && !productAccess.governance) {
    redirect("/login?error=access_denied");
  }

  return (
    <ConsoleShell
      userEmail={userEmail}
      tenantId={tenantId}
      tenantName={tenantName}
      userRole={userRole}
      itsmRole={itsmRole}
    >
      {children}
    </ConsoleShell>
  );
}
