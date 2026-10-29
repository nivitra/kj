'use client';
import ShareLinkButton from '@/components/ShareLinkButton';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { portalApi } from '@/lib/api';
import Modal from '@/components/Modal';
import ImageCropModal from '@/components/ImageCropModal';

const DEFAULT_STEPS = [
  'Enquiry received',
  'Booking confirmed',
  'Shoot scheduled',
  'Shoot completed',
  'Editing',
  'Ready for delivery',
  'Delivered',
];

export default function ServicePackagesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-packages'],
    queryFn: () => portalApi.packages().then((r) => r.data),
  });
  const [eventType, setEventType] = useState('GENERAL');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [details, setDetails] = useState<Record<string, any>>({});
  const [clearCover, setClearCover] = useState(false);
  const [originalSteps, setOriginalSteps] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0');
  const [discount, setDiscount] = useState('');
  const [features, setFeatures] = useState('');
  const [bookingStepsText, setBookingStepsText] = useState(DEFAULT_STEPS.join('\n'));
  const [featured, setFeatured] = useState(false);
  const [includedPhotos, setIncludedPhotos] = useState('');
  const [pricePerExtra, setPricePerExtra] = useState('');
  const [pricePerExtraRaw, setPricePerExtraRaw] = useState('');
  const [workflowMode, setWorkflowMode] = useState('SELECT_ONLY');
  const [cover, setCover] = useState<File | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const packages = (data?.packages || []).filter((p: any) => showArchived || p.active !== false);


  const { data: portfolioData } = useQuery({
    queryKey: ['portal-portfolio'],
    queryFn: () => portalApi.portfolio().then((r) => r.data),
  });
  const portfolioItems = portfolioData?.items || [];
  // Flatten Our Work media for cover picker
  const portfolioPhotos = portfolioItems.flatMap((it: any) => {
    const media = Array.isArray(it.media) && it.media.length
      ? it.media
      : it.coverUrl
        ? [{ url: it.coverUrl, id: it.id }]
        : [];
    return media
      .filter((m: any) => m.url && m.mediaType !== 'VIDEO')
      .map((m: any, idx: number) => ({
        url: m.url as string,
        mediaKey: (m.mediaKey || it.coverKey || null) as string | null,
        workId: it.id as string,
        workTitle: it.title as string,
        mediaIndex: idx,
        mediaId: m.id as string | null,
      }));
  });

  const resetForm = () => {
    setEditingId(null);
    setEventType('GENERAL'); setDisplayOrder('0'); setActive(true); setDetails({}); setOriginalSteps([]); setClearCover(false);
    setTitle('');
    setDescription('');
    setPrice('0');
    setDiscount('');
    setFeatures('');
    setBookingStepsText(DEFAULT_STEPS.join('\n'));
    setFeatured(false);
    setIncludedPhotos('');
    setPricePerExtra('');
    setPricePerExtraRaw('');
    setWorkflowMode('SELECT_ONLY');
    setCover(null);
    setCoverKey(null);
    setCoverPreview(null);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (p: any) => {
    setEditingId(p.id);
    setEventType(p.eventType || 'GENERAL'); setDisplayOrder(String(p.displayOrder || 0)); setActive(p.active !== false); setDetails(p.details || {}); setOriginalSteps(p.bookingSteps || []); setClearCover(false);
    setTitle(p.title || '');
    setDescription(p.description || '');
    setPrice(String(p.price ?? 0));
    setDiscount(p.discountPrice != null ? String(p.discountPrice) : '');
    setFeatures((p.features || []).map((f: any) => f.title).join('\n'));
    const steps = (p.bookingSteps || []).map((s: any) => s.label || s.key).filter(Boolean);
    setBookingStepsText(steps.length ? steps.join('\n') : DEFAULT_STEPS.join('\n'));
    setFeatured(!!p.isFeatured);
    setIncludedPhotos(p.includedPhotos != null ? String(p.includedPhotos) : '');
    setPricePerExtra(
      p.pricePerExtraEdited != null
        ? String(p.pricePerExtraEdited)
        : p.pricePerExtraPhoto != null
          ? String(p.pricePerExtraPhoto)
          : '',
    );
    setPricePerExtraRaw(
      p.pricePerExtraRaw != null ? String(p.pricePerExtraRaw) : '',
    );
    setWorkflowMode(p.workflowMode || 'SELECT_ONLY');
    setCover(null);
    setCoverKey(null);
    setCoverPreview(p.coverUrl || null);
    setOpen(true);
  };

  const buildForm = () => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('eventType', eventType); fd.append('details', JSON.stringify(details)); fd.append('displayOrder', displayOrder); fd.append('active', String(active));
    fd.append('description', description);
    fd.append('price', price);
    fd.append('discountPrice', discount);
    fd.append('isFeatured', String(featured));
    fd.append('includedPhotos', includedPhotos);
    fd.append('pricePerExtraPhoto', pricePerExtra);
    fd.append('pricePerExtraEdited', pricePerExtra);
    fd.append('pricePerExtraRaw', pricePerExtraRaw);
    fd.append('workflowMode', workflowMode);
    fd.append(
      'features',
      JSON.stringify(features.split('\n').map((s) => s.trim()).filter(Boolean)),
    );
    const labels = bookingStepsText.split('\n').map(s=>s.trim()).filter(Boolean);
    const usedKeys = new Set<string>();
    const steps = labels.map((label,order)=>{
      const exact = originalSteps.find(s=>s.label===label);
      const oldAt = originalSteps[order];
      let key = exact?.key || (oldAt && !labels.includes(oldAt.label) ? oldAt.key : label.toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,45));
      if (!key || usedKeys.has(key)) key = `STEP_${Date.now()}_${order}`;
      usedKeys.add(key);
      return {key,label,order};
    });
    fd.append('bookingSteps', JSON.stringify(steps));
    if (cover) fd.append('cover', cover);
    else if (coverKey) fd.append('coverKey', coverKey);
    else if (clearCover) fd.append('coverKey', '');
    return fd;
  };

  const save = useMutation({
    mutationFn: async () => {
      const fd = buildForm();
      if (editingId) return portalApi.updatePackage(editingId, fd);
      return portalApi.createPackage(fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-packages'] });
      toast.success(editingId ? 'Package updated' : 'Package published to customer app');
      setOpen(false);
      resetForm();
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed'),
  });

  const del = useMutation({
    mutationFn: (id: string) => portalApi.deletePackage(id),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['portal-packages'] });
      const d = r?.data || r;
      toast.success(d?.message || (d?.archived ? 'Hidden from the client app' : 'Deleted'));
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Could not delete'),
  });

  const money = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
  const moneyOnwards = (n: number) => (n > 0 ? `${money(n)} onwards` : 'Contact for price');

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <p className="kicker mb-2">Studio</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>
            Packages
          </h1>
          <p className="text-[14px] mt-1.5 max-w-2xl" style={{ color: 'var(--ink-2)' }}>
            Create packages clients can browse and book. Set pricing, included photos,
            extra-photo rates, and delivery steps in one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-[12px] flex items-center gap-2" style={{ color: 'var(--ink-2)' }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <button type="button" className="btn-primary flex items-center gap-2 px-4 py-2.5" onClick={openCreate}>
            <Plus size={16} /> New package
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading && (
          <div className="card p-8 text-sm col-span-full text-center" style={{ color: 'var(--ink-3)' }}>
            Loading…
          </div>
        )}
        {packages.map((p: any) => (
          <div key={p.id} className="card overflow-hidden flex flex-col">
            <div className="h-36 bg-[var(--surface-sunken)]">
              {p.coverUrl ? <img src={p.coverUrl} alt="" className="w-full h-full object-cover" /> : null}
            </div>
            <div className="p-4 flex-1 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-lg" style={{ color: 'var(--ink)' }}>
                  {p.title}
                </h2>
                {p.isFeatured && <span className="badge badge-green">featured</span>}
                {p.active === false && <span className="badge badge-neutral">hidden from app</span>}
              </div>
              <p className="text-[13px] mt-1 line-clamp-2" style={{ color: 'var(--ink-2)' }}>
                {p.description}
              </p>
              <p className="text-[12px] mt-2 font-medium" style={{ color: 'var(--ink)' }}>
                {p.includedPhotos != null ? `${p.includedPhotos} photos included` : 'Included allowance not set'}
                {' · '}
                {p.pricePerExtraPhoto != null
                  ? `₹${Number(p.pricePerExtraPhoto).toLocaleString('en-IN')}/extra`
                  : 'no ₹/extra'}
              </p>
              <ul className="mt-3 space-y-1 text-[12px]" style={{ color: 'var(--ink-2)' }}>
                {(p.features || []).slice(0, 4).map((f: any) => (
                  <li key={f.id}>· {f.title}</li>
                ))}
              </ul>
              {(p.bookingSteps || []).length > 0 && (
                <div className="mt-3 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                  {(p.bookingSteps || []).length} booking steps ·{' '}
                  {(p.bookingSteps || [])
                    .slice(0, 3)
                    .map((s: any) => s.label)
                    .join(' → ')}
                  {(p.bookingSteps || []).length > 3 ? '…' : ''}
                </div>
              )}
              <div className="mt-auto pt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  {p.discountPrice != null ? (
                    <>
                      <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                        {moneyOnwards(p.discountPrice)}
                      </span>
                      <span className="text-[12px] line-through ml-2" style={{ color: 'var(--ink-3)' }}>
                        {money(p.price)}
                      </span>
                    </>
                  ) : (
                    <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                      {moneyOnwards(p.price)}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <ShareLinkButton path={`/packages?id=${p.id}`} />
                  <button type="button" aria-label="Edit package" title="Edit package" className="p-2" style={{ color: 'var(--ink-2)' }} onClick={() => openEdit(p)}>
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="p-2"
                    style={{ color: 'var(--ink-3)' }}
                    onClick={() => {
                      if (confirm(`Remove “${p.title}” from the client app? If it is still linked to clients or invoices it will be hidden, not zeroed.`)) {
                        del.mutate(p.id);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => !save.isPending && setOpen(false)}
        title={editingId ? 'Edit package' : 'New package'}
        preventClose={save.isPending}
        size="md"
        footer={
          <>
            <button type="button" className="btn-ghost flex-1 py-2.5" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={!title || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : editingId ? 'Save' : 'Publish'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <input className="input" placeholder="Title *" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea
            className="input resize-none"
            rows={3}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <input className="input" type="number" placeholder="Price (INR)" value={price} onChange={(e) => setPrice(e.target.value)} />
            <input
              className="input"
              type="number"
              placeholder="From price (optional)"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div
            className="rounded-xl p-3 space-y-2"
            style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}
          >
            <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
              Photo selection (same package clients get assigned)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] mb-1" style={{ color: 'var(--ink-3)' }}>Free included</div>
                <input
                  className="input w-full"
                  type="number"
                  min={0}
                  value={includedPhotos}
                  onChange={(e) => setIncludedPhotos(e.target.value)}
                />
              </div>
              <div>
                <div className="text-[11px] mb-1" style={{ color: 'var(--ink-3)' }}>₹ / extra photo</div>
                <input
                  className="input w-full"
                  type="number"
                  min={0}
                  value={pricePerExtra}
                  onChange={(e) => setPricePerExtra(e.target.value)}
                  placeholder="Set a rate"
                />
              </div>
              <div>
                <div className="text-[11px] mb-1" style={{ color: 'var(--ink-3)' }}>₹ / extra raw</div>
                <input
                  className="input w-full"
                  type="number"
                  min={0}
                  value={pricePerExtraRaw}
                  onChange={(e) => setPricePerExtraRaw(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
              Customers can select any number of photos. This allowance and rate determine only the additional cost. Leave blank to configure per gallery.
            </p>
            <select className="input w-full" value={workflowMode} onChange={(e) => setWorkflowMode(e.target.value)}>
              <option value="SELECT_ONLY">Selection only (hearts, no download)</option>
              <option value="SELECT_AND_DOWNLOAD">Selection + download when unlocked</option>
              <option value="DOWNLOAD_ONLY">Delivery only (no selection)</option>
            </select>
          </div>
          <textarea
            className="input resize-none"
            rows={4}
            placeholder="Features (one per line)"
            value={features}
            onChange={(e) => setFeatures(e.target.value)}
          />
          <div>
            <div className="text-[12px] font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Booking timeline steps (one per line — used for this package’s customer status)
            </div>
            <textarea
              className="input resize-none font-mono text-[12px]"
              rows={7}
              placeholder="One step per line"
              value={bookingStepsText}
              onChange={(e) => setBookingStepsText(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">Event type<input className="input mt-1" value={eventType} onChange={e=>setEventType(e.target.value.toUpperCase())}/></label>
            <label className="text-xs">Display order<input className="input mt-1" type="number" value={displayOrder} onChange={e=>setDisplayOrder(e.target.value)}/></label>
          </div>
          {['duration','crew','deliverables','deliveryTimeline','terms'].map(key=><label className="block text-xs" key={key}>{({duration:'Coverage duration',crew:'Crew and equipment',deliverables:'Deliverables',deliveryTimeline:'Delivery timeline',terms:'Terms and exclusions'} as Record<string,string>)[key]}<textarea className="input mt-1" rows={2} value={details[key]||''} onChange={e=>setDetails(d=>({...d,[key]:e.target.value}))}/></label>)}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>Visible in customer app</label>
          <button className="btn-secondary" type="button" onClick={()=>{setCover(null);setCoverKey(null);setCoverPreview(null);setClearCover(true);}}>Remove cover image</button>
          <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink)' }}>
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} /> Featured on
            home
          </label>

          <div>
            <div className="text-[12px] font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Cover image
            </div>
            {(coverPreview || cover) && (
              <div className="mb-2 h-28 w-full rounded-lg overflow-hidden bg-[var(--surface-sunken)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cover ? URL.createObjectURL(cover) : coverPreview || ''}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <input
              type="file"
              accept="image/*"
              className="block w-full text-sm mb-2"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f) {
                  setCoverKey(null);
                  setCropSrc(URL.createObjectURL(f));
                } else {
                  setCover(null);
                }
              }}
            />
            {portfolioPhotos.length > 0 && (
              <>
                <p className="text-[11px] mb-1.5" style={{ color: 'var(--ink-3)' }}>
                  Or pick from Our work
                </p>
                <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto">
                  {portfolioPhotos.slice(0, 40).map((ph: any) => (
                    <button
                      key={`${ph.workId}-${ph.mediaIndex}`}
                      type="button"
                      className="relative aspect-square rounded-md overflow-hidden border-2"
                      style={{
                        borderColor: coverPreview === ph.url && !cover ? 'var(--ink)' : 'transparent',
                      }}
                      title={ph.workTitle}
                      onClick={() => {
                        setCover(null);
                        if (ph.mediaKey) setCoverKey(ph.mediaKey);
                        setCropSrc(ph.url);
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ph.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>

      <ImageCropModal
        open={!!cropSrc}
        title="Crop package cover"
        src={cropSrc}
        aspect={16 / 10}
        onClose={() => setCropSrc(null)}
        onSave={({ blob }) => {
          if (blob) {
            const file = new File([blob], 'package-cover.jpg', { type: blob.type || 'image/jpeg' });
            setCover(file);
            setCoverPreview(URL.createObjectURL(blob));
            setCoverKey(null);
          }
          setCropSrc(null);
        }}
      />
    </div>
  );
}
