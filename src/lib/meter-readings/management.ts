import { and, desc, eq, gt, lte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerMeterAccounts,
  customerMeterBillings,
  meterAssignments,
  meterReadings,
  meters,
  permissions,
  rolePermissions,
  roles,
  serviceTariffs,
  settings,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";
import type { SubmitMeterReadingInput } from "./input";
import { getReadingConsumption } from "./state";
import { addCalendarDays, calculateBillingAmount, formatUtcDate } from "../meter-billings/state";

export type SubmitMeterReadingResult =
  | {
      kind: "success";
      readingId: string;
      previousReading: string;
      currentReading: string;
      consumption: string;
      unusualConsumptionFlag: boolean;
      invoiceId: string;
      invoiceNumber: string;
      tariffRate: string;
      totalAmount: string;
      dueDate: string;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "assignment-not-found" }
  | { kind: "assignment-inactive" }
  | { kind: "meter-not-active" }
  | { kind: "account-not-active" }
  | { kind: "duplicate-reading" }
  | { kind: "current-reading-too-low"; previousReading: string }
  | { kind: "backdated-approval-required" }
  | { kind: "tariff-not-found" }
  | { kind: "due-days-setting-invalid" };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function authorizeReadingSubmitter(
  transaction: DatabaseTransaction,
  sessionToken: string,
  now: Date,
) {
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
  if (!actorRoles.some((row) => row.permissionKey === "readings.submit")) {
    return { kind: "forbidden" as const };
  }

  const roleKeys = [...new Set(actorRoles.map((row) => row.roleKey))];
  const sessionPolicy = getSessionPolicy("staff", roleKeys);
  const nextExpiry = new Date(now.getTime() + sessionPolicy.idleTimeoutMs);
  await transaction
    .update(sessions)
    .set({
      lastActivityAt: now,
      idleExpiresAt: nextExpiry,
      expiresAt: nextExpiry,
    })
    .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)));

  return {
    kind: "authorized" as const,
    actorId: actor.id,
    policy: sessionPolicy,
  };
}

export async function submitMeterReading(
  sessionToken: string,
  input: SubmitMeterReadingInput,
): Promise<SubmitMeterReadingResult> {
  const now = new Date();

  try {
    return await db.transaction(async (transaction) => {
      const authorization = await authorizeReadingSubmitter(
        transaction,
        sessionToken,
        now,
      );
      if (authorization.kind !== "authorized") return authorization;

      const [assignment] = await transaction
        .select({
          id: meterAssignments.id,
          meterId: meterAssignments.meterId,
          accountId: meterAssignments.customerMeterAccountId,
          initialReading: meterAssignments.initialReading,
          assignedAt: meterAssignments.assignedAt,
          removedAt: meterAssignments.removedAt,
        })
        .from(meterAssignments)
        .where(eq(meterAssignments.id, input.meterAssignmentId))
        .limit(1)
        .for("update");
      if (!assignment) return { kind: "assignment-not-found" as const };
      if (assignment.removedAt !== null) return { kind: "assignment-inactive" as const };

      const [meter] = await transaction
        .select({ status: meters.status })
        .from(meters)
        .where(eq(meters.id, assignment.meterId))
        .limit(1)
        .for("update");
      if (!meter) return { kind: "assignment-not-found" as const };
      if (meter.status !== "ACTIVE") return { kind: "meter-not-active" as const };

      const [account] = await transaction
        .select({
          status: customerMeterAccounts.status,
          serviceVariantId: customerMeterAccounts.serviceVariantId,
        })
        .from(customerMeterAccounts)
        .where(eq(customerMeterAccounts.id, assignment.accountId))
        .limit(1)
        .for("update");
      if (!account) return { kind: "assignment-not-found" as const };
      if (account.status !== "ACTIVE") return { kind: "account-not-active" as const };

      const [existingIdempotency] = await transaction
        .select({ id: meterReadings.id })
        .from(meterReadings)
        .where(eq(meterReadings.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingIdempotency) return { kind: "duplicate-reading" as const };

      const [timestampDuplicate] = await transaction
        .select({ id: meterReadings.id })
        .from(meterReadings)
        .where(
          and(
            eq(meterReadings.meterAssignmentId, assignment.id),
            eq(meterReadings.readingAt, input.readingAt),
          ),
        )
        .limit(1);
      if (timestampDuplicate) return { kind: "duplicate-reading" as const };

      const [latestReading] = await transaction
        .select({
          readingAt: meterReadings.readingAt,
          currentReading: meterReadings.currentReading,
        })
        .from(meterReadings)
        .where(eq(meterReadings.meterAssignmentId, assignment.id))
        .orderBy(desc(meterReadings.readingAt))
        .limit(1)
        .for("update");

      if (
        latestReading &&
        input.readingAt.getTime() < latestReading.readingAt.getTime() &&
        input.backdatedApprovalReason === null
      ) {
        return { kind: "backdated-approval-required" as const };
      }

      const [precedingReading] = await transaction
        .select({
          readingAt: meterReadings.readingAt,
          currentReading: meterReadings.currentReading,
        })
        .from(meterReadings)
        .where(
          and(
            eq(meterReadings.meterAssignmentId, assignment.id),
            lte(meterReadings.readingAt, input.readingAt),
          ),
        )
        .orderBy(desc(meterReadings.readingAt))
        .limit(1)
        .for("update");

      const previousReading =
        precedingReading?.currentReading ??
        assignment.initialReading;
      const consumption = getReadingConsumption(
        previousReading,
        input.currentReading,
      );
      if (consumption === null) {
        return {
          kind: "current-reading-too-low" as const,
          previousReading,
        };
      }
      const unusualConsumptionFlag = consumption === "0.000";

      const [reading] = await transaction
        .insert(meterReadings)
        .values({
          meterAssignmentId: assignment.id,
          readingAt: input.readingAt,
          previousReading,
          currentReading: input.currentReading,
          consumption,
          submittedBy: authorization.actorId,
          idempotencyKey: input.idempotencyKey,
          unusualConsumptionFlag,
          notes: input.notes,
          createdAt: now,
        })
        .returning({ id: meterReadings.id });

      const [tariff] = await transaction
        .select({
          id: serviceTariffs.id,
          rate: serviceTariffs.rate,
        })
        .from(serviceTariffs)
        .where(
          and(
            eq(serviceTariffs.serviceVariantId, account.serviceVariantId),
            eq(serviceTariffs.status, "ACTIVE"),
            lte(serviceTariffs.effectiveFrom, input.readingAt),
            or(
              isNull(serviceTariffs.effectiveTo),
              gt(serviceTariffs.effectiveTo, input.readingAt),
            ),
          ),
        )
        .limit(1)
        .for("update");
      if (!tariff) {
        await transaction.delete(meterReadings).where(eq(meterReadings.id, reading.id));
        return { kind: "tariff-not-found" as const };
      }

      const [dueSetting] = await transaction
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, "invoice_due_days"))
        .limit(1)
        .for("update");
      if (!dueSetting || !/^\d+$/u.test(dueSetting.value)) {
        await transaction.delete(meterReadings).where(eq(meterReadings.id, reading.id));
        return { kind: "due-days-setting-invalid" as const };
      }
      const dueDays = Number(dueSetting.value);
      if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) {
        await transaction.delete(meterReadings).where(eq(meterReadings.id, reading.id));
        return { kind: "due-days-setting-invalid" as const };
      }

      const totalAmount = calculateBillingAmount(consumption, tariff.rate);
      if (totalAmount === null) {
        throw new Error("Failed to calculate invoice amount.");
      }
      const dueDate = addCalendarDays(now, dueDays);

      const sequenceResult = await transaction.execute<{ next_value: string }>(
        sql`SELECT nextval('public.customer_meter_billings_invoice_number_seq')::text AS next_value`,
      );
      const nextValue = sequenceResult.rows[0]?.next_value;
      if (!nextValue || !/^\d+$/u.test(nextValue)) {
        throw new Error("Invoice number sequence returned an invalid value.");
      }
      const invoiceNumber = `OLO-INV-${nextValue.padStart(6, "0")}`;
      const intervalStartCandidates = [
        input.readingAt,
        precedingReading?.readingAt ?? assignment.assignedAt,
      ];
      if (latestReading) {
        intervalStartCandidates.push(latestReading.readingAt);
      }
      const intervalStart = new Date(
        Math.min(...intervalStartCandidates.map((value) => value.getTime())),
      );
      const intervalEnd = new Date(
        Math.max(...intervalStartCandidates.map((value) => value.getTime())),
      );

      const [billing] = await transaction
        .insert(customerMeterBillings)
        .values({
          invoiceNumber,
          customerMeterAccountId: assignment.accountId,
          meterReadingId: reading.id,
          serviceTariffId: tariff.id,
          billingPeriodStart: formatUtcDate(intervalStart),
          billingPeriodEnd: formatUtcDate(intervalEnd),
          previousReading,
          currentReading: input.currentReading,
          consumption,
          tariffRate: tariff.rate,
          totalAmount,
          issuedAt: now,
          dueDate: formatUtcDate(dueDate),
          status: "UNPAID",
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: customerMeterBillings.id });

      await transaction.insert(auditLogs).values({
        actorUserId: authorization.actorId,
        action: "meter_reading.accept",
        entityType: "meter_reading",
        entityId: reading.id,
        oldValues: null,
        newValues: {
          meterAssignmentId: assignment.id,
          previousReading,
          currentReading: input.currentReading,
          consumption,
          unusualConsumptionFlag,
          invoiceId: billing.id,
          invoiceNumber,
          tariffRate: tariff.rate,
          totalAmount,
          dueDate: formatUtcDate(dueDate),
          backdatedApproval:
            latestReading &&
            input.readingAt.getTime() < latestReading.readingAt.getTime(),
        },
        metadata: input.backdatedApprovalReason
          ? { backdatedApprovalReason: input.backdatedApprovalReason }
          : null,
        createdAt: now,
      });

      return {
        kind: "success",
        readingId: reading.id,
        previousReading,
        currentReading: input.currentReading,
        consumption,
        unusualConsumptionFlag,
        invoiceId: billing.id,
        invoiceNumber,
        tariffRate: tariff.rate,
        totalAmount,
        dueDate: formatUtcDate(dueDate),
        sessionPolicy: authorization.policy,
      };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      typeof error.cause === "object" &&
      error.cause !== null &&
      "constraint" in error.cause &&
      typeof error.cause.constraint === "string"
    ) {
      if (
        error.cause.constraint === "meter_readings_idempotency_key_unique" ||
        error.cause.constraint === "meter_readings_assignment_time_unique"
      ) {
        return { kind: "duplicate-reading" };
      }
    }
    throw error;
  }
}
