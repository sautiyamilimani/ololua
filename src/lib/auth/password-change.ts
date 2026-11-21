import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
} from "drizzle-orm";
import {
  accountSecurityEvents,
  emailOutbox,
  emailVerificationTokens,
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
  hashSecretValue,
} from "@/lib/email/secret-payload";
import { consumeRateLimitBucket } from "./rate-limit";
import { hashPassword, verifyPasswordOrDummy } from "./password";
import {
  getLockoutDurationMs,
  getPasswordMinimumLength,
  isAccountType,
  type AccountType,
} from "./policy";
import { hashOpaqueToken, isOpaqueToken } from "./token";

const PASSWORD_CHANGE_PURPOSE = "password_change";
const OTP_HASH_CONTEXT = "password-change-otp:v1";
const VERIFICATION_PROOF_CONTEXT = "password-change-proof:v1";
const OTP_LIFETIME_MS = 10 * 60 * 1000;
const OTP_ISSUE_ACCOUNT_LIMIT = 3;
const OTP_ISSUE_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;
const OTP_IP_LIMIT = 10;
const OTP_IP_WINDOW_MS = 15 * 60 * 1000;
const OTP_ATTEMPT_LIMIT = 5;
const EMAIL_TEMPLATE_MAX_ATTEMPTS = 5;

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PasswordChangeOtpRequestResult =
  | { kind: "queued" }
  | { kind: "invalid-current-password" }
  | { kind: "rate-limited"; retryAfterSeconds: number };

export type PasswordChangeOtpVerificationResult =
  | { kind: "verified"; verificationToken: string }
  | { kind: "invalid" }
  | { kind: "rate-limited"; retryAfterSeconds: number };

export type PasswordChangeCompletionResult =
  | { kind: "completed" }
  | { kind: "invalid" }
  | { kind: "password-policy" }
  | { kind: "password-mismatch" };

type EligibleUser = {
  id: string;
  email: string;
  accountType: AccountType;
  status: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
};

function isEligibleUser(
  user: Omit<EligibleUser, "accountType"> & { accountType: string },
): user is EligibleUser {
  return (
    user.status === "active" &&
    user.passwordHash !== null &&
    user.emailVerifiedAt !== null &&
    isAccountType(user.accountType)
  );
}

function getOtpHash(userId: string, tokenId: string, otp: string): string {
  return hashSecretValue(
    OTP_HASH_CONTEXT,
    `${userId}:${tokenId}:${otp}`,
  );
}

function getVerificationToken(
  userId: string,
  tokenId: string,
  otp: string,
): string {
  return Buffer.from(
    hashSecretValue(
      VERIFICATION_PROOF_CONTEXT,
      `${userId}:${tokenId}:${otp}`,
    ),
    "hex",
  ).toString("base64url");
}

function matchesHash(actualHash: string, expectedHash: string): boolean {
  if (
    !/^[0-9a-f]{64}$/u.test(actualHash) ||
    !/^[0-9a-f]{64}$/u.test(expectedHash)
  ) {
    return false;
  }

  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return timingSafeEqual(actual, expected);
}

function createOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
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

async function writeSecurityEvent(
  transaction: DatabaseTransaction,
  values: {
    userId: string;
    email: string;
    ipAddress: string | null;
    userAgent: string | null;
    requestId: string;
    eventType: string;
    metadata?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  await transaction.insert(accountSecurityEvents).values({
    userId: values.userId,
    emailAttempted: values.email,
    ipAddress: values.ipAddress,
    userAgent: values.userAgent,
    requestId: values.requestId,
    eventType: values.eventType,
    metadata: values.metadata,
  });
}

function getRetryAfter(
  accountLimit: { allowed: true } | { allowed: false; retryAfterSeconds: number },
  ipLimit: { allowed: true } | { allowed: false; retryAfterSeconds: number },
): number {
  return Math.max(
    accountLimit.allowed ? 0 : accountLimit.retryAfterSeconds,
    ipLimit.allowed ? 0 : ipLimit.retryAfterSeconds,
  );
}

export async function requestPasswordChangeOtp(
  userId: string,
  currentPassword: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<PasswordChangeOtpRequestResult> {
  assertSecretPayloadEncryptionConfigured();

  const requestId = randomUUID();
  const normalizedUserAgent = userAgent?.slice(0, 512) ?? null;

  return db.transaction(async (transaction) => {
    const now = new Date();
    const [user] = await transaction
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        accountType: users.accountType,
        status: users.status,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
        failedLoginCount: users.failedLoginCount,
        lockedUntil: users.lockedUntil,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");

    if (!user) {
      await verifyPasswordOrDummy(currentPassword, null);
      return { kind: "invalid-current-password" };
    }

    const accountLimit = await consumeRateLimitBucket(
      transaction,
      {
        action: "password_change_otp_account",
        identity: user.id,
        maximum: OTP_ISSUE_ACCOUNT_LIMIT,
        windowMs: OTP_ISSUE_ACCOUNT_WINDOW_MS,
      },
      now,
    );
    const ipLimit = await consumeRateLimitBucket(
      transaction,
      {
        action: "password_change_otp_request_ip",
        identity: ipAddress ?? "unknown",
        maximum: OTP_IP_LIMIT,
        windowMs: OTP_IP_WINDOW_MS,
      },
      now,
    );

    if (!accountLimit.allowed || !ipLimit.allowed) {
      await writeSecurityEvent(transaction, {
        userId: user.id,
        email: user.email,
        ipAddress,
        userAgent: normalizedUserAgent,
        requestId,
        eventType: "password_change_otp_rate_limited",
        metadata: {
          scope: [
            accountLimit.allowed ? null : "account",
            ipLimit.allowed ? null : "ip",
          ]
            .filter((scope): scope is string => scope !== null)
            .join(","),
        },
      });

      return {
        kind: "rate-limited",
        retryAfterSeconds: getRetryAfter(accountLimit, ipLimit),
      };
    }

    const passwordMatches = await verifyPasswordOrDummy(
      currentPassword,
      user.passwordHash,
    );
    const isLocked = user.lockedUntil !== null && user.lockedUntil > now;
    const userIsEligible = isEligibleUser(user);

    if (!passwordMatches || isLocked || !userIsEligible) {
      if (!passwordMatches && !isLocked) {
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
        email: user.email,
        ipAddress,
        userAgent: normalizedUserAgent,
        requestId,
        eventType: "password_change_current_password_failed",
      });

      return { kind: "invalid-current-password" };
    }

    await transaction
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, user.id));

    const previousTokens = await transaction
      .select({ id: emailVerificationTokens.id })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, user.id),
          eq(emailVerificationTokens.purpose, PASSWORD_CHANGE_PURPOSE),
          isNull(emailVerificationTokens.invalidatedAt),
        ),
      );
    const previousTokenIds = previousTokens.map((token) => token.id);

    if (previousTokenIds.length > 0) {
      await transaction
        .update(emailVerificationTokens)
        .set({ invalidatedAt: now })
        .where(inArray(emailVerificationTokens.id, previousTokenIds));

      await transaction
        .update(emailOutbox)
        .set({
          status: "failed",
          lastError: "Password-change code was replaced before delivery.",
          updatedAt: now,
        })
        .where(
          and(
            inArray(
              emailOutbox.idempotencyKey,
              previousTokenIds.map((id) => `password-change-otp:${id}`),
            ),
            eq(emailOutbox.status, "queued"),
          ),
        );
    }

    const tokenId = randomUUID();
    const otp = createOtp();
    const expiresAt = new Date(now.getTime() + OTP_LIFETIME_MS);

    await transaction.insert(emailVerificationTokens).values({
      id: tokenId,
      userId: user.id,
      email: user.email,
      purpose: PASSWORD_CHANGE_PURPOSE,
      tokenHash: getOtpHash(user.id, tokenId, otp),
      createdAt: now,
      expiresAt,
    });

    await transaction.insert(emailOutbox).values({
      recipientUserId: user.id,
      recipientEmail: user.email,
      templateKey: "password_change_otp",
      templateData: { fullName: user.fullName },
      secretPayloadEncrypted: encryptSecretPayload(JSON.stringify({ otp })),
      status: "queued",
      attempts: 0,
      maxAttempts: EMAIL_TEMPLATE_MAX_ATTEMPTS,
      nextAttemptAt: now,
      idempotencyKey: `password-change-otp:${tokenId}`,
      createdAt: now,
      updatedAt: now,
    });

    await writeSecurityEvent(transaction, {
      userId: user.id,
      email: user.email,
      ipAddress,
      userAgent: normalizedUserAgent,
      requestId,
      eventType: "password_change_otp_requested",
    });

    return { kind: "queued" };
  });
}

export async function verifyPasswordChangeOtp(
  userId: string,
  otp: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<PasswordChangeOtpVerificationResult> {
  assertSecretPayloadEncryptionConfigured();

  if (!/^\d{6}$/u.test(otp)) {
    return { kind: "invalid" };
  }

  const requestId = randomUUID();
  const normalizedUserAgent = userAgent?.slice(0, 512) ?? null;

  return db.transaction(async (transaction) => {
    const now = new Date();
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
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");

    if (!user || !isEligibleUser(user)) {
      return { kind: "invalid" };
    }

    const ipLimit = await consumeRateLimitBucket(
      transaction,
      {
        action: "password_change_otp_verify_ip",
        identity: ipAddress ?? "unknown",
        maximum: OTP_IP_LIMIT,
        windowMs: OTP_IP_WINDOW_MS,
      },
      now,
    );

    if (!ipLimit.allowed) {
      await writeSecurityEvent(transaction, {
        userId: user.id,
        email: user.email,
        ipAddress,
        userAgent: normalizedUserAgent,
        requestId,
        eventType: "password_change_otp_rate_limited",
        metadata: { scope: "ip" },
      });

      return {
        kind: "rate-limited",
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      };
    }

    const [challenge] = await transaction
      .select({
        id: emailVerificationTokens.id,
        email: emailVerificationTokens.email,
        tokenHash: emailVerificationTokens.tokenHash,
        expiresAt: emailVerificationTokens.expiresAt,
        verifiedAt: emailVerificationTokens.verifiedAt,
        invalidatedAt: emailVerificationTokens.invalidatedAt,
      })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, user.id),
          eq(emailVerificationTokens.purpose, PASSWORD_CHANGE_PURPOSE),
          isNull(emailVerificationTokens.invalidatedAt),
        ),
      )
      .orderBy(desc(emailVerificationTokens.createdAt))
      .limit(1)
      .for("update");

    if (
      !challenge ||
      challenge.email !== user.email ||
      challenge.invalidatedAt !== null ||
      challenge.expiresAt <= now
    ) {
      return { kind: "invalid" };
    }

    const verificationToken = getVerificationToken(user.id, challenge.id, otp);
    const verificationTokenHash = hashOpaqueToken(verificationToken);
    const suppliedValueMatches =
      challenge.verifiedAt === null
        ? matchesHash(challenge.tokenHash, getOtpHash(user.id, challenge.id, otp))
        : matchesHash(challenge.tokenHash, verificationTokenHash);

    if (challenge.verifiedAt !== null && suppliedValueMatches) {
      return { kind: "verified", verificationToken };
    }

    if (!suppliedValueMatches) {
      const attemptLimit = await consumeRateLimitBucket(
        transaction,
        {
          action: "password_change_otp_attempt",
          identity: challenge.id,
          maximum: OTP_ATTEMPT_LIMIT,
          windowMs: OTP_LIFETIME_MS,
        },
        now,
      );

      if (!attemptLimit.allowed) {
        await transaction
          .update(emailVerificationTokens)
          .set({ invalidatedAt: now })
          .where(eq(emailVerificationTokens.id, challenge.id));

        await writeSecurityEvent(transaction, {
          userId: user.id,
          email: user.email,
          ipAddress,
          userAgent: normalizedUserAgent,
          requestId,
          eventType: "password_change_otp_rate_limited",
          metadata: { scope: "challenge" },
        });

        return {
          kind: "rate-limited",
          retryAfterSeconds: attemptLimit.retryAfterSeconds,
        };
      }

      if (attemptLimit.attemptCount >= OTP_ATTEMPT_LIMIT) {
        await transaction
          .update(emailVerificationTokens)
          .set({ invalidatedAt: now })
          .where(eq(emailVerificationTokens.id, challenge.id));
      }

      await writeSecurityEvent(transaction, {
        userId: user.id,
        email: user.email,
        ipAddress,
        userAgent: normalizedUserAgent,
        requestId,
        eventType: "password_change_otp_verification_failed",
        metadata: { attemptCount: attemptLimit.attemptCount },
      });

      return { kind: "invalid" };
    }

    await transaction
      .update(emailVerificationTokens)
      .set({
        tokenHash: verificationTokenHash,
        verifiedAt: now,
      })
      .where(eq(emailVerificationTokens.id, challenge.id));

    await writeSecurityEvent(transaction, {
      userId: user.id,
      email: user.email,
      ipAddress,
      userAgent: normalizedUserAgent,
      requestId,
      eventType: "password_change_otp_verified",
    });

    return { kind: "verified", verificationToken };
  });
}

function passwordCharacterCount(password: string): number {
  return Array.from(password).length;
}

export async function completePasswordChange(
  userId: string,
  currentSessionId: string,
  verificationToken: string,
  newPassword: string,
  confirmation: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<PasswordChangeCompletionResult> {
  if (newPassword !== confirmation) {
    return { kind: "password-mismatch" };
  }

  if (!isOpaqueToken(verificationToken)) {
    return { kind: "invalid" };
  }

  const proofHash = hashOpaqueToken(verificationToken);
  const preflightNow = new Date();
  const [snapshot] = await db
    .select({
      tokenId: emailVerificationTokens.id,
      tokenHash: emailVerificationTokens.tokenHash,
      tokenExpiresAt: emailVerificationTokens.expiresAt,
      tokenVerifiedAt: emailVerificationTokens.verifiedAt,
      tokenInvalidatedAt: emailVerificationTokens.invalidatedAt,
      tokenEmail: emailVerificationTokens.email,
      userId: users.id,
      userEmail: users.email,
      userAccountType: users.accountType,
      userStatus: users.status,
      userPasswordHash: users.passwordHash,
      userEmailVerifiedAt: users.emailVerifiedAt,
    })
    .from(emailVerificationTokens)
    .innerJoin(users, eq(emailVerificationTokens.userId, users.id))
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        eq(emailVerificationTokens.purpose, PASSWORD_CHANGE_PURPOSE),
        isNull(emailVerificationTokens.invalidatedAt),
        gt(emailVerificationTokens.expiresAt, preflightNow),
      ),
    )
    .orderBy(desc(emailVerificationTokens.createdAt))
    .limit(1);

  if (
    !snapshot ||
    snapshot.userId !== userId ||
    snapshot.tokenEmail !== snapshot.userEmail ||
    snapshot.tokenVerifiedAt === null ||
    snapshot.tokenInvalidatedAt !== null ||
    !matchesHash(snapshot.tokenHash, proofHash)
  ) {
    return { kind: "invalid" };
  }

  const snapshotUser = {
    id: snapshot.userId,
    email: snapshot.userEmail,
    accountType: snapshot.userAccountType,
    status: snapshot.userStatus,
    passwordHash: snapshot.userPasswordHash,
    emailVerifiedAt: snapshot.userEmailVerifiedAt,
  };

  if (!isEligibleUser(snapshotUser)) {
    return { kind: "invalid" };
  }

  const initialRoleKeys = await db
    .select({ roleKey: roles.roleKey })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  const passwordLength = passwordCharacterCount(newPassword);

  if (
    passwordLength <
    getPasswordMinimumLength(
      snapshotUser.accountType,
      initialRoleKeys.map((row) => row.roleKey),
    )
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
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");

    const [challenge] = await transaction
      .select({
        id: emailVerificationTokens.id,
        email: emailVerificationTokens.email,
        tokenHash: emailVerificationTokens.tokenHash,
        expiresAt: emailVerificationTokens.expiresAt,
        verifiedAt: emailVerificationTokens.verifiedAt,
        invalidatedAt: emailVerificationTokens.invalidatedAt,
      })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.id, snapshot.tokenId),
          eq(emailVerificationTokens.userId, userId),
          eq(emailVerificationTokens.purpose, PASSWORD_CHANGE_PURPOSE),
        ),
      )
      .limit(1)
      .for("update");

    const now = new Date();

    if (
      !user ||
      !isEligibleUser(user) ||
      !challenge ||
      challenge.email !== user.email ||
      challenge.verifiedAt === null ||
      challenge.invalidatedAt !== null ||
      challenge.expiresAt <= now ||
      !matchesHash(challenge.tokenHash, proofHash)
    ) {
      return { kind: "invalid" };
    }

    const currentSession = await transaction
      .select({
        id: sessions.id,
        userId: sessions.userId,
        revokedAt: sessions.revokedAt,
        expiresAt: sessions.expiresAt,
        idleExpiresAt: sessions.idleExpiresAt,
      })
      .from(sessions)
      .where(eq(sessions.id, currentSessionId))
      .limit(1)
      .for("update");
    const activeCurrentSession = currentSession[0];

    if (
      !activeCurrentSession ||
      activeCurrentSession.userId !== user.id ||
      activeCurrentSession.revokedAt !== null ||
      activeCurrentSession.expiresAt <= now ||
      activeCurrentSession.idleExpiresAt <= now
    ) {
      return { kind: "invalid" };
    }

    const roleKeys = await getRoleKeys(transaction, user.id);
    if (!isAccountType(user.accountType)) {
      return { kind: "invalid" };
    }

    if (
      passwordLength <
      getPasswordMinimumLength(user.accountType, roleKeys)
    ) {
      return { kind: "password-policy" };
    }

    const activeChangeTokens = await transaction
      .select({ id: emailVerificationTokens.id })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, user.id),
          eq(emailVerificationTokens.purpose, PASSWORD_CHANGE_PURPOSE),
          isNull(emailVerificationTokens.invalidatedAt),
        ),
      );
    const activeChangeTokenIds = activeChangeTokens.map((token) => token.id);

    if (activeChangeTokenIds.length > 0) {
      await transaction
        .update(emailVerificationTokens)
        .set({ invalidatedAt: now })
        .where(inArray(emailVerificationTokens.id, activeChangeTokenIds));

      await transaction
        .update(emailOutbox)
        .set({
          status: "failed",
          lastError: "Password-change code was used or invalidated before delivery.",
          updatedAt: now,
        })
        .where(
          and(
            inArray(
              emailOutbox.idempotencyKey,
              activeChangeTokenIds.map((id) => `password-change-otp:${id}`),
            ),
            eq(emailOutbox.status, "queued"),
          ),
        );
    }

    const activeResetTokens = await transaction
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
          isNull(passwordResetTokens.invalidatedAt),
        ),
      );
    const activeResetTokenIds = activeResetTokens.map((token) => token.id);

    if (activeResetTokenIds.length > 0) {
      await transaction
        .update(passwordResetTokens)
        .set({ invalidatedAt: now })
        .where(inArray(passwordResetTokens.id, activeResetTokenIds));

      await transaction
        .update(emailOutbox)
        .set({
          status: "failed",
          lastError: "Password reset token was invalidated by a password change.",
          updatedAt: now,
        })
        .where(
          and(
            inArray(
              emailOutbox.idempotencyKey,
              activeResetTokenIds.map((id) => `password-reset:${id}`),
            ),
            eq(emailOutbox.status, "queued"),
          ),
        );
    }

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

    await writeSecurityEvent(transaction, {
      userId: user.id,
      email: user.email,
      ipAddress,
      userAgent: normalizedUserAgent,
      requestId,
      eventType: "password_change_completed",
    });

    return { kind: "completed" };
  });
}
