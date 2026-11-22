/** Compare validated ISO timestamps without dropping PostgreSQL's fractional microseconds. */
export function comparePostgresTime(a: string, b: string): number {
  const milliseconds = Date.parse(a) - Date.parse(b);
  if (milliseconds) return milliseconds;
  const fraction = (value: string) => (value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "").slice(3).padEnd(3, "0");
  const left = fraction(a), right = fraction(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
