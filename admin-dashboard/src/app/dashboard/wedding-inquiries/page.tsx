'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { MessageCircle, Mail, Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { portalApi, quoteApi } from '@/lib/api';
import QuotationRequestLink from '@/components/QuotationRequestLink';
import SlideOver from '@/components/SlideOver';

const STATUSES = [
  { id: '', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'IN_REVIEW', label: 'In discussion' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'BOOKED', label: 'Booked' },
  { id: 'REJECTED', label: 'Rejected' },
] as const;

const badge: Record<string, string> = {
  PENDING: 'badge-amber',
  IN_REVIEW: 'badge-neutral',
  APPROVED: 'badge-green',
  BOOKED: 'badge-green',
  REJECTED: 'badge-rose',
};

const statusLabel: Record<string, string> = {
  PENDING: 'Pending',
  IN_REVIEW: 'In discussion',
  APPROVED: 'Approved',
  BOOKED: 'Booked',
  REJECTED: 'Rejected',
};

function waLink(phone?: string | null) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '');
  if (d.length === 10) d = `91${d}`;
  if (d.length < 10) return null;
  return `https://wa.me/${d}`;
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function WeddingInquiriesPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(1);
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('requestId'); if (id) setOpenId(id); }, []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['wedding-inquiries', q, status, kind, page],
    queryFn: () => portalApi.weddingInquiries({ kind, page, q: q || undefined, status: status || undefined }).then((r) => r.data),
    refetchInterval: 20000,
  });

  const { data: detailData } = useQuery({
    queryKey: ['wedding-inquiry', openId],
    queryFn: () => portalApi.weddingInquiry(openId!).then((r) => r.data),
    enabled: !!openId,
  });

  const inquiries = data?.inquiries || [];
  const detail = detailData?.inquiry || inquiries.find((i: any) => i.id === openId) || null;

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; inquiryStatus?: string; adminNote?: string }) =>
      portalApi.updateWeddingInquiry(id, body),
    onMutate: async ({ id, inquiryStatus }) => {
      if (!inquiryStatus) return {};
      await qc.cancelQueries({ queryKey: ['wedding-inquiries'] });
      const prev = qc.getQueryData(['wedding-inquiries', q, status, kind, page]);
      qc.setQueryData(['wedding-inquiries', q, status, kind, page], (old: any) => {
        if (!old?.inquiries) return old;
        return {
          ...old,
          inquiries: old.inquiries.map((i: any) =>
            i.id === id ? { ...i, inquiryStatus } : i,
          ),
        };
      });
      return { prev };
    },
    onError: (e: any, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['wedding-inquiries', q, status, kind, page], ctx.prev);
      toast.error(e?.response?.data?.error?.message || e?.response?.data?.error || 'Update failed');
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['wedding-inquiries'] });
      qc.invalidateQueries({ queryKey: ['wedding-inquiry', vars.id] });
      qc.invalidateQueries({ queryKey: ['portal-bookings'] });
      toast.success('Inquiry updated');
    },
  });

  const addNote = useMutation({
    mutationFn: () => portalApi.addWeddingInquiryNote(openId!, note.trim()),
    onSuccess: () => {
      setNote('');
      qc.invalidateQueries({ queryKey: ['wedding-inquiry', openId] });
      toast.success('Note saved');
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.error?.message || 'Could not save note');
    },
  });

  const filteredHint = useMemo(() => {
    if (!inquiries.length) return status || q ? 'No inquiries match this filter' : 'No inquiries yet';
    return `${inquiries.length} inquir${inquiries.length === 1 ? 'y' : 'ies'}`;
  }, [inquiries.length, status, q]);

  const form = detail?.form || {};
  const contact = form.contact || {};
  const phone = detail?.phone || contact.phone || detail?.customer?.phone;
  const email = detail?.email || contact.email || detail?.customer?.email;
  const wa = waLink(phone);

  return (
    <div className="animate-fade-up p-6 max-w-[1400px]">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--ink-3)' }}>
          Clients &amp; workflow
        </p>
        <h1 className="text-[28px] font-semibold tracking-tight mt-1" style={{ color: 'var(--ink)' }}>
          Quotation requests
        </h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--ink-2)' }}>
          Dates, venue, coverage, and budget from the client app. Use <strong>Make quote</strong> to open the quotation form.
        </p>
        <div className="flex gap-3 mt-4"><QuotationRequestLink/><Link href="/dashboard/quotes" className="btn-ghost px-4 py-2.5 text-sm">All quotations</Link></div>
      </header>

      <div className="flex flex-wrap gap-2 items-center mb-4">
        <select className="input max-w-xs" aria-label="Event type" value={kind} onChange={e=>{setKind(e.target.value);setPage(1);}}><option value="ALL">All events</option>{Array.from(new Set(['WEDDING','CORPORATE','ENGAGEMENT','PORTRAIT','BIRTHDAY','PRODUCT','OTHER',...inquiries.map((i:any)=>String(i.inquiryKind))])).map(k=><option key={k} value={k}>{k.charAt(0)+k.slice(1).toLowerCase()}</option>)}</select>
        <input
          value={q}
          onChange={(e) => {setQ(e.target.value);setPage(1);}}
          placeholder="Search name, phone, venue…"
          className="input max-w-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s.id || 'all'}
              type="button"
              onClick={() => {setStatus(s.id);setPage(1);}}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full border ${
                status === s.id ? 'opacity-100' : 'opacity-70'
              }`}
              style={{
                background: status === s.id ? 'var(--ink)' : 'var(--surface)',
                color: status === s.id ? 'var(--canvas)' : 'var(--ink)',
                borderColor: 'var(--line)',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-[12px] ml-auto" style={{ color: 'var(--ink-3)' }}>{filteredHint}</span>
      </div>

      {isError && <div className="card p-5 mb-4">Could not load requests. <button className="btn-secondary px-3 py-2" onClick={() => refetch()}>Try again</button></div>}
      <div className="overflow-auto rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ color: 'var(--ink-3)' }} className="text-left text-[11px] uppercase tracking-wide">
              <th className="px-4 py-3 font-semibold">ID</th>
              <th className="px-4 py-3 font-semibold">Client</th>
              <th className="px-4 py-3 font-semibold">Dates</th>
              <th className="px-4 py-3 font-semibold">Venue</th>
              <th className="px-4 py-3 font-semibold">Budget</th>
              <th className="px-4 py-3 font-semibold">Coverage</th>
              <th className="px-4 py-3 font-semibold">Submitted</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Quote</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="px-4 py-10 text-center" style={{ color: 'var(--ink-3)' }}>Loading…</td></tr>
            )}
            {!isLoading && inquiries.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center" style={{ color: 'var(--ink-3)' }}>{filteredHint}</td></tr>
            )}
            {inquiries.map((row: any) => (
              <tr
                key={row.id}
                className="border-t cursor-pointer hover:bg-[var(--surface-sunken)]"
                style={{ borderColor: 'var(--line)' }}
                onClick={() => setOpenId(row.id)}
              >
                <td className="px-4 py-3 font-mono text-[12px]">{row.shortId}</td>
                <td className="px-4 py-3 font-medium">{row.name || row.customer?.name || '—'}</td>
                <td className="px-4 py-3"><span className="block text-xs opacity-60">{row.form?.eventType || row.inquiryKind}</span>{row.datesLabel || '—'}</td>
                <td className="px-4 py-3 max-w-[180px] truncate">{row.venueLabel || '—'}</td>
                <td className="px-4 py-3">{row.budgetLabel || '—'}</td>
                <td className="px-4 py-3 max-w-[200px] truncate">{row.servicesLabel || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap">{fmtDate(row.createdAt)}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${badge[row.inquiryStatus] || 'badge-neutral'}`}>
                    {statusLabel[row.inquiryStatus] || row.inquiryStatus}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="btn-primary text-[12px] px-2.5 py-1.5"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (row.quote) { router.push(`/dashboard/quotes/${row.quote.id}`); return; }
                      try {
                        const r = await quoteApi.create({
                          leadId: row.id,
                          customerId: row.customer?.id || row.customerId,
                        });
                        const qid = r?.data?.quote?.id || r?.quote?.id;
                        if (!qid) throw new Error('No quote');
                        router.push(`/dashboard/quotes/${qid}`);
                      } catch (err: any) {
                        toast.error(err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || 'Could not open quotation');
                      }
                    }}
                  >
                    {row.quote ? 'Open quote' : 'Make quote'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data?.total || 0) > 30 && <div className="flex justify-between items-center mt-5"><button className="btn-secondary px-4 py-2" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><span className="text-sm">Page {page} of {Math.ceil(data.total / 30)}</span><button className="btn-secondary px-4 py-2" disabled={page * 30 >= data.total} onClick={() => setPage(p => p + 1)}>Next</button></div>}
      <SlideOver
        open={!!openId}
        onClose={() => setOpenId(null)}
        width="lg"
        title={detail?.name || 'Inquiry'}
        description={detail ? `${detail.shortId} · ${fmtDate(detail.createdAt)}` : ''}
        footer={
          detail ? (
            <div className="flex flex-wrap gap-2">
              {(detail.customer?.id || detail.customerId) && (
                <button
                  className="btn-primary text-[12px]"
                  onClick={async () => {
                    try {
                      const r = await quoteApi.create({
                        leadId: detail.id,
                        customerId: detail.customer?.id || detail.customerId,
                      });
                      const id = r?.data?.quote?.id || r?.quote?.id;
                      if (!id) throw new Error('No quote');
                      router.push(`/dashboard/quotes/${id}`);
                    } catch (e: any) {
                      toast.error(e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || 'Could not create quotation');
                    }
                  }}
                >
                  Create quotation
                </button>
              )}
              {detail.inquiryStatus !== 'IN_REVIEW' && detail.inquiryStatus !== 'REJECTED' && (
                <button
                  className="btn-secondary text-[12px]"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: detail.id, inquiryStatus: 'IN_REVIEW' })}
                >
                  Mark in review
                </button>
              )}
              {detail.inquiryStatus !== 'APPROVED' && detail.inquiryStatus !== 'BOOKED' && (
                <button
                  className="btn-primary text-[12px]"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: detail.id, inquiryStatus: 'APPROVED' })}
                >
                  Approve
                </button>
              )}
              {detail.inquiryStatus === 'APPROVED' && (
                <button
                  className="btn-primary text-[12px]"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: detail.id, inquiryStatus: 'BOOKED' })}
                >
                  Mark booked
                </button>
              )}
              {detail.inquiryStatus !== 'REJECTED' && detail.inquiryStatus !== 'BOOKED' && (
                <button
                  className="btn-secondary text-[12px]"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: detail.id, inquiryStatus: 'REJECTED' })}
                >
                  Reject
                </button>
              )}
            </div>
          ) : null
        }
      >
        {!detail ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>Loading…</p>
        ) : (
          <div className="space-y-5 text-[13px]">
            <div className="flex flex-wrap gap-2">
              <span className={`badge ${badge[detail.inquiryStatus] || 'badge-neutral'}`}>
                {statusLabel[detail.inquiryStatus] || detail.inquiryStatus}
              </span>
              {detail.customer?.id && (
                <Link href={`/dashboard/clients/${detail.customer.id}`} className="text-[12px] underline" style={{ color: 'var(--ink-2)' }}>
                  Open client
                </Link>
              )}
            </div>

            <ol className="space-y-2">
              {(detail.timeline || []).map((s: any) => (
                <li key={s.key} className="flex gap-2 items-start">
                  <span
                    className="mt-1 w-2 h-2 rounded-full shrink-0"
                    style={{
                      background:
                        s.state === 'done' || s.state === 'current'
                          ? 'var(--ink)'
                          : s.state === 'rejected'
                            ? 'var(--rose, #C2304A)'
                            : 'var(--line)',
                    }}
                  />
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--ink)' }}>{s.label}</div>
                    <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>{s.state}</div>
                  </div>
                </li>
              ))}
            </ol>

            <section className="grid grid-cols-2 gap-3">
              <Field label="Phone" value={phone} />
              <Field label="Email" value={email} />
              <Field label="Venue" value={detail.venueLabel} />
              <Field label="Coverage days" value={String(form.dates?.dayCount || form.dates?.days?.length || 1)} />
              <Field label="Team quantities" value={Object.entries(form.crewCounts || {}).map(([id, count]) => `${form.labels?.services?.[id] || id} × ${count}`).join(", ")} />
              <Field label="Dates" value={detail.datesLabel} /><Field label="Event" value={form.eventType || detail.inquiryKind} /><Field label="Organisation" value={form.organization} /><Field label="Duration" value={form.duration} /><Field label="Requested deliverables" value={form.deliverables} />
              {Array.isArray(form?.dates?.days) && form.dates.days.length > 0 && (
                <div className="col-span-2 space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
                    Day by day
                  </div>
                  {form.dates.days.map((d: any, i: number) => (
                    <div key={i} className="rounded-lg px-3 py-2" style={{ background: 'var(--surface-sunken)' }}>
                      <span className="font-semibold">Day {d.day || i + 1}</span>
                      {' · '}
                      {d.event || d.name || 'Event'}
                      {d.date ? ` · ${fmtDate(d.date)}` : ''}
                      {d.schedule ? ` · ${d.schedule}` : ''}
                      {Array.isArray(d.services) && d.services.length
                        ? ` · ${d.services.join(', ')}`
                        : ''}
                    </div>
                  ))}
                </div>
              )}
              <Field label="Schedule" value={detail.scheduleLabel} />
              <Field label="Budget" value={detail.budgetLabel} />
              <div className="col-span-2"><Field label="Coverage" value={detail.servicesLabel} /></div>
              {form.album ? (
                <Field
                  label="Album"
                  value={form.album.needed
                    ? `Yes · ${form.album.count || 1} album(s)${form.album.sheets ? ` · ${form.album.sheets} sheets` : ''}`
                    : 'No'}
                />
              ) : null}
              {form.guestCount ? <Field label="Guests" value={String(form.guestCount)} /> : null}
              {form.notes ? <div className="col-span-2"><Field label="Client notes" value={form.notes} /></div> : null}
            </section>

            <div className="flex flex-wrap gap-2">
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className="btn-secondary text-[12px] inline-flex items-center gap-1.5">
                  <MessageCircle size={14} /> WhatsApp
                </a>
              )}
              {phone && (
                <a href={`tel:${phone}`} className="btn-secondary text-[12px] inline-flex items-center gap-1.5">
                  <Phone size={14} /> Call
                </a>
              )}
              {email && (
                <a href={`mailto:${email}`} className="btn-secondary text-[12px] inline-flex items-center gap-1.5">
                  <Mail size={14} /> Email
                </a>
              )}
            </div>

            <section>
              <h3 className="font-semibold mb-2">Internal notes</h3>
              <div className="space-y-2 mb-3">
                {(detail.notes || []).length === 0 && (
                  <p style={{ color: 'var(--ink-3)' }}>No staff notes yet.</p>
                )}
                {(detail.notes || []).map((n: any) => (
                  <div key={n.id} className="rounded-lg p-2.5" style={{ background: 'var(--surface-sunken)' }}>
                    <div className="text-[11px] font-semibold" style={{ color: 'var(--ink-3)' }}>
                      {n.authorName || 'Studio'} · {fmtDate(n.createdAt)}
                    </div>
                    <div className="mt-0.5">{n.body}</div>
                  </div>
                ))}
              </div>
              <textarea
                className="input w-full min-h-[72px]"
                placeholder="Add an internal note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary mt-2 text-[12px]"
                disabled={!note.trim() || addNote.isPending}
                onClick={() => addNote.mutate()}
              >
                Save note
              </button>
            </section>
          </div>
        )}
      </SlideOver>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>{label}</div>
      <div className="mt-0.5" style={{ color: 'var(--ink)' }}>{value}</div>
    </div>
  );
}
