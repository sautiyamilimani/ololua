import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { POST as acceptInvitationRoute } from "@/app/api/auth/invitations/accept/route";
import { db } from "@/lib/db";
import {
  accountSecurityEvents,
  emailOutbox,
  invitations,
  roles,
  sessions,
  superadminAssignments,
  userRoles,
  users,
} from "@/lib/db/schema";
import { decryptSecretPayload } from "@/lib/email/secret-payload";
import { bootstrapSuperadmin } from "./bootstrap-superadmin";

process.env.APP_ORIGIN = "http://localhost:3000";
process.env.EMAIL_OUTBOX_ENCRYPTION_KEY ??= Buffer.alloc(32, 0x5a).toString("base64");

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Superadmin bootstrap integration tests may only write to a loopback development database.",
  );
}

function hasExpectedUniqueViolation(error: unknown): boolean {
  const databaseError =
    typeof error === "object" && error !== null && "cause" in error
      ? error.cause
      : error;

  return (
    typeof databaseError === "object" &&
    databaseError !== null &&
    "code" in databaseError &&
    databaseError.code === "23505" &&
    "constraint" in databaseError &&
    databaseError.constraint === "superadmin_assignments_singleton_key_pk"
  );
}

test("bootstrap verifies one initial superadmin and the database rejects a second", async () => {
  assertLocalDatabase();

  const email = `bootstrap-test-${randomUUID()}@example.test`;
  const secondUserId = randomUUID();
  let firstUserId: string | null = null;

  try {
    const initialResult = await bootstrapSuperadmin({
      email,
      fullName: "Bootstrap Integration Test",
    });

    assert.equal(initialResult.kind, "issued");
    const result = await bootstrapSuperadmin({
      email,
      fullName: "Bootstrap Integration Test",
    });

    assert.equal(result.kind, "resent");
    if (result.kind !== "resent") {
      return;
    }

    const [user] = await db
      .select({
        id: users.id,
        status: users.status,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    assert.ok(user);
    firstUserId = user.id;
    assert.equal(user.status, "invited");
    assert.equal(user.passwordHash, null);
    assert.equal(user.emailVerifiedAt, null);

    const [assignment] = await db
      .select({ userId: superadminAssignments.userId })
      .from(superadminAssignments)
      .where(eq(superadminAssignments.singletonKey, true))
      .limit(1);
    assert.equal(assignment?.userId, user.id);

    const [invitation] = await db
      .select({
        id: invitations.id,
        tokenHash: invitations.tokenHash,
        status: invitations.status,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.userId, user.id),
          eq(invitations.status, "pending"),
        ),
      )
      .limit(1);
    assert.ok(invitation);
    assert.equal(invitation.id, result.invitationId);
    assert.equal(invitation.status, "pending");

    const [replacedInvitation] = await db
      .select({ status: invitations.status })
      .from(invitations)
      .where(
        and(
          eq(invitations.userId, user.id),
          eq(invitations.status, "revoked"),
        ),
      )
      .limit(1);
    assert.equal(replacedInvitation?.status, "revoked");

    const [queuedEmail] = await db
      .select({ secretPayloadEncrypted: emailOutbox.secretPayloadEncrypted })
      .from(emailOutbox)
      .where(eq(emailOutbox.idempotencyKey, `invitation:${result.invitationId}`))
      .limit(1);
    assert.ok(queuedEmail?.secretPayloadEncrypted);
    const payload = JSON.parse(
      decryptSecretPayload(queuedEmail.secretPayloadEncrypted),
    ) as { token?: unknown };
    assert.equal(typeof payload.token, "string");
    assert.notEqual(payload.token, invitation.tokenHash);

    const acceptanceResponse = await acceptInvitationRoute(
      new Request(`${process.env.APP_ORIGIN}/api/auth/invitations/accept`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-protection": "1",
          origin: process.env.APP_ORIGIN!,
        },
        body: JSON.stringify({
          token: payload.token,
          password: "BootstrapIntegrationPassword123",
        }),
      }),
    );
    assert.equal(acceptanceResponse.status, 200);

    const [acceptedUser] = await db
      .select({
        status: users.status,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    assert.equal(acceptedUser?.status, "active");
    assert.ok(acceptedUser?.passwordHash);
    assert.ok(acceptedUser?.emailVerifiedAt);

    const secondEmail = `bootstrap-test-second-${randomUUID()}@example.test`;
    await db.insert(users).values({
      id: secondUserId,
      fullName: "Second Superadmin Integration Test",
      email: secondEmail,
      accountType: "staff",
      status: "invited",
    });

    const [superadminRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.roleKey, "superadmin"))
      .limit(1);
    assert.ok(superadminRole);

    await assert.rejects(
      db.insert(userRoles).values({
        userId: secondUserId,
        roleId: superadminRole.id,
      }),
      hasExpectedUniqueViolation,
    );

    const repeatedBootstrap = await bootstrapSuperadmin({
      email: secondEmail,
      fullName: "Second Superadmin Integration Test",
    });
    assert.equal(repeatedBootstrap.kind, "already-exists");
  } finally {
    const userIds = [firstUserId, secondUserId].filter(
      (userId): userId is string => userId !== null,
    );

    if (userIds.length > 0) {
      await db
        .delete(accountSecurityEvents)
        .where(inArray(accountSecurityEvents.userId, userIds));
      await db.delete(emailOutbox).where(inArray(emailOutbox.recipientUserId, userIds));
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(invitations).where(inArray(invitations.userId, userIds));
      await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  }
});
