'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GalleryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Gallery page error:', error);
  }, [error]);

  return (
    <div className="text-center py-16 px-6 space-y-4">
      <h2 className="font-display text-2xl" style={{ color: 'var(--ink)' }}>
        This gallery couldn’t load
      </h2>
      <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--ink-2)' }}>
        {error?.message || 'Something went wrong rendering this page.'}
        {' '}
        Try reloading. If you just updated the app, do a hard refresh (Cmd/Ctrl+Shift+R).
      </p>
      <div className="flex items-center justify-center gap-3">
        <button type="button" className="btn-primary px-4 py-2" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/dashboard/galleries" className="btn-ghost px-4 py-2">
          Back to galleries
        </Link>
      </div>
    </div>
  );
}
