import { sql } from "drizzle-orm";
import { boolean, check, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { roles } from "./roles";
import { users } from "./users";

export const superadminAssignments = pgTable(
  "superadmin_assignments",
  {
    singletonKey: boolean("singleton_key").notNull().default(true),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.singletonKey] }),
    check(
      "superadmin_assignments_singleton_key_check",
      sql`${table.singletonKey} is true`,
    ),
  ],
);
