import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLogs,
  roles,
  sessions,
  settings,
  userRoles,
  users,
} from "@/lib/db/schema";
import { canManageStaffAccounts, getSessionPolicy, type SessionPolicy } from "@/lib/auth/policy";
import { hashOpaqueToken } from "@/lib/auth/token";
import type { PartialSettingsUpdateInput } from "./input";

export type SettingsUpdateResult =
  | { kind: "success"; updatedAt: Date; sessionPolicy: SessionPolicy }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" };

const SMS_TEMPLATE_KEYS = {
  paymentReminderTemplate: "sms_payment_reminder_template",
  paymentConfirmationTemplate: "sms_payment_confirmation_template",
  newBillTemplate: "sms_new_bill_template",
  announcementTemplate: "sms_announcement_template",
} as const;

export async function updateSettings(
  sessionToken: string,
  input: PartialSettingsUpdateInput,
): Promise<SettingsUpdateResult> {
  const now = new Date();
  return db.transaction(async (transaction) => {
    const [session] = await transaction
      .select({
        id: sessions.id,
        userId: sessions.userId,
        revokedAt: sessions.revokedAt,
        idleExpiresAt: sessions.idleExpiresAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashOpaqueToken(sessionToken)))
      .limit(1)
      .for("update");
    if (
      !session ||
      session.revokedAt !== null ||
      session.idleExpiresAt <= now ||
      session.expiresAt <= now
    ) {
      return { kind: "unauthenticated" as const };
    }

    const [actor] = await transaction
      .select({
        id: users.id,
        accountType: users.accountType,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
      .for("update");
    if (
      !actor ||
      actor.accountType !== "staff" ||
      actor.status !== "active" ||
      actor.emailVerifiedAt === null
    ) {
      return { kind: "unauthenticated" as const };
    }

    const roleRows = await transaction
      .select({ roleKey: roles.roleKey })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, actor.id));
    const roleKeys = roleRows.map((role) => role.roleKey);
    if (!canManageStaffAccounts("staff", roleKeys)) {
      return { kind: "forbidden" as const };
    }

    const key =
      input.kind === "invoice_due_days"
        ? "invoice_due_days"
        : SMS_TEMPLATE_KEYS[input.templateKey];
    const value =
      input.kind === "invoice_due_days"
        ? String(input.invoiceDueDays)
        : input.template;
    const desiredValues = { [key]: value };
    const keys = [key];
    const existingRows = await transaction
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, keys))
      .for("update");
    const existingByKey = new Map(existingRows.map((row) => [row.key, row.value]));

    for (const [key, value] of Object.entries(desiredValues)) {
      await transaction
        .insert(settings)
        .values({
          key,
          value,
          description:
            key === "invoice_due_days"
              ? "Number of calendar days from invoice issue to due date"
              : `SMS template setting: ${key}`,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            value,
            updatedBy: actor.id,
            updatedAt: now,
          },
        });

      const oldValue = existingByKey.get(key);
      if (oldValue !== value) {
        await transaction.insert(auditLogs).values({
          actorUserId: actor.id,
          action: "settings.update",
          entityType: "setting",
          entityId: null,
          oldValues: { key, value: oldValue ?? null },
          newValues: { key, value },
          createdAt: now,
        });
      }
    }

    const policy = getSessionPolicy("staff", roleKeys);
    await transaction
      .update(sessions)
      .set({
        lastActivityAt: now,
        idleExpiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
        expiresAt: new Date(now.getTime() + policy.idleTimeoutMs),
      })
      .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)));

    return { kind: "success", updatedAt: now, sessionPolicy: policy };
  });
}
