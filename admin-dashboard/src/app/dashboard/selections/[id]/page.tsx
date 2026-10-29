'use client';

import { use, useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, Unlock, Check, Image as ImageIcon, Clock } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type Delivery = 'RAW' | 'EDITED' | null;

function fmtTs(v: string | number | null | undefined) {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

function PhotoCard({
  it,
  t,
  billed,
  canTag,
  setType,
  accent,
}: {
  it: any;
  t: Delivery;
  billed: boolean;
  canTag: boolean;
  setType: (photoId: string, t: Delivery) => void;
  accent: 'included' | 'extra';
}) {
  return (
    <div
      className="card overflow-hidden flex flex-col"
      style={{
        outline: accent === 'included'
          ? '2px solid color-mix(in srgb, var(--green) 55%, transparent)'
          : t === 'RAW'
            ? '2px solid color-mix(in srgb, var(--amber) 70%, transparent)'
            : t === 'EDITED'
              ? '2px solid color-mix(in srgb, var(--green) 70%, transparent)'
              : '2px solid color-mix(in srgb, var(--amber) 40%, transparent)',
      }}
    >
      <div className="aspect-square bg-[var(--surface-sunken)] relative">
        {it.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={it.thumbnailUrl} alt={it.filename || ''} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs" style={{ color: 'var(--ink-3)' }}>
            <ImageIcon size={20} />
          </div>
        )}
        <span
          className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded text-[10px] font-bold text-white backdrop-blur"
          style={{ background: accent === 'included' ? 'rgba(22,163,74,0.9)' : 'rgba(217,119,6,0.92)' }}
        >
          {accent === 'included' ? 'INCLUDED' : 'EXTRA'}
        </span>
        <span className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-black/75 text-white backdrop-blur">
          Batch #{it.batchNumber || 1}
        </span>
      </div>
      <div className="px-2 py-2 space-y-1.5">
        <div className="text-[10px] truncate" style={{ color: 'var(--ink-3)' }} title={it.filename}>
          {it.filename || it.photoId?.slice(0, 8)}
        </div>
        {it.submittedAt && (
          <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--ink-3)' }}>
            <Clock size={10} />
            <span>{fmtTs(it.submittedAt)}</span>
          </div>
        )}
        {accent === 'extra' && (
          <div className="text-[11px] font-semibold" style={{ color: 'var(--amber)' }}>
            Extra
          </div>
        )}
        {accent === 'included' && (
          <div className="text-[11px] font-semibold" style={{ color: 'var(--green)' }}>
            Package covered
          </div>
        )}
      </div>
    </div>
  );
}

export default function SelectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [local, setLocal] = useState<Record<string, Delivery>>({});
  const [view, setView] = useState<'all' | 'included' | 'extras'>('all');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['selection', id],
    queryFn: () => adminApi.getSelection(id).then((r) => r.data),
  });

  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);

  useEffect(() => {
    if (!data?.items) return;
    const map: Record<string, Delivery> = {};
    for (const it of data.items) {
      const t = it.deliveryType === 'RAW' || it.deliveryType === 'EDITED' ? it.deliveryType : null;
      map[it.photoId] = t;
    }
    setLocal(map);
  }, [data?.id, data?.items]);

  useEffect(() => {
    if (!data?.id) return;
    qc.invalidateQueries({ queryKey: ['selections'] });
    qc.invalidateQueries({ queryKey: ['customer'] });
  }, [data?.id, qc]);

  const unlockMutation = useMutation({
    mutationFn: (mode: 'INCLUDED' | 'EXTRAS') => adminApi.unlockSelection(id, mode),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['selection', id] });
      qc.invalidateQueries({ queryKey: ['selections'] });
      toast.success(r?.data?.message || r?.message || 'Unlocked for client');
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Failed'),
  });

  const classifyMutation = useMutation({
    mutationFn: (body: any) => adminApi.classifySelection(id, body),
    onSuccess: (res: any) => {
      const body = res?.data || res;
      qc.setQueryData(['selection', id], (old: any) => ({
        ...(old || {}),
        ...(body || {}),
        items: body?.items || old?.items,
        bill: body?.bill,
        rates: body?.rates,
        deliveryStatus: body?.deliveryStatus,
      }));
      if (body?.items) {
        const map: Record<string, Delivery> = {};
        for (const it of body.items) {
          map[it.photoId] = it.deliveryType === 'RAW' || it.deliveryType === 'EDITED' ? it.deliveryType : null;
        }
        setLocal(map);
      }
      toast.success('Classification saved');
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Classify failed'),
  });

  const billMutation = useMutation({
    mutationFn: () => adminApi.billSelection(id),
    onSuccess: (res: any) => {
      const body = res?.data || res;
      qc.invalidateQueries({ queryKey: ['selection', id] });
      qc.invalidateQueries({ queryKey: ['selections'] });
      const inv = body?.invoice;
      const total = body?.bill?.overageTotal ?? 0;
      toast.success(
        total > 0
          ? `₹${Number(total).toLocaleString('en-IN')} added to ${inv?.invoiceNumber || 'invoice'}`
          : `Billed — no extras (${inv?.invoiceNumber || 'invoice'})`,
        { duration: 5000 },
      );
      refetch();
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Bill failed'),
  });

  const downloadCsv = async () => {
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(adminApi.exportSelectionCsvUrl(id), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `selection-${id.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not download CSV');
    }
  };

  const setType = (photoId: string, t: Delivery) => {
    setLocal((prev) => ({ ...prev, [photoId]: t }));
  };

  const saveClassifications = () => {
    const classifications = Object.entries(local).map(([photoId, deliveryType]) => ({
      photoId,
      deliveryType: deliveryType || null,
    }));
    classifyMutation.mutate({ classifications });
  };

  const liveBill = useMemo(() => {
    if (!data) return null;
    const rates = data.rates || {
      includedPhotos: data.includedLimit ?? data.estimate?.includedPhotos ?? 0,
      pricePerExtraRaw: data.rawUnitPrice ?? 200,
      pricePerExtraEdited: data.editedUnitPrice ?? 350,
    };
    const items = (data.items || []).map((it: any) => ({
      deliveryType: it.isIncluded
        ? 'INCLUDED'
        : (local[it.photoId] ?? it.deliveryType ?? null),
      isIncluded: it.isIncluded,
    }));
    const extras = items.filter((i: any) => !i.isIncluded && i.deliveryType !== 'INCLUDED');
    const freePool = Number(rates.includedPhotos ?? rates.freePool ?? data.includedLimit ?? 0);
    const freeUsed = items.filter((i: any) => i.isIncluded || i.deliveryType === 'INCLUDED').length;
    const extraRate = Number(rates.pricePerExtraEdited ?? rates.pricePerExtraPhoto ?? data.editedUnitPrice ?? 350);
    const extraAmount = extras.length * extraRate;
    return {
      pending: 0,
      extraCount: extras.length,
      extraRate,
      extraAmount,
      freeUsed,
      freePool,
      total: extraAmount,
      fullyClassified: true,
    };
  }, [data, local]);

  if (isLoading) {
    return <div className="text-center py-14 text-sm" style={{ color: 'var(--ink-3)' }}>Loading…</div>;
  }
  if (isError || !data) {
    return (
      <div className="text-center py-14 text-sm" style={{ color: 'var(--rose)' }}>
        Selection not found.{' '}
        <Link href="/dashboard/selections" className="underline">Back</Link>
      </div>
    );
  }

  const items = data.items || [];
  const includedItems = data.includedItems || items.filter((i: any) => i.isIncluded || i.badge === 'INCLUDED' || i.deliveryType === 'INCLUDED');
  const extraItems = data.extraItems || items.filter((i: any) => i.isExtra || i.badge === 'EXTRA' || i.deliveryType === 'RAW' || i.deliveryType === 'EDITED');
  const billed = data.deliveryStatus === 'BILLED';
  const money = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

  const includedPart = data.partitions?.included;
  const extrasPart = data.partitions?.extras;

  const filtered = (() => {
    let base = view === 'included' ? includedItems : view === 'extras' ? extraItems : items;
    if (selectedBatch != null) base = base.filter((it: any) => (it.batchNumber || 1) === selectedBatch);
    return base;
  })();

  return (
    <div className="animate-fade-up">
      <Link href="/dashboard/selections" className="inline-flex items-center gap-2 text-sm mb-6" style={{ color: 'var(--ink-2)' }}>
        <ArrowLeft size={16} /> Back to selections
      </Link>

      <div className="card p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="kicker mb-2">
              Selection
              {data.deliveryStatus === 'BILLED' ? ' · Billed' : data.deliveryStatus === 'CLASSIFIED' ? ' · Classified' : ' · In progress'}
            </p>
            <h1 className="font-display text-[28px] leading-tight" style={{ color: 'var(--ink)' }}>
              {data.customer?.name}
            </h1>
            <p className="text-[14px] mt-1" style={{ color: 'var(--ink-2)' }}>
              {data.gallery?.name} · {items.length} photo{items.length === 1 ? '' : 's'}
              {data.submittedAt ? ` · last submit ${fmtTs(data.submittedAt)}` : ''}
            </p>
            {data.customerNote && (
              <p className="text-[13px] mt-3 italic" style={{ color: 'var(--ink-3)' }}>
                Client note: {data.customerNote}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(data.status === 'SUBMITTED' || data.status === 'UNLOCKED') && (
              <>
                <button
                  type="button"
                  onClick={() => unlockMutation.mutate('EXTRAS')}
                  disabled={unlockMutation.isPending}
                  className="btn-ghost flex items-center gap-2 px-3 py-2.5"
                  title="Included photos stay locked. Client can add or remove extras in the cart."
                >
                  <Unlock size={15} /> Unlock extras cart
                </button>
                <button
                  type="button"
                  onClick={() => unlockMutation.mutate('INCLUDED')}
                  disabled={unlockMutation.isPending}
                  className="btn-ghost flex items-center gap-2 px-3 py-2.5"
                  title="Client can change package picks, then lock again. Billed extras stay billed."
                >
                  <Unlock size={15} /> Reopen included
                </button>
              </>
            )}
            <button type="button" onClick={downloadCsv} className="btn-ghost flex items-center gap-2 px-3 py-2.5">
              <Download size={15} /> Export CSV
            </button>
            {data.customer?.id && (
              <Link href={`/dashboard/clients/${data.customer.id}`} className="btn-ghost px-3 py-2.5">
                View client
              </Link>
            )}
          </div>
        </div>

        {/* Included vs Extras summary with timestamps */}
        <div className="mt-5 grid sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setView(view === 'included' ? 'all' : 'included')}
            className="text-left rounded-xl p-4 transition-all"
            style={{
              background: view === 'included' ? 'color-mix(in srgb, #16a34a 10%, var(--surface))' : 'var(--canvas)',
              border: view === 'included' ? '2px solid #16a34a' : '1px solid var(--line)',
            }}
          >
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--green)' }}>Included</p>
            <p className="text-[22px] font-semibold mt-1" style={{ color: 'var(--ink)' }}>
              {includedItems.length}
              <span className="text-[13px] font-normal ml-1" style={{ color: 'var(--ink-3)' }}>
                of {includedPart?.limit ?? data.includedLimit ?? liveBill?.freePool ?? '—'} package
              </span>
            </p>
            <p className="text-[12px] mt-2 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
              <Clock size={12} />
              {fmtTs(includedPart?.lastSubmittedAt) || fmtTs(includedItems[0]?.submittedAt) || '—'}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setView(view === 'extras' ? 'all' : 'extras')}
            className="text-left rounded-xl p-4 transition-all"
            style={{
              background: view === 'extras' ? 'color-mix(in srgb, #d97706 10%, var(--surface))' : 'var(--canvas)',
              border: view === 'extras' ? '2px solid #d97706' : '1px solid var(--line)',
            }}
          >
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--amber)' }}>Extras</p>
            <p className="text-[22px] font-semibold mt-1" style={{ color: 'var(--ink)' }}>
              {extraItems.length}
              <span className="text-[13px] font-normal ml-1" style={{ color: 'var(--ink-3)' }}>
                ₹{Number(data.rates?.pricePerExtraEdited ?? data.editedUnitPrice ?? 350)} each
              </span>
            </p>
            <p className="text-[12px] mt-2 flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
              <Clock size={12} />
              {fmtTs(extrasPart?.lastSubmittedAt) || fmtTs(extraItems[0]?.submittedAt) || 'None yet'}
            </p>
          </button>
        </div>

        {Array.isArray(data.history) && data.history.length > 0 && (
          <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--ink)' }}>
              Submission timeline
            </h3>
            <div className="space-y-2">
              {data.history.map((h: any, idx: number) => {
                const bNum = h.batchNumber || idx + 1;
                const isSelected = selectedBatch === bNum;
                const kind = h.kind || (h.extraCount > 0 ? 'EXTRAS' : 'INCLUDED');
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedBatch(isSelected ? null : bNum)}
                    className="p-3 rounded-lg flex items-center justify-between gap-3 text-[13px] cursor-pointer transition-all"
                    style={{
                      background: isSelected ? 'color-mix(in srgb, #0284c7 10%, var(--surface))' : 'var(--canvas)',
                      border: isSelected ? '2px solid #0284c7' : '1px solid var(--line)',
                    }}
                  >
                    <div>
                      <div className="font-semibold flex items-center gap-2 flex-wrap" style={{ color: 'var(--ink)' }}>
                        <span>Batch #{bNum}</span>
                        <span
                          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded text-white"
                          style={{ background: kind === 'EXTRAS' ? '#d97706' : '#16a34a' }}
                        >
                          {kind === 'EXTRAS' ? 'Extra selection' : 'Included selection'}
                        </span>
                        <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{fmtTs(h.submittedAt)}</span>
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
                        {h.count} photo{h.count === 1 ? '' : 's'}
                        {h.extraCount > 0 ? ` · ${h.extraCount} extras` : ' · package included'}
                      </div>
                    </div>
                    <span className="text-[11px] font-semibold text-sky-600 shrink-0">
                      {isSelected ? 'Showing' : 'View →'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {liveBill && data.status === 'SUBMITTED' && (
        <div className="card p-5 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="kicker mb-1">Extras bill</p>
              <h2 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
                {extraItems.length === 0
                  ? 'No extras yet'
                  : (liveBill.total > 0 ? money(liveBill.total) + ' extras' : 'No extra charge')}
              </h2>
              <ul className="mt-3 text-[13px] space-y-1" style={{ color: 'var(--ink-2)' }}>
                <li>{includedItems.length} included (of {liveBill.freePool} package) · {extraItems.length} extras</li>
                <li>
                  {extraItems.length} extra
                  {extraItems.length > 0 ? ` × ₹${liveBill.extraRate} = ${money(liveBill.extraAmount)}` : ''}
                </li>
              </ul>
              {data.overageInvoice && (
                <p className="text-[13px] mt-3" style={{ color: 'var(--ink)' }}>
                  Linked extras invoice{' '}
                  <Link
                    href={`/dashboard/invoices?focus=${data.overageInvoice.id}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    {data.overageInvoice.invoiceNumber}
                  </Link>
                  {' · '}balance {money(Number(data.overageInvoice.balance || 0))}
                </p>
              )}
            </div>
            {extraItems.length > 0 && (
              <div className="flex flex-col gap-2 min-w-[200px]">
                <button
                  type="button"
                  className="btn-primary px-3 py-2.5 text-[13px] flex items-center justify-center gap-2"
                  disabled={liveBill.pending > 0 || billMutation.isPending || billed}
                  onClick={() => billMutation.mutate()}
                  style={billed ? { opacity: 0.7 } : undefined}
                >
                  <Check size={15} />
                  {billed
                    ? 'Already billed'
                    : billMutation.isPending
                      ? 'Billing…'
                      : liveBill.total > 0
                        ? `Confirm & bill ${money(liveBill.total)}`
                        : 'Confirm & bill (₹0)'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 rounded-xl card">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>Show:</span>
          {([
            ['all', `All (${items.length})`],
            ['included', `Included (${includedItems.length})`],
            ['extras', `Extras (${extraItems.length})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === key ? 'bg-sky-600 text-white' : 'btn-ghost'}`}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
          {Array.isArray(data.history) && data.history.map((h: any, idx: number) => {
            const bNum = h.batchNumber || idx + 1;
            const active = selectedBatch === bNum;
            return (
              <button
                key={idx}
                type="button"
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${active ? 'bg-sky-600 text-white' : 'btn-ghost'}`}
                onClick={() => setSelectedBatch(active ? null : bNum)}
              >
                Batch #{bNum}
              </button>
            );
          })}
        </div>
      </div>

      {/* Included section */}
      {(view === 'all' || view === 'included') && (
        <section className="mb-8">
          <div className="flex items-end justify-between gap-3 mb-3">
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>Included selection</h2>
              <p className="text-[12px]" style={{ color: 'var(--ink-2)' }}>
                Package-covered picks
                {fmtTs(includedPart?.firstSubmittedAt) ? ` · first ${fmtTs(includedPart?.firstSubmittedAt)}` : ''}
                {fmtTs(includedPart?.lastSubmittedAt) ? ` · latest ${fmtTs(includedPart?.lastSubmittedAt)}` : ''}
              </p>
            </div>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--green)' }}>
              {view === 'all' ? includedItems.length : filtered.filter((i: any) => i.isIncluded || i.badge === 'INCLUDED').length} photos
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {(view === 'included' ? filtered : includedItems.filter((it: any) => selectedBatch == null || (it.batchNumber || 1) === selectedBatch)).map((it: any) => (
              <PhotoCard
                key={it.photoId}
                it={it}
                t={null}
                billed={billed}
                canTag={false}
                setType={setType}
                accent="included"
              />
            ))}
          </div>
          {(view === 'included' ? filtered : includedItems).length === 0 && (
            <div className="card text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>No included photos yet.</div>
          )}
        </section>
      )}

      {/* Extras section */}
      {(view === 'all' || view === 'extras') && (
        <section className="mb-8">
          <div className="flex items-end justify-between gap-3 mb-3">
            <div>
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>Extras selection</h2>
              <p className="text-[12px]" style={{ color: 'var(--ink-2)' }}>
                Extra photos at the extra rate
                {fmtTs(extrasPart?.firstSubmittedAt) ? ` · first ${fmtTs(extrasPart?.firstSubmittedAt)}` : ''}
                {fmtTs(extrasPart?.lastSubmittedAt) ? ` · latest ${fmtTs(extrasPart?.lastSubmittedAt)}` : ''}
              </p>
            </div>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--amber)' }}>
              {(view === 'extras' ? filtered : extraItems).length} photos
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {(view === 'extras' ? filtered : extraItems.filter((it: any) => selectedBatch == null || (it.batchNumber || 1) === selectedBatch)).map((it: any) => (
              <PhotoCard
                key={it.photoId}
                it={it}
                t={local[it.photoId] ?? null}
                billed={billed}
                canTag={false}
                setType={setType}
                accent="extra"
              />
            ))}
          </div>
          {(view === 'extras' ? filtered : extraItems).length === 0 && (
            <div className="card text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>
              No extras yet — client can add them in step 2 after included submit.
            </div>
          )}
        </section>
      )}

      {items.length === 0 && (
        <div className="card text-center py-12 text-sm" style={{ color: 'var(--ink-3)' }}>No photos in this selection.</div>
      )}
    </div>
  );
}
