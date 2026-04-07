import { createClient } from '@supabase/supabase-js';
import { createHmac, createHash } from 'crypto';

// ── Helpers ────────────────────────────────────────────────────────
function getEnv(key) {
  if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get(key);
  return process.env[key];
}

function getSupabase() {
  const url = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const key = serviceRoleKey || getEnv('SUPABASE_ANON_KEY');
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// ── Telegram initData verification ─────────────────────────────────
function verifyTelegramInitData(initDataRaw, botToken) {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const entries = [...params.entries()];
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computed !== hash) return null;

  const userField = params.get('user');
  if (!userField) return null;

  try {
    return JSON.parse(userField);
  } catch {
    return null;
  }
}

// ── Handler ────────────────────────────────────────────────────────
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Verify Telegram initData ─────────────────────────────────────
  const initData = body.initData;
  if (!initData) {
    return new Response(JSON.stringify({ error: 'Missing initData' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const botToken = getEnv('TELEGRAM_BOT_TOKEN');
  if (!botToken) {
    console.error('[ADD-CREW-MEMBER] CONFIG ERROR: Missing TELEGRAM_BOT_TOKEN');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const telegramUser = verifyTelegramInitData(initData, botToken);
  if (!telegramUser) {
    return new Response(JSON.stringify({ error: 'Invalid initData' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const telegramUserId = String(telegramUser.id);

  // ── Validate member_user_id ──────────────────────────────────────
  const { member_user_id } = body;
  if (!member_user_id) {
    return new Response(JSON.stringify({ error: 'Missing member_user_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Supabase ─────────────────────────────────────────────────────
  const supabase = getSupabase();
  if (!supabase) {
    return new Response(JSON.stringify({ error: 'Service unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Resolve current user from Telegram ID ────────────────────────
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', Number(telegramUserId))
    .single();

  if (userError || !userRow) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = userRow.id;

  // ── Self-add check ───────────────────────────────────────────────
  if (userId === member_user_id) {
    return new Response(JSON.stringify({ error: 'Cannot add yourself to your own crew' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Upsert crew connection ───────────────────────────────────────
  try {
    const { error: upsertError } = await supabase
      .from('crew_connections')
      .upsert(
        { owner_id: userId, member_id: member_user_id },
        { onConflict: 'owner_id,member_id' }
      );

    if (upsertError) {
      console.error('[ADD-CREW-MEMBER] Upsert error:', upsertError);
      return new Response(JSON.stringify({ error: 'Failed to add crew member' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[ADD-CREW-MEMBER] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
