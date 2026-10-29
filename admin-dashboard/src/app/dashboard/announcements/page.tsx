'use client';
import ShareLinkButton from '@/components/ShareLinkButton';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, Pencil, Megaphone, Bell, LayoutList, Layers } from 'lucide-react';
import { portalApi } from '@/lib/api';
import Modal from '@/components/Modal';

const STYLES = [
  { id: 'FEED', label: 'Home feed only', hint: 'Carousel card on Home', icon: LayoutList },
  { id: 'BANNER', label: 'Sticky banner', hint: 'Top bar on Home (dismissible)', icon: Megaphone },
  { id: 'POPUP', label: 'Popup on open', hint: 'Modal once until dismissed', icon: Bell },
  { id: 'BOTH', label: 'Banner + popup', hint: 'Maximum visibility', icon: Layers },
] as const;

type AnnForm = {
  title: string;
  description: string;
  priority: string;
  style: string;
  active: boolean;
  expiresAt: string;
  ctaLabel: string;
  ctaUrl: string;
  image: File | null;
};

const emptyForm = (): AnnForm => ({
  title: '',
  description: '',
  priority: '10',
  style: 'BOTH', // banner + popup by default so news is hard to miss
  active: true,
  expiresAt: '',
  ctaLabel: '',
  ctaUrl: '',
  image: null,
});

export default function AnnouncementsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-announcements'],
    queryFn: () => portalApi.announcements().then((r) => r.data),
  });
  const list = data?.announcements || [];

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [form, setForm] = useState<AnnForm>(emptyForm());

  const reset = () => {
    setForm(emptyForm());
    setEditingId(null);
    setExistingImage(null);
    setOpen(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setExistingImage(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (a: any) => {
    setEditingId(a.id);
    setExistingImage(a.imageUrl || null);
    setForm({
      title: a.title || '',
      description: a.description || '',
      priority: String(a.priority ?? 0),
      style: (a.style || 'FEED').toUpperCase(),
      active: a.active !== false,
      expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString().slice(0, 16) : '',
      ctaLabel: a.ctaLabel || '',
      ctaUrl: a.ctaUrl || '',
      image: null,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('title', form.title.trim());
      fd.append('description', form.description.trim());
      fd.append('priority', form.priority || '0');
      fd.append('style', form.style || 'FEED');
      fd.append('active', form.active ? 'true' : 'false');
      if (form.expiresAt) fd.append('expiresAt', new Date(form.expiresAt).toISOString());
      else if (editingId) fd.append('expiresAt', '');
      if (form.ctaLabel.trim()) fd.append('ctaLabel', form.ctaLabel.trim());
      else if (editingId) fd.append('ctaLabel', '');
      if (form.ctaUrl.trim()) fd.append('ctaUrl', form.ctaUrl.trim());
      else if (editingId) fd.append('ctaUrl', '');
      if (form.image) fd.append('image', form.image);

      if (editingId) return portalApi.updateAnnouncement(editingId, fd);
      return portalApi.createAnnouncement(fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-announcements'] });
      toast.success(editingId ? 'Announcement updated' : 'Announcement live');
      reset();
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Failed'),
  });

  const del = useMutation({
    mutationFn: (id: string) => portalApi.deleteAnnouncement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-announcements'] });
      toast.success('Removed');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Delete failed'),
  });

  const styleMeta = (s: string) => STYLES.find((x) => x.id === s) || STYLES[0];

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <p className="kicker mb-2">Studio &amp; marketing</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>
            Announcements
          </h1>
          <p className="text-[14px] mt-1.5 max-w-xl" style={{ color: 'var(--ink-2)' }}>
            Push news to the client app as a home feed card, sticky banner, popup — or both.
          </p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-2 px-4 py-2.5" onClick={openCreate}>
          <Plus size={16} /> New announcement
        </button>
      </div>

      <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
        {isLoading && (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
            Loading…
          </div>
        )}
        {list.map((a: any) => {
          const st = styleMeta((a.style || 'FEED').toUpperCase());
          const Icon = st.icon;
          const expired = a.expiresAt && new Date(a.expiresAt) < new Date();
          return (
            <div key={a.id} className="flex items-center gap-4 px-5 py-4 flex-wrap">
              {a.imageUrl ? (
                <img src={a.imageUrl} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
              ) : (
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--surface-sunken)' }}
                >
                  <Megaphone size={18} style={{ color: 'var(--ink-3)' }} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium flex items-center gap-2 flex-wrap" style={{ color: 'var(--ink)' }}>
                  {a.title}
                  {a.active === false && <span className="badge badge-neutral text-[10px]">inactive</span>}
                  {expired && <span className="badge badge-amber text-[10px]">expired</span>}
                </div>
                <div className="text-[13px] truncate mt-0.5" style={{ color: 'var(--ink-2)' }}>
                  {a.description || 'No description'}
                </div>
                <div className="text-[11px] mt-1.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--ink-3)' }}>
                  <span className="inline-flex items-center gap-1">
                    <Icon size={12} /> {st.label}
                  </span>
                  <span>·</span>
                  <span>priority {a.priority ?? 0}</span>
                  {a.expiresAt && (
                    <>
                      <span>·</span>
                      <span>expires {new Date(a.expiresAt).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <ShareLinkButton path={`/announcements?id=${a.id}`} />
                <button
                  type="button"
                  className="btn-ghost p-2"
                  title="Edit"
                  onClick={() => openEdit(a)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="btn-ghost p-2"
                  title="Delete"
                  style={{ color: 'var(--rose)' }}
                  onClick={() => {
                    if (confirm(`Delete “${a.title}”?`)) del.mutate(a.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          );
        })}
        {!isLoading && list.length === 0 && (
          <div className="py-14 text-center px-4">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>
              No announcements yet
            </p>
            <p className="text-[13px] mb-4" style={{ color: 'var(--ink-3)' }}>
              Create one — clients will see it as a banner, popup, or feed card.
            </p>
            <button type="button" className="btn-primary px-4 py-2.5" onClick={openCreate}>
              First announcement
            </button>
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => !save.isPending && reset()}
        title={editingId ? 'Edit announcement' : 'New announcement'}
        description="Choose how clients see this in the app."
        preventClose={save.isPending}
        size="md"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              onClick={reset}
              disabled={save.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={!form.title.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Publish'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <input
            className="input"
            placeholder="Title *"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <textarea
            className="input resize-none"
            rows={3}
            placeholder="Message / description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />

          <div>
            <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>
              How clients see it
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {STYLES.map((s) => {
                const on = form.style === s.id;
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, style: s.id }))}
                    className="text-left rounded-xl px-3 py-2.5 transition-colors"
                    style={{
                      background: on ? 'var(--nav-active-bg)' : 'var(--surface-sunken)',
                      border: `1px solid ${on ? 'var(--nav-active-ring)' : 'var(--line)'}`,
                      color: 'var(--ink)',
                    }}
                  >
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <Icon size={14} /> {s.label}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-3)' }}>
                      {s.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--ink-3)' }}>
                Priority (higher first)
              </label>
              <input
                className="input"
                type="number"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--ink-3)' }}>
                Expires (optional)
              </label>
              <input
                className="input"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="CTA label (e.g. Book now)"
              value={form.ctaLabel}
              onChange={(e) => setForm((f) => ({ ...f, ctaLabel: e.target.value }))}
            />
            <input
              className="input"
              placeholder="CTA link (https://…)"
              value={form.ctaUrl}
              onChange={(e) => setForm((f) => ({ ...f, ctaUrl: e.target.value }))}
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--ink)' }}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Active (shown in client app)
          </label>

          <div>
            <p className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>
              Image {editingId ? '(optional replace)' : '(optional)'}
            </p>
            {existingImage && !form.image && (
              <img src={existingImage} alt="" className="w-full h-28 object-cover rounded-xl mb-2" />
            )}
            <input
              type="file"
              accept="image/*"
              className="block w-full text-[13px]"
              style={{ color: 'var(--ink-2)' }}
              onChange={(e) => setForm((f) => ({ ...f, image: e.target.files?.[0] || null }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
