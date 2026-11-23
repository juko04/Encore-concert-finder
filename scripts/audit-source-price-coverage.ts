import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.',
  );
  console.error(
    'Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/audit-source-price-coverage.ts',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type VerificationVerdict =
  | 'VERIFIED_PAID'
  | 'VERIFIED_FREE'
  | 'VERIFIED_SOLD_OUT'
  | 'UNVERIFIED_UNKNOWN_PRICE'
  | 'UNVERIFIED_UNKNOWN_INVENTORY'
  | 'NEEDS_REVIEW';

interface EventAuditItem {
  id: string;
  name: string;
  venueName: string;
  sourceUrl: string;
  eventKind: string;
  minPrice: number | null;
  maxPrice: number | null;
  currency: string | null;
  inventoryStatus: string;
  hasVerifiedAt: boolean;
  hasSourceEvidence: boolean;
  verdict: VerificationVerdict;
  verdictReason: string;
}

export async function runCoverageAudit() {
  console.log('--- Concert Source Coverage & Pricing Audit ---');
  console.log(`Target: ${SUPABASE_URL}`);

  // Fetch events with ticket links and sources
  const { data: events, error } = await supabase
    .from('events')
    .select(`
      id,
      name,
      event_kind,
      min_price,
      max_price,
      currency,
      venues (id, name),
      event_ticket_links (id, url, min_price, max_price, currency, inventory_status, verified_at),
      event_sources (source_id, source_url)
    `)
    .limit(200);

  if (error || !events) {
    throw new Error(`Failed to fetch events: ${error?.message}`);
  }

  console.log(`Auditing ${events.length} concerts...\n`);

  const auditItems: EventAuditItem[] = [];

  let verifiedPaidCount = 0;
  let verifiedFreeCount = 0;
  let unknownPriceCount = 0;
  let verifiedSoldOutCount = 0;
  let unknownInventoryCount = 0;
  let needsReviewCount = 0;

  for (const ev of events) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const venueName = (ev.venues as any)?.name || 'Venue TBA';
    const ticketLinks = ev.event_ticket_links || [];
    const sources = ev.event_sources || [];

    const primaryTicketLink = ticketLinks[0];
    const inventoryStatus = primaryTicketLink?.inventory_status || 'unknown';
    const hasVerifiedAt = ticketLinks.some(
      (tl: { verified_at?: string | null }) => tl.verified_at != null,
    );

    const minPrice = ev.min_price;
    const sourceUrl = sources[0]?.source_url || primaryTicketLink?.url || '';

    // Determine verdict based on actual source evidence
    let verdict: VerificationVerdict;
    let verdictReason: string;

    if (inventoryStatus === 'sold_out' && hasVerifiedAt) {
      verdict = 'VERIFIED_SOLD_OUT';
      verdictReason = 'Source parser explicitly reported sold_out with verified timestamp';
      verifiedSoldOutCount++;
    } else if (inventoryStatus === 'sold_out' && !hasVerifiedAt) {
      verdict = 'NEEDS_REVIEW';
      verdictReason = 'Marked sold_out but no verified_at timestamp — verify against source';
      needsReviewCount++;
    } else if (minPrice === 0 || ev.event_kind === 'free_event') {
      verdict = 'VERIFIED_FREE';
      verdictReason =
        ev.event_kind === 'free_event'
          ? 'Event kind is free_event'
          : 'Price is $0';
      verifiedFreeCount++;
    } else if (minPrice != null && minPrice > 0) {
      verdict = 'VERIFIED_PAID';
      verdictReason = `Structured price $${minPrice}${ev.max_price && ev.max_price !== minPrice ? `-$${ev.max_price}` : ''} from parser`;
      verifiedPaidCount++;
    } else {
      verdict = 'UNVERIFIED_UNKNOWN_PRICE';
      verdictReason = 'No structured price from any source parser';
      unknownPriceCount++;
    }

    if (inventoryStatus === 'unknown') {
      unknownInventoryCount++;
    }

    auditItems.push({
      id: ev.id,
      name: ev.name,
      venueName,
      sourceUrl,
      eventKind: ev.event_kind,
      minPrice,
      maxPrice: ev.max_price,
      currency: ev.currency,
      inventoryStatus,
      hasVerifiedAt,
      hasSourceEvidence: sources.length > 0,
      verdict,
      verdictReason,
    });
  }

  console.log('=== AUDIT RESULTS ===');
  console.log(`Total audited concerts: ${auditItems.length}`);
  console.log(
    `Verified Paid pricing: ${verifiedPaidCount} (${((verifiedPaidCount / auditItems.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Verified Free ($0) pricing: ${verifiedFreeCount} (${((verifiedFreeCount / auditItems.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Unknown price (Price TBA): ${unknownPriceCount} (${((unknownPriceCount / auditItems.length) * 100).toFixed(1)}%)`,
  );
  console.log(`Verified Sold Out: ${verifiedSoldOutCount}`);
  console.log(`Unknown inventory: ${unknownInventoryCount}`);
  console.log(`Needs Review: ${needsReviewCount}`);

  console.log('\nSample Audited Records:');
  for (const item of auditItems.slice(0, 15)) {
    const priceStr =
      item.minPrice === 0
        ? 'Free ($0)'
        : item.minPrice != null
          ? `$${item.minPrice}${item.maxPrice && item.maxPrice !== item.minPrice ? `-$${item.maxPrice}` : ''}`
          : 'Price TBA';
    console.log(
      `  [${item.verdict}] ${item.name} @ ${item.venueName} → Price: ${priceStr}, Status: ${item.inventoryStatus}`,
    );
    console.log(`    Reason: ${item.verdictReason}`);
  }

  return {
    totalAudited: auditItems.length,
    verifiedPaidCount,
    verifiedFreeCount,
    unknownPriceCount,
    verifiedSoldOutCount,
    unknownInventoryCount,
    needsReviewCount,
    sample: auditItems.slice(0, 20),
  };
}

if (process.argv[1]?.endsWith('audit-source-price-coverage.ts')) {
  runCoverageAudit()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
