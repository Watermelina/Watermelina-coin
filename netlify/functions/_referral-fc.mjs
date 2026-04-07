export const REFERRAL_BACKEND_CONFIG = {
  percentage: 0.20,
  activeRunThreshold: 3,
  boostMultiplier: 1.0
};

const REFERRAL_PAYOUT_EVENT_TYPE = 'referral_fc_reward';
const REFERRAL_PAYOUT_SOURCE_PREFIX = 'referral_fc:';

function toSafeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEventKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function buildReferralSourceId(eventKey) {
  return `${REFERRAL_PAYOUT_SOURCE_PREFIX}${eventKey}`;
}

export async function awardReferralFC(supabase, referredUserId, earnedFC, referralEventKey = '') {
  const safeEarnedFC = toSafeNumber(earnedFC);
  const normalizedEventKey = normalizeEventKey(referralEventKey);
  const referralSourceId = normalizedEventKey ? buildReferralSourceId(normalizedEventKey) : null;

  if (!supabase || !referredUserId) {
    return { rewarded: false, reason: 'invalid_input' };
  }

  if (safeEarnedFC <= 0) {
    return { rewarded: false, reason: 'non_positive_earned_fc' };
  }

  const { data: referralRows, error: referralErr } = await supabase
    .from('referrals')
    .select('referrer_user_id')
    .eq('referred_user_id', referredUserId)
    .eq('is_active', true)
    .eq('reward_granted', true)
    .limit(1);

  if (referralErr) {
    console.error(`[REFERRAL-FC] referral lookup failed for referred=${referredUserId}: ${referralErr.message}`);
    return { rewarded: false, reason: 'referral_lookup_failed', error: referralErr.message };
  }

  const referrerUserId = referralRows?.[0]?.referrer_user_id;
  if (!referrerUserId) {
    return { rewarded: false, reason: 'no_active_referrer' };
  }

  const { count: runCount, error: runCountErr } = await supabase
    .from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', referredUserId);

  if (runCountErr) {
    console.error(`[REFERRAL-FC] run count lookup failed for referred=${referredUserId}: ${runCountErr.message}`);
    return { rewarded: false, reason: 'run_count_failed', error: runCountErr.message };
  }

  if ((runCount || 0) < REFERRAL_BACKEND_CONFIG.activeRunThreshold) {
    return {
      rewarded: false,
      reason: 'below_active_threshold',
      runCount: runCount || 0,
      threshold: REFERRAL_BACKEND_CONFIG.activeRunThreshold
    };
  }

  const rawReward = safeEarnedFC * REFERRAL_BACKEND_CONFIG.percentage * REFERRAL_BACKEND_CONFIG.boostMultiplier;
  const flooredReward = Math.floor(rawReward);
  const referralRewardFC = flooredReward > 0 ? flooredReward : (rawReward > 0 ? 1 : 0);

  if (referralRewardFC <= 0) {
    return { rewarded: false, reason: 'reward_rounds_to_zero', rawReward };
  }

  if (referralSourceId) {
    const { count: existingCount, error: existingErr } = await supabase
      .from('point_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', REFERRAL_PAYOUT_EVENT_TYPE)
      .eq('source_id', referralSourceId);

    if (existingErr) {
      console.error(`[REFERRAL-FC] idempotency check failed for source_id=${referralSourceId}: ${existingErr.message}`);
      return { rewarded: false, reason: 'idempotency_check_failed', error: existingErr.message };
    }

    if ((existingCount || 0) > 0) {
      return { rewarded: false, reason: 'duplicate_event', idempotencyKey: normalizedEventKey };
    }
  }

  const { data: referrerUser, error: referrerReadErr } = await supabase
    .from('users')
    .select('fart_coins')
    .eq('id', referrerUserId)
    .single();

  if (referrerReadErr || !referrerUser) {
    console.error(
      `[REFERRAL-FC] referrer balance read failed for referrer=${referrerUserId}: ${referrerReadErr?.message || 'missing referrer row'}`
    );
    return { rewarded: false, reason: 'referrer_read_failed', error: referrerReadErr?.message || 'missing_referrer_user' };
  }

  if (referralSourceId) {
    const { error: reserveErr } = await supabase
      .from('point_events')
      .insert({
        user_id: referrerUserId,
        event_type: REFERRAL_PAYOUT_EVENT_TYPE,
        points: referralRewardFC,
        source_id: referralSourceId,
        metadata: {
          reason: 'referral_fc_payout',
          referred_user_id: referredUserId,
          earned_fc: safeEarnedFC,
          reward_fc: referralRewardFC,
          percentage: REFERRAL_BACKEND_CONFIG.percentage,
          boost_multiplier: REFERRAL_BACKEND_CONFIG.boostMultiplier,
          idempotency_key: normalizedEventKey
        }
      });

    if (reserveErr) {
      if (reserveErr.code === '23505') {
        return { rewarded: false, reason: 'duplicate_event', idempotencyKey: normalizedEventKey };
      }
      console.error(`[REFERRAL-FC] idempotency reserve failed for source_id=${referralSourceId}: ${reserveErr.message}`);
      return { rewarded: false, reason: 'idempotency_reserve_failed', error: reserveErr.message };
    }
  }

  const newBalance = toSafeNumber(referrerUser.fart_coins) + referralRewardFC;
  const { error: referrerUpdateErr } = await supabase
    .from('users')
    .update({ fart_coins: newBalance })
    .eq('id', referrerUserId);

  if (referrerUpdateErr) {
    if (referralSourceId) {
      const { error: rollbackErr } = await supabase
        .from('point_events')
        .delete()
        .eq('event_type', REFERRAL_PAYOUT_EVENT_TYPE)
        .eq('source_id', referralSourceId);
      if (rollbackErr) {
        console.error(`[REFERRAL-FC] idempotency rollback failed for source_id=${referralSourceId}: ${rollbackErr.message}`);
      }
    }
    console.error(`[REFERRAL-FC] referrer balance update failed for referrer=${referrerUserId}: ${referrerUpdateErr.message}`);
    return { rewarded: false, reason: 'referrer_update_failed', error: referrerUpdateErr.message };
  }

  console.log(
    `[REFERRAL-FC] Referral reward triggered: referred=${referredUserId} referrer=${referrerUserId} earned_fc=${safeEarnedFC} referral_fc=${referralRewardFC}`
  );

  return {
    rewarded: true,
    referrerUserId,
    rewardFC: referralRewardFC,
    earnedFC: safeEarnedFC,
    percentage: REFERRAL_BACKEND_CONFIG.percentage,
    boostMultiplier: REFERRAL_BACKEND_CONFIG.boostMultiplier,
    idempotencyKey: normalizedEventKey || null
  };
}
