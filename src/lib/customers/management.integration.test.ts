import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerMeterAccounts,
  customerUserAccess,
  customers,
  invitations,
  roles,
  serviceVariants,
  sessions,
  staffCustomerAccess,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy } from "@/lib/auth/policy";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/auth/token";
import {
  createCustomer,
  deleteCustomer,
  linkStaffCustomerAccess,
  revokeStaffCustomerAccess,
  updateCustomer,
} from "./management";
import type { CreateCustomerInput } from "./input";

const fixtureUserIds = new Set<string>();
const fixtureCustomerIds = new Set<string>();
const fixtureCustomerAccountIds = new Set<string>();
const fixtureInvitationIds = new Set<string>();
const fixtureStaffCustomerAccessIds = new Set<string>();

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

function isCustomerAccessForeignKeyViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    if (
      "message" in candidate &&
      typeof candidate.message === "string" &&
      candidate.message.includes(
        "customer_user_access_customer_id_customers_id_fk",
      )
    ) {
      return true;
    }
    candidate = "cause" in candidate ? candidate.cause : null;
  }
  return false;
}

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
    if (
      "message" in candidate &&
      typeof candidate.message === "string" &&
      candidate.message.includes(constraintName)
    ) {
      return true;
    }
    candidate = "cause" in candidate ? candidate.cause : null;
  }
  return false;
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

async function createServiceAccount(customerId: string): Promise<void> {
  const [variant] = await db
    .select({ id: serviceVariants.id })
    .from(serviceVariants)
    .where(eq(serviceVariants.status, "ACTIVE"))
    .limit(1);
  assert.ok(variant, "The development database must have an active service variant.");

  const accountId = randomUUID();
  fixtureCustomerAccountIds.add(accountId);
  await db.insert(customerMeterAccounts).values({
    id: accountId,
    accountNumber: `TEST-${randomUUID().replace(/-/gu, "").slice(0, 20)}`,
    customerId,
    serviceVariantId: variant.id,
    propertyAddress: "Customer deletion integration fixture",
    status: "ACTIVE",
  });
}

async function cleanupFixtures(): Promise<void> {
  const customerIds = [...fixtureCustomerIds];
  if (customerIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "customer.delete"),
          inArray(auditLogs.entityId, customerIds),
        ),
      );
  }
  if (fixtureStaffCustomerAccessIds.size > 0) {
    await db
      .delete(auditLogs)
      .where(
        and(
          inArray(auditLogs.action, [
            "staff_customer_access.link",
            "staff_customer_access.revoke",
          ]),
          inArray(auditLogs.entityId, [...fixtureStaffCustomerAccessIds]),
        ),
      );
  }
  if (fixtureCustomerAccountIds.size > 0) {
    await db
      .delete(customerMeterAccounts)
      .where(inArray(customerMeterAccounts.id, [...fixtureCustomerAccountIds]));
  }
  if (customerIds.length > 0) {
    await db
      .delete(invitations)
      .where(inArray(invitations.customerId, customerIds));
    await db
      .delete(customerUserAccess)
      .where(inArray(customerUserAccess.customerId, customerIds));
  }
  if (fixtureStaffCustomerAccessIds.size > 0) {
    await db
      .delete(staffCustomerAccess)
      .where(inArray(staffCustomerAccess.id, [...fixtureStaffCustomerAccessIds]));
  }
  if (customerIds.length > 0) {
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
  fixtureCustomerAccountIds.clear();
  fixtureInvitationIds.clear();
  fixtureStaffCustomerAccessIds.clear();
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
  assert.deepEqual(
    await linkStaffCustomerAccess(actor.token, actor.userId, randomUUID()),
    { kind: "forbidden" },
  );
});

test("customer deletion soft-deletes the customer and keeps an audit record", async () => {
  const actor = await createStaffSession("admin");
  const customerId = await createManagedCustomer(
    actor.token,
    `delete-${randomUUID()}@example.test`,
  );

  const result = await deleteCustomer(actor.token, customerId);
  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("Expected an unlinked customer to be deleted.");
  }

  const [customer] = await db
    .select({
      id: customers.id,
      status: customers.status,
      isTrashed: customers.isTrashed,
      trashedAt: customers.trashedAt,
      trashedBy: customers.trashedBy,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  assert.equal(customer?.status, "inactive");
  assert.equal(customer?.isTrashed, true);
  assert.ok(customer?.trashedAt);
  assert.equal(customer?.trashedBy, actor.userId);

  const [audit] = await db
    .select({
      actorUserId: auditLogs.actorUserId,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
    })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, customerId))
    .limit(1);
  assert.deepEqual(audit, {
    actorUserId: actor.userId,
    action: "customer.delete",
    entityType: "customer",
    entityId: customerId,
  });
});

test("customer deletion retains a linked service account", async () => {
  const actor = await createStaffSession("admin");
  const customerId = await createManagedCustomer(
    actor.token,
    `account-linked-${randomUUID()}@example.test`,
  );
  await createServiceAccount(customerId);

  const result = await deleteCustomer(actor.token, customerId);
  assert.equal(result.kind, "success");

  const [customer] = await db
    .select({
      id: customers.id,
      status: customers.status,
      isTrashed: customers.isTrashed,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  assert.equal(customer?.id, customerId);
  assert.equal(customer?.status, "inactive");
  assert.equal(customer?.isTrashed, true);
  assert.equal(
    await db
      .select({ id: customerMeterAccounts.id })
      .from(customerMeterAccounts)
      .where(eq(customerMeterAccounts.customerId, customerId))
      .then((rows) => rows.length),
    1,
  );
});

test("customer deletion retains portal-access and invitation history", async () => {
  const actor = await createStaffSession("admin");
  const accessConstraint = await db.execute<{ delete_action: string }>(sql`
    SELECT confdeltype::text AS delete_action
    FROM pg_constraint
    WHERE conrelid = 'public.customer_user_access'::regclass
      AND conname = 'customer_user_access_customer_id_customers_id_fk'
  `);
  assert.equal(accessConstraint.rows[0]?.delete_action, "r");

  const linkedCustomerId = await createManagedCustomer(
    actor.token,
    `access-linked-${randomUUID()}@example.test`,
  );
  const accessUserId = await createPortalUser(
    `access-user-${randomUUID()}@example.test`,
    "active",
  );
  await db.insert(customerUserAccess).values({
    userId: accessUserId,
    customerId: linkedCustomerId,
    grantedBy: actor.userId,
    revokedAt: new Date(),
  });

  await assert.rejects(
    () =>
      db
        .delete(customers)
        .where(eq(customers.id, linkedCustomerId)),
    isCustomerAccessForeignKeyViolation,
  );

  const accessResult = await deleteCustomer(actor.token, linkedCustomerId);
  assert.equal(accessResult.kind, "success");
  assert.equal(
    await db
      .select({ id: customerUserAccess.id })
      .from(customerUserAccess)
      .where(eq(customerUserAccess.customerId, linkedCustomerId))
      .then((rows) => rows.length),
    1,
  );

  const invitationEmail = `invitation-linked-${randomUUID()}@example.test`;
  const invitationCustomerId = await createManagedCustomer(
    actor.token,
    invitationEmail,
  );
  const invitedUserId = await createPortalUser(invitationEmail, "invited");
  const [customerRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, "customer"))
    .limit(1);
  assert.ok(customerRole);

  const invitationId = randomUUID();
  fixtureInvitationIds.add(invitationId);
  const now = new Date();
  await db.insert(invitations).values({
    id: invitationId,
    userId: invitedUserId,
    roleId: customerRole.id,
    customerId: invitationCustomerId,
    invitedEmail: invitationEmail,
    tokenHash: hashOpaqueToken(createOpaqueToken()),
    invitedBy: actor.userId,
    status: "expired",
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    expiresAt: new Date(now.getTime() - 30 * 60 * 1000),
  });

  const invitationResult = await deleteCustomer(
    actor.token,
    invitationCustomerId,
  );
  assert.equal(invitationResult.kind, "success");
  assert.equal(
    await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.customerId, invitationCustomerId))
      .then((rows) => rows.length),
    1,
  );
});

test("staff customer access coexists with a customer portal login", async () => {
  const manager = await createStaffSession("admin");
  const staff = await createStaffSession("meter_reader");
  const customerId = await createManagedCustomer(
    manager.token,
    `staff-customer-${randomUUID()}@example.test`,
  );
  const portalUserId = await createPortalUser(
    `portal-${randomUUID()}@example.test`,
    "active",
  );
  await db.insert(customerUserAccess).values({
    userId: portalUserId,
    customerId,
    grantedBy: manager.userId,
  });

  const result = await linkStaffCustomerAccess(
    manager.token,
    staff.userId,
    customerId,
  );
  assert.equal(result.kind, "success");
  if (result.kind !== "success") {
    throw new Error("Expected the staff customer link to be created.");
  }
  fixtureStaffCustomerAccessIds.add(result.accessId);

  const [link] = await db
    .select({
      staffUserId: staffCustomerAccess.staffUserId,
      customerId: staffCustomerAccess.customerId,
      linkedBy: staffCustomerAccess.linkedBy,
      revokedAt: staffCustomerAccess.revokedAt,
    })
    .from(staffCustomerAccess)
    .where(eq(staffCustomerAccess.id, result.accessId))
    .limit(1);
  assert.deepEqual(link, {
    staffUserId: staff.userId,
    customerId,
    linkedBy: manager.userId,
    revokedAt: null,
  });
  const [linkAudit] = await db
    .select({
      actorUserId: auditLogs.actorUserId,
      action: auditLogs.action,
      entityId: auditLogs.entityId,
    })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, result.accessId))
    .limit(1);
  assert.deepEqual(linkAudit, {
    actorUserId: manager.userId,
    action: "staff_customer_access.link",
    entityId: result.accessId,
  });

  const portalLinks = await db
    .select({ userId: customerUserAccess.userId })
    .from(customerUserAccess)
    .where(eq(customerUserAccess.customerId, customerId));
  assert.deepEqual(portalLinks.map((row) => row.userId), [portalUserId]);
});

test("staff customer access enforces one active link on both sides and retains revoke history", async () => {
  const manager = await createStaffSession("admin");
  const firstStaff = await createStaffSession("meter_reader");
  const secondStaff = await createStaffSession("meter_reader");
  const firstCustomerId = await createManagedCustomer(
    manager.token,
    `staff-link-first-${randomUUID()}@example.test`,
  );
  const secondCustomerId = await createManagedCustomer(
    manager.token,
    `staff-link-second-${randomUUID()}@example.test`,
  );

  const initial = await linkStaffCustomerAccess(
    manager.token,
    firstStaff.userId,
    firstCustomerId,
  );
  assert.equal(initial.kind, "success");
  if (initial.kind !== "success") {
    throw new Error("Expected the initial staff customer link.");
  }
  fixtureStaffCustomerAccessIds.add(initial.accessId);

  await assert.rejects(
    () =>
      db.insert(staffCustomerAccess).values({
        staffUserId: firstStaff.userId,
        customerId: secondCustomerId,
      }),
    (error: unknown) =>
      hasPostgresConstraint(
        error,
        "23505",
        "staff_customer_access_active_staff_unique",
      ),
  );
  await assert.rejects(
    () =>
      db.insert(staffCustomerAccess).values({
        staffUserId: secondStaff.userId,
        customerId: firstCustomerId,
      }),
    (error: unknown) =>
      hasPostgresConstraint(
        error,
        "23505",
        "staff_customer_access_active_customer_unique",
      ),
  );

  assert.deepEqual(
    await linkStaffCustomerAccess(
      manager.token,
      firstStaff.userId,
      secondCustomerId,
    ),
    { kind: "already-linked" },
  );
  assert.deepEqual(
    await linkStaffCustomerAccess(
      manager.token,
      secondStaff.userId,
      firstCustomerId,
    ),
    { kind: "already-linked" },
  );

  const revoked = await revokeStaffCustomerAccess(
    manager.token,
    firstStaff.userId,
  );
  assert.equal(revoked.kind, "success");
  if (revoked.kind !== "success") {
    throw new Error("Expected staff customer access to be revoked.");
  }
  assert.equal(revoked.accessId, initial.accessId);

  const replacement = await linkStaffCustomerAccess(
    manager.token,
    secondStaff.userId,
    firstCustomerId,
  );
  assert.equal(replacement.kind, "success");
  if (replacement.kind !== "success") {
    throw new Error("Expected the revoked customer link to be reusable.");
  }
  fixtureStaffCustomerAccessIds.add(replacement.accessId);

  const history = await db
    .select({
      id: staffCustomerAccess.id,
      revokedAt: staffCustomerAccess.revokedAt,
      revokedBy: staffCustomerAccess.revokedBy,
    })
    .from(staffCustomerAccess)
    .where(inArray(staffCustomerAccess.id, [initial.accessId, replacement.accessId]));
  assert.equal(history.length, 2);
  assert.ok(history.find((row) => row.id === initial.accessId)?.revokedAt);
  assert.equal(
    history.find((row) => row.id === initial.accessId)?.revokedBy,
    manager.userId,
  );
  assert.equal(history.find((row) => row.id === replacement.accessId)?.revokedAt, null);
  const revokeAudit = await db
    .select({
      actorUserId: auditLogs.actorUserId,
      action: auditLogs.action,
      entityId: auditLogs.entityId,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, "staff_customer_access.revoke"),
        eq(auditLogs.entityId, initial.accessId),
      ),
    );
  assert.deepEqual(revokeAudit, [
    {
      actorUserId: manager.userId,
      action: "staff_customer_access.revoke",
      entityId: initial.accessId,
    },
  ]);
});

test("customer deletion retains staff customer-access history", async () => {
  const manager = await createStaffSession("admin");
  const staff = await createStaffSession("meter_reader");
  const customerId = await createManagedCustomer(
    manager.token,
    `staff-access-history-${randomUUID()}@example.test`,
  );
  const linked = await linkStaffCustomerAccess(
    manager.token,
    staff.userId,
    customerId,
  );
  assert.equal(linked.kind, "success");
  if (linked.kind !== "success") {
    throw new Error("Expected the staff customer link to be created.");
  }
  fixtureStaffCustomerAccessIds.add(linked.accessId);

  const revoked = await revokeStaffCustomerAccess(manager.token, staff.userId);
  assert.equal(revoked.kind, "success");
  const deleted = await deleteCustomer(manager.token, customerId);
  assert.equal(deleted.kind, "success");
  assert.equal(
    await db
      .select({ id: staffCustomerAccess.id })
      .from(staffCustomerAccess)
      .where(eq(staffCustomerAccess.customerId, customerId))
      .then((rows) => rows.length),
    1,
  );
});

test("customer deletion requires customers.manage", async () => {
  const manager = await createStaffSession("admin");
  const reader = await createStaffSession("meter_reader");
  const customerId = await createManagedCustomer(
    manager.token,
    `delete-forbidden-${randomUUID()}@example.test`,
  );

  const result = await deleteCustomer(reader.token, customerId);
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
