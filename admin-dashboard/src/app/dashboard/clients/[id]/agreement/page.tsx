'use client';
import ShareLinkButton from '@/components/ShareLinkButton';
import PdfUploadButton from '@/components/PdfUploadButton';

import { use, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Check, FileText, Loader2, Plus, Trash2, Copy } from 'lucide-react';
import { adminApi } from '@/lib/api';

const SECTIONS = [
  { id: 'parties', title: 'Parties & contacts' },
  { id: 'event', title: 'Event details' },
  { id: 'package', title: 'Package' },
  { id: 'days', title: 'Day-wise coverage' },
  { id: 'deliverables', title: 'Deliverables & scope of work' },
  { id: 'timeline', title: 'Delivery timeline' },
  { id: 'responsibilities', title: 'Responsibilities' },
  { id: 'payment', title: 'Package cost & payment' },
  { id: 'terms', title: 'Terms & conditions' },
  { id: 'review', title: 'Review & finalize' },
] as const;

type DayService = { id: string; count: number };

type DayConfig = {
  id: string;
  dayNumber: number;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  services: DayService[];
  customService: string;
  notes: string;
};

type FormData = Record<string, any>;

const DEFAULT_SCOPE = [
  { id: 'traditional_photographer', label: 'Traditional Photographer' },
  { id: 'candid_photographer', label: 'Candid / Documentary Photographer' },
  { id: 'traditional_videographer', label: 'Traditional Videographer' },
  { id: 'cinematic_videographer', label: 'Cinematic Videographer' },
  { id: 'drone', label: 'Drone Operator' },
  { id: 'same_day_edit', label: 'Same-day Edit' },
  { id: 'live_stream', label: 'Live Streaming' },
  { id: 'album_design', label: 'Album Design' },
  { id: 'photo_booth', label: 'Photo Booth' },
  { id: 'custom', label: 'Custom' },
];

const DEFAULT_DELIVERABLES = [
  {
    id: 'traditional_documentary_film',
    title: 'Traditional Documentary Film',
    description:
      'A complete, long-format cinematic record of the wedding ceremonies, capturing all rituals and events in a chronological sequence with professional high-quality audio and video.',
  },
  {
    id: 'cinematic_highlight_film',
    title: 'Cinematic Highlight Film',
    description:
      'A creatively edited, high-definition short film featuring the best moments of the wedding, professionally color-graded.',
  },
  {
    id: 'edited_couple_photos',
    title: 'Selected Edited Couple Photographs',
    description:
      'A premium collection of artistic, high-end edited portraits of the couple, focusing on aesthetics, lighting, and specialized post-processing.',
  },
  {
    id: 'color_corrected_photos',
    title: 'Selected Color-Corrected Photographs',
    description:
      'A curated set of high-resolution images, individually color-corrected and enhanced to ensure a consistent and professional look across the event.',
    defaultQty: '350',
    qtyLabel: 'Number of photos',
  },
  {
    id: 'social_media_reels',
    title: 'Social Media Reels',
    description:
      'Professionally edited vertical short-form videos (Reels), optimized for platforms like Instagram and Facebook, capturing the trendiest highlights of the celebration.',
    defaultQty: '3',
    qtyLabel: 'Number of reels',
  },
  {
    id: 'raw_data_transfer',
    title: 'Raw Data Transfer',
    description:
      'All unedited (Raw) photos and video footage will be provided to the Client. Note: the Client must provide their own External Hard Drive or SSD for this transfer.',
  },
];

function normalizeServices(raw: any): DayService[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      if (typeof s === 'string') return { id: s, count: 1 };
      if (s && typeof s === 'object' && s.id) {
        return { id: String(s.id), count: Math.max(1, parseInt(String(s.count || s.qty || 1), 10) || 1) };
      }
      return null;
    })
    .filter(Boolean) as DayService[];
}

function newDay(n: number, partial?: Partial<DayConfig>): DayConfig {
  return {
    id: `day-${n}-${Math.random().toString(36).slice(2, 8)}`,
    dayNumber: n,
    label: partial?.label || `Day ${n}`,
    date: partial?.date || '',
    startTime: partial?.startTime || '',
    endTime: partial?.endTime || '',
    venue: partial?.venue || '',
    services: partial?.services
      ? normalizeServices(partial.services)
      : [{ id: 'traditional_photographer', count: 1 }],
    customService: partial?.customService || '',
    notes: partial?.notes || '',
  };
}

function ensureDays(form: FormData): DayConfig[] {
  if (Array.isArray(form.days) && form.days.length > 0) {
    return form.days.map((d: any, i: number) => ({
      id: d.id || `day-${i + 1}`,
      dayNumber: d.dayNumber || i + 1,
      label: d.label || `Day ${i + 1}`,
      date: d.date || '',
      startTime: d.startTime || '',
      endTime: d.endTime || '',
      venue: d.venue || '',
      services: normalizeServices(d.services),
      customService: d.customService || '',
      notes: d.notes || '',
    }));
  }
  // Migrate legacy flat scope → day 1
  const legacy = Array.isArray(form.scopeServices) ? form.scopeServices : [];
  return [
    newDay(1, {
      date: form.eventDate || '',
      venue: form.primaryVenue || '',
      services: legacy.length
        ? normalizeServices(legacy)
        : [{ id: 'traditional_photographer', count: 1 }],
      customService: form.scopeCustom || '',
      notes: form.scopeNotes || '',
    }),
  ];
}

const DEFAULT_TIMELINE = [
  { id: 'sneak_peek', title: 'Preview / Sneak Peek', defaultTimeframe: '2–3 days after the event', description: 'A selection of 10–15 “best of” images shared for social media.' },
  { id: 'raw_handover', title: 'Raw Data Handover', defaultTimeframe: 'When client visits the studio after the event', description: 'All raw photos and video transferred to the Client’s Hard Drive / SSD.' },
  { id: 'selection_process', title: 'Selection Process', defaultTimeframe: 'Within 15 days of receiving the full set', description: 'Client selects images for color correction / editing.' },
  { id: 'final_photos', title: 'Final Edited Photos', defaultTimeframe: '30–45 days after selection', description: 'Color-corrected and edited couple portraits delivered.' },
  { id: 'highlight_film', title: 'Cinematic Highlight Film', defaultTimeframe: '20 working days from the event', description: 'High-definition creatively edited highlight film.' },
  { id: 'social_reels', title: 'Social Media Reels', defaultTimeframe: '7–10 working days', description: 'Professionally edited reels for immediate social sharing.' },
  { id: 'documentary_film', title: 'Documentary Film', defaultTimeframe: '60–90 days from the event', description: 'Full traditional / documentary film delivery.' },
];

const DEFAULT_RESPONSIBILITIES = [
  { id: 'professional_conduct', title: 'Professional Conduct', description: 'The Photographer and the entire team shall maintain professional decorum, dressing appropriately for the event and interacting respectfully with all guests and family members.' },
  { id: 'creative_excellence', title: 'Creative Excellence', description: 'The Photographer will use professional expertise, high-quality equipment, and artistic judgment to capture the event in the best possible manner.' },
  { id: 'equipment_backup', title: 'Equipment Backup', description: 'The Photographer shall carry backup camera bodies, lenses, and flash units to ensure the shoot continues uninterrupted in case of equipment failure.' },
  { id: 'data_safety', title: 'Data Safety', description: 'During the event, the Photographer will use dual-slot memory cards (where possible) to ensure an immediate backup of all captured photos and videos.' },
  { id: 'time_management', title: 'Time Management', description: 'The team will arrive at the venue at the agreed-upon reporting time to set up equipment and begin coverage as per the itinerary.' },
  { id: 'quality_control', title: 'Quality Control', description: 'Every deliverable will undergo a quality check for color, sound, and editing before being shared with the Client.' },
  { id: 'adherence_timeline', title: 'Adherence to Timeline', description: 'The Photographer is responsible for meeting all delivery deadlines, provided client obligations (selections, music, payments) are met.' },
];

export default function MakeAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = use(params);
  const qc = useQueryClient();
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const editIdFromUrl = searchParams?.get('id') || null;

  const [step, setStep] = useState(0);
  const [agreementId, setAgreementId] = useState<string | null>(editIdFromUrl);
  const [form, setForm] = useState<FormData | null>(null);
  const [title, setTitle] = useState('Wedding Photography Quotation');
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState(0);
  const [loadingExisting, setLoadingExisting] = useState(!!editIdFromUrl);

  const { data: customer, isLoading: loadingCustomer } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => adminApi.getCustomer(customerId).then((r) => r.data),
  });

  const { data: template } = useQuery({
    queryKey: ['wedding-template'],
    queryFn: () => adminApi.weddingTemplate().then((r) => r.data),
  });

  // Load existing draft / re-edit finalized (?id=agreementId, optional &edit=1)
  useEffect(() => {
    if (!editIdFromUrl) return;
    let cancelled = false;
    const forceEdit =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('edit') === '1';
    (async () => {
      try {
        const r = await adminApi.getWeddingAgreement(editIdFromUrl);
        const a = r.data?.agreement || r.agreement;
        if (cancelled || !a) return;
        const fd = a.formData || {};
        // PDF-only view for finalized unless user asked to edit again
        if (a.status === 'FINALIZED' && a.pdfUrl && !forceEdit) {
          setFinalUrl(a.pdfUrl);
          setAgreementId(a.id);
          setTitle(a.title || 'Wedding Service Agreement');
          // Still keep form so "Edit again" can work without reload
          setForm({ ...fd, days: ensureDays(fd) });
          setLoadingExisting(false);
          return;
        }
        setAgreementId(a.id);
        setForm({ ...fd, days: ensureDays(fd) });
        setTitle(a.title || 'Wedding Service Agreement');
        if (a.pdfUrl && !forceEdit) setFinalUrl(a.pdfUrl);
        else setFinalUrl(null); // editing mode
        if (a.status === 'FINALIZED' && forceEdit) {
          toast('Editing finalized agreement — save & re-finalize to update PDF');
        }
      } catch (e: any) {
        toast.error(e?.response?.data?.error?.message || 'Could not load agreement');
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editIdFromUrl]);

  const scopeOptions = template?.scopeOptions || DEFAULT_SCOPE;
  const deliverableCatalog = template?.deliverableCatalog || DEFAULT_DELIVERABLES;
  const timelineCatalog = template?.timelineCatalog || DEFAULT_TIMELINE;
  const responsibilityCatalog = template?.responsibilityCatalog || DEFAULT_RESPONSIBILITIES;

  const startMutation = useMutation({
    mutationFn: () => adminApi.createWeddingAgreement(customerId, { title }),
    onSuccess: (r) => {
      const a = r.data?.agreement || r.agreement;
      const fd = a.formData || {};
      const withDays = { ...fd, days: ensureDays(fd) };
      setAgreementId(a.id);
      setForm(withDays);
      setTitle(a.title || title);
      // Keep URL shareable for resume
      if (typeof window !== 'undefined') {
        const u = new URL(window.location.href);
        u.searchParams.set('id', a.id);
        window.history.replaceState({}, '', u.toString());
      }
      toast.success('Draft started — add as many coverage days as you need');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Could not start agreement'),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!agreementId || !form) throw new Error('No draft');
      const days = ensureDays(form);
      return adminApi.updateWeddingAgreement(agreementId, {
        title,
        formData: { ...form, days, coverageDays: String(days.length) },
        reopen: true, // allow re-edit of previously finalized
      });
    },
    onSuccess: () => {
      toast.success('Section saved');
      qc.invalidateQueries({ queryKey: ['wedding-agreements', customerId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Save failed'),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!agreementId || !form) throw new Error('No draft');
      const days = ensureDays(form);
      const formData = { ...form, days, coverageDays: String(days.length) };
      await adminApi.updateWeddingAgreement(agreementId, { title, formData });
      return adminApi.finalizeWeddingAgreement(agreementId, { formData });
    },
    onSuccess: (r) => {
      const url = r.data?.agreement?.pdfUrl || r.agreement?.pdfUrl;
      setFinalUrl(url || null);
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      qc.invalidateQueries({ queryKey: ['wedding-agreements', customerId] });
      toast.success('Agreement finalized — PDF ready. Use View on the client page anytime.');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Finalize failed'),
  });

  const setField = (key: string, value: any) => {
    setForm((prev) => ({ ...(prev || {}), [key]: value }));
  };

  const days: DayConfig[] = form ? ensureDays(form) : [];

  const setDays = (next: DayConfig[]) => {
    const renumbered = next.map((d, i) => ({
      ...d,
      dayNumber: i + 1,
      label: d.label?.match(/^Day \d+$/) ? `Day ${i + 1}` : d.label || `Day ${i + 1}`,
    }));
    setForm((prev) => ({
      ...(prev || {}),
      days: renumbered,
      coverageDays: String(renumbered.length),
    }));
  };

  const updateDay = (index: number, patch: Partial<DayConfig>) => {
    const next = days.map((d, i) => (i === index ? { ...d, ...patch } : d));
    setDays(next);
  };

  const toggleDayService = (dayIndex: number, serviceId: string) => {
    const day = days[dayIndex];
    const cur = day.services || [];
    const exists = cur.find((s) => s.id === serviceId);
    const services = exists
      ? cur.filter((x) => x.id !== serviceId)
      : [...cur, { id: serviceId, count: 1 }];
    updateDay(dayIndex, { services });
  };

  const setDayServiceCount = (dayIndex: number, serviceId: string, count: number) => {
    const day = days[dayIndex];
    const services = (day.services || []).map((s) =>
      s.id === serviceId ? { ...s, count: Math.max(1, count || 1) } : s,
    );
    updateDay(dayIndex, { services });
  };

  const addDay = () => {
    const n = days.length + 1;
    setDays([...days, newDay(n)]);
    setExpandedDay(n - 1);
  };

  const removeDay = (index: number) => {
    if (days.length <= 1) {
      toast.error('Keep at least one day');
      return;
    }
    setDays(days.filter((_, i) => i !== index));
    setExpandedDay(Math.max(0, index - 1));
  };

  const duplicateDay = (index: number) => {
    const src = days[index];
    const n = days.length + 1;
    const copy = newDay(n, {
      ...src,
      label: `${src.label || `Day ${src.dayNumber}`} (copy)`,
      id: undefined as any,
    });
    const next = [...days];
    next.splice(index + 1, 0, copy);
    setDays(next);
    setExpandedDay(index + 1);
  };

  const section = SECTIONS[step];
  const progress = useMemo(() => Math.round(((step + 1) / SECTIONS.length) * 100), [step]);

  if (loadingCustomer || loadingExisting) {
    return <div className="py-16 text-center text-sm" style={{ color: 'var(--ink-3)' }}>Loading…</div>;
  }
  if (!customer) {
    return <div className="py-16 text-center text-sm" style={{ color: 'var(--rose)' }}>Customer not found</div>;
  }

  if (!agreementId || !form) {
    return (
      <div className="animate-fade-up max-w-xl">
        <Link href={`/dashboard/clients/${customerId}`} className="inline-flex items-center gap-2 text-sm mb-6" style={{ color: 'var(--ink-2)' }}>
          <ArrowLeft size={16} /> Back to {customer.name}
        </Link>
        <p className="kicker mb-2">Agreements</p>
        <h1 className="font-display text-[32px] leading-tight mb-2" style={{ color: 'var(--ink)' }}>
          Make wedding agreement
        </h1>
        <p className="text-[14px] mb-6" style={{ color: 'var(--ink-2)' }}>
          Sectioned form with <strong>day-wise coverage</strong> — add any number of days and configure photographer, videographer, drone, live stream, etc. per day. Finalize → PDF for studio + client.
        </p>
        <div className="card p-6 space-y-4">
          <div>
            <label className="text-[12px] font-semibold block mb-1.5" style={{ color: 'var(--ink)' }}>Agreement title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            Client: <strong style={{ color: 'var(--ink)' }}>{customer.name}</strong>
            {customer.email ? ` · ${customer.email}` : ''}
          </div>
          <button
            type="button"
            className="btn-primary w-full py-3"
            disabled={startMutation.isPending}
            onClick={() => startMutation.mutate()}
          >
            {startMutation.isPending ? 'Starting…' : 'Start form'}
          </button>
        </div>
      </div>
    );
  }

  if (finalUrl) {
    return (
      <div className="animate-fade-up max-w-lg">
        <div className="card p-8 text-center">
          <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: 'var(--green-bg, #e8f5ec)' }}>
            <Check size={22} style={{ color: 'var(--green)' }} />
          </div>
          <h1 className="font-display text-2xl mb-2" style={{ color: 'var(--ink)' }}>Agreement finalized</h1>
          <p className="text-[14px] mb-6" style={{ color: 'var(--ink-2)' }}>
            Day-wise PDF is ready. Payment terms synced to the client profile.
          </p>
          <div className="flex flex-col gap-2"><ShareLinkButton path={`/contracts?id=${agreementId}`} />
            <PdfUploadButton endpoint={`/admin/agreements/${agreementId}/pdf`} onUploaded={async () => { const r = await adminApi.getWeddingAgreement(agreementId!); setFinalUrl(r.data?.agreement?.pdfUrl || r.agreement?.pdfUrl); }} />
            <a href={finalUrl} target="_blank" rel="noreferrer" className="btn-primary py-3 text-center">
              Download PDF
            </a>
            <button
              type="button"
              className="btn-ghost py-3"
              onClick={() => {
                setFinalUrl(null);
                setStep(0);
                toast('Editing agreement — save sections then re-finalize for a new PDF');
              }}
            >
              Edit agreement
            </button>
            <Link href={`/dashboard/clients/${customerId}`} className="btn-ghost py-3 text-center">
              Back to client
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up max-w-2xl">
      <Link href={`/dashboard/clients/${customerId}`} className="inline-flex items-center gap-2 text-sm mb-5" style={{ color: 'var(--ink-2)' }}>
        <ArrowLeft size={16} /> {customer.name}
      </Link>

      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="kicker mb-1">Wedding agreement</p>
          <h1 className="font-display text-[28px] leading-tight" style={{ color: 'var(--ink)' }}>
            {section.title}
          </h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
            Section {step + 1} of {SECTIONS.length}
            {section.id === 'days' ? ` · ${days.length} day${days.length === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <FileText size={20} style={{ color: 'var(--ink-3)' }} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4"><ShareLinkButton path={`/contracts?id=${agreementId}`} />
            <PdfUploadButton endpoint={`/admin/agreements/${agreementId}/pdf`} onUploaded={async () => { const r = await adminApi.getWeddingAgreement(agreementId!); setFinalUrl(r.data?.agreement?.pdfUrl || r.agreement?.pdfUrl); }} /></div>
      <div className="h-1.5 rounded-full mb-6 overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--ink)' }} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-6">
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(i)}
            className="text-[11px] px-2.5 py-1 rounded-full font-medium"
            style={{
              background: i === step ? 'var(--ink)' : 'var(--surface-sunken)',
              color: i === step ? '#fff' : 'var(--ink-2)',
            }}
          >
            {i + 1}. {s.title.split(' ')[0]}
          </button>
        ))}
      </div>

      <div className="card p-6 space-y-4 mb-6">
        {section.id === 'parties' && (
          <>
            <Field label="Agreement date" value={form.agreementDate} onChange={(v) => setField('agreementDate', v)} type="date" />
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--gold)' }}>Client</p>
            <Field label="Client name" value={form.clientName} onChange={(v) => setField('clientName', v)} />
            <Field label="Client email" value={form.clientEmail} onChange={(v) => setField('clientEmail', v)} />
            <Field label="Client phone" value={form.clientPhone} onChange={(v) => setField('clientPhone', v)} />
            <Field label="Partner / second contact" value={form.partnerName} onChange={(v) => setField('partnerName', v)} />
            <Field label="Partner phone" value={form.partnerPhone} onChange={(v) => setField('partnerPhone', v)} />
            <Field label="Client address" value={form.billingAddress} onChange={(v) => setField('billingAddress', v)} textarea />
            <p className="text-[12px] font-semibold uppercase tracking-wide pt-2" style={{ color: 'var(--gold)' }}>Studio / photographer</p>
            <Field label="Studio name" value={form.studioName} onChange={(v) => setField('studioName', v)} placeholder="SJ Clicks & Films" />
            <Field label="Studio address" value={form.studioAddress} onChange={(v) => setField('studioAddress', v)} textarea />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Studio phone" value={form.studioPhone} onChange={(v) => setField('studioPhone', v)} />
              <Field label="Studio email" value={form.studioEmail} onChange={(v) => setField('studioEmail', v)} />
            </div>
            <Field label="Website" value={form.studioWebsite} onChange={(v) => setField('studioWebsite', v)} placeholder="www.warmkelvin.com" />
            <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
              Blank studio fields are filled from studio profile when you finalize.
            </p>
          </>
        )}

        {section.id === 'event' && (
          <>
            <Field label="Event type" value={form.eventType} onChange={(v) => setField('eventType', v)} />
            <Field
              label="Event dates (as shown on PDF)"
              value={form.eventDatesLabel}
              onChange={(v) => setField('eventDatesLabel', v)}
              placeholder="e.g. 25 & 26 NOVEMBER 2026"
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primary event date" value={form.eventDate} onChange={(v) => setField('eventDate', v)} type="date" />
              <Field label="Main ceremony date" value={form.mainCeremonyDate} onChange={(v) => setField('mainCeremonyDate', v)} type="date" />
            </div>
            <Field label="City" value={form.eventCity} onChange={(v) => setField('eventCity', v)} />
            <Field label="Wedding venue" value={form.primaryVenue} onChange={(v) => setField('primaryVenue', v)} />
            <Field label="Additional venues" value={form.additionalVenues} onChange={(v) => setField('additionalVenues', v)} textarea />
            <Field label="Estimated guests" value={form.guestCount} onChange={(v) => setField('guestCount', v)} />
            <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
              Configure each day&apos;s date, venue, crew counts, and services in <strong>Day-wise coverage</strong>.
            </p>
          </>
        )}

        {section.id === 'package' && (
          <>
            <Field label="Package name" value={form.packageName} onChange={(v) => setField('packageName', v)} />
            <Field label="Total coverage hours (optional)" value={form.coverageHours} onChange={(v) => setField('coverageHours', v)} />
            <div className="text-[13px] px-3 py-2 rounded-lg" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
              Number of days is controlled in <strong>Day-wise coverage</strong> (currently {days.length}).
            </div>
            <Field label="Package notes" value={form.packageNotes} onChange={(v) => setField('packageNotes', v)} textarea />
          </>
        )}

        {section.id === 'days' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
                Add any number of days. For each day, set date, times, venue, and which services run that day (live stream, drone, etc.).
              </p>
              <button type="button" className="btn-primary flex items-center gap-1.5 px-3 py-2 text-sm shrink-0" onClick={addDay}>
                <Plus size={14} /> Add day
              </button>
            </div>

            <div className="space-y-3">
              {days.map((day, di) => {
                const open = expandedDay === di;
                return (
                  <div
                    key={day.id}
                    className="rounded-xl border overflow-hidden"
                    style={{ borderColor: open ? 'var(--ink)' : 'var(--line)' }}
                  >
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-4 py-3 text-left"
                      style={{ background: open ? 'var(--surface-sunken)' : 'transparent' }}
                      onClick={() => setExpandedDay(open ? -1 : di)}
                    >
                      <span className="font-semibold text-[14px]" style={{ color: 'var(--ink)' }}>
                        {day.label || `Day ${di + 1}`}
                      </span>
                      <span className="text-[12px] truncate flex-1" style={{ color: 'var(--ink-3)' }}>
                        {[day.date, day.venue, (day.services || []).length ? `${day.services.length} services` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="text-[11px] font-medium" style={{ color: 'var(--ink-3)' }}>
                        {open ? 'Collapse' : 'Edit'}
                      </span>
                    </button>

                    {open && (
                      <div className="px-4 pb-4 pt-1 space-y-3 border-t" style={{ borderColor: 'var(--line)' }}>
                        <Field
                          label="Day label"
                          value={day.label}
                          onChange={(v) => updateDay(di, { label: v })}
                          placeholder="e.g. Day 1 — Mehendi, Day 2 — Wedding"
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Date" value={day.date} onChange={(v) => updateDay(di, { date: v })} type="date" />
                          <Field label="Venue" value={day.venue} onChange={(v) => updateDay(di, { venue: v })} />
                          <Field label="Start time" value={day.startTime} onChange={(v) => updateDay(di, { startTime: v })} placeholder="e.g. 10:00 AM" />
                          <Field label="End time" value={day.endTime} onChange={(v) => updateDay(di, { endTime: v })} placeholder="e.g. 11:00 PM" />
                        </div>

                        <div>
                          <label className="text-[12px] font-semibold block mb-2" style={{ color: 'var(--ink)' }}>
                            Services on this day (tick + set count, e.g. 2 Candid Photographers)
                          </label>
                          <div className="grid sm:grid-cols-2 gap-2">
                            {scopeOptions.map((opt: any) => {
                              const entry = (day.services || []).find((s) => s.id === opt.id);
                              const on = !!entry;
                              return (
                                <div
                                  key={opt.id}
                                  className="flex items-center gap-2 px-3 py-2 rounded-xl border text-[13px]"
                                  style={{
                                    borderColor: on ? 'var(--ink)' : 'var(--line)',
                                    background: on ? 'var(--surface-sunken)' : 'transparent',
                                    color: 'var(--ink)',
                                  }}
                                >
                                  <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={on}
                                      onChange={() => toggleDayService(di, opt.id)}
                                    />
                                    <span className="truncate">{opt.label}</span>
                                  </label>
                                  {on && (
                                    <input
                                      type="number"
                                      min={1}
                                      max={20}
                                      className="input w-14 py-1 px-2 text-center"
                                      value={entry?.count ?? 1}
                                      onChange={(e) =>
                                        setDayServiceCount(di, opt.id, parseInt(e.target.value || '1', 10))
                                      }
                                      title="Count"
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {(day.services || []).some((s) => s.id === 'custom') && (
                          <Field
                            label="Custom service for this day"
                            value={day.customService}
                            onChange={(v) => updateDay(di, { customService: v })}
                            textarea
                          />
                        )}

                        <Field
                          label="Notes for this day (crew, logistics)"
                          value={day.notes}
                          onChange={(v) => updateDay(di, { notes: v })}
                          textarea
                        />

                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-sm"
                            onClick={() => duplicateDay(di)}
                          >
                            <Copy size={13} /> Duplicate day
                          </button>
                          <button
                            type="button"
                            className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-sm"
                            style={{ color: 'var(--rose)' }}
                            onClick={() => removeDay(di)}
                            disabled={days.length <= 1}
                          >
                            <Trash2 size={13} /> Remove day
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button type="button" className="btn-ghost w-full py-2.5 flex items-center justify-center gap-2" onClick={addDay}>
              <Plus size={15} /> Add another day
            </button>

            <Field
              label="Overall crew / logistics notes (all days)"
              value={form.scopeNotes}
              onChange={(v) => setField('scopeNotes', v)}
              textarea
            />
          </>
        )}

        {section.id === 'deliverables' && (
          <>
            <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
              <strong>DELIVERABLES &amp; SCOPE OF WORK</strong>
              <br />
              The Photographer/Studio agrees to deliver the following items as part of the final package.
              Tick what is included; edit quantities where shown. Add custom items at the bottom.
            </p>

            <div className="space-y-3">
              {deliverableCatalog.map((cat: any) => {
                const selected: any[] = Array.isArray(form.deliverables) ? form.deliverables : [];
                const entry = selected.find((d) => d.id === cat.id);
                const on = !!entry;
                return (
                  <div
                    key={cat.id}
                    className="rounded-xl border p-3"
                    style={{
                      borderColor: on ? 'var(--ink)' : 'var(--line)',
                      background: on ? 'var(--surface-sunken)' : 'transparent',
                    }}
                  >
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={() => {
                          const cur: any[] = Array.isArray(form.deliverables) ? [...form.deliverables] : [];
                          if (on) {
                            setField('deliverables', cur.filter((d) => d.id !== cat.id));
                          } else {
                            setField('deliverables', [
                              ...cur,
                              {
                                id: cat.id,
                                ...(cat.defaultQty ? { qty: cat.defaultQty } : {}),
                              },
                            ]);
                          }
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[13px]" style={{ color: 'var(--ink)' }}>
                          {cat.title}
                          {on && entry?.qty ? ` (${entry.qty} Nos.)` : cat.defaultQty && !on ? ` (${cat.defaultQty} Nos.)` : ''}
                        </div>
                        <div className="text-[12px] mt-1 leading-snug" style={{ color: 'var(--ink-2)' }}>
                          {cat.description}
                        </div>
                        {on && cat.defaultQty && (
                          <div className="mt-2 max-w-[160px]">
                            <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--ink-3)' }}>
                              {cat.qtyLabel || 'Quantity'}
                            </label>
                            <input
                              className="input"
                              type="number"
                              value={entry?.qty ?? cat.defaultQty}
                              onChange={(e) => {
                                const cur: any[] = Array.isArray(form.deliverables) ? [...form.deliverables] : [];
                                setField(
                                  'deliverables',
                                  cur.map((d) => (d.id === cat.id ? { ...d, qty: e.target.value } : d)),
                                );
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                );
              })}
            </div>

            {/* Custom deliverables list */}
            <div className="pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
                  Custom deliverables
                </label>
                <button
                  type="button"
                  className="btn-ghost text-sm px-2 py-1 flex items-center gap-1"
                  onClick={() => {
                    const cur: any[] = Array.isArray(form.deliverables) ? [...form.deliverables] : [];
                    const customCount = cur.filter((d) => String(d.id).startsWith('custom-')).length;
                    setField('deliverables', [
                      ...cur,
                      {
                        id: `custom-${customCount + 1}-${Date.now().toString(36)}`,
                        customTitle: '',
                        customDescription: '',
                        qty: '',
                      },
                    ]);
                  }}
                >
                  <Plus size={14} /> Add custom
                </button>
              </div>
              {(Array.isArray(form.deliverables) ? form.deliverables : [])
                .filter((d: any) => String(d.id).startsWith('custom-'))
                .map((d: any) => (
                  <div key={d.id} className="rounded-xl border p-3 mb-2 space-y-2" style={{ borderColor: 'var(--line)' }}>
                    <Field
                      label="Title"
                      value={d.customTitle}
                      onChange={(v) => {
                        const cur: any[] = [...(form.deliverables || [])];
                        setField(
                          'deliverables',
                          cur.map((x) => (x.id === d.id ? { ...x, customTitle: v } : x)),
                        );
                      }}
                      placeholder="e.g. Premium leather album"
                    />
                    <Field
                      label="Description"
                      value={d.customDescription}
                      onChange={(v) => {
                        const cur: any[] = [...(form.deliverables || [])];
                        setField(
                          'deliverables',
                          cur.map((x) => (x.id === d.id ? { ...x, customDescription: v } : x)),
                        );
                      }}
                      textarea
                    />
                    <button
                      type="button"
                      className="text-sm"
                      style={{ color: 'var(--rose)' }}
                      onClick={() => {
                        setField(
                          'deliverables',
                          (form.deliverables || []).filter((x: any) => x.id !== d.id),
                        );
                      }}
                    >
                      Remove custom item
                    </button>
                  </div>
                ))}
            </div>

            <Field label="Delivery method" value={form.deliveryMethod} onChange={(v) => setField('deliveryMethod', v)} />
            <Field label="Additional notes" value={form.otherDeliverables} onChange={(v) => setField('otherDeliverables', v)} textarea />
          </>
        )}

        {section.id === 'timeline' && (
          <>
            <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
              <strong>DELIVERY TIMELINE &amp; PROCESS</strong>
              <br />
              Tick items to include, then set the timeframe for each (shown on the PDF).
            </p>
            <div className="space-y-3">
              {timelineCatalog.map((cat: any) => {
                const selected: any[] = Array.isArray(form.timelineItems) ? form.timelineItems : [];
                const entry = selected.find((d) => d.id === cat.id);
                const on = !!entry;
                return (
                  <div
                    key={cat.id}
                    className="rounded-xl border p-3 space-y-2"
                    style={{
                      borderColor: on ? 'var(--ink)' : 'var(--line)',
                      background: on ? 'var(--surface-sunken)' : 'transparent',
                    }}
                  >
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={() => {
                          const cur: any[] = Array.isArray(form.timelineItems) ? [...form.timelineItems] : [];
                          if (on) {
                            setField('timelineItems', cur.filter((d) => d.id !== cat.id));
                          } else {
                            setField('timelineItems', [
                              ...cur,
                              {
                                id: cat.id,
                                title: cat.title,
                                timeframe: cat.defaultTimeframe,
                                description: cat.description,
                              },
                            ]);
                          }
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[13px]" style={{ color: 'var(--ink)' }}>
                          {cat.title}
                        </div>
                        <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
                          {cat.description}
                        </div>
                      </div>
                    </label>
                    {on && (
                      <Field
                        label="Timeframe"
                        value={entry?.timeframe ?? cat.defaultTimeframe}
                        onChange={(v) => {
                          const cur: any[] = Array.isArray(form.timelineItems) ? [...form.timelineItems] : [];
                          setField(
                            'timelineItems',
                            cur.map((d) => (d.id === cat.id ? { ...d, timeframe: v } : d)),
                          );
                        }}
                        placeholder={cat.defaultTimeframe}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {section.id === 'responsibilities' && (
          <>
            <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
              <strong>PHOTOGRAPHER&apos;S RESPONSIBILITIES</strong>
              <br />
              Select which commitments appear on the agreement PDF.
            </p>
            <div className="space-y-2">
              {responsibilityCatalog.map((cat: any) => {
                const selected: any[] = Array.isArray(form.responsibilities) ? form.responsibilities : [];
                const on = selected.some((d) => d.id === cat.id);
                return (
                  <label
                    key={cat.id}
                    className="flex items-start gap-2 rounded-xl border p-3 cursor-pointer"
                    style={{
                      borderColor: on ? 'var(--ink)' : 'var(--line)',
                      background: on ? 'var(--surface-sunken)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={on}
                      onChange={() => {
                        const cur: any[] = Array.isArray(form.responsibilities) ? [...form.responsibilities] : [];
                        if (on) {
                          setField('responsibilities', cur.filter((d) => d.id !== cat.id));
                        } else {
                          setField('responsibilities', [
                            ...cur,
                            { id: cat.id, title: cat.title, description: cat.description },
                          ]);
                        }
                      }}
                    />
                    <div>
                      <div className="font-semibold text-[13px]" style={{ color: 'var(--ink)' }}>{cat.title}</div>
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-2)' }}>{cat.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {section.id === 'payment' && (
          <>
            <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
              <strong>TOTAL PACKAGE COST</strong> — shown prominently on the PDF. Specify what is included / excluded.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency" value={form.currency || 'INR'} onChange={(v) => setField('currency', v)} />
              <Field label="Total package fee" value={form.totalFee} onChange={(v) => setField('totalFee', v)} type="number" />
            </div>
            <Field
              label="Amount in words"
              value={form.totalFeeInWords}
              onChange={(v) => setField('totalFeeInWords', v)}
              placeholder="e.g. One Lakh Ninety Thousand only"
            />
            <Field
              label="What the fee includes"
              value={form.costIncludesText}
              onChange={(v) => setField('costIncludesText', v)}
              placeholder="Includes complete team charges, equipment, post-production"
              textarea
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-semibold block mb-1.5" style={{ color: 'var(--ink)' }}>Travelling</label>
                <select
                  className="input"
                  value={form.travelIncluded ?? 'yes'}
                  onChange={(e) => setField('travelIncluded', e.target.value)}
                >
                  <option value="yes">Included</option>
                  <option value="partial">Partially included</option>
                  <option value="no">Excluded</option>
                </select>
              </div>
              <div>
                <label className="text-[12px] font-semibold block mb-1.5" style={{ color: 'var(--ink)' }}>Stay</label>
                <select
                  className="input"
                  value={form.stayIncluded ?? 'no'}
                  onChange={(e) => setField('stayIncluded', e.target.value)}
                >
                  <option value="yes">Included</option>
                  <option value="no">Excluded</option>
                </select>
              </div>
            </div>
            <Field label="Travel / stay notes" value={form.travelNotes} onChange={(v) => setField('travelNotes', v)} textarea />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Advance / booking" value={form.advanceFee} onChange={(v) => setField('advanceFee', v)} type="number" />
              <Field label="Amount paid so far" value={form.amountPaid} onChange={(v) => setField('amountPaid', v)} type="number" />
              <Field label="Balance due" value={form.balanceDue} onChange={(v) => setField('balanceDue', v)} type="number" />
              <Field label="Balance due date" value={form.balanceDueDate} onChange={(v) => setField('balanceDueDate', v)} type="date" />
            </div>
            <Field label="Payment method" value={form.paymentMethod} onChange={(v) => setField('paymentMethod', v)} />
            <Field label="Payment schedule / terms" value={form.paymentTermsText} onChange={(v) => setField('paymentTermsText', v)} textarea />
            <Field label="Extra hour rate" value={form.extraHourRate} onChange={(v) => setField('extraHourRate', v)} type="number" />
          </>
        )}

        {section.id === 'terms' && (
          <>
            <Field label="General terms (blank = studio defaults)" value={form.generalTerms} onChange={(v) => setField('generalTerms', v)} textarea rows={8} />
            <Field label="Special conditions" value={form.specialConditions} onChange={(v) => setField('specialConditions', v)} textarea />
            <Field label="Studio signatory name" value={form.studioSignatory} onChange={(v) => setField('studioSignatory', v)} />
          </>
        )}

        {section.id === 'review' && (
          <div className="space-y-4 text-[13px]" style={{ color: 'var(--ink-2)' }}>
            <ReviewRow label="Client" value={form.clientName} />
            <ReviewRow label="Event" value={[form.eventDate, form.primaryVenue, form.eventCity].filter(Boolean).join(' · ')} />
            <ReviewRow label="Package" value={form.packageName} />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--ink-3)' }}>
                Day-wise coverage ({days.length})
              </div>
              <div className="space-y-2">
                {days.map((d) => (
                  <div key={d.id} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
                    <div className="font-semibold" style={{ color: 'var(--ink)' }}>{d.label}</div>
                    <div className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
                      {[d.date, d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : null, d.venue]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className="text-[12px] mt-1" style={{ color: 'var(--ink-2)' }}>
                      {(d.services || [])
                        .map((s) => {
                          if (s.id === 'custom') {
                            const label = d.customService ? `Custom: ${d.customService}` : 'Custom';
                            return s.count > 1 ? `${s.count}× ${label}` : label;
                          }
                          const label = scopeOptions.find((o: any) => o.id === s.id)?.label || s.id;
                          return s.count > 1 ? `${s.count}× ${label}` : label;
                        })
                        .join(', ') || 'No services selected'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <ReviewRow label="Total fee" value={form.totalFee ? `${form.currency || 'INR'} ${form.totalFee}` : '—'} />
            <ReviewRow label="Payment terms" value={form.paymentTermsText} />
            <p className="pt-1" style={{ color: 'var(--ink-3)' }}>
              Finalize generates a PDF with day-wise services, for studio + client download.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost px-4 py-2.5" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          Back
        </button>
        <button type="button" className="btn-ghost px-4 py-2.5" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? 'Saving…' : 'Save draft'}
        </button>
        <div className="flex-1" />
        {step < SECTIONS.length - 1 ? (
          <button
            type="button"
            className="btn-primary px-5 py-2.5"
            onClick={() => {
              saveMutation.mutate(undefined, {
                onSuccess: () => setStep((s) => Math.min(SECTIONS.length - 1, s + 1)),
              });
            }}
          >
            Next section
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary px-5 py-2.5 inline-flex items-center gap-2"
            disabled={finalizeMutation.isPending}
            onClick={() => {
              if (confirm('Finalize and generate PDF for studio + client?')) finalizeMutation.mutate();
            }}
          >
            {finalizeMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Finalize agreement
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
  type = 'text',
  placeholder,
  rows = 3,
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  textarea?: boolean;
  type?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div>
      <label className="text-[12px] font-semibold block mb-1.5" style={{ color: 'var(--ink)' }}>{label}</label>
      {textarea ? (
        <textarea className="input resize-none" rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="input" type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 border-b pb-2" style={{ borderColor: 'var(--line)' }}>
      <div className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
        {label}
      </div>
      <div style={{ color: 'var(--ink)' }}>{value}</div>
    </div>
  );
}
