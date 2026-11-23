import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  meters,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { METER_MANAGE_PERMISSION } from "@/lib/auth/permissions";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";
import type { CreateMeterInput, UpdateMeterInput } from "./input";

export type MeterMutationResult =
  | {
      kind: "success";
      meterId: string;
      serialNumber: string;
      status: "ACTIVE" | "DEFECTIVE";
      updatedAt: Date;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "conflict" };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function authorizeMeterManager(
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
  if (!actorRoles.some((row) => row.permissionKey === METER_MANAGE_PERMISSION)) {
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

function isMeterUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    error.cause.code === "23505"
  );
}

export async function createMeter(
  sessionToken: string,
  input: CreateMeterInput,
): Promise<MeterMutationResult> {
  const now = new Date();
  try {
    return await db.transaction(async (transaction) => {
      const authorization = await authorizeMeterManager(transaction, sessionToken, now);
      if (authorization.kind !== "authorized") return authorization;

      const [meter] = await transaction
        .insert(meters)
        .values({
          serialNumber: input.serialNumber,
          status: "ACTIVE",
          notes: input.notes,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: meters.id, serialNumber: meters.serialNumber });

      await transaction.insert(auditLogs).values({
        actorUserId: authorization.actorId,
        action: "meter.create",
        entityType: "meter",
        entityId: meter.id,
        oldValues: null,
        newValues: {
          serialNumber: meter.serialNumber,
          status: "ACTIVE",
          notes: input.notes,
        },
        createdAt: now,
      });

      return {
        kind: "success",
        meterId: meter.id,
        serialNumber: meter.serialNumber,
        status: "ACTIVE",
        updatedAt: now,
        sessionPolicy: authorization.policy,
      };
    });
  } catch (error) {
    if (isMeterUniqueConflict(error)) return { kind: "conflict" };
    throw error;
  }
}

export async function updateMeter(
  sessionToken: string,
  meterId: string,
  input: UpdateMeterInput,
): Promise<MeterMutationResult> {
  const now = new Date();
  try {
    return await db.transaction(async (transaction) => {
      const authorization = await authorizeMeterManager(transaction, sessionToken, now);
      if (authorization.kind !== "authorized") return authorization;

      const [meter] = await transaction
        .select({
          id: meters.id,
          serialNumber: meters.serialNumber,
          status: meters.status,
          notes: meters.notes,
        })
        .from(meters)
        .where(eq(meters.id, meterId))
        .limit(1)
        .for("update");
      if (!meter) return { kind: "not-found" as const };

      await transaction
        .update(meters)
        .set({ ...input, updatedAt: now })
        .where(eq(meters.id, meter.id));

      await transaction.insert(auditLogs).values({
        actorUserId: authorization.actorId,
        action: "meter.update",
        entityType: "meter",
        entityId: meter.id,
        oldValues: {
          serialNumber: meter.serialNumber,
          status: meter.status,
          notes: meter.notes,
        },
        newValues: { ...input, status: input.status ?? meter.status },
        createdAt: now,
      });

      return {
        kind: "success",
        meterId: meter.id,
        serialNumber: input.serialNumber ?? meter.serialNumber,
        status: input.status ?? (meter.status as "ACTIVE" | "DEFECTIVE"),
        updatedAt: now,
        sessionPolicy: authorization.policy,
      };
    });
  } catch (error) {
    if (isMeterUniqueConflict(error)) return { kind: "conflict" };
    throw error;
  }
}
