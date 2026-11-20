import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const rateLimits = pgTable(
  "rate_limits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bucketKey: text("bucket_key").notNull().unique(),
    action: varchar("action", { length: 50 }).notNull(),
    attemptCount: integer("attempt_count").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("rate_limits_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ],
);
