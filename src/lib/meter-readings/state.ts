export function getReadingConsumption(
  previousReading: string,
  currentReading: string,
): string | null {
  function toMilliUnits(value: string): bigint | null {
    const match = /^(\d+)\.(\d{3})$/u.exec(value);
    if (!match) return null;
    return BigInt(match[1]) * BigInt(1000) + BigInt(match[2]);
  }
  function fromMilliUnits(value: bigint): string {
    const whole = value / BigInt(1000);
    const fraction = (value % BigInt(1000)).toString().padStart(3, "0");
    return `${whole}.${fraction}`;
  }

  const previous = toMilliUnits(previousReading);
  const current = toMilliUnits(currentReading);
  if (previous === null || current === null || current < previous) return null;
  return fromMilliUnits(current - previous);
}
