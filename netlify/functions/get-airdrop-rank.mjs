import { createClient } from '@supabase/supabase-js';

function getEnv(key) {
  if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get(key);
  return process.env[key];
}

function getSupabase() {
  const url = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const key = serviceRoleKey || getEnv('SUPABASE_ANON_KEY');
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const HEADERS = { 'Content-Type': 'application/json' };

export default async (req) => {
  const supabase = getSupabase();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 500, headers: HEADERS });
  }

  const url = new URL(req.url);
  let userId = url.searchParams.get('user_id');
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing user_id' }), { status: 400, headers: HEADERS });
  }

  try {
    if (userId.startsWith('tg_')) {
      const telegram_id = userId.slice(3);
      const { data: tgUser, error: tgErr } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', telegram_id)
        .maybeSingle();

      if (tgErr) {
        console.error('[GET-AIRDROP-RANK] telegram_id lookup failed:', tgErr.message);
        return new Response(JSON.stringify({ error: 'Score lookup failed' }), { status: 500, headers: HEADERS });
      }

      if (!tgUser) {
        return new Response(JSON.stringify({ rank: null, total: null, percentile: null }), { status: 200, headers: HEADERS });
      }

      userId = tgUser.id;
    }

    // Fetch current user's score and total user count in parallel — they don't depend on each other
    const [userRowResult, totalCountResult] = await Promise.all([
      supabase
        .from('airdrop_scores')
        .select('final_airdrop_score')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('airdrop_scores')
        .select('user_id', { count: 'planned', head: true }),
    ]);

    const { data: userRow, error: userErr } = userRowResult;
    const { count: totalCount, error: totalErr } = totalCountResult;

    if (userErr) {
      console.error('[GET-AIRDROP-RANK] User score lookup failed:', userErr.message);
      return new Response(JSON.stringify({ error: 'Score lookup failed' }), { status: 500, headers: HEADERS });
    }

    if (!userRow) {
      return new Response(JSON.stringify({ rank: null, total: null, percentile: null }), { status: 200, headers: HEADERS });
    }

    if (totalErr) {
      console.error('[GET-AIRDROP-RANK] Total count failed:', totalErr.message);
      return new Response(JSON.stringify({ error: 'Total count failed' }), { status: 500, headers: HEADERS });
    }

    const userScore = userRow.final_airdrop_score;

    // Count users with a higher WP (those ranked above) — depends on userScore, so runs after
    const { count: higherCount, error: higherErr } = await supabase
      .from('airdrop_scores')
      .select('user_id', { count: 'planned', head: true })
      .gt('final_airdrop_score', userScore);

    if (higherErr) {
      console.error('[GET-AIRDROP-RANK] Higher count failed:', higherErr.message);
      return new Response(JSON.stringify({ error: 'Rank calculation failed' }), { status: 500, headers: HEADERS });
    }

    const rank = higherCount + 1;
    const percentile = totalCount > 0 ? Math.ceil((rank / totalCount) * 100) : 100;

    return new Response(JSON.stringify({ rank, total: totalCount, percentile }), { status: 200, headers: HEADERS });
  } catch (err) {
    console.error('[GET-AIRDROP-RANK] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: HEADERS });
  }
};
