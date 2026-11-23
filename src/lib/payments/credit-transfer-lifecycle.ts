export type CreditTransferLifecycleStatus =
  | "PENDING"
  | "CONFIRMED"
  | "REVOKED"
  | "EXPIRED"
  | "FAILED";

export function getExpiredTransferStatus(
  status: CreditTransferLifecycleStatus,
  expiresAt: Date | null,
  now: Date,
): "EXPIRED" | null {
  if (
    status === "PENDING" &&
    expiresAt !== null &&
    expiresAt <= now
  ) {
    return "EXPIRED";
  }
  return null;
}
