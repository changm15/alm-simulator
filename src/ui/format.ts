export function currency(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/** Two decimals at most, with trailing zeros dropped: 20, 1.5, 3.25. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function currencyExact(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString()}`;
}

export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}
