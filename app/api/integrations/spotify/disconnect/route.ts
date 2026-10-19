import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';

export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const adminClient = createAdminClient();
    const repo = new SupabaseSpotifyConnectionRepository(adminClient);
    await repo.deleteConnection(user.id);

    // Confirm credential deletion before reporting success
    const remaining = await repo.getConnection(user.id);
    if (remaining) {
      return NextResponse.json(
        { error: 'Failed to verify Spotify credential deletion' },
        { status: 500 },
      );
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
