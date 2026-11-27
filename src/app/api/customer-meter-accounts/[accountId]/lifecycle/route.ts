import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { transitionCustomerMeterAccount } from "@/lib/customer-meter-accounts/lifecycle";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type LifecycleInput = {
  transition: "SUSPEND" | "REACTIVATE" | "CLOSE";
  reason?: string;
};

function parseLifecycleInput(value: unknown): LifecycleInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "transition" && key !== "reason",
    ) ||
    (record.transition !== "SUSPEND" &&
      record.transition !== "REACTIVATE" &&
      record.transition !== "CLOSE")
  ) {
    return null;
  }

  if (record.reason === undefined) {
    return { transition: record.transition };
  }
  if (typeof record.reason !== "string") {
    return null;
  }

  const reason = record.reason.trim();
  if (reason.length === 0 || reason.length > 500) {
    return null;
  }

  return { transition: record.transition, reason };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const { accountId } = await context.params;
    if (!UUID_PATTERN.test(accountId)) {
      return errorResponse(400, "VALIDATION_ERROR", "The account request is invalid.");
    }

    if (
      request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      return errorResponse(400, "VALIDATION_ERROR", "The account request is invalid.");
    }

    const body = await readJsonBody(request);
    const input = body.ok ? parseLifecycleInput(body.value) : null;
    if (!input) {
      return errorResponse(400, "VALIDATION_ERROR", "The account request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await transitionCustomerMeterAccount(
      sessionToken,
      accountId,
      input.transition,
      input.reason,
    );
    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (result.kind === "forbidden") {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to manage customer accounts.");
    }
    if (result.kind === "not-found") {
      return errorResponse(404, "NOT_FOUND", "The customer meter account was not found.");
    }
    if (result.kind === "invalid-transition") {
      return errorResponse(409, "CUSTOMER_METER_ACCOUNT_CONFLICT", "The requested account status change is not allowed.");
    }
    if (result.kind === "domestic-account-exists") {
      return errorResponse(409, "DOMESTIC_ACCOUNT_EXISTS", "Another current Domestic Water account already exists for this customer.");
    }
    if (result.kind !== "success") {
      throw new Error("Customer meter account lifecycle returned an unexpected result.");
    }

    const response = successResponse({
      account: {
        id: result.accountId,
        previousStatus: result.previousStatus,
        status: result.status,
        updatedAt: result.updatedAt.toISOString(),
      },
    });
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    console.error(
      "[customer-meter-accounts.lifecycle] Internal operation failed.",
      error instanceof Error ? error.name : "UnknownError",
    );
    return errorResponse(500, "INTERNAL_ERROR", "The account status could not be updated.");
  }
}
