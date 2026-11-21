import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { POST as completePasswordResetRoute } from "@/app/api/auth/password-reset/complete/route";
import { POST as requestPasswordResetRoute } from "@/app/api/auth/password-reset/request/route";
import {
  accountSecurityEvents,
  emailOutbox,
  passwordResetTokens,
  rateLimits,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { decryptSecretPayload } from "@/lib/email/secret-payload";
import { completePasswordReset, requestPasswordReset } from "./password-reset";
import { createOpaqueToken, hashOpaqueToken } from "./token";
import { verifyPassword } from "./password";

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
    "Password-reset integration tests may only write to a loopback development database.",
  );
}

function createFixtureEmail(label: string): string {
  const email = `password-reset-${label}-${randomUUID()}@example.test`;
  fixtureEmails.add(email);
  return email;
}

function createFixtureIp(): string {
  const ipAddress = `198.51.100.${10 + fixtureIpAddresses.size}`;
  fixtureIpAddresses.add(ipAddress);
  return ipAddress;
}

function getRateLimitBucketKey(action: string, value: string): string {
  const digest = createHash("sha256")
    .update(`${action}:${value}`)
    .digest("hex");
  const bucketKey = `${action}:${digest}`;
  fixtureRateLimitKeys.add(bucketKey);
  return bucketKey;
}

function trackRateLimitKeys(email: string, ipAddress: string): void {
  getRateLimitBucketKey("password_reset_email", email.trim().toLowerCase());
  getRateLimitBucketKey("password_reset_ip", ipAddress);
}

async function createUser(options: {
  email: string;
  accountType?: "staff" | "customer";
  status?: "invited" | "active" | "suspended" | "disabled";
  verified?: boolean;
  passwordHash?: string | null;
  roleKey?: string;
}): Promise<string> {
  assertLocalDatabase();

  const userId = randomUUID();
  const now = new Date();
  fixtureUserIds.add(userId);

  await db.insert(users).values({
    id: userId,
    fullName: "Password Reset Integration Test",
    email: options.email,
    accountType: options.accountType ?? "customer",
    status: options.status ?? "active",
    passwordHash:
      options.passwordHash === undefined ? "existing-password-hash" : options.passwordHash,
    emailVerifiedAt: options.verified === false ? null : now,
  });

  if (options.roleKey) {
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.roleKey, options.roleKey))
      .limit(1);
    assert.ok(role, `The local development database must be seeded with ${options.roleKey}.`);
    await db.insert(userRoles).values({ userId, roleId: role.id });
  }

  return userId;
}

async function getQueuedToken(userId: string): Promise<{
  tokenId: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
}> {
  const [resetToken] = await db
    .select({
      id: passwordResetTokens.id,
      tokenHash: passwordResetTokens.tokenHash,
      createdAt: passwordResetTokens.createdAt,
      expiresAt: passwordResetTokens.expiresAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, userId))
    .orderBy(passwordResetTokens.createdAt)
    .limit(1);
  assert.ok(resetToken);

  const [outbox] = await db
    .select({ secretPayloadEncrypted: emailOutbox.secretPayloadEncrypted })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, `password-reset:${resetToken.id}`))
    .limit(1);
  assert.ok(outbox?.secretPayloadEncrypted);

  const payload = JSON.parse(
    decryptSecretPayload(outbox.secretPayloadEncrypted),
  ) as { token?: unknown };
  assert.equal(typeof payload.token, "string");
  assert.equal(hashOpaqueToken(payload.token as string), resetToken.tokenHash);

  return {
    tokenId: resetToken.id,
    token: payload.token as string,
    createdAt: resetToken.createdAt,
    expiresAt: resetToken.expiresAt,
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
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }

  if (bucketKeys.length > 0) {
    await db
      .delete(rateLimits)
      .where(inArray(rateLimits.bucketKey, bucketKeys));
  }

  fixtureUserIds.clear();
  fixtureEmails.clear();
  fixtureRateLimitKeys.clear();
  fixtureIpAddresses.clear();
}

afterEach(cleanupFixtures);

test("password-reset routes enforce CSRF and return the documented public envelopes", async () => {
  const missingCsrf = await requestPasswordResetRoute(
    new Request("http://localhost/api/auth/password-reset/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "route-test@example.test" }),
    }),
  );
  assert.equal(missingCsrf.status, 403);

  const email = createFixtureEmail("route");
  const ipAddress = createFixtureIp();
  trackRateLimitKeys(email, ipAddress);
  const requestResponse = await requestPasswordResetRoute(
    new Request("http://localhost/api/auth/password-reset/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
        "x-csrf-protection": "1",
        "x-real-ip": ipAddress,
      },
      body: JSON.stringify({ email }),
    }),
  );

  assert.equal(requestResponse.status, 202);
  assert.equal(requestResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await requestResponse.json(), {
    success: true,
    data: { requestAccepted: true },
  });

  const invalidTokenResponse = await completePasswordResetRoute(
    new Request("http://localhost/api/auth/password-reset/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
        "x-csrf-protection": "1",
        "x-real-ip": ipAddress,
      },
      body: JSON.stringify({
        token: "A".repeat(43),
        password: "a-valid-password",
      }),
    }),
  );

  assert.equal(invalidTokenResponse.status, 400);
  assert.equal(invalidTokenResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await invalidTokenResponse.json(), {
    success: false,
    error: {
      code: "RESET_TOKEN_INVALID",
      message: "The reset link is invalid or can no longer be used.",
    },
  });
});

test("requests return the same accepted result and queue a hashed, encrypted 60-minute token", async () => {
  const email = createFixtureEmail("eligible");
  const ipAddress = createFixtureIp();
  trackRateLimitKeys(email, ipAddress);
  const userId = await createUser({ email });

  const knownResult = await requestPasswordReset(email, ipAddress, "integration-test");
  const unknownEmail = createFixtureEmail("unknown");
  trackRateLimitKeys(unknownEmail, ipAddress);
  const unknownResult = await requestPasswordReset(
    unknownEmail,
    ipAddress,
    "integration-test",
  );

  assert.deepEqual(knownResult, { kind: "accepted", emailQueued: true });
  assert.deepEqual(unknownResult, { kind: "accepted", emailQueued: false });

  const reset = await getQueuedToken(userId);
  const [outbox] = await db
    .select({
      recipientEmail: emailOutbox.recipientEmail,
      templateKey: emailOutbox.templateKey,
      templateData: emailOutbox.templateData,
      status: emailOutbox.status,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, `password-reset:${reset.tokenId}`))
    .limit(1);

  assert.equal(
    reset.expiresAt.getTime() - reset.createdAt.getTime(),
    60 * 60 * 1000,
  );
  assert.equal(outbox?.recipientEmail, email);
  assert.equal(outbox?.templateKey, "password_reset");
  assert.equal(outbox?.status, "queued");
  assert.deepEqual(outbox?.templateData, {
    fullName: "Password Reset Integration Test",
    resetPath: "/reset-password",
  });
  assert.equal(
    JSON.stringify(outbox?.templateData).includes(reset.token),
    false,
  );
});

test("a fourth request for one email is suppressed and earlier tokens are invalidated", async () => {
  const email = createFixtureEmail("throttle");
  const ipAddress = createFixtureIp();
  trackRateLimitKeys(email, ipAddress);
  const userId = await createUser({ email });

  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await requestPasswordReset(email, ipAddress, null);
    assert.deepEqual(result, {
      kind: "accepted",
      emailQueued: attempt < 3,
    });
  }

  const tokens = await db
    .select({
      invalidatedAt: passwordResetTokens.invalidatedAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, userId));
  assert.equal(tokens.length, 3);
  assert.equal(tokens.filter((token) => token.invalidatedAt === null).length, 1);
  assert.equal(tokens.filter((token) => token.invalidatedAt !== null).length, 2);

  const [emailBucket] = await db
    .select({ attemptCount: rateLimits.attemptCount, blockedUntil: rateLimits.blockedUntil })
    .from(rateLimits)
    .where(
      eq(
        rateLimits.bucketKey,
        getRateLimitBucketKey("password_reset_email", email),
      ),
    )
    .limit(1);
  assert.equal(emailBucket?.attemptCount, 3);
  assert.ok(emailBucket?.blockedUntil);

  const outboxStatuses = await db
    .select({ status: emailOutbox.status })
    .from(emailOutbox)
    .where(eq(emailOutbox.recipientUserId, userId));
  assert.equal(outboxStatuses.filter((item) => item.status === "failed").length, 2);
  assert.equal(outboxStatuses.filter((item) => item.status === "queued").length, 1);
});

test("the eleventh request from an IP is rate-limited with a retry interval", async () => {
  const ipAddress = createFixtureIp();

  for (let attempt = 0; attempt < 10; attempt++) {
    const email = createFixtureEmail(`ip-limit-${attempt}`);
    trackRateLimitKeys(email, ipAddress);
    const result = await requestPasswordReset(email, ipAddress, null);
    assert.deepEqual(result, { kind: "accepted", emailQueued: false });
  }

  const finalEmail = createFixtureEmail("ip-limit-final");
  trackRateLimitKeys(finalEmail, ipAddress);
  const limitedResponse = await requestPasswordResetRoute(
    new Request("http://localhost/api/auth/password-reset/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
        "x-csrf-protection": "1",
        "x-real-ip": ipAddress,
      },
      body: JSON.stringify({ email: finalEmail }),
    }),
  );
  const retryAfter = Number(limitedResponse.headers.get("retry-after"));

  assert.equal(limitedResponse.status, 429);
  assert.ok(retryAfter > 0);
  assert.ok(retryAfter <= 15 * 60);
  assert.equal(limitedResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await limitedResponse.json(), {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Try again later.",
    },
  });

  const [blockedEmailBucket] = await db
    .select({ bucketKey: rateLimits.bucketKey })
    .from(rateLimits)
    .where(
      eq(
        rateLimits.bucketKey,
        getRateLimitBucketKey("password_reset_email", finalEmail),
      ),
    )
    .limit(1);
  assert.equal(blockedEmailBucket, undefined);
});

test("completion changes the password, clears lockout, revokes active sessions, and rejects replay", async () => {
  const email = createFixtureEmail("complete");
  const ipAddress = createFixtureIp();
  trackRateLimitKeys(email, ipAddress);
  const userId = await createUser({ email });
  const activeSessionToken = createOpaqueToken();
  const expiredSessionToken = createOpaqueToken();
  const now = new Date();

  await db
    .update(users)
    .set({ failedLoginCount: 6, lockedUntil: new Date(now.getTime() + 60_000) })
    .where(eq(users.id, userId));
  await db.insert(sessions).values([
    {
      userId,
      tokenHash: hashOpaqueToken(activeSessionToken),
      createdAt: now,
      lastActivityAt: now,
      idleExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
    {
      userId,
      tokenHash: hashOpaqueToken(expiredSessionToken),
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      lastActivityAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      idleExpiresAt: new Date(now.getTime() - 60 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 60 * 60 * 1000),
    },
  ]);

  await requestPasswordReset(email, ipAddress, null);
  const reset = await getQueuedToken(userId);
  const result = await completePasswordReset(
    reset.token,
    "a-new-password",
    "integration-test",
    ipAddress,
  );

  assert.deepEqual(result, { kind: "completed" });

  const [updatedUser] = await db
    .select({
      passwordHash: users.passwordHash,
      passwordChangedAt: users.passwordChangedAt,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  assert.ok(updatedUser?.passwordHash);
  assert.equal(await verifyPassword("a-new-password", updatedUser.passwordHash), true);
  assert.ok(updatedUser.passwordChangedAt);
  assert.equal(updatedUser.failedLoginCount, 0);
  assert.equal(updatedUser.lockedUntil, null);

  const sessionRows = await db
    .select({ tokenHash: sessions.tokenHash, revokedAt: sessions.revokedAt })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  assert.ok(
    sessionRows.find((session) => session.tokenHash === hashOpaqueToken(activeSessionToken))
      ?.revokedAt,
  );
  assert.equal(
    sessionRows.find(
      (session) => session.tokenHash === hashOpaqueToken(expiredSessionToken),
    )?.revokedAt,
    null,
  );

  const replay = await completePasswordReset(
    reset.token,
    "a-second-new-password",
    null,
    ipAddress,
  );
  assert.deepEqual(replay, { kind: "invalid" });

  const [resetToken] = await db
    .select({ usedAt: passwordResetTokens.usedAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.id, reset.tokenId))
    .limit(1);
  assert.ok(resetToken?.usedAt);
});

test("concurrent completion attempts can consume a reset token only once", async () => {
  const email = createFixtureEmail("concurrent");
  const ipAddress = createFixtureIp();
  trackRateLimitKeys(email, ipAddress);
  const userId = await createUser({ email });

  await requestPasswordReset(email, ipAddress, null);
  const reset = await getQueuedToken(userId);
  const results = await Promise.all([
    completePasswordReset(reset.token, "first-new-password", null, ipAddress),
    completePasswordReset(reset.token, "second-new-password", null, ipAddress),
  ]);

  assert.equal(results.filter((result) => result.kind === "completed").length, 1);
  assert.equal(results.filter((result) => result.kind === "invalid").length, 1);
});

test("admin password minimum is enforced and ineligible accounts never queue email", async () => {
  const adminEmail = createFixtureEmail("admin");
  const adminIp = createFixtureIp();
  trackRateLimitKeys(adminEmail, adminIp);
  const adminUserId = await createUser({
    email: adminEmail,
    accountType: "staff",
    roleKey: "admin",
  });
  await requestPasswordReset(adminEmail, adminIp, null);
  const reset = await getQueuedToken(adminUserId);

  const tooShort = await completePasswordReset(
    reset.token,
    "shortpass",
    null,
    adminIp,
  );
  assert.deepEqual(tooShort, { kind: "password-policy" });

  const accepted = await completePasswordReset(
    reset.token,
    "a-longer-admin-password",
    null,
    adminIp,
  );
  assert.deepEqual(accepted, { kind: "completed" });

  const ineligibleAccounts: Array<{
    label: string;
    status?: "invited" | "active" | "suspended" | "disabled";
    verified?: boolean;
    passwordHash?: string | null;
  }> = [
    { label: "invited", status: "invited", passwordHash: null },
    { label: "suspended", status: "suspended" },
    { label: "disabled", status: "disabled" },
    { label: "unverified", verified: false },
    { label: "without-password", passwordHash: null },
  ];

  for (const account of ineligibleAccounts) {
    const email = createFixtureEmail(account.label);
    const ipAddress = createFixtureIp();
    trackRateLimitKeys(email, ipAddress);
    const userId = await createUser({ email, ...account });
    const request = await requestPasswordReset(email, ipAddress, null);
    assert.deepEqual(request, { kind: "accepted", emailQueued: false });

    const tokens = await db
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId));
    assert.equal(tokens.length, 0, `${account.label} account must not get a reset token.`);

    const outboxRows = await db
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(eq(emailOutbox.recipientUserId, userId));
    assert.equal(outboxRows.length, 0, `${account.label} account must not get reset email.`);
  }
});

test("password-reset integration fixtures are removed after the tests", async () => {
  assertLocalDatabase();

  const remainingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "password-reset-%@example.test"));
  const remainingEvents = await db
    .select({ id: accountSecurityEvents.id })
    .from(accountSecurityEvents)
    .where(
      and(
        eq(accountSecurityEvents.eventType, "password_reset_requested"),
        like(accountSecurityEvents.emailAttempted, "password-reset-%@example.test"),
      ),
    );

  assert.equal(remainingUsers.length, 0);
  assert.equal(remainingEvents.length, 0);
});
