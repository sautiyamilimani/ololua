import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  meters,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy } from "@/lib/auth/policy";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/token";
import { createMeter, updateMeter } from "./management";

const fixtureUserIds = new Set<string>();
const fixtureMeterIds = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname));
}

async function createStaffSession(roleKey: "admin" | "meter_reader"): Promise<string> {
  assertLocalDatabase();
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, roleKey))
    .limit(1);
  assert.ok(role);

  const userId = randomUUID();
  const token = createOpaqueToken();
  const now = new Date();
  fixtureUserIds.add(userId);
  await db.insert(users).values({
    id: userId,
    fullName: "Meter Management Test",
    email: `meter-management-${userId}@example.test`,
    accountType: "staff",
    status: "active",
    emailVerifiedAt: now,
  });
  await db.insert(userRoles).values({ userId, roleId: role.id });
  const policy = getSessionPolicy("staff", [roleKey]);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashOpaqueToken(token),
    createdAt: now,
    lastActivityAt: now,
    idleExpiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
    expiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
  });
  return token;
}

afterEach(async () => {
  if (fixtureMeterIds.size > 0) {
    await db.delete(meters).where(inArray(meters.id, [...fixtureMeterIds]));
  }
  if (fixtureUserIds.size > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, [...fixtureUserIds]));
    await db.delete(userRoles).where(inArray(userRoles.userId, [...fixtureUserIds]));
    await db.delete(users).where(inArray(users.id, [...fixtureUserIds]));
  }
  fixtureMeterIds.clear();
  fixtureUserIds.clear();
});

test("admin creates and updates a meter while meter_reader is denied", async () => {
  assertLocalDatabase();
  const adminToken = await createStaffSession("admin");
  const serialNumber = `TEST-METER-${randomUUID()}`;
  const created = await createMeter(adminToken, {
    serialNumber,
    notes: "Test meter",
  });
  assert.equal(created.kind, "success");
  if (created.kind !== "success") return;
  fixtureMeterIds.add(created.meterId);

  const updated = await updateMeter(adminToken, created.meterId, {
    serialNumber,
    status: "DEFECTIVE",
    notes: "Defective for test",
  });
  assert.equal(updated.kind, "success");

  const [meter] = await db
    .select({ status: meters.status, notes: meters.notes })
    .from(meters)
    .where(eq(meters.id, created.meterId))
    .limit(1);
  assert.equal(meter?.status, "DEFECTIVE");
  assert.equal(meter?.notes, "Defective for test");

  const deniedToken = await createStaffSession("meter_reader");
  const denied = await createMeter(deniedToken, {
    serialNumber: `DENIED-${randomUUID()}`,
    notes: null,
  });
  assert.deepEqual(denied, { kind: "forbidden" });
});
