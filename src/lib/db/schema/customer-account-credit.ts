import { sql } from "drizzle-orm";
import { check, numeric, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { customerMeterAccounts } from "./customer-meter-accounts";
import { users } from "./users";
import { customerMeterPayments } from "./customer-meter-payments";
import { customerAccountCreditTransfers } from "./customer-account-credit-transfers";

export const customerAccountCreditEntries = pgTable(
  "customer_account_credit_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerMeterAccountId: uuid("customer_meter_account_id").notNull()
      .references(() => customerMeterAccounts.id, { onDelete: "restrict" }),
    entryType: varchar("entry_type", { length: 40 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paymentId: uuid("payment_id").references(() => customerMeterPayments.id, { onDelete: "restrict" }),
    transferId: uuid("transfer_id").references(() => customerAccountCreditTransfers.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull().unique(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "customer_account_credit_entries_type_check",
      sql`${table.entryType} in ('PAYMENT_CREDIT','ALLOCATION','TRANSFER_IN','TRANSFER_OUT','REVERSAL')`,
    ),
    check(
      "customer_account_credit_entries_amount_check",
      sql`${table.amount} <> 0`,
    ),
  ],
);
