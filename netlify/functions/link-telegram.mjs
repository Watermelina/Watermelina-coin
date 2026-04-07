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
    return null;
  }
  return createClient(url, key);
}

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
  }

  const userId = req.headers.get('x-user-id');
  console.log(`[LINK-TG][DEBUG] x-user-id header: ${JSON.stringify(userId)}`);
  if (!userId) {
    return Response.json({ success: false, error: 'missing_user_id', debug_user_id: userId }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'invalid_json', debug_user_id: userId }, { status: 400 });
  }

  console.log(`[LINK-TG][DEBUG] Full parsed request body: ${JSON.stringify(body)}`);
  console.log(`[LINK-TG][DEBUG] Field presence — telegram_id: ${body.telegram_id !== undefined}, telegram_username: ${body.telegram_username !== undefined}, telegram_first_name: ${body.telegram_first_name !== undefined}`);

  const { telegram_id, telegram_username, telegram_first_name } = body;
  if (!telegram_id) {
    return Response.json({ success: false, error: 'missing_telegram_id', debug_user_id: userId, debug_body: body }, { status: 400 });
  }

  console.log(`[LINK-TG] user=${userId} telegram_id=${telegram_id} username=${telegram_username || '(none)'}`);

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ success: false, error: 'server_config_error', debug_user_id: userId, debug_body: body }, { status: 500 });
  }

  // Build the update payload for Supabase (only confirmed-safe columns)
  const updatePayload = {
    telegram_id: telegram_id,
    username: telegram_username || null,
    first_name: telegram_first_name || null
  };
  console.log(`[LINK-TG][DEBUG] Supabase update payload: ${JSON.stringify(updatePayload)}`);
  console.log(`[LINK-TG][DEBUG] Updating users table where id = ${JSON.stringify(userId)}`);

  // Upsert the telegram link on the user's row
  const { data, error } = await supabase
    .from('users')
    .update(updatePayload)
    .eq('id', userId);

  console.log(`[LINK-TG][DEBUG] Supabase update result — data: ${JSON.stringify(data)}, error: ${JSON.stringify(error)}`);

  if (error) {
    console.error(`[LINK-TG] Update failed: code=${error.code} message=${error.message}`);
    return Response.json({
      success: false,
      error: error.message,
      debug_user_id: userId,
      debug_body: body,
      debug_update_payload: updatePayload
    }, { status: 500 });
  }

  console.log(`[LINK-TG] Successfully linked telegram_id=${telegram_id} to user=${userId}`);
  return Response.json({
    success: true,
    debug_user_id: userId,
    debug_body: body,
    debug_update_payload: updatePayload
  });
};

export const config = {
  path: '/.netlify/functions/link-telegram',
  method: 'POST'
};
