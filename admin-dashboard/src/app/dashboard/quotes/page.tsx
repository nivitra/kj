'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import QuotationRequestLink from '@/components/QuotationRequestLink';
import { adminApi, portalApi, quoteApi } from '@/lib/api';
import Modal from '@/components/Modal';

export default function QuotesListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [view, setView] = useState<'quotes' | 'requests'>('quotes');
  const [page, setPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const [opening, setOpening] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [eventType, setEventType] = useState('WEDDING');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['quotes', page],
    queryFn: () => quoteApi.list({ page }).then((r) => r.data),
  });
  const quotes = data?.quotes || [];
  const requestsQuery = useQuery({ queryKey: ['wedding-inquiries', 'quotation-list', requestPage], queryFn: () => portalApi.weddingInquiries({ kind: 'ALL', page: requestPage }).then(r => r.data), enabled: view === 'requests', refetchInterval: 20000 });
  const requests = requestsQuery.data?.inquiries || [];
  async function openRequest(request: any) {
    if (opening) return;
    if (request.quote) { router.push(`/dashboard/quotes/${request.quote.id}`); return; }
    setOpening(request.id);
    try { const r = await quoteApi.create({ leadId: request.id }); router.push(`/dashboard/quotes/${r.data.quote.id}`); }
    catch { toast.error('Could not open quotation. Please try again.'); }
    finally { setOpening(null); }
  }


  const { data: clientsData } = useQuery({
    queryKey: ['clients-for-quote', search],
    queryFn: () => adminApi.customers({ kind: 'clients', search: search || undefined, limit: 40 }).then((r) => r.data),
    enabled: open,
  });
  const clients = clientsData?.customers || [];

  const create = useMutation({
    mutationFn: () => quoteApi.create({ customerId, eventType }),
    onSuccess: (r: any) => {
      const id = r?.data?.quote?.id || r?.quote?.id;
      qc.invalidateQueries({ queryKey: ['quotes'] });
      setOpen(false);
      if (id) router.push(`/dashboard/quotes/${id}`);
      else toast.error('Quote created but id missing — open Quotations again');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error?.message || e?.response?.data?.error || 'Could not start quotation'),
  });

  const money = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

  const picked = useMemo(() => clients.find((c: any) => c.id === customerId), [clients, customerId]);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--ink-3)' }}>
            Requests &amp; proposals
          </p>
          <h1 className="font-display text-[32px] leading-tight mt-1" style={{ color: 'var(--ink)' }}>
            Quotations
          </h1>
          <p className="text-[14px] mt-1.5 max-w-xl" style={{ color: 'var(--ink-2)' }}>
            Review wedding and corporate requests, upload your quotation PDF, and share it with the client.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <QuotationRequestLink/>
        <button
          type="button"
          className="btn-primary flex items-center gap-2 px-4 py-2.5"
          onClick={() => {
            setCustomerId('');
            setSearch('');
            setEventType('WEDDING');
            setOpen(true);
          }}
        >
          <Plus size={16} /> New quotation
        </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6" role="tablist" aria-label="Quotations and requests">
        {(['quotes', 'requests'] as const).map(tab => <button key={tab} role="tab" aria-selected={view === tab} className={view === tab ? 'btn-primary px-4 py-2' : 'btn-ghost px-4 py-2'} onClick={() => setView(tab)}>{tab === 'quotes' ? 'Quotations' : 'Quotation requests'}</button>)}
      </div>
      {view === 'requests' && <div className="space-y-3">
        <p className="text-sm mb-4" style={{ color: 'var(--ink-2)' }}>Share the request link using Copy link. Clients can submit their plans without signing in.</p>
        {requestsQuery.isLoading && <div className="card p-10 text-center">Loading requests…</div>}
        {requestsQuery.isError && <div className="card p-6">Could not load requests. <button className="btn-secondary px-3 py-2" onClick={() => requestsQuery.refetch()}>Try again</button></div>}
        {!requestsQuery.isLoading && !requestsQuery.isError && !requests.length && <div className="card p-10 text-center">Your quotation requests will appear here.</div>}
        {requests.map((request: any) => <div key={request.id} className="card p-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{request.name || 'Client'}</h2><span className="badge badge-neutral">{request.quote?.hasPdf ? 'PDF sent' : request.inquiryStatus === 'PENDING' ? 'New request' : request.inquiryStatus.replaceAll('_', ' ').toLowerCase()}</span></div>
            <p className="text-sm mt-2" style={{ color: 'var(--ink-2)' }}>{request.form?.eventType || request.inquiryKind} · {request.form?.dates?.dayCount || request.form?.dates?.days?.length || 1} day(s)</p>
            <p className="text-sm mt-1">{request.datesLabel || 'Dates to be decided'} · {request.venueLabel || 'Location to be confirmed'}</p>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-2)' }}>{request.servicesLabel}</p>
            <Link className="inline-block text-xs underline mt-3" href={`/dashboard/inquiries?requestId=${request.id}`}>View all request details</Link>
          </div>
          <button className="btn-primary px-4 py-2" disabled={!!opening} onClick={() => openRequest(request)}>{opening === request.id ? 'Opening…' : request.quote ? 'Open quotation' : 'Prepare quotation'}</button>
        </div>)}
        {(requestsQuery.data?.total || 0) > 30 && <div className="flex items-center justify-between pt-4"><button className="btn-secondary px-4 py-2" disabled={requestPage <= 1} onClick={() => setRequestPage(p => p - 1)}>Previous requests</button><span className="text-sm">Page {requestPage} of {Math.ceil(requestsQuery.data.total / 30)}</span><button className="btn-secondary px-4 py-2" disabled={requestPage * 30 >= requestsQuery.data.total} onClick={() => setRequestPage(p => p + 1)}>Next requests</button></div>}
      </div>}
      {view === 'quotes' && <>
      {isError && <div className="card p-6 mb-4">Could not load quotations. <button className="btn-secondary px-3 py-2" onClick={() => refetch()}>Try again</button></div>}
      {isLoading && (
        <div className="card p-10 text-center text-sm" style={{ color: 'var(--ink-3)' }}>Loading…</div>
      )}
      {!isLoading && !isError && quotes.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-sm" style={{ color: 'var(--ink-3)' }}>No quotations yet.</p>
          <button type="button" className="btn-primary mt-4 px-4 py-2.5" onClick={() => setOpen(true)}>
            Make the first quotation
          </button>
        </div>
      )}
      <div className="space-y-2">
        {quotes.map((q: any) => (
          <Link key={q.id} href={`/dashboard/quotes/${q.id}`} className="card px-5 py-4 flex justify-between gap-3 hover:bg-[var(--surface-sunken)]">
            <div>
              <div className="font-medium" style={{ color: 'var(--ink)' }}>{q.title}</div>
              <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
                {q.clientName} · {q.status === 'SENT' ? 'PDF sent' : q.status.replaceAll('_', ' ').toLowerCase()}
              </div>
            </div>
            <div className="font-semibold shrink-0">{q.pricingSnapshot?.options?.length || q.pricingSnapshot?.alternatives?.length ? money(q.pricingSnapshot?.total || 0) : q.hasPdf ? 'PDF quotation' : 'Preparing'}</div>
          </Link>
        ))}
      </div>

      {(data?.total || 0) > 30 && <div className="flex items-center justify-between mt-6"><button className="btn-secondary px-4 py-2" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span className="text-sm">Page {page} of {Math.ceil(data.total / 30)}</span><button className="btn-secondary px-4 py-2" disabled={page * 30 >= data.total} onClick={() => setPage(p => p + 1)}>Next</button></div>}
      </>}
      <Modal
        open={open}
        onClose={() => !create.isPending && setOpen(false)}
        title="New quotation"
        description="Pick the client, then you get the quotation form — packages, add-ons, PDF."
        size="md"
        preventClose={create.isPending}
        footer={
          <>
            <button type="button" className="btn-ghost flex-1 py-2.5" disabled={create.isPending} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={!customerId || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Opening…' : 'Open quotation form'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>Event type</label>
          <div className="flex gap-2">
            {['WEDDING', 'CORPORATE', 'ENGAGEMENT', 'OTHER'].map((t) => (
              <button
                key={t}
                type="button"
                className="px-3 py-2 rounded-xl text-sm font-semibold border"
                style={{
                  background: eventType === t ? 'var(--ink)' : 'var(--surface)',
                  color: eventType === t ? '#fff' : 'var(--ink)',
                  borderColor: 'var(--line)',
                }}
                onClick={() => setEventType(t)}
              >
                {t === 'WEDDING' ? 'Wedding' : t === 'CORPORATE' ? 'Corporate' : t === 'ENGAGEMENT' ? 'Engagement' : 'Other'}
              </button>
            ))}
          </div>
          <label className="block text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>Client</label>
          <input
            className="input w-full"
            placeholder="Search name, phone, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {picked && (
            <p className="text-[13px]" style={{ color: 'var(--ink)' }}>
              Selected: <strong>{picked.name}</strong>
              {picked.phone ? ` · ${picked.phone}` : ''}
            </p>
          )}
          <div className="max-h-64 overflow-y-auto space-y-1">
            {clients.map((c: any) => {
              const on = customerId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCustomerId(c.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl"
                  style={{
                    background: on ? 'var(--nav-active-bg)' : 'var(--surface-sunken)',
                    border: `1px solid ${on ? 'var(--nav-active-ring)' : 'transparent'}`,
                  }}
                >
                  <span className="block font-medium truncate" style={{ color: 'var(--ink)' }}>{c.name}</span>
                  <span className="block text-[12px]" style={{ color: 'var(--ink-3)' }}>
                    {[c.phone, c.email].filter(Boolean).join(' · ') || 'No phone'}
                  </span>
                </button>
              );
            })}
            {open && !clients.length && (
              <p className="text-center py-6 text-sm" style={{ color: 'var(--ink-3)' }}>
                {search ? 'No matching clients' : 'Type to search, or wait for the list…'}
              </p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
