'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import {
  Plus, Images, ChevronRight, Eye, EyeOff, Download, Trash2, RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import { galleryApi, portalApi } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    PUBLISHED: 'badge-green',
    DRAFT: 'badge-neutral',
    ARCHIVED: 'badge-amber',
    EXPIRED: 'badge-rose',
  };
  return <span className={`badge ${map[status] || 'badge-neutral'}`}>{status.toLowerCase()}</span>;
};

export default function GalleriesPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [showModal, setShowModal] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('new') === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('new') !== '1') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('new');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'active' | 'trash'>(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'trash') {
      return 'trash';
    }
    return 'active';
  });
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<any | null>(null);
  const { register, handleSubmit, reset } = useForm<{
    name: string;
    description: string;
    eventDate: string;
    servicePackageId: string;
  }>();

  const { data: pkgData } = useQuery({
    queryKey: ['portal-packages'],
    queryFn: () => portalApi.packages().then((r) => r.data),
  });
  const packages = (pkgData?.packages || []).filter((p: any) => p.active !== false);

  const { data, isLoading } = useQuery({
    queryKey: ['galleries', filter, view],
    queryFn: () =>
      galleryApi
        .list({
          status: view === 'active' && filter ? filter : undefined,
          trash: view === 'trash' ? '1' : undefined,
          limit: 50,
        })
        .then((r) => r.data),
    staleTime: 15000,
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => galleryApi.create(d),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['galleries'] });
      toast.success('Gallery created');
      setShowModal(false);
      reset();
      const id = res?.data?.id || res?.id;
      if (id) router.push(`/dashboard/galleries/${id}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => galleryApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['galleries'] });
      toast.success('Updated');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => galleryApi.softDelete(id),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['galleries'] });
      const days = res?.data?.retentionDays ?? 30;
      toast.success(`Moved to recycle bin — permanent after ${days} days`);
      setConfirmDelete(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => galleryApi.restore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['galleries'] });
      toast.success('Gallery restored');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Restore failed'),
  });

  const purgeMutation = useMutation({
    mutationFn: (id: string) => galleryApi.purge(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['galleries'] });
      toast.success('Permanently deleted from server storage');
      setConfirmPurge(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Purge failed'),
  });

  const filters = [
    ['', 'All'],
    ['DRAFT', 'Draft'],
    ['PUBLISHED', 'Published'],
    ['ARCHIVED', 'Archived'],
  ];

  const retentionDays = data?.retentionDays ?? 30;

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <p className="kicker mb-2">Galleries</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>
            {view === 'trash' ? 'Recycle bin' : 'Collections'}
          </h1>
          <p className="text-[14px] mt-1.5" style={{ color: 'var(--ink-2)' }}>
            {view === 'trash'
              ? `Deleted galleries stay ${retentionDays} days, then photos are removed from storage.`
              : `${data?.total ?? 0} galleries`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView(view === 'trash' ? 'active' : 'trash')}
            className="btn-ghost flex items-center gap-2 px-3.5 py-2.5 text-[13px]"
          >
            <Trash2 size={15} />
            {view === 'trash' ? 'Back to galleries' : 'Recycle bin'}
          </button>
          {view === 'active' && (
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary flex items-center gap-2 px-4 py-2.5"
            >
              <Plus size={16} /> New gallery
            </button>
          )}
        </div>
      </div>

      {view === 'active' && (
        <div className="flex gap-1.5 mb-5">
          {filters.map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className="px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors"
              style={
                filter === val
                  ? { background: 'var(--ink)', color: '#fff' }
                  : {
                      background: 'var(--surface)',
                      color: 'var(--ink-2)',
                      border: '1px solid var(--line)',
                    }
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {view === 'trash' && (
        <div
          className="mb-5 flex items-start gap-2.5 rounded-[8px] px-3.5 py-3 text-[13px]"
          style={{
            background: 'var(--surface-sunken)',
            border: '1px solid var(--line)',
            color: 'var(--ink-2)',
          }}
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
          <p className="leading-snug">
            Restoring a gallery brings it back immediately. Permanent delete removes all photos and
            videos from S3 and cannot be undone. Auto-purge runs after {retentionDays} days.
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        {isLoading && (
          <div className="card text-center py-14 text-sm" style={{ color: 'var(--ink-3)' }}>
            Loading…
          </div>
        )}
        {data?.galleries?.map((g: any) => (
          <div key={g.id} className="card card-hover flex items-center justify-between px-5 py-4 gap-3">
            <Link
              href={view === 'trash' ? '#' : `/dashboard/galleries/${g.id}`}
              onClick={(e) => {
                if (view === 'trash') e.preventDefault();
              }}
              className="flex items-center gap-3.5 flex-1 min-w-0"
            >
              <div
                className="w-11 h-11 rounded-[11px] flex items-center justify-center shrink-0 overflow-hidden"
                style={{ background: 'var(--surface-sunken)' }}
              >
                {g.coverPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.coverPhotoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Images size={18} style={{ color: 'var(--ink-2)' }} />
                )}
              </div>
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2 truncate" style={{ color: 'var(--ink)' }}>
                  {g.name}
                  {view === 'active' && <StatusBadge status={g.status} />}
                </div>
                <div className="text-[13px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
                  {g._count?.photos ?? 0} media
                  {g.ageLabel ? ` · ${g.ageLabel}` : ''}
                  {g.packageName ? ` · ${g.packageName}` : ''}
                  {view === 'active' && (() => {
                    const clients = (g.assignedClients || []) as { id: string; name: string }[];
                    const count = g.assignedClientCount ?? clients.length;
                    if (!count) {
                      return (
                        <>
                          {' '}
                          · <span style={{ color: 'var(--ink-3)' }}>not assigned</span>
                        </>
                      );
                    }
                    const shown = clients.slice(0, 3);
                    const extra = count - shown.length;
                    return (
                      <>
                        {' '}
                        · assigned to{' '}
                        <span style={{ color: 'var(--ink)' }}>
                          {shown.map((c) => c.name).filter(Boolean).join(', ') || `${count} client${count === 1 ? '' : 's'}`}
                          {extra > 0 ? ` +${extra} more` : ''}
                        </span>
                      </>
                    );
                  })()}
                  {view === 'trash' && g.daysUntilPurge != null && (
                    <>
                      {' '}
                      ·{' '}
                      <span style={{ color: g.daysUntilPurge <= 3 ? 'var(--rose)' : 'var(--ink-3)' }}>
                        {g.daysUntilPurge === 0
                          ? 'Purge imminent'
                          : `${g.daysUntilPurge} day${g.daysUntilPurge === 1 ? '' : 's'} left`}
                      </span>
                    </>
                  )}
                  {view === 'trash' && g.deletedAt && (
                    <span style={{ color: 'var(--ink-3)' }}>
                      {' '}
                      · deleted {new Date(g.deletedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </Link>

            <div className="flex items-center gap-1 shrink-0">
              {view === 'active' ? (
                <>
                  <button
                    onClick={() =>
                      updateMutation.mutate({
                        id: g.id,
                        data: { status: g.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED' },
                      })
                    }
                    className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-sunken)]"
                    title={g.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                    style={{ color: 'var(--ink-2)' }}
                  >
                    {g.status === 'PUBLISHED' ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button
                    onClick={() =>
                      updateMutation.mutate({
                        id: g.id,
                        data: { downloadEnabled: !g.downloadEnabled },
                      })
                    }
                    className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-sunken)]"
                    title={g.downloadEnabled
                      ? 'Downloads on — clients & QR guests can save originals'
                      : 'Downloads off — clients & QR guests cannot save originals'}
                    style={{ color: g.downloadEnabled ? 'var(--gold)' : 'var(--ink-3)' }}
                  >
                    <Download size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(g)}
                    className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-sunken)]"
                    title="Move to recycle bin"
                    style={{ color: 'var(--ink-3)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                  <Link
                    href={`/dashboard/galleries/${g.id}`}
                    className="px-2 py-1.5 text-[11px] font-semibold rounded-lg hover:bg-[var(--surface-sunken)]"
                    style={{ color: 'var(--ink)' }}
                    title="Give RAW Access"
                  >
                    RAW
                  </Link>
                  <Link
                    href={`/dashboard/galleries/${g.id}`}
                    className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-sunken)]"
                    style={{ color: 'var(--ink-3)' }}
                  >
                    <ChevronRight size={16} />
                  </Link>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => restoreMutation.mutate(g.id)}
                    disabled={restoreMutation.isPending}
                    className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-[12px]"
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmPurge(g)}
                    className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-[12px]"
                    style={{ color: 'var(--rose)', borderColor: 'color-mix(in srgb, var(--rose) 35%, var(--line))' }}
                  >
                    <Trash2 size={14} /> Delete forever
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {data?.galleries?.length === 0 && !isLoading && (
          <div className="card text-center py-14 text-sm" style={{ color: 'var(--ink-3)' }}>
            {view === 'trash'
              ? 'Recycle bin is empty.'
              : 'No galleries yet — create your first collection.'}
          </div>
        )}
      </div>

      {/* Create */}
      <Modal
        open={showModal}
        onClose={() => !createMutation.isPending && setShowModal(false)}
        title="New gallery"
        description="Give the collection a name — you can upload photos next."
        preventClose={createMutation.isPending}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="btn-ghost flex-1 py-2.5"
              disabled={createMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-gallery-form"
              disabled={createMutation.isPending}
              className="btn-primary flex-1 py-2.5"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </>
        }
      >
        <form
          id="create-gallery-form"
          onSubmit={handleSubmit((d) => createMutation.mutate(d))}
          className="space-y-3"
        >
          <input
            {...register('name', { required: true })}
            placeholder="Gallery name (e.g. Priya & Arjun · Wedding)"
            className="input"
          />
          <textarea
            {...register('description')}
            placeholder="Description (optional)"
            rows={2}
            className="input resize-none"
          />
          <div>
            <label className="block text-[12px] mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Event date
            </label>
            <input {...register('eventDate')} type="date" className="input" />
          </div>
          <div>
            <label className="block text-[12px] mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Package
            </label>
            <select {...register('servicePackageId')} className="input">
              <option value="">Select package (included photos + extras)</option>
              {packages.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.title || p.name}
                  {p.includedPhotos != null ? ` · ${p.includedPhotos} included` : ''}
                </option>
              ))}
            </select>
          </div>
        </form>
      </Modal>

      {/* Soft delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => !deleteMutation.isPending && setConfirmDelete(null)}
        title="Move to recycle bin?"
        description={
          confirmDelete
            ? `“${confirmDelete.name}” and its ${confirmDelete._count?.photos ?? 0} media will leave client apps now. Permanently removed from S3 after ${retentionDays} days unless restored.`
            : ''
        }
        preventClose={deleteMutation.isPending}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmDelete(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              style={{ background: 'var(--ink)' }}
            >
              {deleteMutation.isPending ? 'Moving…' : 'Move to bin'}
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          You can restore from Recycle bin anytime within {retentionDays} days.
        </p>
      </Modal>

      {/* Hard purge confirm */}
      <Modal
        open={!!confirmPurge}
        onClose={() => !purgeMutation.isPending && setConfirmPurge(null)}
        title="Delete forever?"
        description="This removes every photo and video file from server storage. This cannot be undone."
        preventClose={purgeMutation.isPending}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              disabled={purgeMutation.isPending}
              onClick={() => setConfirmPurge(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={purgeMutation.isPending}
              onClick={() => confirmPurge && purgeMutation.mutate(confirmPurge.id)}
              style={{ background: 'var(--rose)', color: '#fff' }}
            >
              {purgeMutation.isPending ? 'Deleting…' : 'Delete forever'}
            </button>
          </>
        }
      >
        {confirmPurge && (
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            Gallery <strong style={{ color: 'var(--ink)' }}>{confirmPurge.name}</strong> ·{' '}
            {confirmPurge._count?.photos ?? 0} media files will be erased from S3.
          </p>
        )}
      </Modal>
    </div>
  );
}
