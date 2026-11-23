import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  pgSequence,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const customerNumberSequence = pgSequence(
  "customers_customer_number_seq",
  { startWith: 1, increment: 1, minValue: 1 },
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerNumber: varchar("customer_number", { length: 30 }).notNull().unique(),
    customerType: varchar("customer_type", { length: 20 }).notNull(),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    physicalAddress: text("physical_address"),
    locationDescription: text("location_description"),
    status: varchar("status", { length: 20 }).notNull(),
    isTrashed: boolean("is_trashed").notNull().default(false),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    trashedBy: uuid("trashed_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("customers_customer_type_check", sql`${table.customerType} in ('individual', 'business')`),
    check("customers_status_check", sql`${table.status} in ('active', 'inactive')`),
    uniqueIndex("customers_email_lower_unique")
      .on(sql`lower(${table.email})`),
  ],
);
