import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const meters = pgTable(
  "meters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serialNumber: varchar("serial_number", { length: 50 }).notNull().unique(),
    status: varchar("status", { length: 20 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("meters_status_check", sql`${table.status} in ('ACTIVE', 'DEFECTIVE')`)],
);
