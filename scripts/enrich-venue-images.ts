#!/usr/bin/env node

/**
 * Venue image enrichment.
 *
 * For each active VENUE-type source (a venue's own calendar site) it reads the site's declared
 * share image (Open Graph / Twitter card), verifies the URL really serves an image over https,
 * and stores it on the source's venues that have no image yet (venues.image_url, fill-if-empty)
 * plus the venue's website. The image is hot-linked, never copied. Promoter and aggregator
 * sources are skipped (their site is not the venue's).
 *
 * Usage:
 *   npm run enrich:venue-images                 # dry run: prints what it would store
 *   npm run enrich:venue-images -- --persist    # writes to the (local) database
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertSafeDatabaseTarget } from '@/lib/supabase/destination-guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractVenueImageUrl } from '@/lib/venues/venue-image';

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const MAX_VENUES_PER_SITE = 3;
const UA = 'EncoreBot/1.0 (venue image lookup; contact via site owner)';

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function servesImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Range: 'bytes=0-1023' },
      signal: AbortSignal.timeout(12000),
    });
    const type = res.headers.get('content-type') ?? '';
    return (
      (res.ok || res.status === 206) && type.toLowerCase().startsWith('image/')
    );
  } catch {
    return false;
  }
}

async function main() {
  loadEnvLocal();
  const persist = process.argv.includes('--persist');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  assertSafeDatabaseTarget(url, false, 'Venue image enrichment');
  const admin = createAdminClient();

  const { data: sources, error } = await admin
    .from('sources')
    .select('id, slug, name, base_url, source_type')
    .eq('active', true)
    .eq('source_type', 'venue');
  if (error) throw new Error(error.message);

  let updated = 0;
  for (const src of sources ?? []) {
    if (!src.base_url) continue;
    const html = await fetchText(src.base_url);
    const image = html ? extractVenueImageUrl(html, src.base_url) : null;
    const ok = image ? await servesImage(image) : false;
    console.log(
      `${src.slug.padEnd(24)} ${ok ? 'IMAGE ' : 'none  '} ${image ?? '(no share image found)'}`,
    );
    if (!ok || !image) continue;

    // Venues that host this source's events (via event_sources -> events.venue_id).
    const { data: links } = await admin
      .from('event_sources')
      .select('events(venue_id)')
      .eq('source_id', src.id)
      .limit(5000);
    const venueIds = Array.from(
      new Set(
        (links ?? [])
          .map(
            (l) =>
              (l as unknown as { events?: { venue_id?: string } }).events
                ?.venue_id,
          )
          .filter((v): v is string => Boolean(v)),
      ),
    );
    if (venueIds.length === 0) continue;
    // A site that hosts several unrelated venues (promoter-style) is not one venue's image.
    if (venueIds.length > MAX_VENUES_PER_SITE) {
      console.log(
        `  -> skipped: ${venueIds.length} venues share this site (not a single venue's image)`,
      );
      continue;
    }
    console.log(
      `  -> ${venueIds.length} venue(s) without image will be filled`,
    );
    if (!persist) continue;

    const { data: filled, error: upErr } = await admin
      .from('venues')
      .update({ image_url: image, updated_at: new Date().toISOString() })
      .in('id', venueIds)
      .is('image_url', null)
      .select('id');
    if (upErr) throw new Error(upErr.message);
    updated += filled?.length ?? 0;
    await admin
      .from('venues')
      .update({ website: src.base_url })
      .in('id', venueIds)
      .is('website', null);
  }
  console.log(
    persist
      ? `Done. Venues updated: ${updated}`
      : 'Dry run only. Re-run with --persist to write.',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
