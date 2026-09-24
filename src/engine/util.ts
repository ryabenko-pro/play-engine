/** Deep clone of plain JSON-like data. Strings are shared, so big data-URLs are not copied. */
export function clone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = clone((v as Record<string, unknown>)[k]);
  return out as T;
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}
