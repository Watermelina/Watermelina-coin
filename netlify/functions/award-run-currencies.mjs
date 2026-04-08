import { createClient } from '@supabase/supabase-js';

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
    console.error('[AWARD-RUN-CURRENCIES] CONFIG ERROR: Missing Supabase URL or key');
    return null;
  }

  return createClient(url, key);
}

function normalizeRpcResult(raw) {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { /* leave as-is */ }
  }

  const unwrapped = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof unwrapped === 'string') {
    try { return JSON.parse(unwrapped); } catch { return unwrapped; }
  }
  return unwrapped;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ success: false, error: 'server_config_error' }, { status: 500 });
  }

  const {
    p_user_id,
    p_score,
    p_seeds,
    p_max_combo,
    p_avg_combo,
    p_time_survived,
    p_level
  } = body || {};

  if (!p_user_id) {
    return Response.json({ success: false, error: 'missing_user_id' }, { status: 400 });
  }

  const payload = {
    p_user_id,
    p_score,
    p_seeds,
    p_max_combo,
    p_avg_combo,
    p_time_survived,
    p_level
  };

  try {
    const { data, error } = await supabase.rpc('award_run_currencies', payload);
    if (error) {
      console.error(`[AWARD-RUN-CURRENCIES] RPC error: code=${error.code} message=${error.message} details=${error.details}`);
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }

    const result = normalizeRpcResult(data);

    return Response.json(result);
  } catch (err) {
    console.error(`[AWARD-RUN-CURRENCIES] Unexpected error: ${err.message}`);
    return Response.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

export const config = {
  path: '/api/award-run-currencies',
  method: 'POST'
};
