/**
 * One-off, read-only analysis: looks at the recent signup spike (SciStarter feature) and
 * checks whether the "engaged experienced birders bored by easy content" hypothesis is
 * supported by actual answer accuracy, or whether something else explains the drop-off.
 *
 * Writes nothing. Run from the backend/ directory so dotenv picks up backend/.env:
 *   npx tsx scripts/analyze-engagement.ts [daysBack]
 *
 * daysBack (default 7) controls the signup window considered "new" for the cohort analysis.
 */
import dotenv from 'dotenv';
dotenv.config();

import { getSupabaseAdmin } from '../src/lib/supabase';

type ProgressRow = {
  user_id: string;
  species_code: string;
  question_type: string;
  correct: number;
  incorrect: number;
  mastery_level: number;
  in_history: boolean;
  last_asked: number;
};

async function fetchAllProgress(admin: ReturnType<typeof getSupabaseAdmin>): Promise<ProgressRow[]> {
  const rows: ProgressRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('bird_progress')
      .select('user_id, species_code, question_type, correct, incorrect, mastery_level, in_history, last_asked')
      .range(from, from + PAGE - 1);
    if (error) { console.error('fetchAllProgress error:', error.message); break; }
    if (!data || data.length === 0) break;
    rows.push(...(data as ProgressRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  const daysBack = Number(process.argv[2]) || 7;
  const admin = getSupabaseAdmin();

  const { data: usersData, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr || !usersData) { console.error('listUsers failed:', usersErr?.message); process.exit(1); }
  const allUsers = usersData.users;

  // ── Signup histogram for the last 10 days, to confirm/locate the spike ──────
  console.log('── Signups by day (last 10 days) ──');
  const now = Date.now();
  const dayCounts = new Map<string, number>();
  for (const u of allUsers) {
    const created = new Date(u.created_at).getTime();
    const ageDays = (now - created) / 86_400_000;
    if (ageDays > 10) continue;
    const key = new Date(u.created_at).toISOString().slice(0, 10);
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }
  [...dayCounts.entries()].sort().forEach(([day, count]) => console.log(`  ${day}: ${count}`));

  // ── Cohort: users created in the last `daysBack` days ───────────────────────
  const cutoff = now - daysBack * 86_400_000;
  const cohort = allUsers.filter(u => new Date(u.created_at).getTime() >= cutoff);
  console.log(`\n── Cohort: ${cohort.length} users signed up in the last ${daysBack} days ──\n`);

  const progress = await fetchAllProgress(admin);
  const byUser = new Map<string, ProgressRow[]>();
  for (const r of progress) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id)!.push(r);
  }

  interface UserStat {
    id: string;
    createdAt: number;
    totalQuestions: number;
    correct: number;
    incorrect: number;
    speciesCount: number;
    masteredSpecies: number;
    maxMasteryLevel: number;
    questionTypes: Set<string>;
    maxLastAsked: number;
    returnedLaterDay: boolean;
  }

  const stats: UserStat[] = cohort.map(u => {
    const rows = byUser.get(u.id) ?? [];
    const correct = rows.reduce((s, r) => s + (r.correct ?? 0), 0);
    const incorrect = rows.reduce((s, r) => s + (r.incorrect ?? 0), 0);
    const bySpecies = new Map<string, { total: Set<string>; mastered: Set<string> }>();
    for (const r of rows) {
      if (!bySpecies.has(r.species_code)) bySpecies.set(r.species_code, { total: new Set(), mastered: new Set() });
      const s = bySpecies.get(r.species_code)!;
      s.total.add(r.question_type);
      if (r.in_history) s.mastered.add(r.question_type);
    }
    let masteredSpecies = 0;
    for (const s of bySpecies.values()) if (s.mastered.size === s.total.size && s.total.size > 0) masteredSpecies++;
    const maxLastAsked = rows.reduce((m, r) => Math.max(m, r.last_asked ?? 0), 0);
    const createdAt = new Date(u.created_at).getTime();
    return {
      id: u.id,
      createdAt,
      totalQuestions: correct + incorrect,
      correct,
      incorrect,
      speciesCount: bySpecies.size,
      masteredSpecies,
      maxMasteryLevel: rows.reduce((m, r) => Math.max(m, r.mastery_level ?? 0), 0),
      questionTypes: new Set(rows.map(r => r.question_type)),
      maxLastAsked,
      returnedLaterDay: maxLastAsked > 0 && (maxLastAsked - createdAt) > 20 * 3600 * 1000, // played >20h after signup
    };
  });

  const played = stats.filter(s => s.totalQuestions > 0);
  const neverPlayed = stats.length - played.length;

  const abandoned   = played.filter(s => s.masteredSpecies === 0);
  const smallMaster  = played.filter(s => s.masteredSpecies >= 1 && s.masteredSpecies <= 10);
  const engaged      = played.filter(s => s.masteredSpecies > 10);

  function summarize(label: string, group: UserStat[]) {
    if (group.length === 0) { console.log(`${label}: 0 users`); return; }
    const avg = (f: (s: UserStat) => number) => group.reduce((sum, s) => sum + f(s), 0) / group.length;
    const totalCorrect = group.reduce((s, u) => s + u.correct, 0);
    const totalIncorrect = group.reduce((s, u) => s + u.incorrect, 0);
    const accuracy = totalCorrect + totalIncorrect > 0 ? totalCorrect / (totalCorrect + totalIncorrect) : NaN;
    const returnedPct = group.filter(s => s.returnedLaterDay).length / group.length;
    const qtypeCounts = new Map<string, number>();
    for (const s of group) for (const qt of s.questionTypes) qtypeCounts.set(qt, (qtypeCounts.get(qt) ?? 0) + 1);
    console.log(`${label}: ${group.length} users`);
    console.log(`  avg questions answered : ${avg(s => s.totalQuestions).toFixed(1)}`);
    console.log(`  pooled accuracy        : ${fmtPct(accuracy)}  (${totalCorrect}/${totalCorrect + totalIncorrect})`);
    console.log(`  avg distinct species   : ${avg(s => s.speciesCount).toFixed(1)}`);
    console.log(`  avg max mastery level  : ${avg(s => s.maxMasteryLevel).toFixed(2)}  (0=Easy,1=Med,2=Hard,3=Mastered)`);
    console.log(`  returned on a later day: ${fmtPct(returnedPct)}`);
    console.log(`  question types touched : ${[...qtypeCounts.entries()].map(([k, v]) => `${k}:${v}`).join(', ')}`);
    console.log();
  }

  console.log(`Never played at all: ${neverPlayed} users\n`);
  summarize('Abandoned (0 mastered)', abandoned);
  summarize('Small master (1-10 mastered)', smallMaster);
  summarize('Engaged (>10 mastered)', engaged);

  // ── Per-question-count-bucket accuracy for the abandoned cohort ─────────────
  // Tests the specific claim: are dropouts acing what little they played (consistent
  // with "too easy, bored"), or missing a meaningful chunk of it (consistent with
  // something else - confusion, bugs, mismatched interest)?
  console.log('── Abandoned cohort: accuracy distribution ──');
  const buckets = [0, 0.5, 0.7, 0.85, 0.95, 1.01];
  const labels = ['<50%', '50-70%', '70-85%', '85-95%', '95-100%'];
  const counts = new Array(labels.length).fill(0);
  for (const s of abandoned) {
    if (s.totalQuestions === 0) continue;
    const acc = s.correct / s.totalQuestions;
    for (let i = 0; i < labels.length; i++) {
      if (acc >= buckets[i] && acc < buckets[i + 1]) { counts[i]++; break; }
    }
  }
  labels.forEach((l, i) => console.log(`  ${l}: ${counts[i]} users`));

  console.log('\n── Raw per-user rows (abandoned cohort, for spot-checking) ──');
  for (const s of abandoned.sort((a, b) => b.totalQuestions - a.totalQuestions).slice(0, 40)) {
    const acc = s.totalQuestions > 0 ? fmtPct(s.correct / s.totalQuestions) : 'n/a';
    console.log(`  q=${String(s.totalQuestions).padStart(3)}  acc=${acc.padStart(6)}  species=${String(s.speciesCount).padStart(2)}  maxLevel=${s.maxMasteryLevel}  types=${[...s.questionTypes].join('/')}  returned=${s.returnedLaterDay}`);
  }

  console.log('\n── Date spot-check (top 15 by question count, all cohorts) ──');
  for (const s of [...played].sort((a, b) => b.totalQuestions - a.totalQuestions).slice(0, 15)) {
    const created = new Date(s.createdAt).toISOString();
    const lastAsked = s.maxLastAsked > 0 ? new Date(s.maxLastAsked).toISOString() : 'n/a';
    console.log(`  q=${String(s.totalQuestions).padStart(3)}  mastered=${s.masteredSpecies}  created=${created}  lastAsked=${lastAsked}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
