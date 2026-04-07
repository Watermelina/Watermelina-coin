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
    console.error('[TRACK-MISSION-CLICK] CONFIG ERROR: Missing Supabase URL or key');
    return null;
  }

  return createClient(url, key);
}

// Mission codes that require external click tracking
const TRACKABLE_CODES = new Set(['join_telegram', 'follow_x', 'subscribe_youtube']);

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
  }

  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return Response.json(
      { success: false, error: 'Missing x-user-id header' },
      { status: 400 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const { mission_id } = body;
  if (!mission_id) {
    return Response.json(
      { success: false, error: 'missing_mission_id' },
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

  // Validate that this mission_id belongs to a trackable social mission
  const { data: mission, error: lookupErr } = await supabase
    .from('missions')
    .select('code')
    .eq('id', mission_id)
    .single();

  if (lookupErr || !mission || !TRACKABLE_CODES.has(mission.code)) {
    return Response.json(
      { success: false, error: 'invalid_mission_id' },
      { status: 400 }
    );
  }

  console.log(`[TRACK-MISSION-CLICK] user=${userId} mission_id=${mission_id} code=${mission.code}`);

  try {
    const { data, error } = await supabase.rpc('track_mission_click', {
      p_user_id: userId,
      p_mission_id: mission_id
    });

    if (error) {
      console.error(`[TRACK-MISSION-CLICK] RPC error: ${error.message}`);
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
    console.error(`[TRACK-MISSION-CLICK] Unexpected error: ${err.message}`);
    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/track-mission-click',
  method: 'POST'
};
