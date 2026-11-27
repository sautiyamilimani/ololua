import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";

export const customerEmailVerificationTokens = pgTable(
  "customer_email_verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    email: varchar("email", { length: 254 }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "customer_email_verification_tokens_expiry_check",
      sql`${table.expiresAt} >= ${table.createdAt}`,
    ),
    uniqueIndex("customer_email_verification_tokens_active_customer_unique")
      .on(table.customerId)
      .where(sql`${table.invalidatedAt} is null`),
  ],
);
