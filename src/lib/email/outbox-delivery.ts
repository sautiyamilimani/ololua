import { randomUUID } from "node:crypto";
import { assertEmailOutboxSendingEnabled } from "./outbox-config";
import { processEmailOutboxBatch } from "./outbox";
import { createGmailSmtpSender, getSmtpConfiguration } from "./smtp";

export async function sendPendingOutboxEmails(
  templateKey: "invitation" | "password_reset" | "password_change_otp",
) {
  assertEmailOutboxSendingEnabled();
  const configuration = getSmtpConfiguration();
  const sender = await createGmailSmtpSender(configuration);

  try {
    await sender.verify();
    return await processEmailOutboxBatch(sender, {
      workerId: `email-outbox:${process.pid}:${randomUUID()}`,
      fromAddress: configuration.email,
      templateKey,
    });
  } finally {
    sender.close();
  }
}
