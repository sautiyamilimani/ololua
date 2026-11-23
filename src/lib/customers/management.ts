import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
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

  return { kind: "authorized", policy: sessionPolicy };
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
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1)
        .for("update");

      if (!customer) {
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
