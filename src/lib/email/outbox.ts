import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  gte,
  isNull,
  lte,
  lt,
  or,
} from "drizzle-orm";
import { db } from "@/lib/db";
import { emailOutbox } from "@/lib/db/schema";
import { isRecord } from "@/lib/auth/request";
import { isOpaqueToken } from "@/lib/auth/token";
import { getApplicationOrigin } from "@/lib/auth/csrf";
import {
  assertSecretPayloadEncryptionConfigured,
  decryptSecretPayload,
} from "./secret-payload";

const CLAIM_LEASE_MS = 2 * 60 * 1000;
const RETRY_BASE_MS = 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;

export type OutgoingEmail = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  messageId: string;
};

export type EmailTemplateKey =
  | "invitation"
  | "password_reset"
  | "password_change_otp"
  | "staff_account_suspended"
  | "staff_account_reactivated";

export type EmailSender = {
  sendMail(message: OutgoingEmail): Promise<{ messageId?: string | null }>;
};

export type OutboxBatchResult = {
  processed: number;
  sent: number;
  retried: number;
  failed: number;
};

type ClaimedEmail = {
  id: string;
  recipientEmail: string;
  templateKey: string;
  templateData: unknown;
  secretPayloadEncrypted: Uint8Array | null;
  attempts: number;
  maxAttempts: number;
};

class PermanentEmailError extends Error {}

function getErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;

    if (typeof code === "string" && /^[A-Z0-9_]{1,32}$/u.test(code)) {
      return code;
    }
  }

  if (error instanceof Error && /^[A-Za-z0-9_]{1,64}$/u.test(error.name)) {
    return error.name;
  }

  return "UnknownError";
}

function requireString(
  value: Record<string, unknown>,
  key: string,
): string {
  const field = value[key];

  if (typeof field !== "string" || field.trim().length === 0) {
    throw new PermanentEmailError("Email template data is invalid.");
  }

  return field.trim().replace(/[\r\n\t]+/gu, " ");
}

function createApplicationLink(path: string, token: string): string {
  const url = new URL(path, getApplicationOrigin());
  url.searchParams.set("token", token);
  return url.toString();
}

function buildMessage(
  row: ClaimedEmail,
  senderAddress: string,
): OutgoingEmail {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(row.recipientEmail)) {
    throw new PermanentEmailError("Email recipient address is invalid.");
  }

  let secret: unknown = {};
  const isAccountStatusNotice =
    row.templateKey === "staff_account_suspended" ||
    row.templateKey === "staff_account_reactivated";

  if (isAccountStatusNotice) {
    if (row.secretPayloadEncrypted !== null) {
      throw new PermanentEmailError("Suspension email must not have a secret payload.");
    }
  } else {
    if (!row.secretPayloadEncrypted) {
      throw new PermanentEmailError("Email secret payload is missing.");
    }

    try {
      secret = JSON.parse(decryptSecretPayload(row.secretPayloadEncrypted));
    } catch {
      throw new PermanentEmailError("Email secret payload is invalid.");
    }
  }

  if (!isRecord(secret)) {
    throw new PermanentEmailError("Email secret payload is invalid.");
  }

  if (!isRecord(row.templateData)) {
    throw new PermanentEmailError("Email template data is invalid.");
  }

  const fullName = requireString(row.templateData, "fullName");
  let subject: string;
  let text: string;

  if (row.templateKey === "staff_account_suspended") {
    subject = "Your Ololua Water Services account is suspended";
    text = [
      `Hello ${fullName},`,
      "",
      "Your Ololua Water Services account has been suspended, and you can no longer sign in.",
      "Please contact Ololua Water Services support or your system administrator for assistance.",
      "Ololua Water Services",
    ].join("\n");
  } else if (row.templateKey === "staff_account_reactivated") {
    subject = "Your Ololua Water Services account has been reactivated";
    text = [
      `Hello ${fullName},`,
      "",
      "Your Ololua Water Services account has been reactivated.",
      "You can sign in again using your account credentials. Previous sessions remain revoked.",
      "If you did not expect this change, please contact Ololua Water Services support or your system administrator.",
      "Ololua Water Services",
    ].join("\n");
  } else if (row.templateKey === "password_change_otp") {
    const otp = typeof secret.otp === "string" ? secret.otp : undefined;

    if (!otp || !/^\d{6}$/u.test(otp)) {
      throw new PermanentEmailError("Password-change code is invalid.");
    }

    subject = "Verify your password change";
    text = [
      `Hello ${fullName},`,
      "",
      "Use this one-time code to verify your password change:",
      otp,
      "",
      "The code expires in 10 minutes. If you did not request this change, ignore this email and keep your current password.",
      "Ololua Water Services",
    ].join("\n");
  } else {
    const token = typeof secret.token === "string" ? secret.token : undefined;

    if (!isOpaqueToken(token)) {
      throw new PermanentEmailError("Email secret payload is invalid.");
    }

    if (row.templateKey === "invitation") {
      const accountType = requireString(row.templateData, "accountType");

      if (accountType !== "staff" && accountType !== "customer") {
        throw new PermanentEmailError("Invitation account type is invalid.");
      }

      const invitationUrl = createApplicationLink(
        "/accept-invitation",
        token,
      );
      const customerNumber =
        typeof row.templateData.customerNumber === "string"
          ? `\nCustomer number: ${row.templateData.customerNumber.replace(/[\r\n\t]+/gu, " ").trim()}`
          : "";

      subject = "You're invited to Ololua Water Services";
      text = [
        `Hello ${fullName},`,
        "",
        "You have been invited to set up an Ololua Water Services portal account.",
        customerNumber,
        "",
        `Accept your invitation within 72 hours: ${invitationUrl}`,
        "",
        "If you were not expecting this invitation, you can ignore this email.",
        "Ololua Water Services",
      ].join("\n");
    } else if (row.templateKey === "password_reset") {
      const resetPath = requireString(row.templateData, "resetPath");

      if (resetPath !== "/reset-password") {
        throw new PermanentEmailError("Password reset path is invalid.");
      }

      const resetUrl = createApplicationLink(resetPath, token);
      subject = "Reset your Ololua Water Services password";
      text = [
        `Hello ${fullName},`,
        "",
        "We received a request to reset the password for your Ololua Water Services account.",
        `Use this link within 60 minutes: ${resetUrl}`,
        "",
        "If you did not request a password reset, you can ignore this email.",
        "Your password will not change unless the link is used.",
        "Ololua Water Services",
      ].join("\n");
    } else {
      throw new PermanentEmailError("Email template is unsupported.");
    }
  }

  const senderDomain = senderAddress.split("@")[1];

  return {
    from: { name: "Ololua Water Services", address: senderAddress },
    to: row.recipientEmail,
    subject,
    text,
    messageId: `<${row.id}@${senderDomain}>`,
  };
}

async function claimNextEmail(
  workerId: string,
  templateKey?: EmailTemplateKey,
): Promise<ClaimedEmail | null> {
  const now = new Date();
  const lockExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);

  return db.transaction(async (transaction) => {
    const exhaustedCondition = or(
      and(
        eq(emailOutbox.status, "queued"),
        gte(emailOutbox.attempts, emailOutbox.maxAttempts),
      ),
      and(
        eq(emailOutbox.status, "sending"),
        or(
          isNull(emailOutbox.lockedUntil),
          lte(emailOutbox.lockedUntil, now),
        ),
        gte(emailOutbox.attempts, emailOutbox.maxAttempts),
      ),
    );

    await transaction
      .update(emailOutbox)
      .set({
        status: "failed",
        lockedUntil: null,
        lockedBy: null,
        lastError: "Delivery attempts exhausted.",
        updatedAt: now,
      })
      .where(
        templateKey
          ? and(exhaustedCondition, eq(emailOutbox.templateKey, templateKey))
          : exhaustedCondition,
      );

    const claimCondition = and(
      lt(emailOutbox.attempts, emailOutbox.maxAttempts),
      or(
        and(
          eq(emailOutbox.status, "queued"),
          lte(emailOutbox.nextAttemptAt, now),
        ),
        and(
          eq(emailOutbox.status, "sending"),
          or(
            isNull(emailOutbox.lockedUntil),
            lte(emailOutbox.lockedUntil, now),
          ),
        ),
      ),
    );
    const filteredClaimCondition = templateKey
      ? and(claimCondition, eq(emailOutbox.templateKey, templateKey))
      : claimCondition;

    const [row] = await transaction
      .select({
        id: emailOutbox.id,
        recipientEmail: emailOutbox.recipientEmail,
        templateKey: emailOutbox.templateKey,
        templateData: emailOutbox.templateData,
        secretPayloadEncrypted: emailOutbox.secretPayloadEncrypted,
        attempts: emailOutbox.attempts,
        maxAttempts: emailOutbox.maxAttempts,
      })
      .from(emailOutbox)
      .where(filteredClaimCondition)
      .orderBy(asc(emailOutbox.nextAttemptAt), asc(emailOutbox.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!row) {
      return null;
    }

    await transaction
      .update(emailOutbox)
      .set({
        status: "sending",
        attempts: row.attempts + 1,
        lockedUntil: lockExpiresAt,
        lockedBy: workerId,
        updatedAt: now,
      })
      .where(eq(emailOutbox.id, row.id));

    return { ...row, attempts: row.attempts + 1 };
  });
}

async function updateClaimedEmail(
  id: string,
  workerId: string,
  updates: {
    status: "queued" | "sent" | "failed";
    nextAttemptAt?: Date;
    sentAt?: Date;
    providerMessageId?: string | null;
    lastError?: string | null;
  },
): Promise<boolean> {
  const [updated] = await db
    .update(emailOutbox)
    .set({
      ...updates,
      lockedUntil: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailOutbox.id, id),
        eq(emailOutbox.status, "sending"),
        eq(emailOutbox.lockedBy, workerId),
      ),
    )
    .returning({ id: emailOutbox.id });

  return updated !== undefined;
}

function getRetryTime(attempts: number, now: Date): Date {
  const delayMs = Math.min(
    RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1),
    RETRY_MAX_MS,
  );

  return new Date(now.getTime() + delayMs);
}

async function markFailure(
  row: ClaimedEmail,
  workerId: string,
  error: unknown,
  permanent: boolean,
): Promise<"retried" | "failed" | "lost"> {
  const exhausted = permanent || row.attempts >= row.maxAttempts;
  const safeError = permanent
    ? "Email content is invalid or unsupported."
    : `SMTP delivery failed (${getErrorCode(error)}).`;
  const updated = await updateClaimedEmail(row.id, workerId, {
    status: exhausted ? "failed" : "queued",
    nextAttemptAt: exhausted
      ? undefined
      : getRetryTime(row.attempts, new Date()),
    lastError: safeError,
  });

  if (!updated) {
    return "lost";
  }

  return exhausted ? "failed" : "retried";
}

export async function processEmailOutboxBatch(
  sender: EmailSender,
  options: {
    workerId?: string;
    limit?: number;
    fromAddress: string;
    templateKey?: EmailTemplateKey;
  },
): Promise<OutboxBatchResult> {
  assertSecretPayloadEncryptionConfigured();
  getApplicationOrigin();

  const limit = options.limit ?? DEFAULT_BATCH_SIZE;
  const workerId = options.workerId ?? randomUUID();

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new RangeError(`Email outbox batch limit must be between 1 and ${MAX_BATCH_SIZE}.`);
  }
  if (workerId.length === 0 || workerId.length > 100) {
    throw new RangeError("Email outbox worker ID must be between 1 and 100 characters.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(options.fromAddress)) {
    throw new Error("EMAIL must contain a valid sender address.");
  }

  const result: OutboxBatchResult = {
    processed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
  };

  while (result.processed < limit) {
    const row = await claimNextEmail(workerId, options.templateKey);

    if (!row) {
      break;
    }

    result.processed++;

    let message: OutgoingEmail;
    try {
      message = buildMessage(row, options.fromAddress);
    } catch (error) {
      const state = await markFailure(row, workerId, error, true);
      if (state === "failed") result.failed++;
      continue;
    }

    try {
      const sent = await sender.sendMail(message);
      const updated = await updateClaimedEmail(row.id, workerId, {
        status: "sent",
        sentAt: new Date(),
        providerMessageId: sent.messageId?.slice(0, 255) ?? message.messageId,
        lastError: null,
      });

      if (updated) {
        result.sent++;
      }
    } catch (error) {
      const state = await markFailure(row, workerId, error, false);
      if (state === "retried") result.retried++;
      if (state === "failed") result.failed++;
    }
  }

  return result;
}
