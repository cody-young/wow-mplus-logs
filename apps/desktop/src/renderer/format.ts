/** Compact number, the way damage meters write them. */
export function short(value: number): string {
  const n = Math.abs(value);
  if (n >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toString();
}

/** mm:ss from a run-relative millisecond offset. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function integer(value: number): string {
  return value.toLocaleString('en-US');
}
