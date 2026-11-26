import React from 'react';
import { getArtistAccent } from './formatters';

/**
 * Generated artwork for cards with no real image: a deterministic gradient, one of four
 * decorative patterns, a monogram and the venue name. Everything derives from the name, so the
 * same show always looks the same and different shows look different. Purely decorative; no
 * network, no canvas, no invented imagery of a real person or place.
 */

export type PlaceholderPattern = 'bars' | 'rings' | 'stripes' | 'dots';
const PATTERNS: readonly PlaceholderPattern[] = [
  'bars',
  'rings',
  'stripes',
  'dots',
];

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG so the artwork is stable across renders and servers. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ARTICLES = new Set(['the', 'a', 'an']);

/** One or two letters: first letters of the first two significant words, else the first letter. */
export function placeholderInitials(name: string | null | undefined): string {
  const words = (name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const significant = words.filter(
    (w, i) => !(i === 0 && words.length > 1 && ARTICLES.has(w.toLowerCase())),
  );
  const letters = significant.map((w) => Array.from(w)[0]).slice(0, 2);
  const out = letters.join('').toUpperCase();
  return out || 'E';
}

export function placeholderPattern(
  name: string | null | undefined,
): PlaceholderPattern {
  return PATTERNS[hashString(name || '') % PATTERNS.length];
}

const MONOGRAM_SIZE = {
  sm: 'text-sm',
  md: 'text-5xl',
  lg: 'text-8xl',
} as const;

interface EventPlaceholderProps {
  /** Headliner or show title: drives colors, pattern and monogram. */
  name: string;
  venueName?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

function PatternArt({
  pattern,
  seed,
  color,
}: {
  pattern: PlaceholderPattern;
  seed: number;
  color: string;
}) {
  const rand = mulberry32(seed);
  switch (pattern) {
    case 'bars': {
      const bars = Array.from({ length: 18 }, (_, i) => {
        const h = 14 + Math.round(rand() * 58);
        return (
          <rect
            key={i}
            x={6 + i * 10.5}
            y={120 - h}
            width={6}
            height={h}
            rx={3}
            fill={color}
            opacity={0.16}
          />
        );
      });
      return <>{bars}</>;
    }
    case 'rings': {
      const cx = 120 + Math.round(rand() * 80);
      const cy = 70 + Math.round(rand() * 50);
      return (
        <>
          {[18, 36, 56, 80, 108].map((r) => (
            <circle
              key={r}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={1.6}
              opacity={0.2}
            />
          ))}
        </>
      );
    }
    case 'stripes': {
      return (
        <>
          {Array.from({ length: 14 }, (_, i) => (
            <line
              key={i}
              x1={-20 + i * 22}
              y1={130}
              x2={40 + i * 22}
              y2={-10}
              stroke={color}
              strokeWidth={5}
              strokeLinecap="round"
              opacity={0.1 + (i % 3) * 0.03}
            />
          ))}
        </>
      );
    }
    default: {
      const dots: React.ReactNode[] = [];
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 14; col++) {
          const fade = (row + 1) / 8;
          dots.push(
            <circle
              key={`${row}-${col}`}
              cx={8 + col * 14 + (row % 2) * 7}
              cy={8 + row * 15}
              r={1 + fade * 2.6}
              fill={color}
              opacity={0.08 + fade * 0.14}
            />,
          );
        }
      }
      return <>{dots}</>;
    }
  }
}

export function EventPlaceholder({
  name,
  venueName,
  size = 'md',
}: EventPlaceholderProps) {
  const accent = getArtistAccent(name);
  const pattern = placeholderPattern(name);
  const seed = hashString(name || '');
  const initials = placeholderInitials(name);
  const showCaption = size !== 'sm' && Boolean(venueName?.trim());

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${accent.primary}26 0%, ${accent.secondary}55 100%)`,
      }}
      data-placeholder-pattern={pattern}
      aria-hidden="true"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 200 120"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <PatternArt pattern={pattern} seed={seed} color={accent.primary} />
      </svg>
      <span
        className={`relative select-none font-extrabold leading-none tracking-tight ${MONOGRAM_SIZE[size]}`}
        style={{ color: accent.primary, opacity: 0.78 }}
      >
        {initials}
      </span>
      {showCaption && (
        // Drawn with CSS (not a text node) so the venue name is not duplicated in the page text;
        // the card already states the venue and this art is purely decorative.
        <span
          data-venue={venueName}
          className="relative mt-3 block max-w-[85%] truncate text-[10px] font-semibold uppercase tracking-[0.18em] before:content-[attr(data-venue)]"
          style={{ color: accent.primary, opacity: 0.7 }}
        />
      )}
    </div>
  );
}
