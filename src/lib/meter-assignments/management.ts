import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerMeterAccounts,
  meterAssignments,
  meters,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { CUSTOMER_MANAGE_PERMISSION } from "@/lib/auth/permissions";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";

export type MeterAssignmentResult =
  | {
      kind: "success";
      assignmentId: string;
      meterId: string;
      accountId: string;
      updatedAt: Date;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "meter-not-found" }
  | { kind: "meter-not-active" }
  | { kind: "account-not-found" }
  | { kind: "account-not-active" }
  | { kind: "meter-already-assigned" }
  | { kind: "assignment-not-found" }
  | { kind: "already-removed" }
  | { kind: "removal-reason-required" };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function authorizeMeterAssignmentManager(
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

  if (!actorRoles.some((row) => row.permissionKey === CUSTOMER_MANAGE_PERMISSION)) {
    return { kind: "forbidden" as const };
  }

  const roleKeys = [...new Set(actorRoles.map((row) => row.roleKey))];
  const policy = getSessionPolicy("staff", roleKeys);
  const nextExpiry = new Date(now.getTime() + policy.idleTimeoutMs);

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
    policy,
  };
}

export async function assignMeter(
  sessionToken: string,
  meterId: string,
  accountId: string,
): Promise<MeterAssignmentResult> {
  const now = new Date();
  try {
    return await db.transaction(async (transaction) => {
      const authorization = await authorizeMeterAssignmentManager(
        transaction,
        sessionToken,
        now,
      );
      if (authorization.kind !== "authorized") {
        return authorization;
      }

      const [meter] = await transaction
        .select({ id: meters.id, status: meters.status })
        .from(meters)
        .where(eq(meters.id, meterId))
        .limit(1)
        .for("update");
      if (!meter) return { kind: "meter-not-found" as const };
      if (meter.status !== "ACTIVE") return { kind: "meter-not-active" as const };

      const [account] = await transaction
        .select({ id: customerMeterAccounts.id, status: customerMeterAccounts.status })
        .from(customerMeterAccounts)
        .where(eq(customerMeterAccounts.id, accountId))
        .limit(1)
        .for("update");
      if (!account) return { kind: "account-not-found" as const };
      if (account.status !== "ACTIVE") return { kind: "account-not-active" as const };

      const [activeAssignment] = await transaction
        .select({ id: meterAssignments.id })
        .from(meterAssignments)
        .where(
          and(
            eq(meterAssignments.meterId, meter.id),
            isNull(meterAssignments.removedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (activeAssignment) return { kind: "meter-already-assigned" as const };

      const [assignment] = await transaction
        .insert(meterAssignments)
        .values({
          meterId: meter.id,
          customerMeterAccountId: account.id,
          initialReading: "0.000",
          assignedAt: now,
          assignedBy: authorization.actorId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: meterAssignments.id });

      await transaction.insert(auditLogs).values({
        actorUserId: authorization.actorId,
        action: "meter_assignment.assign",
        entityType: "meter_assignment",
        entityId: assignment.id,
        oldValues: null,
        newValues: {
          meterId: meter.id,
          customerMeterAccountId: account.id,
          initialReading: "0.000",
        },
        createdAt: now,
      });

      return {
        kind: "success",
        assignmentId: assignment.id,
        meterId: meter.id,
        accountId: account.id,
        updatedAt: now,
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
      error.cause.constraint === "meter_assignments_active_meter_unique"
    ) {
      return { kind: "meter-already-assigned" };
    }
    throw error;
  }
}

export async function removeMeterAssignment(
  sessionToken: string,
  assignmentId: string,
  reason: string,
): Promise<MeterAssignmentResult> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length === 0) {
    return { kind: "removal-reason-required" };
  }

  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeMeterAssignmentManager(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") {
      return authorization;
    }

    const [assignment] = await transaction
      .select({
        id: meterAssignments.id,
        meterId: meterAssignments.meterId,
        accountId: meterAssignments.customerMeterAccountId,
        removedAt: meterAssignments.removedAt,
      })
      .from(meterAssignments)
      .where(eq(meterAssignments.id, assignmentId))
      .limit(1)
      .for("update");
    if (!assignment) return { kind: "assignment-not-found" as const };
    if (assignment.removedAt !== null) return { kind: "already-removed" as const };

    await transaction
      .update(meterAssignments)
      .set({
        removedAt: now,
        removedBy: authorization.actorId,
        removalReason: normalizedReason,
        updatedAt: now,
      })
      .where(eq(meterAssignments.id, assignment.id));

    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: "meter_assignment.remove",
      entityType: "meter_assignment",
      entityId: assignment.id,
      oldValues: { removedAt: null },
      newValues: { removedAt: now.toISOString(), removalReason: normalizedReason },
      createdAt: now,
    });

    return {
      kind: "success",
      assignmentId: assignment.id,
      meterId: assignment.meterId,
      accountId: assignment.accountId,
      updatedAt: now,
      sessionPolicy: authorization.policy,
    };
  });
}
