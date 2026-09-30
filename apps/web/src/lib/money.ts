export function formatCost(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const text =
    fraction === 0
      ? `${whole}.0`
      : fraction % 10 === 0
        ? `${whole}.${fraction / 10}`
        : `${whole}.${fraction.toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

export function parseDemand(text: string): number[] | null {
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const values = parts.map(Number);
  if (values.some((value) => !Number.isInteger(value) || value < 0)) return null;
  return values;
}
