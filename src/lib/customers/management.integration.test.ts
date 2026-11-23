import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerUserAccess,
  customers,
  invitations,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy } from "@/lib/auth/policy";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/token";
import {
  createCustomer,
  updateCustomer,
} from "./management";
import type { CreateCustomerInput } from "./input";

const fixtureUserIds = new Set<string>();
const fixtureCustomerIds = new Set<string>();
const fixtureInvitationIds = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Customer management tests may only write to a loopback development database.",
  );
}

async function createStaffSession(
  roleKey: "admin" | "meter_reader",
): Promise<{ userId: string; token: string }> {
  assertLocalDatabase();

  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, roleKey))
    .limit(1);
  assert.ok(role, `The development database must be seeded with ${roleKey}.`);

  const userId = randomUUID();
  const token = createOpaqueToken();
  const now = new Date();
  fixtureUserIds.add(userId);

  await db.insert(users).values({
    id: userId,
    fullName: "Customer Management Test",
    email: `customer-management-${userId}@example.test`,
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

async function createPortalUser(
  email: string,
  status: "active" | "invited",
): Promise<string> {
  const userId = randomUUID();
  fixtureUserIds.add(userId);
  await db.insert(users).values({
    id: userId,
    fullName: "Customer Portal Test",
    email,
    accountType: "customer",
    status,
    emailVerifiedAt: status === "active" ? new Date() : null,
  });
  return userId;
}

function newCustomerInput(email: string): CreateCustomerInput {
  return {
    customerType: "individual",
    fullName: "Customer Management Target",
    phone: "0700000000",
    email,
    physicalAddress: null,
    locationDescription: null,
    notes: null,
  };
}

async function createManagedCustomer(
  token: string,
  email: string,
): Promise<string> {
  const result = await createCustomer(token, newCustomerInput(email));
  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("Expected customer creation to succeed.");
  }
  fixtureCustomerIds.add(result.customerId);
  return result.customerId;
}

async function cleanupFixtures(): Promise<void> {
  const customerIds = [...fixtureCustomerIds];
  if (customerIds.length > 0) {
    await db
      .delete(invitations)
      .where(inArray(invitations.customerId, customerIds));
    await db
      .delete(customerUserAccess)
      .where(inArray(customerUserAccess.customerId, customerIds));
    await db.delete(customers).where(inArray(customers.id, customerIds));
  }

  if (fixtureInvitationIds.size > 0) {
    await db
      .delete(invitations)
      .where(inArray(invitations.id, [...fixtureInvitationIds]));
  }
  if (fixtureUserIds.size > 0) {
    await db.delete(sessions).where(inArray(sessions.userId, [...fixtureUserIds]));
    await db.delete(userRoles).where(inArray(userRoles.userId, [...fixtureUserIds]));
    await db.delete(users).where(inArray(users.id, [...fixtureUserIds]));
  }

  fixtureCustomerIds.clear();
  fixtureInvitationIds.clear();
  fixtureUserIds.clear();
}

afterEach(cleanupFixtures);

test("customer management creates numbered records and updates allowed fields", async () => {
  const actor = await createStaffSession("admin");
  const email = `customer-${randomUUID()}@example.test`;
  const result = await createCustomer(actor.token, newCustomerInput(email));

  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("Expected customer creation to succeed.");
  }

  fixtureCustomerIds.add(result.customerId);
  assert.match(result.customerNumber ?? "", /^OLO-\d{6,}$/u);
  assert.equal(result.status, "active");

  const updatedEmail = `updated-${randomUUID()}@example.test`;
  const updateResult = await updateCustomer(actor.token, result.customerId, {
    email: updatedEmail,
    physicalAddress: "Updated address",
    status: "inactive",
  });
  assert.equal(updateResult.kind, "success");

  const [customer] = await db
    .select({
      customerNumber: customers.customerNumber,
      email: customers.email,
      physicalAddress: customers.physicalAddress,
      status: customers.status,
    })
    .from(customers)
    .where(eq(customers.id, result.customerId))
    .limit(1);

  assert.equal(customer?.customerNumber, result.customerNumber);
  assert.equal(customer?.email, updatedEmail);
  assert.equal(customer?.physicalAddress, "Updated address");
  assert.equal(customer?.status, "inactive");

  const otherCustomerId = await createManagedCustomer(
    actor.token,
    `other-${randomUUID()}@example.test`,
  );
  const duplicateResult = await createCustomer(
    actor.token,
    newCustomerInput(updatedEmail.toUpperCase()),
  );
  assert.deepEqual(duplicateResult, { kind: "conflict" });
  const duplicateUpdateResult = await updateCustomer(actor.token, otherCustomerId, {
    email: updatedEmail.toUpperCase(),
  });
  assert.deepEqual(duplicateUpdateResult, { kind: "conflict" });
});

test("customer writes require customers.manage", async () => {
  const actor = await createStaffSession("meter_reader");
  const result = await createCustomer(
    actor.token,
    newCustomerInput(`denied-${randomUUID()}@example.test`),
  );

  assert.deepEqual(result, { kind: "forbidden" });
});

test("customer email cannot change with an active portal link or pending invitation", async () => {
  const actor = await createStaffSession("admin");
  const linkedCustomerId = await createManagedCustomer(
    actor.token,
    `linked-${randomUUID()}@example.test`,
  );
  const [linkedCustomer] = await db
    .select({ email: customers.email })
    .from(customers)
    .where(eq(customers.id, linkedCustomerId))
    .limit(1);
  assert.ok(linkedCustomer);
  const linkedPortalUserId = await createPortalUser(linkedCustomer.email, "active");
  await db.insert(customerUserAccess).values({
    userId: linkedPortalUserId,
    customerId: linkedCustomerId,
    grantedBy: actor.userId,
  });

  const linkedResult = await updateCustomer(actor.token, linkedCustomerId, {
    email: `linked-update-${randomUUID()}@example.test`,
  });
  assert.deepEqual(linkedResult, { kind: "email-change-restricted" });

  const pendingEmail = `pending-${randomUUID()}@example.test`;
  const pendingCustomerId = await createManagedCustomer(actor.token, pendingEmail);
  const pendingPortalUserId = await createPortalUser(pendingEmail, "invited");
  const [customerRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, "customer"))
    .limit(1);
  assert.ok(customerRole);

  const pendingInvitationId = randomUUID();
  fixtureInvitationIds.add(pendingInvitationId);
  const now = new Date();
  await db.insert(invitations).values({
    id: pendingInvitationId,
    userId: pendingPortalUserId,
    roleId: customerRole.id,
    customerId: pendingCustomerId,
    invitedEmail: pendingEmail,
    tokenHash: hashOpaqueToken(createOpaqueToken()),
    invitedBy: actor.userId,
    status: "pending",
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  });

  const pendingResult = await updateCustomer(actor.token, pendingCustomerId, {
    email: `pending-update-${randomUUID()}@example.test`,
  });
  assert.deepEqual(pendingResult, { kind: "email-change-restricted" });
});
