import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

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
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("customers_customer_type_check", sql`${table.customerType} in ('individual', 'business')`),
    check("customers_status_check", sql`${table.status} in ('active', 'inactive')`),
  ],
);
