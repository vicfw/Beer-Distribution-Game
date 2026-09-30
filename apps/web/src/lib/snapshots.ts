export function acceptSnapshot<T extends { version: number }>(current: T | null, next: T): T {
  if (current && next.version < current.version) return current;
  return next;
}
