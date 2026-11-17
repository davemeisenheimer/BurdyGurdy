/**
 * Change detection for cloud uploads. Sync used to upsert every progress row on every upload, and
 * Postgres writes a new row version even when nothing changed - that churn exhausted the database's
 * Disk IO budget. Instead we remember a fingerprint of each row as last uploaded, and only send rows
 * whose fingerprint differs.
 *
 * Comparing what would be uploaded (rather than tracking "dirty" flags or timestamps) catches every
 * kind of change - answers, favourites, exclusions, sightings, trims - without touching the code
 * that makes them.
 */

/** Key → fingerprint of the row as last successfully uploaded (or downloaded). */
export type Fingerprints = Record<string, string>;

/** JSON with object keys sorted, so the same data always gives the same string. Undefined values are dropped. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}

/** cyrb53 - a fast 53-bit string hash; plenty for spotting a changed row. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function fingerprint(value: unknown): string {
  return cyrb53(stableStringify(value));
}

/** Fingerprints for a full set of items, e.g. right after downloading them from the cloud. */
export function fingerprintAll<T>(items: T[], keyOf: (item: T) => string): Fingerprints {
  const out: Fingerprints = {};
  for (const item of items) out[keyOf(item)] = fingerprint(item);
  return out;
}

/**
 * Picks the items that differ from what was last uploaded. `next` is the fingerprint set to store
 * once the upload of `changed` succeeds: it covers exactly the current items, so fingerprints of
 * items that no longer exist locally are dropped.
 */
export function selectChanged<T>(
  items: T[],
  keyOf: (item: T) => string,
  previous: Fingerprints,
): { changed: T[]; next: Fingerprints } {
  const changed: T[] = [];
  const next: Fingerprints = {};
  for (const item of items) {
    const key = keyOf(item);
    const fp = fingerprint(item);
    if (previous[key] !== fp) changed.push(item);
    next[key] = fp;
  }
  return { changed, next };
}

/** Copy of `fingerprints` without `keys` - used when those rows are deleted from the cloud. */
export function withoutKeys(fingerprints: Fingerprints, keys: string[]): Fingerprints {
  const out = { ...fingerprints };
  for (const k of keys) delete out[k];
  return out;
}
