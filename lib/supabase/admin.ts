import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getPublicEnv } from '@/lib/env/public';
import { getServerEnv } from '@/lib/env/server';

export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'Supabase admin client cannot be instantiated in a browser environment',
    );
  }

  const publicEnv = getPublicEnv();
  const serverEnv = getServerEnv();

  return createSupabaseClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
