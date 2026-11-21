import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailOutbox } from "@/lib/db/schema";
import { encryptSecretPayload } from "@/lib/email/secret-payload";

const EMAIL_MAX_ATTEMPTS = 5;
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function queueInvitationEmail(
  transaction: DatabaseTransaction,
  input: {
    invitationId: string;
    userId: string;
    email: string;
    accountType: "staff" | "customer";
    fullName: string;
    customerNumber: string | null;
    token: string;
    now: Date;
  },
): Promise<void> {
  await transaction.insert(emailOutbox).values({
    recipientUserId: input.userId,
    recipientEmail: input.email,
    templateKey: "invitation",
    templateData: {
      invitationId: input.invitationId,
      accountType: input.accountType,
      fullName: input.fullName,
      customerNumber: input.customerNumber,
    },
    secretPayloadEncrypted: encryptSecretPayload(
      JSON.stringify({ token: input.token }),
    ),
    status: "queued",
    attempts: 0,
    maxAttempts: EMAIL_MAX_ATTEMPTS,
    nextAttemptAt: input.now,
    idempotencyKey: `invitation:${input.invitationId}`,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export async function revokeQueuedInvitationEmail(
  transaction: DatabaseTransaction,
  invitationId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(emailOutbox)
    .set({
      status: "failed",
      lastError: "Invitation was replaced before delivery.",
      updatedAt: now,
    })
    .where(
      and(
        eq(emailOutbox.idempotencyKey, `invitation:${invitationId}`),
        eq(emailOutbox.status, "queued"),
      ),
    );
}
