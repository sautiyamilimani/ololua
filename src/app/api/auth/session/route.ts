import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { getActiveSession, revokeSession } from "@/lib/auth/session";
import { clearSessionCookie, isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session-token";

function logUnexpectedFailure(operation: string, error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[auth.session] ${operation} failed (${errorType}).`);
}

export async function GET(): Promise<NextResponse> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

    if (!isValidSessionToken(token)) {
      const response = successResponse({ authenticated: false, user: null });
      if (token !== undefined) {
        clearSessionCookie(response);
      }
      return response;
    }

    const activeSession = await getActiveSession(token);

    if (!activeSession) {
      const response = successResponse({ authenticated: false, user: null });
      clearSessionCookie(response);
      return response;
    }

    return successResponse({
      authenticated: true,
      user: activeSession.user,
    });
  } catch (error) {
    logUnexpectedFailure("check", error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const applicationOrigin = getApplicationOrigin();

    if (!hasValidCsrfHeaders(request, applicationOrigin)) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

    if (isValidSessionToken(token)) {
      await revokeSession(token, request.headers.get("user-agent"));
    }

    const response = successResponse({ authenticated: false });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    logUnexpectedFailure("logout", error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
