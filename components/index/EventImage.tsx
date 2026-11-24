'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { IndexEventItem } from './types';
import { getArtistAccent } from './formatters';

type ImageSource = 'event' | 'artist' | 'venue';
export interface ImageCandidate {
  url: string;
  source: ImageSource;
}

/**
 * Ordered, de-duplicated image candidates: event, artist, venue.
 * Never invents a URL; the graphic fallback is rendered when all fail.
 */
export function getImageCandidates(
  event: Pick<
    IndexEventItem,
    'imageUrl' | 'venueImageUrl' | 'artists' | 'headlinerName' | 'title'
  >,
): ImageCandidate[] {
  const headlinerName = event.headlinerName || event.title;
  const headliner =
    event.artists?.find(
      (a) => a.billingPosition === 'headliner' || a.name === headlinerName,
    ) || event.artists?.[0];
  const raw: Array<[string | null | undefined, ImageSource]> = [
    [event.imageUrl, 'event'],
    [headliner?.imageUrl, 'artist'],
    ...(event.artists || []).map(
      (a): [string | null | undefined, ImageSource] => [a.imageUrl, 'artist'],
    ),
    [event.venueImageUrl, 'venue'],
  ];
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  for (const [url, source] of raw) {
    const u = typeof url === 'string' ? url.trim() : '';
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push({ url: u, source });
    }
  }
  return out;
}

/** Advances through candidates on real load errors; null index = graphic. */
export function useImageCascade(candidates: ImageCandidate[]) {
  const key = candidates.map((c) => c.url).join('|');
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [key]);
  const current = index < candidates.length ? candidates[index] : null;
  return { current, onError: () => setIndex((i) => i + 1) };
}

export interface EventImageProps {
  event: IndexEventItem;
  /** Box classes controlling the aspect ratio / size of the media area. */
  className?: string;
  width?: number;
  height?: number;
  /** Eager-load (above the fold hero). Default lazy. */
  priority?: boolean;
  /** Text rendered on the graphic fallback (defaults to initial letter). */
  graphicSize?: 'sm' | 'md' | 'lg';
  /** Image is decorative when the card already names the artist in text. */
  decorative?: boolean;
  imgClassName?: string;
  children?: React.ReactNode;
}

const graphicText = { sm: 'text-sm', md: 'text-4xl', lg: 'text-7xl' };

export function EventImage({
  event,
  className = '',
  width = 640,
  height = 360,
  priority = false,
  graphicSize = 'md',
  decorative = true,
  imgClassName = '',
  children,
}: EventImageProps) {
  const candidates = useMemo(() => getImageCandidates(event), [event]);
  const { current, onError } = useImageCascade(candidates);
  const name = event.headlinerName || event.title;
  const accent = getArtistAccent(name);

  return (
    <div
      className={`relative overflow-hidden bg-zinc-100 ${className}`}
      data-image-source={current?.source ?? 'graphic'}
    >
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={current.url}
          src={current.url}
          alt={decorative ? '' : `${name}`}
          aria-hidden={decorative ? true : undefined}
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={onError}
          className={`h-full w-full object-cover ${imgClassName}`}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${accent.primary}1f 0%, ${accent.secondary}38 100%)`,
          }}
          aria-hidden="true"
        >
          <span
            className={`select-none font-extrabold tracking-tight ${graphicText[graphicSize]}`}
            style={{ color: accent.primary, opacity: 0.6 }}
          >
            {(name || 'E').charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
