import { NextResponse } from "next/server";
import { getClientIpAddress } from "@/lib/auth/client-ip";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { completePasswordReset } from "@/lib/auth/password-reset";
import { isRecord, readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { isOpaqueToken } from "@/lib/auth/token";

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[auth.password-reset.complete] Operation failed (${errorType}).`);
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

    const token =
      typeof bodyResult.value.token === "string" ? bodyResult.value.token : undefined;
    const password =
      typeof bodyResult.value.password === "string"
        ? bodyResult.value.password
        : "";

    if (!isOpaqueToken(token) || password.length === 0) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const result = await completePasswordReset(
      token,
      password,
      request.headers.get("user-agent"),
      getClientIpAddress(request),
    );

    if (result.kind === "invalid") {
      return errorResponse(
        400,
        "RESET_TOKEN_INVALID",
        "The reset link is invalid or can no longer be used.",
      );
    }

    if (result.kind === "password-policy") {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "The password does not meet the requirements.",
      );
    }

    return successResponse({ passwordReset: true });
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
