import React from 'react';
import { buildDecisionGuide } from '@/lib/venues';
import type { DecisionGuideEventInput, GuideBullet } from '@/lib/venues';
import { SparklesIcon, AlertCircleIcon, CheckIcon } from './icons';

const EVIDENCE_LABEL: Record<GuideBullet['evidence'], string | null> = {
  official: 'Venue info',
  community: 'Community reports',
  event: null,
  profile: null,
};

function Bullet({
  bullet,
  mark,
  markClass,
}: {
  bullet: GuideBullet;
  mark: string;
  markClass: string;
}) {
  const label = EVIDENCE_LABEL[bullet.evidence];
  return (
    <li className="flex items-start gap-2" data-evidence={bullet.evidence}>
      <span className={`mt-0.5 font-bold ${markClass}`}>{mark}</span>
      <span>
        {bullet.text}
        {label && (
          <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
            {label}
          </span>
        )}
      </span>
    </li>
  );
}

export function DecisionGuide({ event }: { event: DecisionGuideEventInput }) {
  const guide = buildDecisionGuide(event);

  return (
    <div className="shadow-xs overflow-hidden rounded-3xl border border-zinc-200/90 bg-white">
      <div className="border-b border-zinc-100 bg-zinc-50/70 px-6 py-4">
        <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900">
          <SparklesIcon className="h-4 w-4 text-zinc-700" />
          <span>Know before you go</span>
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          {guide.venue
            ? `Based on researched notes about ${guide.venue.name}${guide.researchedOnLabel ? ` (researched ${guide.researchedOnLabel})` : ''} and this listing.`
            : 'Based on what this listing tells us.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 divide-y divide-zinc-100 p-6 md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100">
              <CheckIcon className="h-3 w-3 text-emerald-700" />
            </div>
            <span>{guide.whyTitle}</span>
          </div>
          {guide.why.length > 0 ? (
            <ul className="space-y-2.5 text-xs leading-relaxed text-zinc-600">
              {guide.why.map((b, i) => (
                <Bullet
                  key={i}
                  bullet={b}
                  mark="✓"
                  markClass="text-emerald-500"
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-500">{guide.whyEmptyMessage}</p>
          )}
        </div>

        <div className="space-y-3 pt-6 md:pt-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100">
              <AlertCircleIcon className="h-3 w-3 text-amber-700" />
            </div>
            <span>What to Consider Before Attending</span>
          </div>
          {guide.consider.length > 0 && (
            <ul className="space-y-2.5 text-xs leading-relaxed text-zinc-600">
              {guide.consider.map((b, i) => (
                <Bullet
                  key={i}
                  bullet={b}
                  mark="!"
                  markClass="text-amber-500"
                />
              ))}
            </ul>
          )}
          {guide.fallbackNote && (
            <p className="text-xs text-zinc-500">{guide.fallbackNote}</p>
          )}
          {guide.confidenceNote && (
            <p className="text-xs text-zinc-500">{guide.confidenceNote}</p>
          )}
        </div>
      </div>

      {guide.sources.length > 0 && (
        <details className="border-t border-zinc-100 px-6 py-3 text-xs text-zinc-500">
          <summary className="cursor-pointer font-medium">
            Sources ({guide.sources.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {guide.sources.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
