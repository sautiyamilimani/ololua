import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  roles,
  serviceTariffs,
  sessions,
  userRoles,
  users,
} from "@/lib/db/schema";
import { getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";

export type ActivateTariffResult =
  | {
      kind: "success";
      tariffId: string;
      previousTariffIds: string[];
      effectiveFrom: Date;
      sessionPolicy: SessionPolicy;
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "tariff-not-found" }
  | { kind: "tariff-not-draft" }
  | { kind: "overlap-conflict" };

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function authorizeTariffAdmin(
  transaction: DatabaseTransaction,
  sessionToken: string,
  now: Date,
) {
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
  ) return { kind: "unauthenticated" as const };

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
  ) return { kind: "unauthenticated" as const };

  const actorRoles = await transaction
    .select({ roleKey: roles.roleKey })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, actor.id));
  const roleKeys = [...new Set(actorRoles.map((row) => row.roleKey))];
  if (!roleKeys.includes("admin") && !roleKeys.includes("superadmin")) {
    return { kind: "forbidden" as const };
  }

  const sessionPolicy = getSessionPolicy("staff", roleKeys);
  await transaction
    .update(sessions)
    .set({
      lastActivityAt: now,
      idleExpiresAt: new Date(now.getTime() + sessionPolicy.idleTimeoutMs),
      expiresAt: new Date(now.getTime() + sessionPolicy.idleTimeoutMs),
    })
    .where(eq(sessions.id, session.id));

  return {
    kind: "authorized" as const,
    actorId: actor.id,
    policy: sessionPolicy,
  };
}

export async function activateTariff(
  sessionToken: string,
  tariffId: string,
): Promise<ActivateTariffResult> {
  const now = new Date();

  try {
    return await db.transaction(async (transaction) => {
      const authorization = await authorizeTariffAdmin(
        transaction,
        sessionToken,
        now,
      );
      if (authorization.kind !== "authorized") return authorization;

      const [tariff] = await transaction
        .select({
          id: serviceTariffs.id,
          serviceVariantId: serviceTariffs.serviceVariantId,
          effectiveFrom: serviceTariffs.effectiveFrom,
          effectiveTo: serviceTariffs.effectiveTo,
          status: serviceTariffs.status,
        })
        .from(serviceTariffs)
        .where(eq(serviceTariffs.id, tariffId))
        .limit(1)
        .for("update");
      if (!tariff) return { kind: "tariff-not-found" as const };
      if (tariff.status !== "DRAFT") return { kind: "tariff-not-draft" as const };
      if (tariff.effectiveTo !== null && tariff.effectiveTo < tariff.effectiveFrom) {
        return { kind: "overlap-conflict" as const };
      }

      const activeBeforeStart = await transaction
        .select({
          id: serviceTariffs.id,
          effectiveFrom: serviceTariffs.effectiveFrom,
          effectiveTo: serviceTariffs.effectiveTo,
        })
        .from(serviceTariffs)
        .where(
          and(
            eq(serviceTariffs.serviceVariantId, tariff.serviceVariantId),
            eq(serviceTariffs.status, "ACTIVE"),
            lt(serviceTariffs.effectiveFrom, tariff.effectiveFrom),
            or(
              isNull(serviceTariffs.effectiveTo),
              gt(serviceTariffs.effectiveTo, tariff.effectiveFrom),
            ),
          ),
        )
        .for("update");

      for (const previous of activeBeforeStart) {
        await transaction
          .update(serviceTariffs)
          .set({
            effectiveTo: tariff.effectiveFrom,
            updatedAt: now,
          })
          .where(eq(serviceTariffs.id, previous.id));
      }

      await transaction
        .update(serviceTariffs)
        .set({
          status: "ACTIVE",
          updatedAt: now,
        })
        .where(eq(serviceTariffs.id, tariff.id));

      await transaction.insert(auditLogs).values({
        actorUserId: authorization.actorId,
        action: "service_tariff.activate",
        entityType: "service_tariff",
        entityId: tariff.id,
        oldValues: { status: "DRAFT" },
        newValues: {
          status: "ACTIVE",
          effectiveFrom: tariff.effectiveFrom,
          effectiveTo: tariff.effectiveTo,
        },
        metadata: {
          previousTariffIds: activeBeforeStart.map((item) => item.id),
        },
        createdAt: now,
      });

      return {
        kind: "success",
        tariffId: tariff.id,
        previousTariffIds: activeBeforeStart.map((item) => item.id),
        effectiveFrom: tariff.effectiveFrom,
        sessionPolicy: authorization.policy,
      };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      typeof error.cause === "object" &&
      error.cause !== null &&
      "constraint" in error.cause &&
      error.cause.constraint === "service_tariffs_active_period_exclude"
    ) {
      return { kind: "overlap-conflict" };
    }
    throw error;
  }
}
