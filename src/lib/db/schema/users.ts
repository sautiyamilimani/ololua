import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  timestamp,
  text,
  uuid,
  varchar,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 20 }),
    passwordHash: text("password_hash"),
    accountType: varchar("account_type", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_lower_unique")
      .on(sql`lower(${table.email})`),
    uniqueIndex("users_phone_number_unique")
      .on(table.phoneNumber),
    check(
      "users_account_type_check",
      sql`${table.accountType} in ('staff', 'customer')`,
    ),
    check(
      "users_status_check",
      sql`${table.status} in ('invited', 'active', 'suspended', 'disabled')`,
    ),
    check(
      "users_failed_login_count_check",
      sql`${table.failedLoginCount} >= 0`,
    ),
  ],
);
