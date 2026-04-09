import { createClient } from '@supabase/supabase-js';

// ── Season 1 authoritative pricing ─────────────────────────────
// This is the SINGLE SOURCE OF TRUTH for purchase deductions.
// Must match the client-side SEASON1_COSTS in game.html exactly.
// Index 0 = cost to buy Level 1, index 1 = Level 2, etc.
const SEASON1_PRICES = {
  seed_magnet:     [400, 900, 1800],
  combo_keeper:    [600, 1300, 2600],
  fart_coin_boost: [800, 1700, 3400]
};

function getSeasonCost(upgradeCode, currentLevel) {
  const prices = SEASON1_PRICES[upgradeCode];
  if (!prices) return null;
  if (currentLevel >= 0 && currentLevel < prices.length) return prices[currentLevel];
  return null; // beyond max level
}

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
    console.error('[PURCHASE] CONFIG ERROR: SUPABASE_URL is not set and no fallback available');
    return { client: null, hasServiceRoleKey: false };
  }
  if (!key) {
    console.error('[PURCHASE] CONFIG ERROR: No Supabase key available.',
      'Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY env var.');
    return { client: null, hasServiceRoleKey: false };
  }

  const hasServiceRoleKey = !!serviceRoleKey;
  const keySource = hasServiceRoleKey ? 'service_role' :
                    getEnv('SUPABASE_ANON_KEY') ? 'anon (env)' : 'anon (fallback)';
  console.log(`[PURCHASE] Supabase client initialised — url=${url} keySource=${keySource}`);
  return { client: createClient(url, key), hasServiceRoleKey };
}

// ── Read current upgrade state from DB ──────────────────────────
async function readUpgradeState(supabase, userId, upgradeCode) {
  // Get upgrade definition
  const { data: upgrade, error: upgErr } = await supabase
    .from('upgrades')
    .select('id, code, max_level')
    .eq('code', upgradeCode)
    .eq('is_active', true)
    .single();

  console.log(`[PURCHASE] readUpgradeState: upgrade_row_found=${!!upgrade} upgrade_code=${upgradeCode}`);
  if (upgErr) {
    console.log(`[PURCHASE] readUpgradeState: upgrade lookup error — code=${upgErr.code} message=${upgErr.message} details=${upgErr.details} hint=${upgErr.hint}`);
  }
  if (!upgrade) {
    return null;
  }

  // Get current user level for this upgrade
  const { data: userUpgrade, error: userUpgErr } = await supabase
    .from('user_upgrades')
    .select('level')
    .eq('user_id', userId)
    .eq('upgrade_id', upgrade.id)
    .maybeSingle();

  const currentLevel = userUpgrade?.level || 0;
  console.log(`[PURCHASE] readUpgradeState: user_upgrade_row_found=${!!userUpgrade} current_level=${currentLevel}`);
  if (userUpgErr) {
    console.log(`[PURCHASE] readUpgradeState: user_upgrade lookup error — code=${userUpgErr.code} message=${userUpgErr.message} details=${userUpgErr.details}`);
  }

  // Get user balance
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('fart_coins')
    .eq('id', userId)
    .single();

  console.log(`[PURCHASE] readUpgradeState: user_row_found=${!!user} balance_fetched=${user?.fart_coins !== undefined}`);
  if (userErr) {
    console.log(`[PURCHASE] readUpgradeState: user lookup error — code=${userErr.code} message=${userErr.message} details=${userErr.details} hint=${userErr.hint}`);
    return null;
  }
  if (!user) {
    return null;
  }

  return {
    upgradeId: upgrade.id,
    maxLevel: upgrade.max_level,
    currentLevel,
    balance: user.fart_coins
  };
}

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
  }

  const { client: supabase, hasServiceRoleKey } = getSupabase();
  if (!supabase) {
    return Response.json({ success: false, error: 'server_config_error' }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const { user_id, upgrade_code } = body;
  if (!user_id || !upgrade_code) {
    return Response.json({ success: false, error: 'missing_params' }, { status: 400 });
  }

  console.log(`[PURCHASE] ══════════════════════════════════════════`);
  console.log(`[PURCHASE] ── Start ── user=${user_id} upgrade=${upgrade_code}`);
  console.log(`[PURCHASE] hasServiceRoleKey=${hasServiceRoleKey}`);

  // ── Step 1: Read current state for Season 1 price computation ──
  let state = await readUpgradeState(supabase, user_id, upgrade_code);

  let expectedCost = null;
  let preBalance = null;
  let preLevel = null;

  if (state) {
    preBalance = state.balance;
    preLevel = state.currentLevel;
    expectedCost = getSeasonCost(upgrade_code, state.currentLevel);

    console.log(`[PURCHASE] Pre-flight state: currentLevel=${state.currentLevel} maxLevel=${state.maxLevel} balance=${state.balance}`);
    console.log(`[PURCHASE] Season 1 expected cost: ${expectedCost} (upgrade=${upgrade_code} forLevel=${state.currentLevel}→${state.currentLevel + 1})`);

    // ── Step 2: Pre-flight balance check against Season 1 price ──
    if (state.currentLevel >= state.maxLevel) {
      console.log(`[PURCHASE] REJECTED: already at max level ${state.currentLevel}/${state.maxLevel}`);
      return Response.json({
        success: false,
        error: 'max_level_reached',
        current_level: state.currentLevel
      });
    }

    if (expectedCost !== null && state.balance < expectedCost) {
      console.log(`[PURCHASE] REJECTED: insufficient balance ${state.balance} < Season 1 cost ${expectedCost}`);
      return Response.json({
        success: false,
        error: 'insufficient_fart_coins',
        balance: state.balance,
        cost: expectedCost
      });
    }
  } else {
    console.warn(`[PURCHASE] Could not read upgrade state — proceeding with RPC-only path`);
  }

  // ── Step 3: Call the purchase_upgrade RPC ──
  // The RPC performs the atomic purchase (deduction + upgrade + logging).
  // If the live DB function has outdated pricing, we correct afterward.
  console.log(`[PURCHASE] Calling purchase_upgrade RPC...`);
  console.log(`[PURCHASE]   input user_id:      ${user_id}`);
  console.log(`[PURCHASE]   input upgrade_code:  ${upgrade_code}`);
  console.log(`[PURCHASE]   pre-flight state:    upgrade_row=${state ? 'found' : 'NOT_FOUND'} user_row=${state ? 'found' : 'NOT_FOUND'} balance=${preBalance}`);
  const { data, error: rpcError } = await supabase.rpc('purchase_upgrade', {
    p_user_id: user_id,
    p_upgrade_code: upgrade_code
  });

  if (rpcError) {
    console.error(`[PURCHASE] RPC error — full dump:`);
    console.error(`[PURCHASE]   code:    ${rpcError.code}`);
    console.error(`[PURCHASE]   message: ${rpcError.message}`);
    console.error(`[PURCHASE]   details: ${rpcError.details}`);
    console.error(`[PURCHASE]   hint:    ${rpcError.hint}`);
    console.error(`[PURCHASE]   raw:     ${JSON.stringify(rpcError)}`);

    // ── Fallback: if RPC fails for ANY reason (schema mismatch, function
    //    missing, permission error, etc.), perform the purchase via direct
    //    queries using Season 1 pricing and the service-role key ──

    // If state wasn't read earlier (readUpgradeState also failed), try re-reading now
    if (!state) {
      console.log(`[PURCHASE] Re-reading upgrade state for fallback...`);
      state = await readUpgradeState(supabase, user_id, upgrade_code);
      if (state) {
        expectedCost = getSeasonCost(upgrade_code, state.currentLevel);
        preBalance = state.balance;
        preLevel = state.currentLevel;
      }
    }

    if (expectedCost !== null && state) {
      console.log(`[PURCHASE] RPC failed (code=${rpcError.code}) — using direct-query fallback with Season 1 pricing`);

      // Re-validate pre-flight (state was read above)
      if (state.currentLevel >= state.maxLevel) {
        return Response.json({ success: false, error: 'max_level_reached', current_level: state.currentLevel });
      }
      if (state.balance < expectedCost) {
        return Response.json({ success: false, error: 'insufficient_fart_coins', balance: state.balance, cost: expectedCost });
      }

      const newLevel = state.currentLevel + 1;

      // Deduct fart_coins
      const { error: deductErr } = await supabase
        .from('users')
        .update({ fart_coins: state.balance - expectedCost })
        .eq('id', user_id);

      if (deductErr) {
        console.error(`[PURCHASE] Fallback deduct error: ${JSON.stringify(deductErr)}`);
        return Response.json({ success: false, error: 'fallback_deduct_failed', detail: deductErr.message || null }, { status: 500 });
      }

      // Upsert user_upgrades
      const { error: upsertErr } = await supabase
        .from('user_upgrades')
        .upsert({
          user_id,
          upgrade_id: state.upgradeId,
          level: newLevel,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,upgrade_id' });

      if (upsertErr) {
        console.error(`[PURCHASE] Fallback upsert error: ${JSON.stringify(upsertErr)}`);
        // Attempt to refund
        await supabase.from('users').update({ fart_coins: state.balance }).eq('id', user_id);
        return Response.json({ success: false, error: 'fallback_upsert_failed', detail: upsertErr.message || null }, { status: 500 });
      }

      // Log transaction
      await supabase.from('point_events').insert({
        user_id,
        event_type: 'upgrade_purchase',
        points: -expectedCost,
        metadata: {
          upgrade_code,
          from_level: state.currentLevel,
          to_level: newLevel,
          cost: expectedCost,
          fallback: true
        }
      }).then(({ error: evtErr }) => {
        if (evtErr) console.warn(`[PURCHASE] Fallback event insert failed: ${JSON.stringify(evtErr)}`);
      });

      const fallbackRemaining = state.balance - expectedCost;
      console.log(`[PURCHASE] Fallback purchase succeeded: new_level=${newLevel} cost=${expectedCost} remaining=${fallbackRemaining}`);

      return Response.json({
        success: true,
        upgrade_code,
        new_level: newLevel,
        cost: expectedCost,
        remaining_fart_coins: fallbackRemaining
      });
    }

    return Response.json({
      success: false,
      error: 'purchase_failed',
      rpc_error_message: rpcError.message || null,
      rpc_error_code: rpcError.code || null,
      rpc_error_details: rpcError.details || null,
      rpc_error_hint: rpcError.hint || null,
      debug_input: { user_id, upgrade_code }
    }, { status: 500 });
  }

  // Supabase PostgREST may return JSONB as a string — parse if needed
  let result = data;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch { /* use as-is */ }
  }

  if (!result || !result.success) {
    const errCode = result?.error || 'purchase_failed';
    console.log(`[PURCHASE] RPC returned failure: ${JSON.stringify(result)}`);
    // If the RPC says insufficient_fart_coins but we already checked, include Season 1 cost
    if (errCode === 'insufficient_fart_coins' && expectedCost !== null) {
      return Response.json({
        success: false,
        error: 'insufficient_fart_coins',
        balance: result.balance,
        cost: expectedCost
      });
    }
    return Response.json(result || { success: false, error: errCode });
  }

  // ── Step 4: Verify and correct pricing ──
  const rpcCost = Number(result.cost);
  const rpcRemaining = Number(result.remaining_fart_coins);
  const newLevel = Number(result.new_level);

  console.log(`[PURCHASE] RPC success: new_level=${newLevel} rpc_cost=${rpcCost} rpc_remaining=${rpcRemaining}`);

  // Determine the final cost and remaining balance to return
  let finalCost = rpcCost;
  let finalRemaining = rpcRemaining;

  if (expectedCost !== null && rpcCost !== expectedCost) {
    console.warn(`[PURCHASE] ⚠ PRICE MISMATCH DETECTED ⚠`);
    console.warn(`[PURCHASE]   RPC charged: ${rpcCost} FC`);
    console.warn(`[PURCHASE]   Season 1 price: ${expectedCost} FC`);
    console.warn(`[PURCHASE]   Difference: ${expectedCost - rpcCost} FC`);
    console.warn(`[PURCHASE]   Pre-purchase balance was: ${preBalance}`);

    if (hasServiceRoleKey) {
      // ── Correct the balance to reflect Season 1 pricing ──
      // The RPC already deducted rpcCost. We need the total deduction to be expectedCost.
      // Set the balance to what it should be: preBalance - expectedCost
      const correctRemaining = preBalance - expectedCost;

      console.log(`[PURCHASE] Correcting balance: ${rpcRemaining} → ${correctRemaining} (service_role key available)`);

      const { error: corrErr } = await supabase
        .from('users')
        .update({ fart_coins: correctRemaining })
        .eq('id', user_id);

      if (corrErr) {
        console.error(`[PURCHASE] Balance correction FAILED: ${JSON.stringify(corrErr)}`);
        console.error(`[PURCHASE] User ${user_id} was charged ${rpcCost} instead of ${expectedCost}. Manual correction needed.`);
        // Return the RPC's actual values since correction failed
      } else {
        console.log(`[PURCHASE] Balance corrected successfully.`);
        finalCost = expectedCost;
        finalRemaining = correctRemaining;

        // Log the correction as a point_event for audit trail
        await supabase.from('point_events').insert({
          user_id,
          event_type: 'upgrade_price_correction',
          points: -(expectedCost - rpcCost),
          metadata: {
            upgrade_code,
            rpc_cost: rpcCost,
            season1_cost: expectedCost,
            correction_amount: expectedCost - rpcCost,
            from_level: newLevel - 1,
            to_level: newLevel
          }
        }).then(({ error: evtErr }) => {
          if (evtErr) console.warn(`[PURCHASE] Correction event insert failed: ${JSON.stringify(evtErr)}`);
        });
      }
    } else {
      console.warn(`[PURCHASE] Cannot correct: no service_role key. RPC price (${rpcCost}) was used instead of Season 1 price (${expectedCost}).`);
      console.warn(`[PURCHASE] To fix: either apply supabase/migration.sql to update the purchase_upgrade function, or set SUPABASE_SERVICE_ROLE_KEY env var on Netlify.`);
      // Override the cost in the response to reflect what SHOULD have been charged
      // so the client displays the correct price and detects the mismatch
      finalCost = expectedCost;
      finalRemaining = preBalance - expectedCost;

      // Even without service role key, attempt the balance correction
      // (will fail if RLS blocks UPDATE on users, but worth trying)
      const { error: corrErr } = await supabase
        .from('users')
        .update({ fart_coins: preBalance - expectedCost })
        .eq('id', user_id);

      if (!corrErr) {
        console.log(`[PURCHASE] Balance correction succeeded with anon key (unexpected but good)`);
      } else {
        console.warn(`[PURCHASE] Balance correction blocked by RLS (expected): ${corrErr.message}`);
        // Return actual RPC values since we couldn't correct
        finalCost = rpcCost;
        finalRemaining = rpcRemaining;
      }
    }
  } else if (expectedCost !== null) {
    console.log(`[PURCHASE] Price verified: RPC cost (${rpcCost}) matches Season 1 price (${expectedCost}) ✓`);
  } else {
    console.log(`[PURCHASE] No Season 1 price defined for ${upgrade_code} at level ${preLevel} — using RPC cost ${rpcCost}`);
  }

  // ── Step 5: Debug summary ──
  console.log(`[PURCHASE] ── Result ──`);
  console.log(`[PURCHASE]   upgrade_code: ${upgrade_code}`);
  console.log(`[PURCHASE]   current_level: ${preLevel}`);
  console.log(`[PURCHASE]   new_level: ${newLevel}`);
  console.log(`[PURCHASE]   displayed_price (Season 1): ${expectedCost}`);
  console.log(`[PURCHASE]   backend_price_charged (RPC): ${rpcCost}`);
  console.log(`[PURCHASE]   final_cost_returned: ${finalCost}`);
  console.log(`[PURCHASE]   FC_balance_before: ${preBalance}`);
  console.log(`[PURCHASE]   FC_balance_after: ${finalRemaining}`);
  console.log(`[PURCHASE] ══════════════════════════════════════════`);

  return Response.json({
    success: true,
    upgrade_code: result.upgrade_code || upgrade_code,
    new_level: newLevel,
    cost: finalCost,
    remaining_fart_coins: finalRemaining
  });
};

export const config = {
  path: '/api/purchase-upgrade',
  method: 'POST'
};
