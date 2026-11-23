import { sql } from "drizzle-orm";
import { pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { users } from "./users";

export const staffCustomerAccess = pgTable(
  "staff_customer_access",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    linkedBy: uuid("linked_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("staff_customer_access_active_staff_unique")
      .on(table.staffUserId)
      .where(sql`${table.revokedAt} is null`),
    uniqueIndex("staff_customer_access_active_customer_unique")
      .on(table.customerId)
      .where(sql`${table.revokedAt} is null`),
  ],
);
