import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Encore — Concert Finder',
    short_name: 'Encore',
    description: 'Personalized live-music and concert discovery',
    start_url: '/',
    display: 'standalone',
    background_color: '#090d16',
    theme_color: '#090d16',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
