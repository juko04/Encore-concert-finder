import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.',
  );
  console.error(
    'Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-pricing-availability.ts [--dry-run]',
  );
  process.exit(1);
}

// Safety: refuse to run against production unless explicitly overridden
const isLocal =
  SUPABASE_URL.includes('127.0.0.1') ||
  SUPABASE_URL.includes('localhost') ||
  SUPABASE_URL.includes('.supabase.co') === false;

if (!isLocal && process.env.ALLOW_PRODUCTION_BACKFILL !== 'true') {
  console.error(
    'Error: This script is blocked from running against a non-local Supabase instance.',
  );
  console.error(
    'Set ALLOW_PRODUCTION_BACKFILL=true to override this safety check.',
  );
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface BackfillChange {
  table: string;
  id: string;
  field: string;
  before: string | number | null;
  after: string | number | null;
  reason: string;
}

export async function backfillPricingAndAvailability() {
  console.log(
    `--- Pricing & Availability Backfill (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ---`,
  );
  console.log(`Target: ${SUPABASE_URL}`);

  const changes: BackfillChange[] = [];

  // 1. Snapshot current state for before/after reporting
  const { data: allLinksBefore } = await supabase
    .from('event_ticket_links')
    .select(
      'id, event_id, inventory_status, min_price, max_price, currency, url, verified_at',
    );

  const beforeStatusCounts: Record<string, number> = {};
  for (const l of allLinksBefore || []) {
    const status = l.inventory_status || 'null';
    beforeStatusCounts[status] = (beforeStatusCounts[status] || 0) + 1;
  }
  console.log('\nBEFORE state:');
  console.log('  Inventory status distribution:', beforeStatusCounts);

  // 2. Find ticket links that were marked 'available' solely because they had a URL
  // but have no verified_at timestamp and no source-specific inventory evidence
  const { data: unverifiedAvailable } = await supabase
    .from('event_ticket_links')
    .select('id, event_id, inventory_status, url, verified_at')
    .eq('inventory_status', 'available')
    .is('verified_at', null); // Only demote unverified links

  console.log(
    `\nFound ${unverifiedAvailable?.length || 0} unverified 'available' ticket links (no verified_at timestamp).`,
  );

  for (const link of unverifiedAvailable || []) {
    changes.push({
      table: 'event_ticket_links',
      id: link.id,
      field: 'inventory_status',
      before: 'available',
      after: 'unknown',
      reason:
        'No verified_at timestamp — ticket URL alone does not prove remaining inventory',
    });
  }

  if (!DRY_RUN && unverifiedAvailable && unverifiedAvailable.length > 0) {
    const ids = unverifiedAvailable.map((l) => l.id);
    // Batch update in chunks of 100
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await supabase
        .from('event_ticket_links')
        .update({ inventory_status: 'unknown' })
        .in('id', chunk);
      if (error) {
        console.error(`Error updating chunk ${i}: ${error.message}`);
      }
    }
    console.log(
      `  Demoted ${unverifiedAvailable.length} unverified 'available' ticket links to 'unknown'.`,
    );
  }

  // 3. Do NOT blindly mark events sold out from title.
  // Only mark sold out if there is a verified_at timestamp on a ticket link
  // that explicitly came from a source parser with an is_sold_out signal.
  console.log(
    '\nNote: Sold-out status changes require source-level evidence (verified_at + parser signal).',
  );
  console.log(
    '  No automatic title-based sold-out marking is performed by this script.',
  );

  // 4. Ensure free events have structured $0 pricing (non-destructive)
  const { data: freeEvents } = await supabase
    .from('events')
    .select('id, name')
    .eq('event_kind', 'free_event');

  let updatedFreeCount = 0;
  for (const freeEvent of freeEvents || []) {
    const { data: updated } = await supabase
      .from('event_ticket_links')
      .select('id, min_price')
      .eq('event_id', freeEvent.id)
      .is('min_price', null);

    if (updated && updated.length > 0) {
      for (const link of updated) {
        changes.push({
          table: 'event_ticket_links',
          id: link.id,
          field: 'min_price',
          before: null,
          after: 0,
          reason: `Event "${freeEvent.name}" is event_kind=free_event`,
        });
      }

      if (!DRY_RUN) {
        await supabase
          .from('event_ticket_links')
          .update({ min_price: 0, max_price: 0, currency: 'USD' })
          .eq('event_id', freeEvent.id)
          .is('min_price', null);
      }
      updatedFreeCount += updated.length;
    }
  }
  console.log(
    `\nFree event pricing: ${updatedFreeCount} ticket links need $0 USD backfill.`,
  );

  // 5. After state
  if (!DRY_RUN) {
    const { data: allLinksAfter } = await supabase
      .from('event_ticket_links')
      .select('inventory_status, min_price');

    const afterStatusCounts: Record<string, number> = {};
    let withPrice = 0;
    let freePrice = 0;
    let missingPrice = 0;

    for (const l of allLinksAfter || []) {
      const status = l.inventory_status || 'null';
      afterStatusCounts[status] = (afterStatusCounts[status] || 0) + 1;
      if (l.min_price === 0) freePrice++;
      else if (l.min_price != null && l.min_price > 0) withPrice++;
      else missingPrice++;
    }

    console.log('\nAFTER state:');
    console.log('  Inventory status distribution:', afterStatusCounts);
    console.log(
      `  Price coverage: ${withPrice} paid, ${freePrice} free ($0), ${missingPrice} unknown.`,
    );
  }

  // 6. Change log
  console.log(`\n--- Change Summary ---`);
  console.log(
    `Total changes: ${changes.length} (${DRY_RUN ? 'DRY RUN — no writes executed' : 'APPLIED'})`,
  );

  if (changes.length > 0) {
    console.log('\nSample changes (first 20):');
    for (const c of changes.slice(0, 20)) {
      console.log(
        `  [${c.table}] ${c.id}: ${c.field} ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)} (${c.reason})`,
      );
    }
  }

  return {
    dryRun: DRY_RUN,
    totalChanges: changes.length,
    beforeStatusCounts,
    changes: changes.slice(0, 100), // Limit logged changes
  };
}

if (process.argv[1]?.endsWith('backfill-pricing-availability.ts')) {
  backfillPricingAndAvailability()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
