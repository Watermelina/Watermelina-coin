import { createClient } from '@supabase/supabase-js';

function getEnv(key) {
  if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get(key);
  return process.env[key];
}

function getSupabase() {
  const url = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const key = serviceRoleKey || getEnv('SUPABASE_ANON_KEY');

  if (!url || !key) {
    console.error('[GET-FRIENDS-LEADERBOARD] Missing SUPABASE_URL or key');
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export default async (req) => {
  const supabase = getSupabase();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get('user_id');

  if (!userId) {
    return new Response(JSON.stringify({ error: 'user_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Find all users referred by the current user via the referrals table
    const { data: referrals, error: refErr } = await supabase
      .from('referrals')
      .select('referred_user_id')
      .eq('referrer_user_id', userId);

    if (refErr) {
      console.error('[GET-FRIENDS-LEADERBOARD] referrals query failed:', refErr.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch referrals' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const referralIds = (referrals || []).map(r => r.referred_user_id);

    // Fetch crew_connections where the current user is the owner
    const { data: crewConns, error: crewErr } = await supabase
      .from('crew_connections')
      .select('member_id')
      .eq('owner_id', userId);

    if (crewErr) {
      console.error('[GET-FRIENDS-LEADERBOARD] crew_connections query failed:', crewErr.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch crew connections' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const crewMemberIds = (crewConns || []).map(c => c.member_id);

    // Merge referral IDs + crew connection IDs + current user, de-duplicated
    const allIds = [...new Set([userId, ...referralIds, ...crewMemberIds])];

    // Get best non-suspicious score for each user (current user + referred friends)
    const { data: runs, error: runsErr } = await supabase
      .from('runs')
      .select('user_id, score')
      .in('user_id', allIds)
      .eq('suspicious', false);

    if (runsErr) {
      console.error('[GET-FRIENDS-LEADERBOARD] runs query failed:', runsErr.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch runs' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Compute best score per friend
    const bestScores = {};
    for (const run of (runs || [])) {
      const uid = run.user_id;
      const score = Number(run.score) || 0;
      if (!bestScores[uid] || score > bestScores[uid]) {
        bestScores[uid] = score;
      }
    }

    // Fetch usernames for all crew members (current user + friends)
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, username, first_name')
      .in('id', allIds);

    if (usersErr) {
      console.error('[GET-FRIENDS-LEADERBOARD] users query failed:', usersErr.message);
    }

    const userMap = {};
    for (const u of (users || [])) {
      userMap[u.id] = u;
    }

    // Build a Set of referral IDs for fast lookup
    const referralIdSet = new Set(referralIds);

    // Build ranked list (current user + referred friends)
    const friends = allIds.map(fid => {
      const u = userMap[fid] || {};
      const isReferral = referralIdSet.has(fid);
      const isAdded = !isReferral && crewMemberIds.includes(fid);
      return {
        user_id: fid,
        username: u.username || null,
        first_name: u.first_name || null,
        best_score: bestScores[fid] || 0,
        is_referral: isReferral,
        is_added: isAdded,
      };
    });

    // Sort by best_score descending
    friends.sort((a, b) => b.best_score - a.best_score);

    // Return all crew members (no limit) so the leaderboard scrolls naturally
    return new Response(JSON.stringify({ friends: friends, current_user_id: userId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET-FRIENDS-LEADERBOARD] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
