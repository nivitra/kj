'use client';
import Link from 'next/link';
import { RefreshCw, CircleAlert } from 'lucide-react';
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <div className="card max-w-lg mx-auto p-8 sm:p-10 text-center" role="alert">
    <CircleAlert size={32} className="mx-auto mb-5" style={{color:'var(--ink-2)'}}/>
    <h1 className="text-xl font-semibold">This page could not load</h1>
    <p className="mt-3 text-sm leading-relaxed" style={{color:'var(--ink-2)'}}>Try again to reload the page. You can also return to the overview and open it from there.</p>
    <div className="flex flex-wrap justify-center gap-3 mt-6">
      <button type="button" className="btn-primary px-4 py-2.5 inline-flex items-center gap-2" onClick={retry}><RefreshCw size={16}/>Try again</button>
      <Link href="/dashboard" className="btn-ghost px-4 py-2.5">Back to overview</Link>
    </div>
  </div>;
}
