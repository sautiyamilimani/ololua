import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { asc } from "drizzle-orm";
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
import { parseCreateMeterInput } from "@/lib/meters/input";
import { createMeter } from "@/lib/meters/management";

export async function GET(): Promise<NextResponse> {
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

  const rows = await db
    .select({
      id: meters.id,
      serialNumber: meters.serialNumber,
      status: meters.status,
      notes: meters.notes,
      createdAt: meters.createdAt,
      updatedAt: meters.updatedAt,
    })
    .from(meters)
    .orderBy(asc(meters.serialNumber))
    .limit(100);

  return successResponse({
    meters: rows.map((meter) => ({
      ...meter,
      createdAt: meter.createdAt.toISOString(),
      updatedAt: meter.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
    return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return errorResponse(400, "VALIDATION_ERROR", "The meter request is invalid.");
  }
  const body = await readJsonBody(request);
  const input = body.ok ? parseCreateMeterInput(body.value) : null;
  if (!input) {
    return errorResponse(400, "VALIDATION_ERROR", "The meter request is invalid.");
  }

  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(sessionToken)) {
    return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  const result = await createMeter(sessionToken, input);
  if (result.kind === "unauthenticated") {
    return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  if (result.kind === "forbidden") {
    return errorResponse(403, "FORBIDDEN", "You are not allowed to manage meters.");
  }
  if (result.kind === "conflict") {
    return errorResponse(409, "METER_CONFLICT", "A meter with that serial number already exists.");
  }
  if (result.kind !== "success") {
    return errorResponse(500, "INTERNAL_ERROR", "The meter could not be created.");
  }

  const response = successResponse({
    meter: {
      id: result.meterId,
      serialNumber: result.serialNumber,
      status: result.status,
      updatedAt: result.updatedAt.toISOString(),
    },
  }, 201);
  setSessionCookie(response, sessionToken, result.sessionPolicy);
  return response;
}
