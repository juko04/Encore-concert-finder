/**
 * Calendar export utilities for Encore live music events.
 * Supports standards-compliant iCalendar (.ics) downloads and Google Calendar creation links.
 * Accurately formats event start/end times in venue local time zones.
 */

import type { IndexEventItem } from '@/components/index/types';

/**
 * Formats a local date and time into iCalendar DTSTART / DTEND format.
 * E.g., "20260815T193000"
 */
function toIcsDateTime(dateStr: string, timeStr?: string | null): string {
  const cleanDate = dateStr.replace(/-/g, '');
  if (!timeStr) {
    // Whole day event
    return cleanDate;
  }

  // Parse time
  let hours = 19; // default 7 PM
  let minutes = 0;

  if (timeStr.includes(':')) {
    const parts = timeStr.trim().split(':');
    hours = parseInt(parts[0], 10) || 19;
    const minPart = parts[1] || '0';
    minutes = parseInt(minPart.slice(0, 2), 10) || 0;
    if (timeStr.toUpperCase().includes('PM') && hours < 12) {
      hours += 12;
    } else if (timeStr.toUpperCase().includes('AM') && hours === 12) {
      hours = 0;
    }
  }

  const h = String(hours).padStart(2, '0');
  const m = String(minutes).padStart(2, '0');
  return `${cleanDate}T${h}${m}00`;
}

/**
 * Generates standards-compliant iCalendar (.ics) file string.
 */
export function generateIcsContent(event: IndexEventItem): string {
  const headliner = event.headlinerName || event.title;
  const venue = event.venueName || 'Venue TBA';
  const location = [event.venueName, event.city, event.region]
    .filter(Boolean)
    .join(', ');

  const support = event.artists
    ?.filter((a) => a.name !== headliner && a.billingPosition !== 'headliner')
    .map((a) => a.name)
    .join(', ');

  const dtStart = toIcsDateTime(
    event.localStartDate,
    event.doorTime || event.startsAt,
  );
  // Default end time ~3.5 hours later
  const [year, month, day] = event.localStartDate.split('-').map(Number);
  const startDt = new Date(Date.UTC(year, month - 1, day, 19, 0, 0));
  const endDt = new Date(startDt.getTime() + 3.5 * 3600 * 1000);
  const dtEnd = `${endDt.getUTCFullYear()}${String(endDt.getUTCMonth() + 1).padStart(2, '0')}${String(endDt.getUTCDate()).padStart(2, '0')}T${String(endDt.getUTCHours()).padStart(2, '0')}${String(endDt.getUTCMinutes()).padStart(2, '0')}00`;

  const now = new Date();
  const dtStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const descriptionParts = [
    `Concert: ${event.title}`,
    support ? `Supporting Artists: ${support}` : null,
    event.ticketUrl ? `Tickets & Guide: ${event.ticketUrl}` : null,
    `Discovered on Encore Live Music Index`,
  ].filter(Boolean);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Encore Live Music//Concert Finder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:encore-${event.id}@encore.live`,
    `DTSTAMP:${dtStamp}`,
    event.timezone
      ? `DTSTART;TZID=${event.timezone}:${dtStart}`
      : `DTSTART:${dtStart}`,
    event.timezone ? `DTEND;TZID=${event.timezone}:${dtEnd}` : `DTEND:${dtEnd}`,
    `SUMMARY:${headliner} at ${venue}`,
    `DESCRIPTION:${descriptionParts.join('\\n')}`,
    `LOCATION:${location}`,
    event.ticketUrl ? `URL:${event.ticketUrl}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  return lines.join('\r\n');
}

/**
 * Triggers a client-side .ics file download for the given concert.
 */
export function downloadIcsFile(event: IndexEventItem): void {
  if (typeof window === 'undefined') return;

  const content = generateIcsContent(event);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const filename =
    `${event.headlinerName || 'concert'}-${event.localStartDate}.ics`
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Generates a direct Google Calendar event creation URL.
 */
export function generateGoogleCalendarUrl(event: IndexEventItem): string {
  const headliner = event.headlinerName || event.title;
  const venue = event.venueName || 'Venue TBA';
  const location = [event.venueName, event.city, event.region]
    .filter(Boolean)
    .join(', ');

  const support = event.artists
    ?.filter((a) => a.name !== headliner && a.billingPosition !== 'headliner')
    .map((a) => a.name)
    .join(', ');

  const title = `${headliner} at ${venue}`;
  const dtStart = toIcsDateTime(
    event.localStartDate,
    event.doorTime || event.startsAt,
  );
  // Default end time ~3.5 hours later
  const dtEnd = toIcsDateTime(event.localStartDate, '23:30');

  const details = [
    `Concert: ${event.title}`,
    support ? `Supporting: ${support}` : null,
    event.ticketUrl ? `Tickets: ${event.ticketUrl}` : null,
    `Discovered on Encore`,
  ]
    .filter(Boolean)
    .join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${dtStart}/${dtEnd}`,
    details,
    location,
  });

  if (event.timezone) {
    params.set('ctz', event.timezone);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
