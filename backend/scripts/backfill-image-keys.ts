/**
 * One-off backfill: populates media_reports.image_key for existing rows by parsing the
 * stable Commons filename out of the already-stored `url`, for Wikipedia/Wikimedia photos.
 *
 * Run modes:
 *   npx tsx scripts/backfill-image-keys.ts            (dry run - prints what would change, writes nothing)
 *   npx tsx scripts/backfill-image-keys.ts --apply     (applies the updates)
 *
 * Run from the backend/ directory so dotenv picks up backend/.env.
 */
import dotenv from 'dotenv';
dotenv.config();

import { getSupabaseAdmin } from '../src/lib/supabase';

interface Row {
  id: string;
  url: string;
  image_key: string | null;
  species_code: string;
  status: string;
}

/** Extracts the stable Commons filename from a Wikimedia upload URL, or null if not one. */
function extractImageKey(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!u.hostname.includes('wikimedia.org')) return null;

  const parts = u.pathname.split('/').filter(Boolean);
  const ci = parts.indexOf('commons');
  if (ci === -1) return null;

  // Thumb URL:    /wikipedia/commons/thumb/<h1>/<h2>/<Filename>/<size>px-<Filename>
  // Original URL: /wikipedia/commons/<h1>/<h2>/<Filename>
  const filename = parts[ci + 1] === 'thumb' ? parts[ci + 4] : parts[ci + 3];
  if (!filename) return null;
  try { return decodeURIComponent(filename); } catch { return filename; }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const admin = getSupabaseAdmin();

  const { data, error } = await admin
    .from('media_reports')
    .select('id, url, image_key, species_code, status')
    .is('image_key', null);
  if (error) {
    console.error('Failed to fetch media_reports:', error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  console.log(`Found ${rows.length} row(s) with no image_key set.\n`);

  const toUpdate: { id: string; imageKey: string; url: string; speciesCode: string; status: string }[] = [];
  const skipped: Row[] = [];

  for (const row of rows) {
    const key = extractImageKey(row.url);
    if (key) toUpdate.push({ id: row.id, imageKey: key, url: row.url, speciesCode: row.species_code, status: row.status });
    else skipped.push(row);
  }

  console.log(`Wikipedia-sourced (will backfill): ${toUpdate.length}`);
  console.log(`Non-Wikipedia / unparseable (left alone - Macaulay/iNat urls are already stable): ${skipped.length}\n`);

  console.log('Preview of backfills (first 20):');
  for (const r of toUpdate.slice(0, 20)) {
    console.log(`  [${r.status}] ${r.speciesCode}  ${r.url}\n    -> image_key: ${r.imageKey}`);
  }
  if (toUpdate.length > 20) console.log(`  ...and ${toUpdate.length - 20} more`);

  if (!apply) {
    console.log('\nDry run only - no changes written. Re-run with --apply to write these updates.');
    return;
  }

  console.log('\nApplying updates...');
  let done = 0;
  let failed = 0;
  const CONCURRENCY = 10;
  for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
    const batch = toUpdate.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(r =>
      admin.from('media_reports').update({ image_key: r.imageKey }).eq('id', r.id),
    ));
    for (const res of results) {
      if (res.error) { failed++; console.error('  update failed:', res.error.message); }
      else done++;
    }
  }
  console.log(`\nDone. ${done} updated, ${failed} failed.`);
}

main().catch(err => { console.error(err); process.exit(1); });
