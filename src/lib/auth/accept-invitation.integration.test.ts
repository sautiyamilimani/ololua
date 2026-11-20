import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, like } from "drizzle-orm";
import { POST as acceptInvitationRoute } from "@/app/api/auth/invitations/accept/route";
import { db } from "@/lib/db";
import {
  accountSecurityEvents,
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

  await db.insert(users).values({
    id: userId,
    fullName: "Invitation Integration Test",
    email,
    accountType,
    status: "invited",
  });

  try {
    await db.insert(invitations).values({
      userId,
      roleId: role.id,
      invitedEmail: email,
      tokenHash: hashOpaqueToken(token),
      status: "pending",
      expiresAt,
    });
  } catch (error) {
    await db.delete(users).where(eq(users.id, userId));
    throw error;
  }

  return { userId, email, token };
}

async function removeInvitationFixture(userId: string): Promise<void> {
  await db.delete(accountSecurityEvents).where(eq(accountSecurityEvents.userId, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(invitations).where(eq(invitations.userId, userId));
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
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

test("customer invitation acceptance uses the customer session lifetime", async () => {
  const fixture = await createInvitationFixture("customer", "meter_reader");

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
  } finally {
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

  assert.equal(remainingUsers.length, 0);
});
