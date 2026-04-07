import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_FALLBACK = 'https://tivqekyexiknxzbbrgun.supabase.co';
const SUPABASE_ANON_KEY_FALLBACK = 'sb_publishable_-tvso--RThiDAbEUBClcxA_n9LEedEw';

function getEnv(key) {
  if (typeof Netlify !== 'undefined' && Netlify.env) return Netlify.env.get(key);
  return process.env[key];
}

function getSupabase() {
  const url = getEnv('SUPABASE_URL') || SUPABASE_URL_FALLBACK;
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY')
           || getEnv('SUPABASE_ANON_KEY')
           || SUPABASE_ANON_KEY_FALLBACK;

  if (!url || !key) return null;
  return createClient(url, key);
}

export default async (req) => {
  if (req.method !== 'GET') {
    return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
  }

  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return Response.json(
      { success: false, error: 'Missing x-user-id header' },
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

  try {
    const { data, error } = await supabase
      .from('mission_clicks')
      .select('mission_id')
      .eq('user_id', userId);

    if (error) {
      console.error(`[GET-MISSION-CLICKS] Query error: ${error.message}`);
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const clickedIds = (data || []).map(r => r.mission_id);
    return Response.json({ success: true, clicked: clickedIds });
  } catch (err) {
    console.error(`[GET-MISSION-CLICKS] Unexpected error: ${err.message}`);
    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/get-mission-clicks',
  method: 'GET'
};
