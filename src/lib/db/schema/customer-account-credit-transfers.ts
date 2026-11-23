import { sql } from "drizzle-orm";
import { check, numeric, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { customerMeterAccounts } from "./customer-meter-accounts";
import { users } from "./users";

export const customerAccountCreditTransfers = pgTable(
  "customer_account_credit_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromAccountId: uuid("from_account_id").notNull()
      .references(() => customerMeterAccounts.id, { onDelete: "restrict" }),
    toAccountId: uuid("to_account_id").notNull()
      .references(() => customerMeterAccounts.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    tokenHash: varchar("token_hash", { length: 64 }).unique(),
    senderTokenHash: varchar("sender_token_hash", { length: 64 }).unique(),
    recipientTokenHash: varchar("recipient_token_hash", { length: 64 }).unique(),
    recipientEmail: varchar("recipient_email", { length: 254 }),
    senderApprovedAt: timestamp("sender_approved_at", { withTimezone: true }),
    recipientConfirmedAt: timestamp("recipient_confirmed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    reversalReason: text("reversal_reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "customer_account_credit_transfers_amount_check",
      sql`${table.amount} > 0`,
    ),
    check(
      "customer_account_credit_transfers_status_check",
      sql`${table.status} in ('PENDING','CONFIRMED','REVOKED','EXPIRED','FAILED')`,
    ),
    check(
      "customer_account_credit_transfers_accounts_check",
      sql`${table.fromAccountId} <> ${table.toAccountId}`,
    ),
  ],
);
