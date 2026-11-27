import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  customerMeterAccounts,
  customers,
  serviceVariants,
} from "@/lib/db/schema";
import {
  authorizeCustomerMeterAccountManager,
  type AuthorizedCustomerMeterAccountManager,
} from "./authorization";
import {
  getCustomerMeterAccountStatusAfterTransition,
  type CustomerMeterAccountStatus,
  type CustomerMeterAccountTransition,
} from "./lifecycle-state";
import { getServiceVariantCategory } from "./service-variant-category";

export type LifecycleResult =
  | {
      kind: "success";
      accountId: string;
      previousStatus: CustomerMeterAccountStatus;
      status: CustomerMeterAccountStatus;
      updatedAt: Date;
      sessionPolicy: AuthorizedCustomerMeterAccountManager["policy"];
    }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "invalid-transition" }
  | { kind: "domestic-account-exists" };

export async function transitionCustomerMeterAccount(
  sessionToken: string,
  accountId: string,
  transition: CustomerMeterAccountTransition,
  reason?: string,
): Promise<LifecycleResult> {
  const now = new Date();

  return db.transaction(async (transaction) => {
    const authorization = await authorizeCustomerMeterAccountManager(
      transaction,
      sessionToken,
      now,
    );
    if (authorization.kind !== "authorized") {
      return authorization;
    }

    const [accountReference] = await transaction
      .select({
        customerId: customerMeterAccounts.customerId,
      })
      .from(customerMeterAccounts)
      .where(eq(customerMeterAccounts.id, accountId))
      .limit(1);

    if (!accountReference) {
      return { kind: "not-found" as const };
    }

    await transaction
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, accountReference.customerId))
      .for("update");

    const [account] = await transaction
      .select({
        id: customerMeterAccounts.id,
        customerId: customerMeterAccounts.customerId,
        serviceVariantId: customerMeterAccounts.serviceVariantId,
        status: customerMeterAccounts.status,
      })
      .from(customerMeterAccounts)
      .where(eq(customerMeterAccounts.id, accountId))
      .limit(1)
      .for("update");

    if (!account || account.customerId !== accountReference.customerId) {
      return { kind: "not-found" as const };
    }

    const previousStatus = account.status as CustomerMeterAccountStatus;
    const nextStatus = getCustomerMeterAccountStatusAfterTransition(
      previousStatus,
      transition,
    );
    if (nextStatus === null) {
      return { kind: "invalid-transition" as const };
    }

    const [variant] = await transaction
      .select({ variantCode: serviceVariants.variantCode })
      .from(serviceVariants)
      .where(eq(serviceVariants.id, account.serviceVariantId))
      .limit(1);
    if (!variant) {
      throw new Error("Customer meter account references a missing service variant.");
    }

    if (
      nextStatus !== "CLOSED" &&
      getServiceVariantCategory(variant.variantCode) === "domestic"
    ) {
      const [existingDomesticAccount] = await transaction
        .select({ id: customerMeterAccounts.id })
        .from(customerMeterAccounts)
        .innerJoin(
          serviceVariants,
          eq(customerMeterAccounts.serviceVariantId, serviceVariants.id),
        )
        .where(
          and(
            eq(customerMeterAccounts.customerId, account.customerId),
            ne(customerMeterAccounts.id, account.id),
            ne(customerMeterAccounts.status, "CLOSED"),
            sql`upper(${serviceVariants.variantCode}) like '%DOMESTIC%'`,
          ),
        )
        .limit(1);

      if (existingDomesticAccount) {
        return { kind: "domestic-account-exists" as const };
      }
    }

    await transaction
      .update(customerMeterAccounts)
      .set({
        status: nextStatus,
        updatedAt: now,
      })
      .where(eq(customerMeterAccounts.id, account.id));

    await transaction.insert(auditLogs).values({
      actorUserId: authorization.actorId,
      action: `customer_meter_account.${transition.toLowerCase()}`,
      entityType: "customer_meter_account",
      entityId: account.id,
      oldValues: { status: previousStatus },
      newValues: { status: nextStatus },
      metadata: reason ? { reason: reason.trim() } : null,
      createdAt: now,
    });

    return {
      kind: "success",
      accountId: account.id,
      previousStatus,
      status: nextStatus,
      updatedAt: now,
      sessionPolicy: authorization.policy,
    };
  });
}
