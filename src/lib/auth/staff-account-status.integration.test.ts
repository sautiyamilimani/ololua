import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountSecurityEvents,
  emailOutbox,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy } from "./policy";
import { changeStaffAccountStatus } from "./staff-account-status";
import { createOpaqueToken, hashOpaqueToken } from "./token";

const fixtureUserIds = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Staff account status tests may only write to a loopback development database.",
  );
}

async function createStaff(
  roleKey: string,
  status: "active" | "suspended" | "disabled" = "active",
): Promise<{ userId: string; token?: string }> {
  assertLocalDatabase();

  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, roleKey))
    .limit(1);
  assert.ok(role, `The local development database must be seeded with ${roleKey}.`);

  const userId = randomUUID();
  const now = new Date();
  fixtureUserIds.add(userId);

  await db.insert(users).values({
    id: userId,
    fullName: "Staff Status Test",
    email: `staff-status-${userId}@example.test`,
    accountType: "staff",
    status,
    emailVerifiedAt: now,
  });
  await db.insert(userRoles).values({ userId, roleId: role.id });

  if (status !== "active") {
    return { userId };
  }

  const token = createOpaqueToken();
  const policy = getSessionPolicy("staff", [roleKey]);
  const expiresAt = new Date(now.getTime() + policy.idleTimeoutMs);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashOpaqueToken(token),
    createdAt: now,
    lastActivityAt: now,
    idleExpiresAt: expiresAt,
    expiresAt,
  });

  return { userId, token };
}

async function addSession(
  userId: string,
  options: { expired?: boolean; revoked?: boolean } = {},
): Promise<string> {
  const token = createOpaqueToken();
  const now = new Date();
  const createdAt = options.expired
    ? new Date(now.getTime() - 10 * 60 * 1000)
    : now;
  const expiresAt = options.expired
    ? new Date(now.getTime() - 5 * 60 * 1000)
    : new Date(now.getTime() + 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashOpaqueToken(token),
    createdAt,
    lastActivityAt: createdAt,
    idleExpiresAt: expiresAt,
    expiresAt,
    revokedAt: options.revoked ? createdAt : null,
  });

  return token;
}

async function cleanupFixtures(): Promise<void> {
  const userIds = [...fixtureUserIds];

  if (userIds.length === 0) {
    return;
  }

  await db
    .delete(emailOutbox)
    .where(inArray(emailOutbox.recipientUserId, userIds));
  await db
    .delete(accountSecurityEvents)
    .where(inArray(accountSecurityEvents.userId, userIds));
  await db.delete(sessions).where(inArray(sessions.userId, userIds));
  await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  fixtureUserIds.clear();
}

afterEach(cleanupFixtures);

test("suspension revokes active sessions and writes a security event", async () => {
  const actor = await createStaff("admin");
  const target = await createStaff("meter_reader");
  assert.ok(actor.token);

  const activeToken = await addSession(target.userId);
  const expiredToken = await addSession(target.userId, { expired: true });
  const revokedToken = await addSession(target.userId, { revoked: true });

  const result = await changeStaffAccountStatus(
    actor.token,
    target.userId,
    "suspended",
    "staff-status-integration-test",
  );

  assert.equal(result.kind, "changed");

  const [suspendedUser] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, target.userId))
    .limit(1);
  assert.equal(suspendedUser?.status, "suspended");

  const storedSessions = await db
    .select({
      tokenHash: sessions.tokenHash,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, target.userId));

  assert.ok(
    storedSessions.find((session) => session.tokenHash === hashOpaqueToken(activeToken))
      ?.revokedAt,
  );
  assert.equal(
    storedSessions.find((session) => session.tokenHash === hashOpaqueToken(expiredToken))
      ?.revokedAt,
    null,
  );
  assert.ok(
    storedSessions.find((session) => session.tokenHash === hashOpaqueToken(revokedToken))
      ?.revokedAt,
  );

  const [event] = await db
    .select({
      eventType: accountSecurityEvents.eventType,
      metadata: accountSecurityEvents.metadata,
    })
    .from(accountSecurityEvents)
    .where(
      and(
        eq(accountSecurityEvents.userId, target.userId),
        eq(accountSecurityEvents.eventType, "staff_account_suspended"),
      ),
    )
    .limit(1);

  assert.equal(event?.eventType, "staff_account_suspended");
  assert.equal(
    (event?.metadata as { previousStatus?: string } | null)?.previousStatus,
    "active",
  );

  const [notification] = await db
    .select({
      recipientEmail: emailOutbox.recipientEmail,
      templateKey: emailOutbox.templateKey,
      templateData: emailOutbox.templateData,
      secretPayloadEncrypted: emailOutbox.secretPayloadEncrypted,
      status: emailOutbox.status,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.recipientUserId, target.userId))
    .limit(1);

  assert.equal(notification?.recipientEmail, `staff-status-${target.userId}@example.test`);
  assert.equal(notification?.templateKey, "staff_account_suspended");
  assert.deepEqual(notification?.templateData, { fullName: "Staff Status Test" });
  assert.equal(notification?.secretPayloadEncrypted, null);
  assert.equal(notification?.status, "queued");
});

test("admins cannot change another admin or their own status", async () => {
  const actor = await createStaff("admin");
  const otherAdmin = await createStaff("admin");
  assert.ok(actor.token);

  const otherAdminResult = await changeStaffAccountStatus(
    actor.token,
    otherAdmin.userId,
    "suspended",
    null,
  );
  const selfResult = await changeStaffAccountStatus(
    actor.token,
    actor.userId,
    "suspended",
    null,
  );

  assert.equal(otherAdminResult.kind, "forbidden");
  assert.equal(selfResult.kind, "forbidden");

  const unchangedUsers = await db
    .select({ status: users.status })
    .from(users)
    .where(inArray(users.id, [actor.userId, otherAdmin.userId]));
  assert.deepEqual(unchangedUsers.map((user) => user.status), ["active", "active"]);
});

test("reactivation restores active status but does not restore revoked sessions", async () => {
  const actor = await createStaff("admin");
  const target = await createStaff("meter_reader", "suspended");
  assert.ok(actor.token);

  const revokedSessionToken = await addSession(target.userId, { revoked: true });

  const result = await changeStaffAccountStatus(
    actor.token,
    target.userId,
    "active",
    null,
  );

  assert.equal(result.kind, "changed");

  const [reactivatedUser] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, target.userId))
    .limit(1);
  assert.equal(reactivatedUser?.status, "active");

  const [storedSession] = await db
    .select({ revokedAt: sessions.revokedAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, target.userId),
        eq(sessions.tokenHash, hashOpaqueToken(revokedSessionToken)),
      ),
    )
    .limit(1);
  assert.ok(storedSession?.revokedAt);

  const [notification] = await db
    .select({
      templateKey: emailOutbox.templateKey,
      status: emailOutbox.status,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.recipientUserId, target.userId))
    .limit(1);
  assert.equal(notification?.templateKey, "staff_account_reactivated");
  assert.equal(notification?.status, "queued");
});

test("invited and disabled accounts cannot be changed through suspension transitions", async () => {
  const actor = await createStaff("admin");
  const disabledTarget = await createStaff("meter_reader", "disabled");
  assert.ok(actor.token);

  const result = await changeStaffAccountStatus(
    actor.token,
    disabledTarget.userId,
    "active",
    null,
  );

  assert.equal(result.kind, "status-conflict");
});
