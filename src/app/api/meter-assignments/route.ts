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
import { assignMeter } from "@/lib/meter-assignments/management";
import { parseAssignMeterInput } from "@/lib/meter-assignments/input";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }
    if (
      request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json"
    ) {
      return errorResponse(400, "VALIDATION_ERROR", "The assignment request is invalid.");
    }

    const body = await readJsonBody(request);
    const input = body.ok ? parseAssignMeterInput(body.value) : null;
    if (!input) {
      return errorResponse(400, "VALIDATION_ERROR", "The assignment request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await assignMeter(
      sessionToken,
      input.meterId,
      input.accountId,
      input.locationDescription,
    );
    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (result.kind === "forbidden") {
      return errorResponse(
        403,
        "FORBIDDEN",
        "You are not allowed to assign meters.",
      );
    }
    if (result.kind === "meter-not-found" || result.kind === "account-not-found") {
      return errorResponse(404, "NOT_FOUND", "The meter or service account was not found.");
    }
    if (
      result.kind === "meter-not-active" ||
      result.kind === "account-not-active"
    ) {
      return errorResponse(
        409,
        "METER_ASSIGNMENT_CONFLICT",
        "The meter or service account is not active.",
      );
    }
    if (result.kind === "meter-already-assigned") {
      return errorResponse(
        409,
        "METER_ASSIGNMENT_CONFLICT",
        "This meter is already assigned to an active service account.",
      );
    }
    if (result.kind !== "success") {
      throw new Error("Meter assignment returned an unexpected result.");
    }

    const response = successResponse(
      {
        assignmentId: result.assignmentId,
        meterId: result.meterId,
        accountId: result.accountId,
        updatedAt: result.updatedAt.toISOString(),
      },
      201,
    );
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "UnknownError";
    console.error(
      `[meter-assignments.assign] Internal operation failed (${errorType}).`,
    );
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "The meter could not be assigned.",
    );
  }
}
