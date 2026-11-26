import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { getHomeLocation } from '@/lib/location/server';
import { ViewerProvider } from '@/components/auth/ViewerContext';

export const metadata: Metadata = {
  title: 'Encore — Concert Finder',
  description: 'Personalized live-music discovery',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.ico',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#090d16',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getAuthenticatedUser();
  const home = await getHomeLocation(user?.id).catch(() => null);
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 font-sans text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
        <ViewerProvider isAuthenticated={Boolean(user)} homeLabel={home?.label}>
          {children}
        </ViewerProvider>
      </body>
    </html>
  );
}
