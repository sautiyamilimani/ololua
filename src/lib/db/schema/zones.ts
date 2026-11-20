import { sql } from "drizzle-orm";
import { check, numeric, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const zones = pgTable(
  "zones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    zoneName: varchar("zone_name", { length: 100 }).notNull().unique(),
    county: varchar("county", { length: 60 }),
    town: varchar("town", { length: 60 }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("zones_latitude_check", sql`${table.latitude} is null or (${table.latitude} >= -90 and ${table.latitude} <= 90)`),
    check("zones_longitude_check", sql`${table.longitude} is null or (${table.longitude} >= -180 and ${table.longitude} <= 180)`),
  ],
);
