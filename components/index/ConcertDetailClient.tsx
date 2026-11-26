'use client';

import { SupportActsLine } from '@/components/index/SupportActsLine';
import { GenreBadge } from './GenreBadge';
import { eventGenreList } from '@/lib/genres/catalog-genres';
import React, {
  useState,
  useMemo,
  useRef,
  useLayoutEffect,
  useEffect,
} from 'react';
import type { VenueLink } from '@/lib/events/venue-link';
import Link from 'next/link';
import type { IndexEventItem } from './types';
import { toIndexEventItem } from './types';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';
import {
  formatIndexEventDate,
  formatFestivalRange,
  formatIndexPrice,
  getVerifiedAvailabilityBadge,
  hasRealMatchScore,
} from './formatters';
import { eventDistanceDetails } from '@/lib/location/radius';
import { AudioPreviewPlayer } from './AudioPreviewPlayer';
import { SpotifyArtistEmbed } from './SpotifyArtistEmbed';
import { EventCard } from './EventCard';
import { EventImage } from './EventImage';
import { UndoToast } from './UndoToast';
import { DecisionGuide } from './DecisionGuide';
import { useWatchlist } from './useWatchlist';
import {
  ArrowLeftIcon,
  HeartIcon,
  BellIcon,
  CalendarIcon,
  MapPinIcon,
  TicketIcon,
  SparklesIcon,
  AlertCircleIcon,
  ArrowUpRightIcon,
  StarIcon,
  BanIcon,
  SlidersIcon,
} from './icons';

export interface ConcertDetailClientProps {
  event: CanonicalEventSummary | ScoredEvent | IndexEventItem;
  relatedEvents?: Array<CanonicalEventSummary | ScoredEvent | IndexEventItem>;
  /** Every day of this event's multi-day festival (empty when it is a single show). */
  festivalDays?: Array<{ id: string; name: string; localStartDate: string }>;
  /** Viewer's home coordinates (when configured); omit distance when null. */
  homeLocation?: { lat: number; lng: number } | null;
  /** Fallback destination for the ticket button when no ticket URL is known. */
  venueLink?: VenueLink | null;
  initialPreferences?: Array<{
    artistId: string;
    level: 'favorite' | 'like' | 'ignore';
  }>;
  onSetPreference?: (
    artistId: string,
    artistName: string,
    level: 'favorite' | 'like' | 'ignore',
  ) => void;
  onBack?: () => void;
  backHref?: string;
}

export function ConcertDetailClient({
  event: rawEvent,
  relatedEvents: rawRelated = [],
  festivalDays = [],
  homeLocation = null,
  venueLink = null,
  initialPreferences = [],
  onSetPreference,
  onBack,
  backHref = '/',
}: ConcertDetailClientProps) {
  const event = useMemo(() => toIndexEventItem(rawEvent), [rawEvent]);
  const relatedEvents = useMemo(
    () => rawRelated.map(toIndexEventItem),
    [rawRelated],
  );

  const { isSaved, hasAlert, toggleSave, toggleAlert, undoStack, undo } =
    useWatchlist();

  const [preferences, setPreferences] = useState(initialPreferences);
  // Breakdown is shown inline by default when it fits beside the action column;
  // an explicit toggle by the viewer always wins.
  const [breakdownToggled, setBreakdownToggled] = useState<boolean | null>(
    null,
  );
  const [breakdownFits, setBreakdownFits] = useState(true);
  const showFactorDrawer = breakdownToggled ?? breakdownFits;
  const infoColumnRef = useRef<HTMLDivElement>(null);
  const actionColumnRef = useRef<HTMLDivElement>(null);
  const breakdownRef = useRef<HTMLDivElement>(null);
  const breakdownHeightRef = useRef(0);

  const isPersonalized = hasRealMatchScore(event.personalScore);
  const score = event.personalScore?.score ?? 50;
  const isDisliked = Boolean(event.personalScore?.isDisliked);
  const isFavorite = Boolean(event.personalScore?.isFavorite);

  const statusBadge = getVerifiedAvailabilityBadge(
    event.inventoryStatus,
    event.ticketRemainingPercent,
  );
  const isSoldOut = event.inventoryStatus === 'sold_out';
  const isCancelled = event.inventoryStatus === 'cancelled';

  const headlinerName = event.headlinerName || event.title;
  const supportActs = (event.artists || []).filter(
    (a) => a.name !== headlinerName && a.billingPosition !== 'headliner',
  );

  const distanceDetails = homeLocation
    ? eventDistanceDetails(
        {
          lat: event.lat,
          lng: event.lng,
          city: event.city,
          region: event.region,
        },
        homeLocation,
      )
    : null;
  const distanceMiles =
    distanceDetails != null
      ? Math.round(distanceDetails.distanceMiles * 10) / 10
      : null;
  const isApproxDistance = distanceDetails?.precision === 'city_centroid';

  const factors = event.personalScore?.factors;
  const hasFactors = Boolean(factors);

  const useIsoLayoutEffect =
    typeof window === 'undefined' ? useEffect : useLayoutEffect;
  useIsoLayoutEffect(() => {
    const info = infoColumnRef.current;
    const action = actionColumnRef.current;
    if (!info || !action || !hasFactors) return;
    const measure = () => {
      const breakdown = breakdownRef.current;
      const visibleHeight = breakdown?.offsetHeight ?? 0;
      if (visibleHeight > 0) breakdownHeightRef.current = visibleHeight;
      // Columns stacked (narrow screens): no empty space beside the actions.
      const sideBySide = action.offsetLeft > info.offsetLeft;
      const infoWithout = info.offsetHeight - visibleHeight;
      setBreakdownFits(
        sideBySide &&
          infoWithout + breakdownHeightRef.current <= action.offsetHeight + 8,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(info);
    observer.observe(action);
    return () => observer.disconnect();
  }, [hasFactors]);

  const handlePreferenceChange = (
    artistId: string,
    artistName: string,
    level: 'favorite' | 'like' | 'ignore',
  ) => {
    setPreferences((prev) => {
      const filtered = prev.filter((p) => p.artistId !== artistId);
      const existing = prev.find((p) => p.artistId === artistId);
      if (existing?.level === level) {
        return filtered; // Toggle off if clicked again
      }
      return [...filtered, { artistId, level }];
    });
    onSetPreference?.(artistId, artistName, level);
  };

  const mapSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${event.venueName || ''} ${event.city || ''} ${event.region || ''}`,
  )}`;

  return (
    <div className="space-y-8 pb-16">
      {/* Top Breadcrumb Bar */}
      <div className="flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            <span>Back to Concerts</span>
          </button>
        ) : (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            <span>Back to Concerts</span>
          </Link>
        )}

        <div className="flex items-center gap-2"></div>
      </div>

      {/* Hero Decision Header Card */}
      <section className="shadow-xs relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-white p-6 sm:p-10">
        {/* Top Artwork Gradient Glow */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 h-2"
          style={{
            background: `linear-gradient(90deg, ${event.posterColor} 0%, ${event.posterSecondaryColor} 100%)`,
          }}
        />

        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div
            ref={infoColumnRef}
            className="min-w-0 max-w-3xl flex-1 space-y-4"
          >
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2">
              {statusBadge && (
                <span
                  className={`rounded-md border px-2.5 py-0.5 text-xs font-medium ${statusBadge.bg}`}
                >
                  {statusBadge.label}
                </span>
              )}

              <GenreBadge
                genre={eventGenreList(event)}
                inferred={event.genresInferred}
              />

              {isPersonalized ? (
                isDisliked ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                    <AlertCircleIcon className="h-3.5 w-3.5" />
                    <span>Suppressed (Disliked Artist)</span>
                  </span>
                ) : isFavorite ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                    <SparklesIcon className="h-3.5 w-3.5 text-amber-600" />
                    <span>Favorite Artist · {score}% Match</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
                    <span>{score}% Personalized Match</span>
                  </span>
                )
              ) : null}
            </div>

            {/* Artist & Title */}
            <div>
              <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-4xl lg:text-5xl">
                {headlinerName}
              </h1>

              <SupportActsLine
                acts={supportActs}
                className="mt-1 text-base font-medium text-zinc-600"
              />

              {event.title && event.title !== headlinerName && (
                <p className="mt-1 text-sm italic text-zinc-500">
                  {event.title}
                </p>
              )}
            </div>

            {/* Practical Quick Facts Grid */}
            <div className="grid grid-cols-1 gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-3">
              <div className="flex items-center gap-2.5">
                <CalendarIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                <div>
                  <div className="text-sm font-semibold text-zinc-900">
                    {formatIndexEventDate(event)}
                  </div>
                  {event.timezone && (
                    <div className="font-mono text-[11px] text-zinc-400">
                      Timezone: {event.timezone}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <MapPinIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                <div>
                  <div className="text-sm font-semibold text-zinc-900">
                    {event.venueName || 'Venue TBA'}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {event.city ? `${event.city}` : ''}
                    {event.region ? `, ${event.region}` : ''}
                    {distanceMiles !== null &&
                      ` (${isApproxDistance ? 'approx. ' : ''}${distanceMiles} mi)`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <TicketIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                <div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
                    {formatIndexPrice(
                      event.minPrice,
                      event.maxPrice,
                      event.currency,
                      event.eventKind,
                      event.ticketUrl,
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Age policy: {event.ageRestriction || 'Not listed'}
                  </div>
                </div>
              </div>
            </div>

            {/* Personalized Factor Breakdown (inline when it fits) */}
            {factors && (
              <div
                ref={breakdownRef}
                data-testid="factor-breakdown"
                className={`border-t border-zinc-100 pt-5 ${
                  breakdownToggled === true
                    ? 'block'
                    : breakdownToggled === false || !breakdownFits
                      ? 'hidden'
                      : 'hidden lg:block'
                }`}
              >
                <FactorBreakdown
                  factors={factors}
                  score={score}
                  isSuppressed={isDisliked}
                />
              </div>
            )}
          </div>

          {/* Action Box: Direct Ticket Link + Save + Alert */}
          <div
            ref={actionColumnRef}
            className="flex shrink-0 flex-col gap-2.5 border-t border-zinc-100 pt-6 sm:w-72 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
          >
            <EventImage
              event={event}
              className="aspect-[4/3] w-full rounded-xl"
              width={576}
              height={432}
              graphicSize="lg"
              priority
            />
            {event.ticketUrl && !isCancelled ? (
              <a
                href={event.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shadow-xs inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition-transform duration-150 ease-out hover:bg-zinc-800 active:scale-[0.97]"
              >
                <span>{isSoldOut ? 'Ticket site' : 'Official Tickets'}</span>
                <ArrowUpRightIcon className="h-4 w-4" />
              </a>
            ) : isCancelled ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-100 p-3 text-center text-xs font-semibold text-zinc-500">
                Event Cancelled
              </div>
            ) : event.eventKind === 'free_event' ||
              (event.minPrice === 0 && event.maxPrice === 0) ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-xs font-semibold text-emerald-800">
                Free Admission · No Advance Ticket Required
              </div>
            ) : venueLink ? (
              <div className="space-y-1">
                <a
                  href={venueLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="venue-link-button"
                  className="shadow-xs inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition-transform duration-150 ease-out hover:bg-zinc-800 active:scale-[0.97]"
                >
                  <span>
                    {venueLink.kind === 'venue_search'
                      ? 'Find Venue Website'
                      : 'Tickets on Venue Site'}
                  </span>
                  <ArrowUpRightIcon className="h-4 w-4" />
                </a>
                <p className="text-center text-[11px] text-zinc-500">
                  {venueLink.kind === 'event_page'
                    ? 'No direct ticket link · opens the venue listing'
                    : venueLink.kind === 'venue_website'
                      ? 'No direct ticket link · opens the venue website'
                      : 'No ticket link or venue website on file'}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-center text-xs font-semibold text-zinc-600">
                Ticket Link Unavailable · Check Venue Door
              </div>
            )}

            <button
              type="button"
              onClick={() => toggleSave(event.id, headlinerName)}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-all duration-150 ease-out active:scale-[0.97] ${
                isSaved(event.id)
                  ? 'shadow-2xs border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <HeartIcon className="h-4 w-4" filled={isSaved(event.id)} />
              <span>
                {isSaved(event.id) ? 'Saved to Watchlist' : 'Add to Watchlist'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => toggleAlert(event.id, headlinerName)}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-all duration-150 ease-out active:scale-[0.97] ${
                hasAlert(event.id)
                  ? 'shadow-2xs border-violet-200 bg-violet-50 text-violet-700'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <BellIcon className="h-4 w-4" filled={hasAlert(event.id)} />
              <span>
                {hasAlert(event.id)
                  ? 'Ticket Alerts Active'
                  : 'Enable Ticket Alerts'}
              </span>
            </button>

            {event.presaleDate && (
              <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-2.5 text-[11px] text-violet-800">
                <span className="font-semibold">Presale Window: </span>
                {new Date(event.presaleDate).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZoneName: 'short',
                })}
              </div>
            )}

            {/* Factor breakdown toggle button */}
            {factors && (
              <button
                type="button"
                aria-expanded={showFactorDrawer}
                onClick={() => setBreakdownToggled(!showFactorDrawer)}
                className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                <SlidersIcon className="h-3.5 w-3.5 text-zinc-500" />
                <span>
                  {showFactorDrawer
                    ? 'Hide Factor Breakdown'
                    : 'View Factor Breakdown'}
                </span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Main 2-Column Section: Decision Guide (Why vs Considerations) + Lineup/Player */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left 2 Columns: Decision Guide & Lineup */}
        <div className="space-y-6 lg:col-span-2">
          <DecisionGuide event={event} />

          {festivalDays.length > 1 && (
            <div
              data-testid="festival-days"
              className="shadow-xs space-y-3 rounded-3xl border border-zinc-200/90 bg-white p-6"
            >
              <h2 className="text-base font-bold text-zinc-900">
                Festival days
              </h2>
              <ul className="flex flex-wrap gap-2">
                {(() => {
                  const dateCounts = new Map<string, number>();
                  for (const d of festivalDays) {
                    dateCounts.set(
                      d.localStartDate,
                      (dateCounts.get(d.localStartDate) ?? 0) + 1,
                    );
                  }
                  const seenByDate = new Map<string, number>();
                  return festivalDays.map((d) => {
                    const label = formatFestivalRange(
                      d.localStartDate,
                      d.localStartDate,
                    );
                    const hasDuplicateDate =
                      (dateCounts.get(d.localStartDate) ?? 0) > 1;
                    const idx = (seenByDate.get(d.localStartDate) ?? 0) + 1;
                    seenByDate.set(d.localStartDate, idx);
                    return (
                      <li key={d.id}>
                        <Link
                          href={`/concerts/${d.id}`}
                          aria-current={d.id === event.id ? 'page' : undefined}
                          title={d.name}
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            d.id === event.id
                              ? 'border-zinc-900 bg-zinc-900 text-white'
                              : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
                          }`}
                        >
                          {hasDuplicateDate ? `${label} (${idx})` : label}
                        </Link>
                      </li>
                    );
                  });
                })()}
              </ul>
            </div>
          )}

          {/* Lineup & Billing Details with Preference Modifiers */}
          <div className="shadow-xs space-y-4 rounded-3xl border border-zinc-200/90 bg-white p-6">
            <h2 className="text-base font-bold text-zinc-900">
              Lineup & Billing Details
            </h2>
            <p className="text-xs text-zinc-500">
              Manage your artist affinity. Favoriting a headliner ensures high
              priority; ignoring a headliner hides the show from your
              recommendations.
            </p>

            <div className="space-y-3 pt-2">
              {event.artists.map((artist) => {
                const artistId = artist.id || artist.name;
                const currentPref = preferences.find(
                  (p) => p.artistId === artistId,
                );
                return (
                  <div
                    key={artistId}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-zinc-100 bg-zinc-50/60 p-4 sm:flex-row sm:items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900">
                          {artist.name}
                        </span>
                        <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                          {artist.billingPosition}
                        </span>
                        {currentPref && (
                          <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                            {currentPref.level}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {artist.billingPosition === 'headliner'
                          ? 'Primary performer / headliner'
                          : artist.billingPosition === 'support'
                            ? 'Touring support act'
                            : 'Lineup performer'}
                      </p>
                    </div>

                    {/* Quick Preference Buttons */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handlePreferenceChange(
                            artistId,
                            artist.name,
                            'favorite',
                          )
                        }
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                          currentPref?.level === 'favorite'
                            ? 'border-amber-300 bg-amber-50 text-amber-800'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                        }`}
                      >
                        <StarIcon
                          className="h-3 w-3"
                          filled={currentPref?.level === 'favorite'}
                        />
                        <span>Favorite</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handlePreferenceChange(artistId, artist.name, 'like')
                        }
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                          currentPref?.level === 'like'
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                        }`}
                      >
                        <HeartIcon
                          className="h-3 w-3"
                          filled={currentPref?.level === 'like'}
                        />
                        <span>Like</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handlePreferenceChange(
                            artistId,
                            artist.name,
                            'ignore',
                          )
                        }
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                          currentPref?.level === 'ignore'
                            ? 'border-rose-300 bg-rose-50 text-rose-800'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                        }`}
                      >
                        <BanIcon className="h-3 w-3" />
                        <span>Ignore</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Audio Player & Venue Profile */}
        <div className="space-y-6">
          {/* Audio: legacy track preview if supplied, otherwise a Spotify listen for the headliner */}
          {event.spotifyPreviewTrack ? (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Audio Sample
              </h2>
              <AudioPreviewPlayer
                track={event.spotifyPreviewTrack}
                artistName={headlinerName}
                posterColor={event.posterColor}
              />
            </div>
          ) : (
            <SpotifyArtistEmbed
              spotifyArtistId={
                (
                  event.artists.find((a) => a.name === headlinerName) ??
                  event.artists[0]
                )?.spotifyArtistId
              }
              artistName={headlinerName}
            />
          )}

          {/* Venue & Logistics Profile */}
          <div className="shadow-xs space-y-4 rounded-3xl border border-zinc-200/90 bg-white p-6">
            <h2 className="text-base font-bold text-zinc-900">
              Venue & Logistics
            </h2>

            <div className="space-y-3 text-xs text-zinc-600">
              <div>
                <span className="font-semibold text-zinc-800">Venue: </span>
                <span>{event.venueName || 'Venue TBA'}</span>
              </div>

              <div>
                <span className="font-semibold text-zinc-800">Location: </span>
                <span>
                  {event.city ? event.city : ''}
                  {event.region ? `, ${event.region}` : ''}
                </span>
              </div>

              {event.lat != null && event.lng != null && (
                <div>
                  <span className="font-semibold text-zinc-800">
                    Coordinates:{' '}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {event.lat.toFixed(4)}, {event.lng.toFixed(4)}
                  </span>
                </div>
              )}

              <div className="pt-1">
                <a
                  href={mapSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-zinc-700 hover:text-zinc-900 hover:underline"
                >
                  <MapPinIcon className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Open in Google Maps ↗</span>
                </a>
              </div>

              {event.vibeTags && event.vibeTags.length > 0 && (
                <div className="pt-2">
                  <span className="font-semibold text-zinc-800">
                    Vibe & Atmosphere:{' '}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {event.vibeTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Related Concerts */}
      {relatedEvents.length > 0 && (
        <section className="space-y-4 border-t border-zinc-200 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-zinc-900">
              Similar Upcoming Concerts
            </h2>
            <Link
              href={backHref}
              className="text-xs font-semibold text-zinc-900 hover:underline"
            >
              Browse All →
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {relatedEvents.slice(0, 3).map((rel) => (
              <EventCard
                key={rel.id}
                event={rel}
                isSaved={isSaved(rel.id)}
                hasAlert={hasAlert(rel.id)}
                onToggleSave={toggleSave}
                onToggleAlert={toggleAlert}
              />
            ))}
          </div>
        </section>
      )}

      {/* Undo Toast */}
      <UndoToast undoStack={undoStack} onUndo={undo} />
    </div>
  );
}

const FACTOR_ORDER = ['artist', 'distance', 'price'] as const;
const FACTOR_LABELS: Record<(typeof FACTOR_ORDER)[number], string> = {
  artist: 'Artist Fit',
  distance: 'Distance Fit',
  price: 'Price Fit',
};

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Shows each factor's score, its weight, and how they add up to the match %. */
function FactorBreakdown({
  factors,
  score,
  isSuppressed,
}: {
  factors: NonNullable<IndexEventItem['personalScore']>['factors'];
  score: number;
  isSuppressed: boolean;
}) {
  const rows = FACTOR_ORDER.flatMap((key) => {
    const factor = factors?.[key];
    if (!factor) return [];
    const weight =
      typeof factor.weight === 'number' && Number.isFinite(factor.weight)
        ? factor.weight
        : null;
    // Same rounding as the scoring engine's weighted contribution.
    const points =
      weight === null ? null : Math.round((factor.score * weight) / 10) / 10;
    return [{ key, factor, weight, points }];
  });
  const hasWeights = rows.length > 0 && rows.every((r) => r.points !== null);

  return (
    <div>
      <h3 className="text-sm font-bold text-zinc-900">
        How the {formatPoints(score)}% match is calculated
      </h3>
      <p className="mt-0.5 text-xs text-zinc-500">
        {hasWeights
          ? 'Each factor is scored 0–100, multiplied by its weight from your scoring settings, then added up.'
          : 'Deterministic scoring factors across artist affinity, distance, and price.'}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rows.map(({ key, factor, weight, points }) => (
          <div
            key={key}
            className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-3.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-700">
                {FACTOR_LABELS[key]}
              </span>
              <span className="font-mono text-xs font-bold text-zinc-900">
                {factor.score}/100
              </span>
            </div>
            {weight !== null && points !== null && (
              <div className="mt-1 font-mono text-[11px] tabular-nums text-zinc-600">
                × {weight}% weight = {formatPoints(points)} pts
              </div>
            )}
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              {factor.explanation}
            </p>
          </div>
        ))}
      </div>

      {hasWeights && (
        <p className="mt-3 font-mono text-[11px] tabular-nums text-zinc-600">
          {rows.map((r) => formatPoints(r.points ?? 0)).join(' + ')} ={' '}
          <span className="font-bold text-zinc-900">
            {isSuppressed
              ? '0 (suppressed: disliked artist)'
              : `${formatPoints(score)}%`}
          </span>
        </p>
      )}
    </div>
  );
}
