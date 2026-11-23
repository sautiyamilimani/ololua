import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerMeterAccounts,
  permissions,
  rolePermissions,
  sessions,
  userRoles,
  users,
  roles,
} from "@/lib/db/schema";
import { CUSTOMER_MANAGE_PERMISSION } from "@/lib/auth/permissions";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";
import {
  getCustomerMeterAccountStatusAfterTransition,
  type CustomerMeterAccountStatus,
  type CustomerMeterAccountTransition,
} from "./lifecycle-state";

export type LifecycleResult =
  | {
      kind: "success";
      accountId: string;
      previousStatus: CustomerMeterAccountStatus;
      status: CustomerMeterAccountStatus;
      updatedAt: Date;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "invalid-transition" };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function authorizeLifecycleManager(
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
  ) {
    return { kind: "unauthenticated" as const };
  }

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
  ) {
    return { kind: "unauthenticated" as const };
  }

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

  if (
    !actorRoles.some(
      (row) => row.permissionKey === CUSTOMER_MANAGE_PERMISSION,
    )
  ) {
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
    .where(
      and(
        eq(sessions.id, session.id),
        isNull(sessions.revokedAt),
      ),
    );

  return {
    kind: "authorized" as const,
    actorId: actor.id,
    policy: sessionPolicy,
  };
}

export async function transitionCustomerMeterAccount(
  sessionToken: string,
  accountId: string,
  transition: CustomerMeterAccountTransition,
  reason?: string,
): Promise<LifecycleResult> {
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeLifecycleManager(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") {
      return authorization;
    }

    const [account] = await transaction
      .select({
        id: customerMeterAccounts.id,
        status: customerMeterAccounts.status,
      })
      .from(customerMeterAccounts)
      .where(eq(customerMeterAccounts.id, accountId))
      .limit(1)
      .for("update");

    if (!account) {
      return { kind: "not-found" as const };
    }

    const previousStatus = account.status as CustomerMeterAccountStatus;
    const nextStatus = getCustomerMeterAccountStatusAfterTransition(
      previousStatus,
      transition,
    );
    if (nextStatus === null) {
      return { kind: "invalid-transition" as const };
    }

    await transaction
      .update(customerMeterAccounts)
      .set({
        status: nextStatus,
        updatedAt: now,
      })
      .where(eq(customerMeterAccounts.id, account.id));

    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: `customer_meter_account.${transition.toLowerCase()}`,
      entityType: "customer_meter_account",
      entityId: account.id,
      oldValues: { status: previousStatus },
      newValues: { status: nextStatus },
      metadata: reason ? { reason: reason.trim() } : null,
      createdAt: now,
    });

    return {
      kind: "success",
      accountId: account.id,
      previousStatus,
      status: nextStatus,
      updatedAt: now,
      sessionPolicy: authorization.policy,
    };
  });
}
