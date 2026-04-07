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

  if (!url) {
    console.error('[GRANT-REFERRAL] CONFIG ERROR: SUPABASE_URL is not set and no fallback available');
    return null;
  }
  if (!key) {
    console.error('[GRANT-REFERRAL] CONFIG ERROR: No Supabase key available.');
    return null;
  }

  return createClient(url, key);
}

export default async (req) => {
  const userId = req.headers.get('x-user-id');

  if (!userId) {
    return Response.json(
      { success: false, error: 'Missing x-user-id header' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json(
      { success: false, error: 'server_config_error' },
      { status: 500 }
    );
  }

  try {
    const { data, error } = await supabase.rpc('grant_referral_rewards', {
      p_user_id: userId
    });

    if (error) {
      console.error(`[GRANT-REFERRAL] RPC error: code=${error.code} message=${error.message} details=${error.details}`);
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    let result = data;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch { /* use as-is */ }
    }

    return Response.json(result);
  } catch (err) {
    console.error(`[GRANT-REFERRAL] Unexpected error: ${err.message}`);
    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/grant-referral',
  method: 'POST'
};
