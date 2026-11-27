import { sql } from "drizzle-orm";
import { pgTable, numeric, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { customerMeterAccounts } from "./customer-meter-accounts";
import { meters } from "./meters";
import { users } from "./users";

export const meterAssignments = pgTable(
  "meter_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    meterId: uuid("meter_id").notNull().references(() => meters.id, { onDelete: "restrict" }),
    customerMeterAccountId: uuid("customer_meter_account_id").notNull().references(() => customerMeterAccounts.id, { onDelete: "restrict" }),
    initialReading: numeric("initial_reading", { precision: 12, scale: 3 }).notNull(),
    locationDescription: text("location_description"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id, { onDelete: "set null" }),
    removalReason: text("removal_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("meter_assignments_active_meter_unique").on(table.meterId).where(sql`${table.removedAt} is null`),
  ],
);
