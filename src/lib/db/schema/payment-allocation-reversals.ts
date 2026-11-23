import { sql } from "drizzle-orm";
import { check, foreignKey, numeric, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { customerMeterPaymentAllocations } from "./customer-meter-payment-allocations";
import { customerMeterAccounts } from "./customer-meter-accounts";
import { customerMeterBillings } from "./customer-meter-billings";
import { customerMeterPayments } from "./customer-meter-payments";
import { paymentReversals } from "./payment-reversals";
import { users } from "./users";

export const paymentAllocationReversals = pgTable(
  "payment_allocation_reversals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reversalId: uuid("reversal_id").notNull()
      .references(() => paymentReversals.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id").notNull(),
    billingId: uuid("billing_id").notNull(),
    customerMeterAccountId: uuid("customer_meter_account_id").notNull(),
    reversedAmount: numeric("reversed_amount", { precision: 12, scale: 2 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.paymentId, table.customerMeterAccountId],
      foreignColumns: [customerMeterPayments.id, customerMeterPayments.customerMeterAccountId],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.billingId, table.customerMeterAccountId],
      foreignColumns: [customerMeterBillings.id, customerMeterBillings.customerMeterAccountId],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.customerMeterAccountId],
      foreignColumns: [customerMeterAccounts.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.paymentId, table.billingId],
      foreignColumns: [customerMeterPaymentAllocations.paymentId, customerMeterPaymentAllocations.billingId],
    }).onDelete("restrict"),
    check(
      "payment_allocation_reversals_amount_check",
      sql`${table.reversedAmount} > 0`,
    ),
  ],
);
