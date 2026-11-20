import { NextResponse } from "next/server";
import { acceptInvitation } from "@/lib/auth/accept-invitation";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { isRecord, readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { setSessionCookie } from "@/lib/auth/session-token";
import { isOpaqueToken } from "@/lib/auth/token";

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[auth.invitation] Internal operation failed (${errorType}).`);
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

    const token =
      typeof bodyResult.value.token === "string" ? bodyResult.value.token : undefined;
    const password =
      typeof bodyResult.value.password === "string"
        ? bodyResult.value.password
        : "";

    if (!isOpaqueToken(token) || password.length === 0) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const result = await acceptInvitation(
      token,
      password,
      request.headers.get("user-agent"),
    );

    if (result.kind === "invalid") {
      return errorResponse(
        401,
        "INVITATION_INVALID",
        "The invitation is invalid or can no longer be used.",
      );
    }

    if (result.kind === "password-policy") {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "The password does not meet the requirements.",
      );
    }

    const response = successResponse({
      invitationAccepted: true,
      user: result.user,
    });
    setSessionCookie(response, result.token, result.sessionPolicy);

    return response;
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
