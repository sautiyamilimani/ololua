export function calculateBillingAmount(
  consumption: string,
  tariffRate: string,
): string | null {
  const consumptionMatch = /^(\d+)\.(\d{3})$/u.exec(consumption);
  const rateMatch = /^(\d+)\.(\d{2})$/u.exec(tariffRate);
  if (!consumptionMatch || !rateMatch) return null;

  const milliConsumption =
    BigInt(consumptionMatch[1]) * BigInt(1000) + BigInt(consumptionMatch[2]);
  const rateCents =
    BigInt(rateMatch[1]) * BigInt(100) + BigInt(rateMatch[2]);
  const numerator = milliConsumption * rateCents;
  const denominator = BigInt(1000);
  const wholeCents = numerator / denominator;
  const remainder = numerator % denominator;
  const roundedCents =
    remainder * BigInt(2) >= denominator
      ? wholeCents + BigInt(1)
      : wholeCents;

  const whole = roundedCents / BigInt(100);
  const cents = (roundedCents % BigInt(100)).toString().padStart(2, "0");
  return `${whole}.${cents}`;
}

export function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(value: Date, days: number): Date {
  const result = new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
