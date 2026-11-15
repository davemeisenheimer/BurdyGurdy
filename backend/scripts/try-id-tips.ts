/**
 * Experiment: ask Claude Haiku for "here's what you could have noticed" tips after a wrong quiz answer.
 *
 * For each test case (a photo of the correct species + a plausible wrong guess), sends the photo to
 * Claude and asks for 2-3 sentences pointing out field marks visible in that photo. Writes an HTML
 * report (photo, tip, latency, cost) so the tips can be judged by eye. Touches nothing in the app or DB.
 *
 * Needs ANTHROPIC_API_KEY (and the Supabase vars) in backend/.env. Run from the backend/ directory:
 *   npx tsx scripts/try-id-tips.ts --out C:/path/to/report.html
 *   npx tsx scripts/try-id-tips.ts --out report.html --effort medium --source wiki
 *
 * Cost is a few cents per full run at Haiku 5.5 prices.
 */
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '../src/lib/supabase';
import type { AttributedPhoto } from '../src/services/wikipedia';

const MODEL = 'claude-haiku-5-5';
// Haiku 5.5 list prices for prompts under 100K tokens, USD per million tokens.
const INPUT_PER_MTOK = 0.10;
const OUTPUT_PER_MTOK = 0.50;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // API limit for a base64 image

type Effort = 'low' | 'medium' | 'high';
type Source = 'macaulay' | 'wiki' | 'inat';

/** [correct species code, correct common name, guessed species code, guessed common name] */
const CASES: Array<[string, string, string, string]> = [
  ['coohaw', "Cooper's Hawk", 'shshaw', 'Sharp-shinned Hawk'],
  ['shshaw', 'Sharp-shinned Hawk', 'coohaw', "Cooper's Hawk"],
  ['dowwoo', 'Downy Woodpecker', 'haiwoo', 'Hairy Woodpecker'],
  ['haiwoo', 'Hairy Woodpecker', 'dowwoo', 'Downy Woodpecker'],
  ['purfin', 'Purple Finch', 'houfin', 'House Finch'],
  ['houfin', 'House Finch', 'purfin', 'Purple Finch'],
  ['lessca', 'Lesser Scaup', 'gresca', 'Greater Scaup'],
  ['comrav', 'Common Raven', 'amecro', 'American Crow'],
  ['savspa', 'Savannah Sparrow', 'sonspa', 'Song Sparrow'],
  ['amtspa', 'American Tree Sparrow', 'chispa', 'Chipping Sparrow'],
  ['whtspa', 'White-throated Sparrow', 'whcspa', 'White-crowned Sparrow'],
  ['herthr', 'Hermit Thrush', 'swathr', "Swainson's Thrush"],
  ['borchi2', 'Boreal Chickadee', 'bkcchi', 'Black-capped Chickadee'],
  ['gockin', 'Golden-crowned Kinglet', 'ruckin', 'Ruby-crowned Kinglet'],
  ['bkpwar', 'Blackpoll Warbler', 'bawwar', 'Black-and-white Warbler'],
  ['leafly', 'Least Flycatcher', 'easpho', 'Eastern Phoebe'],
  ['amebla', 'American Black Duck', 'mallar3', 'Mallard'],
  ['cacgoo1', 'Cackling Goose', 'cangoo', 'Canada Goose'],
  ['tunswa', 'Tundra Swan', 'truswa', 'Trumpeter Swan'],
  ['rolhaw', 'Rough-legged Hawk', 'rethaw', 'Red-tailed Hawk'],
  ['bkbvul', 'Black Vulture', 'turvul', 'Turkey Vulture'],
  ['grycat', 'Gray Catbird', 'normoc', 'Northern Mockingbird'],
  ['rusbla', 'Rusty Blackbird', 'comgra', 'Common Grackle'],
  ['lobdow', 'Long-billed Dowitcher', 'shbdow', 'Short-billed Dowitcher'],
];

const SYSTEM = `You are a friendly birding coach inside a bird-identification quiz game.
The player was shown a photo and named the wrong species. You are told the correct species and the player's guess.

Write 2-3 sentences (at most about 60 words) pointing out field marks in THIS photo that identify the correct species and separate it from the guessed one.
- Only describe features you can actually see in the photo. If a key distinguishing feature isn't visible (angle, lighting, distance, plumage), say briefly what to look for next time instead.
- Never invent details. Do not question which species is correct; you have been told.
- Don't tell the player they were wrong; they already know. No greeting, lists, headings or markdown - plain text only.`;

interface Result {
  correct: string;
  guess: string;
  photo: AttributedPhoto;
  tip: string;
  firstTextMs: number;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  note?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** First photo of the preferred source, falling back through the others. */
async function pickPhotos(codes: string[], preferred: Source): Promise<Map<string, AttributedPhoto>> {
  const { data, error } = await getSupabaseAdmin()
    .from('species_photos').select('species_code, source, photos').in('species_code', codes);
  if (error) throw new Error(error.message);
  const order: Source[] = [preferred, ...(['macaulay', 'wiki', 'inat'] as Source[]).filter(s => s !== preferred)];
  const picked = new Map<string, AttributedPhoto>();
  for (const code of codes) {
    for (const source of order) {
      const row = data?.find(r => r.species_code === code && r.source === source);
      const photo = (row?.photos as AttributedPhoto[] | undefined)?.[0];
      if (photo) { picked.set(code, photo); break; }
    }
  }
  return picked;
}

async function loadImage(url: string): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }> {
  const res = await fetch(url, { headers: { 'User-Agent': 'BurdyGurdy-tip-experiment/1.0' } });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image too large (${(bytes.length / 1e6).toFixed(1)} MB)`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const mediaType = (['image/png', 'image/webp', 'image/gif'] as const).find(t => t === type) ?? 'image/jpeg';
  return { data: bytes.toString('base64'), mediaType };
}

async function getTip(client: Anthropic, effort: Effort, correct: string, guess: string, photo: AttributedPhoto): Promise<Omit<Result, 'correct' | 'guess' | 'photo'>> {
  const image = await loadImage(photo.url);
  const start = performance.now();
  let firstTextMs = 0;
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: `Correct species: ${correct}\nPlayer's guess: ${guess}` },
      ],
    }],
  });
  stream.on('text', () => { if (!firstTextMs) firstTextMs = performance.now() - start; });
  const msg = await stream.finalMessage();
  const totalMs = performance.now() - start;

  const tip = msg.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('').trim();
  const { input_tokens: inputTokens, output_tokens: outputTokens } = msg.usage;
  let note: string | undefined;
  if (msg.stop_reason === 'refusal') note = `refused (${msg.stop_details?.category ?? 'no category'})`;
  else if (msg.stop_reason === 'max_tokens') note = 'cut off at max_tokens';
  return {
    tip, firstTextMs, totalMs, inputTokens, outputTokens, note,
    costUsd: (inputTokens * INPUT_PER_MTOK + outputTokens * OUTPUT_PER_MTOK) / 1e6,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function writeReport(file: string, results: Result[], skipped: string[], effort: Effort): void {
  const total = results.reduce((s, r) => s + r.costUsd, 0);
  const avg = (f: (r: Result) => number) => results.length ? results.reduce((s, r) => s + f(r), 0) / results.length : 0;
  const rows = results.map(r => `
    <article>
      <a href="${esc(r.photo.url)}" target="_blank"><img src="${esc(r.photo.url)}" alt="${esc(r.correct)}" loading="lazy"></a>
      <div>
        <h2>${esc(r.correct)} <span>guessed as ${esc(r.guess)}</span></h2>
        <p class="tip">${esc(r.tip || '(no text returned)')}</p>
        ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}
        <p class="meta">first text ${(r.firstTextMs / 1000).toFixed(1)} s · done ${(r.totalMs / 1000).toFixed(1)} s ·
          ${r.inputTokens} in / ${r.outputTokens} out · $${r.costUsd.toFixed(4)} · ${esc(r.photo.credit)}</p>
      </div>
    </article>`).join('');
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ID Tip Trial</title>
<style>
:root{--bg:#fafaf7;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e4e4de;--warn:#a33}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ececea;--muted:#9a9a94;--card:#20201e;--line:#33332f;--warn:#e88}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:960px;padding:24px 16px}
header p{color:var(--muted);margin:4px 0}
article{display:grid;grid-template-columns:minmax(0,320px) 1fr;gap:16px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin:16px 0}
@media (max-width:640px){article{grid-template-columns:1fr}}
img{width:100%;border-radius:6px;display:block}
h2{font-size:17px;margin:0 0 8px}h2 span{color:var(--muted);font-weight:400;font-size:14px}
.tip{margin:0 0 8px}.note{color:var(--warn);margin:0 0 8px}.meta{color:var(--muted);font-size:13px;margin:0}
</style></head><body>
<header><h1>ID tip trial: ${MODEL}, effort ${effort}</h1>
<p>${results.length} tips · total $${total.toFixed(4)} · avg first text ${(avg(r => r.firstTextMs) / 1000).toFixed(1)} s · avg done ${(avg(r => r.totalMs) / 1000).toFixed(1)} s</p>
${skipped.length ? `<p>Skipped: ${esc(skipped.join('; '))}</p>` : ''}
</header>${rows}</body></html>`);
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in backend/.env');
  const effort = (arg('effort') ?? 'low') as Effort;
  const source = (arg('source') ?? 'macaulay') as Source;
  const out = path.resolve(arg('out') ?? path.join(os.tmpdir(), 'id-tip-trial.html'));

  const photos = await pickPhotos(CASES.map(c => c[0]), source);
  const client = new Anthropic();
  const results: Result[] = [];
  const skipped: string[] = [];

  // Sequential on purpose, so the latency numbers reflect a single user's wait.
  for (const [code, correct, , guess] of CASES) {
    const photo = photos.get(code);
    if (!photo) { skipped.push(`${correct} (${code}): no stored photo`); continue; }
    try {
      const r = await getTip(client, effort, correct, guess, photo);
      results.push({ correct, guess, photo, ...r });
      console.log(`${correct} vs ${guess}: ${(r.totalMs / 1000).toFixed(1)} s, $${r.costUsd.toFixed(4)}${r.note ? ` [${r.note}]` : ''}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push(`${correct} (${code}): ${msg}`);
      console.warn(`${correct}: skipped - ${msg}`);
    }
  }

  writeReport(out, results, skipped, effort);
  const total = results.reduce((s, r) => s + r.costUsd, 0);
  console.log(`\n${results.length} tips, ${skipped.length} skipped, total $${total.toFixed(4)}\nReport: ${out}`);
}

main().catch(err => { console.error(err); process.exit(1); });
