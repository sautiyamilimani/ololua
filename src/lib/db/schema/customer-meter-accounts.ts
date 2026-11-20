import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { zones } from "./zones";
import { serviceVariants } from "./service-variants";

export const customerMeterAccounts = pgTable(
  "customer_meter_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountNumber: varchar("account_number", { length: 30 }).notNull().unique(),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
    serviceVariantId: uuid("service_variant_id").notNull().references(() => serviceVariants.id, { onDelete: "restrict" }),
    zoneId: uuid("zone_id").references(() => zones.id, { onDelete: "set null" }),
    propertyAddress: text("property_address").notNull(),
    locationDescription: text("location_description"),
    notes: text("notes"),
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("customer_meter_accounts_status_check", sql`${table.status} in ('ACTIVE', 'SUSPENDED', 'CLOSED')`)],
);
