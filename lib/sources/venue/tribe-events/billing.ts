import * as cheerio from 'cheerio';
import { splitSupportActs } from '@/lib/events/lineup';
import type { CandidateArtist } from '@/lib/domain/event-candidate';

/** Decodes HTML entities (e.g. `&#8217;`, `&amp;`) and collapses whitespace. */
export function decodeHtmlText(value: string | null | undefined): string {
  if (!value) return '';
  return cheerio
    .load(`<p>${value}</p>`)('p')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParsedBilling {
  cleanTitle: string;
  isCancelled: boolean;
  isRescheduled: boolean;
  isSoldOutInTitle: boolean;
  artists: CandidateArtist[];
}

/**
 * Conservative headliner/support split for venue listing titles.
 * Only splits on explicit billing markers ("w/", "with", "ft."), never on bare "&" or "and".
 * Tour/subtitle suffixes after " - ", " – " or ": " are not part of the performer name.
 */
export function parseBilling(rawTitle: string): ParsedBilling {
  let title = rawTitle
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  let isCancelled = false;
  let isRescheduled = false;
  let isSoldOutInTitle = false;

  for (let i = 0; i < 4; i++) {
    const before = title;
    const prefix = title.match(
      /^[*([]*\s*(cancel(?:l)?ed|rescheduled|postponed|sold out)\s*[*)\]]*\s*[-–—:]*\s*/i,
    );
    if (prefix) {
      const word = prefix[1].toLowerCase();
      if (word.startsWith('cancel')) isCancelled = true;
      else if (word === 'rescheduled') isRescheduled = true;
      else if (word === 'sold out') isSoldOutInTitle = true;
      title = title.slice(prefix[0].length).trim();
    }
    const suffix = title.match(/\s*[-–—:]\s*sold\s*out\s*$/i);
    if (suffix) {
      isSoldOutInTitle = true;
      title = title.slice(0, suffix.index).trim();
    }
    if (title === before) break;
  }

  title = title.replace(/^free\s*:\s*/i, '').trim();
  // Stage markers ("(INDOOR STAGE)") and " @ <venue>" suffixes are not performer names.
  title = title
    .replace(/\s*\((?:indoor|outdoor|main)\s+stage\)\s*$/i, '')
    .trim();
  title = title.replace(/\s+@\s+.+$/, '').trim();

  const cleanTitle = title;

  // Remove tour/subtitle suffix for the performer part only.
  let performerPart = cleanTitle
    .split(/\s*[-–—]\s+|:\s+/)[0]
    .replace(/^an evening with\s+/i, '')
    .replace(/\s+(?:nye|new year'?s eve)\s+celebration$/i, '')
    .replace(/\s+(?:\d{4}\s+)?tour$/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  if (!performerPart) performerPart = cleanTitle;

  let headlinerPart = performerPart;
  let supportPart = '';
  const withMatch = performerPart.match(/^(.*?)\s+(?:w\/|w\.|w|with)\s+(.*)$/i);
  if (withMatch) {
    headlinerPart = withMatch[1].trim();
    supportPart = withMatch[2].trim();
  }

  let featured = '';
  const featMatch = headlinerPart.match(
    /^(.*?)\s+(?:ft\.?|feat\.?|featuring)\s+(.*)$/i,
  );
  if (featMatch) {
    headlinerPart = featMatch[1].trim();
    featured = featMatch[2].trim();
  }

  const artists: CandidateArtist[] = [];
  if (headlinerPart) {
    artists.push({
      name: headlinerPart,
      billingPosition: 'headliner',
      sortOrder: 1,
    });
  }
  const supports = [featured, supportPart]
    .filter(Boolean)
    .flatMap((part) => splitSupportActs(part));
  for (const name of supports) {
    artists.push({
      name,
      billingPosition: 'support',
      sortOrder: artists.length + 1,
    });
  }

  return {
    cleanTitle,
    isCancelled,
    isRescheduled,
    isSoldOutInTitle,
    artists,
  };
}
