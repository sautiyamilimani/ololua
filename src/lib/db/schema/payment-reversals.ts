import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { customerMeterPayments } from "./customer-meter-payments";
import { users } from "./users";

export const paymentReversals = pgTable(
  "payment_reversals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id").notNull()
      .references(() => customerMeterPayments.id, { onDelete: "restrict" })
      .unique(),
    reversedBy: uuid("reversed_by").notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
