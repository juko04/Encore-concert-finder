'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { IndexEventItem } from '@/components/index/types';
import { toIndexEventItem } from '@/components/index/types';
import { EventCard } from '@/components/index/EventCard';
import { useWatchlist } from '@/components/index/useWatchlist';
import {
  CalendarIcon,
  HeartIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from '@/components/index/icons';
import {
  downloadIcsFile,
  generateGoogleCalendarUrl,
} from '@/lib/utils/calendar-export';
import { formatIndexDate } from '@/components/index/formatters';

export interface CalendarClientProps {
  initialEvents: Array<CanonicalEventSummary | IndexEventItem>;
  isAuthenticated?: boolean;
  referenceDate?: string; // YYYY-MM-DD
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarClient({
  initialEvents,
  isAuthenticated = false,
  referenceDate,
}: CalendarClientProps) {
  const events = useMemo(
    () => initialEvents.map(toIndexEventItem),
    [initialEvents],
  );
  const { savedIds } = useWatchlist();

  // Initial date anchor: referenceDate or first event date or current date
  const initialDate = useMemo(() => {
    if (referenceDate) {
      return new Date(`${referenceDate}T12:00:00Z`);
    }
    if (events.length > 0 && events[0].localStartDate) {
      return new Date(`${events[0].localStartDate}T12:00:00Z`);
    }
    return new Date();
  }, [referenceDate, events]);

  const [currentYear, setCurrentYear] = useState<number>(() =>
    initialDate.getUTCFullYear(),
  );
  const [currentMonth, setCurrentMonth] = useState<number>(() =>
    initialDate.getUTCMonth(),
  ); // 0-indexed
  const [selectedDateStr, setSelectedDateStr] = useState<string>(() => {
    if (referenceDate) return referenceDate;
    if (events.length > 0 && events[0].localStartDate) {
      return events[0].localStartDate;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${initialDate.getUTCFullYear()}-${pad(initialDate.getUTCMonth() + 1)}-${pad(initialDate.getUTCDate())}`;
  });

  const [savedOnly, setSavedOnly] = useState(false);

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentYear(today.getUTCFullYear());
    setCurrentMonth(today.getUTCMonth());
    const pad = (n: number) => String(n).padStart(2, '0');
    setSelectedDateStr(
      `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`,
    );
  };

  // Group events by YYYY-MM-DD
  const eventsByDate = useMemo(() => {
    const map = new Map<string, IndexEventItem[]>();
    for (const event of events) {
      if (savedOnly && !savedIds.includes(event.id)) {
        continue;
      }
      const list = map.get(event.localStartDate) || [];
      list.push(event);
      map.set(event.localStartDate, list);
    }
    return map;
  }, [events, savedOnly, savedIds]);

  // Calendar matrix calculation for current month
  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(
      Date.UTC(currentYear, currentMonth, 1, 12, 0, 0),
    );
    const startWeekday = firstDayOfMonth.getUTCDay(); // 0 for Sunday
    const daysInMonth = new Date(
      Date.UTC(currentYear, currentMonth + 1, 0, 12, 0, 0),
    ).getUTCDate();

    const cells: Array<{
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      eventsOnDate: IndexEventItem[];
      hasSavedShow: boolean;
    }> = [];

    // Previous month padding
    const daysInPrevMonth = new Date(
      Date.UTC(currentYear, currentMonth, 0, 12, 0, 0),
    ).getUTCDate();
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    for (let i = startWeekday - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${prevYear}-${pad(prevMonth + 1)}-${pad(day)}`;
      const dayEvents = eventsByDate.get(dateStr) || [];
      cells.push({
        dateStr,
        dayNumber: day,
        isCurrentMonth: false,
        eventsOnDate: dayEvents,
        hasSavedShow: dayEvents.some((e) => savedIds.includes(e.id)),
      });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${currentYear}-${pad(currentMonth + 1)}-${pad(day)}`;
      const dayEvents = eventsByDate.get(dateStr) || [];
      cells.push({
        dateStr,
        dayNumber: day,
        isCurrentMonth: true,
        eventsOnDate: dayEvents,
        hasSavedShow: dayEvents.some((e) => savedIds.includes(e.id)),
      });
    }

    // Next month padding to fill a complete 35 or 42 grid
    const remaining = (7 - (cells.length % 7)) % 7;
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;

    for (let day = 1; day <= remaining; day++) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${nextYear}-${pad(nextMonth + 1)}-${pad(day)}`;
      const dayEvents = eventsByDate.get(dateStr) || [];
      cells.push({
        dateStr,
        dayNumber: day,
        isCurrentMonth: false,
        eventsOnDate: dayEvents,
        hasSavedShow: dayEvents.some((e) => savedIds.includes(e.id)),
      });
    }

    return cells;
  }, [currentYear, currentMonth, eventsByDate, savedIds]);

  const monthName = new Date(
    Date.UTC(currentYear, currentMonth, 1, 12, 0, 0),
  ).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // Selected date events
  const selectedDateEvents = useMemo(() => {
    return eventsByDate.get(selectedDateStr) || [];
  }, [eventsByDate, selectedDateStr]);

  const formattedSelectedDate = useMemo(() => {
    if (!selectedDateStr) return '';
    return formatIndexDate(selectedDateStr);
  }, [selectedDateStr]);

  return (
    <div className="space-y-8 pb-16">
      {/* Header & Controls */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-200/80 pb-6 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-zinc-900" />
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">
              Concert Calendar
            </h1>
          </div>
          <p className="mt-1 max-w-xl text-xs text-zinc-500 sm:text-sm">
            Explore upcoming concerts by date across Colorado venues and export
            shows to Apple or Google Calendar.
          </p>
        </div>

        {/* Filter & View Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {isAuthenticated && (
            <button
              type="button"
              onClick={() => setSavedOnly(!savedOnly)}
              aria-pressed={savedOnly}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
                savedOnly
                  ? 'shadow-xs border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <HeartIcon
                className="h-3.5 w-3.5 text-rose-500"
                filled={savedOnly}
              />
              <span>Saved Shows Only</span>
              {savedIds.length > 0 && (
                <span className="font-mono text-[10px] font-bold">
                  ({savedIds.length})
                </span>
              )}
            </button>
          )}

          <div className="shadow-2xs flex items-center rounded-xl border border-zinc-200 bg-white p-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Previous month"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
            <span className="min-w-[140px] text-center text-xs font-bold text-zinc-900">
              {monthName}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Next month"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100"
            >
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleToday}
            className="shadow-2xs rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Today
          </button>
        </div>
      </div>

      {/* Calendar Grid Container */}
      <div className="shadow-xs overflow-hidden rounded-2xl border border-zinc-200/90 bg-white">
        {/* Weekday Row */}
        <div className="grid grid-cols-7 border-b border-zinc-200/80 bg-zinc-50 text-center text-[11px] font-semibold text-zinc-500">
          {WEEKDAYS.map((day) => (
            <div key={day} className="py-2.5">
              {day}
            </div>
          ))}
        </div>

        {/* Date Grid */}
        <div className="grid grid-cols-7 divide-x divide-y divide-zinc-100">
          {calendarCells.map((cell) => {
            const isSelected = cell.dateStr === selectedDateStr;
            const hasEvents = cell.eventsOnDate.length > 0;

            return (
              <button
                key={cell.dateStr}
                type="button"
                onClick={() => setSelectedDateStr(cell.dateStr)}
                className={`focus:outline-hidden relative flex min-h-[72px] flex-col p-2 text-left transition-all duration-150 focus:z-10 sm:min-h-[96px] ${
                  !cell.isCurrentMonth
                    ? 'bg-zinc-50/50 text-zinc-400'
                    : 'bg-white text-zinc-800 hover:bg-zinc-50/80'
                } ${
                  isSelected
                    ? 'bg-zinc-50/90 ring-2 ring-inset ring-zinc-900'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`font-mono text-xs font-semibold ${
                      isSelected
                        ? 'flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[11px] text-white'
                        : ''
                    }`}
                  >
                    {cell.dayNumber}
                  </span>

                  {cell.hasSavedShow && (
                    <span title="You have saved concerts on this day">
                      <HeartIcon className="h-3 w-3 text-rose-500" filled />
                    </span>
                  )}
                </div>

                {/* Event Indicators */}
                {hasEvents && (
                  <div className="mt-1.5 space-y-1">
                    <span className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zinc-700">
                      {cell.eventsOnDate.length}{' '}
                      {cell.eventsOnDate.length === 1 ? 'show' : 'shows'}
                    </span>

                    {/* Preview artist titles on medium+ screens */}
                    <div className="hidden space-y-0.5 sm:block">
                      {cell.eventsOnDate.slice(0, 2).map((ev) => (
                        <p
                          key={ev.id}
                          className="truncate text-[10px] font-medium text-zinc-600 hover:text-zinc-900"
                        >
                          {ev.headlinerName}
                        </p>
                      ))}
                      {cell.eventsOnDate.length > 2 && (
                        <p className="text-[9px] text-zinc-400">
                          +{cell.eventsOnDate.length - 2} more
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Date Concert Details */}
      <section
        className="shadow-xs rounded-2xl border border-zinc-200/90 bg-white p-6"
        aria-labelledby="selected-date-heading"
      >
        <div className="mb-6 flex flex-col justify-between gap-3 border-b border-zinc-100 pb-4 sm:flex-row sm:items-center">
          <div>
            <h2
              id="selected-date-heading"
              className="text-xl font-bold tracking-tight text-zinc-900"
            >
              Concerts on {formattedSelectedDate}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {selectedDateEvents.length > 0
                ? `${selectedDateEvents.length} concert${selectedDateEvents.length > 1 ? 's' : ''} scheduled`
                : 'No concerts scheduled for this date.'}
            </p>
          </div>

          {selectedDateEvents.length > 0 && (
            <div className="text-xs text-zinc-500">
              Click individual shows for ticket links and calendar export.
            </div>
          )}
        </div>

        {selectedDateEvents.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {selectedDateEvents.map((event) => (
              <div key={event.id} className="flex flex-col">
                <EventCard event={event} />
                <div className="mt-2 flex items-center justify-end gap-2 px-1 text-xs">
                  <button
                    type="button"
                    onClick={() => downloadIcsFile(event)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    <DownloadIcon className="h-3 w-3 text-zinc-500" />
                    <span>iCal (.ics)</span>
                  </button>
                  <a
                    href={generateGoogleCalendarUrl(event)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    <ExternalLinkIcon className="h-3 w-3 text-zinc-500" />
                    <span>Google Cal</span>
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-500">
            <CalendarIcon className="mb-2 h-10 w-10 text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-700">
              No shows on this day
            </p>
            <p className="mt-1 max-w-sm text-xs text-zinc-400">
              Select another date on the calendar above or explore all upcoming
              shows on the homepage.
            </p>
            <Link
              href="/"
              className="mt-4 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
            >
              Browse All Upcoming Concerts
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
