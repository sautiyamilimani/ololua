import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMeterAccounts,
  customers,
  serviceVariants,
} from "@/lib/db/schema";
import { createCustomerMeterAccount } from "./management";

const fixtureCustomerIds = new Set<string>();
const fixtureAccountIds = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Customer meter account tests may only write to a loopback development database.",
  );
}

async function createFixtureCustomer(status: "active" | "inactive" = "active") {
  const id = randomUUID();
  fixtureCustomerIds.add(id);
  await db.insert(customers).values({
    id,
    customerNumber: `TEST-${randomUUID().slice(0, 8)}`,
    customerType: "individual",
    fullName: "Account Relationship Test",
    phone: "0700000001",
    email: `account-${randomUUID()}@example.test`,
    status,
  });
  return id;
}

async function findActiveVariant(): Promise<string> {
  const [variant] = await db
    .select({ id: serviceVariants.id })
    .from(serviceVariants)
    .where(eq(serviceVariants.status, "ACTIVE"))
    .limit(1);
  assert.ok(variant, "The development database must contain an active service variant.");
  return variant.id;
}

async function findDomesticVariant(): Promise<string> {
  const [variant] = await db
    .select({ id: serviceVariants.id })
    .from(serviceVariants)
    .where(
      and(
        eq(serviceVariants.status, "ACTIVE"),
        sql`upper(${serviceVariants.variantCode}) like '%DOMESTIC%'`,
      ),
    )
    .limit(1);
  assert.ok(variant, "The development database must contain an active Domestic Water variant.");
  return variant.id;
}

afterEach(async () => {
  if (fixtureAccountIds.size > 0) {
    await db
      .delete(customerMeterAccounts)
      .where(inArray(customerMeterAccounts.id, [...fixtureAccountIds]));
  }
  if (fixtureCustomerIds.size > 0) {
    await db
      .delete(customers)
      .where(inArray(customers.id, [...fixtureCustomerIds]));
  }
  fixtureAccountIds.clear();
  fixtureCustomerIds.clear();
});

test("account creation generates a numbered active account for an active customer", async () => {
  assertLocalDatabase();
  const customerId = await createFixtureCustomer();
  const serviceVariantId = await findActiveVariant();

  const result = await createCustomerMeterAccount({
    customerId,
    serviceVariantId,
    zoneId: null,
    notes: null,
  });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("Expected account creation to succeed.");
  }
  fixtureAccountIds.add(result.accountId);
  assert.match(result.accountNumber, /^OLO-\d{6,}$/u);

  const [account] = await db
    .select({
      customerId: customerMeterAccounts.customerId,
      status: customerMeterAccounts.status,
    })
    .from(customerMeterAccounts)
    .where(eq(customerMeterAccounts.id, result.accountId))
    .limit(1);

  assert.equal(account?.customerId, customerId);
  assert.equal(account?.status, "ACTIVE");
});

test("account creation rejects inactive customers", async () => {
  assertLocalDatabase();
  const customerId = await createFixtureCustomer("inactive");
  const serviceVariantId = await findActiveVariant();

  const result = await createCustomerMeterAccount({
    customerId,
    serviceVariantId,
    zoneId: null,
    notes: null,
  });

  assert.deepEqual(result, { kind: "customer-inactive" });
});

test("a customer can have only one non-closed Domestic Water account", async () => {
  assertLocalDatabase();
  const customerId = await createFixtureCustomer();
  const serviceVariantId = await findDomesticVariant();

  const first = await createCustomerMeterAccount({
    customerId,
    serviceVariantId,
    zoneId: null,
    notes: null,
  });
  assert.equal(first.kind, "success");
  if (first.kind !== "success") {
    throw new Error("Expected the first Domestic Water account to be created.");
  }
  fixtureAccountIds.add(first.accountId);

  const duplicate = await createCustomerMeterAccount({
    customerId,
    serviceVariantId,
    zoneId: null,
    notes: null,
  });
  assert.deepEqual(duplicate, { kind: "domestic-account-exists" });
});

test("a closed Domestic Water account does not block a new account", async () => {
  assertLocalDatabase();
  const customerId = await createFixtureCustomer();
  const serviceVariantId = await findDomesticVariant();

  const first = await createCustomerMeterAccount({
    customerId,
    serviceVariantId,
    zoneId: null,
    notes: null,
  });
  assert.equal(first.kind, "success");
  if (first.kind !== "success") {
    throw new Error("Expected the first Domestic Water account to be created.");
  }
  fixtureAccountIds.add(first.accountId);

  await db
    .update(customerMeterAccounts)
    .set({ status: "CLOSED" })
    .where(eq(customerMeterAccounts.id, first.accountId));

  const second = await createCustomerMeterAccount({
    customerId,
    serviceVariantId,
    zoneId: null,
    notes: null,
  });
  assert.equal(second.kind, "success");
  if (second.kind === "success") {
    fixtureAccountIds.add(second.accountId);
  }
});

test("account number sequence advances by one and gaps remain allowed", async () => {
  assertLocalDatabase();
  const [first] = await db.execute<{ next_value: string }>(
    sql`SELECT nextval('public.customer_meter_accounts_account_number_seq')::text AS next_value`,
  ).then((result) => result.rows);
  const [second] = await db.execute<{ next_value: string }>(
    sql`SELECT nextval('public.customer_meter_accounts_account_number_seq')::text AS next_value`,
  ).then((result) => result.rows);

  assert.ok(first && second);
  assert.equal(Number(second.next_value), Number(first.next_value) + 1);
});
