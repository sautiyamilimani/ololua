import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  permissionKey: varchar("permission_key", { length: 100 }).notNull().unique(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  description: text("description"),
  module: varchar("module", { length: 50 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
