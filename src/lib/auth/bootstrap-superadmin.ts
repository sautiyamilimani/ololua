import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  accountSecurityEvents,
  invitations,
  roles,
  superadminAssignments,
  userRoles,
  users,
} from "@/lib/db/schema";
import { assertSecretPayloadEncryptionConfigured } from "@/lib/email/secret-payload";
import { getApplicationOrigin } from "./csrf";
import {
  queueInvitationEmail,
  revokeQueuedInvitationEmail,
} from "./invitation-email";
import { createOpaqueToken, hashOpaqueToken } from "./token";

const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export type BootstrapSuperadminResult =
  | {
      kind: "issued" | "resent";
      invitationId: string;
      expiresAt: Date;
    }
  | { kind: "already-exists" }
  | { kind: "email-in-use" }
  | { kind: "role-not-found" };

type BootstrapInput = {
  email: string;
  fullName: string;
};

function isConstraintError(error: unknown, constraint: string): boolean {
  const databaseError =
    typeof error === "object" && error !== null && "cause" in error
      ? error.cause
      : error;

  return (
    typeof databaseError === "object" &&
    databaseError !== null &&
    "constraint" in databaseError &&
    databaseError.constraint === constraint
  );
}

export async function bootstrapSuperadmin(
  input: BootstrapInput,
): Promise<BootstrapSuperadminResult> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();

  if (
    email.length === 0 ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email) ||
    fullName.length === 0 ||
    fullName.length > 150
  ) {
    throw new Error("Provide a valid email address and a name of at most 150 characters.");
  }

  getApplicationOrigin();
  assertSecretPayloadEncryptionConfigured();

  const token = createOpaqueToken();
  const requestId = randomUUID();

  try {
    return await db.transaction(async (transaction) => {
      const now = new Date();
      const [role] = await transaction
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.roleKey, "superadmin"))
        .limit(1)
        .for("update");

      if (!role) {
        return { kind: "role-not-found" };
      }

      const [assignment] = await transaction
        .select({ userId: superadminAssignments.userId })
        .from(superadminAssignments)
        .where(eq(superadminAssignments.singletonKey, true))
        .limit(1)
        .for("update");

      let userId: string;
      let eventType: string;
      let resultKind: "issued" | "resent";

      if (assignment) {
        const [existingUser] = await transaction
          .select({
            email: users.email,
            status: users.status,
            passwordHash: users.passwordHash,
            emailVerifiedAt: users.emailVerifiedAt,
          })
          .from(users)
          .where(eq(users.id, assignment.userId))
          .limit(1)
          .for("update");

        if (
          !existingUser ||
          existingUser.email.toLowerCase() !== email ||
          existingUser.status !== "invited" ||
          existingUser.passwordHash !== null ||
          existingUser.emailVerifiedAt !== null
        ) {
          return { kind: "already-exists" };
        }

        userId = assignment.userId;
        await transaction
          .update(users)
          .set({ fullName, updatedAt: now })
          .where(eq(users.id, userId));
        const [pendingInvitation] = await transaction
          .select({ id: invitations.id })
          .from(invitations)
          .where(
            sql`${invitations.userId} = ${userId} and ${invitations.status} = 'pending'`,
          )
          .orderBy(invitations.createdAt)
          .limit(1)
          .for("update");

        if (pendingInvitation) {
          await transaction
            .update(invitations)
            .set({ status: "revoked", revokedAt: now })
            .where(eq(invitations.id, pendingInvitation.id));
          await revokeQueuedInvitationEmail(
            transaction,
            pendingInvitation.id,
            now,
          );
        }

        eventType = "superadmin_bootstrap_resent";
        resultKind = "resent";
      } else {
        const [existingUser] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1)
          .for("update");

        if (existingUser) {
          return { kind: "email-in-use" };
        }

        userId = randomUUID();
        await transaction.insert(users).values({
          id: userId,
          fullName,
          email,
          accountType: "staff",
          status: "invited",
          updatedAt: now,
        });
        await transaction.insert(userRoles).values({
          userId,
          roleId: role.id,
          assignedBy: null,
          assignedAt: now,
        });

        eventType = "superadmin_bootstrap_issued";
        resultKind = "issued";
      }

      const invitationId = randomUUID();
      const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);

      await transaction.insert(invitations).values({
        id: invitationId,
        userId,
        roleId: role.id,
        invitedEmail: email,
        tokenHash: hashOpaqueToken(token),
        status: "pending",
        createdAt: now,
        expiresAt,
      });

      await queueInvitationEmail(transaction, {
        invitationId,
        userId,
        email,
        accountType: "staff",
        fullName,
        customerNumber: null,
        token,
        now,
      });

      await transaction.insert(accountSecurityEvents).values({
        userId,
        eventType,
        emailAttempted: email,
        metadata: { invitationId },
        requestId,
      });

      return { kind: resultKind, invitationId, expiresAt };
    });
  } catch (error) {
    if (
      isConstraintError(
        error,
        "superadmin_assignments_singleton_key_pk",
      )
    ) {
      return { kind: "already-exists" };
    }

    if (isConstraintError(error, "users_email_lower_unique")) {
      return { kind: "email-in-use" };
    }

    throw error;
  }
}
