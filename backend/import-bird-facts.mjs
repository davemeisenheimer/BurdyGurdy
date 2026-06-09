#!/usr/bin/env node
/**
 * import-bird-facts.mjs
 *
 * Bulk-imports bird facts from a CSV file into the bird_facts Supabase table.
 *
 * Usage:
 *   node import-bird-facts.mjs facts.csv
 *
 * The script reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment (or from the .env file if you source it first).
 *
 * CSV format — first row must be a header, column order doesn't matter:
 *
 *   fact_text       (required) The fact sentence.
 *   source_url      (optional) URL to the source.
 *   species_codes   (optional) Semicolon-separated eBird species codes, e.g. amro;bcch
 *   family_names    (optional) Semicolon-separated family sci names, e.g. Turdidae;Paridae
 *   is_active       (optional) true/false — defaults to true if omitted.
 *
 * Example row:
 *   "American Robins can hear earthworms moving underground.",https://example.com,amro,,true
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync }  from 'fs';

// ── Env ────────────────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  console.error('Tip: run  source .env  or prefix the command with the vars.');
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node import-bird-facts.mjs <facts.csv>');
  process.exit(1);
}

// ── CSV parser (handles quoted fields) ────────────────────────────────────────

function parseCsvLine(line) {
  const fields = [];
  let field    = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; } // escaped quote
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

// ── Parse file ────────────────────────────────────────────────────────────────

const raw   = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const lines = raw.split('\n').filter(l => l.trim() !== '');

if (lines.length < 2) {
  console.error('CSV must have a header row and at least one data row.');
  process.exit(1);
}

const [headerLine, ...dataLines] = lines;
const cols = parseCsvLine(headerLine).map(c => c.trim().toLowerCase().replace(/\s+/g, '_'));

const required = ['fact_text'];
for (const col of required) {
  if (!cols.includes(col)) {
    console.error(`Missing required column: ${col}`);
    console.error(`Found columns: ${cols.join(', ')}`);
    process.exit(1);
  }
}

const facts = [];
for (let i = 0; i < dataLines.length; i++) {
  const vals = parseCsvLine(dataLines[i]);
  const get  = name => (vals[cols.indexOf(name)] ?? '').trim();

  const factText = get('fact_text');
  if (!factText) continue; // skip blank rows

  const speciesCodes = get('species_codes').split(';').map(s => s.trim()).filter(Boolean);
  const familyNames  = get('family_names').split(';').map(s => s.trim()).filter(Boolean);
  const isActiveRaw  = get('is_active').toLowerCase();

  facts.push({
    fact_text:     factText,
    source_url:    get('source_url') || null,
    species_codes: speciesCodes.length ? speciesCodes : null,
    family_names:  familyNames.length  ? familyNames  : null,
    is_active:     isActiveRaw !== 'false',
  });
}

if (facts.length === 0) {
  console.error('No data rows found.');
  process.exit(1);
}

// ── Preview ───────────────────────────────────────────────────────────────────

console.log(`\nParsed ${facts.length} fact(s):`);
for (const f of facts.slice(0, 3)) {
  console.log(`  • ${f.fact_text.slice(0, 80)}${f.fact_text.length > 80 ? '…' : ''}`);
}
if (facts.length > 3) console.log(`  … and ${facts.length - 3} more`);

// ── Insert ────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('\nInserting…');
const { error } = await supabase.from('bird_facts').insert(facts);

if (error) {
  console.error('Insert failed:', error.message);
  process.exit(1);
}

console.log(`Done — ${facts.length} fact(s) added.\n`);
