import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { readJsonBody } from "@/lib/auth/request";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import {
  linkStaffCustomerAccess,
} from "@/lib/customers/management";
import { parseLinkStaffCustomerAccessInput } from "@/lib/customers/input";

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[staff-customer-access.link] Internal operation failed (${errorType}).`);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
    if (contentType?.toLowerCase() !== "application/json") {
      return errorResponse(400, "VALIDATION_ERROR", "The access request is invalid.");
    }

    const body = await readJsonBody(request);
    const input = body.ok
      ? parseLinkStaffCustomerAccessInput(body.value)
      : null;
    if (!input) {
      return errorResponse(400, "VALIDATION_ERROR", "The access request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await linkStaffCustomerAccess(
      sessionToken,
      input.staffUserId,
      input.customerId,
    );
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
    if (result.kind === "not-found" || result.kind === "staff-not-found") {
      return errorResponse(404, "NOT_FOUND", "The staff account or customer was not found.");
    }
    if (result.kind === "already-linked") {
      return errorResponse(
        409,
        "STAFF_CUSTOMER_ACCESS_CONFLICT",
        "The staff account or customer is already linked to another active account.",
      );
    }
    if (result.kind !== "success") {
      throw new Error("Staff customer access linking returned an unexpected result.");
    }

    const response = successResponse(
      { accessId: result.accessId, customerId: result.customerId },
      201,
    );
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
