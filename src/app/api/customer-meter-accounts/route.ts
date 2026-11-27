import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { asc, eq, and, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerMeterAccounts,
  customers,
  meterAssignments,
  meters,
  permissions,
  rolePermissions,
  roles,
  serviceVariants,
  sessions,
  userRoles,
  users,
  zones,
} from "@/lib/db/schema";
import {
  CUSTOMER_MANAGE_PERMISSION,
  CUSTOMER_READ_PERMISSION,
  userHasPermission,
} from "@/lib/auth/permissions";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { parseCreateCustomerMeterAccountInput } from "@/lib/customer-meter-accounts/input";
import { getServiceVariantCategory } from "@/lib/customer-meter-accounts/service-variant-category";
import { getSessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";
import { randomUUID } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(request: Request): Promise<NextResponse> {
  const customerId = new URL(request.url).searchParams.get("customerId");
  if (!customerId || !UUID_PATTERN.test(customerId)) {
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

  const rows = await db
    .select({
      id: customerMeterAccounts.id,
      accountNumber: customerMeterAccounts.accountNumber,
      customerId: customerMeterAccounts.customerId,
      serviceVariantId: customerMeterAccounts.serviceVariantId,
      zoneId: customerMeterAccounts.zoneId,
      status: customerMeterAccounts.status,
      createdAt: customerMeterAccounts.createdAt,
      updatedAt: customerMeterAccounts.updatedAt,
    })
    .from(customerMeterAccounts)
    .where(eq(customerMeterAccounts.customerId, customerId))
    .orderBy(asc(customerMeterAccounts.accountNumber));

  return successResponse({
    accounts: rows.map((account) => ({
      ...account,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
    return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return errorResponse(400, "VALIDATION_ERROR", "The account request is invalid.");
  }
  const body = await readJsonBody(request);
  const input = body.ok ? parseCreateCustomerMeterAccountInput(body.value) : null;
  if (!input) {
    return errorResponse(400, "VALIDATION_ERROR", "The account request is invalid.");
  }

  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(sessionToken)) {
    return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }

  const now = new Date();
  try {
    const result = await db.transaction(async (transaction) => {
      const [session] = await transaction
        .select({
          id: sessions.id,
          userId: sessions.userId,
          revokedAt: sessions.revokedAt,
          idleExpiresAt: sessions.idleExpiresAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(eq(sessions.tokenHash, hashOpaqueToken(sessionToken)))
        .limit(1)
        .for("update");
      if (
        !session ||
        session.revokedAt !== null ||
        session.idleExpiresAt <= now ||
        session.expiresAt <= now
      ) return { kind: "unauthenticated" as const };

      const [actor] = await transaction
        .select({
          id: users.id,
          accountType: users.accountType,
          status: users.status,
          emailVerifiedAt: users.emailVerifiedAt,
        })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1)
        .for("update");
      if (
        !actor ||
        actor.accountType !== "staff" ||
        actor.status !== "active" ||
        actor.emailVerifiedAt === null
      ) return { kind: "unauthenticated" as const };

      const actorRoles = await transaction
        .select({
          roleKey: roles.roleKey,
          permissionKey: permissions.permissionKey,
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .leftJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(userRoles.userId, actor.id));
      if (!actorRoles.some((row) => row.permissionKey === CUSTOMER_MANAGE_PERMISSION)) {
        return { kind: "forbidden" as const };
      }

      const [customer] = await transaction
        .select({ id: customers.id, status: customers.status, isTrashed: customers.isTrashed })
        .from(customers)
        .where(eq(customers.id, input.customerId))
        .limit(1)
        .for("update");
      if (!customer) return { kind: "customer-not-found" as const };
      if (customer.status !== "active" || customer.isTrashed) {
        return { kind: "customer-inactive" as const };
      }

      const [variant] = await transaction
        .select({
          id: serviceVariants.id,
          status: serviceVariants.status,
          variantCode: serviceVariants.variantCode,
        })
        .from(serviceVariants)
        .where(eq(serviceVariants.id, input.serviceVariantId))
        .limit(1)
        .for("update");
      if (!variant) return { kind: "variant-not-found" as const };
      if (variant.status !== "ACTIVE") return { kind: "variant-inactive" as const };

      if (getServiceVariantCategory(variant.variantCode) === "domestic") {
        const [existingDomesticAccount] = await transaction
          .select({ id: customerMeterAccounts.id })
          .from(customerMeterAccounts)
          .innerJoin(
            serviceVariants,
            eq(customerMeterAccounts.serviceVariantId, serviceVariants.id),
          )
          .where(
            and(
              eq(customerMeterAccounts.customerId, customer.id),
              ne(customerMeterAccounts.status, "CLOSED"),
              sql`upper(${serviceVariants.variantCode}) like '%DOMESTIC%'`,
            ),
          )
          .limit(1);
        if (existingDomesticAccount) {
          return { kind: "domestic-account-exists" as const };
        }
      }

      if (input.zoneId) {
        const [zone] = await transaction
          .select({ id: zones.id })
          .from(zones)
          .where(eq(zones.id, input.zoneId))
          .limit(1)
          .for("update");
        if (!zone) return { kind: "zone-not-found" as const };
      }

      let meter: { id: string } | undefined;
      if (input.meterId) {
        const [selectedMeter] = await transaction
          .select({ id: meters.id, status: meters.status })
          .from(meters)
          .where(eq(meters.id, input.meterId))
          .limit(1)
          .for("update");
        if (!selectedMeter) return { kind: "meter-not-found" as const };
        if (selectedMeter.status !== "ACTIVE") return { kind: "meter-not-active" as const };
        const [activeAssignment] = await transaction
          .select({ id: meterAssignments.id })
          .from(meterAssignments)
          .where(and(eq(meterAssignments.meterId, selectedMeter.id), isNull(meterAssignments.removedAt)))
          .limit(1)
          .for("update");
        if (activeAssignment) return { kind: "meter-already-assigned" as const };
        meter = selectedMeter;
      }

      const sequenceResult = await transaction.execute<{ next_value: string }>(
        sql`SELECT nextval('public.customer_meter_accounts_account_number_seq')::text AS next_value`,
      );
      const nextValue = sequenceResult.rows[0]?.next_value;
      if (!nextValue || !/^\d+$/u.test(nextValue)) {
        throw new Error("Customer meter account number sequence returned an invalid value.");
      }
      const accountNumber = `OLO-${nextValue.padStart(6, "0")}`;
      const accountId = randomUUID();
      await transaction.insert(customerMeterAccounts).values({
        id: accountId,
        accountNumber,
        customerId: customer.id,
        serviceVariantId: variant.id,
        zoneId: input.zoneId,
        notes: input.notes,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      });

      if (meter) {
        await transaction.insert(meterAssignments).values({
          meterId: meter.id,
          customerMeterAccountId: accountId,
          initialReading: "0.000",
          locationDescription: input.locationDescription,
          assignedAt: now,
          assignedBy: actor.id,
          createdAt: now,
          updatedAt: now,
        });
      }

      await transaction.insert(auditLogs).values({
        actorUserId: actor.id,
        action: "customer_meter_account.create",
        entityType: "customer_meter_account",
        entityId: accountId,
        oldValues: null,
        newValues: {
          accountNumber,
          customerId: customer.id,
          serviceVariantId: variant.id,
          meterId: meter?.id ?? null,
          initialMeterLocationDescription: meter
            ? input.locationDescription
            : null,
        },
        createdAt: now,
      });

      const roleKeys = [...new Set(actorRoles.map((row) => row.roleKey))];
      const policy = getSessionPolicy("staff", roleKeys);
      await transaction
        .update(sessions)
        .set({
          lastActivityAt: now,
          idleExpiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
          expiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
        })
        .where(eq(sessions.id, session.id));

      return {
        kind: "success" as const,
        accountId,
        accountNumber,
        policy,
      };
    });

    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (result.kind === "forbidden") {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to manage customer accounts.");
    }
    if (result.kind === "customer-not-found") {
      return errorResponse(404, "NOT_FOUND", "The customer was not found.");
    }
    if (result.kind === "customer-inactive") {
      return errorResponse(409, "CUSTOMER_METER_ACCOUNT_CONFLICT", "Only active customers can receive new accounts.");
    }
    if (result.kind === "domestic-account-exists") {
      return errorResponse(
        409,
        "DOMESTIC_ACCOUNT_EXISTS",
        "This customer already has a Domestic Water account. Assign additional meters to that account instead.",
      );
    }
    if (
      result.kind === "variant-not-found" ||
      result.kind === "variant-inactive" ||
      result.kind === "zone-not-found" ||
      result.kind === "meter-not-found" ||
      result.kind === "meter-not-active" ||
      result.kind === "meter-already-assigned"
    ) {
      return errorResponse(409, "CUSTOMER_METER_ACCOUNT_CONFLICT", "The account or selected meter is not eligible.");
    }
    const response = successResponse({
      account: {
        id: result.accountId,
        accountNumber: result.accountNumber,
      },
    }, 201);
    setSessionCookie(response, sessionToken, result.policy);
    return response;
  } catch (error) {
    console.error("[customer-meter-accounts.create] Internal operation failed.", error instanceof Error ? error.name : "UnknownError");
    return errorResponse(500, "INTERNAL_ERROR", "The account could not be created.");
  }
}
