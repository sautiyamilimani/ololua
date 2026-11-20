import { sql } from "drizzle-orm";
import { check, customType, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

const bytea = customType<{ data: Uint8Array }>({
  dataType: () => "bytea",
});

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
    recipientEmail: varchar("recipient_email", { length: 254 }).notNull(),
    templateKey: varchar("template_key", { length: 100 }).notNull(),
    templateData: jsonb("template_data"),
    secretPayloadEncrypted: bytea("secret_payload_encrypted"),
    status: varchar("status", { length: 20 }).notNull(),
    attempts: integer("attempts").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 100 }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    lastError: text("last_error"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).unique(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("email_outbox_status_check", sql`${table.status} in ('queued', 'sending', 'sent', 'failed')`),
    check("email_outbox_attempts_check", sql`${table.attempts} >= 0`),
    check("email_outbox_max_attempts_check", sql`${table.maxAttempts} >= 1`),
  ],
);
