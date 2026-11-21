import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { rateLimits } from "@/lib/db/schema";
import { db } from "@/lib/db";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RateLimitBucket = {
  action: string;
  identity: string;
  maximum: number;
  windowMs: number;
};

export type RateLimitBucketResult =
  | { allowed: true; attemptCount: number }
  | { allowed: false; attemptCount: number; retryAfterSeconds: number };

function getBucketKey(action: string, identity: string): string {
  const digest = createHash("sha256")
    .update(`${action}:${identity}`)
    .digest("hex");

  return `${action}:${digest}`;
}

export async function consumeRateLimitBucket(
  transaction: DatabaseTransaction,
  bucket: RateLimitBucket,
  now: Date,
): Promise<RateLimitBucketResult> {
  if (
    !/^[a-z][a-z0-9_]{0,49}$/u.test(bucket.action) ||
    bucket.identity.length === 0 ||
    !Number.isSafeInteger(bucket.maximum) ||
    bucket.maximum < 1 ||
    !Number.isSafeInteger(bucket.windowMs) ||
    bucket.windowMs < 1
  ) {
    throw new Error("The rate-limit bucket configuration is invalid.");
  }

  const bucketKey = getBucketKey(bucket.action, bucket.identity);

  await transaction
    .insert(rateLimits)
    .values({
      bucketKey,
      action: bucket.action,
      attemptCount: 0,
      windowStartedAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const [row] = await transaction
    .select({
      attemptCount: rateLimits.attemptCount,
      windowStartedAt: rateLimits.windowStartedAt,
      blockedUntil: rateLimits.blockedUntil,
    })
    .from(rateLimits)
    .where(eq(rateLimits.bucketKey, bucketKey))
    .limit(1)
    .for("update");

  if (!row) {
    throw new Error("The rate-limit row was not created.");
  }

  const windowExpired =
    now.getTime() - row.windowStartedAt.getTime() >= bucket.windowMs;
  const windowStartedAt = windowExpired ? now : row.windowStartedAt;
  const windowEndsAt = new Date(windowStartedAt.getTime() + bucket.windowMs);
  const currentlyBlocked =
    !windowExpired &&
    (row.attemptCount >= bucket.maximum ||
      (row.blockedUntil !== null && row.blockedUntil > now));

  if (currentlyBlocked) {
    await transaction
      .update(rateLimits)
      .set({ blockedUntil: windowEndsAt, updatedAt: now })
      .where(eq(rateLimits.bucketKey, bucketKey));

    return {
      allowed: false,
      attemptCount: row.attemptCount,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowEndsAt.getTime() - now.getTime()) / 1000),
      ),
    };
  }

  const attemptCount = (windowExpired ? 0 : row.attemptCount) + 1;
  await transaction
    .update(rateLimits)
    .set({
      attemptCount,
      windowStartedAt,
      blockedUntil: attemptCount >= bucket.maximum ? windowEndsAt : null,
      updatedAt: now,
    })
    .where(eq(rateLimits.bucketKey, bucketKey));

  return { allowed: true, attemptCount };
}
