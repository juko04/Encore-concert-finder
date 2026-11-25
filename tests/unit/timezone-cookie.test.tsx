// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TimezoneCookie } from '@/components/location/TimezoneCookie';
import {
  TIMEZONE_COOKIE,
  readTimeZoneFromCookieString,
} from '@/lib/location/timezone';

/** Makes the browser report `tz` without touching Intl's validation of zone names. */
function browserZoneIs(tz: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(
    function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: tz };
    },
  );
}

describe('TimezoneCookie', () => {
  beforeEach(() => {
    document.cookie = `${TIMEZONE_COOKIE}=; Max-Age=0; Path=/`;
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing (no hydration output)', () => {
    const { container } = render(<TimezoneCookie />);
    expect(container.innerHTML).toBe('');
  });

  it('writes the encore_tz cookie when it is missing', () => {
    browserZoneIs('Europe/London');
    render(<TimezoneCookie />);
    expect(readTimeZoneFromCookieString(document.cookie)).toBe('Europe/London');
  });

  it('does not rewrite the cookie when it already matches', () => {
    browserZoneIs('Europe/London');
    document.cookie = `${TIMEZONE_COOKIE}=${encodeURIComponent('Europe/London')}; Path=/`;
    const setter = vi.spyOn(document, 'cookie', 'set');
    render(<TimezoneCookie />);
    expect(setter).not.toHaveBeenCalled();
  });

  it('updates the cookie once when it differs from the browser zone', () => {
    browserZoneIs('America/New_York');
    document.cookie = `${TIMEZONE_COOKIE}=Pacific/Honolulu; Path=/`;
    const setter = vi.spyOn(document, 'cookie', 'set');
    render(<TimezoneCookie />);
    expect(setter).toHaveBeenCalledTimes(1);
    expect(readTimeZoneFromCookieString(document.cookie)).toBe(
      'America/New_York',
    );
  });

  it('survives an unusable browser timezone without throwing or writing', () => {
    browserZoneIs('Not/AZone');
    const setter = vi.spyOn(document, 'cookie', 'set');
    expect(() => render(<TimezoneCookie />)).not.toThrow();
    expect(setter).not.toHaveBeenCalled();
  });
});
