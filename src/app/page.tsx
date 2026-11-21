import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

export const instant = false;

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    redirect("/sign-in");
  }

  if (!(await getActiveSession(token))) {
    redirect("/sign-in");
  }

  redirect("/dashboard");
}
