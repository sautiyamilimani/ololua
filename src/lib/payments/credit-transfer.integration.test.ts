import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerAccountCreditEntries,
  customerAccountCreditTransfers,
  customerMeterAccounts,
  customers,
  roles,
  serviceVariants,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy } from "@/lib/auth/policy";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/token";
import { transferCreditInstantly } from "./credit-transfer";
import {
  confirmCrossCustomerTransfer,
  expirePendingCreditTransfers,
  requestCrossCustomerTransfer,
  revokeCrossCustomerTransfer,
} from "./credit-transfer";

const ids = {
  users: new Set<string>(),
  customers: new Set<string>(),
  accounts: new Set<string>(),
  transfers: new Set<string>(),
};

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl);
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname));
}

async function createFixture(sameCustomer: boolean) {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, "admin"))
    .limit(1);
  const [variant] = await db
    .select({ id: serviceVariants.id })
    .from(serviceVariants)
    .where(eq(serviceVariants.status, "ACTIVE"))
    .limit(1);
  assert.ok(role && variant);

  const now = new Date();
  const userId = randomUUID();
  const token = createOpaqueToken();
  ids.users.add(userId);
  await db.insert(users).values({
    id: userId,
    fullName: "Credit Transfer Test",
    email: `credit-transfer-${userId}@example.test`,
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
    fullName: "Transfer Customer",
    phone: "0700000006",
    email: `transfer-${randomUUID()}@example.test`,
    status: "active",
  });

  const secondCustomerId = sameCustomer
    ? customerId
    : randomUUID();
  if (!sameCustomer) {
    ids.customers.add(secondCustomerId);
    await db.insert(customers).values({
      id: secondCustomerId,
      customerNumber: `TEST-${randomUUID().slice(0, 8)}`,
      customerType: "individual",
      fullName: "Other Transfer Customer",
      phone: "0700000007",
      email: `other-transfer-${randomUUID()}@example.test`,
      status: "active",
    });
  }

  const sourceId = randomUUID();
  const destinationId = randomUUID();
  ids.accounts.add(sourceId);
  ids.accounts.add(destinationId);
  await db.insert(customerMeterAccounts).values([
    {
      id: sourceId,
      accountNumber: `TEST-ACC-${randomUUID().slice(0, 8)}`,
      customerId,
      serviceVariantId: variant.id,
      zoneId: null,
      status: "ACTIVE",
    },
    {
      id: destinationId,
      accountNumber: `TEST-ACC-${randomUUID().slice(0, 8)}`,
      customerId: secondCustomerId,
      serviceVariantId: variant.id,
      zoneId: null,
      status: "ACTIVE",
    },
  ]);

  await db.insert(customerAccountCreditEntries).values({
    customerMeterAccountId: sourceId,
    entryType: "PAYMENT_CREDIT",
    amount: "100.00",
    idempotencyKey: `credit-fixture:${sourceId}`,
  });

  return { token, sourceId, destinationId };
}

afterEach(async () => {
  if (ids.transfers.size > 0) {
    await db.delete(customerAccountCreditEntries).where(
      inArray(customerAccountCreditEntries.transferId, [...ids.transfers]),
    );
  }
  await db.delete(customerAccountCreditEntries).where(
    inArray(
      customerAccountCreditEntries.customerMeterAccountId,
      [...ids.accounts],
    ),
  );
  if (ids.transfers.size > 0) {
    await db.delete(customerAccountCreditTransfers).where(
      inArray(customerAccountCreditTransfers.id, [...ids.transfers]),
    );
  }
  if (ids.accounts.size > 0) {
    await db.delete(customerMeterAccounts).where(
      inArray(customerMeterAccounts.id, [...ids.accounts]),
    );
  }
  if (ids.customers.size > 0) {
    await db.delete(customers).where(inArray(customers.id, [...ids.customers]));
  }
  if (ids.users.size > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, [...ids.users]));
    await db.delete(userRoles).where(inArray(userRoles.userId, [...ids.users]));
    await db.delete(users).where(inArray(users.id, [...ids.users]));
  }
  for (const set of Object.values(ids)) set.clear();
});

test("same-customer instant transfer succeeds and insufficient credit is rejected", async () => {
  assertLocalDatabase();
  const fixture = await createFixture(true);

  const result = await transferCreditInstantly(
    fixture.token,
    fixture.sourceId,
    fixture.destinationId,
    "40.00",
  );
  assert.equal(result.kind, "success");
  if (result.kind === "success") ids.transfers.add(result.transferId);

  const insufficient = await transferCreditInstantly(
    fixture.token,
    fixture.sourceId,
    fixture.destinationId,
    "70.00",
  );
  assert.deepEqual(insufficient, { kind: "insufficient-credit" });
});

test("cross-customer instant transfer is rejected", async () => {
  assertLocalDatabase();
  const fixture = await createFixture(false);

  const result = await transferCreditInstantly(
    fixture.token,
    fixture.sourceId,
    fixture.destinationId,
    "40.00",
  );
  assert.deepEqual(result, { kind: "different-customers" });
});

test("cross-customer transfer stays pending until sender and recipient confirm", async () => {
  assertLocalDatabase();
  const fixture = await createFixture(false);

  const requested = await requestCrossCustomerTransfer(
    fixture.token,
    fixture.sourceId,
    fixture.destinationId,
    "40.00",
  );
  assert.equal(requested.kind, "success");
  if (requested.kind !== "success") return;
  ids.transfers.add(requested.transferId);

  const sender = await confirmCrossCustomerTransfer(
    "sender",
    requested.senderToken,
  );
  assert.deepEqual(sender, {
    kind: "success",
    transferId: requested.transferId,
    status: "PENDING",
  });

  const recipient = await confirmCrossCustomerTransfer(
    "recipient",
    requested.recipientToken,
  );
  assert.deepEqual(recipient, {
    kind: "success",
    transferId: requested.transferId,
    status: "CONFIRMED",
  });
});

test("initiating staff can revoke a pending transfer without ledger movement", async () => {
  assertLocalDatabase();
  const fixture = await createFixture(false);

  const requested = await requestCrossCustomerTransfer(
    fixture.token,
    fixture.sourceId,
    fixture.destinationId,
    "40.00",
  );
  assert.equal(requested.kind, "success");
  if (requested.kind !== "success") return;
  ids.transfers.add(requested.transferId);

  const revoked = await revokeCrossCustomerTransfer(
    fixture.token,
    requested.transferId,
    "Destination details changed",
  );
  assert.equal(revoked.kind, "success");

  const [transfer] = await db
    .select({ status: customerAccountCreditTransfers.status })
    .from(customerAccountCreditTransfers)
    .where(eq(customerAccountCreditTransfers.id, requested.transferId))
    .limit(1);
  assert.equal(transfer?.status, "REVOKED");

  const ledgerEntries = await db
    .select({ id: customerAccountCreditEntries.id })
    .from(customerAccountCreditEntries)
    .where(eq(customerAccountCreditEntries.transferId, requested.transferId));
  assert.equal(ledgerEntries.length, 0);
});

test("expiry marks overdue pending transfers and creates no ledger entries", async () => {
  assertLocalDatabase();
  const fixture = await createFixture(false);

  const requested = await requestCrossCustomerTransfer(
    fixture.token,
    fixture.sourceId,
    fixture.destinationId,
    "40.00",
  );
  assert.equal(requested.kind, "success");
  if (requested.kind !== "success") return;
  ids.transfers.add(requested.transferId);

  await db
    .update(customerAccountCreditTransfers)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(customerAccountCreditTransfers.id, requested.transferId));

  const expired = await expirePendingCreditTransfers(fixture.token);
  assert.equal(expired.kind, "success");
  if (expired.kind === "success") assert.ok(expired.expiredCount >= 1);

  const [transfer] = await db
    .select({ status: customerAccountCreditTransfers.status })
    .from(customerAccountCreditTransfers)
    .where(eq(customerAccountCreditTransfers.id, requested.transferId))
    .limit(1);
  assert.equal(transfer?.status, "EXPIRED");

  const ledgerEntries = await db
    .select({ id: customerAccountCreditEntries.id })
    .from(customerAccountCreditEntries)
    .where(eq(customerAccountCreditEntries.transferId, requested.transferId));
  assert.equal(ledgerEntries.length, 0);
});
