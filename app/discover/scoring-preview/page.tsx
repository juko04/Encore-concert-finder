import React from 'react';
import Link from 'next/link';
import { ScoringInspector } from '@/components/recommendation/ScoringInspector';
import { getScoringPreviewAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ScoringPreviewPage() {
  const initialData = await getScoringPreviewAction({ useFixtures: false });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            href="/discover"
            className="text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200"
          >
            ← Back to Discover
          </Link>
        </div>

        <ScoringInspector
          initialResult={initialData.result}
          initialPreset={initialData.activePreset}
          initialProfile={initialData.userProfile}
          isGuest={initialData.isGuest}
          usingFixtures={initialData.usingFixtures}
        />
      </div>
    </main>
  );
}
