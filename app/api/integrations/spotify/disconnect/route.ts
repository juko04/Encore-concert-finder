import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { getServerEnv } from '@/lib/env/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';

export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const serverEnv = getServerEnv();
    if (serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY) {
      const adminClient = createAdminClient();
      const repo = new SupabaseSpotifyConnectionRepository(
        adminClient,
        serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
      );
      await repo.deleteConnection(user.id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Spotify Disconnect Error]:', err);
    return NextResponse.json(
      { error: 'Failed to disconnect Spotify' },
      { status: 500 },
    );
  }
}
