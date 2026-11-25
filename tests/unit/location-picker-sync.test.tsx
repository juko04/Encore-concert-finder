// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const COOKIE = 'encore_home_city';
vi.mock('@/lib/location/actions', () => ({
  // Mirrors the real server action: it sets the home-city cookie before resolving.
  saveHomeLocationAction: vi.fn(
    async (input: { kind: string; slug?: string }) => {
      document.cookie = `${COOKIE}=city:${input.slug}; path=/`;
      return { ok: true, label: 'x', savedToProfile: true };
    },
  ),
  clearHomeLocationAction: vi.fn(async () => {
    document.cookie = `${COOKIE}=; path=/; max-age=0`;
    return { ok: true };
  }),
}));

import { LocationPicker } from '@/components/location/LocationPicker';

function pickerButtons() {
  return screen
    .getAllByTestId('location-picker')
    .map((c) => c.querySelector('button') as HTMLButtonElement);
}

describe('LocationPicker instances stay in sync', () => {
  beforeEach(() => {
    document.cookie = `${COOKIE}=city:boulder-co; path=/`;
    refresh.mockClear();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    cleanup();
    document.cookie = `${COOKIE}=; path=/; max-age=0`;
    vi.unstubAllGlobals();
  });

  it('changing the city in one picker updates the other (header pill vs in-page picker)', async () => {
    render(
      <div>
        <LocationPicker />
        <LocationPicker variant="mobile" />
      </div>,
    );

    // Both start from the saved cookie.
    expect(pickerButtons().map((b) => b.textContent)).toEqual([
      expect.stringContaining('Near: Boulder'),
      expect.stringContaining('Near: Boulder'),
    ]);

    // Open the second picker and choose Denver.
    await act(async () => {
      fireEvent.click(pickerButtons()[1]);
    });
    const denver = (await screen.findAllByText('Denver'))[0];
    await act(async () => {
      fireEvent.click(denver);
    });

    const labels = pickerButtons().map((b) => b.textContent);
    expect(labels[0]).toContain('Near: Denver');
    expect(labels[1]).toContain('Near: Denver');
    expect(refresh).toHaveBeenCalled();
  });

  it('a change made elsewhere (cookie updated, then window focus) is picked up', async () => {
    render(<LocationPicker />);
    expect(pickerButtons()[0].textContent).toContain('Near: Boulder');

    document.cookie = `${COOKIE}=city:denver-co; path=/`;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(pickerButtons()[0].textContent).toContain('Near: Denver');
  });

  it('clearing the location in one picker clears the other', async () => {
    render(
      <div>
        <LocationPicker />
        <LocationPicker variant="mobile" />
      </div>,
    );
    await act(async () => {
      fireEvent.click(pickerButtons()[0]);
    });
    const clear = await screen.findByText(/clear|remove|reset/i);
    await act(async () => {
      fireEvent.click(clear);
    });
    for (const b of pickerButtons()) {
      expect(b.textContent).toMatch(/Set your city/);
    }
  });
});
