import { redirect } from "next/navigation";

export default function LegacyServiceAgentDashboardPage() {
  redirect("/itsm/dashboard/agent");
}
