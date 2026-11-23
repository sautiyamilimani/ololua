import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
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
import { transitionCustomerMeterAccount } from "./lifecycle";

const fixtureUserIds = new Set<string>();
const fixtureCustomerIds = new Set<string>();
const fixtureAccountIds = new Set<string>();
const fixtureMeterIds = new Set<string>();
const fixtureAssignmentIds = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Customer meter account lifecycle tests may only write to a loopback development database.",
  );
}

async function createStaffSession(): Promise<string> {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, "admin"))
    .limit(1);
  assert.ok(role, "The development database must be seeded with admin.");

  const userId = randomUUID();
  const token = createOpaqueToken();
  const now = new Date();
  fixtureUserIds.add(userId);

  await db.insert(users).values({
    id: userId,
    fullName: "Account Lifecycle Test",
    email: `account-lifecycle-${userId}@example.test`,
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

  return token;
}

async function createAccountFixture() {
  const customerId = randomUUID();
  fixtureCustomerIds.add(customerId);
  await db.insert(customers).values({
    id: customerId,
    customerNumber: `TEST-${randomUUID().slice(0, 8)}`,
    customerType: "individual",
    fullName: "Lifecycle Fixture",
    phone: "0700000002",
    email: `lifecycle-${randomUUID()}@example.test`,
    status: "active",
  });

  const [variant] = await db
    .select({ id: serviceVariants.id })
    .from(serviceVariants)
    .where(eq(serviceVariants.status, "ACTIVE"))
    .limit(1);
  assert.ok(variant, "The development database must contain an active service variant.");

  const accountId = randomUUID();
  fixtureAccountIds.add(accountId);
  await db.insert(customerMeterAccounts).values({
    id: accountId,
    accountNumber: `TEST-ACC-${randomUUID().slice(0, 8)}`,
    customerId,
    serviceVariantId: variant.id,
    zoneId: null,
    propertyAddress: "Lifecycle Test Plot",
    status: "ACTIVE",
  });

  const meterId = randomUUID();
  fixtureMeterIds.add(meterId);
  await db.insert(meters).values({
    id: meterId,
    serialNumber: `TEST-METER-${randomUUID()}`,
    status: "ACTIVE",
  });

  const assignmentId = randomUUID();
  fixtureAssignmentIds.add(assignmentId);
  await db.insert(meterAssignments).values({
    id: assignmentId,
    meterId,
    customerMeterAccountId: accountId,
    initialReading: "0.000",
    assignedAt: new Date(),
  });

  return accountId;
}

afterEach(async () => {
  if (fixtureAssignmentIds.size > 0) {
    await db
      .delete(meterAssignments)
      .where(inArray(meterAssignments.id, [...fixtureAssignmentIds]));
  }
  if (fixtureAccountIds.size > 0) {
    await db
      .delete(auditLogs)
      .where(inArray(auditLogs.entityId, [...fixtureAccountIds]));
    await db
      .delete(customerMeterAccounts)
      .where(inArray(customerMeterAccounts.id, [...fixtureAccountIds]));
  }
  if (fixtureMeterIds.size > 0) {
    await db.delete(meters).where(inArray(meters.id, [...fixtureMeterIds]));
  }
  if (fixtureCustomerIds.size > 0) {
    await db.delete(customers).where(inArray(customers.id, [...fixtureCustomerIds]));
  }
  if (fixtureUserIds.size > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, [...fixtureUserIds]));
    await db.delete(userRoles).where(inArray(userRoles.userId, [...fixtureUserIds]));
    await db.delete(users).where(inArray(users.id, [...fixtureUserIds]));
  }
  fixtureAssignmentIds.clear();
  fixtureAccountIds.clear();
  fixtureMeterIds.clear();
  fixtureCustomerIds.clear();
  fixtureUserIds.clear();
});

test("account lifecycle suspends, closes, reopens, and preserves active meter assignments", async () => {
  assertLocalDatabase();
  const token = await createStaffSession();
  const accountId = await createAccountFixture();

  const suspended = await transitionCustomerMeterAccount(
    token,
    accountId,
    "SUSPEND",
    "Non-payment",
  );
  assert.equal(suspended.kind, "success");
  if (suspended.kind !== "success") return;
  assert.equal(suspended.previousStatus, "ACTIVE");
  assert.equal(suspended.status, "SUSPENDED");

  const closed = await transitionCustomerMeterAccount(
    token,
    accountId,
    "CLOSE",
  );
  assert.equal(closed.kind, "success");
  if (closed.kind !== "success") return;
  assert.equal(closed.previousStatus, "SUSPENDED");
  assert.equal(closed.status, "CLOSED");

  const reopened = await transitionCustomerMeterAccount(
    token,
    accountId,
    "REACTIVATE",
  );
  assert.equal(reopened.kind, "success");
  if (reopened.kind !== "success") return;
  assert.equal(reopened.status, "ACTIVE");

  const [account] = await db
    .select({ status: customerMeterAccounts.status })
    .from(customerMeterAccounts)
    .where(eq(customerMeterAccounts.id, accountId))
    .limit(1);
  assert.equal(account?.status, "ACTIVE");

  const [assignment] = await db
    .select({ removedAt: meterAssignments.removedAt })
    .from(meterAssignments)
    .where(eq(meterAssignments.customerMeterAccountId, accountId))
    .limit(1);
  assert.equal(assignment?.removedAt, null);

  const auditEntries = await db
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, accountId));
  assert.equal(auditEntries.length, 3);
});

test("invalid lifecycle transitions are rejected", async () => {
  assertLocalDatabase();
  const token = await createStaffSession();
  const accountId = await createAccountFixture();

  const invalid = await transitionCustomerMeterAccount(
    token,
    accountId,
    "REACTIVATE",
  );
  assert.deepEqual(invalid, { kind: "invalid-transition" });
});
