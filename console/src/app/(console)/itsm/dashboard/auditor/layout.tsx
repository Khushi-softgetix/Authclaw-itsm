import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function AuditorWorkspaceLayout({ children }: { children: ReactNode }) {
  const sessionToken = (await cookies()).get("authclaw_session")?.value;
  if (!sessionToken) redirect("/itsm/login");

  const response = await fetch(
    `${process.env.API_URL || "http://localhost:8000"}/v1/auth/me`,
    { headers: { Authorization: `Bearer ${sessionToken}` }, cache: "no-store" },
  );
  if (!response.ok) redirect("/itsm/login");
  const principal = await response.json();
  if (String(principal.itsm_role || "").toUpperCase() !== "AUDITOR") {
    redirect("/itsm/dashboard");
  }
  return <>{children}</>;
}
