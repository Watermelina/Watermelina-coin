import { createClient } from '@supabase/supabase-js';

// ── Supabase connection ─────────────────────────────────────────
function getEnv(key) {
  if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get(key);
  return process.env[key];
}

function getSupabase() {
  const url = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const key = serviceRoleKey || getEnv('SUPABASE_ANON_KEY');

  if (!url || !key) {
    console.error('[GET-LEADERBOARD] CONFIG ERROR: Missing SUPABASE_URL or SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY environment variables');
    return null;
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export default async (req) => {
  const supabase = getSupabase();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Supabase not configured. Required environment variables: SUPABASE_URL and SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse optional user_id from query string for "your rank" calculation
  const url = new URL(req.url);
  const userId = url.searchParams.get('user_id');

  try {
    // Top-score-first: fetch one bounded window of the highest-scoring
    // non-suspicious runs and walk it to collect the first 10 unique
    // user_ids. Because rows are ordered by score DESC, the first time
    // we see a user_id is that user's MAX(score). The previous full-
    // table pagination loop hit Supabase/Netlify timeouts on a large
    // runs table, which surfaced as "Error loading leaderboard".
    const FETCH_LIMIT = 2000;
    const { data: topRuns, error: runsErr } = await supabase
      .from('runs')
      .select('user_id, score')
      .eq('suspicious', false)
      .not('score', 'is', null)
      .not('user_id', 'is', null)
      .order('score', { ascending: false })
      .range(0, FETCH_LIMIT - 1);

    if (runsErr) {
      console.error('[GET-LEADERBOARD] runs query failed:', runsErr.message);
      return new Response(JSON.stringify({ error: 'Leaderboard query failed.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const bestByUser = {};
    const rankedIds = [];
    for (const r of (topRuns || [])) {
      const uid = r.user_id;
      if (uid == null) continue;
      if (bestByUser[uid] == null) {
        bestByUser[uid] = Number(r.score) || 0;
        rankedIds.push(uid);
      }
    }
    const topIds = rankedIds.slice(0, 10);

    let userMap = {};
    if (topIds.length > 0) {
      const { data: users, error: usersErr } = await supabase
        .from('users')
        .select('id, username, first_name')
        .in('id', topIds);
      if (usersErr) {
        console.error('[GET-LEADERBOARD] users query failed:', usersErr.message);
      } else {
        for (const u of (users || [])) userMap[u.id] = u;
      }
    }

    const top10 = topIds.map(id => ({
      user_id: id,
      best_score: bestByUser[id],
      username: userMap[id]?.username || null,
      first_name: userMap[id]?.first_name || null,
    }));

    let result = { top10 };

    // If user_id provided and not in top 10, derive their rank from
    // the same in-memory map so the rank reflects the full dataset.
    if (userId) {
      const userInTop = top10.some(row => row.user_id === userId);
      if (!userInTop && bestByUser[userId] != null) {
        const myBest = bestByUser[userId];
        let higher = 0;
        for (const uid of rankedIds) {
          if (bestByUser[uid] > myBest) higher++;
          else break;
        }
        result.user_rank = { rank: higher + 1, best_score: myBest };
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET-LEADERBOARD] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
