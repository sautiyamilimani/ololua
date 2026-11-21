import "dotenv/config";
import { createGmailSmtpSender, getSmtpConfiguration } from "@/lib/email/smtp";

async function main(): Promise<void> {
  const sender = await createGmailSmtpSender(getSmtpConfiguration());

  try {
    await sender.verify();
    console.log("Gmail SMTP connection and authentication verified; no email was sent.");
  } finally {
    sender.close();
  }
}

main().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? ` (${error.code})`
      : "";
  console.error(`Gmail SMTP verification failed: ${errorType}${errorCode}.`);
  process.exitCode = 1;
});
