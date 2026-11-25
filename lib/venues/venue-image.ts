/**
 * Finds a venue's own promotional image on its website (pure, no I/O).
 *
 * Only the page's declared share image is used (Open Graph / Twitter card / image_src), resolved
 * against the page URL and restricted to https. Nothing is guessed or generated, and the image is
 * hot-linked (never copied) so the venue stays the source of the asset.
 */

import * as cheerio from 'cheerio';

const IMAGE_META_SELECTORS: ReadonlyArray<{ selector: string; attr: string }> =
  [
    { selector: 'meta[property="og:image:secure_url"]', attr: 'content' },
    { selector: 'meta[property="og:image"]', attr: 'content' },
    { selector: 'meta[name="twitter:image"]', attr: 'content' },
    { selector: 'meta[name="twitter:image:src"]', attr: 'content' },
    { selector: 'link[rel="image_src"]', attr: 'href' },
  ];

/**
 * Placeholders, icons and brand marks that are not a usable photo for a card hero (logos and
 * stickers crop badly with object-cover and are not "a picture of the venue").
 */
const UNUSABLE_IMAGE =
  /(favicon|apple-touch-icon|\.ico(\?|$)|\.svg(\?|$)|spacer|blank\.|1x1|sprite|logo|sticker|badge|wordmark|icon|-round[-_.]|[-_]round[-_.])/i;

export function extractVenueImageUrl(
  html: string,
  pageUrl: string,
): string | null {
  if (typeof html !== 'string' || !html) return null;
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return null;
  }
  for (const { selector, attr } of IMAGE_META_SELECTORS) {
    const raw = $(selector).first().attr(attr)?.trim();
    if (!raw) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'https:') continue;
    if (UNUSABLE_IMAGE.test(resolved.pathname + resolved.search)) continue;
    return resolved.toString();
  }
  return null;
}
