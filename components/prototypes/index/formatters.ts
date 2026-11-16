import type { PrototypeEvent } from '@/lib/prototypes/fixtures';

export function formatEventDate(dateStr: string, doorTime?: string): string {
  try {
    // Parse ISO YYYY-MM-DD
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
    const monthName = date.toLocaleDateString('en-US', { month: 'short' });
    const timeStr = doorTime ? ` · ${doorTime}` : '';
    return `${weekday}, ${monthName} ${day}${timeStr}`;
  } catch {
    return dateStr;
  }
}

export function formatPrice(
  minPrice?: number | null,
  maxPrice?: number | null,
  currency?: string | null,
): string {
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  if (
    minPrice === 0 &&
    (maxPrice === 0 || maxPrice === null || maxPrice === undefined)
  ) {
    return 'Free ($0)';
  }
  if (
    (minPrice === null || minPrice === undefined) &&
    (maxPrice === null || maxPrice === undefined)
  ) {
    return 'Price TBA';
  }
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
  return 'Price TBA';
}

export function getStatusBadge(status: PrototypeEvent['ticketStatus']) {
  switch (status) {
    case 'available':
      return {
        label: 'Tickets Available',
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'low_inventory':
      return {
        label: 'Low Inventory',
        bg: 'bg-amber-50 text-amber-700 border-amber-200',
      };
    case 'presale':
      return {
        label: 'Presale Soon',
        bg: 'bg-violet-50 text-violet-700 border-violet-200',
      };
    case 'sold_out':
      return {
        label: 'Sold Out',
        bg: 'bg-rose-50 text-rose-700 border-rose-200',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        bg: 'bg-zinc-100 text-zinc-500 border-zinc-200',
      };
  }
}

const DENVER_CENTER = { lat: 39.7392, lng: -104.9903 };

export function calculateDistanceMiles(
  lat?: number | null,
  lng?: number | null,
  origin = DENVER_CENTER,
): number | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
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
