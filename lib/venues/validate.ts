/**
 * Runtime shape validation for venue guide data.
 *
 * The data is hand-curated JSON, so we validate it at load time and drop
 * anything malformed instead of crashing a page. Tests assert that nothing
 * is dropped from the shipped data.
 */

import type {
  VenueGuide,
  VenueGuideConfidence,
  VenueGuideItem,
  VenueEvidence,
} from './types';

const CONFIDENCES: readonly VenueGuideConfidence[] = ['high', 'medium', 'low'];
const EVIDENCE: readonly VenueEvidence[] = ['official', 'community'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseItem(
  raw: unknown,
  where: string,
  issues: string[],
): VenueGuideItem | null {
  if (!isRecord(raw)) {
    issues.push(`${where}: item is not an object`);
    return null;
  }
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) {
    issues.push(`${where}: item has no text`);
    return null;
  }
  if (!EVIDENCE.includes(raw.evidence as VenueEvidence)) {
    issues.push(`${where}: item has invalid evidence`);
    return null;
  }
  const urls = Array.isArray(raw.sourceUrls)
    ? raw.sourceUrls.filter(isHttpUrl)
    : [];
  if (urls.length === 0) {
    // Every claim must be traceable to at least one source.
    issues.push(`${where}: item has no valid source URL`);
    return null;
  }
  return {
    text,
    evidence: raw.evidence as VenueEvidence,
    sourceUrls: urls,
  };
}

export function parseVenueGuide(
  raw: unknown,
  issues: string[] = [],
): VenueGuide | null {
  if (!isRecord(raw)) {
    issues.push('guide is not an object');
    return null;
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) {
    issues.push('guide has no name');
    return null;
  }
  if (typeof raw.city !== 'string' || !raw.city.trim()) {
    issues.push(`${name}: missing city`);
    return null;
  }
  if (typeof raw.region !== 'string' || !raw.region.trim()) {
    issues.push(`${name}: missing region`);
    return null;
  }
  if (!CONFIDENCES.includes(raw.confidence as VenueGuideConfidence)) {
    issues.push(`${name}: invalid confidence`);
    return null;
  }

  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.filter(
        (a): a is string => typeof a === 'string' && a.trim().length > 0,
      )
    : [];

  const factsRaw = isRecord(raw.facts) ? raw.facts : {};
  const facts = {
    capacity:
      typeof factsRaw.capacity === 'number' &&
      Number.isFinite(factsRaw.capacity)
        ? factsRaw.capacity
        : null,
    seatingFormat:
      typeof factsRaw.seatingFormat === 'string'
        ? factsRaw.seatingFormat
        : null,
    parkingDifficulty:
      typeof factsRaw.parkingDifficulty === 'string'
        ? factsRaw.parkingDifficulty
        : null,
  };

  const parseList = (key: string): VenueGuideItem[] => {
    const list = raw[key];
    if (!Array.isArray(list)) return [];
    const parsed: VenueGuideItem[] = [];
    list.forEach((item, index) => {
      const ok = parseItem(item, `${name}.${key}[${index}]`, issues);
      if (ok) parsed.push(ok);
    });
    return parsed;
  };

  return {
    name,
    aliases,
    city: raw.city.trim(),
    region: raw.region.trim(),
    confidence: raw.confidence as VenueGuideConfidence,
    facts,
    whyPeopleLikeIt: parseList('whyPeopleLikeIt'),
    considerBeforeAttending: parseList('considerBeforeAttending'),
  };
}

export interface ParsedVenueGuides {
  researchedOn: string | null;
  guides: VenueGuide[];
  issues: string[];
}

export function parseVenueGuides(raw: unknown): ParsedVenueGuides {
  const issues: string[] = [];
  if (!isRecord(raw) || !Array.isArray(raw.venues)) {
    return {
      researchedOn: null,
      guides: [],
      issues: ['guide document has no venues array'],
    };
  }
  const guides: VenueGuide[] = [];
  for (const venue of raw.venues) {
    const guide = parseVenueGuide(venue, issues);
    if (guide) guides.push(guide);
  }
  return {
    researchedOn:
      typeof raw.researchedOn === 'string' ? raw.researchedOn : null,
    guides,
    issues,
  };
}
