import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function getDatabaseConnectionString(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isLocalDatabase =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";

  parsedUrl.searchParams.set("sslmode", isLocalDatabase ? "disable" : "verify-full");

  return parsedUrl.toString();
}

type DatabaseGlobal = typeof globalThis & {
  __ololuaPostgresPool?: Pool;
};

const globalForDatabase = globalThis as DatabaseGlobal;
const pool =
  globalForDatabase.__ololuaPostgresPool ??
  new Pool({ connectionString: getDatabaseConnectionString() });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.__ololuaPostgresPool = pool;
}

export const db = drizzle(pool, { schema });
