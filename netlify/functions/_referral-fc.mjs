// Referral FC rewards have been disabled.
// Referrals now only grant Watermelon Points (WP).
// This module is kept as a no-op stub so any remaining imports do not break.

export const REFERRAL_BACKEND_CONFIG = {
  percentage: 0.20,
  activeRunThreshold: 3,
  boostMultiplier: 1.0
};

export async function awardReferralFC() {
  return { rewarded: false, reason: 'fc_referral_rewards_disabled' };
}
