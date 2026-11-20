import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  accountSecurityEvents,
  customerUserAccess,
  customers,
  invitations,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import { hashPassword } from "./password";
import {
  getPasswordMinimumLength,
  getSessionPolicy,
  isAccountType,
  isRoleAllowedForAccountType,
  type AccountType,
  type SessionPolicy,
} from "./policy";
import { createOpaqueToken, hashOpaqueToken } from "./token";

type AcceptedUser = {
  id: string;
  fullName: string;
  email: string;
  accountType: AccountType;
};

export type InvitationAcceptanceResult =
  | {
      kind: "accepted";
      user: AcceptedUser;
      token: string;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "invalid" }
  | { kind: "password-policy" };

function emailsMatch(first: string, second: string): boolean {
  return first.trim().toLowerCase() === second.trim().toLowerCase();
}

function passwordCharacterCount(password: string): number {
  return Array.from(password).length;
}

async function markInvitationExpired(invitationId: string): Promise<void> {
  await db.transaction(async (transaction) => {
    const [invitation] = await transaction
      .select({
        id: invitations.id,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        revokedAt: invitations.revokedAt,
      })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1)
      .for("update");

    if (
      invitation &&
      invitation.status === "pending" &&
      invitation.revokedAt === null &&
      invitation.expiresAt <= new Date()
    ) {
      await transaction
        .update(invitations)
        .set({ status: "expired" })
        .where(eq(invitations.id, invitation.id));
    }
  });
}

export async function acceptInvitation(
  token: string,
  password: string,
  userAgent: string | null,
): Promise<InvitationAcceptanceResult> {
  const tokenHash = hashOpaqueToken(token);
  const [snapshot] = await db
    .select({
      invitationId: invitations.id,
      userId: invitations.userId,
      invitedBy: invitations.invitedBy,
      invitedEmail: invitations.invitedEmail,
      invitationStatus: invitations.status,
      invitationExpiresAt: invitations.expiresAt,
      invitationRevokedAt: invitations.revokedAt,
      invitationRoleKey: roles.roleKey,
      customerId: invitations.customerId,
      userEmail: users.email,
      userFullName: users.fullName,
      userAccountType: users.accountType,
      userStatus: users.status,
      userPasswordHash: users.passwordHash,
    })
    .from(invitations)
    .innerJoin(users, eq(invitations.userId, users.id))
    .innerJoin(roles, eq(invitations.roleId, roles.id))
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);

  if (!snapshot) {
    return { kind: "invalid" };
  }

  if (
    snapshot.invitationStatus === "pending" &&
    snapshot.invitationRevokedAt === null &&
    snapshot.invitationExpiresAt <= new Date()
  ) {
    await markInvitationExpired(snapshot.invitationId);
    return { kind: "invalid" };
  }

  if (
    snapshot.invitationStatus !== "pending" ||
    snapshot.invitationRevokedAt !== null ||
    snapshot.userStatus !== "invited" ||
    snapshot.userPasswordHash !== null ||
    !emailsMatch(snapshot.userEmail, snapshot.invitedEmail) ||
    !isAccountType(snapshot.userAccountType) ||
    !isRoleAllowedForAccountType(
      snapshot.userAccountType,
      snapshot.invitationRoleKey,
    ) ||
    (snapshot.userAccountType === "customer"
      ? snapshot.customerId === null
      : snapshot.customerId !== null)
  ) {
    return { kind: "invalid" };
  }

  const assignedRoleRows = await db
    .select({ roleKey: roles.roleKey })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, snapshot.userId));
  const roleKeys = new Set([
    ...assignedRoleRows.map((role) => role.roleKey),
    snapshot.invitationRoleKey,
  ]);
  const passwordLength = passwordCharacterCount(password);

  if (
    passwordLength <
    getPasswordMinimumLength(snapshot.userAccountType, [...roleKeys])
  ) {
    return { kind: "password-policy" };
  }

  const passwordHash = await hashPassword(password);
  const sessionToken = createOpaqueToken();
  const requestId = randomUUID();
  const normalizedUserAgent = userAgent?.slice(0, 512) ?? null;

  return db.transaction(async (transaction) => {
    if (snapshot.customerId !== null) {
      const [customer] = await transaction
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, snapshot.customerId))
        .limit(1)
        .for("update");

      if (!customer) {
        return { kind: "invalid" };
      }
    }

    const [invitation] = await transaction
      .select({
        id: invitations.id,
        userId: invitations.userId,
        roleId: invitations.roleId,
        invitedBy: invitations.invitedBy,
        invitedEmail: invitations.invitedEmail,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        revokedAt: invitations.revokedAt,
        customerId: invitations.customerId,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, snapshot.invitationId),
          eq(invitations.tokenHash, tokenHash),
        ),
      )
      .limit(1)
      .for("update");

    if (!invitation) {
      return { kind: "invalid" };
    }

    const now = new Date();

    if (
      invitation.status === "pending" &&
      invitation.revokedAt === null &&
      invitation.expiresAt <= now
    ) {
      await transaction
        .update(invitations)
        .set({ status: "expired" })
        .where(eq(invitations.id, invitation.id));
      return { kind: "invalid" };
    }

    if (
      invitation.status !== "pending" ||
      invitation.revokedAt !== null ||
      invitation.customerId !== snapshot.customerId
    ) {
      return { kind: "invalid" };
    }

    const [user] = await transaction
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        accountType: users.accountType,
        status: users.status,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.id, invitation.userId))
      .limit(1)
      .for("update");

    if (
      !user ||
      user.status !== "invited" ||
      user.passwordHash !== null ||
      !emailsMatch(user.email, invitation.invitedEmail) ||
      !isAccountType(user.accountType)
    ) {
      return { kind: "invalid" };
    }

    const [invitationRole] = await transaction
      .select({ roleKey: roles.roleKey })
      .from(roles)
      .where(eq(roles.id, invitation.roleId))
      .limit(1);

    if (
      !invitationRole ||
      !isRoleAllowedForAccountType(user.accountType, invitationRole.roleKey) ||
      (user.accountType === "customer"
        ? invitation.customerId === null
        : invitation.customerId !== null)
    ) {
      return { kind: "invalid" };
    }

    const assignedRoles = await transaction
      .select({ roleKey: roles.roleKey })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));
    const roleKeys = new Set([
      ...assignedRoles.map((role) => role.roleKey),
      invitationRole.roleKey,
    ]);

    if (
      passwordLength <
      getPasswordMinimumLength(user.accountType, [...roleKeys])
    ) {
      return { kind: "password-policy" };
    }

    if (invitation.customerId !== null) {
      const [activeAccess] = await transaction
        .select({ id: customerUserAccess.id })
        .from(customerUserAccess)
        .where(
          and(
            eq(customerUserAccess.customerId, invitation.customerId),
            isNull(customerUserAccess.revokedAt),
          ),
        )
        .limit(1);

      if (activeAccess) {
        return { kind: "invalid" };
      }
    }

    const sessionPolicy = getSessionPolicy(user.accountType, [...roleKeys]);
    const expiresAt = new Date(now.getTime() + sessionPolicy.idleTimeoutMs);

    await transaction.insert(userRoles).values({
      userId: user.id,
      roleId: invitation.roleId,
      assignedBy: invitation.invitedBy,
    }).onConflictDoNothing();

    if (invitation.customerId !== null) {
      await transaction.insert(customerUserAccess).values({
        userId: user.id,
        customerId: invitation.customerId,
        grantedBy: invitation.invitedBy,
        createdAt: now,
      });
    }

    await transaction
      .update(users)
      .set({
        passwordHash,
        passwordChangedAt: now,
        emailVerifiedAt: now,
        status: "active",
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await transaction
      .update(invitations)
      .set({
        status: "accepted",
        acceptedAt: now,
      })
      .where(eq(invitations.id, invitation.id));

    await transaction.insert(sessions).values({
      userId: user.id,
      tokenHash: hashOpaqueToken(sessionToken),
      userAgent: normalizedUserAgent,
      createdAt: now,
      lastActivityAt: now,
      idleExpiresAt: expiresAt,
      expiresAt,
    });

    await transaction.insert(accountSecurityEvents).values({
      userId: user.id,
      eventType: "invitation_accepted",
      emailAttempted: invitation.invitedEmail,
      userAgent: normalizedUserAgent,
      requestId,
    });

    return {
      kind: "accepted",
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        accountType: user.accountType,
      },
      token: sessionToken,
      sessionPolicy,
    };
  });
}
