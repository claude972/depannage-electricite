export function orderReference(id: string): string {
  return id.startsWith("demo-")
    ? `INT-${id.toUpperCase()}`
    : `INT-${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}

export function parseOrderReference(input: string): string | null {
  const match = /^(?:INT-)?([A-F0-9]{6})$/i.exec(input.trim());
  return match ? `INT-${match[1].toUpperCase()}` : null;
}
