import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  customerMeterAccounts,
  customers,
  serviceVariants,
  zones,
} from "@/lib/db/schema";
import type { CreateCustomerMeterAccountRecordInput } from "./input";
import { getServiceVariantCategory } from "./service-variant-category";

export type CreateCustomerMeterAccountResult =
  | {
      kind: "success";
      accountId: string;
      accountNumber: string;
    }
  | { kind: "customer-not-found" }
  | { kind: "customer-inactive" }
  | { kind: "service-variant-not-found" }
  | { kind: "service-variant-inactive" }
  | { kind: "domestic-account-exists" }
  | { kind: "zone-not-found" };

export async function createCustomerMeterAccount(
  input: CreateCustomerMeterAccountRecordInput,
): Promise<CreateCustomerMeterAccountResult> {
  const now = new Date();

  return db.transaction(async (transaction) => {
    const [customer] = await transaction
      .select({ status: customers.status, isTrashed: customers.isTrashed })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1)
      .for("update");

    if (!customer) {
      return { kind: "customer-not-found" } as const;
    }
    if (customer.isTrashed) {
      return { kind: "customer-inactive" } as const;
    }
    if (customer.status !== "active") {
      return { kind: "customer-inactive" } as const;
    }

    const [variant] = await transaction
      .select({
        status: serviceVariants.status,
        variantCode: serviceVariants.variantCode,
      })
      .from(serviceVariants)
      .where(eq(serviceVariants.id, input.serviceVariantId))
      .limit(1)
      .for("update");

    if (!variant) {
      return { kind: "service-variant-not-found" } as const;
    }
    if (variant.status !== "ACTIVE") {
      return { kind: "service-variant-inactive" } as const;
    }

    if (getServiceVariantCategory(variant.variantCode) === "domestic") {
      const [existingDomesticAccount] = await transaction
        .select({ id: customerMeterAccounts.id })
        .from(customerMeterAccounts)
        .innerJoin(
          serviceVariants,
          eq(customerMeterAccounts.serviceVariantId, serviceVariants.id),
        )
        .where(
          and(
            eq(customerMeterAccounts.customerId, input.customerId),
            ne(customerMeterAccounts.status, "CLOSED"),
            sql`upper(${serviceVariants.variantCode}) like '%DOMESTIC%'`,
          ),
        )
        .limit(1);

      if (existingDomesticAccount) {
        return { kind: "domestic-account-exists" } as const;
      }
    }

    if (input.zoneId !== null) {
      const [zone] = await transaction
        .select({ id: zones.id })
        .from(zones)
        .where(eq(zones.id, input.zoneId))
        .limit(1)
        .for("update");
      if (!zone) {
        return { kind: "zone-not-found" } as const;
      }
    }

    const sequenceResult = await transaction.execute<{ next_value: string }>(
      sql`SELECT nextval('public.customer_meter_accounts_account_number_seq')::text AS next_value`,
    );
    const nextValue = sequenceResult.rows[0]?.next_value;
    if (!nextValue || !/^\d+$/u.test(nextValue)) {
      throw new Error("Customer meter account number sequence returned an invalid value.");
    }
    const accountNumber = `OLO-${nextValue.padStart(6, "0")}`;
    const accountId = randomUUID();

    await transaction.insert(customerMeterAccounts).values({
      id: accountId,
      accountNumber,
      customerId: input.customerId,
      serviceVariantId: input.serviceVariantId,
      zoneId: input.zoneId,
      notes: input.notes,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });

    return { kind: "success", accountId, accountNumber } as const;
  });
}
