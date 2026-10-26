import React from 'react';
import { getAuthenticatedUser } from '@/lib/auth/session';
import {
  getPersonalizedDiscoverData,
  getPublicDiscoverData,
} from '@/lib/recommendation/service';
import { isScoringPreviewAllowed } from '@/lib/recommendation/preview-guard';
import { PersonalizedDiscoverContainer } from '@/components/discover/PersonalizedDiscoverContainer';
import { PersonalizedDiscoverErrorState } from '@/components/discover/PersonalizedDiscoverErrorState';
import { GuestDiscoverContainer } from '@/components/discover/GuestDiscoverContainer';
import { GuestDiscoverErrorState } from '@/components/discover/GuestDiscoverErrorState';

/**
 * Production Discover Page
 *
 * Invariants:
 * 1. Force dynamic execution: strictly request-scoped so private personalized recommendations
 *    cannot be stored in shared CDN or Next.js ISR caches.
 * 2. Authenticated user receives personalized recommendations based on explicit taste,
 *    travel radius, and ticket budget thresholds.
 * 3. Unauthenticated guest visitors receive truthful public catalog listings with an invitation
 *    to personalize recommendations upon signing in.
 * 4. Distinct error boundaries: an authenticated failure never shows a misleading guest sign-in interface,
 *    and a public catalog failure never displays a false empty-catalog message.
 * 5. Zero synthetic fixture leakage into production.
 */
export const dynamic = 'force-dynamic';

export default async function DiscoverPage() {
  const showScoringInspector = isScoringPreviewAllowed();
  const user = await getAuthenticatedUser();

  if (user) {
    try {
      const personalizedData = await getPersonalizedDiscoverData({
        userId: user.id,
      });

      return (
        <main className="min-h-screen bg-zinc-950 text-zinc-100">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
            <PersonalizedDiscoverContainer
              initialData={personalizedData}
              showScoringInspector={showScoringInspector}
            />
          </div>
        </main>
      );
    } catch (err) {
      console.error(
        '[DiscoverPage] Failed to retrieve personalized recommendations:',
        err,
      );
      return (
        <main className="min-h-screen bg-zinc-950 text-zinc-100">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
            <PersonalizedDiscoverErrorState
              showScoringInspector={showScoringInspector}
            />
          </div>
        </main>
      );
    }
  }

  // Guest view (strictly for signed-out visitors)
  try {
    const publicData = await getPublicDiscoverData();

    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <GuestDiscoverContainer
            initialData={publicData}
            showScoringInspector={showScoringInspector}
          />
        </div>
      </main>
    );
  } catch (err) {
    console.error('[DiscoverPage] Failed to retrieve public catalog:', err);
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <GuestDiscoverErrorState />
        </div>
      </main>
    );
  }
}
