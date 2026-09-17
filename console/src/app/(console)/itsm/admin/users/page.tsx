import { redirect } from "next/navigation";

export default function LegacyAdminUsersPage() {
  redirect("/itsm/admin-portal/users");
}
