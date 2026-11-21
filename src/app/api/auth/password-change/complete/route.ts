import { NextResponse } from "next/server";
import { getClientIpAddress } from "@/lib/auth/client-ip";
import {
  attachRenewedSessionCookie,
  getRenewedRequestSession,
} from "@/lib/auth/active-request-session";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { completePasswordChange } from "@/lib/auth/password-change";
import { isRecord, readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { clearSessionCookie } from "@/lib/auth/session-token";
import { isOpaqueToken } from "@/lib/auth/token";

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[auth.password-change.complete] Operation failed (${errorType}).`);
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

    const verificationToken =
      typeof bodyResult.value.verificationToken === "string"
        ? bodyResult.value.verificationToken
        : "";
    const newPassword =
      typeof bodyResult.value.newPassword === "string"
        ? bodyResult.value.newPassword
        : "";
    const confirmation =
      typeof bodyResult.value.confirmation === "string"
        ? bodyResult.value.confirmation
        : "";

    if (
      !isOpaqueToken(verificationToken) ||
      newPassword.length === 0 ||
      confirmation.length === 0
    ) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const session = await getRenewedRequestSession();

    if (!session) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await completePasswordChange(
      session.user.id,
      session.sessionId,
      verificationToken,
      newPassword,
      confirmation,
      getClientIpAddress(request),
      request.headers.get("user-agent"),
    );

    if (result.kind === "invalid") {
      return attachRenewedSessionCookie(
        errorResponse(
          400,
          "OTP_INVALID",
          "The verification has expired or can no longer be used.",
        ),
        session,
      );
    }

    if (result.kind === "password-policy") {
      return attachRenewedSessionCookie(
        errorResponse(
          400,
          "VALIDATION_ERROR",
          "The new password does not meet the minimum length for this account.",
        ),
        session,
      );
    }

    if (result.kind === "password-mismatch") {
      return attachRenewedSessionCookie(
        errorResponse(400, "VALIDATION_ERROR", "The passwords do not match."),
        session,
      );
    }

    const response = successResponse({ passwordChanged: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
