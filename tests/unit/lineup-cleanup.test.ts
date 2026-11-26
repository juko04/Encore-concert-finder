import { describe, expect, it } from 'vitest';
import {
  cleanLineupForDisplay,
  cleanLineupName,
  splitSupportActs,
} from '@/lib/events/lineup';
import { parseZ2Artists } from '@/lib/sources/venue/z2-entertainment/parser';
import { parseBilling } from '@/lib/sources/venue/tribe-events/billing';

describe('cleanLineupName', () => {
  it('strips billing prefixes and date notes', () => {
    expect(cleanLineupName('special guests Deer Creek Sharpshooters (11')).toBe(
      'Deer Creek Sharpshooters',
    );
    expect(cleanLineupName('Tonewood (11, 28)')).toBe('Tonewood');
    expect(cleanLineupName('Tonewood (11/28)')).toBe('Tonewood');
    expect(cleanLineupName('Special Guest: Kind Hearted Strangers')).toBe(
      'Kind Hearted Strangers',
    );
  });

  it('drops scraps with no letters', () => {
    expect(cleanLineupName('27)')).toBeNull();
    expect(cleanLineupName('  ')).toBeNull();
    expect(cleanLineupName('(11')).toBeNull();
  });

  it('keeps real names that start with list-like words or carry letter-only parentheses', () => {
    expect(cleanLineupName('With Confidence')).toBe('With Confidence');
    expect(cleanLineupName('And So I Watch You From Afar')).toBe(
      'And So I Watch You From Afar',
    );
    expect(cleanLineupName('Matchbox Twenty (Acoustic)')).toBe(
      'Matchbox Twenty (Acoustic)',
    );
    expect(cleanLineupName('(hed) p.e.')).toBe('(hed) p.e.');
  });
});

describe('splitSupportActs', () => {
  it('does not split inside parentheses and dedupes', () => {
    expect(
      splitSupportActs(
        'Deer Creek Sharpshooters, Sam Bush, special guests Deer Creek Sharpshooters (11, 27), Tonewood (11, 28)',
      ),
    ).toEqual(['Deer Creek Sharpshooters', 'Sam Bush', 'Tonewood']);
  });

  it('treats "and" after a comma as a list word', () => {
    expect(splitSupportActs('A, B, and C')).toEqual(['A', 'B', 'C']);
  });
});

describe('venue parsers use the shared splitter', () => {
  it('Z2: date notes in the support line no longer become artists', () => {
    const { artists } = parseZ2Artists(
      'Leftover Salmon',
      'special guests Deer Creek Sharpshooters (11, 27), Tonewood (11, 28)',
    );
    expect(artists.map((a) => a.name)).toEqual([
      'Leftover Salmon',
      'Deer Creek Sharpshooters',
      'Tonewood',
    ]);
  });

  it('tribe-events: same rule for "with" billing in the title', () => {
    const { artists } = parseBilling(
      'Leftover Salmon with special guests Tonewood (11/28), Sam Bush',
    );
    expect(artists.map((a) => a.name)).toEqual([
      'Leftover Salmon',
      'Tonewood',
      'Sam Bush',
    ]);
  });
});

describe('cleanLineupForDisplay', () => {
  const stored = [
    { name: 'Leftover Salmon', billingPosition: 'unknown' },
    { name: 'Deer Creek Sharpshooters', billingPosition: 'unknown' },
    { name: 'Sam Bush', billingPosition: 'support' },
    {
      name: 'special guests Deer Creek Sharpshooters (11',
      billingPosition: 'support',
    },
    { name: '27)', billingPosition: 'support' },
    { name: 'Tonewood (11', billingPosition: 'support' },
    { name: '28)', billingPosition: 'support' },
  ];

  it('removes scraps and repeats, so a 4-act bill keeps its headliner', () => {
    // Seven raw rows would count as a festival-sized bill and drop "Leftover Salmon" as the
    // event-name artist; cleaned, it is a normal 4-act bill.
    const out = cleanLineupForDisplay(stored, 'Leftover Salmon');
    expect(out.map((a) => a.name)).toEqual([
      'Leftover Salmon',
      'Deer Creek Sharpshooters',
      'Sam Bush',
      'Tonewood',
    ]);
  });

  it('upgrades a repeat to headliner when any copy was billed as headliner', () => {
    const out = cleanLineupForDisplay(
      [
        { name: 'Band', billingPosition: 'support' },
        { name: 'special guests Band', billingPosition: 'headliner' },
      ],
      'Show',
    );
    expect(out).toEqual([{ name: 'Band', billingPosition: 'headliner' }]);
  });
});
