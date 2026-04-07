import { createClient } from '@supabase/supabase-js';

// ── Authorized dev user ID ─────────────────────────────────────
const DEV_USER_ID = '509e09d7-8f66-44ec-883e-409253b99827';

// ── Supabase connection ─────────────────────────────────────────
const SUPABASE_URL_FALLBACK = 'https://tivqekyexiknxzbbrgun.supabase.co';
const SUPABASE_ANON_KEY_FALLBACK = 'sb_publishable_-tvso--RThiDAbEUBClcxA_n9LEedEw';

function getEnv(key) {
  if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get(key);
  return process.env[key];
}

function getSupabase() {
  const url = getEnv('SUPABASE_URL') || SUPABASE_URL_FALLBACK;
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const key = serviceRoleKey
           || getEnv('SUPABASE_ANON_KEY')
           || SUPABASE_ANON_KEY_FALLBACK;

  if (!url || !key) {
    return { client: null, hasServiceRoleKey: false };
  }

  return { client: createClient(url, key), hasServiceRoleKey: !!serviceRoleKey };
}

// ── CORS headers ────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: CORS
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: CORS
    });
  }

  const { user_id } = body;

  // ── CRITICAL SAFETY CHECK: Only allow the authorized dev user ──
  if (!user_id || user_id !== DEV_USER_ID) {
    console.warn('[DEV-RESET] Unauthorized reset attempt for user_id:', user_id);
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 403, headers: CORS
    });
  }

  const { client: supabase } = getSupabase();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Database unavailable' }), {
      status: 500, headers: CORS
    });
  }

  console.log('[DEV-RESET] Starting PARTIAL progress reset for dev user:', user_id);

  const errors = [];

  // NOTE: FC balance, WP balance, point_events, and runs are intentionally NOT reset.

  // 1. Delete all user upgrades (resets to base level)
  const { error: upgradesErr } = await supabase
    .from('user_upgrades')
    .delete()
    .eq('user_id', user_id);
  if (upgradesErr) errors.push({ step: 'reset_upgrades', error: upgradesErr.message });

  // 2. Delete claimed daily missions
  const { error: dailyErr } = await supabase
    .from('claimed_daily_missions')
    .delete()
    .eq('user_id', user_id);
  if (dailyErr) errors.push({ step: 'reset_daily_missions', error: dailyErr.message });

  // 3. Delete claimed referral missions
  const { error: refMissErr } = await supabase
    .from('claimed_referral_missions')
    .delete()
    .eq('user_id', user_id);
  if (refMissErr) errors.push({ step: 'reset_referral_missions', error: refMissErr.message });

  // 4. Delete user_missions (social/regular mission claims)
  const { error: userMissErr } = await supabase
    .from('user_missions')
    .delete()
    .eq('user_id', user_id);
  if (userMissErr) errors.push({ step: 'reset_user_missions', error: userMissErr.message });

  // 5. Delete mission clicks
  const { error: clicksErr } = await supabase
    .from('mission_clicks')
    .delete()
    .eq('user_id', user_id);
  if (clicksErr) errors.push({ step: 'reset_mission_clicks', error: clicksErr.message });

  // 6. Delete daily mission progress
  const { error: dailyProgErr } = await supabase
    .from('daily_mission_progress')
    .delete()
    .eq('user_id', user_id);
  if (dailyProgErr) errors.push({ step: 'reset_daily_progress', error: dailyProgErr.message });

  if (errors.length > 0) {
    console.error('[DEV-RESET] Partial errors:', JSON.stringify(errors));
    return new Response(JSON.stringify({
      ok: false,
      message: 'Partial reset completed with some errors',
      errors
    }), { status: 207, headers: CORS });
  }

  console.log('[DEV-RESET] Partial reset completed successfully for dev user:', user_id);
  return new Response(JSON.stringify({
    ok: true,
    message: 'Partial progress reset completed (FC, WP, runs, history preserved)',
    reset: [
      'user_upgrades → cleared (back to base level)',
      'claimed_daily_missions → cleared',
      'claimed_referral_missions → cleared',
      'user_missions → cleared',
      'mission_clicks → cleared',
      'daily_mission_progress → cleared',
      'cosmetics → reset to defaults (client-side)'
    ],
    preserved: [
      'fart_coins → unchanged',
      'watermelon_points → unchanged',
      'point_events → unchanged',
      'runs → unchanged',
      'user account → unchanged'
    ]
  }), { status: 200, headers: CORS });
};

export const config = {
  path: '/api/dev-reset'
};
