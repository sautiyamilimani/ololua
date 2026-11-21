import "dotenv/config";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  createGmailSmtpSender,
  getSmtpConfiguration,
  SmtpConfigurationError,
} from "@/lib/email/smtp";
import { processEmailOutboxBatch } from "@/lib/email/outbox";
import {
  assertEmailOutboxSendingEnabled,
  EmailOutboxConfigurationError,
} from "@/lib/email/outbox-config";

class WorkerConfigurationError extends Error {}

function getBatchLimit(args: string[]): number | undefined {
  if (args.length === 0) {
    return undefined;
  }

  if (args.length !== 2 || args[0] !== "--limit") {
    throw new WorkerConfigurationError(
      "Usage: npm run email:process-outbox -- [--limit 1-50]",
    );
  }

  const limit = Number(args[1]);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new WorkerConfigurationError(
      "Email outbox batch limit must be between 1 and 50.",
    );
  }

  return limit;
}

async function main(): Promise<void> {
  assertEmailOutboxSendingEnabled();
  const limit = getBatchLimit(process.argv.slice(2));
  const configuration = getSmtpConfiguration();
  const sender = await createGmailSmtpSender(configuration);

  try {
    await sender.verify();
    const result = await processEmailOutboxBatch(sender, {
      workerId: `${hostname()}:${process.pid}:${randomUUID()}`,
      ...(limit === undefined ? {} : { limit }),
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
    error instanceof EmailOutboxConfigurationError ||
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
