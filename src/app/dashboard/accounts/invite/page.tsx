import { redirect } from "next/navigation";

export const instant = false;

export default async function LegacyInviteUserPage() {
  redirect("/dashboard/accounts/invitations?tab=invite");
}
