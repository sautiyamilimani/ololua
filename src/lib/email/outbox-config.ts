const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class EmailOutboxConfigurationError extends Error {}

export function isEmailOutboxSendingEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.EMAIL_OUTBOX_ENABLED?.trim().toLowerCase() === "true";
}

export function assertEmailOutboxSendingEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (!isEmailOutboxSendingEnabled(environment)) {
    throw new EmailOutboxConfigurationError(
      "Set EMAIL_OUTBOX_ENABLED=true to send queued emails.",
    );
  }

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new EmailOutboxConfigurationError("DATABASE_URL is required.");
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new EmailOutboxConfigurationError(
      "DATABASE_URL must be a valid PostgreSQL URL.",
    );
  }

  if (
    !LOCAL_DATABASE_HOSTS.has(hostname) &&
    environment.EMAIL_OUTBOX_ALLOW_REMOTE_SEND?.trim().toLowerCase() !== "true"
  ) {
    throw new EmailOutboxConfigurationError(
      "Remote database email delivery is disabled; explicitly set EMAIL_OUTBOX_ALLOW_REMOTE_SEND=true to allow it.",
    );
  }
}
