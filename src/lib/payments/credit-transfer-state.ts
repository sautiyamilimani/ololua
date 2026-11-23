export function creditEntryIdempotency(
  transferId: string,
  direction: "OUT" | "IN",
): string {
  return `credit-transfer:${transferId}:${direction}`;
}
