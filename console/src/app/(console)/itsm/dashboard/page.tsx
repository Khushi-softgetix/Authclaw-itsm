import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function DashboardRootPage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("authclaw_session")?.value;
  if (!sessionToken) {
    redirect("/itsm/login");
  }

  const apiUrl = process.env.API_URL || "http://localhost:8000";
  let principal: { itsm_role?: string; platform_role?: string } | null = null;

  try {
    const response = await fetch(`${apiUrl}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      cache: "no-store",
    });
    if (response.ok) {
      principal = await response.json();
    }
  } catch (err) {
    // Fallback if fetch fails
  }

  if (!principal) {
    redirect("/itsm/login");
  }

  const role = principal.itsm_role || (principal.platform_role === "SUPER_ADMIN" ? "PLATFORM_ADMINISTRATOR" : "REQUESTER");

  switch (role) {
    case "REQUESTER":
      redirect("/itsm/dashboard/requester");
    case "SERVICE_AGENT":
      redirect("/itsm/dashboard/service-agent");
    case "INCIDENT_MANAGER":
    case "SERVICE_LEAD":
      redirect("/itsm/incident-manager");
    case "PROCESS_CHANGE_MANAGER":
      redirect("/itsm/dashboard/process-change");
    case "PLATFORM_ADMINISTRATOR":
      redirect("/itsm/dashboard/platform-admin");
    case "AUDITOR":
      redirect("/itsm/dashboard/auditor");
    default:
      redirect("/itsm/dashboard/service-agent");
  }
}
