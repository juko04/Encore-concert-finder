/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarClient } from '@/components/calendar/CalendarClient';
import {
  generateIcsContent,
  generateGoogleCalendarUrl,
} from '@/lib/utils/calendar-export';
import type { IndexEventItem } from '@/components/index/types';

describe('Calendar and Planning Features (Agent 5 & QA)', () => {
  const sampleEvent: IndexEventItem = {
    id: 'cal-event-1',
    title: 'The National with Bartees Strange',
    headlinerName: 'The National',
    artists: [
      {
        id: 'artist-nat',
        name: 'The National',
        billingPosition: 'headliner',
      },
      {
        id: 'artist-bartees',
        name: 'Bartees Strange',
        billingPosition: 'support',
      },
    ],
    venueName: 'Mission Ballroom',
    venueId: 'v-mission',
    city: 'Denver',
    region: 'CO',
    localStartDate: '2026-09-20',
    startsAt: '2026-09-20T20:00:00-06:00',
    doorTime: '7:00 PM',
    timezone: 'America/Denver',
    status: 'scheduled',
    inventoryStatus: 'available',
    minPrice: 50,
    maxPrice: 95,
    currency: 'USD',
    ticketUrl: 'https://tickets.example.com/the-national',
    posterColor: '#4f46e5',
    posterSecondaryColor: '#818cf8',
  };

  describe('Calendar Export Utilities', () => {
    it('generates standards-compliant iCalendar (.ics) content', () => {
      const ics = generateIcsContent(sampleEvent);

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('VERSION:2.0');
      expect(ics).toContain('PRODID:-//Encore Live Music//Concert Finder//EN');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('UID:encore-cal-event-1@encore.live');
      expect(ics).toContain('SUMMARY:The National at Mission Ballroom');
      expect(ics).toContain('LOCATION:Mission Ballroom, Denver, CO');
      expect(ics).toContain('Supporting Artists: Bartees Strange');
      expect(ics).toContain('TZID=America/Denver');
      expect(ics).toContain('END:VEVENT');
      expect(ics).toContain('END:VCALENDAR');
    });

    it('generates correct Google Calendar event creation URL', () => {
      const urlStr = generateGoogleCalendarUrl(sampleEvent);
      const url = new URL(urlStr);

      expect(url.origin).toBe('https://calendar.google.com');
      expect(url.pathname).toBe('/calendar/render');
      expect(url.searchParams.get('action')).toBe('TEMPLATE');
      expect(url.searchParams.get('text')).toBe(
        'The National at Mission Ballroom',
      );
      expect(url.searchParams.get('location')).toBe(
        'Mission Ballroom, Denver, CO',
      );
      expect(url.searchParams.get('ctz')).toBe('America/Denver');
      expect(url.searchParams.get('details')).toContain(
        'Supporting: Bartees Strange',
      );
    });
  });

  describe('CalendarClient Component', () => {
    it('renders month name, weekday headers, and concert counter on dates', () => {
      render(
        <CalendarClient
          initialEvents={[sampleEvent]}
          referenceDate="2026-09-20"
          isAuthenticated={false}
        />,
      );

      expect(screen.getByText('Concert Calendar')).toBeInTheDocument();
      expect(screen.getByText('September 2026')).toBeInTheDocument();
      expect(screen.getByText('Sun')).toBeInTheDocument();
      expect(screen.getByText('Sat')).toBeInTheDocument();

      // Show counter on September 20
      expect(screen.getByText('1 show')).toBeInTheDocument();

      // Selected date section lists concerts
      expect(
        screen.getByRole('heading', {
          name: /Concerts on Sun, Sep 20/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getAllByText('The National').length).toBeGreaterThan(0);
      expect(screen.getByText('with Bartees Strange')).toBeInTheDocument();
    });

    it('allows navigating months with previous and next buttons', () => {
      render(
        <CalendarClient
          initialEvents={[sampleEvent]}
          referenceDate="2026-09-20"
        />,
      );

      const nextButton = screen.getByRole('button', { name: /next month/i });
      fireEvent.click(nextButton);
      expect(screen.getByText('October 2026')).toBeInTheDocument();

      const prevButton = screen.getByRole('button', {
        name: /previous month/i,
      });
      fireEvent.click(prevButton);
      expect(screen.getByText('September 2026')).toBeInTheDocument();
    });

    it('allows clicking another date to inspect its shows', () => {
      render(
        <CalendarClient
          initialEvents={[sampleEvent]}
          referenceDate="2026-09-20"
        />,
      );

      // Click on day 15
      const day15Button = screen.getAllByRole('button', { name: /15/i })[0];
      fireEvent.click(day15Button);

      expect(
        screen.getByRole('heading', {
          name: /Concerts on Tue, Sep 15/i,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/No concerts scheduled for this date/i),
      ).toBeInTheDocument();
    });
  });

  describe('CalendarClient default month', () => {
    it('opens on the current month, not the first event month', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0));
      try {
        render(
          <CalendarClient
            initialEvents={[{ ...sampleEvent, localStartDate: '2027-02-14' }]}
          />,
        );
        expect(screen.getByText('November 2026')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
