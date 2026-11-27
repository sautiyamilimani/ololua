import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountSecurityEvents,
  customerUserAccess,
  customers,
  emailOutbox,
  invitations,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { issueInvitation, type IssueInvitationInput } from "./issue-invitation";
import { createOpaqueToken, hashOpaqueToken } from "./token";
import { decryptSecretPayload } from "@/lib/email/secret-payload";

process.env.EMAIL_OUTBOX_ENCRYPTION_KEY ??= Buffer.alloc(32, 0x5a).toString("base64");

const fixtureUserIds = new Set<string>();
const fixtureCustomerIds = new Set<string>();
const fixtureRoleIds = new Set<string>();

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Invitation integration tests may only write to a loopback development database.",
  );
}

async function createIssuer(roleKey: string): Promise<{ userId: string; token: string }> {
  assertLocalDatabase();

  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, roleKey))
    .limit(1);
  assert.ok(role, `The local development database must be seeded with ${roleKey}.`);

  const userId = randomUUID();
  const token = createOpaqueToken();
  const now = new Date();
  fixtureUserIds.add(userId);

  await db.insert(users).values({
    id: userId,
    fullName: "Invitation Issuer Test",
    email: `issuance-test-issuer-${userId}@example.test`,
    accountType: "staff",
    status: "active",
    emailVerifiedAt: now,
  });
  await db.insert(userRoles).values({ userId, roleId: role.id });
  await db.insert(sessions).values({
    userId,
    tokenHash: hashOpaqueToken(token),
    createdAt: now,
    lastActivityAt: now,
    idleExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
    expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
  });

  return { userId, token };
}

async function createCustomer(email: string): Promise<string> {
  const customerId = randomUUID();
  fixtureCustomerIds.add(customerId);

  await db.insert(customers).values({
    id: customerId,
    customerNumber: `ISS-${customerId.slice(0, 12)}`,
    customerType: "individual",
    fullName: "Invitation Target Test",
    phone: "0700000000",
    email,
    emailVerifiedAt: new Date(),
    status: "active",
  });

  return customerId;
}

async function trackInvitedUser(email: string): Promise<string> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  assert.ok(user);
  fixtureUserIds.add(user.id);
  return user.id;
}

async function cleanupFixtures(): Promise<void> {
  const userIds = [...fixtureUserIds];
  const customerIds = [...fixtureCustomerIds];
  const roleIds = [...fixtureRoleIds];

  if (userIds.length > 0) {
    await db
      .delete(accountSecurityEvents)
      .where(inArray(accountSecurityEvents.userId, userIds));
    await db.delete(emailOutbox).where(inArray(emailOutbox.recipientUserId, userIds));
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db
      .delete(customerUserAccess)
      .where(inArray(customerUserAccess.userId, userIds));
    await db.delete(invitations).where(inArray(invitations.userId, userIds));
    await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }

  if (customerIds.length > 0) {
    await db.delete(invitations).where(inArray(invitations.customerId, customerIds));
    await db
      .delete(customerUserAccess)
      .where(inArray(customerUserAccess.customerId, customerIds));
    await db.delete(customers).where(inArray(customers.id, customerIds));
  }

  if (roleIds.length > 0) {
    await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
    await db.delete(roles).where(inArray(roles.id, roleIds));
  }

  fixtureUserIds.clear();
  fixtureCustomerIds.clear();
  fixtureRoleIds.clear();
}

afterEach(cleanupFixtures);

test("admin issuance queues an encrypted staff invitation for 72 hours", async () => {
  const issuer = await createIssuer("admin");
  const input: IssueInvitationInput = {
    accountType: "staff",
    email: `issuance-test-staff-${randomUUID()}@example.test`,
    fullName: "New Staff Member",
    roleKey: "meter_reader",
  };

  const result = await issueInvitation(issuer.token, input, "integration-test");
  assert.equal(result.kind, "issued");

  if (result.kind !== "issued") {
    return;
  }

  const userId = await trackInvitedUser(input.email);
  const [invitation] = await db
    .select({
      status: invitations.status,
      customerId: invitations.customerId,
      invitedBy: invitations.invitedBy,
      roleKey: roles.roleKey,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .innerJoin(roles, eq(invitations.roleId, roles.id))
    .where(eq(invitations.id, result.invitationId))
    .limit(1);

  assert.equal(invitation?.status, "pending");
  assert.equal(invitation?.customerId, null);
  assert.equal(invitation?.roleKey, "meter_reader");
  assert.equal(invitation?.invitedBy, issuer.userId);
  assert.equal(
    invitation?.expiresAt.getTime() - invitation?.createdAt.getTime(),
    72 * 60 * 60 * 1000,
  );

  const [outbox] = await db
    .select({
      recipientUserId: emailOutbox.recipientUserId,
      secretPayloadEncrypted: emailOutbox.secretPayloadEncrypted,
      idempotencyKey: emailOutbox.idempotencyKey,
      status: emailOutbox.status,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, `invitation:${result.invitationId}`))
    .limit(1);

  assert.equal(outbox?.recipientUserId, userId);
  assert.equal(outbox?.status, "queued");
  assert.ok(outbox?.secretPayloadEncrypted);
  assert.equal(outbox?.idempotencyKey, `invitation:${result.invitationId}`);

  const secretPayload = JSON.parse(
    decryptSecretPayload(outbox.secretPayloadEncrypted),
  ) as { token?: unknown };
  assert.ok(typeof secretPayload.token === "string");
  assert.equal(secretPayload.token.length, 43);
});

test("customer issuance uses the customer role and rejects an existing active link", async () => {
  const issuer = await createIssuer("admin");
  const email = `issuance-test-customer-${randomUUID()}@example.test`;
  const customerId = await createCustomer(email);
  const input: IssueInvitationInput = { accountType: "customer", customerId };

  const result = await issueInvitation(issuer.token, input, null);
  assert.equal(result.kind, "issued");

  if (result.kind !== "issued") {
    return;
  }

  const invitedUserId = await trackInvitedUser(email);
  const [invitation] = await db
    .select({
      customerId: invitations.customerId,
      roleKey: roles.roleKey,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .innerJoin(roles, eq(invitations.roleId, roles.id))
    .where(eq(invitations.id, result.invitationId))
    .limit(1);

  assert.equal(invitation?.customerId, customerId);
  assert.equal(invitation?.roleKey, "customer");
  assert.equal(
    invitation?.expiresAt.getTime() - invitation?.createdAt.getTime(),
    72 * 60 * 60 * 1000,
  );

  const pendingAccess = await db
    .select({ id: customerUserAccess.id })
    .from(customerUserAccess)
    .where(
      and(
        eq(customerUserAccess.customerId, customerId),
        isNull(customerUserAccess.revokedAt),
      ),
    );
  assert.equal(pendingAccess.length, 0);

  const linkedUserId = randomUUID();
  fixtureUserIds.add(linkedUserId);
  const now = new Date();
  await db.insert(users).values({
    id: linkedUserId,
    fullName: "Already Linked Customer",
    email: `issuance-test-linked-${linkedUserId}@example.test`,
    accountType: "customer",
    status: "active",
    emailVerifiedAt: now,
  });

  await db.insert(customerUserAccess).values({
    userId: linkedUserId,
    customerId,
    grantedBy: issuer.userId,
  });

  const conflict = await issueInvitation(issuer.token, input, null);
  assert.equal(conflict.kind, "conflict");
  assert.ok(invitedUserId);
});

test("customer invitation creates a pending invitation without a separate verification email", async () => {
  const issuer = await createIssuer("admin");
  const email = `issuance-test-unverified-${randomUUID()}@example.test`;
  const customerId = await createCustomer(
    email,
  );
  await db
    .update(customers)
    .set({ emailVerifiedAt: null })
    .where(eq(customers.id, customerId));

  const result = await issueInvitation(
    issuer.token,
    { accountType: "customer", customerId },
    null,
  );
  assert.equal(result.kind, "issued");
  if (result.kind !== "issued") return;

  const userId = await trackInvitedUser(email);
  const [invitation] = await db
    .select({
      customerId: invitations.customerId,
      status: invitations.status,
    })
    .from(invitations)
    .where(eq(invitations.id, result.invitationId))
    .limit(1);
  assert.equal(invitation?.customerId, customerId);
  assert.equal(invitation?.status, "pending");

  const [customer] = await db
    .select({ emailVerifiedAt: customers.emailVerifiedAt })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  assert.equal(customer?.emailVerifiedAt, null);

  const [outbox] = await db
    .select({ status: emailOutbox.status })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, `invitation:${result.invitationId}`))
    .limit(1);
  assert.equal(outbox?.status, "queued");
  assert.ok(userId);
});

test("resending revokes the old token and replaces its queued email atomically", async () => {
  const issuer = await createIssuer("admin");
  const input: IssueInvitationInput = {
    accountType: "staff",
    email: `issuance-test-resend-${randomUUID()}@example.test`,
    fullName: "Resend Target",
    roleKey: "billing_officer",
  };

  const first = await issueInvitation(issuer.token, input, null);
  assert.equal(first.kind, "issued");
  if (first.kind !== "issued") return;
  const userId = await trackInvitedUser(input.email);

  const second = await issueInvitation(issuer.token, input, null);
  assert.equal(second.kind, "issued");
  if (second.kind !== "issued") return;

  const [oldInvitation] = await db
    .select({ status: invitations.status, revokedAt: invitations.revokedAt })
    .from(invitations)
    .where(eq(invitations.id, first.invitationId))
    .limit(1);
  assert.equal(oldInvitation?.status, "revoked");
  assert.ok(oldInvitation?.revokedAt);

  const [oldEmail] = await db
    .select({ status: emailOutbox.status })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, `invitation:${first.invitationId}`))
    .limit(1);
  assert.equal(oldEmail?.status, "failed");

  const [newInvitation] = await db
    .select({ status: invitations.status, userId: invitations.userId })
    .from(invitations)
    .where(eq(invitations.id, second.invitationId))
    .limit(1);
  assert.equal(newInvitation?.status, "pending");
  assert.equal(newInvitation?.userId, userId);
});

test("customer invitations require the dedicated permission for non-admin staff", async () => {
  const billingIssuer = await createIssuer("billing_officer");
  const email = `issuance-test-permission-${randomUUID()}@example.test`;
  const customerId = await createCustomer(email);
  const input: IssueInvitationInput = { accountType: "customer", customerId };

  const [billingRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, "billing_officer"))
    .limit(1);
  const [permission] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.permissionKey, "invitations.create_customer"))
    .limit(1);
  assert.ok(billingRole);
  assert.ok(permission);

  const [existingGrant] = await db
    .select({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, billingRole.id),
        eq(rolePermissions.permissionId, permission.id),
      ),
    )
    .limit(1);
  assert.equal(existingGrant, undefined);

  const denied = await issueInvitation(billingIssuer.token, input, null);
  assert.equal(denied.kind, "forbidden");

  const staffDenied = await issueInvitation(
    billingIssuer.token,
    {
      accountType: "staff",
      email: `issuance-test-staff-forbidden-${randomUUID()}@example.test`,
      fullName: "Forbidden Staff Target",
      roleKey: "meter_reader",
    },
    null,
  );
  assert.equal(staffDenied.kind, "forbidden");

  const temporaryRoleId = randomUUID();
  const temporaryRoleKey = `test_customer_inviter_${temporaryRoleId.slice(0, 8)}`;
  fixtureRoleIds.add(temporaryRoleId);
  await db.insert(roles).values({
    id: temporaryRoleId,
    roleKey: temporaryRoleKey,
    displayName: "Temporary Customer Inviter",
    isSystemRole: false,
  });
  await db.insert(rolePermissions).values({
    roleId: temporaryRoleId,
    permissionId: permission.id,
  });
  await db.insert(userRoles).values({
    userId: billingIssuer.userId,
    roleId: temporaryRoleId,
  });

  const allowed = await issueInvitation(billingIssuer.token, input, null);
  assert.equal(allowed.kind, "issued");
  if (allowed.kind === "issued") {
    await trackInvitedUser(email);
  }
});

test("staff invitations cannot assign the superadmin role", async () => {
  const adminIssuer = await createIssuer("admin");
  const email = `issuance-test-superadmin-${randomUUID()}@example.test`;
  const result = await issueInvitation(
    adminIssuer.token,
    {
      accountType: "staff",
      email,
      fullName: "Second Superadmin Target",
      roleKey: "superadmin",
    },
    null,
  );

  assert.equal(result.kind, "role-not-found");
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  assert.equal(user, undefined);
});

test("issuance integration fixtures are removed after the tests", async () => {
  assertLocalDatabase();

  const remainingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "issuance-test-%@example.test"));
  const remainingCustomers = await db
    .select({ id: customers.id })
    .from(customers)
    .where(like(customers.customerNumber, "ISS-%"));
  const remainingRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(like(roles.roleKey, "test_customer_inviter_%"));

  assert.equal(remainingUsers.length, 0);
  assert.equal(remainingCustomers.length, 0);
  assert.equal(remainingRoles.length, 0);
});

afterEach(async () => {
  await cleanupFixtures();
});
