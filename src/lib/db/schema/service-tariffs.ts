import { sql } from "drizzle-orm";
import { check, date, numeric, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { serviceVariants } from "./service-variants";
import { users } from "./users";

export const serviceTariffs = pgTable(
  "service_tariffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceVariantId: uuid("service_variant_id").notNull().references(() => serviceVariants.id, { onDelete: "restrict" }),
    rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    status: varchar("status", { length: 20 }).notNull().default("DRAFT"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("service_tariffs_status_check", sql`${table.status} in ('DRAFT', 'ACTIVE', 'INACTIVE')`),
    check("service_tariffs_rate_check", sql`${table.rate} > 0`),
    check("service_tariffs_period_check", sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`),
  ],
);
