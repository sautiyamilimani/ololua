import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  accountSecurityEvents,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import { getSessionPolicy, isAccountType, type SessionPolicy } from "./policy";
import { hashOpaqueToken } from "./token";
import type { AuthenticatedUser } from "./login";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type LoadedSession = {
  sessionId: string;
  user: AuthenticatedUser;
  policy: SessionPolicy;
};

async function loadActiveSession(
  transaction: DatabaseTransaction,
  token: string,
  now: Date,
  lockSession: boolean,
): Promise<LoadedSession | null> {
  const sessionQuery = transaction
    .select({
      id: sessions.id,
      userId: sessions.userId,
      revokedAt: sessions.revokedAt,
      idleExpiresAt: sessions.idleExpiresAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashOpaqueToken(token)))
    .limit(1);
  const [session] = lockSession
    ? await sessionQuery.for("update")
    : await sessionQuery;

  if (
    !session ||
    session.revokedAt !== null ||
    session.idleExpiresAt <= now ||
    session.expiresAt <= now
  ) {
    return null;
  }

  const [user] = await transaction
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      accountType: users.accountType,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (
    !user ||
    user.status !== "active" ||
    user.emailVerifiedAt === null ||
    !isAccountType(user.accountType)
  ) {
    return null;
  }

  const roleRows =
    user.accountType === "staff"
      ? await transaction
          .select({ roleKey: roles.roleKey })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .where(eq(userRoles.userId, user.id))
      : [];
  const policy = getSessionPolicy(
    user.accountType,
    roleRows.map((role) => role.roleKey),
  );

  return {
    sessionId: session.id,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      accountType: user.accountType,
    },
    policy,
  };
}

export async function getActiveSession(token: string): Promise<LoadedSession | null> {
  return db.transaction((transaction) =>
    loadActiveSession(transaction, token, new Date(), false),
  );
}

export async function renewActiveSession(token: string): Promise<LoadedSession | null> {
  // Call only after the caller has completed the applicable request security checks.
  const now = new Date();

  return db.transaction(async (transaction) => {
    const activeSession = await loadActiveSession(transaction, token, now, true);

    if (!activeSession) {
      return null;
    }

    const expiresAt = new Date(now.getTime() + activeSession.policy.idleTimeoutMs);

    await transaction
      .update(sessions)
      .set({
        lastActivityAt: now,
        idleExpiresAt: expiresAt,
        expiresAt,
      })
      .where(eq(sessions.id, activeSession.sessionId));

    return activeSession;
  });
}

export async function revokeSession(token: string, userAgent: string | null): Promise<void> {
  const tokenHash = hashOpaqueToken(token);
  const requestId = randomUUID();

  await db.transaction(async (transaction) => {
    const [session] = await transaction
      .select({
        id: sessions.id,
        userId: sessions.userId,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1)
      .for("update");

    if (!session || session.revokedAt !== null) {
      return;
    }

    const now = new Date();

    await transaction
      .update(sessions)
      .set({ revokedAt: now })
      .where(eq(sessions.id, session.id));

    await transaction.insert(accountSecurityEvents).values({
      userId: session.userId,
      eventType: "logout_succeeded",
      userAgent: userAgent?.slice(0, 512) ?? null,
      requestId,
    });
  });
}
