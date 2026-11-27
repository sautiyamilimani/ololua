import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
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

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AuthorizedCustomerMeterAccountManager = {
  kind: "authorized";
  actorId: string;
  policy: SessionPolicy;
};

export type CustomerMeterAccountAuthorization =
  | AuthorizedCustomerMeterAccountManager
  | { kind: "unauthenticated" }
  | { kind: "forbidden" };

export async function authorizeCustomerMeterAccountManager(
  transaction: DatabaseTransaction,
  sessionToken: string,
  now: Date,
): Promise<CustomerMeterAccountAuthorization> {
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
    return { kind: "unauthenticated" };
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
    return { kind: "unauthenticated" };
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
    return { kind: "forbidden" };
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

  return { kind: "authorized", actorId: actor.id, policy };
}
