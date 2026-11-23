import { centsToMoney, moneyToCents } from "./state";

export function getReversalEffect(
  paymentAmount: string,
  reversedAllocationAmount: string,
): { restoredCreditAmount: string; reversedAllocationAmount: string } | null {
  const payment = moneyToCents(paymentAmount);
  const reversed = moneyToCents(reversedAllocationAmount);
  if (payment === null || reversed === null || reversed > payment) return null;
  return {
    reversedAllocationAmount: centsToMoney(reversed),
    restoredCreditAmount: centsToMoney(payment - reversed),
  };
}

export function getBillStatusAfterReversal(
  totalAmount: string,
  remainingAllocatedAmount: string,
): "PAID" | "PARTIALLY_PAID" | "UNPAID" | null {
  const total = moneyToCents(totalAmount);
  const allocated = moneyToCents(remainingAllocatedAmount);
  if (total === null || allocated === null || allocated < BigInt(0)) return null;
  if (allocated >= total) return "PAID";
  if (allocated > BigInt(0)) return "PARTIALLY_PAID";
  return "UNPAID";
}
