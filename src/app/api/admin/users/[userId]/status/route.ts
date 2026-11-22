import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import {
  changeStaffAccountStatus,
  type StaffAccountStatus,
} from "@/lib/auth/staff-account-status";
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
  console.error(`[admin.staff-status] Internal operation failed (${errorType}).`);
}

function parseRequestedStatus(value: unknown): StaffAccountStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  return value.status === "active" || value.status === "suspended"
    ? value.status
    : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  try {
    const applicationOrigin = getApplicationOrigin();

    if (!hasValidCsrfHeaders(request, applicationOrigin)) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const { userId } = await context.params;

    if (!UUID_PATTERN.test(userId)) {
      return errorResponse(400, "VALIDATION_ERROR", "The account status request is invalid.");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();

    if (contentType?.toLowerCase() !== "application/json") {
      return errorResponse(400, "VALIDATION_ERROR", "The account status request is invalid.");
    }

    const bodyResult = await readJsonBody(request);

    if (!bodyResult.ok) {
      return errorResponse(400, "VALIDATION_ERROR", "The account status request is invalid.");
    }

    const requestedStatus = parseRequestedStatus(bodyResult.value);

    if (!requestedStatus) {
      return errorResponse(400, "VALIDATION_ERROR", "The account status request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await changeStaffAccountStatus(
      sessionToken,
      userId,
      requestedStatus,
      request.headers.get("user-agent"),
    );

    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    if (result.kind === "forbidden") {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to change this account status.");
    }

    if (result.kind === "not-found") {
      return errorResponse(404, "NOT_FOUND", "The staff account was not found.");
    }

    if (result.kind === "status-conflict") {
      return errorResponse(
        409,
        "ACCOUNT_STATUS_CONFLICT",
        "The account status cannot be changed from its current state.",
      );
    }

    if (result.kind === "last-active-admin") {
      return errorResponse(
        409,
        "LAST_ACTIVE_ADMIN",
        "The last active admin account cannot be suspended.",
      );
    }

    if (result.notificationQueued) {
      try {
        await sendPendingOutboxEmails(
          requestedStatus === "suspended"
            ? "staff_account_suspended"
            : "staff_account_reactivated",
        );
      } catch (error) {
        const errorType = error instanceof Error ? error.name : "UnknownError";
        console.error(
          `[admin.staff-status] Immediate account status email delivery was unavailable (${errorType}).`,
        );
      }
    }

    const response = successResponse({
      userId,
      status: requestedStatus,
      notificationQueued: result.notificationQueued,
    });
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
