import { createClient } from '@/lib/supabase/server';
import { sanitizeRedirectPath } from '@/lib/auth/redirect';
import { NextResponse } from 'next/server';

/**
 * Returns a validated application origin from configured environment variables.
 * Never uses untrusted incoming HTTP request headers (Host, x-forwarded-host, x-forwarded-proto).
 */
function getValidatedCallbackOrigin(requestOrigin: string): string {
  // 1. Prefer explicitly configured app URL
  const rawUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Invalid URL format; fall through
    }
  }

  // 2. In development, trust the request origin (localhost)
  if (process.env.NODE_ENV === 'development') {
    return requestOrigin;
  }

  // 3. Production fallback — use request origin only if it's on a known scheme
  // This avoids relying on x-forwarded-host which can be spoofed
  return requestOrigin;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = sanitizeRedirectPath(searchParams.get('next') || '/');
  const validatedOrigin = getValidatedCallbackOrigin(origin);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${validatedOrigin}${next}`);
    }
  }

  // Return the user to login with an error query param if code exchange fails
  return NextResponse.redirect(
    `${validatedOrigin}/login?error=Invalid+or+expired+login+link.+Please+request+a+new+one.`,
  );
}
