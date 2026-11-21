import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { renewActiveSession } from "./session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "./session-token";

export async function getRenewedRequestSession() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!isValidSessionToken(token)) {
    return null;
  }

  const session = await renewActiveSession(token);

  return session ? { ...session, token } : null;
}

export function attachRenewedSessionCookie(
  response: NextResponse,
  session: NonNullable<Awaited<ReturnType<typeof getRenewedRequestSession>>>,
): NextResponse {
  setSessionCookie(response, session.token, session.policy);
  return response;
}
