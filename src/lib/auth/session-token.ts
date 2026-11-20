import type { NextResponse } from "next/server";
import type { SessionPolicy } from "./policy";
import { isOpaqueToken } from "./token";

export const SESSION_COOKIE_NAME = "ololua_session";

export function isValidSessionToken(token: string | undefined): token is string {
  return isOpaqueToken(token);
}

export function setSessionCookie(
  response: NextResponse,
  token: string,
  policy: SessionPolicy,
): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(policy.persistentCookie
      ? { maxAge: Math.floor(policy.idleTimeoutMs / 1000) }
      : {}),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}
