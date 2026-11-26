/**
 * Venue guide types.
 *
 * Venue guides are researched, source-backed facts about a venue (parking,
 * age policy, bag rules, etc.). Every item carries the URLs it came from and
 * whether the evidence is `official` (venue/operator/ticketing page) or
 * `community` (reviews, forums, third-party guides).
 */

export type VenueEvidence = 'official' | 'community';
export type VenueGuideConfidence = 'high' | 'medium' | 'low';

export interface VenueGuideItem {
  text: string;
  evidence: VenueEvidence;
  sourceUrls: string[];
}

export interface VenueGuide {
  name: string;
  aliases: string[];
  city: string;
  region: string;
  confidence: VenueGuideConfidence;
  facts: {
    capacity: number | null;
    seatingFormat: string | null;
    parkingDifficulty: string | null;
  };
  whyPeopleLikeIt: VenueGuideItem[];
  considerBeforeAttending: VenueGuideItem[];
}

export type VenueMatchKind = 'exact' | 'alias' | 'sub-space';

export interface VenueGuideMatch {
  guide: VenueGuide;
  kind: VenueMatchKind;
}
