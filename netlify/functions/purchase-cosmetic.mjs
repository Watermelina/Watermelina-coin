import { createClient } from '@supabase/supabase-js';

// ── Server-side cosmetic price config (SINGLE SOURCE OF TRUTH) ───
// The client MUST NOT be trusted for prices.
const COSMETIC_PRICES = {
  skin_frost:     2500,
  skin_neon:      12000,
  skin_golden:    22000,

  bg_ocean:       2500,
  bg_neon_night:  12000,
  bg_sunset:      22000,

  trail_ice:      2500,
  trail_plasma:   12000,
  trail_solar:    22000
};

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
    console.error('[COSMETIC] CONFIG ERROR: SUPABASE_URL is not set and no fallback available');
    return { client: null, hasServiceRoleKey: false };
  }
  if (!key) {
    console.error('[COSMETIC] CONFIG ERROR: No Supabase key available.',
      'Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY env var.');
    return { client: null, hasServiceRoleKey: false };
  }

  const hasServiceRoleKey = !!serviceRoleKey;
  const keySource = hasServiceRoleKey ? 'service_role' :
                    getEnv('SUPABASE_ANON_KEY') ? 'anon (env)' : 'anon (fallback)';
  console.log(`[COSMETIC] Supabase client initialised — url=${url} keySource=${keySource}`);
  return { client: createClient(url, key), hasServiceRoleKey };
}

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
  }

  const { client: supabase } = getSupabase();
  if (!supabase) {
    return Response.json({ success: false, error: 'server_config_error' }, { status: 500 });
  }

  // ── Parse request body ──
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const { user_id, item_id } = body;
  if (!user_id || !item_id) {
    return Response.json({ success: false, error: 'missing_params' }, { status: 400 });
  }

  console.log(`[COSMETIC] ══════════════════════════════════════════`);
  console.log(`[COSMETIC] ── Start ── user=${user_id} item=${item_id}`);

  // ── Step 1: Look up server-side price (NEVER trust client) ──
  const price = COSMETIC_PRICES[item_id];
  if (price === undefined) {
    console.log(`[COSMETIC] REJECTED: unknown item_id="${item_id}"`);
    return Response.json({ success: false, error: 'item_not_found' }, { status: 400 });
  }

  console.log(`[COSMETIC] Server price for "${item_id}": ${price} FC`);

  // ── Step 2: Fetch user balance from Supabase ──
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('fart_coins')
    .eq('id', user_id)
    .single();

  if (userErr) {
    console.error(`[COSMETIC] User lookup error — code=${userErr.code} message=${userErr.message} details=${userErr.details} hint=${userErr.hint}`);
    return Response.json({ success: false, error: 'user_not_found' }, { status: 404 });
  }
  if (!user) {
    console.error(`[COSMETIC] User not found: ${user_id}`);
    return Response.json({ success: false, error: 'user_not_found' }, { status: 404 });
  }

  const balance = user.fart_coins;
  console.log(`[COSMETIC] User balance: ${balance} FC`);

  // ── Step 3: Check balance against server-side price ──
  if (balance < price) {
    console.log(`[COSMETIC] REJECTED: insufficient balance ${balance} < cost ${price}`);
    return Response.json({
      success: false,
      error: 'insufficient_fart_coins',
      balance,
      cost: price
    });
  }

  // ── Step 4: Call Supabase RPC to deduct (atomic, server-authoritative) ──
  // The RPC deducts the exact price — no arbitrary amount from the client.
  console.log(`[COSMETIC] Calling deduct_fart_coins_cosmetic RPC — user=${user_id} item=${item_id} price=${price}`);

  const { data: rpcData, error: rpcError } = await supabase.rpc('deduct_fart_coins_cosmetic', {
    p_user_id: user_id,
    p_item_id: item_id,
    p_cost: price
  });

  if (rpcError) {
    console.error(`[COSMETIC] RPC error — full dump:`);
    console.error(`[COSMETIC]   code:    ${rpcError.code}`);
    console.error(`[COSMETIC]   message: ${rpcError.message}`);
    console.error(`[COSMETIC]   details: ${rpcError.details}`);
    console.error(`[COSMETIC]   hint:    ${rpcError.hint}`);
    console.error(`[COSMETIC]   raw:     ${JSON.stringify(rpcError)}`);
    return Response.json({
      success: false,
      error: 'purchase_failed',
      rpc_error_message: rpcError.message || null,
      rpc_error_code: rpcError.code || null
    }, { status: 500 });
  }

  // Parse RPC result if returned as string
  let result = rpcData;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch { /* use as-is */ }
  }

  if (!result || !result.success) {
    const errCode = result?.error || 'purchase_failed';
    console.log(`[COSMETIC] RPC returned failure: ${JSON.stringify(result)}`);
    return Response.json(result || { success: false, error: errCode });
  }

  const updatedBalance = Number(result.remaining_fart_coins);

  // ── Step 5: Debug summary ──
  console.log(`[COSMETIC] ── Result ──`);
  console.log(`[COSMETIC]   item_id:          ${item_id}`);
  console.log(`[COSMETIC]   price:            ${price} FC`);
  console.log(`[COSMETIC]   balance_before:   ${balance} FC`);
  console.log(`[COSMETIC]   balance_after:    ${updatedBalance} FC`);
  console.log(`[COSMETIC] ══════════════════════════════════════════`);

  return Response.json({
    success: true,
    item_id,
    cost: price,
    remaining_fart_coins: updatedBalance
  });
};

export const config = {
  path: '/api/purchase-cosmetic',
  method: 'POST'
};
