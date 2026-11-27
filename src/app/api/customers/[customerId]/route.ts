import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { getActiveSession } from "@/lib/auth/session";
import {
  CUSTOMER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { readJsonBody } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import {
  parseUpdateCustomerInput,
} from "@/lib/customers/input";
import {
  deleteCustomer,
  updateCustomer,
} from "@/lib/customers/management";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function logUnexpectedFailure(operation: string, error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[customers.${operation}] Internal operation failed (${errorType}).`);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    const { customerId } = await context.params;
    if (!UUID_PATTERN.test(customerId)) {
      return errorResponse(400, "VALIDATION_ERROR", "The customer request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const session = await getActiveSession(sessionToken);
    if (!session) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    if (
      session.user.accountType !== "staff" ||
      !(await userHasPermission(session.user.id, CUSTOMER_READ_PERMISSION))
    ) {
      return errorResponse(
        403,
        "FORBIDDEN",
        "You are not allowed to read customer records.",
      );
    }

    const [customer] = await db
      .select({
        id: customers.id,
        customerNumber: customers.customerNumber,
        customerType: customers.customerType,
        fullName: customers.fullName,
        phone: customers.phone,
        email: customers.email,
        emailVerifiedAt: customers.emailVerifiedAt,
        status: customers.status,
        notes: customers.notes,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
      })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.isTrashed, false)))
      .limit(1);

    if (!customer) {
      return errorResponse(404, "NOT_FOUND", "The customer was not found.");
    }

    return successResponse({
      customer: {
        ...customer,
        emailVerifiedAt: customer.emailVerifiedAt?.toISOString() ?? null,
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    logUnexpectedFailure("details", error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const { customerId } = await context.params;
    if (!UUID_PATTERN.test(customerId)) {
      return errorResponse(400, "VALIDATION_ERROR", "The customer request is invalid.");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
    if (contentType?.toLowerCase() !== "application/json") {
      return errorResponse(400, "VALIDATION_ERROR", "The customer request is invalid.");
    }

    const body = await readJsonBody(request);
    const input = body.ok ? parseUpdateCustomerInput(body.value) : null;
    if (!input) {
      return errorResponse(400, "VALIDATION_ERROR", "The customer request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await updateCustomer(sessionToken, customerId, input);
    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (result.kind === "forbidden") {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to manage customer records.");
    }
    if (result.kind === "not-found") {
      return errorResponse(404, "NOT_FOUND", "The customer was not found.");
    }
    if (result.kind === "conflict") {
      return errorResponse(
        409,
        "CUSTOMER_CONFLICT",
        "A customer with that email address already exists.",
      );
    }
    if (result.kind === "email-change-restricted") {
      return errorResponse(
        409,
        "CUSTOMER_EMAIL_CHANGE_RESTRICTED",
        "Revoke the customer's active portal link before changing their email.",
      );
    }
    if (result.kind !== "success") {
      throw new Error("Customer update returned an unexpected result.");
    }

    const response = successResponse({
      customer: {
        id: result.customerId,
        updatedAt: result.updatedAt?.toISOString(),
        emailChanged: result.emailChanged ?? false,
        pendingInvitationRevoked: result.pendingInvitationRevoked ?? false,
      },
    });
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    logUnexpectedFailure("update", error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const { customerId } = await context.params;
    if (!UUID_PATTERN.test(customerId)) {
      return errorResponse(400, "VALIDATION_ERROR", "The customer request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await deleteCustomer(sessionToken, customerId);
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
    if (result.kind === "not-found") {
      return errorResponse(404, "NOT_FOUND", "The customer was not found.");
    }
    if (result.kind === "conflict") {
      return errorResponse(
        409,
        "CUSTOMER_CONFLICT",
        "This customer is already trashed.",
      );
    }
    if (result.kind !== "success") {
      throw new Error("Customer deletion returned an unexpected result.");
    }

    const response = successResponse({
      customer: { id: result.customerId },
    });
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    logUnexpectedFailure("delete", error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
