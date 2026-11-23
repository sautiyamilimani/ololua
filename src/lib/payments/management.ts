import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerAccountCreditEntries,
  customerMeterAccounts,
  customerMeterBillings,
  customerMeterPaymentAllocations,
  customerMeterPayments,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";
import type { RecordPaymentInput } from "./input";
import { centsToMoney, moneyToCents } from "./state";

export type RecordPaymentResult =
  | {
      kind: "success";
      paymentId: string;
      receiptNumber: string;
      allocatedAmount: string;
      unallocatedAmount: string;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "account-not-found" }
  | { kind: "account-not-active" }
  | { kind: "invalid-allocation" }
  | { kind: "duplicate-external-reference" }
  | { kind: "conflict" };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function authorizePaymentRecorder(
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
    .where(eq(sessions.id, session.id));

  return { kind: "authorized" as const, actorId: actor.id, policy };
}

async function getAllocatedCents(
  transaction: DatabaseTransaction,
  billingId: string,
): Promise<bigint> {
  const result = await transaction.execute<{ allocated: string }>(
    sql`
      SELECT (
        COALESCE((
          SELECT SUM("allocated_amount")
          FROM "customer_meter_payment_allocations"
          WHERE "billing_id" = ${billingId}
        ), 0)
        -
        COALESCE((
          SELECT SUM("reversed_amount")
          FROM "payment_allocation_reversals"
          WHERE "billing_id" = ${billingId}
        ), 0)
      )::text AS allocated
    `,
  );
  return moneyToCents(result.rows[0]?.allocated ?? "0.00") ?? BigInt(0);
}

export async function recordPayment(
  sessionToken: string,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const now = new Date();
  const paymentAmount = moneyToCents(input.amount);
  if (paymentAmount === null) return { kind: "invalid-allocation" };

  try {
    return await db.transaction(async (transaction) => {
      const authorization = await authorizePaymentRecorder(
        transaction,
        sessionToken,
        now,
      );
      if (authorization.kind !== "authorized") return authorization;

      const [account] = await transaction
        .select({ id: customerMeterAccounts.id, status: customerMeterAccounts.status })
        .from(customerMeterAccounts)
        .where(eq(customerMeterAccounts.id, input.customerMeterAccountId))
        .limit(1)
        .for("update");
      if (!account) return { kind: "account-not-found" as const };
      if (account.status !== "ACTIVE") return { kind: "account-not-active" as const };

      const sequenceResult = await transaction.execute<{ next_value: string }>(
        sql`SELECT nextval('public.customer_meter_payments_receipt_number_seq')::text AS next_value`,
      );
      const nextValue = sequenceResult.rows[0]?.next_value;
      if (!nextValue || !/^\d+$/u.test(nextValue)) {
        throw new Error("Payment receipt number sequence returned an invalid value.");
      }
      const receiptNumber = `OLO-RCP-${nextValue.padStart(6, "0")}`;

      const [payment] = await transaction
        .insert(customerMeterPayments)
        .values({
          receiptNumber,
          externalReference: input.externalReference,
          customerMeterAccountId: account.id,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          status: "COMPLETED",
          paidAt: now,
          recordedBy: authorization.actorId,
          payerPhone: input.payerPhone,
          notes: input.notes,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: customerMeterPayments.id });

      let remaining = paymentAmount;
      const allocations: Array<{ billingId: string; amount: string }> = [];

      if (input.allocations === null) {
        const bills = await transaction
          .select({
            id: customerMeterBillings.id,
            totalAmount: customerMeterBillings.totalAmount,
            status: customerMeterBillings.status,
            issuedAt: customerMeterBillings.issuedAt,
          })
          .from(customerMeterBillings)
          .where(
            and(
              eq(customerMeterBillings.customerMeterAccountId, account.id),
              ne(customerMeterBillings.status, "PAID"),
              ne(customerMeterBillings.status, "CANCELLED"),
            ),
          )
          .orderBy(asc(customerMeterBillings.issuedAt), asc(customerMeterBillings.id))
          .for("update");

        for (const bill of bills) {
          if (remaining <= BigInt(0)) break;
          const total = moneyToCents(bill.totalAmount);
          if (total === null) continue;
          const allocated = await getAllocatedCents(transaction, bill.id);
          const outstanding = total - allocated;
          if (outstanding <= BigInt(0)) continue;
          const applied = remaining < outstanding ? remaining : outstanding;
          allocations.push({ billingId: bill.id, amount: centsToMoney(applied) });
          remaining -= applied;
        }
      } else {
        const seen = new Set<string>();
        let explicitTotal = BigInt(0);
        for (const requested of input.allocations) {
          if (seen.has(requested.billingId)) return { kind: "invalid-allocation" as const };
          seen.add(requested.billingId);
          const requestedAmount = moneyToCents(requested.amount);
          if (requestedAmount === null || requestedAmount <= BigInt(0)) {
            return { kind: "invalid-allocation" as const };
          }
          explicitTotal += requestedAmount;
          if (explicitTotal > paymentAmount) return { kind: "invalid-allocation" as const };

          const [bill] = await transaction
            .select({
              id: customerMeterBillings.id,
              totalAmount: customerMeterBillings.totalAmount,
              status: customerMeterBillings.status,
            })
            .from(customerMeterBillings)
            .where(eq(customerMeterBillings.id, requested.billingId))
            .limit(1)
            .for("update");
          if (
            !bill ||
            bill.status === "PAID" ||
            bill.status === "CANCELLED"
          ) return { kind: "invalid-allocation" as const };

          const [billAccount] = await transaction
            .select({ id: customerMeterBillings.id })
            .from(customerMeterBillings)
            .where(
              and(
                eq(customerMeterBillings.id, bill.id),
                eq(customerMeterBillings.customerMeterAccountId, account.id),
              ),
            )
            .limit(1);
          if (!billAccount) return { kind: "invalid-allocation" as const };

          const total = moneyToCents(bill.totalAmount);
          const allocated = await getAllocatedCents(transaction, bill.id);
          if (total === null || requestedAmount > total - allocated) {
            return { kind: "invalid-allocation" as const };
          }
          allocations.push({ billingId: bill.id, amount: requested.amount });
        }
        remaining = paymentAmount - explicitTotal;
      }

      for (const allocation of allocations) {
        await transaction.insert(customerMeterPaymentAllocations).values({
          paymentId: payment.id,
          billingId: allocation.billingId,
          customerMeterAccountId: account.id,
          allocatedAmount: allocation.amount,
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
        const allocated = await getAllocatedCents(transaction, bill.id);
        if (total === null) continue;
        const nextStatus =
          allocated >= total
            ? "PAID"
            : allocated > BigInt(0)
              ? "PARTIALLY_PAID"
              : "UNPAID";
        await transaction
          .update(customerMeterBillings)
          .set({ status: nextStatus, updatedAt: now })
          .where(eq(customerMeterBillings.id, bill.id));
      }

      if (remaining > BigInt(0)) {
        await transaction.insert(customerAccountCreditEntries).values({
          customerMeterAccountId: account.id,
          entryType: "PAYMENT_CREDIT",
          amount: centsToMoney(remaining),
          paymentId: payment.id,
          idempotencyKey: `payment-credit:${payment.id}`,
          createdBy: authorization.actorId,
          createdAt: now,
        });
      }

      await transaction.insert(auditLogs).values({
        actorUserId: authorization.actorId,
        action: "customer_meter_payment.record",
        entityType: "customer_meter_payment",
        entityId: payment.id,
        oldValues: null,
        newValues: {
          receiptNumber,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          allocations,
          unallocatedAmount: centsToMoney(remaining),
        },
        createdAt: now,
      });

      return {
        kind: "success",
        paymentId: payment.id,
        receiptNumber,
        allocatedAmount: centsToMoney(paymentAmount - remaining),
        unallocatedAmount: centsToMoney(remaining),
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
        error.cause.constraint === "customer_meter_payments_external_reference_unique"
      ) return { kind: "duplicate-external-reference" };
    }
    throw error;
  }
}
