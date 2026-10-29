'use client';
import ShareLinkButton from '@/components/ShareLinkButton';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Images, Plus, Trash2, X } from 'lucide-react';
import { portalApi } from '@/lib/api';
import Modal from '@/components/Modal';

type MediaRow = {
  id?: string | null;
  url?: string | null;
  mediaType?: string;
  caption?: string | null;
  sortOrder?: number;
};

type PortfolioItem = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  mediaType?: string;
  isReel?: boolean;
  externalUrl?: string | null;
  coverUrl?: string | null;
  mediaUrl?: string | null;
  media?: MediaRow[];
  mediaCount?: number;
};

function isReelItem(it: PortfolioItem) {
  return it.isReel === true || String(it.mediaType || '').toUpperCase() === 'REEL' || !!it.externalUrl;
}

export default function PortfolioPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-portfolio'],
    queryFn: () => portalApi.portfolio().then((r) => r.data),
  });
  const items: PortfolioItem[] = data?.items || [];

  const [open, setOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'photos' | 'reel'>('photos');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileKey, setFileKey] = useState(0);

  const [manage, setManage] = useState<PortfolioItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editExternalUrl, setEditExternalUrl] = useState('');
  const [moreFiles, setMoreFiles] = useState<File[]>([]);
  const [moreKey, setMoreKey] = useState(0);

  const previews = useMemo(
    () => files.map((f) => ({ file: f, url: URL.createObjectURL(f), isVideo: f.type.startsWith('video/') })),
    [files],
  );

  const morePreviews = useMemo(
    () => moreFiles.map((f) => ({ file: f, url: URL.createObjectURL(f), isVideo: f.type.startsWith('video/') })),
    [moreFiles],
  );

  const resetCreate = () => {
    setCreateKind('photos');
    setTitle('');
    setCategory('');
    setDescription('');
    setExternalUrl('');
    setFiles([]);
    setFileKey((k) => k + 1);
  };

  const create = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('title', title.trim());
      if (category.trim()) fd.append('category', category.trim());
      if (description.trim()) fd.append('description', description.trim());
      if (createKind === 'reel') {
        fd.append('mediaType', 'REEL');
        fd.append('externalUrl', externalUrl.trim());
        // Optional cover thumbnail for the reel card
        files.slice(0, 1).forEach((f) => fd.append('cover', f));
      } else {
        // Multiple optional photos/videos — field name "media" (up to 24)
        files.forEach((f) => fd.append('media', f));
      }
      return portalApi.createPortfolio(fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-portfolio'] });
      toast.success(
        createKind === 'reel'
          ? 'Instagram Reel added to Our Work'
          : files.length > 1
            ? `Work published with ${files.length} photos`
            : 'Added to portfolio',
      );
      setOpen(false);
      resetCreate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed'),
  });

  const del = useMutation({
    mutationFn: (id: string) => portalApi.deletePortfolio(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-portfolio'] });
      toast.success('Removed');
      if (manage) setManage(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed'),
  });

  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!manage) throw new Error('No item');
      const payload: Record<string, unknown> = {
        title: editTitle.trim(),
        category: editCategory.trim() || null,
        description: editDescription.trim() || null,
      };
      if (isReelItem(manage) || editExternalUrl.trim()) {
        payload.externalUrl = editExternalUrl.trim() || null;
        if (editExternalUrl.trim()) payload.mediaType = 'REEL';
      }
      return portalApi.updatePortfolio(manage.id, payload);
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['portal-portfolio'] });
      const item = res?.data?.item || res?.item;
      if (item) {
        setManage(item);
        setEditTitle(item.title || '');
        setEditCategory(item.category || '');
        setEditDescription(item.description || '');
        setEditExternalUrl(item.externalUrl || '');
      }
      toast.success('Work updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed to save'),
  });

  const addMedia = useMutation({
    mutationFn: async () => {
      if (!manage) throw new Error('No item');
      const fd = new FormData();
      moreFiles.forEach((f) => fd.append('media', f));
      return portalApi.addPortfolioMedia(manage.id, fd);
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['portal-portfolio'] });
      const item = res?.data?.item || res?.item;
      if (item) setManage(item);
      setMoreFiles([]);
      setMoreKey((k) => k + 1);
      toast.success(`Added ${moreFiles.length} photo${moreFiles.length === 1 ? '' : 's'}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed to add photos'),
  });

  const removeMedia = useMutation({
    mutationFn: ({ itemId, mediaId }: { itemId: string; mediaId: string }) =>
      portalApi.deletePortfolioMedia(itemId, mediaId),
    onSuccess: async (_res, vars) => {
      await qc.invalidateQueries({ queryKey: ['portal-portfolio'] });
      try {
        const fresh = await portalApi.portfolio().then((r) => r.data);
        const item = (fresh?.items || []).find((x: PortfolioItem) => x.id === vars.itemId);
        if (item) setManage(item);
        else setManage(null);
      } catch {
        setManage((m) =>
          m
            ? {
                ...m,
                media: (m.media || []).filter((x) => x.id !== vars.mediaId),
                mediaCount: Math.max(0, (m.mediaCount || 1) - 1),
              }
            : null,
        );
      }
      toast.success('Photo removed');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed'),
  });

  const onPickFiles = (list: FileList | null, append = false) => {
    if (!list?.length) return;
    const next = Array.from(list).slice(0, 24);
    setFiles((prev) => {
      const merged = append ? [...prev, ...next] : next;
      return merged.slice(0, 24);
    });
  };

  const onPickMore = (list: FileList | null) => {
    if (!list?.length) return;
    setMoreFiles(Array.from(list).slice(0, 24));
  };

  const openManage = (it: PortfolioItem) => {
    setManage(it);
    setEditTitle(it.title || '');
    setEditCategory(it.category || '');
    setEditDescription(it.description || '');
    setEditExternalUrl(it.externalUrl || '');
    setMoreFiles([]);
    setMoreKey((k) => k + 1);
  };

  // After invalidate, keep manage in sync with list
  const manageLive = manage
    ? items.find((i) => i.id === manage.id) || manage
    : null;

  const editDirty = !!manageLive && (
    editTitle.trim() !== (manageLive.title || '') ||
    (editCategory.trim() || '') !== (manageLive.category || '') ||
    (editDescription.trim() || '') !== (manageLive.description || '') ||
    (editExternalUrl.trim() || '') !== (manageLive.externalUrl || '')
  );

  const createReady =
    !!title.trim() &&
    (createKind === 'photos' || !!externalUrl.trim());

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <p className="kicker mb-2">CMS</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>Our work</h1>
          <p className="text-[14px] mt-1.5" style={{ color: 'var(--ink-2)' }}>
            Photo sets and Instagram Reels — shown beautifully in the customer app.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary flex items-center gap-2 px-4 py-2.5"
          onClick={() => {
            resetCreate();
            setOpen(true);
          }}
        >
          <Plus size={16} /> Add work
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {isLoading && (
          <div className="col-span-full text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>
            Loading…
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <div className="col-span-full card p-10 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
            No portfolio works yet. Add a titled work — photos are optional and you can attach several.
          </div>
        )}
        {items.map((it) => {
          const count = it.mediaCount ?? it.media?.length ?? (it.coverUrl ? 1 : 0);
          const reel = isReelItem(it);
          return (
            <button
              key={it.id}
              type="button"
              className="card overflow-hidden group relative text-left"
              onClick={() => openManage(it)}
            >
              <div className="aspect-[4/5] bg-[var(--surface-sunken)] relative">
                {it.coverUrl ? (
                  <img src={it.coverUrl} alt="" className="w-full h-full object-cover" />
                ) : reel ? (
                  <div
                    className="w-full h-full flex flex-col items-center justify-center gap-2"
                    style={{
                      background: 'linear-gradient(145deg, #833AB4 0%, #FD1D1D 50%, #F77737 100%)',
                    }}
                  >
                    <span className="text-white/95 text-2xl font-semibold tracking-tight">Reels</span>
                    <span className="text-white/80 text-[11px] font-medium">Instagram</span>
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--ink-3)' }}>
                    <Images size={28} />
                  </div>
                )}
                {reel && (
                  <span className="absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/55 text-white tracking-wide">
                    REEL
                  </span>
                )}
                {!reel && count > 1 && (
                  <span className="absolute bottom-2 left-2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-black/60 text-white">
                    {count} photos
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
                  {it.title}
                </div>
                <div className="text-[11px] truncate" style={{ color: 'var(--ink-3)' }}>
                  {reel
                    ? (it.category ? `${it.category} · Reel` : 'Instagram Reel')
                    : it.category || (count ? `${count} media` : 'No photos yet')}
                </div>
              </div>
              <span
                role="button"
                tabIndex={0}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete “${it.title}”?`)) del.mutate(it.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    if (confirm(`Delete “${it.title}”?`)) del.mutate(it.id);
                  }
                }}
              >
                <Trash2 size={14} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Create work */}
      <Modal
        open={open}
        onClose={() => !create.isPending && setOpen(false)}
        title="Add work"
        preventClose={create.isPending}
        size="md"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              onClick={() => setOpen(false)}
              disabled={create.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={!createReady || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Publishing…' : 'Publish'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex gap-2 p-1 rounded-xl" style={{ background: 'var(--surface-sunken)' }}>
            {(
              [
                { id: 'photos' as const, label: 'Photos / video' },
                { id: 'reel' as const, label: 'Instagram Reel' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="flex-1 py-2 rounded-lg text-[13px] font-medium transition-colors"
                style={{
                  background: createKind === opt.id ? 'var(--surface)' : 'transparent',
                  color: createKind === opt.id ? 'var(--ink)' : 'var(--ink-3)',
                  boxShadow: createKind === opt.id ? '0 1px 2px rgba(0,0,0,0.06)' : undefined,
                }}
                onClick={() => {
                  setCreateKind(opt.id);
                  if (opt.id === 'photos') setExternalUrl('');
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div>
            <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
              Name / title *
            </label>
            <input
              className="input"
              placeholder={createKind === 'reel' ? 'e.g. Behind the scenes reel' : 'e.g. Riya & Arjun — Wedding'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
              Category <span style={{ color: 'var(--ink-3)' }}>(optional)</span>
            </label>
            <input
              className="input"
              placeholder="Wedding, Portrait, Pre-wedding…"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
              Description <span style={{ color: 'var(--ink-3)' }}>(optional)</span>
            </label>
            <textarea
              className="input resize-none"
              rows={2}
              placeholder="Short story or notes for this work"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {createKind === 'reel' ? (
            <>
              <div>
                <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
                  Instagram Reel link *
                </label>
                <input
                  className="input"
                  placeholder="https://www.instagram.com/reel/…"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                />
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
                  Paste a public reel, post, or TV link. Clients open it in Instagram from the app.
                </p>
              </div>
              <div>
                <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
                  Cover thumbnail <span style={{ color: 'var(--ink-3)' }}>(optional)</span>
                </label>
                <input
                  key={fileKey}
                  type="file"
                  accept="image/*"
                  className="block w-full text-sm"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setFiles(f ? [f] : []);
                  }}
                />
                {previews[0] && (
                  <div className="mt-2 w-24 aspect-[4/5] rounded-lg overflow-hidden bg-[var(--surface-sunken)] relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previews[0].url} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      className="absolute top-1 right-1 p-0.5 rounded bg-black/60 text-white"
                      onClick={() => setFiles([])}
                      aria-label="Remove"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
                  Optional still image for the in-app card. Without it, a branded Reel tile is shown.
                </p>
              </div>
            </>
          ) : (
            <div>
              <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
                Photos / videos <span style={{ color: 'var(--ink-3)' }}>(optional, up to 24)</span>
              </label>
              <input
                key={fileKey}
                type="file"
                accept="image/*,video/*"
                multiple
                className="block w-full text-sm"
                onChange={(e) => onPickFiles(e.target.files)}
              />
              {previews.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {previews.map((p, i) => (
                    <div key={p.url} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--surface-sunken)]">
                      {p.isVideo ? (
                        <video src={p.url} className="w-full h-full object-cover" muted />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.url} alt="" className="w-full h-full object-cover" />
                      )}
                      <button
                        type="button"
                        className="absolute top-1 right-1 p-0.5 rounded bg-black/60 text-white"
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        aria-label="Remove"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
                First file becomes the cover. You can add more photos later.
              </p>
            </div>
          )}
        </div>
      </Modal>

      {/* Manage / edit work + multi photos */}
      <Modal
        open={!!manageLive}
        onClose={() => !addMedia.isPending && !removeMedia.isPending && !saveEdit.isPending && setManage(null)}
        title={<span className="flex items-center gap-3">Edit work {manage && <ShareLinkButton path={`/portfolio?id=${manage.id}`} />}</span>}
        preventClose={addMedia.isPending || removeMedia.isPending || saveEdit.isPending}
        size="md"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              onClick={() => setManage(null)}
              disabled={addMedia.isPending || saveEdit.isPending}
            >
              Close
            </button>
            {editDirty ? (
              <button
                type="button"
                className="btn-primary flex-1 py-2.5"
                disabled={!editTitle.trim() || saveEdit.isPending}
                onClick={() => saveEdit.mutate()}
              >
                {saveEdit.isPending ? 'Saving…' : 'Save changes'}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary flex-1 py-2.5"
                disabled={!moreFiles.length || addMedia.isPending}
                onClick={() => addMedia.mutate()}
              >
                {addMedia.isPending ? 'Uploading…' : moreFiles.length ? `Add ${moreFiles.length} photo${moreFiles.length === 1 ? '' : 's'}` : 'Add photos'}
              </button>
            )}
          </>
        }
      >
        {manageLive && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
                  Name / title *
                </label>
                <input
                  className="input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Work name"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
                  Category <span style={{ color: 'var(--ink-3)' }}>(optional)</span>
                </label>
                <input
                  className="input"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  placeholder="Wedding, Portrait…"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
                  Description <span style={{ color: 'var(--ink-3)' }}>(optional)</span>
                </label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Short story or notes"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
                  Instagram Reel link{' '}
                  <span style={{ color: 'var(--ink-3)' }}>
                    {isReelItem(manageLive) ? '' : '(optional — paste to convert to Reel)'}
                  </span>
                </label>
                <input
                  className="input"
                  placeholder="https://www.instagram.com/reel/…"
                  value={editExternalUrl}
                  onChange={(e) => setEditExternalUrl(e.target.value)}
                />
                {isReelItem(manageLive) && manageLive.externalUrl && (
                  <a
                    href={manageLive.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] mt-1.5 inline-block underline"
                    style={{ color: 'var(--ink-2)' }}
                  >
                    Open current link
                  </a>
                )}
              </div>
              {editDirty && (
                <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                  Unsaved text changes — tap Save changes.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-medium" style={{ color: 'var(--ink-2)' }}>
                  {isReelItem(manageLive)
                    ? `Cover / extras (${manageLive.media?.length ?? manageLive.mediaCount ?? 0})`
                    : `Photos (${manageLive.media?.length ?? manageLive.mediaCount ?? 0})`}
                </p>
                <button
                  type="button"
                  className="text-[12px] text-red-600 hover:underline"
                  onClick={() => {
                    if (confirm(`Delete entire work “${manageLive.title}”?`)) del.mutate(manageLive.id);
                  }}
                >
                  Delete work
                </button>
              </div>
              {(manageLive.media?.length || 0) === 0 && !manageLive.coverUrl ? (
                <div className="text-sm py-6 text-center rounded-lg" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-3)' }}>
                  No photos yet — add some below.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {(manageLive.media?.length
                    ? manageLive.media
                    : manageLive.coverUrl
                      ? [{ id: null, url: manageLive.coverUrl, mediaType: manageLive.mediaType }]
                      : []
                  ).map((m, idx) => (
                    <div key={m.id || `c-${idx}`} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--surface-sunken)]">
                      {m.mediaType === 'VIDEO' && m.url ? (
                        <video src={m.url} className="w-full h-full object-cover" muted />
                      ) : m.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.url} alt="" className="w-full h-full object-cover" />
                      ) : null}
                      {idx === 0 && (
                        <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white">
                          Cover
                        </span>
                      )}
                      {m.id && (
                        <button
                          type="button"
                          className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white"
                          disabled={removeMedia.isPending}
                          onClick={() => {
                            if (confirm('Remove this photo?')) {
                              removeMedia.mutate({ itemId: manageLive.id, mediaId: m.id! });
                            }
                          }}
                          aria-label="Remove photo"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
                Add more photos <span style={{ color: 'var(--ink-3)' }}>(optional)</span>
              </label>
              <input
                key={moreKey}
                type="file"
                accept="image/*,video/*"
                multiple
                className="block w-full text-sm"
                onChange={(e) => onPickMore(e.target.files)}
              />
              {morePreviews.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {morePreviews.map((p, i) => (
                    <div key={p.url} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--surface-sunken)]">
                      {p.isVideo ? (
                        <video src={p.url} className="w-full h-full object-cover" muted />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.url} alt="" className="w-full h-full object-cover" />
                      )}
                      <button
                        type="button"
                        className="absolute top-1 right-1 p-0.5 rounded bg-black/60 text-white"
                        onClick={() => setMoreFiles((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
