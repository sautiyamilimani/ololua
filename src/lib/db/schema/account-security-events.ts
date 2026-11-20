import { pgTable, inet, jsonb, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const accountSecurityEvents = pgTable("account_security_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 60 }).notNull(),
  emailAttempted: varchar("email_attempted", { length: 254 }),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  requestId: uuid("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
