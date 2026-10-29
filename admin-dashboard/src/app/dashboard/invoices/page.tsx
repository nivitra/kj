'use client';
import ShareLinkButton from '@/components/ShareLinkButton';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, Eye, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { adminApi, billingApi, portalApi } from '@/lib/api';
import Modal from '@/components/Modal';
import SearchableSelect from '@/components/SearchableSelect';

type InstallmentDraft = {
  label: string;
  amount: string;
  dueDate: string;
  terms: string;
  notes: string;
};

const emptyInst = (i: number): InstallmentDraft => ({
  label: i === 0 ? 'Booking advance' : `Installment ${i + 1}`,
  amount: '',
  dueDate: '',
  terms: '',
  notes: '',
});

export default function InvoicesPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => billingApi.listInvoices().then((r) => r.data),
  });
  const { data: summaryData } = useQuery({
    queryKey: ['billing-summary'],
    queryFn: () => billingApi.summary().then((r) => r.data),
  });
  const { data: customersData } = useQuery({
    queryKey: ['customers-for-invoice'],
    queryFn: () => adminApi.customers({ limit: 200 }).then((r) => r.data),
  });
  const { data: pkgData } = useQuery({
    queryKey: ['portal-packages'],
    queryFn: () => portalApi.packages().then((r) => r.data),
  });

  const [invoiceSearch, setInvoiceSearch] = useState('');
  const invoices = useMemo(() => {
    const all = data?.invoices || [];
    const q = invoiceSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter((inv: any) => {
      const hay = [inv.invoiceNumber, inv.title, inv.customer?.name, inv.customer?.phone, inv.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, invoiceSearch]);
  const { data: studioProf } = useQuery({
    queryKey: ['portal-profile'],
    queryFn: () => portalApi.getProfile().then((r) => r.data),
    staleTime: 60_000,
  });
  const summary = summaryData?.summary;
  const accounts = summaryData?.accounts || [];
  const customers = customersData?.customers || [];
  const packages = pkgData?.packages || [];

  // Payment ledger modal
  const [payOpen, setPayOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState<any>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [payKind, setPayKind] = useState('PAYMENT');
  const [payReference, setPayReference] = useState('');
  const [payKey, setPayKey] = useState('');

  const [open, setOpen] = useState(false);

  const [focusInvoiceId, setFocusInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const url = new URL(window.location.href);
    let dirty = false;
    if (params.get('new') === '1') {
      openCreate();
      url.searchParams.delete('new');
      dirty = true;
    }
    const focus = params.get('focus') || params.get('invoiceId');
    if (focus) {
      setFocusInvoiceId(focus);
      url.searchParams.delete('focus');
      dirty = true;
    }
    if (params.get('customerId') && !customerId) {
      setCustomerId(params.get('customerId') || '');
    }
    if (dirty) window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!focusInvoiceId) return;
    const el = document.getElementById(`invoice-${focusInvoiceId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusInvoiceId, invoices]);
  /** When set, modal is editing this invoice (draft full edit / notes for others) */
  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [title, setTitle] = useState('Service Invoice');
  /** Service / package total (first field) */
  const [serviceTotal, setServiceTotal] = useState('');
  /** Travelling charges */
  const [travelAmount, setTravelAmount] = useState('');
  const [count, setCount] = useState(3);
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [installments, setInstallments] = useState<InstallmentDraft[]>([
    emptyInst(0),
    emptyInst(1),
    emptyInst(2),
  ]);

  const selectedPkg = useMemo(
    () => packages.find((p: any) => p.id === packageId),
    [packages, packageId],
  );

  const serviceNum = Number(serviceTotal) || 0;
  const travelNum = Number(travelAmount) || 0;
  const grandTotal = Math.round((serviceNum + travelNum) * 100) / 100;

  const totalFromInstallments = useMemo(
    () => installments.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [installments],
  );

  const installmentDiff = Math.round((grandTotal - totalFromInstallments) * 100) / 100;

  const money = (n: number, currency = 'INR') =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n || 0);

  /** Allow only digits + one decimal while typing (avoids type=number focus quirks) */
  const sanitizeMoneyInput = (raw: string) => {
    let v = raw.replace(/[^\d.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = `${parts[0]}.${parts.slice(1).join('')}`;
    if (parts[1]?.length > 2) v = `${parts[0]}.${parts[1].slice(0, 2)}`;
    return v;
  };

  const splitEvenly = (total: number, n: number): string[] => {
    if (n <= 0 || total <= 0) return Array.from({ length: n }, () => '');
    const cents = Math.round(total * 100);
    const each = Math.floor(cents / n);
    const amounts: string[] = [];
    let used = 0;
    for (let i = 0; i < n; i++) {
      const c = i === n - 1 ? cents - used : each;
      used += c;
      amounts.push(String(c / 100));
    }
    return amounts;
  };

  const rebuildInstallments = (n: number, opts?: { split?: boolean; total?: number }) => {
    const total = opts?.total ?? grandTotal;
    const shouldSplit = opts?.split ?? (total > 0);
    const split = shouldSplit ? splitEvenly(total, n) : null;
    const rows: InstallmentDraft[] = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        label: i === 0 ? 'Booking advance' : i === n - 1 ? 'Final balance' : `Installment ${i + 1}`,
        amount: split ? split[i] : (installments[i]?.amount || ''),
        dueDate: installments[i]?.dueDate || '',
        terms: installments[i]?.terms || '',
        notes: installments[i]?.notes || '',
      });
    }
    setCount(n);
    setInstallments(rows);
  };

  const updateInstallment = (idx: number, patch: Partial<InstallmentDraft>) => {
    setInstallments((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const applyServiceAndTravel = (service: string, travel: string) => {
    setServiceTotal(service);
    setTravelAmount(travel);
    const s = Number(service) || 0;
    const t = Number(travel) || 0;
    const grand = Math.round((s + t) * 100) / 100;
    if (grand > 0) {
      const split = splitEvenly(grand, count);
      setInstallments((prev) =>
        prev.map((r, i) => ({ ...r, amount: split[i] ?? r.amount })),
      );
    }
  };

  const resetForm = () => {
    setEditInvoiceId(null);
    setEditStatus(null);
    setCustomerId('');
    setPackageId('');
    setTitle('Service Invoice');
    setServiceTotal('');
    setTravelAmount('');
    setTerms('');
    setNotes('');
    setCount(3);
    setInstallments([emptyInst(0), emptyInst(1), emptyInst(2)]);
  };

  const openCreate = () => {
    resetForm();
    const studioTerms = (studioProf?.profile?.termsHtml || studioProf?.termsHtml || '').toString().trim();
    if (studioTerms) setTerms(studioTerms);
    setOpen(true);
  };

  const openEdit = (inv: any) => {
    setEditInvoiceId(inv.id);
    setEditStatus(inv.status || null);
    setCustomerId(inv.customerId || inv.customer?.id || '');
    setPackageId(inv.packageId || inv.package?.id || '');
    setTitle(inv.title || 'Service Invoice');
    const travel = Number(inv.travelAmount || 0);
    const total = Number(inv.totalAmount || 0);
    setServiceTotal(String(Math.max(0, total - travel) || ''));
    setTravelAmount(travel > 0 ? String(travel) : '');
    setTerms(inv.terms || '');
    setNotes(inv.notes || '');
    const rows = (inv.installments || inv.plan?.milestones || []).map((inst: any, i: number) => ({
      label: inst.label || `Installment ${i + 1}`,
      amount: String(inst.amount ?? inst.plannedAmount ?? ''),
      dueDate: inst.dueDate ? String(inst.dueDate).slice(0, 10) : '',
      terms: inst.terms || '',
      notes: inst.notes || '',
    }));
    if (rows.length) {
      setCount(rows.length);
      setInstallments(rows);
    } else {
      setCount(0);
      setInstallments([]);
    }
    setOpen(true);
  };

  const customerOptions = useMemo(
    () =>
      customers.map((c: any) => ({
        value: c.id,
        label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}${c.email ? ` · ${c.email}` : ''}`,
        keywords: `${c.phone || ''} ${c.email || ''}`,
      })),
    [customers],
  );

  const packageOptions = useMemo(
    () =>
      packages.map((p: any) => ({
        value: p.id,
        label: `${p.title} · ${money(Number(p.discountPrice ?? p.price) || 0)}`,
        keywords: p.title,
      })),
    [packages],
  );

  const create = useMutation({
    mutationFn: () => {
      if (editInvoiceId) {
        const isDraft = editStatus === 'DRAFT';
        return billingApi.updateInvoice(editInvoiceId, {
          title,
          notes: notes || null,
          terms: terms || null,
          ...(isDraft
            ? {
                packageId: packageId || null,
                totalAmount: grandTotal > 0 ? grandTotal : undefined,
                travelAmount: travelNum,
                installments: installments.map((r) => ({
                  label: r.label,
                  amount: Number(r.amount) || 0,
                  dueDate: r.dueDate || undefined,
                  terms: r.terms || undefined,
                  notes: r.notes || undefined,
                })),
              }
            : {}),
        });
      }
      return billingApi.createInvoice({
        customerId,
        packageId: packageId || undefined,
        title,
        totalAmount: serviceNum,
        travelAmount: travelNum,
        terms: terms || undefined,
        notes: notes || undefined,
        installments: installments
          .filter((r) => Number(r.amount) > 0 || r.label)
          .map((r) => ({
            label: r.label,
            amount: Number(r.amount) || 0,
            dueDate: r.dueDate || undefined,
            terms: r.terms || undefined,
            notes: r.notes || undefined,
          })),
      });
    },
    onSuccess: async (res) => {
      const inv = res.data?.invoice;
      qc.invalidateQueries({ queryKey: ['invoices'] });
      if (editInvoiceId) {
        toast.success('Invoice updated');
        setOpen(false);
        resetForm();
        return;
      }
      toast.success('Draft invoice created');
      setOpen(false);
      resetForm();
      if (inv?.id) {
        try {
          await billingApi.finalizeInvoice(inv.id);
          qc.invalidateQueries({ queryKey: ['invoices'] });
          toast.success('Invoice sent to customer dashboard');
        } catch {
          toast('Saved as draft — open and Finalize to send');
        }
      }
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Failed'),
  });

  const finalize = useMutation({
    mutationFn: (id: string) => billingApi.finalizeInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice sent to customer');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed'),
  });

  const openPay = (inv: any) => {
    setPayInvoice(inv);
    setPayNote('');
    setPayAmount('');
    setPayMethod('CASH');
    setPayKind('PAYMENT');
    setPayReference('');
    setPayKey(crypto.randomUUID());
    setPayOpen(true);
  };

  const recordPayment = useMutation({
    mutationFn: async () => {
      if (!payInvoice) throw new Error('No invoice');
      const amount = Number(payAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter the amount received in this payment');
      return billingApi.recordPayment(payInvoice.id, {
        amount, kind: payKind, method: payMethod, reference: payReference.trim() || undefined, idempotencyKey: payKey,
        note: payNote.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['billing-summary'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success(payKind === 'REFUND' ? 'Refund recorded' : 'Payment recorded and receipt created');
      setPayOpen(false);
      setPayInvoice(null);
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.message || 'Failed'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => billingApi.deleteInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Removed');
    },
  });

  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);

  const openPdfFromPayload = (data: any, mode: 'view' | 'download') => {
    const filename = (data?.filename as string) || 'invoice.pdf';
    let objectUrl: string | null = null;

    if (data?.base64) {
      const bin = atob(data.base64 as string);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      objectUrl = URL.createObjectURL(blob);
    } else if (data?.url) {
      objectUrl = data.url as string;
    }
    if (!objectUrl) throw new Error('No PDF data returned');

    if (mode === 'download') {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      const w = window.open(objectUrl, '_blank', 'noopener,noreferrer');
      if (!w) {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast('Popup blocked — downloading PDF instead');
      }
    }
    if (objectUrl.startsWith('blob:')) {
      setTimeout(() => URL.revokeObjectURL(objectUrl!), 120_000);
    }
  };

  const statusBadge = (s: string) => {
    const base = 'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md';
    if (s === 'PAID' || s === 'WRITTEN_OFF') return `${base} bg-emerald-100 text-emerald-800`;
    if (s === 'PARTIALLY_PAID') return `${base} bg-amber-100 text-amber-900`;
    if (s === 'SENT') return `${base} bg-sky-100 text-sky-900`;
    if (s === 'VOID') return `${base} bg-rose-100 text-rose-900`;
    return `${base} bg-stone-100 text-stone-700`;
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <p className="kicker mb-2">Billing</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>
            Billing
          </h1>
          <p className="text-[14px] mt-1.5 max-w-xl" style={{ color: 'var(--ink-2)' }}>
            Record payments as they arrive. Receipts, refunds, and remaining balances stay together.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary flex items-center gap-2 px-4 py-2.5"
          onClick={openCreate}
        >
          <Plus size={16} /> New invoice
        </button>
      </div>

      {/* Studio dues strip */}
      {isError && <div role="alert" className="card p-5 mb-5">Billing could not load. <button className="btn-ghost" onClick={() => refetch()}>Try again</button></div>}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            ['Outstanding', money(summary.totalOutstanding || 0)],
            ['Collected', money(summary.totalCash || 0)],
            ['Billed', money(summary.totalBilled || 0)],
            ['Clients with dues', String(summary.clientsWithDues ?? 0)],
          ].map(([label, val]) => (
            <div key={label} className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
                {label}
              </div>
              <div className="font-display text-2xl mt-1" style={{ color: 'var(--ink)' }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Clients with open balance */}
      {accounts.filter((a: any) => a.balance > 0.01).length > 0 && (
        <div className="card p-4 mb-6">
          <p className="text-[12px] font-semibold mb-3" style={{ color: 'var(--ink)' }}>Open client accounts</p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {accounts
              .filter((a: any) => a.balance > 0.01)
              .slice(0, 12)
              .map((a: any) => (
                <div key={a.customerId} className="flex items-center justify-between text-[13px] gap-3">
                  <div className="min-w-0 truncate" style={{ color: 'var(--ink)' }}>
                    {a.name}
                    {a.phone ? <span style={{ color: 'var(--ink-3)' }}> · {a.phone}</span> : null}
                  </div>
                  <div className="font-semibold shrink-0" style={{ color: 'var(--ink)' }}>
                    {money(a.balance)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <input
          className="input max-w-md"
          placeholder="Search invoices — client, number, phone…"
          value={invoiceSearch}
          onChange={(e) => setInvoiceSearch(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {isLoading && (
          <div className="card p-10 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
            Loading…
          </div>
        )}
        {!isLoading && invoices.length === 0 && (
          <div className="card p-10 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
            No invoices yet. Create an invoice for a job, then record each payment as it arrives.
          </div>
        )}
        {invoices.map((inv: any) => (
          <div
            key={inv.id}
            id={`invoice-${inv.id}`}
            className="card p-5"
            style={
              focusInvoiceId === inv.id
                ? { outline: '2px solid var(--gold)', outlineOffset: 2 }
                : undefined
            }
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {inv.invoiceNumber}
                  </span>
                  <span className={statusBadge(inv.status)}>
                    {inv.status === 'DRAFT'
                      ? 'Not sent'
                      : inv.status === 'PAID' || inv.status === 'WRITTEN_OFF'
                        ? 'Paid'
                        : inv.status === 'PARTIALLY_PAID'
                          ? 'Partially paid'
                          : inv.status === 'SENT' || inv.status === 'FINALIZED'
                            ? (Number(inv.totalAmount || 0) - Number(inv.cashPaid ?? inv.amountPaid ?? 0) <= 0.01
                              ? 'Paid'
                              : Number(inv.cashPaid || inv.amountPaid || 0) > 0
                                ? 'Partially paid'
                                : 'Sent')
                            : inv.status === 'VOID'
                              ? 'Void'
                              : inv.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="font-display text-xl mt-1" style={{ color: 'var(--ink)' }}>
                  {inv.title}
                </div>
                <div className="text-[13px] mt-1" style={{ color: 'var(--ink-2)' }}>
                  {inv.customer?.name}
                  {inv.customer?.phone ? ` · ${inv.customer.phone}` : ''}
                  {inv.package?.title ? ` · ${inv.package.title}` : ''}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-lg" style={{ color: 'var(--ink)' }}>
                  {money(inv.totalAmount, inv.currency)}
                </div>
                {Number(inv.travelAmount || 0) > 0 && (
                  <div className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                    incl. travel {money(inv.travelAmount, inv.currency)}
                  </div>
                )}
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-3)' }}>
                  Paid {money(inv.cashPaid ?? inv.amountPaid, inv.currency)}
                  {' · '}Balance <strong style={{ color: 'var(--ink)' }}>
                    {money(
                      Math.max(
                        0,
                        Number(inv.totalAmount || 0) - Number(inv.cashPaid ?? inv.amountPaid ?? 0),
                      ),
                      inv.currency,
                    )}
                  </strong>
                </div>
                {inv.status !== 'DRAFT' && inv.status !== 'VOID' && (
                  <div className="flex gap-2 justify-end mt-2 flex-wrap">
                    <button
                      type="button"
                      className="btn-primary text-[12px] px-3 py-1.5"
                      onClick={() => openPay(inv)}
                    >
                      Record payment
                    </button>
                  </div>
                )}
              </div>
            </div>

            {inv.kind !== 'RECEIPT' && (
              <div className="mt-4 space-y-2">
                {(inv.installments || []).map((inst: any, idx: number) => {
                  const rem = Number(inst.remaining ?? Math.max(0, Number(inst.amount) - Number(inst.paidAmount || 0)));
                  return (
                    <div
                      key={inst.id || idx}
                      className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5"
                      style={{ background: 'var(--surface-sunken)' }}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                          {inst.label}
                        </div>
                        {(inst.terms || inst.notes) && (
                          <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
                            {[inst.terms, inst.notes].filter(Boolean).join(' — ')}
                          </div>
                        )}
                        {inst.dueDate && (
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-3)' }}>
                            Due {new Date(inst.dueDate).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                          {money(inst.amount, inv.currency)}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                          {inst.status}
                          {Number(inst.paidAmount || 0) > 0
                            ? ` · paid ${money(inst.paidAmount, inv.currency)}`
                            : ''}
                          {rem > 0.01 && inst.status !== 'PAID' && inst.status !== 'WAIVED'
                            ? ` · left ${money(rem, inv.currency)}`
                            : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {(inv.receipts || []).length > 0 && <div className="mt-4 flex flex-wrap gap-2">
              {inv.status !== 'DRAFT' && <ShareLinkButton path={`/invoices?id=${inv.id}`} />}
              {inv.receipts.map((receipt: any) => <button key={receipt.id} className="btn-ghost text-xs" disabled={pdfBusyId === receipt.id} onClick={async () => {
                setPdfBusyId(receipt.id);
                try { const response = await billingApi.receiptPdf(receipt.id); openPdfFromPayload(response.data, 'download'); }
                catch { toast.error('Could not download receipt'); }
                finally { setPdfBusyId(null); }
              }}><Download size={14} /> {receipt.receiptNumber}</button>)}
            </div>}

            {/* Payment ledger */}
            {(inv.payments || []).length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--ink-3)' }}>
                  Payment history
                </p>
                <div className="space-y-1.5">
                  {(inv.payments || []).map((p: any) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 text-[12px] px-2 py-1.5 rounded-lg"
                      style={{ border: '1px solid var(--line)' }}
                    >
                      <div className="min-w-0">
                        <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                          {p.voidedAt ? 'Reversed · ' : ''}{p.kind === 'REFUND' ? 'Refund' : 'Payment'}
                        </span>
                        {p.method ? ` · ${p.method}` : ''}
                        {p.installmentLabel ? ` · ${p.installmentLabel}` : ''}
                        {p.note ? <span style={{ color: 'var(--ink-3)' }}> — {p.note}</span> : null}
                        <div className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                          {p.paidAt ? new Date(p.paidAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : ''}
                          {p.voidedAt && ` · ${p.voidReason || 'Reversed'}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                          {money(p.amount, inv.currency)}
                        </span>
                        {!p.voidedAt && <button className="btn-ghost text-xs" onClick={async () => {
                          const reason = window.prompt('Why is this receipt incorrect? Reversing a receipt is a bookkeeping correction, not a cash refund.');
                          if (!reason?.trim()) return;
                          try { await billingApi.voidPayment(inv.id, p.id, reason); qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['billing-summary'] }); }
                          catch (e: any) { toast.error(e?.response?.data?.error?.message || 'Could not reverse receipt'); }
                        }}>Reverse</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(inv.terms || inv.notes) && (
              <div
                className="mt-4 rounded-xl px-3 py-2.5 text-[12px] space-y-1"
                style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}
              >
                {inv.terms && (
                  <details><summary className="cursor-pointer font-semibold">Payment terms</summary><p className="mt-2 whitespace-pre-line">{inv.terms}</p></details>
                )}
                {inv.notes && (
                  <div>
                    <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                      Notes:{' '}
                    </span>
                    {inv.notes}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {inv.status !== 'DRAFT' && <ShareLinkButton path={`/invoices?id=${inv.id}`} />}
              {inv.status !== 'VOID' && inv.kind !== 'RECEIPT' && (
                <button
                  type="button"
                  className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-sm"
                  onClick={() => openEdit(inv)}
                >
                  <Pencil size={14} /> Edit
                </button>
              )}
              {inv.status === 'DRAFT' && (
                <button
                  type="button"
                  className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm"
                  onClick={() => finalize.mutate(inv.id)}
                >
                  <Send size={14} /> Finalize &amp; send
                </button>
              )}
              <button
                type="button"
                className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-sm"
                disabled={pdfBusyId === inv.id}
                onClick={async () => {
                  setPdfBusyId(inv.id);
                  try {
                    const r = await billingApi.invoicePdf(inv.id);
                    openPdfFromPayload(r.data, 'view');
                  } catch (e: any) {
                    toast.error(e.response?.data?.error?.message || 'PDF failed');
                  } finally {
                    setPdfBusyId(null);
                  }
                }}
              >
                <Eye size={14} /> PDF
              </button>
              <button
                type="button"
                className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-sm"
                onClick={async () => {
                  setPdfBusyId(inv.id);
                  try {
                    const r = await billingApi.invoicePdf(inv.id);
                    openPdfFromPayload(r.data, 'download');
                  } catch (e: any) {
                    toast.error(e.response?.data?.error?.message || 'PDF failed');
                  } finally {
                    setPdfBusyId(null);
                  }
                }}
              >
                <Download size={14} /> Download
              </button>
              <button
                type="button"
                className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-sm"
                style={{ color: 'var(--rose)' }}
                onClick={() => {
                  if (confirm('Remove / void this invoice?')) remove.mutate(inv.id);
                }}
              >
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => {
          if (!create.isPending) {
            setOpen(false);
            resetForm();
          }
        }}
        title={editInvoiceId ? 'Edit invoice' : 'New invoice'}
        description={
          editInvoiceId
            ? (editStatus === 'DRAFT'
              ? 'Update totals, plan, notes — then finalize when ready.'
              : 'Notes and terms can be updated anytime. Totals are locked after finalize (use Revise for package changes).')
            : 'Search customer & package (keyboard works on iPad). Enter total, optional travel, then optional installments.'
        }
        preventClose={create.isPending}
        size="lg"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              onClick={() => { setOpen(false); resetForm(); }}
              disabled={create.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={
                (!editInvoiceId && !customerId)
                || (editStatus === 'DRAFT' || !editInvoiceId
                  ? grandTotal <= 0
                  : false)
                || create.isPending
              }
              onClick={() => {
                if ((editStatus === 'DRAFT' || !editInvoiceId) && installments.length > 0 && Math.abs(installmentDiff) > 0.5) {
                  toast.error(
                    `Installments (${money(totalFromInstallments)}) must match grand total (${money(grandTotal)})`,
                  );
                  return;
                }
                create.mutate();
              }}
            >
              {create.isPending
                ? 'Saving…'
                : editInvoiceId
                  ? 'Save changes'
                  : 'Create & send'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {!editInvoiceId && (
            <SearchableSelect
              value={customerId}
              onChange={setCustomerId}
              options={customerOptions}
              placeholder="Search customer by name, phone, email…"
              emptyLabel="Select customer…"
              allowEmpty={false}
              hint="Type to search — iPad keyboard opens"
            />
          )}

          <SearchableSelect
            value={packageId}
            onChange={(id) => {
              setPackageId(id);
              const p = packages.find((x: any) => x.id === id);
              if (p && (editStatus === 'DRAFT' || !editInvoiceId)) {
                const price = Number(p.discountPrice ?? p.price) || 0;
                if (price > 0) {
                  applyServiceAndTravel(String(price), travelAmount);
                }
              }
            }}
            options={packageOptions}
            placeholder="Search package (optional)…"
            emptyLabel="No package"
            allowEmpty
            disabled={!!editInvoiceId && editStatus !== 'DRAFT'}
          />

          <input
            className="input w-full"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* Total first + travelling */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                Invoice total (₹) *
              </label>
              <input
                className="input w-full"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 80000"
                value={serviceTotal}
                disabled={!!editInvoiceId && editStatus !== 'DRAFT'}
                onChange={(e) => {
                  const v = sanitizeMoneyInput(e.target.value);
                  setServiceTotal(v);
                }}
                onBlur={() => {
                  if (grandTotal > 0 && count > 0) {
                    const split = splitEvenly(grandTotal, count);
                    setInstallments((prev) =>
                      prev.map((r, i) => ({ ...r, amount: split[i] ?? r.amount })),
                    );
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink-2)' }}>
                Travelling (₹)
              </label>
              <input
                className="input w-full"
                inputMode="decimal"
                disabled={!!editInvoiceId && editStatus !== 'DRAFT'}
                autoComplete="off"
                placeholder="e.g. 5000"
                value={travelAmount}
                onChange={(e) => {
                  const v = sanitizeMoneyInput(e.target.value);
                  setTravelAmount(v);
                }}
                onBlur={() => {
                  if (grandTotal > 0) {
                    const split = splitEvenly(grandTotal, count);
                    setInstallments((prev) =>
                      prev.map((r, i) => ({ ...r, amount: split[i] ?? r.amount })),
                    );
                  }
                }}
              />
            </div>
          </div>

          <div className="rounded-xl px-3 py-2.5 text-[13px] space-y-1" style={{ background: 'var(--surface-sunken)' }}>
            <div className="flex justify-between gap-2">
              <span style={{ color: 'var(--ink-2)' }}>Service</span>
              <strong style={{ color: 'var(--ink)' }}>{money(serviceNum)}</strong>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: 'var(--ink-2)' }}>Travelling</span>
              <strong style={{ color: 'var(--ink)' }}>{money(travelNum)}</strong>
            </div>
            <div className="flex justify-between gap-2 pt-1" style={{ borderTop: '1px solid var(--line)' }}>
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>Grand total</span>
              <strong style={{ color: 'var(--ink)' }}>{money(grandTotal)}</strong>
            </div>
            {selectedPkg ? (
              <div className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                Package list price {money(Number(selectedPkg.discountPrice ?? selectedPkg.price) || 0)}
              </div>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>
                Number of installments
              </div>
              <button
                type="button"
                className="text-[12px] font-semibold underline-offset-2 hover:underline"
                style={{ color: 'var(--ink-2)' }}
                onClick={() => {
                  if (grandTotal <= 0) {
                    toast.error('Enter invoice total first');
                    return;
                  }
                  rebuildInstallments(count, { split: true, total: grandTotal });
                  toast.success('Split evenly across installments');
                }}
              >
                Split total evenly
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="px-4 py-2 rounded-xl text-sm font-semibold border"
                  style={{
                    background: count === n ? 'var(--ink)' : 'var(--surface)',
                    color: count === n ? '#fff' : 'var(--ink)',
                    borderColor: 'var(--line)',
                  }}
                  onClick={() => rebuildInstallments(n, { split: grandTotal > 0, total: grandTotal })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: 'var(--surface-sunken)' }}>
            Installments sum:{' '}
            <strong style={{ color: 'var(--ink)' }}>{money(totalFromInstallments)}</strong>
            {grandTotal > 0 && Math.abs(installmentDiff) > 0.5 ? (
              <span style={{ color: 'var(--rose)' }}>
                {' '}· off by {money(Math.abs(installmentDiff))}
                {installmentDiff > 0 ? ' (under)' : ' (over)'}
              </span>
            ) : grandTotal > 0 ? (
              <span style={{ color: 'var(--green)' }}> · matches grand total</span>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>
              Installments (amount only)
            </div>
            {installments.map((row, idx) => (
              <div
                key={`inst-${idx}`}
                className="rounded-xl border p-3 space-y-2"
                style={{ borderColor: 'var(--line)' }}
              >
                <input
                  className="input w-full"
                  value={row.label}
                  onChange={(e) => updateInstallment(idx, { label: e.target.value })}
                />
                <input
                  className="input w-full"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Amount (₹)"
                  value={row.amount}
                  onChange={(e) => updateInstallment(idx, { amount: sanitizeMoneyInput(e.target.value) })}
                />
                <input
                  className="input w-full"
                  type="date"
                  value={row.dueDate}
                  onChange={(e) => updateInstallment(idx, { dueDate: e.target.value })}
                />
                <input
                  className="input w-full"
                  placeholder="Terms for this installment"
                  value={row.terms}
                  onChange={(e) => updateInstallment(idx, { terms: e.target.value })}
                />
              </div>
            ))}
          </div>

          <textarea
            className="input w-full min-h-[70px]"
            placeholder="Invoice terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
          <textarea
            className="input w-full min-h-[60px]"
            placeholder="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={payOpen}
        onClose={() => !recordPayment.isPending && setPayOpen(false)}
        title={payKind === 'REFUND' ? 'Record an actual refund' : 'Record payment'}
        description={
          payInvoice
            ? `${payInvoice.invoiceNumber} · ${payInvoice.customer?.name || ''} · Bill ${money(payInvoice.totalAmount, payInvoice.currency)}`
            : undefined
        }
        preventClose={recordPayment.isPending}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              onClick={() => setPayOpen(false)}
              disabled={recordPayment.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={payAmount === '' || recordPayment.isPending}
              onClick={() => recordPayment.mutate()}
            >
              {recordPayment.isPending ? 'Saving…' : payKind === 'REFUND' ? 'Record refund' : 'Record payment'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {payInvoice && (
            <div className="rounded-xl px-3 py-2.5 text-[13px]" style={{ background: 'var(--surface-sunken)' }}>
              <div className="flex justify-between gap-2">
                <span style={{ color: 'var(--ink-2)' }}>Bill total</span>
                <span className="font-semibold">{money(payInvoice.totalAmount, payInvoice.currency)}</span>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span style={{ color: 'var(--ink-2)' }}>Already received</span>
                <span className="font-semibold">{money(payInvoice.cashPaid ?? payInvoice.amountPaid, payInvoice.currency)}</span>
              </div>
            </div>
          )}
          <div>
            <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
              {payKind === 'REFUND' ? 'Amount returned to the client' : 'Amount received now'}
            </label>
            <input
              className="input"
              inputMode="decimal"
              value={payAmount}
              onChange={(e) => setPayAmount(sanitizeMoneyInput(e.target.value))}
              placeholder="0"
              autoFocus
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>
              Enter only this payment. Earlier receipts remain unchanged. The balance updates automatically.
            </p>
          </div>
          <div><label className="text-xs block mb-1">Transaction</label><select className="input" value={payKind} onChange={e => setPayKind(e.target.value)}><option value="PAYMENT">Payment received</option><option value="REFUND">Actual refund paid to client</option></select></div>
          {payInvoice && <p className="text-sm">Balance after this transaction: {money(Math.max(0, Number(payInvoice.totalAmount) - Number(payInvoice.cashPaid ?? payInvoice.amountPaid ?? 0) + (payKind === 'REFUND' ? 1 : -1) * (Number(payAmount) || 0)), payInvoice.currency)}</p>}
          <div><label className="text-xs block mb-1">Payment method</label><select className="input" value={payMethod} onChange={e => setPayMethod(e.target.value)}><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="BANK">Bank transfer</option></select></div>
          <div><label className="text-xs block mb-1">Reference / UTR (optional)</label><input className="input" value={payReference} onChange={e => setPayReference(e.target.value)} maxLength={120}/></div>
          <div>
            <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
              Note (optional)
            </label>
            <input
              className="input"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
