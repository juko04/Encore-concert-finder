import type { IndexInventoryStatus } from './types';

export const DEFAULT_REFERENCE_ORIGIN = { lat: 39.7392, lng: -104.9903 };

/**
 * Formats an event date string (YYYY-MM-DD or ISO) into human-readable editorial date format,
 * e.g., "Thu, Nov 14" or "Thu, Nov 14 · 7:30 PM".
 * Local calendar dates are computed safely in UTC noon to prevent timezone date shifts.
 */
export function formatIndexDate(
  dateStr: string,
  doorTimeOrStartsAt?: string | null,
  timezone?: string,
): string {
  if (!dateStr) return 'Date TBA';

  try {
    const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
    if (!year || !month || !day) return dateStr;

    // Use UTC noon to prevent date-boundary shifting across local browser timezones
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const weekday = date.toLocaleDateString('en-US', {
      weekday: 'short',
      timeZone: 'UTC',
    });
    const monthName = date.toLocaleDateString('en-US', {
      month: 'short',
      timeZone: 'UTC',
    });

    let timeStr = '';
    if (doorTimeOrStartsAt) {
      if (
        doorTimeOrStartsAt.includes('AM') ||
        doorTimeOrStartsAt.includes('PM')
      ) {
        timeStr = ` · ${doorTimeOrStartsAt.trim()}`;
      } else if (doorTimeOrStartsAt.includes('T')) {
        try {
          const d = new Date(doorTimeOrStartsAt);
          const formatted = d.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: timezone || 'UTC',
          });
          timeStr = ` · ${formatted}`;
        } catch {
          // ignore parsing error
        }
      } else if (doorTimeOrStartsAt.includes(':')) {
        timeStr = ` · ${formatDoorsTime(doorTimeOrStartsAt, timezone)}`;
      }
    }

    return `${weekday}, ${monthName} ${day}${timeStr}`;
  } catch {
    return dateStr;
  }
}

export const formatEventDate = formatIndexDate;

/**
 * Formats doors or show time cleanly, e.g. "7:30 PM" or "Doors at 7:30 PM".
 */
export function formatDoorsTime(
  timeStr?: string | null,
  timezone?: string,
): string {
  if (!timeStr) return 'Time TBA';

  const trimmed = timeStr.trim();
  if (trimmed.includes('AM') || trimmed.includes('PM')) {
    return trimmed;
  }

  // Handle ISO instant
  if (trimmed.includes('T')) {
    try {
      const d = new Date(trimmed);
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone || 'UTC',
      });
    } catch {
      return trimmed;
    }
  }

  // Handle 24-hour HH:mm
  if (/^\d{1,2}:\d{2}/.test(trimmed)) {
    const [hh, mm] = trimmed.split(':').map(Number);
    const period = hh >= 12 ? 'PM' : 'AM';
    const hour12 = hh % 12 || 12;
    return `${hour12}:${String(mm).padStart(2, '0')} ${period}`;
  }

  return trimmed;
}

/**
 * Formats price range with accurate currency symbol or code.
 */
export function formatIndexPrice(
  minPrice?: number | null,
  maxPrice?: number | null,
  currency?: string | null,
  eventKind?: string | null,
  ticketUrl?: string | null,
): string {
  // 1. Explicit free event kind
  if (eventKind === 'free_event') {
    if (
      typeof minPrice === 'number' &&
      Number.isFinite(minPrice) &&
      minPrice > 0
    ) {
      return `Contradictory Pricing ($${minPrice} / Free Event)`;
    }
    return 'Free ($0)';
  }

  // 2. Verified zero minPrice
  if (
    minPrice === 0 &&
    (maxPrice === 0 || maxPrice === null || maxPrice === undefined)
  ) {
    return 'Free ($0)';
  }

  // 3. Missing prices
  if (
    (minPrice === null || minPrice === undefined) &&
    (maxPrice === null || maxPrice === undefined)
  ) {
    return ticketUrl ? 'Check ticket prices' : 'Price TBA';
  }

  // Determine currency symbol or prefix
  const cur = currency?.trim().toUpperCase();
  const sym =
    cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'CAD' ? 'CAD ' : '$';

  if (
    minPrice !== null &&
    minPrice !== undefined &&
    maxPrice !== null &&
    maxPrice !== undefined &&
    minPrice !== maxPrice
  ) {
    return `${sym}${minPrice}–${sym}${maxPrice}`;
  }

  if (minPrice !== null && minPrice !== undefined) {
    return `${sym}${minPrice}`;
  }

  if (maxPrice !== null && maxPrice !== undefined) {
    return `Up to ${sym}${maxPrice}`;
  }

  return ticketUrl ? 'Check ticket prices' : 'Price TBA';
}

export const formatPrice = formatIndexPrice;

export interface StatusBadgeConfig {
  label: string;
  bg: string;
  indicatorLevel?: 'standard' | 'warning' | 'urgent' | 'sold_out' | 'unknown';
}

/**
 * Returns visual badge styling and editorial label for ticket / inventory status.
 * Accurately represents verified remaining ticket percentages when available:
 * - >= 25%: Standard availability
 * - < 25%: Warning (orange)
 * - < 5%: Urgent warning (red)
 * - Confirmed sold out: distinct sold-out badge
 * If percentage is unknown, never manufactures percentages or fake urgency.
 */
export function getStatusBadge(
  status?: IndexInventoryStatus | 'presale' | string | null,
  remainingPercent?: number | null,
): StatusBadgeConfig {
  if (status === 'sold_out') {
    return {
      label: 'Sold Out',
      bg: 'bg-rose-100 text-rose-800 border-rose-300 font-bold',
      indicatorLevel: 'sold_out',
    };
  }
  if (status === 'cancelled') {
    return {
      label: 'Cancelled',
      bg: 'bg-zinc-100 text-zinc-500 border-zinc-200',
      indicatorLevel: 'unknown',
    };
  }

  // Reliable percentage availability when available
  if (
    typeof remainingPercent === 'number' &&
    Number.isFinite(remainingPercent) &&
    remainingPercent >= 0 &&
    remainingPercent <= 100
  ) {
    if (remainingPercent < 5) {
      return {
        label: 'Almost Gone (<5%)',
        bg: 'bg-rose-50 text-rose-700 border-rose-200 font-semibold',
        indicatorLevel: 'urgent',
      };
    }
    if (remainingPercent < 25) {
      return {
        label: 'Low Tickets (<25%)',
        bg: 'bg-amber-50 text-amber-800 border-amber-200 font-medium',
        indicatorLevel: 'warning',
      };
    }
    return {
      label: 'Tickets Available',
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      indicatorLevel: 'standard',
    };
  }

  switch (status) {
    case 'available':
      return {
        label: 'Tickets Available',
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        indicatorLevel: 'standard',
      };
    case 'low_inventory':
      return {
        label: 'Low Inventory',
        bg: 'bg-amber-50 text-amber-700 border-amber-200',
        indicatorLevel: 'warning',
      };
    case 'presale':
      return {
        label: 'Presale Soon',
        bg: 'bg-violet-50 text-violet-700 border-violet-200',
        indicatorLevel: 'standard',
      };
    case 'unknown':
    default:
      return {
        label: 'Check Tickets',
        bg: 'bg-zinc-100 text-zinc-600 border-zinc-200',
        indicatorLevel: 'unknown',
      };
  }
}

/**
 * Calculates haversine distance in miles between two coordinates.
 * Defaults to Denver reference coordinates when origin is not explicitly specified.
 */
export function calculateDistanceMiles(
  lat?: number | null,
  lng?: number | null,
  origin: { lat: number; lng: number } = DEFAULT_REFERENCE_ORIGIN,
): number | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const R = 3958.8; // Radius of Earth in miles
  const dLat = (lat - origin.lat) * (Math.PI / 180);
  const dLon = (lng - origin.lng) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(origin.lat * (Math.PI / 180)) *
      Math.cos(lat * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export function getEventAccentColors(name?: string | null): {
  primary: string;
  secondary: string;
} {
  const palettes = [
    { primary: '#4f46e5', secondary: '#818cf8' }, // Indigo
    { primary: '#0284c7', secondary: '#38bdf8' }, // Sky
    { primary: '#0d9488', secondary: '#2dd4bf' }, // Teal
    { primary: '#16a34a', secondary: '#4ade80' }, // Emerald
    { primary: '#d97706', secondary: '#fbbf24' }, // Amber
    { primary: '#e11d48', secondary: '#fb7185' }, // Rose
    { primary: '#9333ea', secondary: '#c084fc' }, // Purple
    { primary: '#475569', secondary: '#94a3b8' }, // Slate
  ];
  const safeName = name || '';
  let hash = 0;
  for (let i = 0; i < safeName.length; i++) {
    hash = (hash << 5) - hash + safeName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % palettes.length;
  return palettes[index];
}

export interface ArtistAccent {
  primary: string;
  secondary: string;
  subtleBg: string;
  subtleBorder: string;
  accentText: string;
}

/**
 * Returns a restrained, deterministic artist-based visual accent palette.
 * Influences subtle highlights, borders, and badges without compromising
 * legibility or requiring expensive client-side canvas processing.
 */
export function getArtistAccent(name?: string | null): ArtistAccent {
  const safeName = name || '';
  let hash = 0;
  for (let i = 0; i < safeName.length; i++) {
    hash = (hash << 5) - hash + safeName.charCodeAt(i);
    hash |= 0;
  }
  const accents: ArtistAccent[] = [
    {
      primary: '#4f46e5',
      secondary: '#818cf8',
      subtleBg: 'bg-indigo-50/70',
      subtleBorder: 'border-indigo-200/60',
      accentText: 'text-indigo-900',
    },
    {
      primary: '#0284c7',
      secondary: '#38bdf8',
      subtleBg: 'bg-sky-50/70',
      subtleBorder: 'border-sky-200/60',
      accentText: 'text-sky-900',
    },
    {
      primary: '#0d9488',
      secondary: '#2dd4bf',
      subtleBg: 'bg-teal-50/70',
      subtleBorder: 'border-teal-200/60',
      accentText: 'text-teal-900',
    },
    {
      primary: '#16a34a',
      secondary: '#4ade80',
      subtleBg: 'bg-emerald-50/70',
      subtleBorder: 'border-emerald-200/60',
      accentText: 'text-emerald-900',
    },
    {
      primary: '#d97706',
      secondary: '#fbbf24',
      subtleBg: 'bg-amber-50/70',
      subtleBorder: 'border-amber-200/60',
      accentText: 'text-amber-900',
    },
    {
      primary: '#e11d48',
      secondary: '#fb7185',
      subtleBg: 'bg-rose-50/70',
      subtleBorder: 'border-rose-200/60',
      accentText: 'text-rose-900',
    },
    {
      primary: '#9333ea',
      secondary: '#c084fc',
      subtleBg: 'bg-purple-50/70',
      subtleBorder: 'border-purple-200/60',
      accentText: 'text-purple-900',
    },
    {
      primary: '#475569',
      secondary: '#94a3b8',
      subtleBg: 'bg-slate-50/70',
      subtleBorder: 'border-slate-200/60',
      accentText: 'text-slate-900',
    },
  ];
  const index = Math.abs(hash) % accents.length;
  return accents[index];
}
