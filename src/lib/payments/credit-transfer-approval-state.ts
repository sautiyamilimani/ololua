export function creditTransferExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
}

export function canFinalizeCrossCustomerTransfer(
  senderApprovedAt: Date | null,
  recipientConfirmedAt: Date | null,
  expiresAt: Date | null,
  now: Date,
): boolean {
  return (
    senderApprovedAt !== null &&
    recipientConfirmedAt !== null &&
    expiresAt !== null &&
    expiresAt > now
  );
}
