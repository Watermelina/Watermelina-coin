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
    console.error('[CLAIM-MISSION] CONFIG ERROR: Missing Supabase URL or key');
    return null;
  }

  return createClient(url, key);
}

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

  const { mission_id } = body;
  if (!mission_id) {
    return Response.json({ success: false, error: 'missing_mission_id' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json(
      { success: false, error: 'server_config_error' },
      { status: 500 }
    );
  }

  console.log(`[CLAIM-MISSION] ── Start ── user=${userId} mission=${mission_id}`);

  try {
    const { data, error } = await supabase.rpc('claim_mission', {
      p_user_id: userId,
      p_mission_id: mission_id
    });

    if (error) {
      console.error(`[CLAIM-MISSION] RPC error: code=${error.code} message=${error.message} details=${error.details}`);
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    let result = data;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch { /* use as-is */ }
    }

    console.log(`[CLAIM-MISSION] ── Result ── ${JSON.stringify(result)}`);
    return Response.json(result);
  } catch (err) {
    console.error(`[CLAIM-MISSION] Unexpected error: ${err.message}`);
    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/claim-mission',
  method: 'POST'
};
