import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountSecurityEvents, sessions, users } from "@/lib/db/schema";
import { authenticate } from "./login";
import { hashPassword } from "./password";

const fixtureUserIds = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Login integration tests may only write to a loopback development database.",
  );
}

async function createSuspendedUser(options: {
  verified?: boolean;
  locked?: boolean;
} = {}): Promise<{ userId: string; email: string; password: string }> {
  assertLocalDatabase();

  const userId = randomUUID();
  const email = `login-status-${userId}@example.test`;
  const password = "Suspended-Account-Test-Password";
  const now = new Date();
  fixtureUserIds.add(userId);

  await db.insert(users).values({
    id: userId,
    fullName: "Suspended Login Test",
    email,
    passwordHash: await hashPassword(password),
    accountType: "staff",
    status: "suspended",
    emailVerifiedAt: options.verified === false ? null : now,
    lockedUntil: options.locked
      ? new Date(now.getTime() + 5 * 60 * 1000)
      : null,
  });

  return { userId, email, password };
}

async function cleanupFixtures(): Promise<void> {
  const userIds = [...fixtureUserIds];

  if (userIds.length === 0) {
    return;
  }

  await db
    .delete(accountSecurityEvents)
    .where(inArray(accountSecurityEvents.userId, userIds));
  await db.delete(sessions).where(inArray(sessions.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  fixtureUserIds.clear();
}

afterEach(cleanupFixtures);

test("correct password identifies a verified, unlocked suspended account", async () => {
  const user = await createSuspendedUser();

  assert.equal(
    await authenticate(user.email, `${user.password}-wrong`, "login-test"),
    null,
  );

  const result = await authenticate(user.email, user.password, "login-test");
  assert.deepEqual(result, { kind: "suspended" });

  const userSessions = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, user.userId));
  assert.equal(userSessions.length, 0);

  const events = await db
    .select({ eventType: accountSecurityEvents.eventType })
    .from(accountSecurityEvents)
    .where(eq(accountSecurityEvents.userId, user.userId));
  assert.deepEqual(
    events.map((event) => event.eventType).sort(),
    ["login_failed", "login_suspended"],
  );
});

test("locked or unverified suspended accounts retain the generic login failure", async () => {
  const lockedUser = await createSuspendedUser({ locked: true });
  const unverifiedUser = await createSuspendedUser({ verified: false });

  assert.equal(
    await authenticate(lockedUser.email, lockedUser.password, "login-test"),
    null,
  );
  assert.equal(
    await authenticate(unverifiedUser.email, unverifiedUser.password, "login-test"),
    null,
  );

  const failureEvents = await db
    .select({
      userId: accountSecurityEvents.userId,
      eventType: accountSecurityEvents.eventType,
    })
    .from(accountSecurityEvents)
    .where(
      and(
        inArray(accountSecurityEvents.userId, [
          lockedUser.userId,
          unverifiedUser.userId,
        ]),
        eq(accountSecurityEvents.eventType, "login_failed"),
      ),
    );

  assert.equal(failureEvents.length, 2);
});
