'use client';

import React from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Flat options, or groups rendered with a heading each (e.g. venues by city). */
  options: Array<SelectOption | SelectGroup>;
  /** Accessible name when there is no visible <Select.Label>. */
  'aria-label'?: string;
  id?: string;
  /** Extra classes for the trigger (width, size). */
  className?: string;
  size?: 'sm' | 'md';
  /** Stretch to the container (filters) or size to the label (inline controls). */
  fullWidth?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
}

// Base UI treats an empty value as "nothing selected", but several filters use '' for "all".
const EMPTY = '__encore_empty__';
const toInternal = (v: string) => (v === '' ? EMPTY : v);
const fromInternal = (v: string) => (v === EMPTY ? '' : v);

function isGroup(option: SelectOption | SelectGroup): option is SelectGroup {
  return 'options' in option;
}

/**
 * Encore's dropdown: looks like the rest of the site (white card, zinc borders, small type)
 * instead of the operating system menu, but keeps native behaviour through Base UI — keyboard
 * navigation, type-to-select, Escape to close, focus return, screen-reader semantics, and
 * scroll locking while open.
 *
 * Motion: the menu scales out of the trigger (transform-origin from Base UI) with a strong
 * ease-out at 150ms, and fades only when the viewer prefers reduced motion.
 */
export function Select({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
  id,
  className = '',
  size = 'sm',
  fullWidth = true,
  disabled = false,
  'data-testid': testId,
}: SelectProps) {
  const flat = options.flatMap((o) => (isGroup(o) ? o.options : [o]));
  const items = flat.map((o) => ({
    value: toInternal(o.value),
    label: o.label,
  }));

  const renderItem = (option: SelectOption) => (
    <BaseSelect.Item
      key={option.value}
      value={toInternal(option.value)}
      disabled={option.disabled}
      className="grid cursor-default select-none grid-cols-[1rem_1fr] items-center gap-2 rounded-md py-1.5 pl-2 pr-3 text-xs text-zinc-700 outline-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-zinc-100 data-[selected]:font-semibold data-[highlighted]:text-zinc-900 data-[selected]:text-zinc-900 data-[disabled]:opacity-45"
    >
      <BaseSelect.ItemIndicator className="col-start-1 text-zinc-900">
        <CheckIcon />
      </BaseSelect.ItemIndicator>
      <BaseSelect.ItemText className="col-start-2 truncate">
        {option.label}
      </BaseSelect.ItemText>
    </BaseSelect.Item>
  );

  return (
    <BaseSelect.Root
      items={items}
      value={toInternal(value)}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(fromInternal(next));
      }}
    >
      <BaseSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        data-testid={testId}
        className={`flex ${fullWidth ? 'w-full' : 'w-auto'} min-w-0 items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white text-left text-zinc-800 outline-none transition-[border-color,background-color,transform] duration-150 ease-out-strong hover:border-zinc-300 focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/10 active:scale-[0.99] data-[disabled]:cursor-not-allowed data-[popup-open]:border-zinc-900 data-[disabled]:opacity-50 ${
          size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'
        } ${className}`}
      >
        <BaseSelect.Value className="truncate" />
        <BaseSelect.Icon className="shrink-0 text-zinc-400">
          <ChevronIcon />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          alignItemWithTrigger={false}
          sideOffset={6}
          className="z-[60] outline-none"
        >
          <BaseSelect.Popup className="min-w-[var(--anchor-width)] max-w-[min(20rem,calc(100vw-2rem))] origin-[var(--transform-origin)] rounded-xl border border-zinc-200 bg-white p-1 shadow-[0_8px_30px_rgba(0,0,0,0.08)] outline-none transition-[transform,opacity] duration-150 ease-out-strong data-[ending-style]:scale-[0.97] data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
            <BaseSelect.List className="max-h-[min(22rem,var(--available-height))] overflow-y-auto overscroll-contain">
              {options.map((option) =>
                isGroup(option) ? (
                  <BaseSelect.Group key={`group:${option.label}`}>
                    <BaseSelect.GroupLabel className="sticky top-0 z-[1] bg-white px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      {option.label}
                    </BaseSelect.GroupLabel>
                    {option.options.map(renderItem)}
                  </BaseSelect.Group>
                ) : (
                  renderItem(option)
                ),
              )}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m3 8.5 3.5 3.5L13 4.5" />
    </svg>
  );
}
