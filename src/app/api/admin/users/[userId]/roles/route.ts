import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { isRecord, readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { changeStaffRoles } from "@/lib/auth/staff-roles";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/u;

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[admin.staff-roles] Internal operation failed (${errorType}).`);
}

function parseRequestedRoleKeys(value: unknown): string[] | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.roleKeys) ||
    value.roleKeys.length === 0 ||
    value.roleKeys.length > 20
  ) {
    return null;
  }

  const roleKeys: string[] = [];

  for (const roleKey of value.roleKeys) {
    if (typeof roleKey !== "string" || !ROLE_KEY_PATTERN.test(roleKey)) {
      return null;
    }

    roleKeys.push(roleKey);
  }

  return new Set(roleKeys).size === roleKeys.length ? roleKeys : null;
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
      return errorResponse(400, "VALIDATION_ERROR", "The role request is invalid.");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();

    if (contentType?.toLowerCase() !== "application/json") {
      return errorResponse(400, "VALIDATION_ERROR", "The role request is invalid.");
    }

    const bodyResult = await readJsonBody(request);

    if (!bodyResult.ok) {
      return errorResponse(400, "VALIDATION_ERROR", "The role request is invalid.");
    }

    const roleKeys = parseRequestedRoleKeys(bodyResult.value);

    if (!roleKeys) {
      return errorResponse(400, "VALIDATION_ERROR", "Select at least one valid staff role.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await changeStaffRoles(
      sessionToken,
      userId,
      roleKeys,
      request.headers.get("user-agent"),
    );

    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    if (result.kind === "forbidden") {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to change this staff member's roles.");
    }

    if (result.kind === "not-found") {
      return errorResponse(404, "NOT_FOUND", "The staff account was not found.");
    }

    if (result.kind === "role-not-found") {
      return errorResponse(400, "VALIDATION_ERROR", "One or more selected roles are not allowed.");
    }

    if (result.kind === "role-conflict") {
      return errorResponse(
        409,
        "STAFF_ROLE_CHANGE_CONFLICT",
        "The roles or account status changed. Refresh the page and try again.",
      );
    }

    if (result.kind === "last-active-admin") {
      return errorResponse(
        409,
        "LAST_ACTIVE_ADMIN",
        "At least one active admin must remain.",
      );
    }

    const response = successResponse({
      userId,
      roleKeys: result.roleKeys,
    });
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
