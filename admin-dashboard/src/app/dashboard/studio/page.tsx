'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { portalApi } from '@/lib/api';
import ImageCropModal from '@/components/ImageCropModal';

export default function StudioProfilePage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-profile'],
    queryFn: () => portalApi.getProfile().then((r) => r.data),
  });
  const p = data?.profile;
  const [form, setForm] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<File | null>(null);
  const [paymentQr, setPaymentQr] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!p) return;
    setForm({
      displayName: p.displayName || '',
      upiId: p.upiId || '',
      tagline: p.tagline || '',
      about: p.about || '',
      welcomeMessage: p.welcomeMessage || '',
      termsHtml: p.termsHtml || '',
      phone: p.phone || '',
      whatsapp: p.whatsapp || '',
      email: p.email || '',
      website: p.website || '',
      instagram: p.instagram || '',
      facebook: p.facebook || '',
      youtube: p.youtube || '',
      address: p.address || '',
      mapsUrl: p.mapsUrl || '',
      workingHours: p.workingHours || '',
      themeColor: p.themeColor || '#1A1917',
      secondaryColor: p.secondaryColor || '#9A7B4F',
    });
  }, [p]);

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
      if (logo) fd.append('logo', logo);
      if (cover) fd.append('cover', cover);
      if (paymentQr) fd.append('paymentQr', paymentQr);
      return portalApi.saveProfile(fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-profile'] });
      toast.success('Studio profile saved — live in the customer app');
      setLogo(null);
      setCover(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Save failed'),
  });

  if (isLoading) return <div className="text-sm py-14 text-center" style={{ color: 'var(--ink-3)' }}>Loading…</div>;

  const field = (key: string, label: string, multi = false) => (
    <div>
      <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>{label}</label>
      {multi ? (
        <textarea
          className="input resize-none"
          rows={3}
          value={form[key] || ''}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      ) : (
        <input
          className="input"
          value={form[key] || ''}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      )}
    </div>
  );

  return (
    <div className="animate-fade-up max-w-3xl">
      <p className="kicker mb-2">CMS</p>
      <h1 className="font-display text-[32px] leading-tight mb-2" style={{ color: 'var(--ink)' }}>Studio profile</h1>
      <p className="text-[14px] mb-7" style={{ color: 'var(--ink-2)' }}>
        Controls the home page, contact screen, and branding in the customer app — updates apply immediately.
      </p>

      {(p?.logoUrl || p?.coverUrl) && (
        <div className="card overflow-hidden mb-6">
          <div className="h-36 bg-[var(--surface-sunken)] relative">
            {p.coverUrl && <img src={p.coverUrl} alt="" className="w-full h-full object-cover" />}
            {p.logoUrl && (
              <img src={p.logoUrl} alt="" className="absolute left-5 bottom-0 translate-y-1/2 w-16 h-16 rounded-2xl border-2 object-cover bg-white" style={{ borderColor: 'var(--surface)' }} />
            )}
          </div>
          <div className="pt-10 px-5 pb-4">
            <div className="font-display text-xl">{p.displayName}</div>
            {p.tagline && <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>{p.tagline}</div>}
          </div>
        </div>
      )}

      <div className="card p-6 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          {field('displayName', 'Display name')}
          {field('tagline', 'Tagline')}
        </div>
        {field('welcomeMessage', 'Welcome message', true)}
        {field('about', 'About us', true)}
        <div>
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
            Payment terms &amp; conditions
          </label>
          <p className="text-[12px] mb-2 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            Printed on every invoice PDF for SJ Clicks and Films, Nanded. Leave blank to use the studio default.
          </p>
          <textarea
            className="input resize-y min-h-[160px]"
            rows={8}
            value={form.termsHtml || ''}
            onChange={(e) => setForm((f) => ({ ...f, termsHtml: e.target.value }))}
            placeholder="Studio payment terms shown to clients and on PDFs…"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {field('phone', 'Phone')}
          {field('whatsapp', 'WhatsApp')}
          {field('email', 'Email')}
          {field('website', 'Website')}
          {field('instagram', 'Instagram')}
          {field('facebook', 'Facebook')}
          {field('youtube', 'YouTube')}
          {field('workingHours', 'Working hours')}
        </div>
        {field('address', 'Address', true)}
        {field('mapsUrl', 'Google Maps URL')}
        <div className="grid sm:grid-cols-2 gap-4">
          {field('themeColor', 'Theme color')}
          {field('secondaryColor', 'Accent color')}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>Logo</label>
            <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] || null)} />
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>Cover image</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setCropSrc(URL.createObjectURL(f));
              }}
            />
          </div>
        </div>
        <button type="button" className="btn-primary px-5 py-2.5" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save profile'}
        </button>
      </div>

      <section className="card p-6 my-6 space-y-4">
        <h2 className="font-display text-xl">UPI payments</h2>
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>Upload the studio’s payment QR. Clients can report a payment; you verify receipt in Payments before their balance changes.</p>
        {p?.paymentQrUrl && <img src={p.paymentQrUrl} alt="Studio UPI payment QR" className="w-48 h-48 object-contain bg-white rounded-lg" />}
        {field('upiId', 'UPI ID (optional, for opening a payment app)')}
        <label className="block text-sm">Payment QR image<input className="block mt-2" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setPaymentQr(e.target.files?.[0] || null)} /></label>
        <button type="button" className="btn-primary px-4 py-2" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save payment details'}</button>
      </section>
      <ImageCropModal
        open={!!cropSrc}
        title="Crop studio cover"
        src={cropSrc}
        aspect={16 / 10}
        onClose={() => setCropSrc(null)}
        onSave={({ blob }) => {
          if (blob) setCover(new File([blob], 'studio-cover.jpg', { type: blob.type || 'image/jpeg' }));
          setCropSrc(null);
        }}
      />
    </div>
  );
}
