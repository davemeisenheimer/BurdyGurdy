/**
 * Seeds the `macaulay` slot of the species_photos table with top-rated Macaulay Library photos.
 *
 * Background: Macaulay's search API sits behind an Anubis proof-of-work bot challenge, so the running
 * backend cannot use it. A real browser clears the challenge on its own, so this script drives your
 * installed Chrome (visible window, not headless), lets it clear the challenge, and then makes each
 * search from inside that page at a slow, jittered pace. Results are stored durably; the app then
 * serves them without ever contacting Macaulay.
 *
 * Please be a considerate client: keep the delay generous, run it in modest batches (--limit), and
 * consider asking the Macaulay Library team for permission or an official data route. The script stops
 * by itself after repeated failures or if the service answers 403/429.
 *
 * Safe to re-run: species that already have stored Macaulay photos are skipped (use --refresh to
 * re-fetch; results are merged add-only). Nothing is written for species with no results.
 *
 * Run from the backend/ directory so dotenv picks up backend/.env. The local backend must be running
 * (it lists the species):
 *   npx tsx scripts/seed-macaulay-photos.ts --region CA-ON-OT --limit 25
 *   npx tsx scripts/seed-macaulay-photos.ts --codes yebsap,amerob
 *   npx tsx scripts/seed-macaulay-photos.ts --region CA-ON-OT --dry-run
 */
import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { chromium, type Browser, type Page } from 'playwright-core';
import { getSupabaseAdmin } from '../src/lib/supabase';
import { loadSlots, saveSlot, touchSlot } from '../src/services/photoStore';
import { planSlotWrite } from '../src/lib/photoSlots';
import {
  classifyMacaulayBody, jitteredDelayMs, parseSeedArgs, selectSeedTargets,
  MAX_CONSECUTIVE_FAILURES, SEED_DEFAULTS, type SeedArgs,
} from '../src/lib/macaulaySeed';
import { parseRetryAfterMs } from '../src/lib/hostGate';

const SEARCH_ORIGIN = 'https://search.macaulaylibrary.org';
const CHALLENGE_TIMEOUT_MS = 120_000;
const WARM_CHUNK = 200;

interface Candidate {
  speciesCode: string;
  comName: string;
  sciName: string;
}

const USAGE = `Usage: npx tsx scripts/seed-macaulay-photos.ts (--region <code[,code]> | --codes <a,b,c>) [options]

  --region <codes>     eBird region(s) whose species lists are seeded (e.g. CA-ON-OT)
  --codes <codes>      specific eBird species codes (e.g. yebsap,amerob)
  --back <1|7|30>      observation window for --region lists (default ${SEED_DEFAULTS.back})
  --limit <n>          stop after n species; re-run later to continue
  --count <n>          photos kept per species, 1-10 (default ${SEED_DEFAULTS.count})
  --delay-ms <ms>      average pause between requests, min 1000 (default ${SEED_DEFAULTS.delayMs})
  --refresh            also re-fetch species that already have stored Macaulay photos (add-only merge)
  --dry-run            list what would be fetched; no browser, no writes
  --backend-url <url>  local backend used to list species (default ${SEED_DEFAULTS.backendUrl})
  --chrome-path <path> Chrome/Edge executable (default: the installed Chrome)`;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function searchUrl(speciesCode: string, count: number): string {
  const params = new URLSearchParams({
    taxonCode: speciesCode, mediaType: 'photo', count: String(count), sort: 'rating_rank_desc',
  });
  return `${SEARCH_ORIGIN}/api/v2/search?${params}`;
}

/**
 * Each region listing fans out to ~15 eBird calls on the backend (getCommonSpeciesCodes alone fires
 * 12 parallel historic-data requests). eBird's own burst limit (25 req/5s at last check) is easy to
 * trip when several regions are listed back-to-back - confirmed by reproducing the exact failure as
 * an HTTP 429 from api.ebird.org, not a bug in the region-listing code itself. Pace generously and
 * honor the backend's Retry-After (routes/birds.ts surfaces it as retryAfterMs) when it's rate-limited.
 */
const REGION_LIST_DELAY_MS = 2000;
const REGION_LIST_RETRY_DELAY_MS = 5000;
const REGION_LIST_MAX_ATTEMPTS = 3;

async function loadCandidates(args: SeedArgs): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const pick = (e: Candidate): Candidate => ({ speciesCode: e.speciesCode, comName: e.comName, sciName: e.sciName });

  for (let i = 0; i < args.regions.length; i++) {
    const region = args.regions[i];
    for (let attempt = 1; attempt <= REGION_LIST_MAX_ATTEMPTS; attempt++) {
      try {
        const res = await axios.get<Candidate[]>(`${args.backendUrl}/api/birds/region/${encodeURIComponent(region)}`, {
          params: { back: args.back }, timeout: 180_000,
        });
        console.log(`  ${region}: ${res.data.length} species`);
        out.push(...res.data.map(pick));
        break;
      } catch (err) {
        const retryAfterMs = (err as { response?: { data?: { retryAfterMs?: number } } })?.response?.data?.retryAfterMs;
        if (attempt < REGION_LIST_MAX_ATTEMPTS) {
          await sleep(retryAfterMs ?? REGION_LIST_RETRY_DELAY_MS);
          continue;
        }
        // One bad or unrecognized region code should not abort listing for the rest of a large batch.
        console.warn(`  ${region}: failed to list species, skipping (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    if (i < args.regions.length - 1) await sleep(REGION_LIST_DELAY_MS);
  }
  if (args.codes.length > 0) {
    const res = await axios.get<Candidate[]>(`${args.backendUrl}/api/birds/all-species`, { timeout: 180_000 });
    const byCode = new Map(res.data.map(e => [e.speciesCode, e]));
    for (const code of args.codes) {
      const entry = byCode.get(code);
      if (entry) out.push(pick(entry));
      else console.warn(`  unknown species code, skipping: ${code}`);
    }
  }
  return out;
}

/** Species that already have at least one stored Macaulay photo. */
async function loadAlreadySeeded(codes: string[]): Promise<Set<string>> {
  const db = getSupabaseAdmin();
  const seeded = new Set<string>();
  for (let i = 0; i < codes.length; i += WARM_CHUNK) {
    const { data, error } = await db
      .from('species_photos')
      .select('species_code, photos')
      .eq('source', 'macaulay')
      .in('species_code', codes.slice(i, i + WARM_CHUNK));
    if (error) throw new Error(`could not read species_photos: ${error.message}`);
    for (const row of data ?? []) {
      if (Array.isArray(row.photos) && row.photos.length > 0) seeded.add(row.species_code as string);
    }
  }
  return seeded;
}

/**
 * Loads a search URL in the browser and waits for the bot challenge to clear (Chrome does this by
 * itself in a few seconds). If a human step is needed, do it in the open window.
 */
async function clearChallenge(page: Page, probeUrl: string): Promise<void> {
  console.log('  clearing the bot challenge in the browser window...');
  await page.goto(probeUrl, { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // The page navigates as the challenge completes, which can interrupt an evaluate.
    const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    const body = classifyMacaulayBody(text);
    if (body.kind === 'photos' || (body.kind === 'unexpected' && text.trim().startsWith('{'))) return;
    await sleep(1000);
  }
  throw new Error(`the challenge was not cleared within ${CHALLENGE_TIMEOUT_MS / 1000}s - check the browser window`);
}

async function searchInPage(page: Page, url: string): Promise<{ status: number; text: string }> {
  return page.evaluate(async u => {
    const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } });
    return { status: r.status, text: await r.text() };
  }, url);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return; }
  const parsed = parseSeedArgs(argv);
  if (!parsed.ok) { console.error(`Error: ${parsed.error}\n\n${USAGE}`); process.exitCode = 1; return; }
  const args = parsed.args;

  console.log('Listing species...');
  const candidates = await loadCandidates(args);
  const uniqueCodes = [...new Set(candidates.map(c => c.speciesCode))];
  const seeded = await loadAlreadySeeded(uniqueCodes);
  const targets = selectSeedTargets(candidates, seeded, { refresh: args.refresh, limit: args.limit });
  console.log(`${uniqueCodes.length} species listed, ${seeded.size} already seeded, ${targets.length} to fetch` +
    `${args.limit !== null ? ` (limit ${args.limit})` : ''}.`);

  if (args.dryRun) {
    for (const t of targets.slice(0, 20)) console.log(`  ${t.speciesCode}  ${t.comName}`);
    if (targets.length > 20) console.log(`  ... and ${targets.length - 20} more`);
    return;
  }
  if (targets.length === 0) { console.log('Nothing to do.'); return; }

  const est = Math.ceil((targets.length * args.delayMs) / 60_000);
  console.log(`Opening Chrome. This will take roughly ${est} minute(s) at ~${args.delayMs / 1000}s per species.`);

  const browser: Browser = await chromium.launch({
    headless: false,
    ...(args.chromePath ? { executablePath: args.chromePath } : { channel: 'chrome' }),
  });
  process.once('SIGINT', () => { void browser.close().finally(() => process.exit(130)); });

  let saved = 0, noResults = 0, failed = 0, consecutiveFailures = 0, stoppedEarly: string | null = null;
  try {
    const page = await (await browser.newContext()).newPage();
    await clearChallenge(page, searchUrl(targets[0].speciesCode, args.count));

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const label = `[${i + 1}/${targets.length}] ${t.speciesCode} ${t.comName}`;
      const url = searchUrl(t.speciesCode, args.count);
      try {
        let res = await searchInPage(page, url);
        let body = classifyMacaulayBody(res.text);
        if (body.kind === 'challenge') {           // clearance expired: clear it again once and retry
          await clearChallenge(page, url);
          res = await searchInPage(page, url);
          body = classifyMacaulayBody(res.text);
        }
        if (res.status === 403 || res.status === 429) { stoppedEarly = `Macaulay answered HTTP ${res.status}`; break; }

        if (body.kind !== 'photos') {
          failed++; consecutiveFailures++;
          console.warn(`${label} → FAILED (${body.kind === 'unexpected' ? body.detail : 'challenge again'})`);
        } else if (body.photos.length === 0) {
          consecutiveFailures = 0; noResults++;
          console.log(`${label} → no results (nothing stored)`);
        } else {
          const existing = (await loadSlots(t.speciesCode)).get('macaulay');
          const plan = planSlotWrite(existing, 'ok', body.photos);
          if (plan.action === 'save') {
            if (await saveSlot(t.speciesCode, 'macaulay', t.sciName, plan.photos)) {
              consecutiveFailures = 0; saved++;
              console.log(`${label} → ${body.photos.length} photo(s), ${plan.photos.length} stored`);
            } else {
              failed++; consecutiveFailures++;
              console.warn(`${label} → FAILED to write to the database`);
            }
          } else {
            if (plan.action === 'touch') await touchSlot(t.speciesCode, 'macaulay');
            consecutiveFailures = 0;
            console.log(`${label} → nothing new`);
          }
        }
      } catch (err) {
        failed++; consecutiveFailures++;
        console.warn(`${label} → FAILED (${err instanceof Error ? err.message : String(err)})`);
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) { stoppedEarly = `${MAX_CONSECUTIVE_FAILURES} failures in a row`; break; }
      if (i < targets.length - 1) await sleep(jitteredDelayMs(args.delayMs));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`\nDone: ${saved} saved, ${noResults} with no results, ${failed} failed.` +
    (stoppedEarly ? `\nStopped early: ${stoppedEarly}. Re-run later to continue where this left off.` : ''));
  if (stoppedEarly) process.exitCode = 2;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
