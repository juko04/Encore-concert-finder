import { describe, expect, it } from 'vitest';
import { isValidHttpUrl } from '@/lib/utils/url';
import { isValidHttpUrl as reExportedFromPersonalized } from '@/components/discover/PersonalizedEventCard';

describe('isValidHttpUrl utility', () => {
  it('accepts valid HTTP and HTTPS URLs', () => {
    expect(isValidHttpUrl('http://example.com')).toBe(true);
    expect(isValidHttpUrl('https://example.com/tickets?id=123')).toBe(true);
    expect(isValidHttpUrl('  https://tickets.redrocksonline.com  ')).toBe(true);
  });

  it('rejects non-HTTP protocols, javascript URLs, and malformed inputs', () => {
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isValidHttpUrl('ftp://example.com/file')).toBe(false);
    expect(isValidHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isValidHttpUrl('//example.com/path')).toBe(false);
    expect(isValidHttpUrl('/relative/path')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
    expect(isValidHttpUrl('   ')).toBe(false);
    expect(isValidHttpUrl(null)).toBe(false);
    expect(isValidHttpUrl(undefined)).toBe(false);
  });

  it('preserves backwards compatibility via re-export from PersonalizedEventCard', () => {
    expect(reExportedFromPersonalized('https://example.com')).toBe(true);
    expect(reExportedFromPersonalized('javascript:alert(1)')).toBe(false);
  });
});
