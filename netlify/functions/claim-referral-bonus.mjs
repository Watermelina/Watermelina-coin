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
    console.error('[CLAIM-REFERRAL-BONUS] Missing SUPABASE_URL or key');
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const BONUS_RATE = 0.20;
const ACTIVE_RUN_THRESHOLD = 3;

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { user_id, referred_user_id } = body;
  // referred_user_id is optional — if omitted, claim all

  if (!user_id) {
    return new Response(JSON.stringify({ error: 'user_id is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Get referrals for this user
    let referralQuery = supabase
      .from('referrals')
      .select('referred_user_id')
      .eq('referrer_user_id', user_id);

    if (referred_user_id) {
      referralQuery = referralQuery.eq('referred_user_id', referred_user_id);
    }

    const { data: referrals, error: refErr } = await referralQuery;
    if (refErr) {
      console.error('[CLAIM-REFERRAL-BONUS] referrals query failed:', refErr.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch referrals' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!referrals || referrals.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'no_referrals', claimed: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const referredIds = referrals.map(r => r.referred_user_id);

    // 2. Get WP for referred users
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, watermelon_points')
      .in('id', referredIds);

    if (usersErr) {
      console.error('[CLAIM-REFERRAL-BONUS] users query failed:', usersErr.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch users' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2b. Get run counts for referred users to check active status
    const { data: runCounts, error: runsErr } = await supabase
      .from('runs')
      .select('user_id')
      .in('user_id', referredIds);

    if (runsErr) {
      console.error('[CLAIM-REFERRAL-BONUS] runs query failed:', runsErr.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch run counts' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const runCountByUser = {};
    for (const r of (runCounts || [])) {
      runCountByUser[r.user_id] = (runCountByUser[r.user_id] || 0) + 1;
    }

    // 3. Get already claimed amounts per referred user
    const { data: claimedEvents, error: claimedErr } = await supabase
      .from('point_events')
      .select('points, metadata')
      .eq('user_id', user_id)
      .eq('event_type', 'referral_bonus_claim');

    if (claimedErr) {
      console.error('[CLAIM-REFERRAL-BONUS] claimed events query failed:', claimedErr.message);
    }

    const claimedByReferred = {};
    for (const ev of (claimedEvents || [])) {
      const refId = ev.metadata?.referred_user_id;
      if (refId) {
        claimedByReferred[refId] = (claimedByReferred[refId] || 0) + (Number(ev.points) || 0);
      }
    }

    // 4. Calculate claimable per user and total
    let totalToClaim = 0;
    const claimDetails = [];

    for (const u of (users || [])) {
      const userRunCount = runCountByUser[u.id] || 0;
      if (userRunCount < ACTIVE_RUN_THRESHOLD) {
        continue; // skip inactive referrals
      }

      const wp = Number(u.watermelon_points) || 0;
      const totalBonus = Math.floor(wp * BONUS_RATE);
      const alreadyClaimed = claimedByReferred[u.id] || 0;
      const claimable = Math.max(0, totalBonus - alreadyClaimed);

      if (claimable > 0) {
        totalToClaim += claimable;
        claimDetails.push({ referred_user_id: u.id, amount: claimable, run_count: userRunCount });
      }
    }

    if (totalToClaim <= 0) {
      return new Response(JSON.stringify({ success: true, claimed: 0, message: 'Nothing to claim' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. Award WP to the referrer
    const { error: updateErr } = await supabase
      .from('users')
      .update({ watermelon_points: supabase.rpc ? undefined : undefined })
      .eq('id', user_id);

    // Use raw SQL increment via RPC-like approach — just read and update
    const { data: referrerData, error: referrerReadErr } = await supabase
      .from('users')
      .select('watermelon_points')
      .eq('id', user_id)
      .single();

    if (referrerReadErr || !referrerData) {
      console.error('[CLAIM-REFERRAL-BONUS] referrer read failed:', referrerReadErr?.message);
      return new Response(JSON.stringify({ error: 'Failed to read referrer balance' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const newBalance = (Number(referrerData.watermelon_points) || 0) + totalToClaim;
    const { error: balanceErr } = await supabase
      .from('users')
      .update({ watermelon_points: newBalance })
      .eq('id', user_id);

    if (balanceErr) {
      console.error('[CLAIM-REFERRAL-BONUS] balance update failed:', balanceErr.message);
      return new Response(JSON.stringify({ error: 'Failed to update balance' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    // 6. Log claim events per referred user
    const eventInserts = claimDetails.map(d => ({
      user_id: user_id,
      event_type: 'referral_bonus_claim',
      points: d.amount,
      metadata: {
        referred_user_id: d.referred_user_id,
        bonus_rate: BONUS_RATE,
        reason: 'referral_bonus_claim',
      },
    }));

    const { error: insertErr } = await supabase
      .from('point_events')
      .insert(eventInserts);

    if (insertErr) {
      console.error('[CLAIM-REFERRAL-BONUS] event insert failed:', insertErr.message);
      // Balance already updated — log but don't fail
    }

    return new Response(JSON.stringify({
      success: true,
      claimed: totalToClaim,
      details: claimDetails,
      new_wp_balance: newBalance,
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[CLAIM-REFERRAL-BONUS] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  path: '/api/claim-referral-bonus',
  method: 'POST',
};
