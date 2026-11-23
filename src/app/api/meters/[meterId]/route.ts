import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { meters } from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import {
  METER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { parseUpdateMeterInput } from "@/lib/meters/input";
import { updateMeter } from "@/lib/meters/management";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  context: { params: Promise<{ meterId: string }> },
): Promise<NextResponse> {
  const { meterId } = await context.params;
  if (!UUID_PATTERN.test(meterId)) {
    return errorResponse(400, "VALIDATION_ERROR", "The meter request is invalid.");
  }

  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(sessionToken)) {
    return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  const session = await getActiveSession(sessionToken);
  if (
    !session ||
    session.user.accountType !== "staff" ||
    !(await userHasPermission(session.user.id, METER_READ_PERMISSION))
  ) {
    return session
      ? errorResponse(403, "FORBIDDEN", "You are not allowed to read meters.")
      : errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }

  const [meter] = await db
    .select({
      id: meters.id,
      serialNumber: meters.serialNumber,
      status: meters.status,
      notes: meters.notes,
      createdAt: meters.createdAt,
      updatedAt: meters.updatedAt,
    })
    .from(meters)
    .where(eq(meters.id, meterId))
    .limit(1);
  if (!meter) {
    return errorResponse(404, "NOT_FOUND", "The meter was not found.");
  }

  return successResponse({
    meter: {
      ...meter,
      createdAt: meter.createdAt.toISOString(),
      updatedAt: meter.updatedAt.toISOString(),
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ meterId: string }> },
): Promise<NextResponse> {
  if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
    return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
  }
  const { meterId } = await context.params;
  if (!UUID_PATTERN.test(meterId)) {
    return errorResponse(400, "VALIDATION_ERROR", "The meter request is invalid.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return errorResponse(400, "VALIDATION_ERROR", "The meter request is invalid.");
  }
  const body = await readJsonBody(request);
  const input = body.ok ? parseUpdateMeterInput(body.value) : null;
  if (!input) {
    return errorResponse(400, "VALIDATION_ERROR", "The meter request is invalid.");
  }

  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(sessionToken)) {
    return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  const result = await updateMeter(sessionToken, meterId, input);
  if (result.kind === "unauthenticated") {
    return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  if (result.kind === "forbidden") {
    return errorResponse(403, "FORBIDDEN", "You are not allowed to manage meters.");
  }
  if (result.kind === "not-found") {
    return errorResponse(404, "NOT_FOUND", "The meter was not found.");
  }
  if (result.kind === "conflict") {
    return errorResponse(409, "METER_CONFLICT", "A meter with that serial number already exists.");
  }
  if (result.kind !== "success") {
    return errorResponse(500, "INTERNAL_ERROR", "The meter could not be updated.");
  }

  const response = successResponse({
    meter: {
      id: result.meterId,
      serialNumber: result.serialNumber,
      status: result.status,
      updatedAt: result.updatedAt.toISOString(),
    },
  });
  setSessionCookie(response, sessionToken, result.sessionPolicy);
  return response;
}
