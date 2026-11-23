import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { readJsonBody, isRecord } from "@/lib/auth/request";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { removeMeterAssignment } from "@/lib/meter-assignments/management";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function DELETE(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> },
): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }
    if (
      request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json"
    ) {
      return errorResponse(400, "VALIDATION_ERROR", "The removal request is invalid.");
    }

    const { assignmentId } = await context.params;
    if (!UUID_PATTERN.test(assignmentId)) {
      return errorResponse(400, "VALIDATION_ERROR", "The assignment request is invalid.");
    }

    const body = await readJsonBody(request);
    if (
      !body.ok ||
      !isRecord(body.value) ||
      Object.keys(body.value).length !== 1 ||
      typeof body.value.reason !== "string"
    ) {
      return errorResponse(400, "VALIDATION_ERROR", "The removal reason is required.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await removeMeterAssignment(
      sessionToken,
      assignmentId,
      body.value.reason,
    );
    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (result.kind === "forbidden") {
      return errorResponse(
        403,
        "FORBIDDEN",
        "You are not allowed to remove meter assignments.",
      );
    }
    if (
      result.kind === "assignment-not-found" ||
      result.kind === "already-removed"
    ) {
      return errorResponse(
        404,
        "NOT_FOUND",
        "The active meter assignment was not found.",
      );
    }
    if (result.kind === "removal-reason-required") {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "The removal reason is required.",
      );
    }
    if (result.kind !== "success") {
      throw new Error("Meter assignment removal returned an unexpected result.");
    }

    const response = successResponse({
      assignmentId: result.assignmentId,
      meterId: result.meterId,
      accountId: result.accountId,
      updatedAt: result.updatedAt.toISOString(),
    });
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "UnknownError";
    console.error(
      `[meter-assignments.remove] Internal operation failed (${errorType}).`,
    );
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "The meter assignment could not be removed.",
    );
  }
}
