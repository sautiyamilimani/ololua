import "dotenv/config";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  createGmailSmtpSender,
  getSmtpConfiguration,
  SmtpConfigurationError,
} from "@/lib/email/smtp";
import { processEmailOutboxBatch } from "@/lib/email/outbox";

class WorkerConfigurationError extends Error {}

function assertSendingIsEnabled(): void {
  if (process.env.EMAIL_OUTBOX_ENABLED !== "true") {
    throw new WorkerConfigurationError(
      "Set EMAIL_OUTBOX_ENABLED=true to send queued emails.",
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new WorkerConfigurationError("DATABASE_URL is required.");
  }

  let hostnameValue: string;
  try {
    hostnameValue = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new WorkerConfigurationError("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

  if (
    !localHosts.has(hostnameValue) &&
    process.env.EMAIL_OUTBOX_ALLOW_REMOTE_SEND !== "true"
  ) {
    throw new WorkerConfigurationError(
      "Remote database email delivery is disabled; explicitly set EMAIL_OUTBOX_ALLOW_REMOTE_SEND=true to allow it.",
    );
  }
}

async function main(): Promise<void> {
  assertSendingIsEnabled();
  const configuration = getSmtpConfiguration();
  const sender = createGmailSmtpSender(configuration);

  try {
    await sender.verify();
    const result = await processEmailOutboxBatch(sender, {
      workerId: `${hostname()}:${process.pid}:${randomUUID()}`,
      fromAddress: configuration.email,
    });

    console.log(
      `Outbox run complete: processed=${result.processed}, sent=${result.sent}, retried=${result.retried}, failed=${result.failed}.`,
    );
  } finally {
    sender.close();
  }
}

main().catch((error: unknown) => {
  if (
    error instanceof WorkerConfigurationError ||
    error instanceof SmtpConfigurationError
  ) {
    console.error(`Email outbox processing failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const errorType = error instanceof Error ? error.name : "UnknownError";
  const errorCode =
    typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string"
      ? ` (${error.code})`
      : "";
  console.error(`Email outbox processing failed: ${errorType}${errorCode}.`);
  process.exitCode = 1;
});
