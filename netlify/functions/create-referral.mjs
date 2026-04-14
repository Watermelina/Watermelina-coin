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
    console.error('[CREATE-REFERRAL] CONFIG ERROR: Missing Supabase URL or key');
    return null;
  }

  return createClient(url, key);
}

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { referred_user_id, referral_code } = body;

  if (!referred_user_id || !referral_code) {
    console.error('[CREATE-REFERRAL] Missing required fields:', { referred_user_id: !!referred_user_id, referral_code: !!referral_code });
    return Response.json(
      { success: false, error: 'referred_user_id and referral_code are required' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ success: false, error: 'server_config_error' }, { status: 500 });
  }

  try {
    // 1. Look up the referrer by referral_code (server-side, bypasses RLS)
    const { data: refUser, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', referral_code)
      .maybeSingle();

    if (lookupError) {
      console.error('[CREATE-REFERRAL] Referrer lookup failed:', lookupError.message, lookupError.code);
      return Response.json({ success: false, error: 'referrer_lookup_failed' }, { status: 500 });
    }

    if (!refUser) {
      console.warn('[CREATE-REFERRAL] No user found with referral_code:', referral_code);
      return Response.json({ success: false, error: 'referrer_not_found' }, { status: 404 });
    }

    // 2. Verify user is not referring themselves
    if (refUser.id === referred_user_id) {
      console.warn('[CREATE-REFERRAL] Self-referral blocked for user:', referred_user_id);
      return Response.json({ success: false, error: 'self_referral' }, { status: 400 });
    }

    // 3. Insert referral row with status = PENDING
    //    Use upsert-like approach: insert and handle duplicate gracefully
    const { data: insertedReferral, error: insertError } = await supabase
      .from('referrals')
      .insert({
        referrer_user_id: refUser.id,
        referred_user_id: referred_user_id,
        status: 'PENDING'
      })
      .select()
      .single();

    if (insertError) {
      // 23505 = unique_violation (duplicate) — referral already exists, that's OK
      if (insertError.code === '23505') {
        console.log('[CREATE-REFERRAL] Referral already exists for referred_user_id:', referred_user_id);
        return Response.json({ success: true, already_exists: true });
      }
      console.error('[CREATE-REFERRAL] Insert failed:', insertError.message, insertError.code, insertError.details);
      return Response.json({ success: false, error: 'insert_failed' }, { status: 500 });
    }

    console.log('[CREATE-REFERRAL] Referral created:', {
      referrer: refUser.id,
      referred: referred_user_id,
      status: 'PENDING'
    });

    return Response.json({ success: true, referral_id: insertedReferral?.id });
  } catch (err) {
    console.error('[CREATE-REFERRAL] Unexpected error:', err.message);
    return Response.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};

export const config = {
  path: '/api/create-referral',
  method: 'POST'
};
