import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailOutbox } from "@/lib/db/schema";
import {
  processEmailOutboxBatch,
  type EmailSender,
  type OutgoingEmail,
} from "./outbox";
import { encryptSecretPayload } from "./secret-payload";
import { createOpaqueToken } from "@/lib/auth/token";

process.env.EMAIL_OUTBOX_ENCRYPTION_KEY ??= Buffer.alloc(32, 0x5a).toString("base64");
process.env.APP_ORIGIN = "http://localhost:3000";

const fixtureIds = new Set<string>();
const WEBSITE_FOOTER =
  "To find out more, visit Ololua website: https://mwavuna.github.io/ololua";

function assertHasWebsiteFooter(message: OutgoingEmail | undefined): void {
  assert.ok(message?.text.endsWith(WEBSITE_FOOTER));
}

function assertOtpHtml(message: OutgoingEmail | undefined, code: string): void {
  const html = message?.html ?? "";
  const cells = html.match(/<td style="[^"]+">[0-9]<\/td>/gu) ?? [];
  const displayedCode = cells
    .map((cell) => cell.replace(/^.*>([0-9])<\/td>$/u, "$1"))
    .join("");

  assert.equal(displayedCode, code);
  assert.ok(html.includes('href="https://mwavuna.github.io/ololua"'));
}

function assertLocalDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  assert.ok(databaseUrl, "DATABASE_URL must be set for integration tests.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname),
    "Email outbox integration tests may only write to a loopback development database.",
  );
}

async function createOutboxRow(options: {
  templateKey: string;
  templateData: Record<string, unknown> | null;
  secretPayload?: Record<string, unknown> | null;
  attempts?: number;
  maxAttempts?: number;
}): Promise<{ id: string; token: string }> {
  assertLocalDatabase();

  const id = randomUUID();
  const token = createOpaqueToken();
  const now = new Date();
  fixtureIds.add(id);

  await db.insert(emailOutbox).values({
    id,
    recipientEmail: `outbox-test-${id}@example.test`,
    templateKey: options.templateKey,
    templateData: options.templateData,
    secretPayloadEncrypted:
      options.secretPayload === null
        ? null
        : encryptSecretPayload(JSON.stringify(options.secretPayload ?? { token })),
    status: "queued",
    attempts: options.attempts ?? 0,
    maxAttempts: options.maxAttempts ?? 5,
    nextAttemptAt: new Date(now.getTime() - 1000),
    idempotencyKey: `outbox-test:${id}`,
    createdAt: now,
    updatedAt: now,
  });

  return { id, token };
}

async function cleanupFixtures(): Promise<void> {
  const ids = [...fixtureIds];
  if (ids.length > 0) {
    await db.delete(emailOutbox).where(inArray(emailOutbox.id, ids));
  }
  fixtureIds.clear();
}

afterEach(cleanupFixtures);

test("the worker renders and sends invitation and reset messages without real SMTP", async () => {
  const invitation = await createOutboxRow({
    templateKey: "invitation",
    templateData: {
      fullName: "Invitation Test",
      accountType: "customer",
      customerNumber: "C-TEST-1",
    },
  });
  const reset = await createOutboxRow({
    templateKey: "password_reset",
    templateData: {
      fullName: "Reset Test",
      resetPath: "/reset-password",
    },
  });
  const messages: OutgoingEmail[] = [];
  const sender: EmailSender = {
    async sendMail(message) {
      messages.push(message);
      return { messageId: message.messageId };
    },
  };

  const result = await processEmailOutboxBatch(sender, {
    workerId: "outbox-test-worker",
    limit: 2,
    fromAddress: "sender@example.test",
  });

  assert.deepEqual(result, { processed: 2, sent: 2, retried: 0, failed: 0 });
  assert.equal(messages.length, 2);

  const invitationMessage = messages.find((message) =>
    message.subject.includes("invited"),
  );
  const resetMessage = messages.find((message) =>
    message.subject.includes("Reset"),
  );
  assert.ok(invitationMessage);
  assert.ok(resetMessage);
  assertHasWebsiteFooter(invitationMessage);
  assertHasWebsiteFooter(resetMessage);
  assert.equal(invitationMessage.to, `outbox-test-${invitation.id}@example.test`);
  assert.equal(resetMessage.to, `outbox-test-${reset.id}@example.test`);
  assert.ok(
    invitationMessage.text.includes(
      `http://localhost:3000/accept-invitation?token=${invitation.token}`,
    ),
  );
  assert.ok(
    invitationMessage.text.includes("Customer number: C-TEST-1"),
  );
  assert.ok(
    resetMessage.text.includes(
      `http://localhost:3000/reset-password?token=${reset.token}`,
    ),
  );

  const rows = await db
    .select({
      id: emailOutbox.id,
      status: emailOutbox.status,
      attempts: emailOutbox.attempts,
      providerMessageId: emailOutbox.providerMessageId,
      lockedBy: emailOutbox.lockedBy,
      lockedUntil: emailOutbox.lockedUntil,
    })
    .from(emailOutbox)
    .where(inArray(emailOutbox.id, [invitation.id, reset.id]));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.status === "sent" && row.attempts === 1));
  assert.ok(rows.every((row) => row.providerMessageId !== null));
  assert.ok(rows.every((row) => row.lockedBy === null && row.lockedUntil === null));
});

test("the worker sends the suspension notice without a secret payload", async () => {
  const suspension = await createOutboxRow({
    templateKey: "staff_account_suspended",
    templateData: { fullName: "Suspension Test" },
    secretPayload: null,
  });
  const messages: OutgoingEmail[] = [];
  const sender: EmailSender = {
    async sendMail(message) {
      messages.push(message);
      return { messageId: message.messageId };
    },
  };

  const result = await processEmailOutboxBatch(sender, {
    workerId: "outbox-suspension-worker",
    limit: 1,
    fromAddress: "sender@example.test",
    templateKey: "staff_account_suspended",
  });

  assert.deepEqual(result, { processed: 1, sent: 1, retried: 0, failed: 0 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.to, `outbox-test-${suspension.id}@example.test`);
  assertHasWebsiteFooter(messages[0]);
  assert.match(messages[0]?.subject ?? "", /account is suspended/u);
  assert.match(messages[0]?.text ?? "", /contact Ololua Water Services support/u);
  assert.match(messages[0]?.text ?? "", /system administrator/u);
});

test("the worker sends the reactivation notice without a secret payload", async () => {
  const reactivation = await createOutboxRow({
    templateKey: "staff_account_reactivated",
    templateData: { fullName: "Reactivation Test" },
    secretPayload: null,
  });
  const messages: OutgoingEmail[] = [];
  const sender: EmailSender = {
    async sendMail(message) {
      messages.push(message);
      return { messageId: message.messageId };
    },
  };

  const result = await processEmailOutboxBatch(sender, {
    workerId: "outbox-reactivation-worker",
    limit: 1,
    fromAddress: "sender@example.test",
    templateKey: "staff_account_reactivated",
  });

  assert.deepEqual(result, { processed: 1, sent: 1, retried: 0, failed: 0 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.to, `outbox-test-${reactivation.id}@example.test`);
  assertHasWebsiteFooter(messages[0]);
  assert.match(messages[0]?.subject ?? "", /account has been reactivated/u);
  assert.match(messages[0]?.text ?? "", /sign in again/u);
  assert.match(messages[0]?.text ?? "", /contact Ololua Water Services support/u);
});

test("the password-reset worker filter leaves invitation messages queued", async () => {
  const invitation = await createOutboxRow({
    templateKey: "invitation",
    templateData: {
      fullName: "Filtered Invitation Test",
      accountType: "staff",
    },
  });
  const reset = await createOutboxRow({
    templateKey: "password_reset",
    templateData: {
      fullName: "Filtered Reset Test",
      resetPath: "/reset-password",
    },
  });
  const messages: OutgoingEmail[] = [];
  const sender: EmailSender = {
    async sendMail(message) {
      messages.push(message);
      return { messageId: message.messageId };
    },
  };

  const result = await processEmailOutboxBatch(sender, {
    workerId: "outbox-reset-filter-worker",
    fromAddress: "sender@example.test",
    templateKey: "password_reset",
  });

  assert.deepEqual(result, { processed: 1, sent: 1, retried: 0, failed: 0 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.to, `outbox-test-${reset.id}@example.test`);

  const rows = await db
    .select({ id: emailOutbox.id, status: emailOutbox.status })
    .from(emailOutbox)
    .where(inArray(emailOutbox.id, [invitation.id, reset.id]));
  assert.equal(rows.find((row) => row.id === reset.id)?.status, "sent");
  assert.equal(rows.find((row) => row.id === invitation.id)?.status, "queued");
});

test("the password-change worker sends only the OTP template", async () => {
  const invitation = await createOutboxRow({
    templateKey: "invitation",
    templateData: {
      fullName: "Filtered Invitation Test",
      accountType: "staff",
    },
  });
  const otp = await createOutboxRow({
    templateKey: "password_change_otp",
    templateData: { fullName: "Password Change Test" },
    secretPayload: { otp: "042681" },
  });
  const messages: OutgoingEmail[] = [];
  const sender: EmailSender = {
    async sendMail(message) {
      messages.push(message);
      return { messageId: message.messageId };
    },
  };

  const result = await processEmailOutboxBatch(sender, {
    workerId: "outbox-password-change-worker",
    fromAddress: "sender@example.test",
    templateKey: "password_change_otp",
  });

  assert.deepEqual(result, { processed: 1, sent: 1, retried: 0, failed: 0 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.to, `outbox-test-${otp.id}@example.test`);
  assertHasWebsiteFooter(messages[0]);
  assertOtpHtml(messages[0], "042681");
  assert.match(messages[0]?.subject ?? "", /password change/u);
  assert.match(messages[0]?.text ?? "", /042681/u);
  assert.match(messages[0]?.text ?? "", /expires in 10 minutes/u);

  const rows = await db
    .select({ id: emailOutbox.id, status: emailOutbox.status })
    .from(emailOutbox)
    .where(inArray(emailOutbox.id, [invitation.id, otp.id]));
  assert.equal(rows.find((row) => row.id === otp.id)?.status, "sent");
  assert.equal(rows.find((row) => row.id === invitation.id)?.status, "queued");
});

test("the customer email verification worker sends a one-time code", async () => {
  const verification = await createOutboxRow({
    templateKey: "customer_email_verification",
    templateData: {
      fullName: "Customer Verification Test",
      customerNumber: "OLO-000123",
    },
    secretPayload: { otp: "042681" },
  });
  const messages: OutgoingEmail[] = [];
  const sender: EmailSender = {
    async sendMail(message) {
      messages.push(message);
      return { messageId: message.messageId };
    },
  };

  const result = await processEmailOutboxBatch(sender, {
    workerId: "outbox-customer-verification-worker",
    fromAddress: "sender@example.test",
    templateKey: "customer_email_verification",
  });

  assert.deepEqual(result, { processed: 1, sent: 1, retried: 0, failed: 0 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.to, `outbox-test-${verification.id}@example.test`);
  assertHasWebsiteFooter(messages[0]);
  assertOtpHtml(messages[0], "042681");
  assert.match(messages[0]?.subject ?? "", /verify your email/iu);
  assert.match(messages[0]?.text ?? "", /OLO-000123/u);
  assert.match(messages[0]?.text ?? "", /042681/u);
  assert.match(messages[0]?.text ?? "", /expires in 10 minutes/u);
});

test("SMTP failures retry with backoff and eventually move the message to failed", async () => {
  const row = await createOutboxRow({
    templateKey: "password_reset",
    templateData: {
      fullName: "Retry Test",
      resetPath: "/reset-password",
    },
    maxAttempts: 2,
  });
  const failingSender: EmailSender = {
    async sendMail() {
      throw Object.assign(new Error("provider details must not be stored"), {
        code: "ECONNECTION",
      });
    },
  };

  const firstAttemptAt = new Date();
  const first = await processEmailOutboxBatch(failingSender, {
    workerId: "outbox-retry-worker",
    limit: 1,
    fromAddress: "sender@example.test",
  });
  assert.deepEqual(first, { processed: 1, sent: 0, retried: 1, failed: 0 });

  const [afterFirst] = await db
    .select({
      status: emailOutbox.status,
      attempts: emailOutbox.attempts,
      nextAttemptAt: emailOutbox.nextAttemptAt,
      lastError: emailOutbox.lastError,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.id, row.id))
    .limit(1);
  assert.equal(afterFirst?.status, "queued");
  assert.equal(afterFirst?.attempts, 1);
  assert.ok(afterFirst?.nextAttemptAt.getTime() >= firstAttemptAt.getTime() + 55_000);
  assert.equal(afterFirst?.lastError, "SMTP delivery failed (ECONNECTION).");
  assert.equal(afterFirst?.lastError?.includes(row.token), false);

  await db
    .update(emailOutbox)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(eq(emailOutbox.id, row.id));

  const second = await processEmailOutboxBatch(failingSender, {
    workerId: "outbox-retry-worker",
    limit: 1,
    fromAddress: "sender@example.test",
  });
  assert.deepEqual(second, { processed: 1, sent: 0, retried: 0, failed: 1 });

  const [afterSecond] = await db
    .select({ status: emailOutbox.status, attempts: emailOutbox.attempts })
    .from(emailOutbox)
    .where(eq(emailOutbox.id, row.id))
    .limit(1);
  assert.equal(afterSecond?.status, "failed");
  assert.equal(afterSecond?.attempts, 2);
});

test("concurrent workers claim a due message only once", async () => {
  await createOutboxRow({
    templateKey: "invitation",
    templateData: {
      fullName: "Claim Test",
      accountType: "staff",
    },
  });
  let sendCount = 0;
  const sender: EmailSender = {
    async sendMail(message) {
      sendCount++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { messageId: message.messageId };
    },
  };

  const results = await Promise.all([
    processEmailOutboxBatch(sender, {
      workerId: "outbox-claim-worker-a",
      limit: 1,
      fromAddress: "sender@example.test",
    }),
    processEmailOutboxBatch(sender, {
      workerId: "outbox-claim-worker-b",
      limit: 1,
      fromAddress: "sender@example.test",
    }),
  ]);

  assert.equal(sendCount, 1);
  assert.equal(results.reduce((total, result) => total + result.sent, 0), 1);
});

test("unsupported templates are failed without retrying", async () => {
  const row = await createOutboxRow({
    templateKey: "unsupported",
    templateData: { fullName: "Unsupported Test" },
  });
  const sender: EmailSender = {
    async sendMail() {
      throw new Error("Unsupported template should not call the sender.");
    },
  };

  const result = await processEmailOutboxBatch(sender, {
    workerId: "outbox-template-worker",
    limit: 1,
    fromAddress: "sender@example.test",
  });

  assert.deepEqual(result, { processed: 1, sent: 0, retried: 0, failed: 1 });

  const [stored] = await db
    .select({ status: emailOutbox.status, lastError: emailOutbox.lastError })
    .from(emailOutbox)
    .where(eq(emailOutbox.id, row.id))
    .limit(1);
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.lastError, "Email content is invalid or unsupported.");
});

test("email outbox integration fixtures are removed after the tests", async () => {
  assertLocalDatabase();

  const remaining = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(like(emailOutbox.idempotencyKey, "outbox-test:%"));

  assert.equal(remaining.length, 0);
});
