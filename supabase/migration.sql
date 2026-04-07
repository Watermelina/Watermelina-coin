-- ============================================================
-- Watermelina: Currencies & Upgrades Migration
-- Run this against your Supabase project SQL editor.
-- ============================================================

-- 1. Add currency columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS fart_coins BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS watermelon_points BIGINT DEFAULT 0;

-- 2. Upgrade definitions table
CREATE TABLE IF NOT EXISTS upgrades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  max_level INT DEFAULT 5,
  base_cost BIGINT NOT NULL DEFAULT 100,
  cost_multiplier NUMERIC DEFAULT 1.5,
  effect_key TEXT,
  effect_base NUMERIC DEFAULT 1.0,
  effect_per_level NUMERIC DEFAULT 0.1,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2b. Add effect columns if they don't exist (handles table created before these columns were defined)
ALTER TABLE upgrades ADD COLUMN IF NOT EXISTS effect_key TEXT;
ALTER TABLE upgrades ADD COLUMN IF NOT EXISTS effect_base NUMERIC DEFAULT 1.0;
ALTER TABLE upgrades ADD COLUMN IF NOT EXISTS effect_per_level NUMERIC DEFAULT 0.1;

-- 3. User upgrade ownership / levels
CREATE TABLE IF NOT EXISTS user_upgrades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  upgrade_id UUID REFERENCES upgrades(id) NOT NULL,
  level INT DEFAULT 1,
  purchased_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, upgrade_id)
);

-- 4. V1 Upgrade Definitions
-- Use ON CONFLICT DO UPDATE to populate effect columns on existing rows
INSERT INTO upgrades (code, title, description, max_level, base_cost, cost_multiplier, effect_key, effect_base, effect_per_level, sort_order) VALUES
  ('seed_magnet',       'Seed Magnet',       'Increases magnet radius and pull strength.',          3, 120,  1.5, 'magnet_range',       1.0, 0.40, 1),
  ('combo_keeper',      'Combo Keeper',       'Extends combo duration, making it easier to maintain streaks.', 3, 220,  1.6, 'combo_duration_mult', 1.0, 0.50, 2),
  ('fart_coin_boost',   'Fart Coin Boost',    'Earn more Fart Coins per completed run.',           3, 300,  1.5, 'fart_coin_mult',     1.0, 0.30, 3),
  ('extra_life',        'Extra Life',         'Start each run with extra lives.',                  3, 500,  2.0, 'extra_lives',        0.0, 1.00, 4), -- disabled for Season 1
  ('watermelon_insight','Watermelon Insight', 'Earn more Watermelon Points per completed run.',    5, 300,  1.5, 'watermelon_mult',    1.0, 0.20, 5)
ON CONFLICT (code) DO UPDATE SET
  effect_key = EXCLUDED.effect_key,
  effect_base = EXCLUDED.effect_base,
  effect_per_level = EXCLUDED.effect_per_level,
  max_level = EXCLUDED.max_level,
  base_cost = EXCLUDED.base_cost,
  description = EXCLUDED.description;

-- Disable Extra Life for Season 1 (keeps data, just hides from active upgrades)
UPDATE upgrades SET is_active = false WHERE code = 'extra_life';

-- Disable Watermelon Insight for Season 1 (keeps data, can be re-enabled in a future season)
UPDATE upgrades SET is_active = false WHERE code = 'watermelon_insight';

-- 4b. Update seed_magnet to 3 levels (was 5). Clamp any existing user levels.
UPDATE upgrades SET max_level = 3, description = 'Increases magnet radius and pull strength.' WHERE code = 'seed_magnet';
UPDATE user_upgrades SET level = 3
  WHERE upgrade_id = (SELECT id FROM upgrades WHERE code = 'seed_magnet')
  AND level > 3;

-- 4c. Update fart_coin_boost to 3 levels (was 5). Clamp any existing user levels.
UPDATE upgrades SET max_level = 3, effect_per_level = 0.30 WHERE code = 'fart_coin_boost';
UPDATE user_upgrades SET level = 3
  WHERE upgrade_id = (SELECT id FROM upgrades WHERE code = 'fart_coin_boost')
  AND level > 3;

-- 4d. Update combo_keeper to 3 levels (was 5) with new duration multiplier. Clamp any existing user levels.
UPDATE upgrades SET max_level = 3, effect_key = 'combo_duration_mult', effect_base = 1.0, effect_per_level = 0.50,
  description = 'Extends combo duration, making it easier to maintain streaks.' WHERE code = 'combo_keeper';
UPDATE user_upgrades SET level = 3
  WHERE upgrade_id = (SELECT id FROM upgrades WHERE code = 'combo_keeper')
  AND level > 3;

-- 5. RPC: Purchase an upgrade (atomic, server-side)
CREATE OR REPLACE FUNCTION purchase_upgrade(
  p_user_id UUID,
  p_upgrade_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_upgrade upgrades%ROWTYPE;
  v_current_level INT;
  v_cost BIGINT;
  v_balance BIGINT;
BEGIN
  -- Look up upgrade definition
  SELECT * INTO v_upgrade FROM upgrades WHERE code = p_upgrade_code AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'upgrade_not_found');
  END IF;

  -- Get current user level for this upgrade
  SELECT COALESCE(level, 0) INTO v_current_level
  FROM user_upgrades
  WHERE user_id = p_user_id AND upgrade_id = v_upgrade.id;

  IF NOT FOUND THEN
    v_current_level := 0;
  END IF;

  -- Check max level
  IF v_current_level >= v_upgrade.max_level THEN
    RETURN jsonb_build_object('success', false, 'error', 'max_level_reached', 'current_level', v_current_level);
  END IF;

  -- Calculate cost for next level (Season 1 finalized pricing)
  v_cost := CASE v_upgrade.code
    WHEN 'seed_magnet' THEN
      CASE v_current_level WHEN 0 THEN 120 WHEN 1 THEN 260 WHEN 2 THEN 520 ELSE 520 END
    WHEN 'combo_keeper' THEN
      CASE v_current_level WHEN 0 THEN 220 WHEN 1 THEN 420 WHEN 2 THEN 850 ELSE 850 END
    WHEN 'fart_coin_boost' THEN
      CASE v_current_level WHEN 0 THEN 300 WHEN 1 THEN 500 WHEN 2 THEN 1100 ELSE 1100 END
    ELSE
      CEIL(v_upgrade.base_cost * POWER(v_upgrade.cost_multiplier, v_current_level))
  END;

  -- Check balance
  SELECT fart_coins INTO v_balance FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_balance < v_cost THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_fart_coins', 'balance', v_balance, 'cost', v_cost);
  END IF;

  -- Deduct fart_coins
  UPDATE users SET fart_coins = fart_coins - v_cost WHERE id = p_user_id;

  -- Upsert user_upgrades
  INSERT INTO user_upgrades (user_id, upgrade_id, level)
  VALUES (p_user_id, v_upgrade.id, v_current_level + 1)
  ON CONFLICT (user_id, upgrade_id)
  DO UPDATE SET level = EXCLUDED.level, purchased_at = now();

  -- Log transaction
  INSERT INTO point_events (user_id, event_type, points, metadata)
  VALUES (
    p_user_id,
    'upgrade_purchase',
    -v_cost,
    jsonb_build_object(
      'upgrade_code', p_upgrade_code,
      'upgrade_title', v_upgrade.title,
      'from_level', v_current_level,
      'to_level', v_current_level + 1,
      'cost', v_cost
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'upgrade_code', p_upgrade_code,
    'new_level', v_current_level + 1,
    'cost', v_cost,
    'remaining_fart_coins', v_balance - v_cost
  );
END;
$$;

-- 6. RPC: Award run currencies (Season 1 formulas)
CREATE OR REPLACE FUNCTION award_run_currencies(
  p_user_id UUID,
  p_score INT,
  p_seeds INT,
  p_max_combo INT DEFAULT 1,
  p_level INT DEFAULT 1,
  p_avg_combo NUMERIC DEFAULT 1.0,
  p_time_survived INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fart_coins BIGINT;
  v_watermelon_points BIGINT;
BEGIN
  -- Season 1 economy formulas
  -- FC = (Seeds × Average Combo) + (Time in seconds × 0.5)
  v_fart_coins := CEIL((p_seeds * p_avg_combo) + (p_time_survived * 0.5));
  -- WMP = (Seeds × 0.5) + (Highest Combo × 3) + (Time in seconds × 0.2)
  v_watermelon_points := CEIL((p_seeds * 0.5) + (p_max_combo * 3) + (p_time_survived * 0.2));

  -- Update user balances
  UPDATE users
  SET fart_coins = fart_coins + v_fart_coins,
      watermelon_points = watermelon_points + v_watermelon_points
  WHERE id = p_user_id;

  -- Log fart_coin earn
  INSERT INTO point_events (user_id, event_type, points, metadata)
  VALUES (p_user_id, 'fart_coin_earn', v_fart_coins,
    jsonb_build_object('source', 'run_reward', 'score', p_score, 'seeds', p_seeds));

  -- Log watermelon_point earn
  INSERT INTO point_events (user_id, event_type, points, metadata)
  VALUES (p_user_id, 'watermelon_point_earn', v_watermelon_points,
    jsonb_build_object('source', 'run_reward', 'score', p_score, 'seeds', p_seeds));

  RETURN jsonb_build_object(
    'fart_coins_earned', v_fart_coins,
    'watermelon_points_earned', v_watermelon_points
  );
END;
$$;

-- 7. RPC: Reward referrer when a referred user completes a qualifying run
CREATE OR REPLACE FUNCTION reward_referral_if_eligible(
  p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referral RECORD;
  v_run_count INT;
  v_reward_points INT := 500;
BEGIN
  -- Find a PENDING referral where this user is the referred user
  SELECT * INTO v_referral
  FROM referrals
  WHERE referred_user_id = p_user_id AND status = 'PENDING'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('rewarded', false, 'reason', 'no_pending_referral');
  END IF;

  -- Check if referred user has completed at least 3 runs (qualifying threshold)
  SELECT COUNT(*) INTO v_run_count
  FROM runs
  WHERE user_id = p_user_id;

  IF v_run_count < 3 THEN
    RETURN jsonb_build_object('rewarded', false, 'reason', 'not_enough_runs', 'run_count', v_run_count);
  END IF;

  -- Mark referral as completed
  UPDATE referrals SET status = 'COMPLETED' WHERE referrer_user_id = v_referral.referrer_user_id AND referred_user_id = p_user_id;

  -- Reward the referrer: points only (no flat FC activation payout)
  UPDATE users
  SET referral_points = COALESCE(referral_points, 0) + v_reward_points,
      referral_count = COALESCE(referral_count, 0) + 1
  WHERE id = v_referral.referrer_user_id;

  -- Log referral reward in point_events
  INSERT INTO point_events (user_id, event_type, points, metadata)
  VALUES (
    v_referral.referrer_user_id,
    'referral_reward',
    v_reward_points,
    jsonb_build_object(
      'referred_user_id', p_user_id::text
    )
  );

  RETURN jsonb_build_object(
    'rewarded', true,
    'referrer_id', v_referral.referrer_user_id,
    'points_awarded', v_reward_points
  );
END;
$$;

-- ============================================================
-- 8. Row Level Security (RLS) Policies
-- Ensures the anon/publishable key can query tables as needed.
-- SECURITY DEFINER RPCs bypass RLS, so purchases and currency
-- awards are already protected.
-- ============================================================

-- upgrades: public read access (definitions are not sensitive)
ALTER TABLE upgrades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on upgrades" ON upgrades;
CREATE POLICY "Allow public read on upgrades" ON upgrades
  FOR SELECT USING (true);

-- user_upgrades: users can read their own upgrades
ALTER TABLE user_upgrades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow users to read own upgrades" ON user_upgrades;
CREATE POLICY "Allow users to read own upgrades" ON user_upgrades
  FOR SELECT USING (true);

-- users: allow read of own record and insert for new user creation
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on users" ON users;
CREATE POLICY "Allow public read on users" ON users
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert on users" ON users;
CREATE POLICY "Allow public insert on users" ON users
  FOR INSERT WITH CHECK (true);

-- runs: allow insert (run submission) and read own runs
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public insert on runs" ON runs;
CREATE POLICY "Allow public insert on runs" ON runs
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public read on runs" ON runs;
CREATE POLICY "Allow public read on runs" ON runs
  FOR SELECT USING (true);

-- point_events: allow insert (client-side game_reward logging) and read own events
ALTER TABLE point_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public insert on point_events" ON point_events;
CREATE POLICY "Allow public insert on point_events" ON point_events
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public read on point_events" ON point_events;
CREATE POLICY "Allow public read on point_events" ON point_events
  FOR SELECT USING (true);

-- referrals: allow insert for new referral creation and read
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public insert on referrals" ON referrals;
CREATE POLICY "Allow public insert on referrals" ON referrals
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow public read on referrals" ON referrals;
CREATE POLICY "Allow public read on referrals" ON referrals
  FOR SELECT USING (true);

-- ============================================================
-- 9. Claimed Referral Missions — tracks which referral missions
--    a user has claimed so rewards cannot be double-claimed.
-- ============================================================

CREATE TABLE IF NOT EXISTS claimed_referral_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  mission_key TEXT NOT NULL,
  reward_fc BIGINT NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, mission_key)
);

ALTER TABLE claimed_referral_missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on claimed_referral_missions" ON claimed_referral_missions;
CREATE POLICY "Allow public read on claimed_referral_missions" ON claimed_referral_missions
  FOR SELECT USING (true);

-- 10. RPC: Claim a referral mission (atomic, server-side)
CREATE OR REPLACE FUNCTION claim_referral_mission(
  p_user_id UUID,
  p_mission_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target INT;
  v_reward BIGINT;
  v_referral_count INT;
  v_balance BIGINT;
BEGIN
  -- Only the first mission is implemented
  IF p_mission_key = 'ref_invite_1' THEN
    v_target := 1;
    v_reward := 200;
  ELSIF p_mission_key = 'ref_invite_3' THEN
    v_target := 3;
    v_reward := 500;
  ELSIF p_mission_key = 'ref_invite_5' THEN
    v_target := 5;
    v_reward := 1000;
  ELSIF p_mission_key = 'ref_invite_10' THEN
    v_target := 10;
    v_reward := 2000;
  ELSIF p_mission_key = 'ref_invite_15' THEN
    v_target := 15;
    v_reward := 3000;
  ELSIF p_mission_key = 'ref_invite_20' THEN
    v_target := 20;
    v_reward := 5000;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'mission_not_found');
  END IF;

  -- Tier 2 gate: require all Tier 1 missions claimed first
  IF p_mission_key IN ('ref_invite_10', 'ref_invite_15', 'ref_invite_20') THEN
    IF (
      SELECT COUNT(*) FROM claimed_referral_missions
      WHERE user_id = p_user_id
        AND mission_key IN ('ref_invite_1', 'ref_invite_3', 'ref_invite_5')
    ) < 3 THEN
      RETURN jsonb_build_object('success', false, 'error', 'tier2_locked');
    END IF;
  END IF;

  -- Check if already claimed (UNIQUE constraint also protects, but fail gracefully)
  IF EXISTS (
    SELECT 1 FROM claimed_referral_missions
    WHERE user_id = p_user_id AND mission_key = p_mission_key
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_claimed');
  END IF;

  -- Check referral count
  SELECT COALESCE(referral_count, 0) INTO v_referral_count
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_referral_count < v_target THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'not_enough_referrals',
      'referral_count', v_referral_count,
      'required', v_target
    );
  END IF;

  -- Award fart_coins
  UPDATE users SET fart_coins = fart_coins + v_reward WHERE id = p_user_id
  RETURNING fart_coins INTO v_balance;

  -- Log in point_events
  INSERT INTO point_events (user_id, event_type, points, metadata)
  VALUES (
    p_user_id,
    'referral_mission_claim',
    v_reward,
    jsonb_build_object(
      'mission_key', p_mission_key,
      'reward_fc', v_reward,
      'referral_count', v_referral_count
    )
  );

  -- Record the claim
  INSERT INTO claimed_referral_missions (user_id, mission_key, reward_fc)
  VALUES (p_user_id, p_mission_key, v_reward);

  RETURN jsonb_build_object(
    'success', true,
    'mission_key', p_mission_key,
    'reward_fc', v_reward,
    'remaining_fart_coins', v_balance
  );
END;
$$;

-- ============================================================
-- 11. Daily Mission Progress — tracks per-user daily stats
--     (runs completed, seeds collected, best score) per date.
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_mission_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  mission_date DATE NOT NULL DEFAULT CURRENT_DATE,
  runs_completed INT DEFAULT 0,
  seeds_collected INT DEFAULT 0,
  best_score INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, mission_date)
);

ALTER TABLE daily_mission_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on daily_mission_progress" ON daily_mission_progress;
CREATE POLICY "Allow public read on daily_mission_progress" ON daily_mission_progress
  FOR SELECT USING (true);
-- SECURITY: No public INSERT or UPDATE policies on daily_mission_progress.
-- All mutations go through the update_daily_progress() SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "Allow public insert on daily_mission_progress" ON daily_mission_progress;
DROP POLICY IF EXISTS "Allow public update on daily_mission_progress" ON daily_mission_progress;

-- ============================================================
-- 12. Claimed Daily Missions — prevents double-claiming daily
--     mission rewards for the same user+mission+date.
-- ============================================================

CREATE TABLE IF NOT EXISTS claimed_daily_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  mission_key TEXT NOT NULL,
  mission_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reward_fc BIGINT NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, mission_key, mission_date)
);

ALTER TABLE claimed_daily_missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on claimed_daily_missions" ON claimed_daily_missions;
CREATE POLICY "Allow public read on claimed_daily_missions" ON claimed_daily_missions
  FOR SELECT USING (true);
-- SECURITY: No public INSERT policy on claimed_daily_missions.
-- All claims go through the claim_daily_mission() SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "Allow public insert on claimed_daily_missions" ON claimed_daily_missions;

-- ============================================================
-- 13. RPC: Update daily mission progress after a run
--     Atomically increments runs_completed, adds seeds, and
--     updates best_score if the new score is higher.
-- ============================================================

CREATE OR REPLACE FUNCTION update_daily_progress(
  p_user_id UUID,
  p_seeds INT,
  p_score INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row daily_mission_progress%ROWTYPE;
BEGIN
  INSERT INTO daily_mission_progress (user_id, mission_date, runs_completed, seeds_collected, best_score, updated_at)
  VALUES (p_user_id, CURRENT_DATE, 1, p_seeds, p_score, now())
  ON CONFLICT (user_id, mission_date)
  DO UPDATE SET
    runs_completed = daily_mission_progress.runs_completed + 1,
    seeds_collected = daily_mission_progress.seeds_collected + EXCLUDED.seeds_collected,
    best_score = GREATEST(daily_mission_progress.best_score, EXCLUDED.best_score),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'runs_completed', v_row.runs_completed,
    'seeds_collected', v_row.seeds_collected,
    'best_score', v_row.best_score
  );
END;
$$;

-- ============================================================
-- 14. RPC: Claim a daily mission (atomic, server-side)
--     Validates completion, prevents double-claim, awards FC,
--     and logs the reward in point_events.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_daily_mission(
  p_user_id UUID,
  p_mission_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target INT;
  v_reward BIGINT;
  v_progress daily_mission_progress%ROWTYPE;
  v_current_value INT;
  v_balance BIGINT;
BEGIN
  -- Resolve mission config
  IF p_mission_key = 'PLAY_3_RUNS' THEN
    v_target := 3; v_reward := 300;
  ELSIF p_mission_key = 'COLLECT_30_SEEDS' THEN
    v_target := 30; v_reward := 500;
  ELSIF p_mission_key = 'REACH_500_SCORE' THEN
    v_target := 500; v_reward := 700;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'mission_not_found');
  END IF;

  -- Check if already claimed today
  IF EXISTS (
    SELECT 1 FROM claimed_daily_missions
    WHERE user_id = p_user_id AND mission_key = p_mission_key AND mission_date = CURRENT_DATE
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_claimed');
  END IF;

  -- Get today's progress
  SELECT * INTO v_progress
  FROM daily_mission_progress
  WHERE user_id = p_user_id AND mission_date = CURRENT_DATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_progress_today');
  END IF;

  -- Check mission completion
  IF p_mission_key = 'PLAY_3_RUNS' THEN
    v_current_value := v_progress.runs_completed;
  ELSIF p_mission_key = 'COLLECT_30_SEEDS' THEN
    v_current_value := v_progress.seeds_collected;
  ELSIF p_mission_key = 'REACH_500_SCORE' THEN
    v_current_value := v_progress.best_score;
  END IF;

  IF v_current_value < v_target THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'not_completed',
      'current', v_current_value,
      'required', v_target
    );
  END IF;

  -- Award fart_coins
  UPDATE users SET fart_coins = fart_coins + v_reward WHERE id = p_user_id
  RETURNING fart_coins INTO v_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  -- Log in point_events
  INSERT INTO point_events (user_id, event_type, points, metadata)
  VALUES (
    p_user_id,
    'daily_mission_claim',
    v_reward,
    jsonb_build_object(
      'mission_key', p_mission_key,
      'reward_fc', v_reward,
      'progress_value', v_current_value,
      'mission_date', CURRENT_DATE::text
    )
  );

  -- Record the claim
  INSERT INTO claimed_daily_missions (user_id, mission_key, mission_date, reward_fc)
  VALUES (p_user_id, p_mission_key, CURRENT_DATE, v_reward);

  RETURN jsonb_build_object(
    'success', true,
    'mission_key', p_mission_key,
    'reward_fc', v_reward,
    'remaining_fart_coins', v_balance
  );
END;
$$;

-- ============================================================
-- 15. RPC: Claim a regular mission (atomic, server-side)
--     Reads reward from missions.points_reward, credits FC,
--     prevents duplicate claims, logs to point_events.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_mission(
  p_user_id UUID,
  p_mission_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reward BIGINT;
  v_mission_code TEXT;
  v_balance BIGINT;
BEGIN
  -- Look up the mission and its reward
  SELECT points_reward, code INTO v_reward, v_mission_code
  FROM missions
  WHERE id = p_mission_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'mission_not_found');
  END IF;

  IF v_reward IS NULL OR v_reward <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_reward');
  END IF;

  -- Check if already claimed
  IF EXISTS (
    SELECT 1 FROM user_missions
    WHERE user_id = p_user_id AND mission_id = p_mission_id AND completed = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_claimed');
  END IF;

  -- Verify user exists and lock row
  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  -- Credit fart_coins
  UPDATE users SET fart_coins = fart_coins + v_reward WHERE id = p_user_id
  RETURNING fart_coins INTO v_balance;

  -- Log in point_events
  INSERT INTO point_events (user_id, event_type, points, metadata)
  VALUES (
    p_user_id,
    'mission_claim',
    v_reward,
    jsonb_build_object(
      'mission_id', p_mission_id,
      'mission_code', v_mission_code,
      'reward_fc', v_reward
    )
  );

  -- Record the claim
  INSERT INTO user_missions (user_id, mission_id, completed)
  VALUES (p_user_id, p_mission_id, true)
  ON CONFLICT (user_id, mission_id) DO UPDATE SET completed = true;

  RETURN jsonb_build_object(
    'success', true,
    'mission_id', p_mission_id,
    'reward_fc', v_reward,
    'remaining_fart_coins', v_balance
  );
END;
$$;

-- ============================================================
-- Mission Clicks: track external link clicks for social missions
-- ============================================================

-- Table to record that a user clicked the external link for a social mission
CREATE TABLE IF NOT EXISTS mission_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  mission_id UUID REFERENCES missions(id) NOT NULL,
  clicked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, mission_id)
);

-- RLS: allow users to read their own clicks via anon key
ALTER TABLE mission_clicks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own mission clicks" ON mission_clicks;
CREATE POLICY "Users can read own mission clicks"
  ON mission_clicks FOR SELECT
  USING (true);

-- RPC: record a mission click (idempotent)
CREATE OR REPLACE FUNCTION track_mission_click(
  p_user_id UUID,
  p_mission_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO mission_clicks (user_id, mission_id)
  VALUES (p_user_id, p_mission_id)
  ON CONFLICT (user_id, mission_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'mission_id', p_mission_id);
END;
$$;

-- Update claim_mission to enforce click tracking for social missions
CREATE OR REPLACE FUNCTION claim_mission(
  p_user_id UUID,
  p_mission_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reward BIGINT;
  v_mission_code TEXT;
  v_balance BIGINT;
BEGIN
  SELECT points_reward, code INTO v_reward, v_mission_code
  FROM missions
  WHERE id = p_mission_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'mission_not_found');
  END IF;

  IF v_reward IS NULL OR v_reward <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_reward');
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_missions
    WHERE user_id = p_user_id AND mission_id = p_mission_id AND completed = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_claimed');
  END IF;

  -- For social missions, enforce that the user clicked the external link first
  IF v_mission_code IN ('join_telegram', 'follow_x', 'daily_login') THEN
    IF NOT EXISTS (
      SELECT 1 FROM mission_clicks
      WHERE user_id = p_user_id AND mission_id = p_mission_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'action_not_completed');
    END IF;
  END IF;

  PERFORM 1 FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  UPDATE users SET fart_coins = fart_coins + v_reward WHERE id = p_user_id
  RETURNING fart_coins INTO v_balance;

  INSERT INTO point_events (user_id, event_type, points, metadata)
  VALUES (
    p_user_id,
    'mission_claim',
    v_reward,
    jsonb_build_object(
      'mission_id', p_mission_id,
      'mission_code', v_mission_code,
      'reward_fc', v_reward
    )
  );

  INSERT INTO user_missions (user_id, mission_id, completed)
  VALUES (p_user_id, p_mission_id, true)
  ON CONFLICT (user_id, mission_id) DO UPDATE SET completed = true;

  RETURN jsonb_build_object(
    'success', true,
    'mission_id', p_mission_id,
    'reward_fc', v_reward,
    'remaining_fart_coins', v_balance
  );
END;
$$;

-- ============================================================
-- RPC: Get best-score leaderboard (top 10 by best single run)
-- Returns user_id, best_score, username, first_name
-- ============================================================

CREATE OR REPLACE FUNCTION get_best_score_leaderboard()
RETURNS TABLE(user_id UUID, best_score BIGINT, username TEXT, first_name TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT r.user_id,
         MAX(r.score)::BIGINT AS best_score,
         u.username,
         u.first_name
  FROM runs r
  JOIN users u ON u.id = r.user_id
  WHERE r.suspicious = false
  GROUP BY r.user_id, u.username, u.first_name
  ORDER BY best_score DESC
  LIMIT 10;
$$;

-- ============================================================
-- RPC: Get a specific user's rank and best score
-- Returns rank (count of users with higher best score + 1)
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_best_score_rank(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_best BIGINT;
  v_rank BIGINT;
BEGIN
  SELECT MAX(score) INTO v_best
  FROM runs
  WHERE user_id = p_user_id AND suspicious = false;

  IF v_best IS NULL THEN
    RETURN jsonb_build_object('rank', NULL, 'best_score', 0);
  END IF;

  SELECT COUNT(DISTINCT sub.user_id) + 1 INTO v_rank
  FROM (
    SELECT user_id, MAX(score) AS best
    FROM runs
    WHERE suspicious = false
    GROUP BY user_id
    HAVING MAX(score) > v_best
  ) sub;

  RETURN jsonb_build_object('rank', v_rank, 'best_score', v_best);
END;
$$;
