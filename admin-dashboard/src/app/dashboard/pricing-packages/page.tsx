'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * Pricing tiers were a second package list (ClientType). Everything is now one
 * Packages list under /dashboard/service-packages. This route redirects.
 */
export default function PricingPackagesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/service-packages');
  }, [router]);

  return (
    <div className="animate-fade-up max-w-lg py-16">
      <p className="kicker mb-2">Unified packages</p>
      <h1 className="font-display text-[28px] mb-3" style={{ color: 'var(--ink)' }}>
        Pricing tiers moved into Packages
      </h1>
      <p className="text-[14px] mb-4 leading-relaxed" style={{ color: 'var(--ink-2)' }}>
        There is only <strong>one</strong> package list now: price, client app card, booking steps,
        included photos, and ₹/extra — all on the same package you assign to a client.
      </p>
      <Link href="/dashboard/service-packages" className="btn-primary inline-flex px-4 py-2.5">
        Go to Packages
      </Link>
    </div>
  );
}
