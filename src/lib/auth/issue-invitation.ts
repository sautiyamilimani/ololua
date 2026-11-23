import { randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  accountSecurityEvents,
  customerUserAccess,
  customers,
  invitations,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import {
  queueInvitationEmail,
  revokeQueuedInvitationEmail,
} from "./invitation-email";
import { getSessionPolicy, isRoleAllowedForAccountType, type SessionPolicy } from "./policy";
import { hashOpaqueToken, createOpaqueToken } from "./token";

const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;
const CUSTOMER_INVITATION_PERMISSION = "invitations.create_customer";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export type IssueInvitationInput =
  | {
      accountType: "staff";
      email: string;
      fullName: string;
      roleKey: string;
    }
  | {
      accountType: "customer";
      customerId: string;
    };

type IssueInvitationResult =
  | {
      kind: "issued";
      invitationId: string;
      expiresAt: Date;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "customer-not-found" }
  | { kind: "role-not-found" }
  | { kind: "conflict" };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TargetAccount = {
  accountType: "staff" | "customer";
  email: string;
  fullName: string;
  roleKey: string;
  customerId: string | null;
  customerNumber: string | null;
};

function isValidInvitationTarget(
  input: IssueInvitationInput,
): boolean {
  if (input.accountType === "staff") {
    return (
      input.email.length > 0 &&
      input.email.length <= 254 &&
      EMAIL_PATTERN.test(input.email.trim()) &&
      input.fullName.length > 0 &&
      input.fullName.length <= 150 &&
      /^[a-z][a-z0-9_]{0,49}$/u.test(input.roleKey) &&
      isRoleAllowedForAccountType("staff", input.roleKey)
    );
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    input.customerId,
  );
}

async function loadAndRenewIssuerSession(
  transaction: DatabaseTransaction,
  sessionToken: string,
  now: Date,
): Promise<
  | {
      kind: "authorized";
      userId: string;
      roleKeys: string[];
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
> {
  const [session] = await transaction
    .select({
      id: sessions.id,
      userId: sessions.userId,
      revokedAt: sessions.revokedAt,
      idleExpiresAt: sessions.idleExpiresAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashOpaqueToken(sessionToken)))
    .limit(1)
    .for("update");

  if (
    !session ||
    session.revokedAt !== null ||
    session.idleExpiresAt <= now ||
    session.expiresAt <= now
  ) {
    return { kind: "unauthenticated" };
  }

  const [issuer] = await transaction
    .select({
      id: users.id,
      accountType: users.accountType,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)
    .for("update");

  if (
    !issuer ||
    issuer.accountType !== "staff" ||
    issuer.status !== "active" ||
    issuer.emailVerifiedAt === null
  ) {
    return { kind: "unauthenticated" };
  }

  const assignedRoles = await transaction
    .select({ roleKey: roles.roleKey })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, issuer.id));
  const roleKeys = assignedRoles.map((role) => role.roleKey);
  const sessionPolicy = getSessionPolicy("staff", roleKeys);
  const nextExpiry = new Date(now.getTime() + sessionPolicy.idleTimeoutMs);

  await transaction
    .update(sessions)
    .set({
      lastActivityAt: now,
      idleExpiresAt: nextExpiry,
      expiresAt: nextExpiry,
    })
    .where(eq(sessions.id, session.id));

  return {
    kind: "authorized",
    userId: issuer.id,
    roleKeys,
    sessionPolicy,
  };
}

async function hasCustomerInvitationPermission(
  transaction: DatabaseTransaction,
  userId: string,
): Promise<boolean> {
  const [grant] = await transaction
    .select({ permissionId: permissions.id })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(permissions.permissionKey, CUSTOMER_INVITATION_PERMISSION),
      ),
    )
    .limit(1);

  return grant !== undefined;
}

async function loadTargetAccount(
  transaction: DatabaseTransaction,
  input: IssueInvitationInput,
): Promise<TargetAccount | null> {
  if (input.accountType === "staff") {
    return {
      accountType: "staff",
      email: input.email.trim().toLowerCase(),
      fullName: input.fullName.trim(),
      roleKey: input.roleKey,
      customerId: null,
      customerNumber: null,
    };
  }

  const [customer] = await transaction
    .select({
      id: customers.id,
      email: customers.email,
      fullName: customers.fullName,
      customerNumber: customers.customerNumber,
      isTrashed: customers.isTrashed,
    })
    .from(customers)
    .where(eq(customers.id, input.customerId))
    .limit(1)
    .for("update");

  if (!customer) {
    return null;
  }
  if (customer.isTrashed) {
    return null;
  }

  return {
    accountType: "customer",
    email: customer.email.trim().toLowerCase(),
    fullName: customer.fullName,
    roleKey: "customer",
    customerId: customer.id,
    customerNumber: customer.customerNumber,
  };
}

async function lockInvitationEmail(
  transaction: DatabaseTransaction,
  email: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`,
  );
}

export async function issueInvitation(
  sessionToken: string,
  input: IssueInvitationInput,
  userAgent: string | null,
): Promise<IssueInvitationResult> {
  if (!isValidInvitationTarget(input)) {
    return { kind: "conflict" };
  }
  if (input.accountType === "staff" && input.roleKey === "superadmin") {
    return { kind: "role-not-found" };
  }

  const rawToken = createOpaqueToken();
  const requestId = randomUUID();
  const normalizedUserAgent = userAgent?.slice(0, 512) ?? null;

  return db.transaction(async (transaction) => {
    const now = new Date();
    const issuer = await loadAndRenewIssuerSession(transaction, sessionToken, now);

    if (issuer.kind !== "authorized") {
      return issuer;
    }

    const isAdmin = issuer.roleKeys.some(
      (roleKey) => roleKey === "admin" || roleKey === "superadmin",
    );

    if (
      input.accountType === "staff" &&
      !isAdmin
    ) {
      return { kind: "forbidden" };
    }

    if (
      input.accountType === "customer" &&
      !isAdmin &&
      !(await hasCustomerInvitationPermission(transaction, issuer.userId))
    ) {
      return { kind: "forbidden" };
    }

    const target = await loadTargetAccount(transaction, input);

    if (!target) {
      return input.accountType === "customer"
        ? { kind: "customer-not-found" }
        : { kind: "conflict" };
    }

    if (
      target.email.length === 0 ||
      target.email.length > 254 ||
      !EMAIL_PATTERN.test(target.email) ||
      target.fullName.trim().length === 0 ||
      target.fullName.length > 150
    ) {
      return { kind: "conflict" };
    }

    if (target.customerId !== null) {
      const [activeAccess] = await transaction
        .select({ id: customerUserAccess.id })
        .from(customerUserAccess)
        .where(
          and(
            eq(customerUserAccess.customerId, target.customerId),
            isNull(customerUserAccess.revokedAt),
          ),
        )
        .limit(1);

      if (activeAccess) {
        return { kind: "conflict" };
      }
    }

    const [role] = await transaction
      .select({ id: roles.id, roleKey: roles.roleKey })
      .from(roles)
      .where(eq(roles.roleKey, target.roleKey))
      .limit(1);

    if (!role || !isRoleAllowedForAccountType(target.accountType, role.roleKey)) {
      return { kind: "role-not-found" };
    }

    await lockInvitationEmail(transaction, target.email);

    const pendingInvitations = await transaction
      .select({
        id: invitations.id,
        userId: invitations.userId,
        invitedEmail: invitations.invitedEmail,
        customerId: invitations.customerId,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.status, "pending"),
          target.customerId === null
            ? sql`lower(${invitations.invitedEmail}) = ${target.email}`
            : or(
                sql`lower(${invitations.invitedEmail}) = ${target.email}`,
                eq(invitations.customerId, target.customerId),
              ),
        ),
      )
      .orderBy(invitations.createdAt)
      .for("update");

    const pendingInvitation = pendingInvitations[0];
    const isResend = pendingInvitation !== undefined;

    if (
      pendingInvitations.length > 1 ||
      (pendingInvitation !== undefined &&
        pendingInvitation.customerId !== target.customerId)
    ) {
      return { kind: "conflict" };
    }

    const [emailOwner] = await transaction
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        accountType: users.accountType,
        status: users.status,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${target.email}`)
      .limit(1)
      .for("update");
    const [pendingUser] =
      pendingInvitation === undefined
        ? []
        : await transaction
            .select({
              id: users.id,
              email: users.email,
              fullName: users.fullName,
              accountType: users.accountType,
              status: users.status,
              passwordHash: users.passwordHash,
            })
            .from(users)
            .where(eq(users.id, pendingInvitation.userId))
            .limit(1)
            .for("update");

    if (
      pendingInvitation !== undefined &&
      emailOwner !== undefined &&
      emailOwner.id !== pendingInvitation.userId
    ) {
      return { kind: "conflict" };
    }

    const existingUser = pendingUser ?? emailOwner;
    let userId: string;

    if (existingUser === undefined) {
      userId = randomUUID();
      await transaction.insert(users).values({
        id: userId,
        fullName: target.fullName,
        email: target.email,
        accountType: target.accountType,
        status: "invited",
        updatedAt: now,
      });
    } else {
      if (
        existingUser.accountType !== target.accountType ||
        existingUser.status !== "invited" ||
        existingUser.passwordHash !== null
      ) {
        return { kind: "conflict" };
      }

      userId = existingUser.id;

      await transaction
        .update(users)
        .set({
          email: target.email,
          fullName: target.fullName,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
    }

    if (pendingInvitation !== undefined) {
      await transaction
        .update(invitations)
        .set({
          status: "revoked",
          revokedAt: now,
        })
        .where(eq(invitations.id, pendingInvitation.id));
      await revokeQueuedInvitationEmail(transaction, pendingInvitation.id, now);
    }

    const invitationId = randomUUID();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    await transaction.insert(invitations).values({
      id: invitationId,
      userId,
      roleId: role.id,
      customerId: target.customerId,
      invitedEmail: target.email,
      tokenHash: hashOpaqueToken(rawToken),
      invitedBy: issuer.userId,
      status: "pending",
      createdAt: now,
      expiresAt,
    });

    await queueInvitationEmail(transaction, {
      invitationId,
      userId,
      email: target.email,
      accountType: target.accountType,
      fullName: target.fullName,
      customerNumber: target.customerNumber,
      token: rawToken,
      now,
    });

    await transaction.insert(accountSecurityEvents).values({
      userId,
      eventType: isResend ? "invitation_resent" : "invitation_issued",
      emailAttempted: target.email,
      userAgent: normalizedUserAgent,
      metadata: {
        invitationId,
        invitedBy: issuer.userId,
        customerId: target.customerId,
      },
      requestId,
    });

    return {
      kind: "issued",
      invitationId,
      expiresAt,
      sessionPolicy: issuer.sessionPolicy,
    };
  });
}
