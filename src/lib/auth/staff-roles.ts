import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  accountSecurityEvents,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import {
  canManageStaffAccounts,
  canManageStaffRoles,
  getSessionPolicy,
  isLastActiveAdmin,
  type SessionPolicy,
} from "./policy";
import { lockStaffAccessChanges } from "./staff-access-lock";
import { hashOpaqueToken } from "./token";

const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/u;

export type ChangeStaffRolesResult =
  | {
      kind: "changed";
      roleKeys: string[];
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "role-not-found" }
  | { kind: "role-conflict" }
  | { kind: "last-active-admin" };

export async function changeStaffRoles(
  sessionToken: string,
  targetUserId: string,
  requestedRoleKeys: readonly string[],
  userAgent: string | null,
): Promise<ChangeStaffRolesResult> {
  if (
    requestedRoleKeys.length === 0 ||
    requestedRoleKeys.length > 20 ||
    new Set(requestedRoleKeys).size !== requestedRoleKeys.length ||
    requestedRoleKeys.some((roleKey) => !ROLE_KEY_PATTERN.test(roleKey))
  ) {
    return { kind: "role-not-found" };
  }

  const requestId = randomUUID();
  const normalizedUserAgent = userAgent?.slice(0, 512) ?? null;

  return db.transaction(async (transaction) => {
    await lockStaffAccessChanges(transaction);
    const now = new Date();
    const [activeSession] = await transaction
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
      !activeSession ||
      activeSession.revokedAt !== null ||
      activeSession.idleExpiresAt <= now ||
      activeSession.expiresAt <= now
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
      .where(eq(users.id, activeSession.userId))
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

    const actorRoleRows = await transaction
      .select({ roleKey: roles.roleKey })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, actor.id));
    const actorRoleKeys = actorRoleRows.map((role) => role.roleKey);

    if (!canManageStaffAccounts("staff", actorRoleKeys)) {
      return { kind: "forbidden" };
    }

    const sessionPolicy = getSessionPolicy("staff", actorRoleKeys);
    const nextExpiry = new Date(now.getTime() + sessionPolicy.idleTimeoutMs);

    await transaction
      .update(sessions)
      .set({
        lastActivityAt: now,
        idleExpiresAt: nextExpiry,
        expiresAt: nextExpiry,
      })
      .where(eq(sessions.id, activeSession.id));

    const [target] = await transaction
      .select({
        id: users.id,
        accountType: users.accountType,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1)
      .for("update");

    if (!target || target.accountType !== "staff") {
      return { kind: "not-found" };
    }

    if (target.status !== "active" && target.status !== "suspended") {
      return { kind: "role-conflict" };
    }

    const currentRoleRows = await transaction
      .select({
        id: roles.id,
        roleKey: roles.roleKey,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, target.id));
    const currentRoleKeys = currentRoleRows.map((role) => role.roleKey);

    if (!canManageStaffRoles(actor.id, actorRoleKeys, target.id, currentRoleKeys)) {
      return { kind: "forbidden" };
    }

    const requestedRoleRows = await transaction
      .select({
        id: roles.id,
        roleKey: roles.roleKey,
      })
      .from(roles)
      .where(inArray(roles.roleKey, requestedRoleKeys));

    if (
      requestedRoleRows.length !== requestedRoleKeys.length ||
      requestedRoleRows.some(
        (role) => role.roleKey === "customer" || role.roleKey === "superadmin",
      )
    ) {
      return { kind: "role-not-found" };
    }

    const currentRoleKeySet = new Set(currentRoleKeys);
    const requestedRoleKeySet = new Set(requestedRoleKeys);

    if (
      currentRoleKeySet.size === requestedRoleKeySet.size &&
      [...currentRoleKeySet].every((roleKey) => requestedRoleKeySet.has(roleKey))
    ) {
      return { kind: "role-conflict" };
    }

    if (
      currentRoleKeySet.has("admin") &&
      !requestedRoleKeySet.has("admin") &&
      target.status === "active"
    ) {
      const [activeAdminCount] = await transaction
        .select({ value: count() })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(and(eq(users.status, "active"), eq(roles.roleKey, "admin")));

      if (
        isLastActiveAdmin(
          target.status,
          currentRoleKeys,
          activeAdminCount?.value ?? 0,
        )
      ) {
        return { kind: "last-active-admin" };
      }
    }

    const removedRoleIds = currentRoleRows
      .filter((role) => !requestedRoleKeySet.has(role.roleKey))
      .map((role) => role.id);
    const addedRoleRows: Array<typeof userRoles.$inferInsert> = [];

    for (const roleKey of requestedRoleKeys) {
      if (currentRoleKeySet.has(roleKey)) {
        continue;
      }

      const requestedRole = requestedRoleRows.find(
        (role) => role.roleKey === roleKey,
      );
      if (!requestedRole) {
        return { kind: "role-not-found" };
      }

      addedRoleRows.push({
        userId: target.id,
        roleId: requestedRole.id,
        assignedAt: now,
        assignedBy: actor.id,
      });
    }

    if (removedRoleIds.length > 0) {
      await transaction
        .delete(userRoles)
        .where(
          and(
            eq(userRoles.userId, target.id),
            inArray(userRoles.roleId, removedRoleIds),
          ),
        );
    }

    if (addedRoleRows.length > 0) {
      await transaction.insert(userRoles).values(addedRoleRows);
    }

    await transaction
      .update(sessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(sessions.userId, target.id),
          isNull(sessions.revokedAt),
          gt(sessions.idleExpiresAt, now),
          gt(sessions.expiresAt, now),
        ),
      );

    const roleKeys = [...requestedRoleKeySet].sort();
    await transaction.insert(accountSecurityEvents).values({
      userId: target.id,
      eventType: "staff_roles_changed",
      userAgent: normalizedUserAgent,
      metadata: {
        changedBy: actor.id,
        previousRoleKeys: [...currentRoleKeySet].sort(),
        newRoleKeys: roleKeys,
      },
      requestId,
    });

    return { kind: "changed", roleKeys, sessionPolicy };
  });
}
