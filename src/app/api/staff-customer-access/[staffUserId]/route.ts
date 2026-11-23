import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { errorResponse, successResponse } from "@/lib/auth/response";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { revokeStaffCustomerAccess } from "@/lib/customers/management";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[staff-customer-access.revoke] Internal operation failed (${errorType}).`);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ staffUserId: string }> },
): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const { staffUserId } = await context.params;
    if (!UUID_PATTERN.test(staffUserId)) {
      return errorResponse(400, "VALIDATION_ERROR", "The staff account ID is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await revokeStaffCustomerAccess(sessionToken, staffUserId);
    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (result.kind === "forbidden") {
      return errorResponse(
        403,
        "FORBIDDEN",
        "You are not allowed to manage customer records.",
      );
    }
    if (result.kind === "staff-not-found" || result.kind === "not-linked") {
      return errorResponse(404, "NOT_FOUND", "The active customer-account link was not found.");
    }
    if (result.kind !== "success") {
      throw new Error("Staff customer access revocation returned an unexpected result.");
    }

    const response = successResponse({
      accessId: result.accessId,
      customerId: result.customerId,
    });
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
