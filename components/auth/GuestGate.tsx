'use client';

import React, { useId, useState } from 'react';
import { useViewer } from './ViewerContext';

export interface GuestGateProps {
  children: React.ReactNode;
  /** Short reason shown in the pop-out, e.g. "Sign in to save your choice". */
  message?: string;
  /** Which side of the control the pop-out opens on. */
  placement?: 'top' | 'bottom';
  /** Horizontal alignment of the pop-out relative to the control. */
  align?: 'center' | 'start' | 'end';
  className?: string;
}

/**
 * Wraps a control that only works for signed-in users. For a signed-in viewer it renders the
 * control unchanged. For a visitor it greys the control out and makes it inert; hovering,
 * focusing or tapping it opens a small pop-out explaining that signing in saves the choice, with
 * a sign-in button that returns to the current page.
 */
export function GuestGate({
  children,
  message = 'Sign in to save your choice',
  placement = 'top',
  align = 'center',
  className = '',
}: GuestGateProps) {
  const { isAuthenticated } = useViewer();
  const [open, setOpen] = useState(false);
  const tipId = useId();

  if (isAuthenticated) return <>{children}</>;

  const signIn = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Come back to exactly this page (path + filters) after signing in.
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?redirectTo=${encodeURIComponent(here)}`);
  };

  const side = placement === 'top' ? 'bottom-full pb-2' : 'top-full pt-2';
  const alignClass =
    align === 'start'
      ? 'left-0'
      : align === 'end'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <span
      data-testid="guest-gate"
      role="button"
      tabIndex={0}
      aria-disabled="true"
      aria-describedby={tipId}
      className={`group/gate relative inline-flex cursor-not-allowed outline-none ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(true);
        } else if (e.key === 'Escape') {
          setOpen(false);
        }
      }}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <span
        inert
        className="pointer-events-none inline-flex w-full opacity-45 grayscale"
      >
        {children}
      </span>
      <span
        id={tipId}
        role="tooltip"
        className={`absolute z-50 ${side} ${alignClass} w-max max-w-[15rem] cursor-default transition-opacity duration-100 ${
          open
            ? 'visible opacity-100'
            : 'invisible opacity-0 group-hover/gate:visible group-hover/gate:opacity-100 group-focus-visible/gate:visible group-focus-visible/gate:opacity-100'
        }`}
      >
        <span className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-left text-xs font-medium normal-case tracking-normal text-white shadow-lg">
          <span>{message}</span>
          <button
            type="button"
            onClick={signIn}
            className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-900 hover:bg-zinc-100"
          >
            Sign in
          </button>
        </span>
      </span>
    </span>
  );
}
