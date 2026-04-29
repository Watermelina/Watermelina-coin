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
    // Top 10 players by best single-run score (excludes suspicious runs).
    // Computed inline from the runs table to avoid dependency on a database
    // RPC that may not be present in every environment.
    const { data: runs, error: runsErr } = await supabase
      .from('runs')
      .select('user_id, score')
      .eq('suspicious', false);

    if (runsErr) {
      console.error('[GET-LEADERBOARD] runs query failed:', runsErr.message);
      return new Response(JSON.stringify({ error: 'Leaderboard query failed.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const bestByUser = {};
    for (const r of (runs || [])) {
      const uid = r.user_id;
      const score = Number(r.score) || 0;
      if (!bestByUser[uid] || score > bestByUser[uid]) {
        bestByUser[uid] = score;
      }
    }

    const rankedIds = Object.keys(bestByUser).sort(
      (a, b) => bestByUser[b] - bestByUser[a]
    );
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

    // If user_id provided and not in top 10, derive their rank from the same data
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
