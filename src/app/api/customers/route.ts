import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
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
import { createCustomer } from "@/lib/customers/management";
import { parseCreateCustomerInput } from "@/lib/customers/input";
import { parseCustomerPage } from "@/lib/customers/query";

function logUnexpectedFailure(operation: string, error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[customers.${operation}] Internal operation failed (${errorType}).`);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const page = parseCustomerPage(new URL(request.url).searchParams);

    if (!page) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "The customer list request is invalid.",
      );
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

    const rows = await db
      .select({
        id: customers.id,
        customerNumber: customers.customerNumber,
        customerType: customers.customerType,
        fullName: customers.fullName,
        phone: customers.phone,
        email: customers.email,
        status: customers.status,
      })
      .from(customers)
      .orderBy(asc(customers.customerNumber))
      .limit(page.limit + 1)
      .offset(page.offset);
    const hasMore = rows.length > page.limit;

    return successResponse({
      customers: rows.slice(0, page.limit),
      pagination: {
        limit: page.limit,
        offset: page.offset,
        hasMore,
      },
    });
  } catch (error) {
    logUnexpectedFailure("list", error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
    if (contentType?.toLowerCase() !== "application/json") {
      return errorResponse(400, "VALIDATION_ERROR", "The customer request is invalid.");
    }

    const body = await readJsonBody(request);
    const input = body.ok ? parseCreateCustomerInput(body.value) : null;
    if (!input) {
      return errorResponse(400, "VALIDATION_ERROR", "The customer request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await createCustomer(sessionToken, input);
    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (result.kind === "forbidden") {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to manage customer records.");
    }
    if (result.kind === "conflict") {
      return errorResponse(
        409,
        "CUSTOMER_CONFLICT",
        "A customer with that email address already exists.",
      );
    }
    if (result.kind !== "success") {
      throw new Error("Customer creation returned an unexpected result.");
    }

    const response = successResponse(
      {
        customer: {
          id: result.customerId,
          customerNumber: result.customerNumber,
          status: result.status,
        },
      },
      201,
    );
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    logUnexpectedFailure("create", error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
