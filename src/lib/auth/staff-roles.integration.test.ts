import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountSecurityEvents,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy } from "./policy";
import { changeStaffRoles } from "./staff-roles";
import { createOpaqueToken, hashOpaqueToken } from "./token";

const fixtureUserIds = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Staff role integration tests may only write to a loopback development database.",
  );
}

async function createStaff(
  roleKey: string,
): Promise<{ userId: string; token: string }> {
  assertLocalDatabase();

  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, roleKey))
    .limit(1);
  assert.ok(role, `The local development database must be seeded with ${roleKey}.`);

  const userId = randomUUID();
  const token = createOpaqueToken();
  const now = new Date();
  fixtureUserIds.add(userId);

  await db.insert(users).values({
    id: userId,
    fullName: "Staff Role Test",
    email: `staff-role-${userId}@example.test`,
    accountType: "staff",
    status: "active",
    emailVerifiedAt: now,
  });
  await db.insert(userRoles).values({ userId, roleId: role.id });

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

async function cleanupFixtures(): Promise<void> {
  const userIds = [...fixtureUserIds];

  if (userIds.length === 0) {
    return;
  }

  await db
    .delete(accountSecurityEvents)
    .where(inArray(accountSecurityEvents.userId, userIds));
  await db.delete(sessions).where(inArray(sessions.userId, userIds));
  await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  fixtureUserIds.clear();
}

afterEach(cleanupFixtures);

test("admins can assign staff roles and changes revoke sessions and are audited", async () => {
  const actor = await createStaff("admin");
  const target = await createStaff("meter_reader");

  const result = await changeStaffRoles(
    actor.token,
    target.userId,
    ["meter_reader", "admin"],
    "staff-role-integration-test",
  );

  if (result.kind !== "changed") {
    assert.fail(`Expected role change to succeed, received ${result.kind}.`);
  }

  assert.deepEqual(result.roleKeys, ["admin", "meter_reader"]);

  const assignedRoles = await db
    .select({
      roleKey: roles.roleKey,
      assignedBy: userRoles.assignedBy,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, target.userId))
    .orderBy(roles.roleKey);
  assert.deepEqual(
    assignedRoles.map((role) => role.roleKey),
    ["admin", "meter_reader"],
  );
  assert.equal(assignedRoles.find((role) => role.roleKey === "admin")?.assignedBy, actor.userId);

  const targetSessions = await db
    .select({ revokedAt: sessions.revokedAt })
    .from(sessions)
    .where(eq(sessions.userId, target.userId));
  assert.ok(targetSessions.every((session) => session.revokedAt !== null));

  const [event] = await db
    .select({
      eventType: accountSecurityEvents.eventType,
      metadata: accountSecurityEvents.metadata,
    })
    .from(accountSecurityEvents)
    .where(
      and(
        eq(accountSecurityEvents.userId, target.userId),
        eq(accountSecurityEvents.eventType, "staff_roles_changed"),
      ),
    )
    .limit(1);
  assert.equal(event?.eventType, "staff_roles_changed");
  assert.deepEqual(
    (event?.metadata as { previousRoleKeys?: string[]; newRoleKeys?: string[] } | null)
      ?.previousRoleKeys,
    ["meter_reader"],
  );
  assert.deepEqual(
    (event?.metadata as { previousRoleKeys?: string[]; newRoleKeys?: string[] } | null)
      ?.newRoleKeys,
    ["admin", "meter_reader"],
  );
});

test("admins cannot edit an existing admin account", async () => {
  const actor = await createStaff("admin");
  const target = await createStaff("admin");

  const result = await changeStaffRoles(
    actor.token,
    target.userId,
    ["billing_officer"],
    null,
  );

  assert.equal(result.kind, "forbidden");
});

test("empty, customer, and superadmin role sets are rejected", async () => {
  const actor = await createStaff("admin");
  const target = await createStaff("meter_reader");

  assert.equal(
    (await changeStaffRoles(actor.token, target.userId, [], null)).kind,
    "role-not-found",
  );
  assert.equal(
    (await changeStaffRoles(actor.token, target.userId, ["customer"], null)).kind,
    "role-not-found",
  );
  assert.equal(
    (await changeStaffRoles(actor.token, target.userId, ["superadmin"], null)).kind,
    "role-not-found",
  );
});
