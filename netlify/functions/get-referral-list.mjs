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
    console.error('[GET-REFERRAL-LIST] Missing SUPABASE_URL or key');
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
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) {
    return new Response(JSON.stringify({ error: 'user_id is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Get all referrals for this user
    const { data: referrals, error: refErr } = await supabase
      .from('referrals')
      .select('referred_user_id, is_active, reward_granted, created_at')
      .eq('referrer_user_id', userId);

    if (refErr) {
      console.error('[GET-REFERRAL-LIST] referrals query failed:', refErr.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch referrals' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!referrals || referrals.length === 0) {
      return new Response(JSON.stringify({ referrals: [], summary: { total_referrals: 0, total_wp_generated: 0, total_bonus_earned: 0, total_claimable: 0 } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const referredIds = referrals.map(r => r.referred_user_id);

    // 2. Get user info + WP for all referred users
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, username, first_name, watermelon_points')
      .in('id', referredIds);

    if (usersErr) {
      console.error('[GET-REFERRAL-LIST] users query failed:', usersErr.message);
    }

    const userMap = {};
    for (const u of (users || [])) {
      userMap[u.id] = u;
    }

    // 3. Get total referral_bonus_claim events (claimed bonuses)
    const { data: claimedEvents, error: claimedErr } = await supabase
      .from('point_events')
      .select('points, metadata')
      .eq('user_id', userId)
      .eq('event_type', 'referral_bonus_claim');

    if (claimedErr) {
      console.error('[GET-REFERRAL-LIST] claimed events query failed:', claimedErr.message);
    }

    const claimedByReferred = {};
    let totalClaimed = 0;
    for (const ev of (claimedEvents || [])) {
      const refUserId = ev.metadata?.referred_user_id;
      if (refUserId) {
        claimedByReferred[refUserId] = (claimedByReferred[refUserId] || 0) + (Number(ev.points) || 0);
      }
      totalClaimed += (Number(ev.points) || 0);
    }

    // 5. Build referral list
    const BONUS_RATE = 0.20;
    let totalWpGenerated = 0;
    let totalBonusEarned = 0;
    let totalClaimable = 0;

    const referralList = referrals.map(ref => {
      const u = userMap[ref.referred_user_id] || {};
      const wp = Number(u.watermelon_points) || 0;
      const bonusEarned = Math.floor(wp * BONUS_RATE);
      const claimed = claimedByReferred[ref.referred_user_id] || 0;
      const claimable = Math.max(0, bonusEarned - claimed);

      totalWpGenerated += wp;
      totalBonusEarned += bonusEarned;
      totalClaimable += claimable;

      return {
        user_id: ref.referred_user_id,
        username: u.username || null,
        first_name: u.first_name || null,
        is_active: ref.is_active,
        wp_generated: wp,
        bonus_earned: bonusEarned,
        claimed: claimed,
        claimable: claimable,
        joined_at: ref.created_at,
      };
    });

    // Sort by WP generated descending
    referralList.sort((a, b) => b.wp_generated - a.wp_generated);

    return new Response(JSON.stringify({
      referrals: referralList,
      summary: {
        total_referrals: referralList.length,
        total_wp_generated: totalWpGenerated,
        total_bonus_earned: totalBonusEarned,
        total_claimable: totalClaimable,
      }
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET-REFERRAL-LIST] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  path: '/api/get-referral-list',
};
