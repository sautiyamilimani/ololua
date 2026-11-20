import { sql } from "drizzle-orm";
import { check, date, numeric, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { customerMeterAccounts } from "./customer-meter-accounts";
import { meterReadings } from "./meter-readings";
import { serviceTariffs } from "./service-tariffs";
import { users } from "./users";

export const customerMeterBillings = pgTable(
  "customer_meter_billings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: varchar("invoice_number", { length: 40 }).notNull().unique(),
    customerMeterAccountId: uuid("customer_meter_account_id").notNull().references(() => customerMeterAccounts.id, { onDelete: "restrict" }),
    meterReadingId: uuid("meter_reading_id").notNull().references(() => meterReadings.id, { onDelete: "restrict" }).unique(),
    serviceTariffId: uuid("service_tariff_id").notNull().references(() => serviceTariffs.id, { onDelete: "restrict" }),
    billingPeriodStart: date("billing_period_start").notNull(),
    billingPeriodEnd: date("billing_period_end").notNull(),
    previousReading: numeric("previous_reading", { precision: 12, scale: 3 }).notNull(),
    currentReading: numeric("current_reading", { precision: 12, scale: 3 }).notNull(),
    consumption: numeric("consumption", { precision: 12, scale: 3 }).notNull(),
    tariffRate: numeric("tariff_rate", { precision: 12, scale: 2 }).notNull(),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    dueDate: date("due_date").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("UNPAID"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("customer_meter_billings_id_account_unique").on(table.id, table.customerMeterAccountId),
    check("customer_meter_billings_status_check", sql`${table.status} in ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED')`),
    check("customer_meter_billings_period_check", sql`${table.billingPeriodEnd} >= ${table.billingPeriodStart}`),
    check("customer_meter_billings_consumption_check", sql`${table.consumption} = ${table.currentReading} - ${table.previousReading}`),
    check("customer_meter_billings_amount_check", sql`${table.totalAmount} >= 0`),
  ],
);
