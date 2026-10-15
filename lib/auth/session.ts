import { createClient } from '@/lib/supabase/server';
import type { User } from '@supabase/supabase-js';

/**
 * Retrieves the currently authenticated Supabase user on the server.
 * Uses `supabase.auth.getUser()` to cryptographically verify the JWT with Supabase Auth,
 * ensuring untrusted client session cookies cannot forge user identity.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}
