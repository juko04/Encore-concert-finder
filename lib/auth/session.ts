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

    // Fast-fail timeout so offline local Supabase doesn't hang the page for 60 seconds
    const getUserPromise = supabase.auth.getUser();
    const timeoutPromise = new Promise<{
      data: { user: null };
      error: Error;
    }>((resolve) =>
      setTimeout(
        () =>
          resolve({
            data: { user: null },
            error: new Error('Supabase Auth connection timeout'),
          }),
        1500,
      ),
    );

    const {
      data: { user },
      error,
    } = await Promise.race([getUserPromise, timeoutPromise]);

    if (error || !user) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}
