import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  accountSecurityEvents,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import { verifyPasswordOrDummy } from "./password";
import {
  getLockoutDurationMs,
  getSessionPolicy,
  isAccountType,
  type AccountType,
  type SessionPolicy,
} from "./policy";
import { createOpaqueToken, hashOpaqueToken } from "./token";

export type AuthenticatedUser = {
  id: string;
  fullName: string;
  email: string;
  accountType: AccountType;
};

export type LoginResult =
  | {
      kind: "authenticated";
      user: AuthenticatedUser;
      token: string;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "suspended" };

async function writeSecurityEvent(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  values: {
    userId: string | null;
    email: string;
    userAgent: string | null;
    requestId: string;
    eventType: "login_succeeded" | "login_failed" | "login_suspended";
  },
): Promise<void> {
  await transaction.insert(accountSecurityEvents).values({
    userId: values.userId,
    emailAttempted: values.email,
    userAgent: values.userAgent,
    requestId: values.requestId,
    eventType: values.eventType,
  });
}

export async function authenticate(
  email: string,
  password: string,
  userAgent: string | null,
): Promise<LoginResult | null> {
  const requestId = randomUUID();
  const normalizedUserAgent = userAgent?.slice(0, 512) ?? null;

  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        passwordHash: users.passwordHash,
        accountType: users.accountType,
        status: users.status,
        failedLoginCount: users.failedLoginCount,
        lockedUntil: users.lockedUntil,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
      .for("update");

    if (!user) {
      await verifyPasswordOrDummy(password, null);
      await writeSecurityEvent(transaction, {
        userId: null,
        email,
        userAgent: normalizedUserAgent,
        requestId,
        eventType: "login_failed",
      });
      return null;
    }

    const passwordMatches = await verifyPasswordOrDummy(password, user.passwordHash);
    const now = new Date();
    const isLocked = user.lockedUntil !== null && user.lockedUntil > now;

    if (
      passwordMatches &&
      user.status === "suspended" &&
      user.emailVerifiedAt !== null &&
      isAccountType(user.accountType) &&
      !isLocked
    ) {
      await writeSecurityEvent(transaction, {
        userId: user.id,
        email,
        userAgent: normalizedUserAgent,
        requestId,
        eventType: "login_suspended",
      });

      return { kind: "suspended" };
    }

    if (
      passwordMatches &&
      user.status === "active" &&
      user.emailVerifiedAt !== null &&
      isAccountType(user.accountType) &&
      !isLocked
    ) {
      const accountType = user.accountType;
      const roleRows =
        accountType === "staff"
          ? await transaction
              .select({ roleKey: roles.roleKey })
              .from(userRoles)
              .innerJoin(roles, eq(userRoles.roleId, roles.id))
              .where(eq(userRoles.userId, user.id))
          : [];
      const sessionPolicy = getSessionPolicy(
        accountType,
        roleRows.map((role) => role.roleKey),
      );
      const token = createOpaqueToken();
      const tokenHash = hashOpaqueToken(token);
      const expiresAt = new Date(now.getTime() + sessionPolicy.idleTimeoutMs);

      await transaction.insert(sessions).values({
        userId: user.id,
        tokenHash,
        userAgent: normalizedUserAgent,
        lastActivityAt: now,
        idleExpiresAt: expiresAt,
        expiresAt,
      });

      await transaction
        .update(users)
        .set({
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));

      await writeSecurityEvent(transaction, {
        userId: user.id,
        email,
        userAgent: normalizedUserAgent,
        requestId,
        eventType: "login_succeeded",
      });

      return {
        kind: "authenticated",
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          accountType,
        },
        token,
        sessionPolicy,
      };
    }

    if (!isLocked) {
      const failedLoginCount = user.failedLoginCount + 1;
      const lockoutDurationMs = getLockoutDurationMs(failedLoginCount);

      await transaction
        .update(users)
        .set({
          failedLoginCount,
          lockedUntil:
            lockoutDurationMs === null
              ? null
              : new Date(now.getTime() + lockoutDurationMs),
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
    }

    await writeSecurityEvent(transaction, {
      userId: user.id,
      email,
      userAgent: normalizedUserAgent,
      requestId,
      eventType: "login_failed",
    });

    return null;
  });
}
