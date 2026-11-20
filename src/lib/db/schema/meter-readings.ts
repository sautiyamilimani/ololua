import { sql } from "drizzle-orm";
import { boolean, check, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { meterAssignments } from "./meter-assignments";
import { users } from "./users";

export const meterReadings = pgTable(
  "meter_readings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    meterAssignmentId: uuid("meter_assignment_id").notNull().references(() => meterAssignments.id, { onDelete: "restrict" }),
    readingAt: timestamp("reading_at", { withTimezone: true }).notNull(),
    previousReading: numeric("previous_reading", { precision: 12, scale: 3 }).notNull(),
    currentReading: numeric("current_reading", { precision: 12, scale: 3 }).notNull(),
    consumption: numeric("consumption", { precision: 12, scale: 3 }).notNull(),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull().unique(),
    unusualConsumptionFlag: boolean("unusual_consumption_flag").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("meter_readings_current_check", sql`${table.currentReading} >= ${table.previousReading}`),
    check("meter_readings_consumption_check", sql`${table.consumption} = ${table.currentReading} - ${table.previousReading}`),
    uniqueIndex("meter_readings_assignment_time_unique").on(table.meterAssignmentId, table.readingAt),
  ],
);
