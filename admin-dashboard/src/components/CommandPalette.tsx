'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Search, User, Images, FileText, Inbox, Plus, Upload, CreditCard, Building2,
} from 'lucide-react';
import { adminApi, billingApi, portalApi, galleryApi } from '@/lib/api';

type Item = {
  id: string;
  group: string;
  label: string;
  sub?: string;
  href?: string;
  action?: () => void;
  icon: React.ElementType;
};

const NAV: Item[] = [
  { id: 'nav-cc', group: 'Navigation', label: 'Command Center', href: '/dashboard', icon: Building2 },
  { id: 'nav-clients', group: 'Navigation', label: 'Customers', href: '/dashboard/clients', icon: User },
  { id: 'nav-galleries', group: 'Navigation', label: 'Galleries', href: '/dashboard/galleries', icon: Images },
  { id: 'nav-billing', group: 'Navigation', label: 'Billing', href: '/dashboard/invoices', icon: CreditCard },
  { id: 'nav-leads', group: 'Navigation', label: 'Enquiries', href: '/dashboard/leads', icon: Inbox },
  { id: 'nav-upload', group: 'Navigation', label: 'Upload photos', href: '/dashboard/upload', icon: Upload },
  { id: 'nav-studio', group: 'Navigation', label: 'Studio profile', href: '/dashboard/studio', icon: Building2 },
  { id: 'nav-packages', group: 'Navigation', label: 'Packages', href: '/dashboard/service-packages', icon: FileText },
  { id: 'nav-messaging', group: 'Navigation', label: 'Messaging', href: '/dashboard/messaging', icon: Inbox },
  { id: 'nav-settings', group: 'Navigation', label: 'Settings', href: '/dashboard/settings', icon: Building2 },
];

const ACTIONS: Item[] = [
  { id: 'act-client', group: 'Actions', label: 'New client', href: '/dashboard/clients?new=1', icon: Plus },
  { id: 'act-gallery', group: 'Actions', label: 'New gallery', href: '/dashboard/galleries?new=1', icon: Plus },
  { id: 'act-invoice', group: 'Actions', label: 'New invoice', href: '/dashboard/invoices?new=1', icon: Plus },
  { id: 'act-upload', group: 'Actions', label: 'Upload photos', href: '/dashboard/upload', icon: Upload },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const { data: customersData } = useQuery({
    queryKey: ['cmd-customers'],
    queryFn: () => adminApi.customers({ limit: 100 }).then((r) => r.data),
    enabled: open,
    staleTime: 60_000,
  });
  const { data: galleriesData } = useQuery({
    queryKey: ['cmd-galleries'],
    queryFn: () => galleryApi.list({ limit: 50 }).then((r) => r.data),
    enabled: open,
    staleTime: 60_000,
  });
  const { data: invoicesData } = useQuery({
    queryKey: ['cmd-invoices'],
    queryFn: () => billingApi.listInvoices().then((r) => r.data),
    enabled: open,
    staleTime: 60_000,
  });
  const { data: leadsData } = useQuery({
    queryKey: ['cmd-leads'],
    queryFn: () => portalApi.leads().then((r) => r.data),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQ('');
        setActive(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);

    const entityItems: Item[] = [];
    for (const c of customersData?.customers || []) {
      const label = c.name || 'Client';
      const sub = [c.phone, c.email].filter(Boolean).join(' · ');
      if (match(`${label} ${sub}`)) {
        entityItems.push({
          id: `c-${c.id}`,
          group: 'Clients',
          label,
          sub,
          href: `/dashboard/clients/${c.id}`,
          icon: User,
        });
      }
    }
    for (const g of galleriesData?.galleries || []) {
      if (match(g.name || '')) {
        entityItems.push({
          id: `g-${g.id}`,
          group: 'Galleries',
          label: g.name,
          sub: g.status,
          href: `/dashboard/galleries/${g.id}`,
          icon: Images,
        });
      }
    }
    for (const inv of invoicesData?.invoices || []) {
      const label = inv.invoiceNumber || inv.title || 'Invoice';
      const sub = inv.customer?.name || inv.status;
      if (match(`${label} ${sub}`)) {
        entityItems.push({
          id: `i-${inv.id}`,
          group: 'Invoices',
          label,
          sub: String(sub || ''),
          href: '/dashboard/invoices',
          icon: FileText,
        });
      }
    }
    for (const l of leadsData?.leads || []) {
      const name = l.customer?.name || l.name || 'Lead';
      if (match(`${name} ${l.package?.title || ''}`)) {
        entityItems.push({
          id: `l-${l.id}`,
          group: 'Enquiries',
          label: name,
          sub: `${l.status}${l.package?.title ? ` · ${l.package.title}` : ''}`,
          href: '/dashboard/leads',
          icon: Inbox,
        });
      }
    }

    const nav = NAV.filter((n) => match(n.label));
    const acts = ACTIONS.filter((a) => match(a.label));
    return [...acts, ...entityItems.slice(0, 12), ...nav];
  }, [q, customersData, galleriesData, invoicesData, leadsData]);

  const go = useCallback(
    (item: Item) => {
      setOpen(false);
      setQ('');
      if (item.action) item.action();
      else if (item.href) router.push(item.href);
    },
    [router],
  );

  useEffect(() => {
    setActive(0);
  }, [q]);

  if (!open) return null;

  const groups = Array.from(new Set(items.map((i) => i.group)));

  return (
    <div className="cmdk-root fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] px-4">
      <button type="button" className="cmdk-scrim absolute inset-0 border-0" aria-label="Close" onClick={() => setOpen(false)} />
      <div
        className="cmdk-panel relative w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
          <Search size={18} style={{ color: 'var(--ink-3)' }} />
          <input
            autoFocus
            type="search"
            className="flex-1 bg-transparent outline-none text-[16px]"
            style={{ color: 'var(--ink)' }}
            placeholder="Search clients, galleries, invoices… or jump"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && items[active]) {
                e.preventDefault();
                go(items[active]);
              }
            }}
          />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-3)' }}>
            esc
          </kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
              No matches
            </div>
          )}
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>
                {g}
              </div>
              {items
                .map((item, idx) => ({ item, idx }))
                .filter(({ item }) => item.group === g)
                .map(({ item, idx }) => {
                  const Icon = item.icon;
                  const isActive = idx === active;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                      style={{
                        background: isActive ? 'var(--surface-sunken)' : 'transparent',
                        color: 'var(--ink)',
                      }}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => go(item)}
                    >
                      <Icon size={16} style={{ color: 'var(--ink-3)' }} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-medium truncate">{item.label}</span>
                        {item.sub && (
                          <span className="block text-[12px] truncate" style={{ color: 'var(--ink-3)' }}>{item.sub}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function openCommandPalette() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
}
