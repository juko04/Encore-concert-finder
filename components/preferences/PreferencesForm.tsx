'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LocationPicker } from '@/components/location/LocationPicker';
import { savePreferencesAction } from '@/app/preferences/actions';
import {
  MAX_ARTIST_WEIGHT,
  MIN_ARTIST_WEIGHT,
  PRESET_WEIGHTS,
  applyArtistWeight,
} from '@/lib/recommendation/presets';
import {
  MAX_RADIUS_MILES,
  MIN_RADIUS_MILES,
  type PreferencesInput,
} from '@/lib/preferences/validate';
import type { ScoringPreset } from '@/lib/recommendation/types';

export interface InitialPreferences {
  defaultRadiusMiles: number;
  maxNormalTicketPrice: number | null;
  maxFavoriteArtistPrice: number | null;
  maxSpontaneousPrice: number | null;
  recommendationPreset: ScoringPreset;
  artistWeight: number | null;
}

interface PreferencesFormProps {
  initial: InitialPreferences;
  /** Label of the saved home location (e.g. "Denver"), or null when none is chosen. */
  homeLabel: string | null;
}

const RADIUS_QUICK_PICKS = [10, 25, 50, 100, 250];

const PRESETS: Array<{ id: ScoringPreset; title: string; blurb: string }> = [
  {
    id: 'balanced',
    title: 'Balanced',
    blurb: 'Artists matter most, with distance and price as tiebreakers.',
  },
  {
    id: 'artist_first',
    title: 'Artist first',
    blurb: 'Chase the artists you love, even if it costs more or is farther.',
  },
  {
    id: 'nearby',
    title: 'Nearby',
    blurb: 'Favor shows close to home, even from lesser-known artists.',
  },
  {
    id: 'value',
    title: 'Best value',
    blurb: 'Favor affordable tickets; price weighs as much as taste.',
  },
];

function priceToField(value: number | null): string {
  return value === null ? '' : String(value);
}

function WeightBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-16 font-medium text-zinc-600">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-9 text-right font-mono font-semibold text-zinc-800">
        {value}%
      </span>
    </div>
  );
}

function PriceField({
  id,
  label,
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-zinc-900">
        {label}
      </label>
      <p className="mt-0.5 text-xs text-zinc-500">{help}</p>
      <div className="relative mt-2">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400">
          $
        </span>
        <input
          id={id}
          data-testid={id}
          type="number"
          inputMode="decimal"
          min={1}
          max={1000}
          step={1}
          placeholder="No limit"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-7 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
        />
      </div>
    </div>
  );
}

export function PreferencesForm({ initial, homeLabel }: PreferencesFormProps) {
  const router = useRouter();
  const [radius, setRadius] = useState<string>(
    String(initial.defaultRadiusMiles),
  );
  const [normal, setNormal] = useState(
    priceToField(initial.maxNormalTicketPrice),
  );
  const [favorite, setFavorite] = useState(
    priceToField(initial.maxFavoriteArtistPrice),
  );
  const [spontaneous, setSpontaneous] = useState(
    priceToField(initial.maxSpontaneousPrice),
  );
  const [preset, setPreset] = useState<ScoringPreset>(
    initial.recommendationPreset,
  );
  const [customWeight, setCustomWeight] = useState<boolean>(
    initial.artistWeight !== null,
  );
  const [artistWeight, setArtistWeight] = useState<number>(
    initial.artistWeight ?? PRESET_WEIGHTS[initial.recommendationPreset].artist,
  );
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const effectiveWeights = applyArtistWeight(
    PRESET_WEIGHTS[preset],
    customWeight ? artistWeight : null,
  );

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const payload: PreferencesInput = {
      defaultRadiusMiles: Number(radius),
      maxNormalTicketPrice: normal === '' ? null : Number(normal),
      maxFavoriteArtistPrice: favorite === '' ? null : Number(favorite),
      maxSpontaneousPrice: spontaneous === '' ? null : Number(spontaneous),
      recommendationPreset: preset,
      artistWeight: customWeight ? artistWeight : null,
    };
    startTransition(async () => {
      const res = await savePreferencesAction(payload);
      if (res.ok) {
        setMessage({
          type: 'success',
          text: 'Saved. Your Picked for you row, Search shortcuts and Discover now use these settings.',
        });
        router.refresh();
      } else {
        setMessage({ type: 'error', text: res.error });
      }
    });
  }

  return (
    <form
      onSubmit={handleSave}
      data-testid="preferences-form"
      className="space-y-6"
    >
      {/* Location & radius */}
      <section className="shadow-xs space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <div>
          <h2 className="text-base font-bold text-zinc-900">
            Location &amp; travel radius
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            How far you will go for a show. Distances are measured from your
            home city and are approximate (city center to city center).
          </p>
        </div>

        <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Home city
          </p>
          <p
            data-testid="preferences-home-label"
            className="mt-0.5 text-sm font-semibold text-zinc-900"
          >
            {homeLabel ?? 'Not set yet'}
          </p>
          <div className="mt-3">
            <LocationPicker variant="mobile" />
          </div>
        </div>

        <div>
          <label
            htmlFor="pref-radius"
            className="text-sm font-semibold text-zinc-900"
          >
            Travel radius
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {RADIUS_QUICK_PICKS.map((miles) => (
              <button
                key={miles}
                type="button"
                onClick={() => setRadius(String(miles))}
                aria-pressed={radius === String(miles)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  radius === String(miles)
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                }`}
              >
                {miles} mi
              </button>
            ))}
            <div className="relative">
              <input
                id="pref-radius"
                data-testid="pref-radius"
                type="number"
                min={MIN_RADIUS_MILES}
                max={MAX_RADIUS_MILES}
                step={1}
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                className="w-28 rounded-xl border border-zinc-200 bg-white py-1.5 pl-3 pr-9 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-zinc-400">
                mi
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Used for the distance part of your ranking and the &ldquo;Within my
            radius&rdquo; shortcut on Search.
          </p>
        </div>
      </section>

      {/* Ticket budget */}
      <section className="shadow-xs space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Ticket budget</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Starting ticket price you are comfortable with. Leave a field blank
            for no limit. Many shows do not list a price yet; those are never
            treated as cheap or expensive.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <PriceField
            id="pref-price-normal"
            label="Typical show"
            help="Artists you like or are interested in."
            value={normal}
            onChange={setNormal}
          />
          <PriceField
            id="pref-price-favorite"
            label="Favorite artists"
            help="Usually higher: you will pay more to see them."
            value={favorite}
            onChange={setFavorite}
          />
          <PriceField
            id="pref-price-spontaneous"
            label="Discovery"
            help="Artists you have not marked, for spontaneous nights out."
            value={spontaneous}
            onChange={setSpontaneous}
          />
        </div>
      </section>

      {/* Ranking emphasis */}
      <section className="shadow-xs space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <div>
          <h2 className="text-base font-bold text-zinc-900">
            What matters most
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Controls how &ldquo;Picked for you&rdquo; ranks shows. Your explicit
            favorites and dislikes always win, whatever you choose here.
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Ranking style"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {PRESETS.map((p) => {
            const selected = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`pref-preset-${p.id}`}
                onClick={() => setPreset(p.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  selected
                    ? 'border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900'
                    : 'border-zinc-200 bg-white hover:border-zinc-300'
                }`}
              >
                <span className="text-sm font-semibold text-zinc-900">
                  {p.title}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {p.blurb}
                </span>
                <span className="mt-2 block font-mono text-[11px] text-zinc-400">
                  Artist {PRESET_WEIGHTS[p.id].artist} · Distance{' '}
                  {PRESET_WEIGHTS[p.id].distance} · Price{' '}
                  {PRESET_WEIGHTS[p.id].price}
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              data-testid="pref-custom-weight"
              checked={customWeight}
              onChange={(e) => setCustomWeight(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300"
            />
            <span>
              <span className="text-sm font-semibold text-zinc-900">
                Fine-tune how much artists matter
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Weight toward artists you love (move right) or toward price and
                distance (move left). The rest is split the way your ranking
                style splits it.
              </span>
            </span>
          </label>

          {customWeight && (
            <div className="mt-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>More price &amp; distance</span>
                <span>More artist fit</span>
              </div>
              <input
                type="range"
                data-testid="pref-artist-weight"
                aria-label="Artist importance"
                min={MIN_ARTIST_WEIGHT}
                max={MAX_ARTIST_WEIGHT}
                step={5}
                value={artistWeight}
                onChange={(e) => setArtistWeight(Number(e.target.value))}
                className="w-full accent-zinc-900"
              />
            </div>
          )}
        </div>

        <div
          data-testid="pref-weight-breakdown"
          className="space-y-2 rounded-xl border border-zinc-100 p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Your ranking recipe
          </p>
          <WeightBar
            label="Artist"
            value={effectiveWeights.artist}
            color="bg-indigo-500"
          />
          <WeightBar
            label="Distance"
            value={effectiveWeights.distance}
            color="bg-emerald-500"
          />
          <WeightBar
            label="Price"
            value={effectiveWeights.price}
            color="bg-amber-500"
          />
        </div>
      </section>

      {/* Save */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          data-testid="preferences-save"
          disabled={isPending}
          className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
        >
          {isPending ? 'Saving…' : 'Save preferences'}
        </button>
        {message && (
          <p
            role="status"
            data-testid="preferences-message"
            className={`text-xs font-medium ${
              message.type === 'success' ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
