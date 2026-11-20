import { sql } from "drizzle-orm";
import { check, foreignKey, numeric, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { customerMeterAccounts } from "./customer-meter-accounts";
import { customerMeterBillings } from "./customer-meter-billings";
import { customerMeterPayments } from "./customer-meter-payments";
import { users } from "./users";

export const customerMeterPaymentAllocations = pgTable(
  "customer_meter_payment_allocations",
  {
    paymentId: uuid("payment_id").notNull(),
    billingId: uuid("billing_id").notNull(),
    customerMeterAccountId: uuid("customer_meter_account_id").notNull(),
    allocatedAmount: numeric("allocated_amount", { precision: 12, scale: 2 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.paymentId, table.billingId] }),
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
    check("customer_meter_payment_allocations_amount_check", sql`${table.allocatedAmount} > 0`),
  ],
);
