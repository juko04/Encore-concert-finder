import type { Metadata } from 'next';
import React from 'react';
import { HubThemeProvider } from '@/components/hub/HubThemeProvider';

export const metadata: Metadata = {
  title: 'Encore Observatory — Internal Architecture Hub',
  description:
    'Interactive architectural topology and system metrics for Encore',
};

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return <HubThemeProvider>{children}</HubThemeProvider>;
}
