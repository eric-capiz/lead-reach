/**
 * Category and template names are compared loosely so "Barbers", "barbers", and "Barber" are
 * treated as the same label. The unique index is exact, so these checks keep near-duplicates
 * from being created in the first place.
 */

export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Case-, whitespace-, and plural-insensitive key. */
export function looseNameKey(value: unknown): string {
  const n = normalizeName(value);
  if (n.endsWith("ies")) return `${n.slice(0, -3)}y`;
  if (n.endsWith("s") && !n.endsWith("ss")) return n.slice(0, -1);
  return n;
}

export function sameLooseName(a: unknown, b: unknown): boolean {
  const ka = looseNameKey(a);
  return ka.length > 0 && ka === looseNameKey(b);
}
