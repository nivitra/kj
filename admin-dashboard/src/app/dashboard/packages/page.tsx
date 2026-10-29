'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/** Legacy /dashboard/packages (ClientType UI) → unified Packages. */
export default function PackagesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/service-packages');
  }, [router]);

  return (
    <div className="py-16 text-center">
      <p className="text-sm mb-3" style={{ color: 'var(--ink-2)' }}>Redirecting to Packages…</p>
      <Link href="/dashboard/service-packages" className="btn-primary px-4 py-2">Packages</Link>
    </div>
  );
}
