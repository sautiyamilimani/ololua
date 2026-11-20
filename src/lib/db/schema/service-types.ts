import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const serviceTypes = pgTable(
  "service_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceCode: varchar("service_code", { length: 30 }).notNull().unique(),
    serviceName: varchar("service_name", { length: 100 }).notNull().unique(),
    description: text("description"),
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "service_types_status_check",
      sql`${table.status} in ('ACTIVE', 'INACTIVE')`,
    ),
  ],
);
