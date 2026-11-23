export type TariffStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

export function tariffPeriodsOverlap(
  firstFrom: Date,
  firstTo: Date | null,
  secondFrom: Date,
  secondTo: Date | null,
): boolean {
  const firstEnd = firstTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const secondEnd = secondTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return firstFrom.getTime() < secondEnd && secondFrom.getTime() < firstEnd;
}
