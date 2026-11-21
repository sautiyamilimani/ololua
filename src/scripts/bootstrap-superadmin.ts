import "dotenv/config";
import { bootstrapSuperadmin } from "@/lib/auth/bootstrap-superadmin";

class BootstrapCommandError extends Error {}

function parseArguments(args: string[]): { email: string; fullName: string } {
  const options = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];

    if (
      (option !== "--email" && option !== "--name") ||
      !value ||
      value.startsWith("--") ||
      options.has(option)
    ) {
      throw new BootstrapCommandError(
        "Usage: npm run auth:bootstrap-superadmin -- --name \"Full Name\" --email user@example.com",
      );
    }

    options.set(option, value);
  }

  const email = options.get("--email");
  const fullName = options.get("--name");

  if (!email || !fullName || options.size !== 2) {
    throw new BootstrapCommandError(
      "Usage: npm run auth:bootstrap-superadmin -- --name \"Full Name\" --email user@example.com",
    );
  }

  return { email, fullName };
}

function assertLoopbackDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new BootstrapCommandError("DATABASE_URL is required.");
  }

  let hostname: string;

  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new BootstrapCommandError("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new BootstrapCommandError(
      "Superadmin bootstrap is limited to a loopback development database.",
    );
  }
}

async function main(): Promise<void> {
  assertLoopbackDatabase();
  const input = parseArguments(process.argv.slice(2));
  const result = await bootstrapSuperadmin(input);

  if (result.kind === "already-exists") {
    throw new BootstrapCommandError(
      "A superadmin account is already assigned. No additional account was created.",
    );
  }

  if (result.kind === "email-in-use") {
    throw new BootstrapCommandError(
      "That email address already belongs to an account. No account was created.",
    );
  }

  if (result.kind === "role-not-found") {
    throw new BootstrapCommandError(
      "The superadmin role is missing. Run the development seed before bootstrapping.",
    );
  }

  console.log(
    `Superadmin setup invitation ${result.kind}; invitationId=${result.invitationId}; expiresAt=${result.expiresAt.toISOString()}.`,
  );
  console.log(
    "The invitation email is queued, not sent. Use the existing email outbox worker only after reviewing its configuration.",
  );
}

main().catch((error: unknown) => {
  if (error instanceof BootstrapCommandError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const errorType = error instanceof Error ? error.name : "UnknownError";
  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? ` (${error.code})`
      : "";
  console.error(`Superadmin bootstrap failed: ${errorType}${errorCode}.`);
  process.exitCode = 1;
});
