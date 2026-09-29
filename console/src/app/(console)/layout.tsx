import React from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import ConsoleShell from "@/components/console-shell";
import AdminPortalShell from "@/components/admin-portal-shell";
import IncidentManagerShell from "@/components/incident-manager-shell";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  const headerList = await headers();
  const currentPath = headerList.get("x-authclaw-pathname") || "";
  const isItsmPath = currentPath.startsWith("/itsm");
  const isAdminPortal = currentPath.startsWith("/itsm/admin-portal");
  const isIncidentManagerPortal = currentPath.startsWith("/itsm/incident-manager");

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
  if (!tenantId && String(principal.platform_role || "NONE").toUpperCase() === "ADMIN") {
    redirect("/developer");
  }
  const tenantName = "Current Tenant";
  const userRole = principal.role;
  const platformRole = principal.platform_role || "NONE";
  const itsmRole = principal.itsm_role || null;
  const productAccess = principal.product_access || { governance: true, itsm: false };

  if (isItsmPath && !productAccess.itsm) {
    redirect("/itsm/login?error=access_denied");
  } else if (!isItsmPath && currentPath && !productAccess.governance) {
    redirect("/login?error=access_denied");
  }

  // Enforce Incident Manager separation from operational ITSM workspace
  if (isItsmPath && !isAdminPortal && !isIncidentManagerPortal) {
    if (itsmRole === "INCIDENT_MANAGER" || itsmRole === "SERVICE_LEAD") {
      redirect("/itsm/incident-manager");
    }
    if (
      itsmRole === "AUDITOR" &&
      currentPath &&
      currentPath !== "/itsm/dashboard/auditor" &&
      currentPath !== "/itsm/profile" &&
      !currentPath.startsWith("/itsm/profile/")
    ) {
      redirect("/itsm/dashboard/auditor");
    }
  }

  if (isAdminPortal) {
    return (
      <AdminPortalShell
        userEmail={userEmail}
        tenantId={tenantId}
        tenantName={tenantName}
        userRole={userRole}
        itsmRole={itsmRole}
      >
        {children}
      </AdminPortalShell>
    );
  }

  if (isIncidentManagerPortal) {
    return (
      <IncidentManagerShell
        userEmail={userEmail}
        tenantId={tenantId}
        tenantName={tenantName}
        userRole={userRole}
        itsmRole={itsmRole}
      >
        {children}
      </IncidentManagerShell>
    );
  }

  return (
    <ConsoleShell
      userEmail={userEmail}
      tenantId={tenantId}
      tenantName={tenantName}
      userRole={userRole}
      platformRole={platformRole}
      itsmRole={itsmRole}
    >
      {children}
    </ConsoleShell>
  );
}
