export function moneyToCents(value: string): bigint | null {
  const match = /^(\d+)\.(\d{2})$/u.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * BigInt(100) + BigInt(match[2]);
}

export function centsToMoney(value: bigint): string {
  const cents = value < BigInt(0) ? BigInt(0) : value;
  const whole = cents / BigInt(100);
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}
