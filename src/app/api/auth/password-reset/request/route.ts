import { NextResponse } from "next/server";
import { getClientIpAddress } from "@/lib/auth/client-ip";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { requestPasswordReset } from "@/lib/auth/password-reset";
import { isRecord, readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[auth.password-reset.request] Operation failed (${errorType}).`);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
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

    if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const result = await requestPasswordReset(
      email,
      getClientIpAddress(request),
      request.headers.get("user-agent"),
    );

    if (result.kind === "rate-limited") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Try again later.",
          },
        },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(result.retryAfterSeconds),
          },
        },
      );
    }

    return successResponse({ requestAccepted: true }, 202);
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
