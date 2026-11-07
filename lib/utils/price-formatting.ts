/**
 * Event Ticket Price Formatting Utility
 *
 * Provides authoritative currency and ticket price representation for live events.
 *
 * Invariants:
 * 1. Verified free events (eventKind === 'free_event') with consistent price (null, undefined, 0)
 *    display as "Free Event (Verified)".
 * 2. Contradictory free events (eventKind === 'free_event' with positive minPrice) display as
 *    "Contradictory Pricing (price / Free Event)".
 * 3. Unverified zero prices (minPrice === 0 without free_event status) display with currency-aware indicators:
 *    - USD: "Unverified $0 USD (Status TBA)"
 *    - Foreign currency: "Unverified {CURRENCY} 0 (Status TBA)" (e.g. "Unverified CAD 0 (Status TBA)")
 *    - Unknown currency: "Unverified 0 (currency unknown, Status TBA)" - NEVER with $ or USD semantics.
 * 4. Missing prices display as "Price TBA".
 * 5. Foreign currencies display with authoritative code (e.g. "CAD 35", "EUR 45").
 * 6. USD prices display with explicit USD indicator (e.g. "$50 USD").
 * 7. Unknown currencies display as "{price} (currency unknown)" - NEVER with $ or USD semantics.
 * 8. Non-finite or negative prices display as "Invalid Price Reported".
 */
export function formatEventPriceDisplay(event: {
  minPrice?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  eventKind?: string | null;
}): string {
  const { minPrice, currency, eventKind } = event;

  // 1. Check for verified free admission or contradictory positive pricing on free events
  if (eventKind === 'free_event') {
    if (
      typeof minPrice === 'number' &&
      Number.isFinite(minPrice) &&
      minPrice > 0
    ) {
      const normalizedCurrency = currency?.trim().toUpperCase();
      let priceStr: string;
      if (!normalizedCurrency) {
        priceStr = `${minPrice} (currency unknown)`;
      } else if (normalizedCurrency === 'USD') {
        priceStr = `$${minPrice} USD`;
      } else {
        priceStr = `${normalizedCurrency} ${minPrice}`;
      }
      return `Contradictory Pricing (${priceStr} / Free Event)`;
    }

    return 'Free Event (Verified)';
  }

  // 2. Missing price check
  if (minPrice === null || minPrice === undefined) {
    return 'Price TBA';
  }

  // 3. Non-finite or negative price check
  if (
    typeof minPrice !== 'number' ||
    !Number.isFinite(minPrice) ||
    minPrice < 0
  ) {
    return 'Invalid Price Reported';
  }

  const normalizedCurrency = currency?.trim().toUpperCase();

  // 4. Unverified zero check (eventKind !== 'free_event')
  // Avoid suggesting USD when currency is CAD, EUR, or unknown
  if (minPrice === 0) {
    if (!normalizedCurrency) {
      return 'Unverified 0 (currency unknown, Status TBA)';
    }
    if (normalizedCurrency === 'USD') {
      return 'Unverified $0 USD (Status TBA)';
    }
    return `Unverified ${normalizedCurrency} 0 (Status TBA)`;
  }

  // 5. Positive prices with currency formatting
  if (!normalizedCurrency) {
    return `${minPrice} (currency unknown)`;
  }

  if (normalizedCurrency === 'USD') {
    return `$${minPrice} USD`;
  }

  return `${normalizedCurrency} ${minPrice}`;
}
