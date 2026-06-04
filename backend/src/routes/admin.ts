import { Router } from 'express';
import { getSupabaseAdmin } from '../lib/supabase';

const router = Router();

// GET /api/admin/users
// Returns all users with their progress stats.
// Requires a valid Bearer token from a user with is_admin: true in their metadata.
router.get('/users', async (req, res) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try { admin = getSupabaseAdmin(); }
  catch (e) { return res.status(500).json({ error: (e as Error).message }); }

  // Verify the token and check admin flag.
  const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !caller) {
    console.error('[admin] getUser failed:', authErr?.message ?? 'no user returned');
    return res.status(401).json({ error: 'Invalid token', detail: authErr?.message });
  }
  if (caller.user_metadata?.is_admin !== true) return res.status(403).json({ error: 'Forbidden' });

  type ProgressRow = { user_id: string; species_code: string; question_type: string; in_history: boolean };

  async function fetchAllProgress() {
    const rows: ProgressRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: pageErr } = await admin
        .from('bird_progress')
        .select('user_id, species_code, question_type, in_history')
        .range(from, from + PAGE - 1);
      if (pageErr || !page) break;
      rows.push(...(page as ProgressRow[]));
      if (page.length < PAGE) break;
    }
    return rows;
  }

  // Run all three independent fetches in parallel now that admin access is confirmed.
  const [
    { data: usersData, error: usersErr },
    allProgress,
    { data: profiles },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    fetchAllProgress(),
    admin.from('profiles').select('id, display_name'),
  ]);
  if (usersErr) return res.status(500).json({ error: usersErr.message });

  // Aggregate progress stats per user.
  // Track per-species which types exist and which are mastered, so we can compute
  // both per-type mastered counts and "all types mastered" per species.
  type SpeciesStats = { total: Set<string>; mastered: Set<string> };
  const statsByUser = new Map<string, Map<string, SpeciesStats>>();

  for (const row of allProgress) {
    if (!statsByUser.has(row.user_id)) statsByUser.set(row.user_id, new Map());
    const bySpecies = statsByUser.get(row.user_id)!;
    if (!bySpecies.has(row.species_code)) bySpecies.set(row.species_code, { total: new Set(), mastered: new Set() });
    const s = bySpecies.get(row.species_code)!;
    s.total.add(row.question_type);
    if (row.in_history) s.mastered.add(row.question_type);
  }

  const profileMap = new Map(
    ((profiles ?? []) as Array<{ id: string; display_name: string | null }>)
      .map(p => [p.id, p.display_name]),
  );

  const result = usersData.users.map(u => {
    const bySpecies = statsByUser.get(u.id);
    let masteredAll = 0;
    const masteredByType: Record<string, number> = {};

    if (bySpecies) {
      for (const s of bySpecies.values()) {
        // "All mastered": every attempted type is mastered.
        if (s.mastered.size === s.total.size) masteredAll++;
        // Per-type mastered: count species where that specific type is mastered.
        for (const qt of s.mastered) {
          masteredByType[qt] = (masteredByType[qt] ?? 0) + 1;
        }
      }
    }

    return {
      id:            u.id,
      email:         u.email          ?? null,
      username:      profileMap.get(u.id)
                     ?? (u.user_metadata?.full_name as string | undefined)
                     ?? (u.user_metadata?.name     as string | undefined)
                     ?? null,
      lastSignIn:    u.last_sign_in_at ?? null,
      birdsSeen:     bySpecies?.size ?? 0,
      masteredAll,
      masteredByType,
    };
  });

  res.json(result);
});

export default router;
