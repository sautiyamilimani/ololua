import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerAccountCreditEntries,
  customerAccountCreditTransfers,
  customerMeterAccounts,
  customers,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";
import { createOpaqueToken } from "@/lib/auth/token";
import { centsToMoney, moneyToCents } from "./state";
import { creditEntryIdempotency } from "./credit-transfer-state";
import {
  canFinalizeCrossCustomerTransfer,
  creditTransferExpiresAt,
} from "./credit-transfer-approval-state";

export type InstantCreditTransferResult =
  | {
      kind: "success";
      transferId: string;
      amount: string;
      fromAccountId: string;
      toAccountId: string;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "account-not-found" }
  | { kind: "account-not-active" }
  | { kind: "different-customers" }
  | { kind: "same-account" }
  | { kind: "insufficient-credit" }
  | { kind: "invalid-transfer" };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function authorizeCreditTransfer(
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

async function getAvailableCredit(
  transaction: DatabaseTransaction,
  accountId: string,
): Promise<bigint> {
  const result = await transaction.execute<{ balance: string }>(
    sql`
      SELECT COALESCE(SUM("amount"), 0)::text AS balance
      FROM "customer_account_credit_entries"
      WHERE "customer_meter_account_id" = ${accountId}
    `,
  );
  return moneyToCents(result.rows[0]?.balance ?? "0.00") ?? BigInt(0);
}

export async function transferCreditInstantly(
  sessionToken: string,
  fromAccountId: string,
  toAccountId: string,
  amount: string,
): Promise<InstantCreditTransferResult> {
  const transferAmount = moneyToCents(amount);
  if (transferAmount === null || transferAmount <= BigInt(0)) {
    return { kind: "invalid-transfer" };
  }
  if (fromAccountId === toAccountId) return { kind: "same-account" };
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeCreditTransfer(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") return authorization;

    const orderedAccountIds = [fromAccountId, toAccountId].sort();
    const accounts = await transaction
      .select({
        id: customerMeterAccounts.id,
        customerId: customerMeterAccounts.customerId,
        status: customerMeterAccounts.status,
      })
      .from(customerMeterAccounts)
      .where(sql`${customerMeterAccounts.id} in (${sql.join(
        orderedAccountIds.map((id) => sql`${id}`),
        sql`, `,
      )})`)
      .orderBy(customerMeterAccounts.id)
      .for("update");

    const from = accounts.find((account) => account.id === fromAccountId);
    const to = accounts.find((account) => account.id === toAccountId);
    if (!from || !to) return { kind: "account-not-found" as const };
    if (from.status !== "ACTIVE" || to.status !== "ACTIVE") {
      return { kind: "account-not-active" as const };
    }
    if (from.customerId !== to.customerId) {
      return { kind: "different-customers" as const };
    }

    const available = await getAvailableCredit(transaction, from.id);
    if (available < transferAmount) {
      return { kind: "insufficient-credit" as const };
    }

    const [transfer] = await transaction
      .insert(customerAccountCreditTransfers)
      .values({
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: centsToMoney(transferAmount),
        status: "CONFIRMED",
        senderApprovedAt: now,
        recipientConfirmedAt: now,
        expiresAt: null,
        createdBy: authorization.actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: customerAccountCreditTransfers.id });

    await transaction.insert(customerAccountCreditEntries).values([
      {
        customerMeterAccountId: from.id,
        entryType: "TRANSFER_OUT",
        amount: `-${centsToMoney(transferAmount)}`,
        transferId: transfer.id,
        idempotencyKey: creditEntryIdempotency(transfer.id, "OUT"),
        createdBy: authorization.actorId,
        createdAt: now,
      },
      {
        customerMeterAccountId: to.id,
        entryType: "TRANSFER_IN",
        amount: centsToMoney(transferAmount),
        transferId: transfer.id,
        idempotencyKey: creditEntryIdempotency(transfer.id, "IN"),
        createdBy: authorization.actorId,
        createdAt: now,
      },
    ]);

    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: "customer_account_credit_transfer.instant",
      entityType: "customer_account_credit_transfer",
      entityId: transfer.id,
      oldValues: null,
      newValues: {
        status: "CONFIRMED",
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: centsToMoney(transferAmount),
      },
      createdAt: now,
    });

    return {
      kind: "success",
      transferId: transfer.id,
      amount: centsToMoney(transferAmount),
      fromAccountId: from.id,
      toAccountId: to.id,
      sessionPolicy: authorization.policy,
    };
  });
}

export type RequestCrossCustomerTransferResult =
  | {
      kind: "success";
      transferId: string;
      senderToken: string;
      recipientToken: string;
      expiresAt: Date;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "account-not-found" }
  | { kind: "account-not-active" }
  | { kind: "same-customer" }
  | { kind: "insufficient-credit" }
  | { kind: "invalid-transfer" };

export async function requestCrossCustomerTransfer(
  sessionToken: string,
  fromAccountId: string,
  toAccountId: string,
  amount: string,
): Promise<RequestCrossCustomerTransferResult> {
  const transferAmount = moneyToCents(amount);
  if (transferAmount === null || transferAmount <= BigInt(0)) {
    return { kind: "invalid-transfer" };
  }
  if (fromAccountId === toAccountId) return { kind: "invalid-transfer" };
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeCreditTransfer(transaction, sessionToken, now);
    if (authorization.kind !== "authorized") return authorization;

    const orderedAccountIds = [fromAccountId, toAccountId].sort();
    const accounts = await transaction
      .select({
        id: customerMeterAccounts.id,
        customerId: customerMeterAccounts.customerId,
        status: customerMeterAccounts.status,
      })
      .from(customerMeterAccounts)
      .where(sql`${customerMeterAccounts.id} in (${sql.join(
        orderedAccountIds.map((id) => sql`${id}`),
        sql`, `,
      )})`)
      .orderBy(customerMeterAccounts.id)
      .for("update");
    const from = accounts.find((account) => account.id === fromAccountId);
    const to = accounts.find((account) => account.id === toAccountId);
    if (!from || !to) return { kind: "account-not-found" as const };
    if (from.status !== "ACTIVE" || to.status !== "ACTIVE") {
      return { kind: "account-not-active" as const };
    }
    if (from.customerId === to.customerId) {
      return { kind: "same-customer" as const };
    }

    const available = await getAvailableCredit(transaction, from.id);
    if (available < transferAmount) {
      return { kind: "insufficient-credit" as const };
    }

    const [fromCustomer] = await transaction
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, from.customerId))
      .limit(1);
    const [toCustomer] = await transaction
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, to.customerId))
      .limit(1);
    if (!fromCustomer || !toCustomer) return { kind: "account-not-found" as const };

    const senderToken = createOpaqueToken();
    const recipientToken = createOpaqueToken();
    const expiresAt = creditTransferExpiresAt(now);

    const [transfer] = await transaction
      .insert(customerAccountCreditTransfers)
      .values({
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: centsToMoney(transferAmount),
        status: "PENDING",
        senderTokenHash: hashOpaqueToken(senderToken),
        recipientTokenHash: hashOpaqueToken(recipientToken),
        recipientEmail: toCustomer.email,
        expiresAt,
        createdBy: authorization.actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: customerAccountCreditTransfers.id });

    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: "customer_account_credit_transfer.request",
      entityType: "customer_account_credit_transfer",
      entityId: transfer.id,
      oldValues: null,
      newValues: {
        status: "PENDING",
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: centsToMoney(transferAmount),
        senderEmail: fromCustomer.email,
        recipientEmail: toCustomer.email,
        expiresAt: expiresAt.toISOString(),
      },
      createdAt: now,
    });

    return {
      kind: "success",
      transferId: transfer.id,
      senderToken,
      recipientToken,
      expiresAt,
      sessionPolicy: authorization.policy,
    };
  });
}

export type ConfirmCrossCustomerTransferResult =
  | {
      kind: "success";
      transferId: string;
      status: "PENDING" | "CONFIRMED" | "FAILED";
    }
  | { kind: "transfer-not-found" }
  | { kind: "transfer-expired" }
  | { kind: "already-approved" }
  | { kind: "insufficient-credit" };

export async function confirmCrossCustomerTransfer(
  approvalRole: "sender" | "recipient",
  token: string,
): Promise<ConfirmCrossCustomerTransferResult> {
  const now = new Date();
  const tokenHash = hashOpaqueToken(token);

  return db.transaction(async (transaction) => {
    const transferQuery = await transaction
      .select({
        id: customerAccountCreditTransfers.id,
        fromAccountId: customerAccountCreditTransfers.fromAccountId,
        toAccountId: customerAccountCreditTransfers.toAccountId,
        amount: customerAccountCreditTransfers.amount,
        status: customerAccountCreditTransfers.status,
        senderTokenHash: customerAccountCreditTransfers.senderTokenHash,
        recipientTokenHash: customerAccountCreditTransfers.recipientTokenHash,
        senderApprovedAt: customerAccountCreditTransfers.senderApprovedAt,
        recipientConfirmedAt: customerAccountCreditTransfers.recipientConfirmedAt,
        expiresAt: customerAccountCreditTransfers.expiresAt,
      })
      .from(customerAccountCreditTransfers)
      .where(
        approvalRole === "sender"
          ? eq(customerAccountCreditTransfers.senderTokenHash, tokenHash)
          : eq(customerAccountCreditTransfers.recipientTokenHash, tokenHash),
      )
      .limit(1)
      .for("update");
    const transfer = transferQuery[0];
    if (!transfer) return { kind: "transfer-not-found" as const };
    if (transfer.status === "EXPIRED") return { kind: "transfer-expired" as const };
    if (transfer.status !== "PENDING") {
      return { kind: "already-approved" as const };
    }
    if (transfer.expiresAt !== null && transfer.expiresAt <= now) {
      await transaction
        .update(customerAccountCreditTransfers)
        .set({ status: "EXPIRED", updatedAt: now })
        .where(eq(customerAccountCreditTransfers.id, transfer.id));
      return { kind: "transfer-expired" as const };
    }

    if (approvalRole === "sender") {
      if (transfer.senderApprovedAt !== null) {
        return { kind: "already-approved" as const };
      }
      await transaction
        .update(customerAccountCreditTransfers)
        .set({ senderApprovedAt: now, updatedAt: now })
        .where(eq(customerAccountCreditTransfers.id, transfer.id));
    } else {
      if (transfer.recipientConfirmedAt !== null) {
        return { kind: "already-approved" as const };
      }
      await transaction
        .update(customerAccountCreditTransfers)
        .set({ recipientConfirmedAt: now, updatedAt: now })
        .where(eq(customerAccountCreditTransfers.id, transfer.id));
    }

    const senderApprovedAt =
      approvalRole === "sender" ? now : transfer.senderApprovedAt;
    const recipientConfirmedAt =
      approvalRole === "recipient" ? now : transfer.recipientConfirmedAt;

    if (
      !canFinalizeCrossCustomerTransfer(
        senderApprovedAt,
        recipientConfirmedAt,
        transfer.expiresAt,
        now,
      )
    ) {
      return {
        kind: "success",
        transferId: transfer.id,
        status: "PENDING",
      };
    }

    const accountIds = [transfer.fromAccountId, transfer.toAccountId].sort();
    const accounts = await transaction
      .select({
        id: customerMeterAccounts.id,
        status: customerMeterAccounts.status,
      })
      .from(customerMeterAccounts)
      .where(sql`${customerMeterAccounts.id} in (${sql.join(
        accountIds.map((id) => sql`${id}`),
        sql`, `,
      )})`)
      .orderBy(customerMeterAccounts.id)
      .for("update");
    const from = accounts.find((account) => account.id === transfer.fromAccountId);
    const to = accounts.find((account) => account.id === transfer.toAccountId);
    if (
      !from ||
      !to ||
      from.status !== "ACTIVE" ||
      to.status !== "ACTIVE"
    ) {
      await transaction
        .update(customerAccountCreditTransfers)
        .set({ status: "FAILED", updatedAt: now })
        .where(eq(customerAccountCreditTransfers.id, transfer.id));
      return {
        kind: "success",
        transferId: transfer.id,
        status: "FAILED",
      };
    }

    const transferAmount = moneyToCents(transfer.amount);
    if (transferAmount === null) {
      return { kind: "insufficient-credit" as const };
    }
    const available = await getAvailableCredit(transaction, from.id);
    if (available < transferAmount) {
      await transaction
        .update(customerAccountCreditTransfers)
        .set({ status: "FAILED", updatedAt: now })
        .where(eq(customerAccountCreditTransfers.id, transfer.id));
      return { kind: "insufficient-credit" as const };
    }

    await transaction.insert(customerAccountCreditEntries).values([
      {
        customerMeterAccountId: from.id,
        entryType: "TRANSFER_OUT",
        amount: `-${centsToMoney(transferAmount)}`,
        transferId: transfer.id,
        idempotencyKey: creditEntryIdempotency(transfer.id, "OUT"),
        createdAt: now,
      },
      {
        customerMeterAccountId: to.id,
        entryType: "TRANSFER_IN",
        amount: centsToMoney(transferAmount),
        transferId: transfer.id,
        idempotencyKey: creditEntryIdempotency(transfer.id, "IN"),
        createdAt: now,
      },
    ]);

    await transaction
      .update(customerAccountCreditTransfers)
      .set({ status: "CONFIRMED", updatedAt: now })
      .where(eq(customerAccountCreditTransfers.id, transfer.id));

    await transaction.insert(auditLogs).values({
      actorUserId: null,
      action: "customer_account_credit_transfer.confirm",
      entityType: "customer_account_credit_transfer",
      entityId: transfer.id,
      oldValues: { status: "PENDING" },
      newValues: { status: "CONFIRMED", amount: transfer.amount },
      createdAt: now,
    });

    return {
      kind: "success",
      transferId: transfer.id,
      status: "CONFIRMED",
    };
  });
}

export type RevokeCrossCustomerTransferResult =
  | { kind: "success"; transferId: string; sessionPolicy: SessionPolicy }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "transfer-not-found" }
  | { kind: "not-pending" }
  | { kind: "invalid-revoke-reason" };

export async function revokeCrossCustomerTransfer(
  sessionToken: string,
  transferId: string,
  reason: string,
): Promise<RevokeCrossCustomerTransferResult> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length === 0) {
    return { kind: "invalid-revoke-reason" };
  }
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeCreditTransfer(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") return authorization;

    const [transfer] = await transaction
      .select({
        id: customerAccountCreditTransfers.id,
        status: customerAccountCreditTransfers.status,
        createdBy: customerAccountCreditTransfers.createdBy,
      })
      .from(customerAccountCreditTransfers)
      .where(eq(customerAccountCreditTransfers.id, transferId))
      .limit(1)
      .for("update");
    if (!transfer) return { kind: "transfer-not-found" as const };
    if (transfer.createdBy !== authorization.actorId) {
      return { kind: "forbidden" as const };
    }
    if (transfer.status !== "PENDING") {
      return { kind: "not-pending" as const };
    }

    await transaction
      .update(customerAccountCreditTransfers)
      .set({
        status: "REVOKED",
        revokedAt: now,
        reversalReason: normalizedReason,
        updatedAt: now,
      })
      .where(eq(customerAccountCreditTransfers.id, transfer.id));

    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: "customer_account_credit_transfer.revoke",
      entityType: "customer_account_credit_transfer",
      entityId: transfer.id,
      oldValues: { status: "PENDING" },
      newValues: { status: "REVOKED" },
      metadata: { reason: normalizedReason },
      createdAt: now,
    });

    return {
      kind: "success",
      transferId: transfer.id,
      sessionPolicy: authorization.policy,
    };
  });
}

export type ExpirePendingTransfersResult =
  | { kind: "success"; expiredCount: number }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" };

export async function expirePendingCreditTransfers(
  sessionToken: string,
): Promise<ExpirePendingTransfersResult> {
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeCreditTransfer(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") return authorization;

    const expired = await transaction
      .select({ id: customerAccountCreditTransfers.id })
      .from(customerAccountCreditTransfers)
      .where(
        and(
          eq(customerAccountCreditTransfers.status, "PENDING"),
          sql`${customerAccountCreditTransfers.expiresAt} is not null`,
          sql`${customerAccountCreditTransfers.expiresAt} <= ${now}`,
        ),
      )
      .orderBy(customerAccountCreditTransfers.id)
      .for("update");

    for (const transfer of expired) {
      await transaction
        .update(customerAccountCreditTransfers)
        .set({ status: "EXPIRED", updatedAt: now })
        .where(eq(customerAccountCreditTransfers.id, transfer.id));
      await transaction.insert(auditLogs).values({
        actorUserId: authorization.actorId,
        action: "customer_account_credit_transfer.expire",
        entityType: "customer_account_credit_transfer",
        entityId: transfer.id,
        oldValues: { status: "PENDING" },
        newValues: { status: "EXPIRED" },
        createdAt: now,
      });
    }

    return { kind: "success", expiredCount: expired.length };
  });
}
