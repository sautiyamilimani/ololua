import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const unitsOfMeasure = pgTable("units_of_measure", {
  id: uuid("id").defaultRandom().primaryKey(),
  unitCode: varchar("unit_code", { length: 20 }).notNull().unique(),
  unitName: varchar("unit_name", { length: 50 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
