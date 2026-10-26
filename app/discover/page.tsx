import React from 'react';
import { getAuthenticatedUser } from '@/lib/auth/session';
import {
  getPersonalizedDiscoverData,
  getPublicDiscoverData,
} from '@/lib/recommendation/service';
import { isScoringPreviewAllowed } from '@/lib/recommendation/preview-guard';
import { PersonalizedDiscoverContainer } from '@/components/discover/PersonalizedDiscoverContainer';
import { GuestDiscoverContainer } from '@/components/discover/GuestDiscoverContainer';

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
 * 4. Zero synthetic fixture leakage into production.
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
    } catch {
      // In the rare event personalized retrieval fails, fall back to public view
      // without leaking internal error details.
    }
  }

  // Guest view (or unauthenticated fallback)
  let publicData;
  try {
    publicData = await getPublicDiscoverData();
  } catch {
    publicData = {
      events: [],
      isEmptyCatalog: true,
      totalCount: 0,
    };
  }

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
}
