import { randomUUID } from "node:crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import {
  accountSecurityEvents,
  emailOutbox,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import {
  canChangeStaffAccountStatus,
  canManageStaffAccounts,
  getSessionPolicy,
  isLastActiveAdmin,
  type SessionPolicy,
} from "./policy";
import { lockStaffAccessChanges } from "./staff-access-lock";
import { hashOpaqueToken } from "./token";

export type StaffAccountStatus = "active" | "suspended";

export type ChangeStaffAccountStatusResult =
  | {
      kind: "changed";
      sessionPolicy: SessionPolicy;
      notificationQueued: boolean;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "status-conflict" }
  | { kind: "last-active-admin" };

export async function changeStaffAccountStatus(
  sessionToken: string,
  targetUserId: string,
  requestedStatus: StaffAccountStatus,
  userAgent: string | null,
): Promise<ChangeStaffAccountStatusResult> {
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
        email: users.email,
        fullName: users.fullName,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1)
      .for("update");

    if (!target || target.accountType !== "staff") {
      return { kind: "not-found" };
    }

    const targetRoleRows = await transaction
      .select({ roleKey: roles.roleKey })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, target.id));

    if (
      !canChangeStaffAccountStatus(
        actor.id,
        actorRoleKeys,
        target.id,
        targetRoleRows.map((role) => role.roleKey),
      )
    ) {
      return { kind: "forbidden" };
    }

    if (
      requestedStatus === "suspended" &&
      target.status === "active" &&
      targetRoleRows.some((role) => role.roleKey === "admin")
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
          targetRoleRows.map((role) => role.roleKey),
          activeAdminCount?.value ?? 0,
        )
      ) {
        return { kind: "last-active-admin" };
      }
    }

    if (
      (target.status !== "active" && target.status !== "suspended") ||
      target.status === requestedStatus
    ) {
      return { kind: "status-conflict" };
    }

    await transaction
      .update(users)
      .set({ status: requestedStatus, updatedAt: now })
      .where(eq(users.id, target.id));

    if (requestedStatus === "suspended") {
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
    }

    await transaction.insert(accountSecurityEvents).values({
      userId: target.id,
      eventType:
        requestedStatus === "suspended"
          ? "staff_account_suspended"
          : "staff_account_reactivated",
      userAgent: normalizedUserAgent,
      metadata: {
        changedBy: actor.id,
        previousStatus: target.status,
        newStatus: requestedStatus,
      },
      requestId,
    });

    const notificationTemplateKey =
      requestedStatus === "suspended"
        ? "staff_account_suspended"
        : "staff_account_reactivated";
    await transaction.insert(emailOutbox).values({
      recipientUserId: target.id,
      recipientEmail: target.email,
      templateKey: notificationTemplateKey,
      templateData: { fullName: target.fullName },
      secretPayloadEncrypted: null,
      status: "queued",
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: now,
      idempotencyKey: `staff-account-status:${requestedStatus}:${target.id}:${requestId}`,
      createdAt: now,
      updatedAt: now,
    });

    return {
      kind: "changed",
      sessionPolicy,
      notificationQueued: true,
    };
  });
}
