import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerAccountCreditEntries,
  customerMeterAccounts,
  customerMeterBillings,
  customerMeterPaymentAllocations,
  customerMeterPayments,
  customers,
  meterAssignments,
  meterReadings,
  meters,
  paymentAllocationReversals,
  paymentReversals,
  roles,
  serviceTariffs,
  serviceVariants,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy } from "@/lib/auth/policy";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/token";
import { recordPayment } from "./management";
import { reversePayment } from "./reversal";

const ids = {
  users: new Set<string>(),
  customers: new Set<string>(),
  accounts: new Set<string>(),
  meters: new Set<string>(),
  assignments: new Set<string>(),
  readings: new Set<string>(),
  bills: new Set<string>(),
  payments: new Set<string>(),
};

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname));
}

async function createFixture(): Promise<{
  token: string;
  accountId: string;
  oldestBillingId: string;
  secondBillingId: string;
}> {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.roleKey, "admin")).limit(1);
  const [variant] = await db.select({ id: serviceVariants.id }).from(serviceVariants).where(eq(serviceVariants.status, "ACTIVE")).limit(1);
  const [tariff] = await db.select({ id: serviceTariffs.id, rate: serviceTariffs.rate }).from(serviceTariffs).where(eq(serviceTariffs.status, "ACTIVE")).limit(1);
  assert.ok(role && variant && tariff);

  const now = new Date();
  const userId = randomUUID();
  const token = createOpaqueToken();
  ids.users.add(userId);
  await db.insert(users).values({
    id: userId,
    fullName: "Payment Test",
    email: `payment-${userId}@example.test`,
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
  ids.customers.add(customerId);
  await db.insert(customers).values({
    id: customerId,
    customerNumber: `TEST-${randomUUID().slice(0, 8)}`,
    customerType: "individual",
    fullName: "Payment Fixture",
    phone: "0700000005",
    email: `payment-fixture-${randomUUID()}@example.test`,
    status: "active",
  });

  const accountId = randomUUID();
  ids.accounts.add(accountId);
  await db.insert(customerMeterAccounts).values({
    id: accountId,
    accountNumber: `TEST-ACC-${randomUUID().slice(0, 8)}`,
    customerId,
    serviceVariantId: variant.id,
    zoneId: null,
    status: "ACTIVE",
  });

  const meterId = randomUUID();
  ids.meters.add(meterId);
  await db.insert(meters).values({
    id: meterId,
    serialNumber: `TEST-METER-${randomUUID()}`,
    status: "ACTIVE",
  });

  const assignmentId = randomUUID();
  ids.assignments.add(assignmentId);
  await db.insert(meterAssignments).values({
    id: assignmentId,
    meterId,
    customerMeterAccountId: accountId,
    initialReading: "0.000",
    assignedAt: new Date("2026-11-01T00:00:00.000Z"),
  });

  const billIds: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const readingId = randomUUID();
    ids.readings.add(readingId);
    await db.insert(meterReadings).values({
      id: readingId,
      meterAssignmentId: assignmentId,
      readingAt: new Date(index === 0 ? "2026-11-02T00:00:00.000Z" : "2026-11-03T00:00:00.000Z"),
      previousReading: index === 0 ? "0.000" : "1.000",
      currentReading: index === 0 ? "1.000" : "2.000",
      consumption: "1.000",
      submittedBy: userId,
      idempotencyKey: `payment-fixture-${randomUUID()}`,
      unusualConsumptionFlag: false,
    });

    const billingId = randomUUID();
    ids.bills.add(billingId);
    billIds.push(billingId);
    await db.insert(customerMeterBillings).values({
      id: billingId,
      invoiceNumber: `TEST-INV-${randomUUID().slice(0, 8)}`,
      customerMeterAccountId: accountId,
      meterReadingId: readingId,
      serviceTariffId: tariff.id,
      billingPeriodStart: index === 0 ? "2026-11-01" : "2026-11-02",
      billingPeriodEnd: index === 0 ? "2026-11-02" : "2026-11-03",
      previousReading: index === 0 ? "0.000" : "1.000",
      currentReading: index === 0 ? "1.000" : "2.000",
      consumption: "1.000",
      tariffRate: tariff.rate,
      totalAmount: "100.00",
      issuedAt: new Date(index === 0 ? "2026-11-02T00:00:00.000Z" : "2026-11-03T00:00:00.000Z"),
      dueDate: "2026-12-03",
      status: "UNPAID",
    });
  }

  return {
    token,
    accountId,
    oldestBillingId: billIds[0],
    secondBillingId: billIds[1],
  };
}

afterEach(async () => {
  if (ids.payments.size > 0) {
    await db.delete(paymentAllocationReversals).where(
      inArray(paymentAllocationReversals.paymentId, [...ids.payments]),
    );
    await db.delete(paymentReversals).where(
      inArray(paymentReversals.paymentId, [...ids.payments]),
    );
    await db.delete(customerAccountCreditEntries).where(
      inArray(customerAccountCreditEntries.paymentId, [...ids.payments]),
    );
  }
  if (ids.payments.size > 0) {
    await db.delete(customerMeterPaymentAllocations).where(
      inArray(customerMeterPaymentAllocations.paymentId, [...ids.payments]),
    );
    await db.delete(customerMeterPayments).where(
      inArray(customerMeterPayments.id, [...ids.payments]),
    );
  }
  if (ids.bills.size > 0) {
    await db.delete(customerMeterBillings).where(inArray(customerMeterBillings.id, [...ids.bills]));
  }
  if (ids.readings.size > 0) {
    await db.delete(meterReadings).where(inArray(meterReadings.id, [...ids.readings]));
  }
  if (ids.assignments.size > 0) {
    await db.delete(meterAssignments).where(inArray(meterAssignments.id, [...ids.assignments]));
  }
  if (ids.meters.size > 0) await db.delete(meters).where(inArray(meters.id, [...ids.meters]));
  if (ids.accounts.size > 0) await db.delete(customerMeterAccounts).where(inArray(customerMeterAccounts.id, [...ids.accounts]));
  if (ids.customers.size > 0) await db.delete(customers).where(inArray(customers.id, [...ids.customers]));
  if (ids.users.size > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, [...ids.users]));
    await db.delete(userRoles).where(inArray(userRoles.userId, [...ids.users]));
    await db.delete(users).where(inArray(users.id, [...ids.users]));
  }
  for (const set of Object.values(ids)) set.clear();
});

test("payments allocate oldest-first and retain unallocated standing credit", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();

  const auto = await recordPayment(fixture.token, {
    customerMeterAccountId: fixture.accountId,
    amount: "250.00",
    paymentMethod: "mpesa",
    externalReference: null,
    payerPhone: null,
    notes: null,
    allocations: null,
  });
  assert.equal(auto.kind, "success");
  if (auto.kind === "success") {
    ids.payments.add(auto.paymentId);
    assert.equal(auto.allocatedAmount, "200.00");
    assert.equal(auto.unallocatedAmount, "50.00");

    const reversed = await reversePayment(
      fixture.token,
      auto.paymentId,
      "Payment returned",
    );
    assert.equal(reversed.kind, "success");
    if (reversed.kind === "success") {
      assert.equal(reversed.reversedAllocationAmount, "200.00");
      assert.equal(reversed.restoredCreditAmount, "50.00");
    }

    const reversedBills = await db
      .select({ status: customerMeterBillings.status })
      .from(customerMeterBillings)
      .where(inArray(customerMeterBillings.id, [
        fixture.oldestBillingId,
        fixture.secondBillingId,
      ]));
    assert.deepEqual(
      reversedBills.map((row) => row.status).sort(),
      ["UNPAID", "UNPAID"],
    );
  }

  const credit = await recordPayment(fixture.token, {
    customerMeterAccountId: fixture.accountId,
    amount: "75.00",
    paymentMethod: "cash",
    externalReference: null,
    payerPhone: null,
    notes: null,
    allocations: [],
  });
  assert.equal(credit.kind, "success");
  if (credit.kind === "success") ids.payments.add(credit.paymentId);
});
