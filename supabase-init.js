// Mobile-only gate — skip Supabase init when game is blocked
if (window.__wmGateBlocked) {
  console.log('[WM Gate] Supabase init skipped — gate is active');
} else {

if (!window.wmSupabaseClient) {
  window.wmSupabaseClient = window.supabase.createClient(
    'https://tivqekyexiknxzbbrgun.supabase.co',
    'sb_publishable_-tvso--RThiDAbEUBClcxA_n9LEedEw'
  );
}

window.supabaseClient = window.wmSupabaseClient;

async function awardPoints(userId, eventType, points, metadata = {}, sourceId = null) {
  if (!userId || !eventType || !points) {
    console.error("awardPoints missing required values", { userId, eventType, points });
    return { data: null, error: "Missing required values" };
  }

  const { data, error } = await window.supabaseClient
    .from("point_events")
    .insert([
      {
        user_id: userId,
        event_type: eventType,
        points: points,
        source_id: sourceId,
        metadata: metadata
      }
    ])
    .select();

  if (error) {
    console.error("awardPoints failed:", error);
  } else {
    console.log("awardPoints success:", data);
  }

  return { data, error };
}

window.awardPoints = awardPoints;

// Fetch user currencies (fart_coins, watermelon_points)
async function fetchUserCurrencies(userId) {
  if (!userId) return null;
  const { data, error } = await window.supabaseClient
    .from('users')
    .select('fart_coins, watermelon_points')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('fetchUserCurrencies failed:', error);
    return null;
  }
  return data;
}
window.fetchUserCurrencies = fetchUserCurrencies;

// Fetch all active upgrade definitions
async function fetchUpgrades() {
  const { data, error } = await window.supabaseClient
    .from('upgrades')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('fetchUpgrades failed:', error);
    return [];
  }
  return data || [];
}
window.fetchUpgrades = fetchUpgrades;

// Fetch user's owned upgrades with definitions
async function fetchUserUpgrades(userId) {
  if (!userId) return [];
  // Use SELECT * on the joined upgrades table to avoid column-not-found errors
  // if effect_key, effect_base, effect_per_level columns haven't been added yet
  const { data, error } = await window.supabaseClient
    .from('user_upgrades')
    .select('level, upgrade_id, upgrades(*)')
    .eq('user_id', userId);
  if (error) {
    console.error('fetchUserUpgrades failed:', error);
    return [];
  }
  return data || [];
}
window.fetchUserUpgrades = fetchUserUpgrades;

// Purchase upgrade via Netlify function (server-side Season 1 pricing)
async function purchaseUpgrade(userId, upgradeCode) {
  if (!userId || !upgradeCode) {
    return { success: false, error: 'missing_params' };
  }
  try {
    var resp = await fetch('/api/purchase-upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, upgrade_code: upgradeCode })
    });
    var data = await resp.json();
    return data;
  } catch (err) {
    console.error('purchaseUpgrade fetch failed:', err);
    return { success: false, error: err.message };
  }
}
window.purchaseUpgrade = purchaseUpgrade;

// Award run currencies via Netlify Function (server-side RPC + referral FC hook)
async function awardRunCurrencies(userId, score, seeds, maxCombo, level, avgCombo, timeSurvived) {
  if (!userId) {
    console.error('awardRunCurrencies: no userId provided');
    return null;
  }
  // Coerce all numeric params — guard against NaN/undefined/string
  var safeSeedsVal = parseInt(seeds, 10);
  var safeScoreVal = parseInt(score, 10);
  var safeMaxComboVal = parseInt(maxCombo, 10);
  var safeLevelVal = parseInt(level, 10);
  var safeAvgCombo = parseFloat(avgCombo);
  var safeTimeSurvived = parseInt(timeSurvived, 10);
  var payload = {
    p_user_id: userId,
    p_score: (isNaN(safeScoreVal) || safeScoreVal < 0) ? 0 : safeScoreVal,
    p_seeds: (isNaN(safeSeedsVal) || safeSeedsVal < 0) ? 0 : safeSeedsVal,
    p_max_combo: (isNaN(safeMaxComboVal) || safeMaxComboVal < 1) ? 1 : safeMaxComboVal,
    p_level: (isNaN(safeLevelVal) || safeLevelVal < 1) ? 1 : safeLevelVal,
    p_avg_combo: (isNaN(safeAvgCombo) || safeAvgCombo < 1) ? 1 : safeAvgCombo,
    p_time_survived: (isNaN(safeTimeSurvived) || safeTimeSurvived < 0) ? 0 : safeTimeSurvived
  };
  try {
    var resp = await fetch('/.netlify/functions/award-run-currencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify(payload)
    });
    if (resp.status === 404) {
      // Backward-compat fallback for deployments using path-based function routing.
      resp = await fetch('/api/award-run-currencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify(payload)
      });
    }
    var data = await resp.json();
    if (!resp.ok || data?.success === false) {
      console.error('award-run-currencies error', data);
      return null;
    }
    return data;
  } catch (error) {
    console.error('award-run-currencies fetch failed', error);
    return null;
  }
}
window.awardRunCurrencies = awardRunCurrencies;

// Compute upgrade effects from user_upgrades data into a flat map
// Minimum per-level scaling ensures upgrades feel powerful and noticeable
// Uses fallback effect data when DB columns (effect_key, effect_base, effect_per_level) are missing
function computeUpgradeEffects(userUpgrades) {
  const effects = {};
  if (!Array.isArray(userUpgrades)) return effects;
  // Fallback effect data — used when DB columns are missing
  var FALLBACK_EFFECTS = {
    'seed_magnet':        { effect_key: 'magnet_range',       effect_base: 1.0, effect_per_level: 0.40, max_level: 3 },
    'combo_keeper':       { effect_key: 'combo_duration_mult', effect_base: 1.0, effect_per_level: 0.50, max_level: 3 },
    'fart_coin_boost':    { effect_key: 'fart_coin_mult',    effect_base: 1.0, effect_per_level: 0.20, max_level: 3 }
  };
  // Minimum effect_per_level guarantees — ensures each upgrade level is clearly noticeable
  var minPerLevel = {
    'magnet_range': 0.40,           // +40% magnet radius per level
    'combo_duration_mult': 0.50,    // +50% combo duration per level
    'fart_coin_mult': 0.20          // +20% FC per level
  };
  for (const uu of userUpgrades) {
    var upgrade = uu.upgrades;
    if (!upgrade) continue;
    // Handle Supabase JOIN returning an array instead of object
    if (Array.isArray(upgrade)) upgrade = upgrade[0];
    if (!upgrade) continue;
    // Use fallback effect data if DB columns are missing
    var fb = FALLBACK_EFFECTS[upgrade.code] || {};
    var effectKey = upgrade.effect_key || fb.effect_key;
    // Coerce NUMERIC columns to numbers — Supabase PostgREST may return NUMERIC as strings
    var effectBase = Number(upgrade.effect_base || fb.effect_base) || 0;
    var effectPerLevel = Number(upgrade.effect_per_level || fb.effect_per_level) || 0;
    var level = (typeof uu.level === 'number') ? uu.level : (parseInt(uu.level, 10) || 0);
    var maxLevel = Number(upgrade.max_level || fb.max_level) || 5;
    // Force seed_magnet max_level to 3
    if (upgrade.code === 'seed_magnet') maxLevel = 3;
    // Force combo_keeper max_level to 3
    if (upgrade.code === 'combo_keeper') maxLevel = 3;
    // Clamp level to max
    if (level > maxLevel) level = maxLevel;
    if (!effectKey || level <= 0) continue;
    var perLevel = Math.max(effectPerLevel, minPerLevel[effectKey] || 0);
    var val = effectBase + perLevel * level;
    // Combo Keeper uses non-linear duration curve: [1.0, 1.5, 2.0, 2.5]
    if (upgrade.code === 'combo_keeper') {
      var COMBO_KEEPER_CURVE = [1.0, 1.5, 2.0, 2.5];
      val = level < COMBO_KEEPER_CURVE.length ? COMBO_KEEPER_CURVE[level] : COMBO_KEEPER_CURVE[COMBO_KEEPER_CURVE.length - 1];
    }
    effects[effectKey] = val;
    effects[upgrade.code || effectKey + '_level'] = level;
  }
  return effects;
}
window.computeUpgradeEffects = computeUpgradeEffects;

async function initUser() {
  let userId = localStorage.getItem('wm_user_id');

  if (!userId) {
    const referralCode = localStorage.getItem('wm_referral_code');

    // Check if running inside Telegram and use real user data
    const tg = window.Telegram?.WebApp;
    const user = tg?.initDataUnsafe?.user;

    const supabaseClient = window.supabaseClient;
    let data;

    if (user) {
      // Inside Telegram — call tg.ready() and use real Telegram user data
      try { tg.ready(); } catch(e) {}
      const tgId = String(user.id);

      // Check if a user with this telegram_id already exists
      const { data: existingUser, error: lookupError } = await supabaseClient
        .from('users')
        .select('*')
        .eq('telegram_id', tgId)
        .maybeSingle();

      if (lookupError) {
        console.error('Telegram user lookup failed:', lookupError);
      }

      if (existingUser) {
        // Existing Telegram user found — reuse it
        localStorage.setItem('wm_user_id', existingUser.id);
        if (existingUser.referral_code) {
          localStorage.setItem('wm_my_ref_code', existingUser.referral_code);
        }
        userId = existingUser.id;
        return;
      }

      // No existing user — create a new one
      const newUser = {
        telegram_id: tgId,
        username: user.username || user.first_name || 'tg_user',
        first_name: user.first_name || '',
        referral_code: Math.random().toString(36).slice(2, 8).toUpperCase(),
        referred_by: referralCode || null
      };
      const { data: insertedUser, error: insertError } = await supabaseClient
        .from('users')
        .insert(newUser)
        .select()
        .single();

      if (insertError) {
        console.error('Telegram user insert failed:', insertError);
      }
      data = insertedUser;
    } else {
      // Regular browser — use guest fallback
      const newUser = {
        telegram_id: 'guest_' + Math.random().toString(36).slice(2),
        username: 'guest',
        referral_code: Math.random().toString(36).slice(2, 8).toUpperCase(),
        referred_by: referralCode || null
      };
      const { data: insertedUser, error: insertError } = await supabaseClient
        .from('users')
        .insert(newUser)
        .select()
        .single();

      if (insertError) {
        console.error('Guest user insert failed:', insertError);
      }
      data = insertedUser;
    }

    if (data) {
      localStorage.setItem('wm_user_id', data.id);
      localStorage.setItem('wm_my_ref_code', data.referral_code);
      userId = data.id;

      if (referralCode) {
        const { data: refUser } = await supabaseClient
          .from('users')
          .select('id')
          .eq('referral_code', referralCode)
          .maybeSingle();

        if (refUser && refUser.id !== data.id) {
          const { error: referralError } = await supabaseClient
            .from('referrals')
            .insert({
              referrer_user_id: refUser.id,
              referred_user_id: data.id,
              status: 'PENDING'
            });

          if (referralError && referralError.code !== '23505') {
            console.error('Referral insert failed:', referralError);
          }
        }
      }
    }
  }
}

// Capture Telegram start_param as referral code before user init
(function captureTelegramReferral() {
  try {
    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (startParam && !localStorage.getItem('wm_referral_code')) {
      localStorage.setItem('wm_referral_code', startParam);
    }
  } catch (e) { /* ignore */ }
})();

window._wmInitUserPromise = initUser();

} // end gate else
