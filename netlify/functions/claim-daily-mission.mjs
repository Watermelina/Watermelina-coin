import { createClient } from '@supabase/supabase-js';
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
    console.error('[CLAIM-DAILY] CONFIG ERROR: Missing Supabase URL or key');
    return null;
  }

  return createClient(url, key);
}

const ALLOWED_MISSIONS = ['PLAY_3_RUNS', 'COLLECT_30_SEEDS', 'REACH_500_SCORE'];

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
  }

  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return Response.json(
      { success: false, error: 'Missing x-user-id header' },
      { status: 400 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const { mission_key } = body;
  if (!mission_key) {
    return Response.json({ success: false, error: 'missing_mission_key' }, { status: 400 });
  }

  if (!ALLOWED_MISSIONS.includes(mission_key)) {
    return Response.json({ success: false, error: 'mission_not_available' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json(
      { success: false, error: 'server_config_error' },
      { status: 500 }
    );
  }

  console.log(`[CLAIM-DAILY] ── Start ── user=${userId} mission=${mission_key}`);

  try {
    const { data, error } = await supabase.rpc('claim_daily_mission', {
      p_user_id: userId,
      p_mission_key: mission_key
    });

    if (error) {
      console.error(`[CLAIM-DAILY] RPC error: code=${error.code} message=${error.message} details=${error.details}`);
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    let result = data;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch { /* use as-is */ }
    }

    console.log(`[CLAIM-DAILY] ── Result ── ${JSON.stringify(result)}`);
    return Response.json(result);
  } catch (err) {
    console.error(`[CLAIM-DAILY] Unexpected error: ${err.message}`);
    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/claim-daily-mission',
  method: 'POST'
};
