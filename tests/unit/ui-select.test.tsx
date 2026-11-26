// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '@/components/ui/Select';

function Harness({
  onChange,
  initial = '',
}: {
  onChange: (v: string) => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Select
      aria-label="City"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      options={[
        { value: '', label: 'All cities' },
        {
          label: 'Colorado',
          options: [
            { value: 'Denver', label: 'Denver' },
            { value: 'Boulder', label: 'Boulder', disabled: true },
          ],
        },
      ]}
    />
  );
}

async function openAndPick(trigger: HTMLElement, name: string) {
  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name }));
}

describe('Select', () => {
  it('is a labelled combobox showing the current option, including an empty "all" value', () => {
    render(<Harness onChange={() => {}} />);
    const trigger = screen.getByRole('combobox', { name: 'City' });
    expect(trigger).toHaveTextContent('All cities');
  });

  it('lists grouped options and reports the chosen value', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'City' });
    await openAndPick(trigger, 'Denver');
    expect(onChange).toHaveBeenCalledWith('Denver');
    expect(trigger).toHaveTextContent('Denver');
  });

  it('maps the "all" option back to an empty string', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="Denver" />);
    await openAndPick(
      screen.getByRole('combobox', { name: 'City' }),
      'All cities',
    );
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('does not select a disabled option', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    const boulder = await screen.findByRole('option', { name: 'Boulder' });
    expect(boulder).toHaveAttribute('aria-disabled', 'true');
    await user.click(boulder);
    expect(onChange).not.toHaveBeenCalled();
  });
});
