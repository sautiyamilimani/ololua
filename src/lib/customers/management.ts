import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerUserAccess,
  customers,
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
  CUSTOMER_MANAGE_PERMISSION,
} from "@/lib/auth/permissions";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";
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
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "conflict" }
  | { kind: "email-change-restricted" };

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
  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return false;
  }

  const cause = error.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    (cause.constraint === "customers_email_lower_unique" ||
      cause.constraint === "customers_customer_number_unique")
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
        physicalAddress: input.physicalAddress,
        locationDescription: input.locationDescription,
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

      if (
        input.email !== undefined &&
        input.email.toLowerCase() !== customer.email.toLowerCase()
      ) {
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

        const [pendingInvitation] = await transaction
          .select({ id: invitations.id })
          .from(invitations)
          .where(
            and(
              eq(invitations.customerId, customer.id),
              eq(invitations.status, "pending"),
              gt(invitations.expiresAt, now),
            ),
          )
          .limit(1);

        if (activeAccess || pendingInvitation) {
          return { kind: "email-change-restricted" };
        }
      }

      await transaction
        .update(customers)
        .set({ ...input, updatedAt: now })
        .where(eq(customers.id, customer.id));

      return {
        kind: "success",
        customerId: customer.id,
        updatedAt: now,
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
