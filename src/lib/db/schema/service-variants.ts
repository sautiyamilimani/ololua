import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { serviceTypes } from "./service-types";
import { unitsOfMeasure } from "./units-of-measure";

export const serviceVariants = pgTable(
  "service_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceTypeId: uuid("service_type_id").notNull().references(() => serviceTypes.id, { onDelete: "restrict" }),
    unitId: uuid("unit_id").notNull().references(() => unitsOfMeasure.id, { onDelete: "restrict" }),
    variantCode: varchar("variant_code", { length: 40 }).notNull().unique(),
    variantName: varchar("variant_name", { length: 120 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("service_variants_status_check", sql`${table.status} in ('ACTIVE', 'INACTIVE')`)],
);
