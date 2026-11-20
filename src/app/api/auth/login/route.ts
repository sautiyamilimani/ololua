import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/login";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { isRecord, readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { setSessionCookie } from "@/lib/auth/session-token";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[auth.login] Internal operation failed (${errorType}).`);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const applicationOrigin = getApplicationOrigin();

    if (!hasValidCsrfHeaders(request, applicationOrigin)) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();

    if (contentType?.toLowerCase() !== "application/json") {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const bodyResult = await readJsonBody(request);

    if (!bodyResult.ok || !isRecord(bodyResult.value)) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const email =
      typeof bodyResult.value.email === "string"
        ? bodyResult.value.email.trim().toLowerCase()
        : "";
    const password =
      typeof bodyResult.value.password === "string"
        ? bodyResult.value.password
        : "";

    if (
      email.length === 0 ||
      email.length > 254 ||
      !EMAIL_PATTERN.test(email) ||
      password.length === 0
    ) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const login = await authenticate(
      email,
      password,
      request.headers.get("user-agent"),
    );

    if (!login) {
      return errorResponse(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    const response = successResponse({ user: login.user });
    setSessionCookie(response, login.token, login.sessionPolicy);

    return response;
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
