import { sql } from "drizzle-orm";
import { check, numeric, pgSequence, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { customerMeterAccounts } from "./customer-meter-accounts";
import { users } from "./users";

export const customerMeterPaymentReceiptNumberSequence = pgSequence(
  "customer_meter_payments_receipt_number_seq",
  { startWith: 1, increment: 1, minValue: 1 },
);

export const customerMeterPayments = pgTable(
  "customer_meter_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptNumber: varchar("receipt_number", { length: 40 }).notNull().unique(),
    externalReference: varchar("external_reference", { length: 100 }).unique(),
    customerMeterAccountId: uuid("customer_meter_account_id").notNull().references(() => customerMeterAccounts.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paymentMethod: varchar("payment_method", { length: 30 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("COMPLETED"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    payerPhone: varchar("payer_phone", { length: 20 }),
    checkoutRequestId: varchar("checkout_request_id", { length: 100 }).unique(),
    merchantRequestId: varchar("merchant_request_id", { length: 100 }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id, { onDelete: "set null" }),
    reversalReason: text("reversal_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("customer_meter_payments_id_account_unique").on(table.id, table.customerMeterAccountId),
    check("customer_meter_payments_amount_check", sql`${table.amount} > 0`),
    check("customer_meter_payments_method_check", sql`${table.paymentMethod} in ('cash', 'mpesa', 'bank', 'other')`),
    check("customer_meter_payments_status_check", sql`${table.status} in ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED')`),
  ],
);
