import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const instant = false;

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/sign-in");
  }

  const session = await getActiveSession(token);

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <DashboardShell
      canManageInvitations={session.canManageInvitations}
      fullName={session.user.fullName}
    >
      {children}
    </DashboardShell>
  );
}
