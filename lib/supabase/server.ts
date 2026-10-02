import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicEnv } from '@/lib/env/public';

interface CookieToSet {
  name: string;
  value: string;
  options?: Parameters<Awaited<ReturnType<typeof cookies>>['set']>[2];
}

export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    },
  );
}
