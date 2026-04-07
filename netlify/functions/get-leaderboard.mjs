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
    // Top 10 players by best single-run score (excludes suspicious runs)
    const { data: top10, error: top10Err } = await supabase.rpc('get_best_score_leaderboard');

    if (top10Err) {
      console.error('[GET-LEADERBOARD] RPC get_best_score_leaderboard failed:', top10Err.message);
      return new Response(JSON.stringify({ error: 'Leaderboard RPC failed. Ensure the get_best_score_leaderboard() database function exists.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let result = { top10 };

    // If user_id provided and not in top 10, calculate their rank
    if (userId) {
      const userInTop = top10.some(row => row.user_id === userId);
      if (!userInTop) {
        const { data: userRank, error: rankErr } = await supabase.rpc('get_user_best_score_rank', {
          p_user_id: userId,
        });
        if (rankErr) {
          console.error('[GET-LEADERBOARD] RPC get_user_best_score_rank failed:', rankErr.message);
        } else if (userRank) {
          result.user_rank = userRank;
        }
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
