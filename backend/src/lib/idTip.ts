/**
 * Pure logic for AI "ID tips": after a wrong answer on a photo question, Claude points out field
 * marks in the question photo that separate the correct species from the player's guess.
 * The Anthropic call itself lives in services/idTipModel.ts; the route in routes/idTip.ts.
 */

export const ID_TIP_MODEL = 'claude-haiku-5-5';
export const ID_TIP_NAME_MAX = 120;
export const ID_TIP_URL_MAX = 2000;

export interface IdTipRequest {
  speciesCode: string;
  comName: string;
  sciName: string;
  guess: string;
  photoUrl: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function str(v: unknown, field: string, max: number): Parsed<string> {
  if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `${field} is required` };
  const s = v.trim();
  if (s.length > max) return { ok: false, error: `${field} is too long` };
  return { ok: true, value: s };
}

/** Validates the POST body. The photo URL must be http(s); species membership is checked separately. */
export function validateIdTipRequest(body: unknown): Parsed<IdTipRequest> {
  const b = (body ?? {}) as Record<string, unknown>;
  const fields = {
    speciesCode: str(b.speciesCode, 'speciesCode', 20),
    comName: str(b.comName, 'comName', ID_TIP_NAME_MAX),
    sciName: str(b.sciName, 'sciName', ID_TIP_NAME_MAX),
    guess: str(b.guess, 'guess', ID_TIP_NAME_MAX),
    photoUrl: str(b.photoUrl, 'photoUrl', ID_TIP_URL_MAX),
  };
  for (const f of Object.values(fields)) if (!f.ok) return f;
  const value = Object.fromEntries(
    Object.entries(fields).map(([k, f]) => [k, (f as { value: string }).value]),
  ) as unknown as IdTipRequest;

  if (!/^[a-z0-9]+$/i.test(value.speciesCode)) return { ok: false, error: 'speciesCode is invalid' };
  if (!/^https?:\/\//i.test(value.photoUrl)) return { ok: false, error: 'photoUrl must be http(s)' };
  const guessLc = value.guess.toLowerCase();
  if (guessLc === value.comName.toLowerCase() || guessLc === value.sciName.toLowerCase()) {
    return { ok: false, error: 'guess matches the correct species' };
  }
  return { ok: true, value };
}

/** Whether the photo is one we serve for this species (stops the endpoint analysing arbitrary images). */
export function photoBelongsToSpecies(
  photoUrl: string,
  photoSet: { primary: { url: string } | null; optional: Array<{ url: string }> },
): boolean {
  return [photoSet.primary, ...photoSet.optional].some(p => p?.url === photoUrl);
}

/** The guess as stored in the key columns: case-insensitive. */
export function guessKey(guess: string): string {
  return guess.trim().toLowerCase();
}

/** Same photo + same correct species + same guess → same tip. Case-insensitive on the guess. */
export function idTipCacheKey(r: Pick<IdTipRequest, 'speciesCode' | 'guess' | 'photoUrl'>): string {
  return `idtip1:${r.speciesCode}|${guessKey(r.guess)}|${r.photoUrl}`;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export const ID_TIP_ISSUE_TYPES = ['wrong_fact', 'not_visible', 'mixed_up', 'unhelpful', 'other'] as const;
export type IdTipIssueType = typeof ID_TIP_ISSUE_TYPES[number];

export const ID_TIP_ISSUE_LABELS: Record<IdTipIssueType, string> = {
  wrong_fact:  'wrong about this species',
  not_visible: 'feature not visible in photo',
  mixed_up:    'mixes up the two birds',
  unhelpful:   'unhelpful or confusing',
  other:       'other issue',
};

export const ID_TIP_REPORT_MIN = 10;
export const ID_TIP_REPORT_MAX = 500;

export interface IdTipReport extends IdTipRequest {
  issueType: IdTipIssueType;
  description: string;
  notifyEmail: boolean;
  regionCode: string | null;
}

/** Validates a report submission: the tip it refers to, an issue type and a required description. */
export function validateIdTipReport(body: unknown): Parsed<IdTipReport> {
  const tip = validateIdTipRequest(body);
  if (!tip.ok) return tip;
  const b = (body ?? {}) as Record<string, unknown>;

  if (!(ID_TIP_ISSUE_TYPES as readonly unknown[]).includes(b.issueType)) return { ok: false, error: 'issueType is invalid' };
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length < ID_TIP_REPORT_MIN) return { ok: false, error: 'Please describe what was wrong' };
  if (description.length > ID_TIP_REPORT_MAX) return { ok: false, error: 'description is too long' };
  const regionCode = typeof b.regionCode === 'string' && b.regionCode.trim() ? b.regionCode.trim().slice(0, 40) : null;

  return {
    ok: true,
    value: { ...tip.value, issueType: b.issueType as IdTipIssueType, description, notifyEmail: b.notifyEmail === true, regionCode },
  };
}

export const ID_TIP_RESOLUTIONS = ['fixed', 'kept', 'dismissed'] as const;
export type IdTipResolution = typeof ID_TIP_RESOLUTIONS[number];
export const ID_TIP_NOTE_MAX = 500;

export function validateIdTipResolution(body: unknown): Parsed<{ action: IdTipResolution; note: string | null }> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!(ID_TIP_RESOLUTIONS as readonly unknown[]).includes(b.action)) return { ok: false, error: 'action is invalid' };
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;
  if (note && note.length > ID_TIP_NOTE_MAX) return { ok: false, error: 'note is too long' };
  return { ok: true, value: { action: b.action as IdTipResolution, note } };
}

/** What the reporter is told about the outcome (in-app notification and email body). */
export function idTipResolutionText(action: IdTipResolution): string {
  switch (action) {
    case 'fixed':       return 'Thanks - you were right. The tip has been corrected.';
    case 'kept':        return 'Your concern was noted, but after review the tip was found to be accurate, so it has been kept.';
    case 'dismissed':   return 'After review, this report was found to be inaccurate and has been closed.';
  }
}

export const ID_TIP_SYSTEM = `You are a friendly birding coach inside a bird-identification quiz game.
The player was shown a photo and named the wrong species. You are told the correct species and the player's guess (a common or scientific name).

Write 2-3 short sentences (at most 55 words) pointing out field marks in THIS photo that identify the correct species and separate it from the guessed one.
- Only describe features you can actually see in the photo. If a key distinguishing feature isn't visible (angle, lighting, distance, plumage), say briefly what to look for next time instead.
- Never invent details. Do not question which species is correct; you have been told.
- Don't tell the player they were wrong; they already know. No greeting, lists, headings or markdown - plain text only.`;

export function buildIdTipPrompt(r: Pick<IdTipRequest, 'comName' | 'sciName' | 'guess'>): string {
  return `Correct species: ${r.comName} (${r.sciName})\nPlayer's guess: ${r.guess}`;
}

/**
 * Fixed-window counter per key (e.g. client IP). `now` is injected so it can be tested without timers.
 * Old windows are dropped lazily when the map grows, so memory stays bounded by active clients.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return function allow(key: string, now: number = Date.now()): boolean {
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
    }
    const w = windows.get(key);
    if (!w || now - w.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    if (w.count >= limit) return false;
    w.count++;
    return true;
  };
}

// ── Curator edits ────────────────────────────────────────────────────────────

export const ID_TIP_TEXT_MAX = 1000;

/** Validates a curator's save: the tip it belongs to plus the new text. */
export function validateIdTipSave(body: unknown): Parsed<IdTipRequest & { tip: string }> {
  const req = validateIdTipRequest(body);
  if (!req.ok) return req;
  const raw = (body as Record<string, unknown>).tip;
  const tip = typeof raw === 'string' ? raw.trim() : '';
  if (!tip) return { ok: false, error: 'tip is required' };
  if (tip.length > ID_TIP_TEXT_MAX) return { ok: false, error: 'tip is too long' };
  return { ok: true, value: { ...req.value, tip } };
}

// ── Tip library ──────────────────────────────────────────────────────────────

/** Identity of one tip as a single string: species + lower-cased guess + photo. */
export function tipKeyString(speciesCode: string, guessKeyValue: string, photoUrl: string): string {
  return `${speciesCode}|${guessKeyValue}|${photoUrl}`;
}

/** Counts reports (any status) per tip. */
export function countReportsByTip(
  rows: Array<{ species_code: string; guess_key: string; photo_url: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = tipKeyString(r.species_code, r.guess_key, r.photo_url);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export interface TaxonInfo { familyComName: string; familySciName: string; taxonIndex: number }

/**
 * Maps species code → family and taxonomic position, from a taxonomy list already in taxonomic
 * order (as eBird returns it). Species missing from the taxonomy simply have no entry.
 */
export function indexTaxonomy(
  taxonomy: Array<{ speciesCode: string; familyComName: string; familySciName: string }>,
): Map<string, TaxonInfo> {
  const map = new Map<string, TaxonInfo>();
  taxonomy.forEach((t, i) => map.set(t.speciesCode, { familyComName: t.familyComName, familySciName: t.familySciName, taxonIndex: i }));
  return map;
}

// ── Error logging ────────────────────────────────────────────────────────────

/**
 * One-line description of an error for logs, including its underlying cause chain. The Anthropic
 * SDK's "Connection error." hides the real network failure (ECONNRESET, ETIMEDOUT, ...) in `cause`.
 */
export function describeError(err: unknown, maxDepth = 3): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current != null && depth <= maxDepth; depth++) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      parts.push(typeof code === 'string' && !current.message.includes(code) ? `${current.message} [${code}]` : current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' <- caused by: ');
}
