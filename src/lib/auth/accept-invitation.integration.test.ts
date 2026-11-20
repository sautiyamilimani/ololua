import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, like } from "drizzle-orm";
import { POST as acceptInvitationRoute } from "@/app/api/auth/invitations/accept/route";
import { db } from "@/lib/db";
import {
  accountSecurityEvents,
  customerUserAccess,
  customers,
  emailOutbox,
  invitations,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { createOpaqueToken, hashOpaqueToken } from "./token";
import { verifyPassword } from "./password";

type AccountType = "staff" | "customer";

type InvitationFixture = {
  userId: string;
  email: string;
  token: string;
  customerId: string | null;
};

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Invitation integration tests may only write to a loopback development database.",
  );
}

async function createInvitationFixture(
  accountType: AccountType,
  roleKey: string,
  expiresAt = new Date(Date.now() + 60 * 60 * 1000),
): Promise<InvitationFixture> {
  assertLocalDatabase();

  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.roleKey, roleKey))
    .limit(1);
  assert.ok(role, `The local development database must be seeded with ${roleKey}.`);

  const userId = randomUUID();
  const email = `invitation-test-${userId}@example.test`;
  const token = createOpaqueToken();
  const customerId = accountType === "customer" ? randomUUID() : null;

  try {
    if (customerId !== null) {
      await db.insert(customers).values({
        id: customerId,
        customerNumber: `TEST-${userId.slice(0, 12)}`,
        customerType: "individual",
        fullName: "Invitation Integration Test",
        phone: "0700000000",
        email,
        status: "active",
      });
    }

    await db.insert(users).values({
      id: userId,
      fullName: "Invitation Integration Test",
      email,
      accountType,
      status: "invited",
    });

    await db.insert(invitations).values({
      userId,
      roleId: role.id,
      customerId,
      invitedEmail: email,
      tokenHash: hashOpaqueToken(token),
      status: "pending",
      expiresAt,
    });
  } catch (error) {
    await db
      .delete(invitations)
      .where(eq(invitations.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    if (customerId !== null) {
      await db.delete(customers).where(eq(customers.id, customerId));
    }
    throw error;
  }

  return { userId, email, token, customerId };
}

async function removeInvitationFixture(userId: string): Promise<void> {
  await db.delete(accountSecurityEvents).where(eq(accountSecurityEvents.userId, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(emailOutbox).where(eq(emailOutbox.recipientUserId, userId));
  await db.delete(customerUserAccess).where(eq(customerUserAccess.userId, userId));
  await db.delete(invitations).where(eq(invitations.userId, userId));
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  await db.delete(users).where(eq(users.id, userId));
  if (user?.email.startsWith("invitation-test-")) {
    await db
      .delete(customers)
      .where(eq(customers.email, user.email));
  }
}

async function postAcceptance(token: string, password: string): Promise<Response> {
  process.env.APP_ORIGIN = "http://localhost:3000";

  return acceptInvitationRoute(
    new Request("http://localhost:3000/api/auth/invitations/accept", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-protection": "1",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ token, password }),
    }),
  );
}

test("staff invitation acceptance activates the account and sets a session cookie", async () => {
  const fixture = await createInvitationFixture("staff", "meter_reader");

  try {
    const response = await postAcceptance(fixture.token, "staff-pass-123");
    const cookie = response.headers.get("set-cookie");

    assert.equal(response.status, 200);
    assert.match(cookie ?? "", /ololua_session=/);
    assert.match(cookie ?? "", /HttpOnly/i);
    assert.match(cookie ?? "", /SameSite=lax/i);
    assert.match(cookie ?? "", /Max-Age=43200/i);

    const [user] = await db
      .select({
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.id, fixture.userId))
      .limit(1);
    assert.equal(user?.status, "active");
    assert.ok(user?.emailVerifiedAt);
    assert.ok(user?.passwordHash);
    assert.equal(await verifyPassword("staff-pass-123", user.passwordHash), true);

    const [invitation] = await db
      .select({ status: invitations.status, acceptedAt: invitations.acceptedAt })
      .from(invitations)
      .where(eq(invitations.userId, fixture.userId))
      .limit(1);
    assert.equal(invitation?.status, "accepted");
    assert.ok(invitation?.acceptedAt);

    const [assignedRole] = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.userId, fixture.userId))
      .limit(1);
    assert.equal(assignedRole?.userId, fixture.userId);

    const [session] = await db
      .select({ idleExpiresAt: sessions.idleExpiresAt, createdAt: sessions.createdAt })
      .from(sessions)
      .where(eq(sessions.userId, fixture.userId))
      .limit(1);
    assert.ok(session);
    assert.equal(
      session.idleExpiresAt.getTime() - session.createdAt.getTime(),
      12 * 60 * 60 * 1000,
    );

    const [securityEvent] = await db
      .select({ eventType: accountSecurityEvents.eventType })
      .from(accountSecurityEvents)
      .where(eq(accountSecurityEvents.userId, fixture.userId))
      .limit(1);
    assert.equal(securityEvent?.eventType, "invitation_accepted");
  } finally {
    await removeInvitationFixture(fixture.userId);
  }
});

test("customer invitation acceptance creates access and uses the customer session lifetime", async () => {
  const fixture = await createInvitationFixture("customer", "customer");

  try {
    const response = await postAcceptance(fixture.token, "customer-pass-123");
    const cookie = response.headers.get("set-cookie");

    assert.equal(response.status, 200);
    assert.match(cookie ?? "", /Max-Age=2592000/i);

    const [session] = await db
      .select({ idleExpiresAt: sessions.idleExpiresAt, createdAt: sessions.createdAt })
      .from(sessions)
      .where(eq(sessions.userId, fixture.userId))
      .limit(1);
    assert.ok(session);
    assert.equal(
      session.idleExpiresAt.getTime() - session.createdAt.getTime(),
      30 * 24 * 60 * 60 * 1000,
    );

    const [access] = await db
      .select({
        customerId: customerUserAccess.customerId,
        revokedAt: customerUserAccess.revokedAt,
      })
      .from(customerUserAccess)
      .where(eq(customerUserAccess.userId, fixture.userId))
      .limit(1);
    assert.equal(access?.customerId, fixture.customerId);
    assert.equal(access?.revokedAt, null);
  } finally {
    await removeInvitationFixture(fixture.userId);
  }
});

test("acceptance rejects invitation roles that do not match the account type", async () => {
  const customerWithStaffRole = await createInvitationFixture("customer", "meter_reader");

  try {
    const response = await postAcceptance(
      customerWithStaffRole.token,
      "customer-pass-123",
    );
    assert.equal(response.status, 401);
  } finally {
    await removeInvitationFixture(customerWithStaffRole.userId);
  }

  const staffWithCustomerRole = await createInvitationFixture("staff", "customer");

  try {
    const response = await postAcceptance(
      staffWithCustomerRole.token,
      "staff-pass-123",
    );
    assert.equal(response.status, 401);
  } finally {
    await removeInvitationFixture(staffWithCustomerRole.userId);
  }
});

test("customer acceptance fails if the customer already has an active linked user", async () => {
  const fixture = await createInvitationFixture("customer", "customer");
  assert.ok(fixture.customerId);
  const existingUserId = randomUUID();

  try {
    await db.insert(users).values({
      id: existingUserId,
      fullName: "Existing Customer Portal User",
      email: `invitation-test-existing-${existingUserId}@example.test`,
      accountType: "customer",
      status: "active",
      emailVerifiedAt: new Date(),
    });
    await db.insert(customerUserAccess).values({
      userId: existingUserId,
      customerId: fixture.customerId,
    });

    const response = await postAcceptance(fixture.token, "customer-pass-123");
    assert.equal(response.status, 401);

    const [unchangedUser] = await db
      .select({ status: users.status, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, fixture.userId))
      .limit(1);
    assert.equal(unchangedUser?.status, "invited");
    assert.equal(unchangedUser?.passwordHash, null);
  } finally {
    await db
      .delete(customerUserAccess)
      .where(eq(customerUserAccess.userId, existingUserId));
    await db.delete(users).where(eq(users.id, existingUserId));
    await removeInvitationFixture(fixture.userId);
  }
});

test("admin invitation enforces the longer password and rejects replay", async () => {
  const fixture = await createInvitationFixture("staff", "admin");

  try {
    const shortPasswordResponse = await postAcceptance(fixture.token, "short-pass");
    assert.equal(shortPasswordResponse.status, 400);

    const [unchangedUser] = await db
      .select({ status: users.status, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, fixture.userId))
      .limit(1);
    assert.equal(unchangedUser?.status, "invited");
    assert.equal(unchangedUser?.passwordHash, null);

    const response = await postAcceptance(fixture.token, "admin-pass-123");
    const cookie = response.headers.get("set-cookie");
    assert.equal(response.status, 200);
    assert.match(cookie ?? "", /ololua_session=/);
    assert.doesNotMatch(cookie ?? "", /Max-Age=/i);

    const replayResponse = await postAcceptance(fixture.token, "admin-pass-123");
    assert.equal(replayResponse.status, 401);
    assert.deepEqual(await replayResponse.json(), {
      success: false,
      error: {
        code: "INVITATION_INVALID",
        message: "The invitation is invalid or can no longer be used.",
      },
    });
  } finally {
    await removeInvitationFixture(fixture.userId);
  }
});

test("concurrent acceptance attempts create only one account session", async () => {
  const fixture = await createInvitationFixture("staff", "meter_reader");

  try {
    const responses = await Promise.all([
      postAcceptance(fixture.token, "staff-pass-123"),
      postAcceptance(fixture.token, "staff-pass-123"),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 401],
    );

    const sessionRows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, fixture.userId));
    assert.equal(sessionRows.length, 1);

    const eventRows = await db
      .select({ id: accountSecurityEvents.id })
      .from(accountSecurityEvents)
      .where(eq(accountSecurityEvents.userId, fixture.userId));
    assert.equal(eventRows.length, 1);
  } finally {
    await removeInvitationFixture(fixture.userId);
  }
});

test("expired invitations are rejected and marked expired", async () => {
  const fixture = await createInvitationFixture(
    "staff",
    "meter_reader",
    new Date(Date.now() - 60 * 1000),
  );

  try {
    const response = await postAcceptance(fixture.token, "staff-pass-123");
    assert.equal(response.status, 401);

    const [invitation] = await db
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.userId, fixture.userId))
      .limit(1);
    assert.equal(invitation?.status, "expired");

    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, fixture.userId))
      .limit(1);
    assert.equal(userRows.length, 1);

    const sessionRows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, fixture.userId))
      .limit(1);
    assert.equal(sessionRows.length, 0);
  } finally {
    await removeInvitationFixture(fixture.userId);
  }
});

test("invitation integration fixtures are removed after the tests", async () => {
  assertLocalDatabase();

  const remainingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "invitation-test-%@example.test"));
  const remainingCustomers = await db
    .select({ id: customers.id })
    .from(customers)
    .where(like(customers.customerNumber, "TEST-%"));

  assert.equal(remainingUsers.length, 0);
  assert.equal(remainingCustomers.length, 0);
});
