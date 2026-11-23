import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerAccountCreditEntries,
  customerMeterBillings,
  customerMeterPaymentAllocations,
  customerMeterPayments,
  paymentAllocationReversals,
  paymentReversals,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";
import { centsToMoney, moneyToCents } from "./state";

export type ReversePaymentResult =
  | {
      kind: "success";
      paymentId: string;
      reversalId: string;
      reversedAllocationAmount: string;
      restoredCreditAmount: string;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "payment-not-found" }
  | { kind: "already-reversed" }
  | { kind: "invalid-reversal" };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function authorizePaymentReverser(
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
  if (!actorRoles.some((row) => row.permissionKey === "payments.record")) {
    return { kind: "forbidden" as const };
  }

  const roleKeys = [...new Set(actorRoles.map((row) => row.roleKey))];
  const policy = getSessionPolicy("staff", roleKeys);
  await transaction
    .update(sessions)
    .set({
      lastActivityAt: now,
      idleExpiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
      expiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
    })
    .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)));

  return { kind: "authorized" as const, actorId: actor.id, policy };
}

async function getBillAllocations(
  transaction: DatabaseTransaction,
  billingId: string,
): Promise<bigint> {
  const result = await transaction.execute<{
    allocated: string;
    reversed: string;
  }>(
    sql`
      SELECT
        COALESCE((
          SELECT SUM("allocated_amount")
          FROM "customer_meter_payment_allocations"
          WHERE "billing_id" = ${billingId}
        ), 0)::text AS allocated,
        COALESCE((
          SELECT SUM("reversed_amount")
          FROM "payment_allocation_reversals"
          WHERE "billing_id" = ${billingId}
        ), 0)::text AS reversed
    `,
  );
  const allocated = moneyToCents(result.rows[0]?.allocated ?? "0.00") ?? BigInt(0);
  const reversed = moneyToCents(result.rows[0]?.reversed ?? "0.00") ?? BigInt(0);
  return allocated - reversed;
}

export async function reversePayment(
  sessionToken: string,
  paymentId: string,
  reason: string,
): Promise<ReversePaymentResult> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length === 0) return { kind: "invalid-reversal" };
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizePaymentReverser(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") return authorization;

    const [payment] = await transaction
      .select({
        id: customerMeterPayments.id,
        accountId: customerMeterPayments.customerMeterAccountId,
        amount: customerMeterPayments.amount,
        status: customerMeterPayments.status,
      })
      .from(customerMeterPayments)
      .where(eq(customerMeterPayments.id, paymentId))
      .limit(1)
      .for("update");
    if (!payment) return { kind: "payment-not-found" as const };
    if (payment.status === "REVERSED") return { kind: "already-reversed" as const };
    if (payment.status !== "COMPLETED") return { kind: "invalid-reversal" as const };

    const [existingReversal] = await transaction
      .select({ id: paymentReversals.id })
      .from(paymentReversals)
      .where(eq(paymentReversals.paymentId, payment.id))
      .limit(1)
      .for("update");
    if (existingReversal) return { kind: "already-reversed" as const };

    const allocations = await transaction
      .select({
        billingId: customerMeterPaymentAllocations.billingId,
        amount: customerMeterPaymentAllocations.allocatedAmount,
      })
      .from(customerMeterPaymentAllocations)
      .where(eq(customerMeterPaymentAllocations.paymentId, payment.id))
      .for("update");

    const paymentAmount = moneyToCents(payment.amount);
    if (paymentAmount === null) return { kind: "invalid-reversal" as const };
    let reversedAllocationAmount = BigInt(0);

    const [reversal] = await transaction
      .insert(paymentReversals)
      .values({
        paymentId: payment.id,
        reversedBy: authorization.actorId,
        reason: normalizedReason,
        reversedAt: now,
        createdAt: now,
      })
      .returning({ id: paymentReversals.id });

    for (const allocation of allocations) {
      const amount = moneyToCents(allocation.amount);
      if (amount === null) continue;
      reversedAllocationAmount += amount;

      await transaction.insert(paymentAllocationReversals).values({
        reversalId: reversal.id,
        paymentId: payment.id,
        billingId: allocation.billingId,
        customerMeterAccountId: payment.accountId,
        reversedAmount: allocation.amount,
        createdBy: authorization.actorId,
        createdAt: now,
      });

      const [bill] = await transaction
        .select({
          id: customerMeterBillings.id,
          totalAmount: customerMeterBillings.totalAmount,
        })
        .from(customerMeterBillings)
        .where(eq(customerMeterBillings.id, allocation.billingId))
        .limit(1)
        .for("update");
      if (!bill) continue;

      const total = moneyToCents(bill.totalAmount);
      const currentlyAllocated = await getBillAllocations(
        transaction,
        bill.id,
      );
      if (total === null) continue;
      const status =
        currentlyAllocated >= total
          ? "PAID"
          : currentlyAllocated > BigInt(0)
            ? "PARTIALLY_PAID"
            : "UNPAID";
      await transaction
        .update(customerMeterBillings)
        .set({ status, updatedAt: now })
        .where(eq(customerMeterBillings.id, bill.id));
    }

    const restoredCreditAmount =
      paymentAmount - reversedAllocationAmount;
    if (restoredCreditAmount > BigInt(0)) {
      await transaction.insert(customerAccountCreditEntries).values({
        customerMeterAccountId: payment.accountId,
        entryType: "REVERSAL",
        amount: centsToMoney(restoredCreditAmount),
        paymentId: payment.id,
        idempotencyKey: `payment-reversal-credit:${reversal.id}`,
        createdBy: authorization.actorId,
        createdAt: now,
      });
    }

    await transaction
      .update(customerMeterPayments)
      .set({
        status: "REVERSED",
        reversedAt: now,
        reversedBy: authorization.actorId,
        reversalReason: normalizedReason,
        updatedAt: now,
      })
      .where(eq(customerMeterPayments.id, payment.id));

    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: "customer_meter_payment.reverse",
      entityType: "customer_meter_payment",
      entityId: payment.id,
      oldValues: {
        status: "COMPLETED",
      },
      newValues: {
        status: "REVERSED",
        reversedAllocationAmount: centsToMoney(reversedAllocationAmount),
        restoredCreditAmount: centsToMoney(restoredCreditAmount),
      },
      metadata: { reason: normalizedReason },
      createdAt: now,
    });

    return {
      kind: "success",
      paymentId: payment.id,
      reversalId: reversal.id,
      reversedAllocationAmount: centsToMoney(reversedAllocationAmount),
      restoredCreditAmount: centsToMoney(restoredCreditAmount),
      sessionPolicy: authorization.policy,
    };
  });
}
