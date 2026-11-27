import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerMeterAccounts,
  customers,
  meterAssignments,
  meters,
  roles,
  serviceVariants,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy } from "@/lib/auth/policy";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/token";
import {
  assignMeter,
  removeMeterAssignment,
  updateMeterAssignmentLocation,
} from "./management";

const fixtureIds = {
  users: new Set<string>(),
  customers: new Set<string>(),
  accounts: new Set<string>(),
  meters: new Set<string>(),
  assignments: new Set<string>(),
};

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname));
}

async function createFixture(): Promise<{ token: string; accountId: string; meterId: string }> {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.roleKey, "admin")).limit(1);
  const [variant] = await db.select({ id: serviceVariants.id }).from(serviceVariants).where(eq(serviceVariants.status, "ACTIVE")).limit(1);
  assert.ok(role && variant);

  const now = new Date();
  const userId = randomUUID();
  const token = createOpaqueToken();
  fixtureIds.users.add(userId);
  await db.insert(users).values({
    id: userId,
    fullName: "Meter Assignment Test",
    email: `meter-assignment-${userId}@example.test`,
    accountType: "staff",
    status: "active",
    emailVerifiedAt: now,
  });
  await db.insert(userRoles).values({ userId, roleId: role.id });
  const policy = getSessionPolicy("staff", ["admin"]);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashOpaqueToken(token),
    createdAt: now,
    lastActivityAt: now,
    idleExpiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
    expiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
  });

  const customerId = randomUUID();
  fixtureIds.customers.add(customerId);
  await db.insert(customers).values({
    id: customerId,
    customerNumber: `TEST-${randomUUID().slice(0, 8)}`,
    customerType: "individual",
    fullName: "Meter Assignment Fixture",
    phone: "0700000003",
    email: `assignment-${randomUUID()}@example.test`,
    status: "active",
  });

  const accountId = randomUUID();
  fixtureIds.accounts.add(accountId);
  await db.insert(customerMeterAccounts).values({
    id: accountId,
    accountNumber: `TEST-ACC-${randomUUID().slice(0, 8)}`,
    customerId,
    serviceVariantId: variant.id,
    zoneId: null,
    status: "ACTIVE",
  });

  const meterId = randomUUID();
  fixtureIds.meters.add(meterId);
  await db.insert(meters).values({
    id: meterId,
    serialNumber: `TEST-METER-${randomUUID()}`,
    status: "ACTIVE",
  });

  return { token, accountId, meterId };
}

afterEach(async () => {
  if (fixtureIds.assignments.size > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, [...fixtureIds.assignments]));
    await db.delete(meterAssignments).where(inArray(meterAssignments.id, [...fixtureIds.assignments]));
  }
  if (fixtureIds.accounts.size > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, [...fixtureIds.accounts]));
    await db.delete(customerMeterAccounts).where(inArray(customerMeterAccounts.id, [...fixtureIds.accounts]));
  }
  if (fixtureIds.meters.size > 0) await db.delete(meters).where(inArray(meters.id, [...fixtureIds.meters]));
  if (fixtureIds.customers.size > 0) await db.delete(customers).where(inArray(customers.id, [...fixtureIds.customers]));
  if (fixtureIds.users.size > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, [...fixtureIds.users]));
    await db.delete(userRoles).where(inArray(userRoles.userId, [...fixtureIds.users]));
    await db.delete(users).where(inArray(users.id, [...fixtureIds.users]));
  }
  for (const set of Object.values(fixtureIds)) set.clear();
});

test("meter assignment starts at zero, prevents duplicate active assignment, and can be removed", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();
  const assigned = await assignMeter(
    fixture.token,
    fixture.meterId,
    fixture.accountId,
    "Near the pump shed",
  );
  assert.equal(assigned.kind, "success");
  if (assigned.kind !== "success") return;
  fixtureIds.assignments.add(assigned.assignmentId);

  const locationUpdate = await updateMeterAssignmentLocation(
    fixture.token,
    assigned.assignmentId,
    "Beside the main gate",
  );
  assert.equal(locationUpdate.kind, "success");
  if (locationUpdate.kind !== "success") return;
  assert.equal(locationUpdate.locationDescription, "Beside the main gate");

  const [assignment] = await db
    .select({
      locationDescription: meterAssignments.locationDescription,
    })
    .from(meterAssignments)
    .where(eq(meterAssignments.id, assigned.assignmentId))
    .limit(1);
  assert.equal(assignment?.locationDescription, "Beside the main gate");

  const [locationAudit] = await db
    .select({
      action: auditLogs.action,
      oldValues: auditLogs.oldValues,
      newValues: auditLogs.newValues,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityId, assigned.assignmentId),
        eq(auditLogs.action, "meter_assignment.location_updated"),
      ),
    )
    .limit(1);
  assert.deepEqual(locationAudit, {
    action: "meter_assignment.location_updated",
    oldValues: { locationDescription: "Near the pump shed" },
    newValues: { locationDescription: "Beside the main gate" },
  });

  const duplicate = await assignMeter(fixture.token, fixture.meterId, fixture.accountId);
  assert.deepEqual(duplicate, { kind: "meter-already-assigned" });

  const removed = await removeMeterAssignment(
    fixture.token,
    assigned.assignmentId,
    "Meter replaced",
  );
  assert.equal(removed.kind, "success");
  const historicalUpdate = await updateMeterAssignmentLocation(
    fixture.token,
    assigned.assignmentId,
    "Should not change",
  );
  assert.deepEqual(historicalUpdate, {
    kind: "already-removed",
  });

  const reassigned = await assignMeter(
    fixture.token,
    fixture.meterId,
    fixture.accountId,
    null,
  );
  assert.equal(reassigned.kind, "success");
  if (reassigned.kind === "success") fixtureIds.assignments.add(reassigned.assignmentId);
});
