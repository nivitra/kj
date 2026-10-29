'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Users, Images, Upload, CheckSquare, Plus, MessageCircle,
  FileText, ListTodo, Activity,
} from 'lucide-react';
import { adminApi, billingApi, portalApi } from '@/lib/api';
import QuotationRequestLink from '@/components/QuotationRequestLink';
import { useAuthStore } from '@/lib/store';


function money(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function moneyCompact(n: number) {
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export default function CommandCenterPage() {
  const admin = useAuthStore((s) => s.admin);
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => adminApi.stats().then((r) => r.data),
  });
  const { data: billing } = useQuery({
    queryKey: ['billing-summary'],
    queryFn: () => billingApi.summary().then((r) => r.data),
  });
  const { data: leadsData } = useQuery({
    queryKey: ['portal-leads'],
    queryFn: () => portalApi.leads().then((r) => r.data),
    refetchInterval: 30_000,
  });
  const { data: bookingsData } = useQuery({
    queryKey: ['portal-bookings'],
    queryFn: () => portalApi.bookings().then((r) => r.data),
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const summary = billing?.summary;
  const accounts = billing?.accounts || [];
  const leads = leadsData?.leads || [];
  const bookings = bookingsData?.bookings || [];

  const newLeads = leads.filter((l: { status?: string }) => l.status === 'NEW');
  const outstanding = Number(summary?.totalOutstanding || 0);
  const collected = Number(summary?.totalCash || 0);
  const clientsWithDues = Number(summary?.clientsWithDues || 0);

  const pricingGaps = (stats as any)?.pricingGaps || null;
  const gapCount = Number(pricingGaps?.counts?.total || 0);

  const tasks = useMemo(() => {
    const list: {
      text: string;
      href: string;
      tone: 'rose' | 'amber' | 'neutral' | 'green';
      emphasize?: string;
    }[] = [];
    if (gapCount > 0) {
      const nTier = pricingGaps?.counts?.clientsMissingTier || 0;
      const nRate = pricingGaps?.counts?.clientsTierMissingRate || 0;
      const nGal = pricingGaps?.counts?.galleriesIncomplete || 0;
      list.push({
        text:
          nTier > 0
            ? `${nTier} client${nTier === 1 ? '' : 's'} missing pricing tier — confirm pricing before submission`
            : nRate > 0
              ? `${nRate} pricing tier${nRate === 1 ? '' : 's'} missing ₹/extra rate`
              : `${nGal} galler${nGal === 1 ? 'y' : 'ies'} with incomplete selection pricing`,
        href: '/dashboard/clients?package=none',
        tone: 'rose',
      });
    }
    if (newLeads.length) {
      list.push({
        text: `${newLeads.length} new enquir${newLeads.length === 1 ? 'y' : 'ies'} need a reply`,
        href: '/dashboard/inquiries',
        tone: 'rose',
      });
    }
    if (clientsWithDues > 0) {
      list.push({
        text: `${clientsWithDues} client${clientsWithDues === 1 ? '' : 's'} with outstanding dues`,
        href: '/dashboard/invoices',
        tone: 'amber',
        emphasize: money(outstanding),
      });
    }
    const overdueAccounts = accounts
      .filter((a: { balance?: number; outstanding?: number }) => Number(a.balance || a.outstanding || 0) > 0)
      .slice(0, 3);
    for (const a of overdueAccounts) {
      const name =
        (a as { customerName?: string; name?: string }).customerName ||
        (a as { name?: string }).name ||
        'Client';
      const bal = Number(
        (a as { balance?: number; outstanding?: number }).balance ||
          (a as { outstanding?: number }).outstanding ||
          0,
      );
      if (bal > 0) {
        list.push({
          text: `due from ${name}`,
          href: '/dashboard/invoices',
          tone: 'amber',
          emphasize: money(bal),
        });
      }
    }
    if (Number(stats?.submittedSelections || 0) > 0) {
      list.push({
        text: `${stats.submittedSelections} selection${stats.submittedSelections === 1 ? '' : 's'} submitted for review`,
        href: '/dashboard/selections',
        tone: 'neutral',
      });
    }
    if (!list.length) {
      list.push({
        text: 'All clear — nothing urgent right now',
        href: '/dashboard/clients',
        tone: 'green',
      });
    }
    return list.slice(0, 7);
  }, [newLeads.length, clientsWithDues, outstanding, accounts, stats, gapCount, pricingGaps]);

  const pipeline = useMemo(() => {
    const counts: Record<string, number> = {
      NEW: 0,
      CONTACTED: 0,
      BOOKED: 0,
      WON: 0,
      LOST: 0,
    };
    for (const l of leads) {
      const s = String(l.status || 'NEW').toUpperCase();
      if (s in counts) counts[s] += 1;
      else counts.NEW += 1;
    }
    counts.BOOKED = Math.max(counts.BOOKED, bookings.length);
    return [
      { key: 'NEW', label: 'Enquiry', count: counts.NEW, href: '/dashboard/inquiries' },
      { key: 'CONTACTED', label: 'Contacted', count: counts.CONTACTED, href: '/dashboard/inquiries' },
      { key: 'BOOKED', label: 'Booked', count: counts.BOOKED, href: '/dashboard/bookings' },
      { key: 'WON', label: 'Won', count: counts.WON, href: '/dashboard/inquiries' },
      { key: 'LOST', label: 'Lost', count: counts.LOST, href: '/dashboard/inquiries' },
    ];
  }, [leads, bookings]);

  const upcoming = useMemo(() => {
    return bookings
      .slice()
      .sort(
        (a: { updatedAt?: string }, b: { updatedAt?: string }) =>
          new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime(),
      )
      .slice(0, 8)
      .map(
        (b: {
          customerId?: string;
          id?: string;
          customer?: { name?: string };
          name?: string;
          status?: string;
          notes?: string;
          note?: string;
          updatedAt?: string;
        }) => ({
          id: b.customerId || b.id || Math.random().toString(36),
          name: b.customer?.name || b.name || 'Client',
          status: b.status || '—',
          note: b.notes || b.note || '',
          when: b.updatedAt
            ? new Date(b.updatedAt).toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })
            : '',
        }),
      );
  }, [bookings]);

  const metrics = [
    {
      label: 'Collected this period',
      value: statsLoading && !summary ? '—' : `₹${moneyCompact(collected)}`,
      href: '/dashboard/invoices',
      tone: 'default' as const,
    },
    {
      label: 'Outstanding',
      value: `₹${moneyCompact(outstanding)}`,
      href: '/dashboard/invoices',
      tone: outstanding > 0 ? ('danger' as const) : ('default' as const),
      showDot: outstanding > 0,
    },
    {
      label: 'New enquiries',
      value: String(newLeads.length),
      href: '/dashboard/inquiries',
      tone: 'default' as const,
    },
    {
      label: 'Active jobs',
      value: String(bookings.length),
      href: '/dashboard/bookings',
      tone: 'default' as const,
    },
    {
      label: 'Galleries · Clients',
      value: statsLoading ? '—' : `${stats?.galleries ?? 0} · ${stats?.customers ?? 0}`,
      href: '/dashboard/galleries',
      tone: 'default' as const,
    },
  ];

  const quickActions = [
    { href: '/dashboard/clients?new=1', label: 'Client', icon: Plus },
    { href: '/dashboard/galleries?new=1', label: 'Gallery', icon: Images },
    { href: '/dashboard/upload', label: 'Upload', icon: Upload },
    { href: '/dashboard/messaging', label: 'Message', icon: MessageCircle },
    { href: '/dashboard/invoices?new=1', label: 'Invoice', icon: FileText },
    { href: '/dashboard/selections', label: 'Selections', icon: CheckSquare },
    { href: '/dashboard/clients', label: 'All clients', icon: Users },
  ];

  const studioName = admin?.studio?.name || 'Studio';

  return (
    <div className="cc-page animate-fade-up">
      {/* First open this session: WhatsApp / Baileys reliability checklist */}


      {/* 1. Header */}
      <header className="cc-header">
        <p className="cc-greeting">{greeting}, {studioName}.</p>
        <h1 className="cc-title">Studio overview</h1>
        <p className="cc-sub">What needs attention today.</p>
      </header>

      <section className="card p-6 mb-6 flex flex-wrap items-center justify-between gap-5" aria-label="Quotation requests">
        <div><h2 className="font-display text-2xl">Wedding &amp; corporate quotations</h2><p className="text-sm mt-2" style={{ color: 'var(--ink-2)' }}>Review requests, prepare your quotation and upload the PDF for your client.</p></div>
        <div className="flex flex-wrap gap-2"><Link href="/dashboard/inquiries" className="btn-secondary px-4 py-2.5 text-sm">View requests</Link><Link href="/dashboard/quotes" className="btn-primary px-4 py-2.5 text-sm">All quotations</Link><QuotationRequestLink/></div>
      </section>
      {/* 2. Independent metric blocks — no shared bordered cage */}
      <section className="cc-metrics" aria-label="Key metrics">
        {metrics.map((m) => (
          <Link key={m.label} href={m.href} className="cc-metric">
            <div className="cc-metric-value-row">
              {m.showDot && <span className="cc-metric-dot" aria-hidden />}
              <span
                className={`cc-metric-value tabular ${m.tone === 'danger' ? 'is-danger' : ''}`}
              >
                {m.value}
              </span>
            </div>
            <span className="cc-metric-label">{m.label}</span>
          </Link>
        ))}
      </section>

      {/* 3. Two columns — tasks + activity */}
      <section className="cc-main">
        <div className="cc-panel">
          <div className="cc-panel-head">
            <div className="cc-panel-title">
              <ListTodo size={15} strokeWidth={1.75} aria-hidden />
              <h2>Today&apos;s tasks</h2>
            </div>
          </div>
          <ul className="cc-task-list">
            {tasks.map((t, i) => (
              <li key={i}>
                <Link href={t.href} className={`cc-task cc-task--${t.tone}`}>
                  <span className="cc-task-accent" aria-hidden />
                  <span className="cc-task-body">
                    {t.emphasize && (
                      <span className="cc-task-amount tabular">{t.emphasize}</span>
                    )}
                    {t.emphasize ? ' · ' : null}
                    {t.text}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="cc-panel">
          <div className="cc-panel-head">
            <div className="cc-panel-title">
              <Activity size={15} strokeWidth={1.75} aria-hidden />
              <h2>Recent job updates</h2>
            </div>
            <Link href="/dashboard/bookings" className="cc-view-all">
              View all
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="cc-empty">No booking updates yet.</p>
          ) : (
            <ul className="cc-job-list">
              {upcoming.map(
                (u: { id: string; name: string; status: string; note: string; when: string }) => (
                  <li key={u.id} className="cc-job">
                    <div className="cc-job-main">
                      <div className="cc-job-name">{u.name}</div>
                      <div className="cc-job-meta">
                        {u.status.replace(/_/g, ' ')}
                        {u.note ? ` · ${u.note}` : ''}
                      </div>
                    </div>
                    <time className="cc-job-when tabular">{u.when}</time>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </section>

      {/* Pipeline — understated strip */}
      <section className="cc-pipeline" aria-label="Pipeline">
        <h2 className="cc-pipeline-label">Pipeline</h2>
        <div className="cc-pipeline-row">
          {pipeline.map((p, i) => (
            <div key={p.key} className="cc-pipeline-item">
              <Link href={p.href} className="cc-pipeline-link">
                <span className="cc-pipeline-count tabular">{p.count}</span>
                <span className="cc-pipeline-stage">{p.label}</span>
              </Link>
              {i < pipeline.length - 1 && (
                <span className="cc-pipeline-arrow" aria-hidden>
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Quick actions */}
      <section className="cc-actions" aria-label="Quick actions">
        <div className="cc-actions-row">
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <Link key={a.href + a.label} href={a.href} className="btn-pill">
                <Icon size={14} strokeWidth={1.75} />
                {a.label}
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
