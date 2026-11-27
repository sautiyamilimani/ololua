import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerMeterAccounts,
  customerMeterBillings,
  customers,
  meterAssignments,
  meterReadings,
  meters,
  roles,
  serviceVariants,
  sessions,
  settings,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy } from "@/lib/auth/policy";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/token";
import { submitMeterReading } from "./management";

const fixture = {
  users: new Set<string>(),
  customers: new Set<string>(),
  accounts: new Set<string>(),
  meters: new Set<string>(),
  assignments: new Set<string>(),
  readings: new Set<string>(),
};
let originalDueDays: string | null = null;

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname));
}

async function createFixture(): Promise<{ token: string; assignmentId: string }> {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.roleKey, "admin")).limit(1);
  const [variant] = await db.select({ id: serviceVariants.id }).from(serviceVariants).where(eq(serviceVariants.status, "ACTIVE")).limit(1);
  assert.ok(role && variant);
  const [existingDueSetting] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "invoice_due_days"))
    .limit(1);
  originalDueDays = existingDueSetting?.value ?? null;
  await db.insert(settings).values({
    key: "invoice_due_days",
    value: "30",
  }).onConflictDoUpdate({
    target: settings.key,
    set: { value: "30" },
  });
  const now = new Date();

  const userId = randomUUID();
  const token = createOpaqueToken();
  fixture.users.add(userId);
  await db.insert(users).values({
    id: userId,
    fullName: "Meter Reading Test",
    email: `meter-reading-${userId}@example.test`,
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
  fixture.customers.add(customerId);
  await db.insert(customers).values({
    id: customerId,
    customerNumber: `TEST-${randomUUID().slice(0, 8)}`,
    customerType: "individual",
    fullName: "Meter Reading Fixture",
    phone: "0700000004",
    email: `reading-${randomUUID()}@example.test`,
    status: "active",
  });

  const accountId = randomUUID();
  fixture.accounts.add(accountId);
  await db.insert(customerMeterAccounts).values({
    id: accountId,
    accountNumber: `TEST-ACC-${randomUUID().slice(0, 8)}`,
    customerId,
    serviceVariantId: variant.id,
    zoneId: null,
    status: "ACTIVE",
  });

  const meterId = randomUUID();
  fixture.meters.add(meterId);
  await db.insert(meters).values({
    id: meterId,
    serialNumber: `TEST-METER-${randomUUID()}`,
    status: "ACTIVE",
  });

  const assignmentId = randomUUID();
  fixture.assignments.add(assignmentId);
  await db.insert(meterAssignments).values({
    id: assignmentId,
    meterId,
    customerMeterAccountId: accountId,
    initialReading: "0.000",
    assignedAt: now,
    assignedBy: userId,
  });

  return { token, assignmentId };
}

afterEach(async () => {
  if (originalDueDays !== null) {
    await db.update(settings).set({ value: originalDueDays }).where(eq(settings.key, "invoice_due_days"));
  } else {
    await db.delete(settings).where(eq(settings.key, "invoice_due_days"));
  }
  originalDueDays = null;
  if (fixture.readings.size > 0) {
    await db.delete(customerMeterBillings).where(
      inArray(customerMeterBillings.meterReadingId, [...fixture.readings]),
    );
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, [...fixture.readings]));
    await db.delete(meterReadings).where(inArray(meterReadings.id, [...fixture.readings]));
  }
  if (fixture.assignments.size > 0) {
    await db.delete(meterAssignments).where(inArray(meterAssignments.id, [...fixture.assignments]));
  }
  if (fixture.accounts.size > 0) {
    await db.delete(customerMeterAccounts).where(inArray(customerMeterAccounts.id, [...fixture.accounts]));
  }
  if (fixture.meters.size > 0) {
    await db.delete(meters).where(inArray(meters.id, [...fixture.meters]));
  }
  if (fixture.customers.size > 0) {
    await db.delete(customers).where(inArray(customers.id, [...fixture.customers]));
  }
  if (fixture.users.size > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, [...fixture.users]));
    await db.delete(userRoles).where(inArray(userRoles.userId, [...fixture.users]));
    await db.delete(users).where(inArray(users.id, [...fixture.users]));
  }
  for (const set of Object.values(fixture)) set.clear();
});

test("accepted readings use the assignment baseline, reject lower readings and duplicates, and allow approved backdates", async () => {
  assertLocalDatabase();
  const { token, assignmentId } = await createFixture();

  const first = await submitMeterReading(token, {
    meterAssignmentId: assignmentId,
    readingAt: new Date("2026-11-22T10:00:00.000Z"),
    currentReading: "12.500",
    idempotencyKey: `reading-${randomUUID()}`,
    backdatedApprovalReason: null,
    notes: null,
  });
  assert.equal(first.kind, "success");
  if (first.kind !== "success") return;
  fixture.readings.add(first.readingId);
  assert.equal(first.previousReading, "0.000");
  assert.equal(first.consumption, "12.500");
  assert.equal(first.unusualConsumptionFlag, false);
  assert.match(first.invoiceNumber, /^OLO-INV-\d{6,}$/u);
  assert.equal(first.totalAmount, "625.00");

  const duplicate = await submitMeterReading(token, {
    meterAssignmentId: assignmentId,
    readingAt: new Date("2026-11-22T10:00:00.000Z"),
    currentReading: "13.000",
    idempotencyKey: `duplicate-${randomUUID()}`,
    backdatedApprovalReason: null,
    notes: null,
  });
  assert.deepEqual(duplicate, { kind: "duplicate-reading" });

  const decreasing = await submitMeterReading(token, {
    meterAssignmentId: assignmentId,
    readingAt: new Date("2026-11-22T11:00:00.000Z"),
    currentReading: "12.499",
    idempotencyKey: `decreasing-${randomUUID()}`,
    backdatedApprovalReason: null,
    notes: null,
  });
  assert.deepEqual(decreasing, {
    kind: "current-reading-too-low",
    previousReading: "12.500",
  });

  const zeroConsumption = await submitMeterReading(token, {
    meterAssignmentId: assignmentId,
    readingAt: new Date("2026-11-22T12:00:00.000Z"),
    currentReading: "12.500",
    idempotencyKey: `zero-${randomUUID()}`,
    backdatedApprovalReason: null,
    notes: null,
  });
  assert.equal(zeroConsumption.kind, "success");
  if (zeroConsumption.kind === "success") {
    fixture.readings.add(zeroConsumption.readingId);
    assert.equal(zeroConsumption.consumption, "0.000");
    assert.equal(zeroConsumption.unusualConsumptionFlag, true);
    assert.equal(zeroConsumption.totalAmount, "0.00");
  }

  const backdateWithoutApproval = await submitMeterReading(token, {
    meterAssignmentId: assignmentId,
    readingAt: new Date("2026-11-21T10:00:00.000Z"),
    currentReading: "10.000",
    idempotencyKey: `backdate-denied-${randomUUID()}`,
    backdatedApprovalReason: null,
    notes: null,
  });
  assert.deepEqual(backdateWithoutApproval, { kind: "backdated-approval-required" });

  const backdateApproved = await submitMeterReading(token, {
    meterAssignmentId: assignmentId,
    readingAt: new Date("2026-11-21T10:00:00.000Z"),
    currentReading: "10.000",
    idempotencyKey: `backdate-approved-${randomUUID()}`,
    backdatedApprovalReason: "Correcting a late field submission",
    notes: null,
  });
  assert.equal(backdateApproved.kind, "success");
  if (backdateApproved.kind === "success") fixture.readings.add(backdateApproved.readingId);
});
