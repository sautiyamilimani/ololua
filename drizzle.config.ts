import "dotenv/config";
import { defineConfig } from "drizzle-kit";

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const url = new URL(databaseUrl);

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }

  const hostname = url.hostname.toLowerCase();
  const isLocalDatabase =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";

  url.searchParams.set("sslmode", isLocalDatabase ? "disable" : "verify-full");

  return url.toString();
}

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: getDatabaseUrl(),
  },
});
