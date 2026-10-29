'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import ShareLinkButton from '@/components/ShareLinkButton';
import PdfUploadButton from '@/components/PdfUploadButton';
import QuotationRequestLink from '@/components/QuotationRequestLink';
import { quoteApi } from '@/lib/api';

const STEPS = [
  { id: 'event', title: 'Client & event' },
  { id: 'packages', title: 'Packages' },
  { id: 'addons', title: 'Add-ons' },
  { id: 'review', title: 'Review & send' },
] as const;

export default function QuoteEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [acceptedOption, setAcceptedOption] = useState('');
  const [acceptNote, setAcceptNote] = useState('');
  const [accepting, setAccepting] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['quote', id],
    queryFn: () => quoteApi.get(id).then((r) => r.data),
  });
  const { data: catalogData } = useQuery({
    queryKey: ['quote-catalog'],
    queryFn: () => quoteApi.catalog().then((r) => r.data),
  });
  const quote = data?.quote;
  const catalog = catalogData || { options: [], addOns: [] };

  const [clientName, setClientName] = useState('');
  const [venue, setVenue] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventType, setEventType] = useState('WEDDING');
  const [overview, setOverview] = useState('');
  const [terms,setTerms] = useState('');
  const [studioNote,setStudioNote] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!quote || hydrated) return;
    setClientName(quote.clientName || '');
    setVenue(quote.venue || '');
    setEventDate(quote.eventDate ? String(quote.eventDate).slice(0, 10) : '');
    setEventType(quote.eventType || 'WEDDING');
    setOverview(quote.overview || '');
    setTerms(quote.formData?.terms || ''); setStudioNote(quote.formData?.studioNote || '');
    setHydrated(true);
  }, [quote, hydrated]);

  const selectedIds: string[] = useMemo(() => {
    const fromForm = quote?.formData?.optionIds;
    if (Array.isArray(fromForm)) return fromForm as string[];
    return [];
  }, [quote, catalog]);

  const addOnIds: string[] = useMemo(() => {
    const fromForm = quote?.formData?.addOnIds;
    return Array.isArray(fromForm) ? (fromForm as string[]) : [];
  }, [quote]);

  const save = useMutation({
    mutationFn: (body: any) => quoteApi.save(id, body),
    onSuccess: async (r) => {
      qc.setQueryData(['quote', id], r.data);
      await qc.invalidateQueries({ queryKey: ['quote', id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Save failed'),
  });

  const headerChanged = !!quote && (clientName !== (quote.clientName || '') || venue !== (quote.venue || '') || eventDate !== (quote.eventDate ? String(quote.eventDate).slice(0, 10) : '') || eventType !== (quote.eventType || 'WEDDING') || overview !== (quote.overview || '') || terms !== (quote.formData?.terms || '') || studioNote !== (quote.formData?.studioNote || ''));

  const persistHeader = () =>
    (['APPROVED', 'CONVERTED'].includes(quote?.status) || (quote?.status === 'SENT' && !headerChanged)) ? Promise.resolve() : save.mutateAsync({
      clientName,
      venue,
      eventDate: eventDate || null,
      eventType,
      overview,
      formData: {terms,studioNote},
      updatedAt: quote?.updatedAt,
      optionIds: selectedIds,
      addOnIds,
    });

  const finalize = useMutation({
    mutationFn: async () => {
      await persistHeader();
      return quoteApi.finalize(id);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['quote', id] });
      qc.invalidateQueries({ queryKey: ['quotes'] });
      if (r.data?.notification?.sent) toast.success('Quotation published and sent on WhatsApp');
      else toast.success('Quotation published in the client app. WhatsApp was not sent; you can share the app link.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Could not send'),
  });

  const convert = useMutation({
    mutationFn: () => quoteApi.convert(id),
    onSuccess: (r: any) => {
      const aid = r?.data?.agreementId || r?.agreementId;
      const cid = quote?.customerId || r?.data?.quote?.customerId;
      toast.success('Opened as agreement');
      if (aid && cid) router.push(`/dashboard/clients/${cid}/agreement?id=${aid}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || 'Convert failed'),
  });

  const money = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n || 0);

  const toggleOption = (oid: string) => {
    if (['APPROVED', 'CONVERTED'].includes(quote?.status)) return;
    const next = selectedIds.includes(oid) ? selectedIds.filter((x) => x !== oid) : [...selectedIds, oid];
    save.mutate({ optionIds: next, addOnIds, clientName, venue, eventDate, eventType, overview, formData: {terms,studioNote}, updatedAt: quote.updatedAt });
  };

  const toggleAddOn = (aid: string) => {
    if (['APPROVED', 'CONVERTED'].includes(quote?.status)) return;
    const next = addOnIds.includes(aid) ? addOnIds.filter((x) => x !== aid) : [...addOnIds, aid];
    save.mutate({ optionIds: selectedIds, addOnIds: next, clientName, venue, eventDate, eventType, overview, formData: {terms,studioNote}, updatedAt: quote.updatedAt });
  };

  if (isLoading) {
    return <div className="text-sm" style={{ color: 'var(--ink-3)' }}>Opening quotation form…</div>;
  }
  if (isError || !quote) {
    return (
      <div>
        <p className="text-sm" style={{ color: 'var(--rose)' }}>
          {(error as any)?.response?.data?.error?.message || 'Could not load this quotation.'}
        </p>
        <Link href="/dashboard/quotes" className="text-[13px] underline mt-3 inline-block">Back to quotations</Link>
      </div>
    );
  }

  const snap = quote.pricingSnapshot || {};
  const eventLabel = eventType === 'WEDDING' ? 'Wedding' : eventType === 'CORPORATE' ? 'Corporate' : eventType === 'ENGAGEMENT' ? 'Engagement' : 'Event';
  const request = quote.formData?.request;

  return (
    <div className="max-w-3xl">
      <Link href="/dashboard/quotes" className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
        ← All quotations
      </Link>
      <h1 className="font-display text-[28px] mt-2" style={{ color: 'var(--ink)' }}>
        {eventLabel} quotation
      </h1>
      <p className="text-[13px] mt-1" style={{ color: 'var(--ink-2)' }}>
        {quote.clientName || 'Client'} · {quote.status}
      </p>

      <div className="flex flex-wrap gap-2 mt-4">
        {quote.leadId && <QuotationRequestLink quoteId={id}/>}
        {quote.status !== 'DRAFT' && <ShareLinkButton path={`/quotes?id=${id}`} />}
        <PdfUploadButton endpoint={`/admin/quotes/${id}/pdf`} updatedAt={quote.updatedAt} beforeUpload={async () => { if (headerChanged) { const r = await persistHeader(); return r?.data?.quote?.updatedAt; } return quote.updatedAt; }} disabled={save.isPending || finalize.isPending || !['DRAFT', 'SENT'].includes(quote.status)} onUploaded={async () => { await qc.invalidateQueries({ queryKey: ['quote', id] }); await qc.invalidateQueries({ queryKey: ['quotes'] }); await qc.invalidateQueries({ queryKey: ['wedding-inquiries'] }); }} />
      </div>
      {quote.hasPdf && <button type="button" className="btn-secondary px-4 py-2 mt-3" onClick={async () => { try { const r = await quoteApi.pdf(id); window.open(r.data.url, '_blank', 'noopener,noreferrer'); } catch { toast.error('Could not open PDF'); } }}>View quotation PDF</button>}
      {request?.kind && <section className="card p-5 mt-5">
        <h2 className="font-semibold">Client’s quotation request</h2>
        <dl className="grid sm:grid-cols-2 gap-4 mt-4 text-sm">
          <div><dt className="opacity-60">Dates & coverage</dt><dd>{request.dates?.flexible ? 'Dates to be decided' : [request.dates?.start, request.dates?.end].filter(Boolean).join(' – ')} · {quote.formData.dayCount} days</dd></div>
          <div><dt className="opacity-60">Location</dt><dd>{[request.venue?.location, request.venue?.city].filter(Boolean).join(', ')}</dd></div>
          <div><dt className="opacity-60">Coverage & quantities</dt><dd>{(request.services || []).map((s: string) => `${request.labels?.services?.[s] || s} × ${request.crewCounts?.[s] || 1}`).join(', ')}</dd></div>
          <div><dt className="opacity-60">Physical album</dt><dd>{request.album?.needed ? `Yes · ${request.album.count || 1} album(s)` : 'No'}</dd></div>
          {request.guestCount && <div><dt className="opacity-60">Guests</dt><dd>{request.guestCount}</dd></div>}
          {request.organization && <div><dt className="opacity-60">Organisation</dt><dd>{request.organization}</dd></div>}
          <div><dt className="opacity-60">Contact</dt><dd>{[request.contact?.name, request.contact?.phone, request.contact?.email].filter(Boolean).join(' · ')}</dd></div>
          {request.deliverables && <div><dt className="opacity-60">Requested deliverables</dt><dd className="whitespace-pre-wrap">{request.deliverables}</dd></div>}
          {request.notes && <div className="sm:col-span-2"><dt className="opacity-60">Client notes</dt><dd className="whitespace-pre-wrap">{request.notes}</dd></div>}
        </dl>
      </section>}
      {quote.status === 'SENT' && (snap.alternatives || []).length > 0 && <div className="card p-5 mt-5 space-y-3">
        <h2 className="font-semibold">Record the client’s acceptance</h2>
        <p className="text-sm">Choose the agreed package after the client confirms it. Sending a quotation does not create an invoice.</p>
        <select aria-label="Accepted package" className="input w-full" value={acceptedOption} onChange={e => setAcceptedOption(e.target.value)}>
          <option value="">Choose one package</option>
          {(snap.alternatives || []).map((o: any) => <option key={o.optionId} value={o.optionId}>{o.title} · {money(o.total)}</option>)}
        </select>
        <input className="input w-full" aria-label="Acceptance note (optional)" placeholder="How and when did the client confirm? (optional)" value={acceptNote} onChange={e => setAcceptNote(e.target.value)} />
        <button className="btn-primary px-4 py-2" disabled={accepting || save.isPending || finalize.isPending || !acceptedOption} onClick={async () => {
          setAccepting(true); try { await quoteApi.accept(id, acceptedOption, acceptNote, quote.updatedAt); await qc.invalidateQueries({ queryKey: ['quote', id] }); toast.success('Acceptance recorded'); }
          catch (e: any) { toast.error(e?.response?.data?.error?.message || 'Could not record acceptance'); } finally { setAccepting(false); }
        }}>Record acceptance</button>
      </div>}
      {['APPROVED', 'CONVERTED'].includes(quote.status) && <p className="mt-4">Agreed package and prices are locked. {quote.status === 'APPROVED' ? 'Create the booking and invoice below.' : 'Booking and invoice created.'}</p>}
      <div className="flex gap-2 mt-5 mb-6 flex-wrap">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(i)}
            className="px-3 py-1.5 rounded-full text-[12px] font-semibold border"
            style={{
              background: step === i ? 'var(--ink)' : 'var(--surface)',
              color: step === i ? '#fff' : 'var(--ink-2)',
              borderColor: 'var(--line)',
            }}
          >
            {i + 1}. {s.title}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="card p-5 space-y-3">
          <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            Header of the PDF: name, date, venue.
          </p>
          <label className="block text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>Client name</label>
          <input className="input w-full" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          <label className="block text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>Event date</label>
          <input className="input w-full" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          <label className="block text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>Venue / location</label>
          <input className="input w-full" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Hotel, city…" />
          <label className="block text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>Overview</label>
          <textarea
            className="input w-full min-h-[100px]"
            value={overview}
            onChange={(e) => setOverview(e.target.value)}
            placeholder="Thank you for considering SJ Clicks & Films…"
          />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            Tick the packages that appear on the quotation (Option 1 / Option 2).
          </p>
          {(catalog.options || []).length === 0 && (
            <div className="card p-5 text-sm" style={{ color: 'var(--ink-3)' }}>
              Loading packages… If this stays empty, refresh the page.
            </div>
          )}
          {(catalog.options || []).map((o: any, idx: number) => {
            const on = selectedIds.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={save.isPending || finalize.isPending || !['DRAFT', 'SENT'].includes(quote.status)}
                onClick={() => toggleOption(o.id)}
                className="card p-5 w-full text-left"
                style={{ outline: on ? '2px solid var(--gold)' : undefined }}
              >
                <div className="flex justify-between gap-3 items-start">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
                      Option {idx + 1} {o.recommended ? '· recommended' : ''}
                    </div>
                    <div className="font-semibold mt-1" style={{ color: 'var(--ink)' }}>{o.title}</div>
                    {o.subtitle ? <div className="text-[13px] mt-1" style={{ color: 'var(--ink-2)' }}>{o.subtitle}</div> : null}
                  </div>
                  <div className="font-semibold shrink-0">{money(o.price)}</div>
                </div>
                {Array.isArray(o.crew) && o.crew.length > 0 && (
                  <ul className="mt-3 text-[13px] space-y-1" style={{ color: 'var(--ink-2)' }}>
                    {o.crew.map((c: any, i: number) => (
                      <li key={i}>{c.count || 1} {c.role}{c.blurb ? ` — ${c.blurb}` : ''}</li>
                    ))}
                  </ul>
                )}
                {Array.isArray(o.deliverables) && o.deliverables.length > 0 && (
                  <ul className="mt-3 text-[13px] space-y-1" style={{ color: 'var(--ink-2)' }}>
                    {o.deliverables.map((d: any, i: number) => (
                      <li key={i}>{typeof d === 'string' ? d : [d.title, d.spec].filter(Boolean).join(' — ')}</li>
                    ))}
                  </ul>
                )}
                <div className="text-[12px] mt-3 font-semibold" style={{ color: on ? 'var(--ink)' : 'var(--ink-3)' }}>
                  {on ? 'Included on this quotation' : 'Tap to include'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && (<div className="card p-5 mb-5 space-y-4"><label className="block text-sm">Terms &amp; delivery<textarea className="input mt-2" rows={5} value={terms} onChange={e=>setTerms(e.target.value)} placeholder="Coverage, delivery, usage and cancellation terms"/></label><label className="block text-sm">Studio introduction (optional)<textarea className="input mt-2" rows={3} value={studioNote} onChange={e=>setStudioNote(e.target.value)}/></label><p className="text-xs opacity-60">The invoice uses the studio payment schedule. These terms carry into the agreement and invoice.</p></div>)}
      {step === 2 && (
        <div className="space-y-2">
          <p className="text-[13px] mb-2" style={{ color: 'var(--ink-2)' }}>
            Optional extras (album, extra day, gear).
          </p>
          {(catalog.addOns || []).map((a: any) => {
            const on = addOnIds.includes(a.id);
            return (
              <label key={a.id} className="card p-4 flex items-start justify-between gap-3 cursor-pointer">
                <span>
                  <span className="font-medium block" style={{ color: 'var(--ink)' }}>{a.title}</span>
                  {Array.isArray(a.specs) && a.specs[0] ? (
                    <span className="text-[12px] block mt-1" style={{ color: 'var(--ink-3)' }}>{a.specs[0]}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold">{money(a.price)}</span>
                  <input type="checkbox" disabled={save.isPending || finalize.isPending || !['DRAFT', 'SENT'].includes(quote.status)} checked={on} onChange={() => toggleAddOn(a.id)} />
                </span>
              </label>
            );
          })}
        </div>
      )}

      {step === 3 && (
        <div className="card p-5 space-y-3">
          <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            {clientName || 'Client'} · {venue || 'Venue TBD'}
            {eventDate ? ` · ${eventDate}` : ''}
          </div>
          {(snap.alternatives || []).length > 1 && <div className="space-y-2"><p>Choose one package. These totals are alternatives.</p>{snap.alternatives.map((o: any) => <div key={o.optionId} className="border-b py-2"><strong>{o.title}: {money(o.total)}</strong><p className="text-sm">Subtotal {money(o.subtotal)} · Tax {money(o.tax)}</p></div>)}</div>}
          {(snap.alternatives || []).length <= 1 && <><div className="flex justify-between text-[14px]">
            <span>Subtotal</span><strong>{money(snap.subtotal || 0)}</strong>
          </div>
          {Number(snap.tax || 0) > 0 && (
            <div className="flex justify-between text-[14px]">
              <span>Tax</span><strong>{money(snap.tax)}</strong>
            </div>
          )}
          <div className="flex justify-between text-[16px] pt-2" style={{ borderTop: '1px solid var(--line)' }}>
            <span>Total</span><strong>{money(snap.total || 0)}</strong>
          </div></>}
          {snap.invoiceNumber ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
              Invoice {snap.invoiceNumber} created and sent on WhatsApp.
            </p>
          ) : null}
          <p className="text-[12px] pt-2" style={{ color: 'var(--ink-3)' }}>
            Review all prices and terms before sending. The accepted option is used for the booking and invoice.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-6">
        {step > 0 && (
          <button type="button" className="btn-ghost px-4 py-2.5" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 && (
          <button
            type="button"
            className="btn-primary px-4 py-2.5"
            disabled={save.isPending || finalize.isPending}
            onClick={async () => {
              try { await persistHeader(); setStep(step + 1); } catch { /* Save error remains visible. */ }
            }}
          >
            Next
          </button>
        )}
        {step === STEPS.length - 1 && (
          <button type="button" className="btn-primary px-4 py-2.5" disabled={save.isPending || finalize.isPending || !selectedIds.length || !['DRAFT', 'SENT'].includes(quote.status)} onClick={() => finalize.mutate()}>
            {finalize.isPending ? 'Sending…' : 'Finalize & send PDF'}
          </button>
        )}
        <button type="button" className="btn-ghost px-4 py-2.5" disabled={convert.isPending || !['APPROVED', 'CONVERTED'].includes(quote.status)} onClick={() => convert.mutate()}>
          Create booking & invoice
        </button>
        {(quote.hasPdf || quote.status === 'SENT') && (
          <button
            type="button"
            className="btn-ghost px-4 py-2.5"
            onClick={async () => {
              try {
                const r = await quoteApi.pdf(id);
                const url = r?.data?.url || r?.url;
                if (url) window.open(url, '_blank');
                else toast.error('PDF not ready yet — finalize first');
              } catch {
                toast.error('PDF not ready yet — finalize first');
              }
            }}
          >
            View PDF
          </button>
        )}
      </div>
    </div>
  );
}
