import Link from 'next/link';

/**
 * Small floating badge visible on all production pages pointing to the UI prototypes.
 * Dev/exploration only — does not affect production functionality.
 */
export function PrototypesDevBadge() {
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Link
        href="/prototypes"
        className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 text-xs font-medium text-zinc-400 shadow-lg backdrop-blur transition-colors hover:border-zinc-500 hover:text-zinc-200"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
        UI Prototypes
      </Link>
    </div>
  );
}
