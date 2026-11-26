// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GuestGate } from '@/components/auth/GuestGate';
import { ViewerProvider } from '@/components/auth/ViewerContext';

function renderGate(isAuthenticated: boolean, onClick = vi.fn()) {
  render(
    <ViewerProvider isAuthenticated={isAuthenticated}>
      <GuestGate message="Sign in to save your choice">
        <button type="button" onClick={onClick}>
          Favorite
        </button>
      </GuestGate>
    </ViewerProvider>,
  );
  return onClick;
}

describe('GuestGate', () => {
  it('renders the control untouched for a signed-in viewer', () => {
    const onClick = renderGate(true);
    expect(screen.queryByTestId('guest-gate')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('greys out the control for a visitor and explains why', () => {
    const onClick = renderGate(false);
    const gate = screen.getByTestId('guest-gate');
    expect(gate.getAttribute('aria-disabled')).toBe('true');
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(tip.textContent).toContain('Sign in to save your choice');
    expect(gate.getAttribute('aria-describedby')).toBe(tip.id);
    // The real control is inert: clicks never reach it.
    expect(gate.querySelector('[inert]')).not.toBeNull();
    fireEvent.click(gate);
    expect(onClick).not.toHaveBeenCalled();
    // Tapping/clicking opens the pop-out (for touch screens without hover).
    expect(tip.className).toContain('visible opacity-100');
  });

  it('keyboard: Enter opens the pop-out, Escape closes it', () => {
    renderGate(false);
    const gate = screen.getByTestId('guest-gate');
    const tip = screen.getByRole('tooltip', { hidden: true });
    fireEvent.keyDown(gate, { key: 'Enter' });
    expect(tip.className).toContain('visible opacity-100');
    fireEvent.keyDown(gate, { key: 'Escape' });
    expect(tip.className).toContain('invisible');
  });
});
