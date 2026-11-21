import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import {
  accountSecurityEvents,
  emailOutbox,
  passwordResetTokens,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import {
  assertSecretPayloadEncryptionConfigured,
  encryptSecretPayload,
} from "@/lib/email/secret-payload";
import { hashPassword } from "./password";
import {
  getPasswordMinimumLength,
  isAccountType,
  type AccountType,
} from "./policy";
import { consumeRateLimitBucket } from "./rate-limit";
import { createOpaqueToken, hashOpaqueToken } from "./token";

const EMAIL_LIMIT = 3;
const EMAIL_WINDOW_MS = 60 * 60 * 1000;
const IP_LIMIT = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const EMAIL_TEMPLATE_MAX_ATTEMPTS = 5;

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PasswordResetRequestResult =
  | { kind: "accepted"; emailQueued: boolean }
  | { kind: "rate-limited"; retryAfterSeconds: number };

export type PasswordResetCompletionResult =
  | { kind: "completed" }
  | { kind: "invalid" }
  | { kind: "password-policy" };

async function reserveRequestBuckets(
  transaction: DatabaseTransaction,
  email: string,
  ipAddress: string | null,
  now: Date,
): Promise<
  | { kind: "allowed"; emailLimited: boolean }
  | { kind: "ip-limited"; retryAfterSeconds: number }
> {
  const ipBucket = await consumeRateLimitBucket(
    transaction,
    {
      action: "password_reset_ip",
      identity: ipAddress ?? "unknown",
      maximum: IP_LIMIT,
      windowMs: IP_WINDOW_MS,
    },
    now,
  );

  if (!ipBucket.allowed) {
    return {
      kind: "ip-limited",
      retryAfterSeconds: ipBucket.retryAfterSeconds,
    };
  }

  const emailBucket = await consumeRateLimitBucket(
    transaction,
    {
      action: "password_reset_email",
      identity: email,
      maximum: EMAIL_LIMIT,
      windowMs: EMAIL_WINDOW_MS,
    },
    now,
  );

  return { kind: "allowed", emailLimited: !emailBucket.allowed };
}

async function getRoleKeys(
  transaction: DatabaseTransaction,
  userId: string,
): Promise<string[]> {
  const rows = await transaction
    .select({ roleKey: roles.roleKey })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return rows.map((row) => row.roleKey);
}

function passwordCharacterCount(password: string): number {
  return Array.from(password).length;
}

export async function requestPasswordReset(
  email: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<PasswordResetRequestResult> {
  assertSecretPayloadEncryptionConfigured();

  const normalizedEmail = email.trim().toLowerCase();
  const requestId = randomUUID();
  const normalizedUserAgent = userAgent?.slice(0, 512) ?? null;

  return db.transaction(async (transaction) => {
    const now = new Date();
    const limit = await reserveRequestBuckets(
      transaction,
      normalizedEmail,
      ipAddress,
      now,
    );

    if (limit.kind === "ip-limited") {
      return {
        kind: "rate-limited",
        retryAfterSeconds: limit.retryAfterSeconds,
      };
    }

    if (limit.emailLimited) {
      await transaction.insert(accountSecurityEvents).values({
        emailAttempted: normalizedEmail,
        ipAddress,
        userAgent: normalizedUserAgent,
        eventType: "password_reset_request_throttled",
        metadata: { scope: "email" },
        requestId,
      });

      return { kind: "accepted", emailQueued: false };
    }

    const [user] = await transaction
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        accountType: users.accountType,
        status: users.status,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1)
      .for("update");

    const eligible =
      user !== undefined &&
      user.status === "active" &&
      user.emailVerifiedAt !== null &&
      user.passwordHash !== null &&
      isAccountType(user.accountType);

    if (!eligible || !user) {
      await transaction.insert(accountSecurityEvents).values({
        userId: user?.id ?? null,
        emailAttempted: normalizedEmail,
        ipAddress,
        userAgent: normalizedUserAgent,
        eventType: "password_reset_requested",
        metadata: { emailQueued: false },
        requestId,
      });

      return { kind: "accepted", emailQueued: false };
    }

    const previousTokens = await transaction
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.invalidatedAt),
        ),
      );
    const previousTokenIds = previousTokens.map((token) => token.id);

    if (previousTokenIds.length > 0) {
      await transaction
        .update(passwordResetTokens)
        .set({ invalidatedAt: now })
        .where(inArray(passwordResetTokens.id, previousTokenIds));

      const previousIdempotencyKeys = previousTokenIds.map(
        (id) => `password-reset:${id}`,
      );
      await transaction
        .update(emailOutbox)
        .set({
          status: "failed",
          lastError: "Password reset token was replaced before delivery.",
          updatedAt: now,
        })
        .where(
          and(
            inArray(emailOutbox.idempotencyKey, previousIdempotencyKeys),
            eq(emailOutbox.status, "queued"),
          ),
        );
    }

    const tokenId = randomUUID();
    const rawToken = createOpaqueToken();
    const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS);

    await transaction.insert(passwordResetTokens).values({
      id: tokenId,
      userId: user.id,
      tokenHash: hashOpaqueToken(rawToken),
      createdAt: now,
      expiresAt,
    });

    await transaction.insert(emailOutbox).values({
      recipientUserId: user.id,
      recipientEmail: user.email,
      templateKey: "password_reset",
      templateData: {
        fullName: user.fullName,
        resetPath: "/reset-password",
      },
      secretPayloadEncrypted: encryptSecretPayload(
        JSON.stringify({ token: rawToken }),
      ),
      status: "queued",
      attempts: 0,
      maxAttempts: EMAIL_TEMPLATE_MAX_ATTEMPTS,
      nextAttemptAt: now,
      idempotencyKey: `password-reset:${tokenId}`,
      createdAt: now,
      updatedAt: now,
    });

    await transaction.insert(accountSecurityEvents).values({
      userId: user.id,
      emailAttempted: normalizedEmail,
      ipAddress,
      userAgent: normalizedUserAgent,
      eventType: "password_reset_requested",
      metadata: { emailQueued: true },
      requestId,
    });

    return { kind: "accepted", emailQueued: true };
  });
}

type ResetSnapshot = {
  tokenId: string;
  userId: string;
  tokenExpiresAt: Date;
  tokenUsedAt: Date | null;
  tokenInvalidatedAt: Date | null;
  userEmail: string;
  userFullName: string;
  userAccountType: string;
  userStatus: string;
  userPasswordHash: string | null;
  userEmailVerifiedAt: Date | null;
};

async function getResetSnapshot(tokenHash: string): Promise<ResetSnapshot | null> {
  const [snapshot] = await db
    .select({
      tokenId: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      tokenExpiresAt: passwordResetTokens.expiresAt,
      tokenUsedAt: passwordResetTokens.usedAt,
      tokenInvalidatedAt: passwordResetTokens.invalidatedAt,
      userEmail: users.email,
      userFullName: users.fullName,
      userAccountType: users.accountType,
      userStatus: users.status,
      userPasswordHash: users.passwordHash,
      userEmailVerifiedAt: users.emailVerifiedAt,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(passwordResetTokens.userId, users.id))
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);

  return snapshot ?? null;
}

function isEligibleForReset(
  user: Pick<
    ResetSnapshot,
    "userAccountType" | "userStatus" | "userPasswordHash" | "userEmailVerifiedAt"
  >,
): user is typeof user & { userAccountType: AccountType } {
  return (
    user.userStatus === "active" &&
    user.userPasswordHash !== null &&
    user.userEmailVerifiedAt !== null &&
    isAccountType(user.userAccountType)
  );
}

function isUsableToken(
  token: Pick<
    ResetSnapshot,
    "tokenExpiresAt" | "tokenUsedAt" | "tokenInvalidatedAt"
  >,
  now: Date,
): boolean {
  return (
    token.tokenUsedAt === null &&
    token.tokenInvalidatedAt === null &&
    token.tokenExpiresAt > now
  );
}

export async function completePasswordReset(
  rawToken: string,
  newPassword: string,
  userAgent: string | null,
  ipAddress: string | null,
): Promise<PasswordResetCompletionResult> {
  const tokenHash = hashOpaqueToken(rawToken);
  const snapshot = await getResetSnapshot(tokenHash);
  const preflightNow = new Date();

  if (
    !snapshot ||
    !isUsableToken(snapshot, preflightNow) ||
    !isEligibleForReset(snapshot)
  ) {
    return { kind: "invalid" };
  }

  const initialRoleKeys = await db
    .select({ roleKey: roles.roleKey })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, snapshot.userId));
  const initialRoleNames = initialRoleKeys.map((row) => row.roleKey);
  const passwordLength = passwordCharacterCount(newPassword);

  if (
    passwordLength <
    getPasswordMinimumLength(snapshot.userAccountType, initialRoleNames)
  ) {
    return { kind: "password-policy" };
  }

  const passwordHash = await hashPassword(newPassword);
  const requestId = randomUUID();
  const normalizedUserAgent = userAgent?.slice(0, 512) ?? null;

  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .select({
        id: users.id,
        email: users.email,
        accountType: users.accountType,
        status: users.status,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, snapshot.userId))
      .limit(1)
      .for("update");

    const [resetToken] = await transaction
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
        expiresAt: passwordResetTokens.expiresAt,
        usedAt: passwordResetTokens.usedAt,
        invalidatedAt: passwordResetTokens.invalidatedAt,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.id, snapshot.tokenId),
          eq(passwordResetTokens.tokenHash, tokenHash),
        ),
      )
      .limit(1)
      .for("update");

    const now = new Date();

    if (
      !user ||
      !isEligibleForReset({
        userAccountType: user.accountType,
        userStatus: user.status,
        userPasswordHash: user.passwordHash,
        userEmailVerifiedAt: user.emailVerifiedAt,
      }) ||
      !resetToken ||
      resetToken.userId !== user.id ||
      !isUsableToken(
        {
          tokenExpiresAt: resetToken.expiresAt,
          tokenUsedAt: resetToken.usedAt,
          tokenInvalidatedAt: resetToken.invalidatedAt,
        },
        now,
      )
    ) {
      return { kind: "invalid" };
    }

    if (!isAccountType(user.accountType)) {
      return { kind: "invalid" };
    }

    const roleKeys = await getRoleKeys(transaction, user.id);
    const accountType = user.accountType;

    if (
      passwordLength < getPasswordMinimumLength(accountType, roleKeys)
    ) {
      return { kind: "password-policy" };
    }

    const otherTokens = await transaction
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.invalidatedAt),
          ne(passwordResetTokens.id, resetToken.id),
        ),
      );
    const otherTokenIds = otherTokens.map((token) => token.id);

    await transaction
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(eq(passwordResetTokens.id, resetToken.id));

    if (otherTokenIds.length > 0) {
      await transaction
        .update(passwordResetTokens)
        .set({ invalidatedAt: now })
        .where(inArray(passwordResetTokens.id, otherTokenIds));
    }

    const completedTokenEmailKeys = [
      `password-reset:${resetToken.id}`,
      ...otherTokenIds.map((id) => `password-reset:${id}`),
    ];
    await transaction
      .update(emailOutbox)
      .set({
        status: "failed",
        lastError: "Password reset token was used or invalidated before delivery.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(emailOutbox.idempotencyKey, completedTokenEmailKeys),
          eq(emailOutbox.status, "queued"),
        ),
      );

    await transaction
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await transaction
      .update(sessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(sessions.userId, user.id),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          gt(sessions.idleExpiresAt, now),
        ),
      );

    await transaction.insert(accountSecurityEvents).values({
      userId: user.id,
      emailAttempted: user.email,
      ipAddress,
      userAgent: normalizedUserAgent,
      eventType: "password_reset_completed",
      requestId,
    });

    return { kind: "completed" };
  });
}
