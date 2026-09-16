import React from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function ItsmLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  if (!sessionToken) {
    redirect("/itsm/login");
  }

  const response = await fetch(
    `${process.env.API_URL || "http://localhost:8000"}/v1/auth/me`,
    { headers: { Authorization: `Bearer ${sessionToken}` }, cache: "no-store" },
  );

  if (!response.ok) {
    redirect("/itsm/login");
  }

  const principal = await response.json();
  const hasItsmAccess = principal.product_access?.itsm ?? false;

  if (!hasItsmAccess) {
    redirect("/itsm/login?error=access_denied");
  }

  const itsmRole = (
    principal.itsm_role ||
    (principal.platform_role === "SUPER_ADMIN" ? "PLATFORM_ADMINISTRATOR" : "REQUESTER")
  ).toUpperCase();

  const headerList = await headers();
  const currentPath = headerList.get("x-authclaw-pathname") || "";

  if (itsmRole === "REQUESTER" && currentPath) {
    const isAllowedRequesterPath =
      currentPath === "/itsm/incidents" ||
      currentPath.startsWith("/itsm/incidents/") ||
      currentPath === "/itsm/services" ||
      currentPath.startsWith("/itsm/services/") ||
      currentPath === "/itsm/knowledge" ||
      currentPath.startsWith("/itsm/knowledge/") ||
      currentPath === "/itsm/notifications" ||
      currentPath.startsWith("/itsm/notifications/") ||
      currentPath === "/itsm/profile" ||
      currentPath.startsWith("/itsm/profile/") ||
      currentPath.startsWith("/itsm/dashboard") ||
      currentPath === "/itsm";

    if (!isAllowedRequesterPath) {
      redirect("/itsm/dashboard/requester");
    }
  }

  return <>{children}</>;
}
