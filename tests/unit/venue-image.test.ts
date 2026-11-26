import { describe, expect, it } from 'vitest';
import { extractVenueImageUrl } from '@/lib/venues/venue-image';

const page = (head: string) => `<html><head>${head}</head><body></body></html>`;
const BASE = 'https://venue.example.invalid/';

describe('extractVenueImageUrl', () => {
  it('prefers og:image and resolves relative urls against the page', () => {
    expect(
      extractVenueImageUrl(
        page('<meta property="og:image" content="/media/room-photo.jpg">'),
        BASE,
      ),
    ).toBe('https://venue.example.invalid/media/room-photo.jpg');
  });

  it('falls back to the twitter card image and link rel=image_src', () => {
    expect(
      extractVenueImageUrl(
        page(
          '<meta name="twitter:image" content="https://cdn.example.invalid/stage.jpg">',
        ),
        BASE,
      ),
    ).toBe('https://cdn.example.invalid/stage.jpg');
    expect(
      extractVenueImageUrl(
        page(
          '<link rel="image_src" href="https://cdn.example.invalid/hall.png">',
        ),
        BASE,
      ),
    ).toBe('https://cdn.example.invalid/hall.png');
  });

  it('rejects non-https, logos, stickers, icons and svg', () => {
    for (const bad of [
      'http://venue.example.invalid/room.jpg',
      'https://venue.example.invalid/uploads/LOST-LAKE-round-blue-black-sticker.png',
      'https://venue.example.invalid/images/Venue_Logo_Yellow.png',
      'https://venue.example.invalid/favicon.ico',
      'https://venue.example.invalid/hero.svg',
      'data:image/png;base64,AAAA',
    ]) {
      expect(
        extractVenueImageUrl(
          page(`<meta property="og:image" content="${bad}">`),
          BASE,
        ),
      ).toBeNull();
    }
  });

  it('skips an unusable first candidate and uses the next usable one', () => {
    expect(
      extractVenueImageUrl(
        page(
          '<meta property="og:image" content="https://venue.example.invalid/logo.png"><meta name="twitter:image" content="https://venue.example.invalid/crowd.jpg">',
        ),
        BASE,
      ),
    ).toBe('https://venue.example.invalid/crowd.jpg');
  });

  it('returns null for empty, malformed or image-less pages', () => {
    expect(extractVenueImageUrl('', BASE)).toBeNull();
    expect(extractVenueImageUrl(page('<title>x</title>'), BASE)).toBeNull();
    expect(
      extractVenueImageUrl(page('<meta property="og:image" content="">'), BASE),
    ).toBeNull();
  });
});
