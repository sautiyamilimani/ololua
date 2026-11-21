import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import {
  issueInvitation,
  type IssueInvitationInput,
} from "@/lib/auth/issue-invitation";
import { isRecord, readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { sendPendingOutboxEmails } from "@/lib/email/outbox-delivery";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[auth.invitation.issue] Internal operation failed (${errorType}).`);
}

function parseInvitationInput(value: unknown): IssueInvitationInput | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.accountType === "staff" &&
    typeof value.email === "string" &&
    typeof value.fullName === "string" &&
    typeof value.roleKey === "string"
  ) {
    return {
      accountType: "staff",
      email: value.email.trim().toLowerCase(),
      fullName: value.fullName.trim(),
      roleKey: value.roleKey.trim(),
    };
  }

  if (
    value.accountType === "customer" &&
    typeof value.customerId === "string" &&
    UUID_PATTERN.test(value.customerId)
  ) {
    return {
      accountType: "customer",
      customerId: value.customerId,
    };
  }

  return null;
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

    if (!bodyResult.ok) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const input = parseInvitationInput(bodyResult.value);

    if (!input) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await issueInvitation(
      sessionToken,
      input,
      request.headers.get("user-agent"),
    );

    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    if (result.kind === "forbidden") {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to issue this invitation.");
    }

    if (result.kind === "customer-not-found") {
      return errorResponse(404, "NOT_FOUND", "The customer account was not found.");
    }

    if (result.kind === "role-not-found") {
      return errorResponse(400, "VALIDATION_ERROR", "The requested role is not allowed.");
    }

    if (result.kind === "conflict") {
      return errorResponse(
        409,
        "INVITATION_CONFLICT",
        "The target already has an account, access link, or conflicting invitation.",
      );
    }

    let emailSent = false;

    try {
      const delivery = await sendPendingOutboxEmails("invitation");
      emailSent = delivery.sent > 0;
    } catch (error) {
      const errorType = error instanceof Error ? error.name : "UnknownError";
      console.error(`[auth.invitation.issue] Immediate email delivery was unavailable (${errorType}).`);
    }

    const response = successResponse(
      {
        invitationId: result.invitationId,
        expiresAt: result.expiresAt.toISOString(),
        emailQueued: true,
        emailSent,
      },
      202,
    );
    setSessionCookie(response, sessionToken, result.sessionPolicy);

    return response;
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
