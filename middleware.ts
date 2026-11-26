import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

interface CookieToSet {
  name: string;
  value: string;
  options?: Parameters<NextResponse['cookies']['set']>[2];
}

/**
 * Refreshes the Supabase auth session on every page/API request that carries
 * Supabase auth cookies.
 *
 * Server Components cannot write cookies, so without this refresh an expired
 * access token makes `supabase.auth.getUser()` fail in the page render and the
 * UI shows a signed-out state (e.g. a "Sign In" button) even though a valid
 * refresh token exists. Anonymous visitors (no `sb-` cookies) skip all work, so
 * public browsing never depends on Supabase being reachable.
 */
export async function middleware(request: NextRequest) {
  const hasSupabaseCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-'));
  if (!hasSupabaseCookie) {
    return NextResponse.next({ request });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  try {
    // Validates the JWT with Supabase Auth and rotates tokens if expired.
    await supabase.auth.getUser();
  } catch {
    // Never block a page render because the auth refresh failed.
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
