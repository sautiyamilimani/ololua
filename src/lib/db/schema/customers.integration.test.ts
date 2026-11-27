import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerEmailVerificationTokens } from "./customer-email-verification-tokens";
import { customers } from "./customers";

const fixtureCustomerIds = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Customer schema tests may only write to a loopback development database.",
  );
}

function isCustomerEmailUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return false;
  }

  const cause = error.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    cause.constraint === "customers_email_lower_unique"
  );
}

function incrementDecimal(value: string): string {
  const digits = [...value];

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== "9") {
      digits[index] = String(Number(digits[index]) + 1);
      return digits.join("");
    }

    digits[index] = "0";
  }

  return `1${digits.join("")}`;
}

function compareDecimal(leftValue: string, rightValue: string): number {
  const left = leftValue.replace(/^0+(?=\d)/u, "");
  const right = rightValue.replace(/^0+(?=\d)/u, "");

  if (left.length !== right.length) {
    return left.length - right.length;
  }

  return left.localeCompare(right);
}

afterEach(async () => {
  if (fixtureCustomerIds.size > 0) {
    await db
      .delete(customerEmailVerificationTokens)
      .where(
        inArray(customerEmailVerificationTokens.customerId, [
          ...fixtureCustomerIds,
        ]),
      );
    await db
      .delete(customers)
      .where(inArray(customers.id, [...fixtureCustomerIds]));
    fixtureCustomerIds.clear();
  }
});

function hasPostgresConstraint(
  error: unknown,
  code: string,
  constraintName: string,
): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    if (
      "code" in candidate &&
      candidate.code === code &&
      "constraint" in candidate &&
      candidate.constraint === constraintName
    ) {
      return true;
    }
    candidate = "cause" in candidate ? candidate.cause : null;
  }
  return false;
}

test("customer email unique index accepts a valid row and rejects case variants", async () => {
  assertLocalDatabase();

  const fixtureKey = randomUUID();
  const validCustomerId = randomUUID();
  const duplicateCustomerId = randomUUID();
  fixtureCustomerIds.add(validCustomerId);
  fixtureCustomerIds.add(duplicateCustomerId);

  await db.insert(customers).values({
    id: validCustomerId,
    customerNumber: `TEST-${fixtureKey.slice(0, 12)}`,
    customerType: "individual",
    fullName: "Customer Email Constraint Test",
    phone: "0700000001",
    email: `Customer.${fixtureKey}@example.test`,
    status: "active",
  });

  await assert.rejects(
    db.insert(customers).values({
      id: duplicateCustomerId,
      customerNumber: `TEST-${fixtureKey.slice(12, 24)}`,
      customerType: "business",
      fullName: "Duplicate Customer Email Test",
      phone: "0700000002",
      email: `customer.${fixtureKey.toLowerCase()}@EXAMPLE.TEST`,
      status: "active",
    }),
    isCustomerEmailUniqueViolation,
  );

  const indexResult = await db.execute<{ indexdef: string }>(sql`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'customers'
      AND indexname = 'customers_email_lower_unique'
  `);
  const index = indexResult.rows[0];

  assert.ok(index);
  assert.match(index.indexdef, /CREATE UNIQUE INDEX .*lower/iu);
});

test("customer verification token constraints accept valid rows and reject duplicates, bad expiry, and missing customers", async () => {
  assertLocalDatabase();

  const fixtureKey = randomUUID();
  const customerId = randomUUID();
  const expiryCustomerId = randomUUID();
  fixtureCustomerIds.add(customerId);
  fixtureCustomerIds.add(expiryCustomerId);
  const now = new Date();
  const validTokenId = randomUUID();

  await db.insert(customers).values([
    {
      id: customerId,
      customerNumber: `VFY-${fixtureKey.slice(0, 12)}`,
      customerType: "individual",
      fullName: "Email Verification Constraint Test",
      phone: "0700000003",
      email: `verification-${fixtureKey}@example.test`,
      status: "active",
    },
    {
      id: expiryCustomerId,
      customerNumber: `VFY-${fixtureKey.slice(12, 24)}`,
      customerType: "business",
      fullName: "Email Verification Expiry Test",
      phone: "0700000004",
      email: `verification-expiry-${fixtureKey}@example.test`,
      status: "active",
    },
  ]);
  await db.insert(customerEmailVerificationTokens).values({
    id: validTokenId,
    customerId,
    email: `verification-${fixtureKey}@example.test`,
    tokenHash: randomUUID(),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  });

  await assert.rejects(
    db.insert(customerEmailVerificationTokens).values({
      customerId,
      email: `verification-${fixtureKey}@example.test`,
      tokenHash: randomUUID(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    }),
    (error: unknown) =>
      hasPostgresConstraint(
        error,
        "23505",
        "customer_email_verification_tokens_active_customer_unique",
      ),
  );
  await assert.rejects(
    db.insert(customerEmailVerificationTokens).values({
      customerId: expiryCustomerId,
      email: `verification-expiry-${fixtureKey}@example.test`,
      tokenHash: randomUUID(),
      createdAt: now,
      expiresAt: new Date(now.getTime() - 1),
    }),
    (error: unknown) =>
      hasPostgresConstraint(
        error,
        "23514",
        "customer_email_verification_tokens_expiry_check",
      ),
  );
  await assert.rejects(
    db.insert(customerEmailVerificationTokens).values({
      customerId: randomUUID(),
      email: `missing-${fixtureKey}@example.test`,
      tokenHash: randomUUID(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    }),
    (error: unknown) =>
      hasPostgresConstraint(
        error,
        "23503",
        "customer_email_verification_tokens_customer_id_customers_id_fk",
      ),
  );
});

test("customer number sequence starts after existing OLO numbers and advances", async () => {
  assertLocalDatabase();

  const [existingNumber] = (
    await db.execute<{ max_number: string | null }>(sql`
      SELECT MAX(substring("customer_number" FROM 5)::bigint)::text AS max_number
      FROM "customers"
      WHERE "customer_number" ~ '^OLO-[0-9]{6,}$'
    `)
  ).rows;
  const [firstValue] = (
    await db.execute<{ next_value: string }>(sql`
      SELECT nextval('public.customers_customer_number_seq')::text AS next_value
    `)
  ).rows;
  const [secondValue] = (
    await db.execute<{ next_value: string }>(sql`
      SELECT nextval('public.customers_customer_number_seq')::text AS next_value
    `)
  ).rows;

  assert.ok(firstValue);
  assert.ok(secondValue);
  const expectedFirst = incrementDecimal(existingNumber?.max_number ?? "0");

  assert.ok(compareDecimal(firstValue.next_value, expectedFirst) >= 0);
  assert.equal(secondValue.next_value, incrementDecimal(firstValue.next_value));
  assert.match(
    `OLO-${firstValue.next_value.padStart(6, "0")}`,
    /^OLO-\d{6,}$/u,
  );
});
