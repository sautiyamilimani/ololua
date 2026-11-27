import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerEmailVerificationTokens,
  customerUserAccess,
  customers,
  emailOutbox,
  invitations,
  permissions,
  rolePermissions,
  roles,
  sessions,
  staffCustomerAccess,
  userRoles,
  users,
} from "@/lib/db/schema";
import {
  encryptSecretPayload,
  hashSecretValue,
} from "@/lib/email/secret-payload";
import {
  CUSTOMER_MANAGE_PERMISSION,
} from "@/lib/auth/permissions";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { consumeRateLimitBucket } from "@/lib/auth/rate-limit";
import { hashOpaqueToken } from "@/lib/auth/token";
import { revokeQueuedInvitationEmail } from "@/lib/auth/invitation-email";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "./input";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type AuthorizationResult =
  | {
      kind: "authorized";
      actorId: string;
      policy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" };

type CustomerMutationResult =
  | {
      kind: "success";
      customerId: string;
      customerNumber?: string;
      updatedAt?: Date;
      status?: "active" | "inactive";
      emailChanged?: boolean;
      pendingInvitationRevoked?: boolean;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "conflict" }
  | { kind: "email-change-restricted" };

type CustomerEmailVerificationResult =
  | { kind: "queued"; sessionPolicy: SessionPolicy }
  | { kind: "verified"; sessionPolicy: SessionPolicy }
  | { kind: "already-verified"; sessionPolicy: SessionPolicy }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "invalid" }
  | { kind: "rate-limited"; retryAfterSeconds: number };

type StaffCustomerAccessMutationResult =
  | {
      kind: "success";
      accessId: string;
      customerId: string;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "staff-not-found" }
  | { kind: "already-linked" }
  | { kind: "not-linked" };

function isCustomerUniqueConflict(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }
    if (
      "code" in candidate &&
      candidate.code === "23505" &&
      "constraint" in candidate &&
      (candidate.constraint === "customers_email_lower_unique" ||
        candidate.constraint === "users_email_lower_unique" ||
        candidate.constraint === "customers_customer_number_unique")
    ) {
      return true;
    }
    candidate = "cause" in candidate ? candidate.cause : null;
  }
  return false;
}

const CUSTOMER_EMAIL_OTP_CONTEXT = "customer-email-verification-otp:v1";
const CUSTOMER_EMAIL_OTP_LIFETIME_MS = 10 * 60 * 1000;
const CUSTOMER_EMAIL_OTP_ATTEMPT_LIMIT = 5;

function createCustomerEmailOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function getCustomerEmailOtpHash(
  customerId: string,
  tokenId: string,
  otp: string,
): string {
  return hashSecretValue(
    CUSTOMER_EMAIL_OTP_CONTEXT,
    `${customerId}:${tokenId}:${otp}`,
  );
}

function matchesCustomerEmailOtpHash(
  actualHash: string,
  expectedHash: string,
): boolean {
  if (
    !/^[0-9a-f]{64}$/u.test(actualHash) ||
    !/^[0-9a-f]{64}$/u.test(expectedHash)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}

async function invalidateCustomerEmailVerificationTokens(
  transaction: DatabaseTransaction,
  customerId: string,
  now: Date,
): Promise<void> {
  const activeTokens = await transaction
    .select({ id: customerEmailVerificationTokens.id })
    .from(customerEmailVerificationTokens)
    .where(
      and(
        eq(customerEmailVerificationTokens.customerId, customerId),
        isNull(customerEmailVerificationTokens.invalidatedAt),
      ),
    );
  const tokenIds = activeTokens.map((token) => token.id);

  if (tokenIds.length === 0) {
    return;
  }

  await transaction
    .update(customerEmailVerificationTokens)
    .set({ invalidatedAt: now })
    .where(inArray(customerEmailVerificationTokens.id, tokenIds));
  await transaction
    .update(emailOutbox)
    .set({
      status: "failed",
      lastError: "Customer email verification code was replaced.",
      updatedAt: now,
    })
    .where(
      and(
        inArray(
          emailOutbox.idempotencyKey,
          tokenIds.map((id) => `customer-email-verification:${id}`),
        ),
        eq(emailOutbox.status, "queued"),
      ),
    );
}

function isStaffCustomerAccessUniqueConflict(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }

    if (
      "code" in candidate &&
      candidate.code === "23505" &&
      "constraint" in candidate &&
      (candidate.constraint === "staff_customer_access_active_staff_unique" ||
        candidate.constraint === "staff_customer_access_active_customer_unique")
    ) {
      return true;
    }

    candidate = "cause" in candidate ? candidate.cause : null;
  }
  return false;
}

async function authorizeCustomerManager(
  transaction: DatabaseTransaction,
  sessionToken: string,
  now: Date,
): Promise<AuthorizationResult> {
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

  const [actor] = await transaction
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
    !actor ||
    actor.accountType !== "staff" ||
    actor.status !== "active" ||
    actor.emailVerifiedAt === null
  ) {
    return { kind: "unauthenticated" };
  }

  const actorRoles = await transaction
    .select({
      roleKey: roles.roleKey,
      permissionKey: permissions.permissionKey,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .leftJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
    .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(userRoles.userId, actor.id));

  if (
    !actorRoles.some(
      (row) => row.permissionKey === CUSTOMER_MANAGE_PERMISSION,
    )
  ) {
    return { kind: "forbidden" };
  }

  const roleKeys = [...new Set(actorRoles.map((row) => row.roleKey))];
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

  return { kind: "authorized", actorId: actor.id, policy: sessionPolicy };
}

export async function createCustomer(
  sessionToken: string,
  input: CreateCustomerInput,
): Promise<CustomerMutationResult> {
  const now = new Date();
  const customerId = randomUUID();

  try {
    return await db.transaction(async (transaction) => {
      const authorization = await authorizeCustomerManager(
        transaction,
        sessionToken,
        now,
      );

      if (authorization.kind !== "authorized") {
        return authorization;
      }

      const sequenceResult = await transaction.execute<{ next_value: string }>(
        sql`SELECT nextval('public.customers_customer_number_seq')::text AS next_value`,
      );
      const nextValue = sequenceResult.rows[0]?.next_value;

      if (!nextValue || !/^\d+$/u.test(nextValue)) {
        throw new Error("Customer number sequence returned an invalid value.");
      }

      const customerNumber = `OLO-${nextValue.padStart(6, "0")}`;

      await transaction.insert(customers).values({
        id: customerId,
        customerNumber,
        customerType: input.customerType,
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        notes: input.notes,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      return {
        kind: "success",
        customerId,
        customerNumber,
        status: "active",
        sessionPolicy: authorization.policy,
      };
    });
  } catch (error) {
    if (isCustomerUniqueConflict(error)) {
      return { kind: "conflict" };
    }

    throw error;
  }
}

export async function updateCustomer(
  sessionToken: string,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<CustomerMutationResult> {
  const now = new Date();

  try {
    return await db.transaction(async (transaction) => {
      const authorization = await authorizeCustomerManager(
        transaction,
        sessionToken,
        now,
      );

      if (authorization.kind !== "authorized") {
        return authorization;
      }

      const [customer] = await transaction
        .select({
          id: customers.id,
          email: customers.email,
          isTrashed: customers.isTrashed,
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1)
        .for("update");

      if (!customer) {
        return { kind: "not-found" };
      }
      if (customer.isTrashed) {
        return { kind: "not-found" };
      }

      const emailChanged =
        input.email !== undefined &&
        input.email.toLowerCase() !== customer.email.toLowerCase();
      let pendingInvitationId: string | null = null;
      if (emailChanged) {
        const [activeAccess] = await transaction
          .select({ id: customerUserAccess.id })
          .from(customerUserAccess)
          .where(
            and(
              eq(customerUserAccess.customerId, customer.id),
              isNull(customerUserAccess.revokedAt),
            ),
          )
          .limit(1);

        if (activeAccess) {
          return { kind: "email-change-restricted" };
        }

        const [pendingInvitation] = await transaction
          .select({
            id: invitations.id,
            userId: invitations.userId,
          })
          .from(invitations)
          .where(
            and(
              eq(invitations.customerId, customer.id),
              eq(invitations.status, "pending"),
            ),
          )
          .limit(1)
          .for("update");

        if (pendingInvitation) {
          const [emailOwner] = await transaction
            .select({
              id: users.id,
            })
            .from(users)
            .where(sql`lower(${users.email}) = ${input.email}`)
            .limit(1)
            .for("update");
          const [pendingUser] = await transaction
            .select({
              id: users.id,
              accountType: users.accountType,
              status: users.status,
              passwordHash: users.passwordHash,
            })
            .from(users)
            .where(eq(users.id, pendingInvitation.userId))
            .limit(1)
            .for("update");

          if (
            emailOwner &&
            emailOwner.id !== pendingInvitation.userId
          ) {
            return { kind: "conflict" };
          }
          if (
            !pendingUser ||
            pendingUser.accountType !== "customer" ||
            pendingUser.status !== "invited" ||
            pendingUser.passwordHash !== null
          ) {
            return { kind: "email-change-restricted" };
          }

          await transaction
            .update(invitations)
            .set({ status: "revoked", revokedAt: now })
            .where(eq(invitations.id, pendingInvitation.id));
          await revokeQueuedInvitationEmail(
            transaction,
            pendingInvitation.id,
            now,
          );
          await transaction
            .update(users)
            .set({ email: input.email, updatedAt: now })
            .where(eq(users.id, pendingUser.id));
          pendingInvitationId = pendingInvitation.id;
        }
      }

      await transaction
        .update(customers)
        .set({
          ...input,
          ...(emailChanged ? { emailVerifiedAt: null } : {}),
          updatedAt: now,
        })
        .where(eq(customers.id, customer.id));

      if (emailChanged) {
        await invalidateCustomerEmailVerificationTokens(
          transaction,
          customer.id,
          now,
        );
        await transaction.insert(auditLogs).values({
          actorUserId: authorization.actorId,
          action: "customer.email_changed",
          entityType: "customer",
          entityId: customer.id,
          oldValues: { email: customer.email },
          newValues: {
            email: input.email,
            emailVerifiedAt: null,
            pendingInvitationRevoked: pendingInvitationId !== null,
          },
          createdAt: now,
        });
      }

      return {
        kind: "success",
        customerId: customer.id,
        updatedAt: now,
        emailChanged,
        pendingInvitationRevoked: pendingInvitationId !== null,
        sessionPolicy: authorization.policy,
      };
    });
  } catch (error) {
    if (isCustomerUniqueConflict(error)) {
      return { kind: "conflict" };
    }

    throw error;
  }
}

export async function requestCustomerEmailVerification(
  sessionToken: string,
  customerId: string,
  ipAddress: string | null,
): Promise<CustomerEmailVerificationResult> {
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeCustomerManager(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") {
      return authorization;
    }

    const [customer] = await transaction
      .select({
        id: customers.id,
        fullName: customers.fullName,
        customerNumber: customers.customerNumber,
        email: customers.email,
        emailVerifiedAt: customers.emailVerifiedAt,
        isTrashed: customers.isTrashed,
      })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1)
      .for("update");
    if (!customer || customer.isTrashed) {
      return { kind: "not-found" };
    }
    if (customer.emailVerifiedAt !== null) {
      return {
        kind: "already-verified",
        sessionPolicy: authorization.policy,
      };
    }

    const accountLimit = await consumeRateLimitBucket(
      transaction,
      {
        action: "customer_email_verification_account",
        identity: customer.id,
        maximum: 3,
        windowMs: 60 * 60 * 1000,
      },
      now,
    );
    const ipLimit = await consumeRateLimitBucket(
      transaction,
      {
        action: "customer_email_verification_request_ip",
        identity: ipAddress ?? "unknown",
        maximum: 10,
        windowMs: 15 * 60 * 1000,
      },
      now,
    );
    if (!accountLimit.allowed || !ipLimit.allowed) {
      return {
        kind: "rate-limited",
        retryAfterSeconds: Math.max(
          accountLimit.allowed ? 0 : accountLimit.retryAfterSeconds,
          ipLimit.allowed ? 0 : ipLimit.retryAfterSeconds,
        ),
      };
    }

    await invalidateCustomerEmailVerificationTokens(
      transaction,
      customer.id,
      now,
    );

    const tokenId = randomUUID();
    const otp = createCustomerEmailOtp();
    const expiresAt = new Date(
      now.getTime() + CUSTOMER_EMAIL_OTP_LIFETIME_MS,
    );
    await transaction.insert(customerEmailVerificationTokens).values({
      id: tokenId,
      customerId: customer.id,
      email: customer.email,
      tokenHash: getCustomerEmailOtpHash(customer.id, tokenId, otp),
      createdAt: now,
      expiresAt,
    });
    await transaction.insert(emailOutbox).values({
      recipientEmail: customer.email,
      templateKey: "customer_email_verification",
      templateData: {
        fullName: customer.fullName,
        customerNumber: customer.customerNumber,
      },
      secretPayloadEncrypted: encryptSecretPayload(
        JSON.stringify({ otp }),
      ),
      status: "queued",
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: now,
      idempotencyKey: `customer-email-verification:${tokenId}`,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: "customer.email_verification_requested",
      entityType: "customer",
      entityId: customer.id,
      oldValues: null,
      newValues: { email: customer.email },
      createdAt: now,
    });

    return { kind: "queued", sessionPolicy: authorization.policy };
  });
}

export async function verifyCustomerEmail(
  sessionToken: string,
  customerId: string,
  otp: string,
  ipAddress: string | null,
): Promise<CustomerEmailVerificationResult> {
  if (!/^\d{6}$/u.test(otp)) {
    return { kind: "invalid" };
  }

  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeCustomerManager(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") {
      return authorization;
    }

    const [customer] = await transaction
      .select({
        id: customers.id,
        email: customers.email,
        emailVerifiedAt: customers.emailVerifiedAt,
        isTrashed: customers.isTrashed,
      })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1)
      .for("update");
    if (!customer || customer.isTrashed) {
      return { kind: "not-found" };
    }
    if (customer.emailVerifiedAt !== null) {
      return {
        kind: "already-verified",
        sessionPolicy: authorization.policy,
      };
    }

    const ipLimit = await consumeRateLimitBucket(
      transaction,
      {
        action: "customer_email_verification_verify_ip",
        identity: ipAddress ?? "unknown",
        maximum: 20,
        windowMs: 15 * 60 * 1000,
      },
      now,
    );
    if (!ipLimit.allowed) {
      return {
        kind: "rate-limited",
        retryAfterSeconds: ipLimit.retryAfterSeconds,
      };
    }

    const [challenge] = await transaction
      .select({
        id: customerEmailVerificationTokens.id,
        email: customerEmailVerificationTokens.email,
        tokenHash: customerEmailVerificationTokens.tokenHash,
        expiresAt: customerEmailVerificationTokens.expiresAt,
      })
      .from(customerEmailVerificationTokens)
      .where(
        and(
          eq(customerEmailVerificationTokens.customerId, customer.id),
          eq(customerEmailVerificationTokens.email, customer.email),
          isNull(customerEmailVerificationTokens.invalidatedAt),
          gt(customerEmailVerificationTokens.expiresAt, now),
        ),
      )
      .orderBy(desc(customerEmailVerificationTokens.createdAt))
      .limit(1)
      .for("update");

    if (!challenge) {
      return { kind: "invalid" };
    }

    const matches = matchesCustomerEmailOtpHash(
      challenge.tokenHash,
      getCustomerEmailOtpHash(customer.id, challenge.id, otp),
    );
    if (!matches) {
      const attemptLimit = await consumeRateLimitBucket(
        transaction,
        {
          action: "customer_email_verification_attempt",
          identity: challenge.id,
          maximum: CUSTOMER_EMAIL_OTP_ATTEMPT_LIMIT,
          windowMs: CUSTOMER_EMAIL_OTP_LIFETIME_MS,
        },
        now,
      );
      if (!attemptLimit.allowed || attemptLimit.attemptCount >= CUSTOMER_EMAIL_OTP_ATTEMPT_LIMIT) {
        await transaction
          .update(customerEmailVerificationTokens)
          .set({ invalidatedAt: now })
          .where(eq(customerEmailVerificationTokens.id, challenge.id));
      }
      if (!attemptLimit.allowed) {
        return {
          kind: "rate-limited",
          retryAfterSeconds: attemptLimit.retryAfterSeconds,
        };
      }
      return { kind: "invalid" };
    }

    await transaction
      .update(customerEmailVerificationTokens)
      .set({ verifiedAt: now, invalidatedAt: now })
      .where(eq(customerEmailVerificationTokens.id, challenge.id));
    await transaction
      .update(customers)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(customers.id, customer.id));
    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: "customer.email_verified",
      entityType: "customer",
      entityId: customer.id,
      oldValues: { emailVerifiedAt: null },
      newValues: {
        email: customer.email,
        emailVerifiedAt: now.toISOString(),
      },
      createdAt: now,
    });

    return { kind: "verified", sessionPolicy: authorization.policy };
  });
}

export async function deleteCustomer(
  sessionToken: string,
  customerId: string,
): Promise<CustomerMutationResult> {
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeCustomerManager(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") {
      return authorization;
    }

    const [customer] = await transaction
      .select({
        id: customers.id,
        customerNumber: customers.customerNumber,
        status: customers.status,
        isTrashed: customers.isTrashed,
      })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1)
      .for("update");

    if (!customer) {
      return { kind: "not-found" };
    }
    if (customer.isTrashed) {
      return { kind: "conflict" };
    }

    await transaction
      .update(customers)
      .set({
        status: "inactive",
        isTrashed: true,
        trashedAt: now,
        trashedBy: authorization.actorId,
        updatedAt: now,
      })
      .where(eq(customers.id, customer.id));
    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: "customer.delete",
      entityType: "customer",
      entityId: customer.id,
      oldValues: {
        customerNumber: customer.customerNumber,
        status: customer.status,
        isTrashed: false,
      },
      newValues: {
        status: "inactive",
        isTrashed: true,
        trashedAt: now.toISOString(),
      },
      createdAt: now,
    });

    return {
      kind: "success",
      customerId: customer.id,
      sessionPolicy: authorization.policy,
    };
  });
}

export async function linkStaffCustomerAccess(
  sessionToken: string,
  staffUserId: string,
  customerId: string,
): Promise<StaffCustomerAccessMutationResult> {
  const now = new Date();

  try {
    return await db.transaction(async (transaction) => {
      const authorization = await authorizeCustomerManager(
        transaction,
        sessionToken,
        now,
      );
      if (authorization.kind !== "authorized") {
        return authorization;
      }

      const [staff] = await transaction
        .select({
          id: users.id,
          accountType: users.accountType,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, staffUserId))
        .limit(1)
        .for("update");
      if (!staff || staff.accountType !== "staff" || staff.status !== "active") {
        return { kind: "staff-not-found" };
      }

      const [customer] = await transaction
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.isTrashed, false)))
        .limit(1)
        .for("update");
      if (!customer) {
        return { kind: "not-found" };
      }

      const [staffAccess] = await transaction
        .select({ id: staffCustomerAccess.id })
        .from(staffCustomerAccess)
        .where(
          and(
            eq(staffCustomerAccess.staffUserId, staffUserId),
            isNull(staffCustomerAccess.revokedAt),
          ),
        )
        .limit(1);
      const [customerAccess] = await transaction
        .select({ id: staffCustomerAccess.id })
        .from(staffCustomerAccess)
        .where(
          and(
            eq(staffCustomerAccess.customerId, customerId),
            isNull(staffCustomerAccess.revokedAt),
          ),
        )
        .limit(1);
      if (staffAccess || customerAccess) {
        return { kind: "already-linked" };
      }

      const [access] = await transaction
        .insert(staffCustomerAccess)
        .values({
          staffUserId,
          customerId,
          linkedBy: authorization.actorId,
          createdAt: now,
        })
        .returning({ id: staffCustomerAccess.id });
      if (!access) {
        throw new Error("Staff customer access insert returned no row.");
      }

      await transaction.insert(auditLogs).values({
        actorUserId: authorization.actorId,
        action: "staff_customer_access.link",
        entityType: "staff_customer_access",
        entityId: access.id,
        oldValues: null,
        newValues: { staffUserId, customerId },
        createdAt: now,
      });

      return {
        kind: "success",
        accessId: access.id,
        customerId,
        sessionPolicy: authorization.policy,
      };
    });
  } catch (error) {
    if (isStaffCustomerAccessUniqueConflict(error)) {
      return { kind: "already-linked" };
    }
    throw error;
  }
}

export async function revokeStaffCustomerAccess(
  sessionToken: string,
  staffUserId: string,
): Promise<StaffCustomerAccessMutationResult> {
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeCustomerManager(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") {
      return authorization;
    }

    const [staff] = await transaction
      .select({ id: users.id, accountType: users.accountType })
      .from(users)
      .where(eq(users.id, staffUserId))
      .limit(1)
      .for("update");
    if (!staff || staff.accountType !== "staff") {
      return { kind: "staff-not-found" };
    }

    const [access] = await transaction
      .select({
        id: staffCustomerAccess.id,
        customerId: staffCustomerAccess.customerId,
      })
      .from(staffCustomerAccess)
      .where(
        and(
          eq(staffCustomerAccess.staffUserId, staffUserId),
          isNull(staffCustomerAccess.revokedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!access) {
      return { kind: "not-linked" };
    }

    await transaction
      .update(staffCustomerAccess)
      .set({ revokedAt: now, revokedBy: authorization.actorId })
      .where(eq(staffCustomerAccess.id, access.id));
    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: "staff_customer_access.revoke",
      entityType: "staff_customer_access",
      entityId: access.id,
      oldValues: { staffUserId, customerId: access.customerId },
      newValues: { revokedAt: now.toISOString() },
      createdAt: now,
    });

    return {
      kind: "success",
      accessId: access.id,
      customerId: access.customerId,
      sessionPolicy: authorization.policy,
    };
  });
}
