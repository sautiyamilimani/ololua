import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMeterAccounts,
  meterAssignments,
  meters,
  serviceVariants,
  zones,
} from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import {
  CUSTOMER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";
import { errorResponse, successResponse } from "@/lib/auth/response";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
): Promise<NextResponse> {
  const { accountId } = await context.params;
  if (!UUID_PATTERN.test(accountId)) {
    return errorResponse(400, "VALIDATION_ERROR", "The account request is invalid.");
  }
  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(sessionToken)) {
    return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  const session = await getActiveSession(sessionToken);
  if (
    !session ||
    session.user.accountType !== "staff" ||
    !(await userHasPermission(session.user.id, CUSTOMER_READ_PERMISSION))
  ) {
    return session
      ? errorResponse(403, "FORBIDDEN", "You are not allowed to read customer accounts.")
      : errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }

  const [account] = await db
    .select({
      id: customerMeterAccounts.id,
      accountNumber: customerMeterAccounts.accountNumber,
      customerId: customerMeterAccounts.customerId,
      propertyAddress: customerMeterAccounts.propertyAddress,
      locationDescription: customerMeterAccounts.locationDescription,
      notes: customerMeterAccounts.notes,
      status: customerMeterAccounts.status,
      variantCode: serviceVariants.variantCode,
      variantName: serviceVariants.variantName,
      zoneName: zones.zoneName,
      createdAt: customerMeterAccounts.createdAt,
      updatedAt: customerMeterAccounts.updatedAt,
    })
    .from(customerMeterAccounts)
    .innerJoin(serviceVariants, eq(customerMeterAccounts.serviceVariantId, serviceVariants.id))
    .leftJoin(zones, eq(customerMeterAccounts.zoneId, zones.id))
    .where(eq(customerMeterAccounts.id, accountId))
    .limit(1);
  if (!account) {
    return errorResponse(404, "NOT_FOUND", "The customer meter account was not found.");
  }

  const assignments = await db
    .select({
      id: meterAssignments.id,
      meterId: meters.id,
      serialNumber: meters.serialNumber,
      meterStatus: meters.status,
      initialReading: meterAssignments.initialReading,
      assignedAt: meterAssignments.assignedAt,
      removedAt: meterAssignments.removedAt,
    })
    .from(meterAssignments)
    .innerJoin(meters, eq(meterAssignments.meterId, meters.id))
    .where(eq(meterAssignments.customerMeterAccountId, accountId));

  return successResponse({
    account: {
      ...account,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    },
    assignments: assignments.map((assignment) => ({
      ...assignment,
      assignedAt: assignment.assignedAt.toISOString(),
      removedAt: assignment.removedAt?.toISOString() ?? null,
    })),
  });
}
