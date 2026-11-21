import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { POST as requestOtpRoute } from "@/app/api/auth/password-change/request-otp/route";
import { POST as verifyOtpRoute } from "@/app/api/auth/password-change/verify-otp/route";
import { POST as completeRoute } from "@/app/api/auth/password-change/complete/route";
import { db } from "@/lib/db";
import {
  accountSecurityEvents,
  emailOutbox,
  emailVerificationTokens,
  passwordResetTokens,
  rateLimits,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import {
  decryptSecretPayload,
  encryptSecretPayload,
  hashSecretValue,
} from "@/lib/email/secret-payload";
import {
  completePasswordChange,
  requestPasswordChangeOtp,
  verifyPasswordChangeOtp,
} from "./password-change";
import { hashPassword, verifyPassword } from "./password";
import { createOpaqueToken, hashOpaqueToken } from "./token";

process.env.EMAIL_OUTBOX_ENCRYPTION_KEY ??= Buffer.alloc(32, 0x5a).toString("base64");
process.env.APP_ORIGIN = "http://localhost:3000";

const fixtureUserIds = new Set<string>();
const fixtureEmails = new Set<string>();
const fixtureRateLimitKeys = new Set<string>();
const fixtureIpAddresses = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Password-change integration tests may only write to a loopback development database.",
  );
}

function createFixtureEmail(): string {
  const email = `password-change-${randomUUID()}@example.test`;
  fixtureEmails.add(email);
  return email;
}

function createFixtureIp(): string {
  const ipAddress = `198.51.100.${20 + fixtureIpAddresses.size}`;
  fixtureIpAddresses.add(ipAddress);
  return ipAddress;
}

function trackRateLimitBucket(action: string, identity: string): void {
  const digest = createHash("sha256")
    .update(`${action}:${identity}`)
    .digest("hex");
  fixtureRateLimitKeys.add(`${action}:${digest}`);
}

function trackRequestBuckets(userId: string, ipAddress: string): void {
  trackRateLimitBucket("password_change_otp_account", userId);
  trackRateLimitBucket("password_change_otp_request_ip", ipAddress);
}

function trackVerificationBuckets(ipAddress: string): void {
  trackRateLimitBucket("password_change_otp_verify_ip", ipAddress);
}

async function createUser(options: {
  accountType?: "staff" | "customer";
  roleKey?: string;
  passwordHash?: string;
} = {}): Promise<string> {
  assertLocalDatabase();

  const id = randomUUID();
  const now = new Date();
  const email = createFixtureEmail();
  fixtureUserIds.add(id);

  await db.insert(users).values({
    id,
    fullName: "Password Change Integration Test",
    email,
    accountType: options.accountType ?? "customer",
    status: "active",
    passwordHash: options.passwordHash ?? "unused-password-hash",
    emailVerifiedAt: now,
  });

  if (options.roleKey) {
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.roleKey, options.roleKey))
      .limit(1);
    assert.ok(role, `The development database must be seeded with ${options.roleKey}.`);
    await db.insert(userRoles).values({ userId: id, roleId: role.id });
  }

  return id;
}

async function createSession(userId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  const token = createOpaqueToken();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

  await db.insert(sessions).values({
    id,
    userId,
    tokenHash: hashOpaqueToken(token),
    lastActivityAt: now,
    idleExpiresAt: expiresAt,
    expiresAt,
  });

  return id;
}

async function getChallenge(userId: string) {
  const [challenge] = await db
    .select({
      id: emailVerificationTokens.id,
      tokenHash: emailVerificationTokens.tokenHash,
      createdAt: emailVerificationTokens.createdAt,
      expiresAt: emailVerificationTokens.expiresAt,
      verifiedAt: emailVerificationTokens.verifiedAt,
      invalidatedAt: emailVerificationTokens.invalidatedAt,
    })
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        eq(emailVerificationTokens.purpose, "password_change"),
      ),
    )
    .orderBy(desc(emailVerificationTokens.createdAt))
    .limit(1);

  assert.ok(challenge);

  const [outbox] = await db
    .select({
      id: emailOutbox.id,
      status: emailOutbox.status,
      secretPayloadEncrypted: emailOutbox.secretPayloadEncrypted,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, `password-change-otp:${challenge.id}`))
    .limit(1);
  assert.ok(outbox?.secretPayloadEncrypted);

  const payload = JSON.parse(
    decryptSecretPayload(outbox.secretPayloadEncrypted),
  ) as { otp?: unknown };
  assert.equal(typeof payload.otp, "string");

  return {
    ...challenge,
    otp: payload.otp as string,
    outboxId: outbox.id,
    outboxStatus: outbox.status,
  };
}

async function cleanupFixtures(): Promise<void> {
  const userIds = [...fixtureUserIds];
  const emails = [...fixtureEmails];
  const bucketKeys = [...fixtureRateLimitKeys];

  if (emails.length > 0) {
    await db
      .delete(accountSecurityEvents)
      .where(inArray(accountSecurityEvents.emailAttempted, emails));
  }

  if (userIds.length > 0) {
    await db
      .delete(accountSecurityEvents)
      .where(inArray(accountSecurityEvents.userId, userIds));
    await db.delete(emailOutbox).where(inArray(emailOutbox.recipientUserId, userIds));
    await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }

  if (bucketKeys.length > 0) {
    await db.delete(rateLimits).where(inArray(rateLimits.bucketKey, bucketKeys));
  }

  fixtureUserIds.clear();
  fixtureEmails.clear();
  fixtureRateLimitKeys.clear();
  fixtureIpAddresses.clear();
}

afterEach(cleanupFixtures);

test("password-change routes reject requests without valid CSRF headers", async () => {
  const request = (url: string) =>
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

  const responses = await Promise.all([
    requestOtpRoute(request("/api/auth/password-change/request-otp")),
    verifyOtpRoute(request("/api/auth/password-change/verify-otp")),
    completeRoute(request("/api/auth/password-change/complete")),
  ]);

  assert.deepEqual(
    responses.map((response) => response.status),
    [403, 403, 403],
  );
});

test("OTP requests require the current password, replace old challenges, and enforce the account limit", async () => {
  const currentPassword = "CurrentPassword-2026";
  const passwordHash = await hashPassword(currentPassword);
  const userId = await createUser({ passwordHash });
  const ipAddress = createFixtureIp();
  trackRequestBuckets(userId, ipAddress);

  const wrongPassword = await requestPasswordChangeOtp(
    userId,
    "incorrect-password",
    ipAddress,
    "integration-test",
  );
  assert.deepEqual(wrongPassword, { kind: "invalid-current-password" });

  const [afterWrongPassword] = await db
    .select({ failedLoginCount: users.failedLoginCount })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  assert.equal(afterWrongPassword?.failedLoginCount, 1);

  const firstRequest = await requestPasswordChangeOtp(
    userId,
    currentPassword,
    ipAddress,
    "integration-test",
  );
  assert.deepEqual(firstRequest, { kind: "queued" });
  const firstChallenge = await getChallenge(userId);
  assert.equal(
    firstChallenge.tokenHash,
    hashSecretValue(
      "password-change-otp:v1",
      `${userId}:${firstChallenge.id}:${firstChallenge.otp}`,
    ),
  );
  assert.ok(
    firstChallenge.expiresAt.getTime() - firstChallenge.createdAt.getTime() >=
      10 * 60 * 1000 - 1000,
  );
  assert.equal(firstChallenge.outboxStatus, "queued");

  const secondRequest = await requestPasswordChangeOtp(
    userId,
    currentPassword,
    ipAddress,
    "integration-test",
  );
  assert.deepEqual(secondRequest, { kind: "queued" });

  const tokens = await db
    .select({
      id: emailVerificationTokens.id,
      invalidatedAt: emailVerificationTokens.invalidatedAt,
    })
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.userId, userId),
        eq(emailVerificationTokens.purpose, "password_change"),
      ),
    );
  assert.equal(tokens.length, 2);
  assert.ok(tokens.find((token) => token.id === firstChallenge.id)?.invalidatedAt);

  const [firstOutbox] = await db
    .select({ status: emailOutbox.status })
    .from(emailOutbox)
    .where(eq(emailOutbox.id, firstChallenge.outboxId))
    .limit(1);
  assert.equal(firstOutbox?.status, "failed");

  const limitedRequest = await requestPasswordChangeOtp(
    userId,
    currentPassword,
    ipAddress,
    "integration-test",
  );
  assert.deepEqual(limitedRequest.kind, "rate-limited");

  const [resetFailedLoginCount] = await db
    .select({ failedLoginCount: users.failedLoginCount })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  assert.equal(resetFailedLoginCount?.failedLoginCount, 0);
});

test("OTP expiry and five incorrect attempts invalidate a challenge", async () => {
  const passwordHash = await hashPassword("CurrentPassword-2026");
  const userId = await createUser({ passwordHash });
  const ipAddress = createFixtureIp();
  trackRequestBuckets(userId, ipAddress);
  trackVerificationBuckets(ipAddress);

  const requestResult = await requestPasswordChangeOtp(
    userId,
    "CurrentPassword-2026",
    ipAddress,
    null,
  );
  assert.deepEqual(requestResult, { kind: "queued" });
  const challenge = await getChallenge(userId);
  trackRateLimitBucket("password_change_otp_attempt", challenge.id);

  const wrongOtp = challenge.otp === "000000" ? "000001" : "000000";
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await verifyPasswordChangeOtp(
      userId,
      wrongOtp,
      ipAddress,
      null,
    );
    assert.deepEqual(result, { kind: "invalid" });
  }

  const [invalidatedChallenge] = await db
    .select({ invalidatedAt: emailVerificationTokens.invalidatedAt })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.id, challenge.id))
    .limit(1);
  assert.ok(invalidatedChallenge?.invalidatedAt);

  await requestPasswordChangeOtp(
    userId,
    "CurrentPassword-2026",
    ipAddress,
    null,
  );
  const expiredChallenge = await getChallenge(userId);
  const expiredAt = new Date(Date.now() - 1000);
  await db
    .update(emailVerificationTokens)
    .set({
      createdAt: new Date(expiredAt.getTime() - 60 * 1000),
      expiresAt: expiredAt,
    })
    .where(eq(emailVerificationTokens.id, expiredChallenge.id));

  const expiredResult = await verifyPasswordChangeOtp(
    userId,
    expiredChallenge.otp,
    ipAddress,
    null,
  );
  assert.deepEqual(expiredResult, { kind: "invalid" });
});

test("OTP requests enforce the per-IP limit across accounts", async () => {
  const passwordHash = await hashPassword("CurrentPassword-2026");
  const ipAddress = createFixtureIp();
  const userIds: string[] = [];

  for (let index = 0; index < 11; index++) {
    const userId = await createUser({ passwordHash });
    userIds.push(userId);
    trackRequestBuckets(userId, ipAddress);

    const result = await requestPasswordChangeOtp(
      userId,
      "CurrentPassword-2026",
      ipAddress,
      null,
    );

    if (index < 10) {
      assert.deepEqual(result, { kind: "queued" });
    } else {
      assert.equal(result.kind, "rate-limited");
    }
  }
});

test("verified OTP changes the password and revokes all active sessions", async () => {
  const currentPassword = "CurrentPassword-2026";
  const userId = await createUser({
    passwordHash: await hashPassword(currentPassword),
  });
  const currentSessionId = await createSession(userId);
  const otherSessionId = await createSession(userId);
  const ipAddress = createFixtureIp();
  trackRequestBuckets(userId, ipAddress);
  trackVerificationBuckets(ipAddress);

  const requestResult = await requestPasswordChangeOtp(
    userId,
    currentPassword,
    ipAddress,
    "integration-test",
  );
  assert.deepEqual(requestResult, { kind: "queued" });
  const challenge = await getChallenge(userId);
  trackRateLimitBucket("password_change_otp_attempt", challenge.id);

  const verification = await verifyPasswordChangeOtp(
    userId,
    challenge.otp,
    ipAddress,
    "integration-test",
  );
  assert.equal(verification.kind, "verified");
  if (verification.kind !== "verified") {
    return;
  }

  const repeatVerification = await verifyPasswordChangeOtp(
    userId,
    challenge.otp,
    ipAddress,
    "integration-test",
  );
  assert.deepEqual(repeatVerification, verification);

  await db
    .update(emailVerificationTokens)
    .set({ expiresAt: new Date(Date.now() + 10 * 60 * 1000) })
    .where(eq(emailVerificationTokens.id, challenge.id));

  const resetTokenId = randomUUID();
  const resetToken = createOpaqueToken();
  const now = new Date();
  await db.insert(passwordResetTokens).values({
    id: resetTokenId,
    userId,
    tokenHash: hashOpaqueToken(resetToken),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  });
  await db.insert(emailOutbox).values({
    recipientUserId: userId,
    recipientEmail: createFixtureEmail(),
    templateKey: "password_reset",
    templateData: { fullName: "Password Change Integration Test", resetPath: "/reset-password" },
    secretPayloadEncrypted: encryptSecretPayload(
      JSON.stringify({ token: resetToken }),
    ),
    status: "queued",
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: now,
    idempotencyKey: `password-reset:${resetTokenId}`,
    createdAt: now,
    updatedAt: now,
  });

  const mismatch = await completePasswordChange(
    userId,
    currentSessionId,
    verification.verificationToken,
    "NewPassword-2026",
    "OtherPassword-2026",
    ipAddress,
    "integration-test",
  );
  assert.deepEqual(mismatch, { kind: "password-mismatch" });

  const tooShort = await completePasswordChange(
    userId,
    currentSessionId,
    verification.verificationToken,
    "short",
    "short",
    ipAddress,
    "integration-test",
  );
  assert.deepEqual(tooShort, { kind: "password-policy" });

  const completion = await completePasswordChange(
    userId,
    currentSessionId,
    verification.verificationToken,
    "NewPassword-2026",
    "NewPassword-2026",
    ipAddress,
    "integration-test",
  );
  assert.deepEqual(completion, { kind: "completed" });

  const [user] = await db
    .select({
      passwordHash: users.passwordHash,
      passwordChangedAt: users.passwordChangedAt,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  assert.ok(user?.passwordHash);
  assert.ok(user.passwordChangedAt);
  assert.equal(user.failedLoginCount, 0);
  assert.equal(user.lockedUntil, null);
  assert.equal(await verifyPassword("NewPassword-2026", user.passwordHash), true);
  assert.equal(await verifyPassword(currentPassword, user.passwordHash), false);

  const storedSessions = await db
    .select({ id: sessions.id, revokedAt: sessions.revokedAt })
    .from(sessions)
    .where(inArray(sessions.id, [currentSessionId, otherSessionId]));
  assert.ok(
    storedSessions.find((session) => session.id === currentSessionId)?.revokedAt,
  );
  assert.ok(
    storedSessions.find((session) => session.id === otherSessionId)?.revokedAt,
  );

  const [storedChallenge] = await db
    .select({
      invalidatedAt: emailVerificationTokens.invalidatedAt,
      tokenHash: emailVerificationTokens.tokenHash,
    })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.id, challenge.id))
    .limit(1);
  assert.ok(storedChallenge?.invalidatedAt);
  assert.equal(storedChallenge.tokenHash, hashOpaqueToken(verification.verificationToken));

  const [storedResetToken] = await db
    .select({ invalidatedAt: passwordResetTokens.invalidatedAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.id, resetTokenId))
    .limit(1);
  assert.ok(storedResetToken?.invalidatedAt);

  const [resetOutbox] = await db
    .select({ status: emailOutbox.status })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, `password-reset:${resetTokenId}`))
    .limit(1);
  assert.equal(resetOutbox?.status, "failed");

  const repeatedCompletion = await completePasswordChange(
    userId,
    currentSessionId,
    verification.verificationToken,
    "AnotherPassword-2026",
    "AnotherPassword-2026",
    ipAddress,
    null,
  );
  assert.deepEqual(repeatedCompletion, { kind: "invalid" });
});

test("admin password changes enforce the 12-character minimum", async () => {
  const currentPassword = "CurrentPassword-2026";
  const userId = await createUser({
    accountType: "staff",
    roleKey: "admin",
    passwordHash: await hashPassword(currentPassword),
  });
  const currentSessionId = await createSession(userId);
  const ipAddress = createFixtureIp();
  trackRequestBuckets(userId, ipAddress);
  trackVerificationBuckets(ipAddress);

  const requestResult = await requestPasswordChangeOtp(
    userId,
    currentPassword,
    ipAddress,
    null,
  );
  assert.deepEqual(requestResult, { kind: "queued" });
  const challenge = await getChallenge(userId);
  trackRateLimitBucket("password_change_otp_attempt", challenge.id);
  const verification = await verifyPasswordChangeOtp(
    userId,
    challenge.otp,
    ipAddress,
    null,
  );
  assert.equal(verification.kind, "verified");
  if (verification.kind !== "verified") {
    return;
  }

  const tooShort = await completePasswordChange(
    userId,
    currentSessionId,
    verification.verificationToken,
    "shortpass",
    "shortpass",
    ipAddress,
    null,
  );
  assert.deepEqual(tooShort, { kind: "password-policy" });

  const valid = await completePasswordChange(
    userId,
    currentSessionId,
    verification.verificationToken,
    "LongEnoughPassword-2026",
    "LongEnoughPassword-2026",
    ipAddress,
    null,
  );
  assert.deepEqual(valid, { kind: "completed" });
});

test("password-change integration fixtures are removed after the tests", async () => {
  assertLocalDatabase();

  const remainingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "password-change-%@example.test"));
  const remainingOutboxRows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(like(emailOutbox.recipientEmail, "password-change-%@example.test"));
  const remainingRateLimits = await db
    .select({ id: rateLimits.id })
    .from(rateLimits)
    .where(
      inArray(rateLimits.action, [
        "password_change_otp_account",
        "password_change_otp_request_ip",
        "password_change_otp_verify_ip",
        "password_change_otp_attempt",
      ]),
    );

  assert.equal(remainingUsers.length, 0);
  assert.equal(remainingOutboxRows.length, 0);
  assert.equal(remainingRateLimits.length, 0);
});
