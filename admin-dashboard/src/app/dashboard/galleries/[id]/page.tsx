'use client';
import ShareLinkButton from '@/components/ShareLinkButton';
import { use, useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Eye, EyeOff, Download, Trash2, CheckCircle2, Clock, AlertCircle,
  UploadCloud, Check, ScanFace, RefreshCw, Activity, X, ChevronLeft, ChevronRight,
  QrCode, Copy, Link2, Users, Film, Image as ImageIcon, Play, Plus,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { galleryApi, uploadApi, photoApi, adminApi, portalApi } from '@/lib/api';
import ImageCropModal from '@/components/ImageCropModal';
import { useUploadQueue } from '@/lib/upload-queue';
import Modal from '@/components/Modal';

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), {
  ssr: false,
  loading: () => (
    <div className="text-white/60 text-sm py-16 text-center">Loading player…</div>
  ),
});

export default function GalleryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { enqueue, checkDuplicates } = useUploadQueue();
  const [processingStatus, setProcessingStatus] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmSoftDelete, setConfirmSoftDelete] = useState(false);
  // Lightbox: index into ready photos (those with a viewable URL)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Admin face search
  const [faceSearching, setFaceSearching] = useState(false);
  const [faceResults, setFaceResults] = useState<any[] | null>(null);
  const [faceSearchMessage, setFaceSearchMessage] = useState<string | null>(null);
  const [shareLabel, setShareLabel] = useState('Family & friends');
  const [fullAccessCode, setFullAccessCode] = useState('');
  const [faceCostOpen, setFaceCostOpen] = useState(false);
  const [mediaTab, setMediaTab] = useState<'PHOTO' | 'VIDEO'>('PHOTO');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [pickedClientIds, setPickedClientIds] = useState<string[]>([]);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawSearch, setRawSearch] = useState('');
  const [rawPickId, setRawPickId] = useState('');
  const [rawFaceEnabled, setRawFaceEnabled] = useState(false);
  const [accessEdit, setAccessEdit] = useState<any | null>(null);
  const [accessMode, setAccessMode] = useState<'SELECTION' | 'RAW' | 'VIEW'>('SELECTION');
  const [accessLimit, setAccessLimit] = useState('');
  const [accessExtra, setAccessExtra] = useState('');
  const [accessFaceEnabled, setAccessFaceEnabled] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropPhotoId, setCropPhotoId] = useState<string | null>(null);
  const [cropSaving, setCropSaving] = useState(false);
  const [pkgId, setPkgId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [bulkOn, setBulkOn] = useState(false);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkDays, setBulkDays] = useState('14');
  const [dupModal, setDupModal] = useState<{
    files: File[];
    conflicts: { name: string; existing: { id: string; filename: string } | null }[];
    decisions: Record<string, { action: 'replace' | 'keep_both' | 'skip'; replacePhotoId?: string }>;
  } | null>(null);

  const { data: gallery, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['gallery', id],
    queryFn: () => galleryApi.get(id).then((r) => r.data),
    retry: 2,
    // Only poll while photos are still processing (not forever).
    refetchInterval: (q) => {
      const photos = (q.state.data as any)?.photos || [];
      if (!photos.length) return false;
      const pending = photos.some((p: any) => {
        const st = p.ingestionStatus || p.processingStatus || '';
        if (['FAILED', 'REJECTED', 'DELETED', 'COMPLETE', 'INDEXED'].includes(st)) return false;
        return !p.thumbnailUrl;
      });
      return pending ? 5000 : false;
    },
  });

  // Must be computed before any early return so hooks below stay stable across renders.
  const viewable = useMemo(
    () =>
      (gallery?.photos || []).filter(
        (p: any) => p.previewUrl || p.downloadUrl || p.thumbnailUrl || p.streamUrl,
      ),
    [gallery?.photos],
  );
  const activePhoto = viewerIndex != null ? viewable[viewerIndex] : null;

  const openViewer = useCallback(
    (photoId: string) => {
      const idx = viewable.findIndex((p: any) => p.id === photoId);
      if (idx >= 0) setViewerIndex(idx);
    },
    [viewable],
  );
  const closeViewer = useCallback(() => setViewerIndex(null), []);
  const prevPhoto = useCallback(() => {
    setViewerIndex((i) =>
      i == null || viewable.length === 0 ? i : (i - 1 + viewable.length) % viewable.length,
    );
  }, [viewable.length]);
  const nextPhoto = useCallback(() => {
    setViewerIndex((i) =>
      i == null || viewable.length === 0 ? i : (i + 1) % viewable.length,
    );
  }, [viewable.length]);

  // Keyboard nav for lightbox — ALWAYS registered (never after early returns).
  useEffect(() => {
    if (viewerIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeViewer();
      if (e.key === 'ArrowLeft') prevPhoto();
      if (e.key === 'ArrowRight') nextPhoto();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerIndex, closeViewer, prevPhoto, nextPhoto]);

  const { data: faceAnalytics } = useQuery({
    queryKey: ['face-analytics', id],
    queryFn: () => adminApi.faceAnalytics(id).then((r) => r.data),
    enabled: !!id,
    refetchInterval: 30000,
    retry: 1,
  });

  const { data: shareData, refetch: refetchShares } = useQuery({
    queryKey: ['share-links', id],
    queryFn: () => adminApi.listShareLinks(id).then((r) => r.data),
    enabled: !!id,
  });
  const { data: guestsData, refetch: refetchGuests } = useQuery({
    queryKey: ['share-guests', id],
    queryFn: () => adminApi.listShareGuests(id).then((r) => r.data),
    enabled: !!id,
  });
  const shareLinks = shareData?.links || [];
  const shareGuests = guestsData?.guests || [];
  const activeShare = shareLinks.find((l: any) => l.active !== false) || shareLinks[0];

  const createShareMutation = useMutation({
    mutationFn: () =>
      adminApi.createShareLink(id, {
        label: shareLabel.trim() || undefined,
        fullAccessCode: fullAccessCode.trim() || undefined,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['share-links', id] });
      toast.success('Share link + QR created');
      setFullAccessCode('');
      const url = r.data?.link?.url;
      if (url && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed to create share link'),
  });

  const setFullAccessMutation = useMutation({
    mutationFn: (payload: { fullAccessCode?: string; clear?: boolean }) =>
      adminApi.setShareFullAccessCode(activeShare?.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['share-links', id] });
      toast.success('Full access code updated');
      setFullAccessCode('');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed to update code'),
  });

  const revokeShareMutation = useMutation({
    mutationFn: (linkId: string) => adminApi.revokeShareLink(linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['share-links', id] });
      toast.success('Link revoked');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Failed to revoke'),
  });

  const copyText = async (text: string, label = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error('Could not copy — select the link manually');
    }
  };

  const updateMutation = useMutation({
    mutationFn: (data: any) => galleryApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gallery', id] }); toast.success('Updated'); },
  });

  const { data: pkgData } = useQuery({
    queryKey: ['portal-packages'],
    queryFn: () => portalApi.packages().then((r) => r.data),
  });
  const packages = pkgData?.packages || [];

  useEffect(() => {
    if (!gallery) return;
    setPkgId(gallery.servicePackageId || '');
    setExpiresAt(gallery.expiresAt ? new Date(gallery.expiresAt).toISOString().slice(0, 10) : '');
    setBulkOn(!!gallery.bulkRawEnabled);
    setBulkPrice(gallery.bulkRawPrice != null ? String(gallery.bulkRawPrice) : '');
    setBulkDays(String(gallery.bulkRawWindowDays ?? 14));
  }, [gallery?.id, gallery?.servicePackageId, gallery?.expiresAt, gallery?.bulkRawEnabled, gallery?.bulkRawPrice, gallery?.bulkRawWindowDays]);

  const faceMutation = useMutation({
    mutationFn: (data: any) => adminApi.setFaceSearch(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gallery', id] });
      qc.invalidateQueries({ queryKey: ['face-analytics', id] });
      toast.success('Face search settings saved');
    },
    onError: (err: any) => toast.error(err.response?.data?.error?.message || 'Failed'),
  });

  const reindexMutation = useMutation({
    mutationFn: () => adminApi.reindex(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['face-analytics', id] });
      toast.success(`Reindex queued for ${r.data?.enqueued ?? 0} photos`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error?.message || 'Reindex failed'),
  });

  const { data: clientsPicker } = useQuery({
    queryKey: ['clients-for-gallery', assignSearch],
    queryFn: () =>
      adminApi.customers({ kind: 'clients', search: assignSearch || undefined, limit: 50 }).then((r) => r.data),
    enabled: assignOpen,
    staleTime: 15000,
  });

  const { data: rawClientsPicker } = useQuery({
    queryKey: ['clients-for-raw', rawSearch],
    queryFn: () =>
      adminApi.customers({ kind: 'clients', search: rawSearch || undefined, limit: 50 }).then((r) => r.data),
    enabled: rawOpen,
    staleTime: 15000,
  });

  const grantClientsMutation = useMutation({
    mutationFn: (customerIds: string[]) => galleryApi.grantClients(id, customerIds),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['gallery', id] });
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      const n = r?.data?.granted ?? pickedClientIds.length;
      toast.success(n === 1 ? 'Assigned to 1 client' : `Assigned to ${n} clients`);
      setAssignOpen(false);
      setPickedClientIds([]);
      setAssignSearch('');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not assign'),
  });

  const accessMutation = useMutation({
    mutationFn: () => galleryApi.updateClientAccess(id, accessEdit.id, {
      accessMode,
      ...(accessMode === 'RAW' && { faceSearchEnabled: accessFaceEnabled }),
      selectionLimit: accessLimit === '' ? null : Number(accessLimit),
      extraPhotoPrice: accessExtra === '' ? null : Number(accessExtra),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gallery', id] });
      toast.success('Client access saved');
      setAccessEdit(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save access'),
  });

  const grantRawMutation = useMutation({
    mutationFn: (customerId: string) => galleryApi.grantRawAccess(id, customerId, rawFaceEnabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gallery', id] });
      qc.invalidateQueries({ queryKey: ['galleries'] });
      toast.success('Full access granted — client can download every original in this gallery');
      setRawOpen(false);
      setRawPickId('');
      setRawSearch('');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not grant RAW access'),
  });

  const revokeRawMutation = useMutation({
    mutationFn: (customerId: string) => galleryApi.revokeRawAccess(id, customerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gallery', id] });
      qc.invalidateQueries({ queryKey: ['galleries'] });
      toast.success('RAW access removed');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not revoke RAW'),
  });

  const revokeClientMutation = useMutation({
    mutationFn: (customerId: string) => galleryApi.revokeClient(id, customerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gallery', id] });
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      toast.success('Client unassigned');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not unassign'),
  });

  const runFaceSearch = async (file: File | null) => {
    if (!file) return;
    setFaceSearching(true);
    setFaceResults(null);
    setFaceSearchMessage(null);
    try {
      // Lower default threshold for admin discovery (customers use stricter default).
      const res = await adminApi.faceSearch(id, file, 80);
      const data = res.data || res;
      setFaceResults(data.results || []);
      setFaceSearchMessage(data.message || null);
      if (data.unindexedPhotos > 0) {
        toast(`Indexing still running for ${data.unindexedPhotos} photo(s) — re-run search shortly`);
      }
      if ((data.results || []).length) {
        toast.success(`Found ${data.results.length} match${data.results.length === 1 ? '' : 'es'}`);
      } else {
        toast.error(data.message || 'No matches');
      }
      qc.invalidateQueries({ queryKey: ['face-analytics', id] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || err.message || 'Face search failed');
    } finally {
      setFaceSearching(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (photoId: string) => photoApi.delete(photoId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['gallery', id] }); toast.success('Photo deleted'); },
  });

  const softDeleteGallery = useMutation({
    mutationFn: () => galleryApi.softDelete(id),
    onSuccess: (res: any) => {
      const days = res?.data?.retentionDays ?? 30;
      toast.success(`Moved to recycle bin — storage purge after ${days} days`);
      qc.invalidateQueries({ queryKey: ['galleries'] });
      router.push('/dashboard/galleries?view=trash');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const retryMutation = useMutation({
    mutationFn: () => uploadApi.retryFailed(id),
    onSuccess: (r) => {
      toast.success(`Requeued ${r.data?.requeued ?? 0} failed photos`);
      pollStatus();
    },
  });

  const pollStatus = async () => {
    try {
      const res = await uploadApi.status(id);
      const d = res.data || {};
      setProcessingStatus(d);
      // Only refresh the photo grid while work is in flight (avoid endless reloads).
      const stillWorking = (d.registered || 0) + (d.uploaded || 0) + (d.processing || 0) > 0;
      if (stillWorking) {
        qc.invalidateQueries({ queryKey: ['gallery', id] });
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!id) return;
    pollStatus();
    const interval = setInterval(pollStatus, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const startUpload = async (
    files: File[],
    decisions?: Record<string, { action: 'replace' | 'keep_both' | 'skip'; replacePhotoId?: string }>,
  ) => {
    const skipN = files.filter((f) => decisions?.[f.name]?.action === 'skip').length;
    const uploadN = files.length - skipN;
    await enqueue({
      galleryId: id,
      galleryName: gallery?.name || 'Gallery',
      files,
      decisions,
    });
    if (uploadN === 0) {
      toast.success(skipN ? `Skipped ${skipN} duplicate${skipN === 1 ? '' : 's'}` : 'Nothing to upload');
    } else {
      toast.success(
        `${uploadN} file${uploadN === 1 ? '' : 's'} queued${skipN ? ` · ${skipN} skipped` : ''} — keep using the dashboard`,
      );
    }
    pollStatus();
    // Refresh grid while background job runs
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['gallery', id] });
      pollStatus();
    }, 4000);
    setTimeout(() => clearInterval(t), 180000);
  };

  const doUpload = async (files: File[]) => {
    if (!files.length) return;
    const media = files.filter(
      (f) =>
        f.type.startsWith('image/') ||
        f.type.startsWith('video/') ||
        /\.(jpe?g|png|webp|heic|heif|tiff?|mp4|mov|webm)$/i.test(f.name),
    );
    if (!media.length) {
      toast.error('No photo or video files selected');
      return;
    }
    try {
      toast.loading(`Checking ${media.length} files…`, { id: 'dup-check' });
      const conflicts = await checkDuplicates(id, media);
      toast.dismiss('dup-check');
      const hits = conflicts.filter((c) => c.existing);
      if (hits.length) {
        // Default: skip duplicates (safest for bulk re-uploads)
        const decisions: Record<string, { action: 'replace' | 'keep_both' | 'skip'; replacePhotoId?: string }> = {};
        for (const h of hits) {
          decisions[h.name] = {
            action: 'skip',
            replacePhotoId: h.existing?.id,
          };
        }
        setDupModal({ files: media, conflicts: hits, decisions });
        return;
      }
      await startUpload(media);
    } catch (err: any) {
      toast.dismiss('dup-check');
      toast.error(err.response?.data?.error?.message || err.message || 'Could not start upload');
    }
  };

  const setAllDupDecisions = (action: 'replace' | 'keep_both' | 'skip') => {
    if (!dupModal) return;
    const decisions: typeof dupModal.decisions = { ...dupModal.decisions };
    for (const c of dupModal.conflicts) {
      decisions[c.name] = { action, replacePhotoId: c.existing?.id };
    }
    setDupModal({ ...dupModal, decisions });
  };

  if (isLoading) {
    return <div className="text-center py-14 text-sm" style={{ color: 'var(--ink-3)' }}>Loading gallery…</div>;
  }
  if (isError) {
    return (
      <div className="text-center py-14 space-y-3">
        <p className="text-sm" style={{ color: 'var(--rose)' }}>
          Could not load this gallery{(error as any)?.message ? `: ${(error as any).message}` : '.'}
        </p>
        <button type="button" className="btn-primary px-4 py-2" onClick={() => refetch()}>
          Retry
        </button>
        <div>
          <Link href="/dashboard/galleries" className="text-sm" style={{ color: 'var(--ink-2)' }}>
            ← Back to galleries
          </Link>
        </div>
      </div>
    );
  }
  if (!gallery) {
    return <div className="text-center py-14 text-sm" style={{ color: 'var(--ink-3)' }}>Gallery not found</div>;
  }

  const statusIcon = (s: string) =>
    s === 'COMPLETE' || s === 'INDEXED' ? <CheckCircle2 size={13} style={{ color: 'var(--green)' }} /> :
    s === 'FAILED' || s === 'REJECTED' ? <AlertCircle size={13} style={{ color: 'var(--rose)' }} /> :
    <Clock size={13} style={{ color: 'var(--amber)' }} />;

  const faceOn = !!gallery.faceSearchEnabled;

  const downloadPhoto = async (photo: any) => {
    const url = photo.downloadUrl || photo.previewUrl || photo.thumbnailUrl;
    if (!url) {
      toast.error('Download not available yet');
      return;
    }
    try {
      // Fetch as blob so we can force a filename download (cross-origin S3 signed URL).
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = photo.filename || `photo-${photo.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success('Download started');
    } catch {
      // Fallback: open in new tab if blob fetch blocked
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="animate-fade-up">
      <Link href="/dashboard/galleries" className="inline-flex items-center gap-2 text-sm mb-6" style={{ color: 'var(--ink-2)' }}>
        <ArrowLeft size={16} /> Back to galleries
      </Link>

      {/* Header card */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex gap-4 min-w-0 flex-1">
            <div
              className="w-24 h-24 rounded-xl overflow-hidden shrink-0 border"
              style={{ background: 'var(--surface-sunken)', borderColor: 'var(--line)' }}
            >
              {gallery.coverPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={gallery.coverPhotoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] px-2 text-center" style={{ color: 'var(--ink-3)' }}>
                  Hover a photo → Cover
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-[28px] leading-tight" style={{ color: 'var(--ink)' }}>{gallery.name}</h1>
          <ShareLinkButton path={`/gallery/${id}`} title="Client-only link" />
              {gallery.description && <p className="text-[14px] mt-1.5" style={{ color: 'var(--ink-2)' }}>{gallery.description}</p>}
              {gallery.eventDate && <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>{new Date(gallery.eventDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
              <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
                {gallery.ageLabel ? `Created ${gallery.ageLabel}` : null}
                {gallery.servicePackage?.title ? ` · ${gallery.servicePackage.title}` : gallery.clientType?.name ? ` · ${gallery.clientType.name}` : ''}
              </p>
              <p className="text-[12px] mt-2" style={{ color: 'var(--ink-3)' }}>
                Cover shows on the customer app and the QR guest link. Hover any photo → <strong>Cover</strong>, then crop &amp; save.
              </p>
            </div>
          </div>
          <span className={`badge ${gallery.status === 'PUBLISHED' ? 'badge-green' : 'badge-neutral'}`}>{gallery.status.toLowerCase()}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => updateMutation.mutate({ status: gallery.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED' })}
            className={gallery.status === 'PUBLISHED' ? 'btn-ghost flex items-center gap-2 px-3.5 py-2' : 'btn-primary flex items-center gap-2 px-3.5 py-2'}>
            {gallery.status === 'PUBLISHED' ? <><EyeOff size={15} /> Unpublish</> : <><Eye size={15} /> Publish</>}
          </button>
          <button
            type="button"
            onClick={() => setConfirmSoftDelete(true)}
            className="btn-ghost flex items-center gap-2 px-3.5 py-2"
            style={{ color: 'var(--ink-3)' }}
            title="Move to recycle bin"
          >
            <Trash2 size={15} /> Delete
          </button>
          <button
            onClick={() => updateMutation.mutate({ downloadEnabled: !gallery.downloadEnabled })}
            className="btn-ghost flex items-center gap-2 px-3.5 py-2"
            title="When off, clients and QR guests cannot download originals — view only"
            style={gallery.downloadEnabled ? { color: 'var(--gold)', borderColor: 'var(--gold)' } : {}}>
            <Download size={15} /> {gallery.downloadEnabled ? 'Downloads on' : 'Downloads off'}
          </button>
          <button
            onClick={() => updateMutation.mutate({ selectionEnabled: gallery.selectionEnabled === false })}
            className="btn-ghost flex items-center gap-2 px-3.5 py-2"
            title="When off, clients can view (and download if allowed) but cannot heart or submit a selection"
            style={gallery.selectionEnabled !== false ? { color: 'var(--gold)', borderColor: 'var(--gold)' } : {}}>
            <Check size={15} /> {gallery.selectionEnabled === false ? 'Selection off' : 'Selection on'}
          </button>
          <button
            onClick={() => updateMutation.mutate({ paymentComplete: !gallery.paymentComplete })}
            className="btn-ghost flex items-center gap-2 px-3.5 py-2"
            title="Payment tracking flag (does not control downloads)"
            style={gallery.paymentComplete ? { color: 'var(--green)', borderColor: 'var(--green)' } : {}}>
            {gallery.paymentComplete ? <><Check size={15} /> Paid</> : 'Mark as paid'}
          </button>
          <button
            onClick={() => {
              if (faceOn) {
                faceMutation.mutate({ faceSearchEnabled: false });
              } else {
                setFaceCostOpen(true);
              }
            }}
            className="btn-ghost flex items-center gap-2 px-3.5 py-2"
            style={faceOn ? { color: 'var(--gold)', borderColor: 'var(--gold)' } : {}}>
            <ScanFace size={15} /> {faceOn ? 'Face search on' : 'Face search off'}
          </button>
          {faceOn && (
            <button
              onClick={() => reindexMutation.mutate()}
              disabled={reindexMutation.isPending}
              className="btn-ghost flex items-center gap-2 px-3.5 py-2">
              <RefreshCw size={15} className={reindexMutation.isPending ? 'animate-spin' : ''} /> Reindex faces
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setRawPickId('');
              setRawSearch('');
              setRawFaceEnabled(!!gallery.faceSearchEnabled);
              setRawOpen(true);
            }}
            className="btn-primary flex items-center gap-2 px-3.5 py-2"
          >
            Give full access
          </button>
          <button
            type="button"
            onClick={() => document.getElementById('share-qr-section')?.scrollIntoView({ behavior: 'smooth' })}
            className="btn-ghost flex items-center gap-2 px-3.5 py-2"
          >
            <QrCode size={15} /> Share QR
          </button>
        </div>
      </div>

      {/* Assigned clients */}
      {(() => {
        const assigned = (gallery.assignedClients || []).filter((c: any) => c?.id);
        return (
          <div className="card p-6 mb-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Users size={16} style={{ color: 'var(--ink-2)' }} />
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                    Assigned clients · {assigned.length}
                  </h2>
                </div>
                <p className="text-[13px] mt-1" style={{ color: 'var(--ink-2)' }}>
                  These clients see this gallery in their app. QR guests are separate.
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost flex items-center gap-2 px-3 py-2 shrink-0"
                onClick={() => {
                  setPickedClientIds([]);
                  setAssignSearch('');
                  setAssignOpen(true);
                }}
              >
                <Plus size={15} /> Assign client
              </button>
            </div>
            {assigned.length === 0 ? (
              <div
                className="rounded-xl px-4 py-8 text-center text-sm"
                style={{ background: 'var(--surface-sunken)', color: 'var(--ink-3)' }}
              >
                Not assigned to any client yet.
              </div>
            ) : (
              <div className="space-y-2">
                {assigned.map((c: any) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl"
                    style={{ background: 'var(--surface-sunken)' }}
                  >
                    <Link href={`/dashboard/clients/${c.id}`} className="min-w-0 flex-1">
                      <div className="font-medium truncate flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                        {c.name}
                        {c.accessMode === 'RAW' || c.rawAccess ? (
                          <span className="badge badge-amber text-[10px]">Full access</span>
                        ) : c.accessMode === 'VIEW' ? (
                          <span className="badge badge-neutral text-[10px]">View only</span>
                        ) : (
                          <span className="badge badge-green text-[10px]">Selection</span>
                        )}
                      </div>
                      {c.availability?.accessible === false && <div className="text-xs text-amber-700 mt-1">{c.availability.message}</div>}
                      <div className="text-[12px] truncate" style={{ color: 'var(--ink-3)' }}>
                        {[c.phone, c.loginId].filter(Boolean).join(' · ') || 'Open profile'}
                        {c.accessMode === 'SELECTION' || !c.accessMode
                          ? ` · ${c.selectionLimit != null ? `${c.selectionLimit} included` : 'package included'}${c.extraPhotoPrice != null ? ` · ₹${c.extraPhotoPrice}/extra` : ''}`
                          : ` · ${c.accessLabel || ''}`}
                      </div>
                    </Link>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        className="btn-ghost px-2.5 py-1.5 text-[12px]"
                        onClick={() => {
                          setAccessEdit(c);
                          setAccessFaceEnabled(!!c.faceSearchEnabled);
                          setAccessMode((c.accessMode === 'RAW' || c.rawAccess) ? 'RAW' : c.accessMode === 'VIEW' ? 'VIEW' : 'SELECTION');
                          setAccessLimit(c.selectionLimit != null ? String(c.selectionLimit) : '');
                          setAccessExtra(c.extraPhotoPrice != null ? String(c.extraPhotoPrice) : '');
                        }}
                      >
                        Access
                      </button>
                      <Link
                        href={`/dashboard/clients/${c.id}`}
                        className="btn-ghost px-2.5 py-1.5 text-[12px]"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        title="Unassign"
                        className="p-1.5 rounded-lg"
                        style={{ color: 'var(--ink-3)' }}
                        disabled={revokeClientMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Unassign “${c.name}” from this gallery?`)) {
                            revokeClientMutation.mutate(c.id);
                          }
                        }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Selection limit + dual-rate overage */}
      <div className="card p-6 mb-6">
        {gallery.selectionEnabled === false && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 text-[13px] font-medium"
            style={{
              background: 'color-mix(in srgb, var(--ink-3) 12%, var(--surface))',
              color: 'var(--ink-2)',
              border: '1px solid var(--line)',
            }}
          >
            Selection is <strong>off</strong> for this gallery — clients cannot heart or submit picks.
            Use the &quot;Selection off&quot; button above to turn it back on.
          </div>
        )}
        {(() => {
          const rateMissing =
            gallery.extraPhotoPrice == null
            && (gallery.clientType?.pricePerExtraPhoto == null);
          const tierMissing = !gallery.clientTypeId && gallery.selectionLimit == null;
          const incomplete = rateMissing || tierMissing;
          if (!incomplete) return null;
          return (
            <div
              className="rounded-xl px-3 py-2.5 mb-4 text-[13px] font-medium"
              style={{
                background: 'color-mix(in srgb, var(--rose) 10%, var(--surface))',
                color: 'var(--rose)',
                border: '1px solid color-mix(in srgb, var(--rose) 30%, var(--line))',
              }}
            >
              Customers can keep choosing photos. Set the included allowance and extra-photo price before they confirm.
            </div>
          );
        })()}
        <div className="flex items-center gap-2 mb-2">
          <Check size={16} style={{ color: 'var(--ink-2)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Photo selection &amp; extras
          </h2>
        </div>
        <p className="text-[13px] mb-4" style={{ color: 'var(--ink-2)' }}>
          Customers can select any number of photos. The included allowance is covered; only photos beyond it add charges. Leave blank to inherit package pricing. Customer-specific access settings take priority.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>
              Included photos (billing allowance)
            </div>
            <input
              className="input w-full"
              type="number"
              min={0}
              placeholder="From package…"
              defaultValue={gallery.selectionLimit ?? ''}
              key={`lim-${gallery.id}-${gallery.selectionLimit ?? 'x'}`}
              id="gallery-selection-limit"
            />
          </div>
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>
              ₹ / extra
            </div>
            <input
              className="input w-full"
              type="number"
              min={0}
              step="1"
              placeholder="From package…"
              defaultValue={gallery.extraPhotoPrice ?? ''}
              key={`xtr-${gallery.id}-${gallery.extraPhotoPrice ?? 'x'}`}
              id="gallery-extra-price"
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary mt-4 px-4 py-2 text-[13px]"
          onClick={() => {
            const limEl = document.getElementById('gallery-selection-limit') as HTMLInputElement | null;
            const prEl = document.getElementById('gallery-extra-price') as HTMLInputElement | null;
            const lim = limEl?.value?.trim() ?? '';
            const pr = prEl?.value?.trim() ?? '';
            updateMutation.mutate({
              selectionLimit: lim === '' ? null : Number(lim),
              extraPhotoPrice: pr === '' ? null : Number(pr),
            });
          }}
        >
          Save selection pricing
        </button>
      </div>

      <div className="card p-6 mb-6">
        <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>Package, end date &amp; all-originals offer</h2>
        <p className="text-[13px] mb-4" style={{ color: 'var(--ink-2)' }}>
          Linking a package fills included photos and extra rates. Near the end date, clients can buy every remaining original at the price you set.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 max-w-2xl">
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Package</div>
            <select className="input w-full" value={pkgId} onChange={(e) => setPkgId(e.target.value)}>
              <option value="">No package</option>
              {packages.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.title || p.name}
                  {p.active === false ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Gallery end date</div>
            <input className="input w-full" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>All-originals price (₹)</div>
            <input className="input w-full" type="number" min={1} placeholder="e.g. 4999" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} />
          </div>
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Show offer this many days before end</div>
            <input className="input w-full" type="number" min={1} value={bulkDays} onChange={(e) => setBulkDays(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-[13px]" style={{ color: 'var(--ink)' }}>
          <input type="checkbox" checked={bulkOn} onChange={(e) => setBulkOn(e.target.checked)} />
          Enable all-originals offer (FOMO as the end date approaches)
        </label>
        <button
          type="button"
          className="btn-primary mt-4 px-4 py-2 text-[13px]"
          onClick={() => updateMutation.mutate({
            servicePackageId: pkgId || null,
            expiresAt: expiresAt || null,
            bulkRawEnabled: bulkOn,
            bulkRawPrice: bulkPrice === '' ? null : Number(bulkPrice),
            bulkRawWindowDays: Number(bulkDays) || 14,
          })}
        >
          Save package &amp; offer
        </button>
      </div>

      {/* Share link + QR for relatives / guests */}
      <div id="share-qr-section" className="card p-6 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <QrCode size={16} style={{ color: 'var(--ink-2)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Share link &amp; QR
          </h2>
        </div>
        <p className="text-[13px] mb-4" style={{ color: 'var(--ink-2)' }}>
          Generate a link or QR for family &amp; friends. They open it <strong>without any login</strong>:
          enter <strong>name + phone</strong>, then (if face search is on) a <strong>face scan</strong> to see
          only their photos. Creating a link publishes the gallery but <strong>does not turn face search on</strong>.
          Set an optional <strong>full access code</strong> so guests can unlock the entire gallery.
        </p>

        <div className="flex flex-wrap gap-2 mb-3">
          <input
            className="input flex-1 min-w-[200px]"
            placeholder="Label (e.g. Wedding guests)"
            value={shareLabel}
            onChange={(e) => setShareLabel(e.target.value)}
          />
          <input
            className="input flex-1 min-w-[160px]"
            placeholder="Full access code (optional)"
            value={fullAccessCode}
            onChange={(e) => setFullAccessCode(e.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="btn-primary flex items-center gap-2 px-4 py-2"
            disabled={createShareMutation.isPending}
            onClick={() => createShareMutation.mutate()}
          >
            <QrCode size={15} />
            {createShareMutation.isPending ? 'Generating…' : 'Generate QR & link'}
          </button>
          <button
            type="button"
            className="btn-ghost flex items-center gap-2 px-3 py-2"
            onClick={() => { refetchShares(); refetchGuests(); }}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
        <p className="text-[12px] mb-4" style={{ color: 'var(--ink-3)' }}>
          Full access code is stored hashed. Guests only see a small “Full access” option after scanning.
        </p>

        {activeShare ? (
          <div className="grid md:grid-cols-[220px_1fr] gap-5 items-start">
            <div
              className="rounded-2xl p-3 border flex items-center justify-center"
              style={{ borderColor: 'var(--line)', background: 'var(--canvas)' }}
            >
              {activeShare.qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeShare.qrDataUrl} alt="Gallery share QR" width={200} height={200} className="rounded-lg" />
              ) : (
                <div className="text-sm py-16" style={{ color: 'var(--ink-3)' }}>No QR</div>
              )}
            </div>
            <div className="space-y-3 min-w-0">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--ink-3)' }}>
                  Public link
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <code
                    className="text-[12px] break-all flex-1 px-3 py-2 rounded-lg"
                    style={{ background: 'var(--surface-sunken)', color: 'var(--ink)' }}
                  >
                    {activeShare.url}
                  </code>
                  <button
                    type="button"
                    className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-sm"
                    onClick={() => copyText(activeShare.url, 'Link copied')}
                  >
                    <Copy size={14} /> Copy
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                <span className="inline-flex items-center gap-1">
                  <Link2 size={13} /> {activeShare.label || 'Share link'}
                </span>
                <span>Visits: {activeShare.visitCount ?? 0}</span>
                <span>Guests: {activeShare.guestCount ?? 0}</span>
                <span className={activeShare.active === false ? 'text-[var(--rose)]' : ''}>
                  {activeShare.active === false ? 'Revoked' : 'Active'}
                </span>
                <span>
                  Full access:{' '}
                  <strong style={{ color: 'var(--ink)' }}>
                    {activeShare.hasFullAccessCode ? 'Configured' : 'Not set'}
                  </strong>
                </span>
              </div>
              {activeShare.active !== false && (
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    className="input text-[12px] py-1.5 px-2 max-w-[160px]"
                    placeholder="Set full access code"
                    value={fullAccessCode}
                    onChange={(e) => setFullAccessCode(e.target.value)}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="btn-ghost px-3 py-1.5 text-sm"
                    disabled={!fullAccessCode.trim() || setFullAccessMutation.isPending}
                    onClick={() => setFullAccessMutation.mutate({ fullAccessCode: fullAccessCode.trim() })}
                  >
                    Save code
                  </button>
                  {activeShare.hasFullAccessCode && (
                    <button
                      type="button"
                      className="btn-ghost px-3 py-1.5 text-sm"
                      style={{ color: 'var(--rose)' }}
                      onClick={() => setFullAccessMutation.mutate({ clear: true })}
                    >
                      Clear code
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost px-3 py-1.5 text-sm"
                    style={{ color: 'var(--rose)' }}
                    disabled={revokeShareMutation.isPending}
                    onClick={() => {
                      if (confirm('Revoke this share link? Existing QR codes will stop working.')) {
                        revokeShareMutation.mutate(activeShare.id);
                      }
                    }}
                  >
                    Revoke link
                  </button>
                </div>
              )}

              {shareLinks.length > 1 && (
                <div className="pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
                  <div className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>
                    All links ({shareLinks.length})
                  </div>
                  <div className="space-y-2 max-h-40 overflow-auto">
                    {shareLinks.map((l: any) => (
                      <div key={l.id} className="flex items-center gap-2 text-[12px]">
                        <span className="truncate flex-1" style={{ color: l.active === false ? 'var(--ink-3)' : 'var(--ink-2)' }}>
                          {l.label || l.token?.slice(0, 10)} · {l.guestCount ?? 0} guests
                          {l.active === false ? ' (revoked)' : ''}
                        </span>
                        {l.active !== false && (
                          <button type="button" className="underline" onClick={() => copyText(l.url)}>
                            Copy
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            className="rounded-xl px-4 py-8 text-center text-[13px]"
            style={{ background: 'var(--surface-sunken)', color: 'var(--ink-3)' }}
          >
            No share link yet — click <strong>Generate QR &amp; link</strong> above.
          </div>
        )}

        <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Users size={15} style={{ color: 'var(--ink-2)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Guests who opened the link
            </h3>
            <span className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
              ({shareGuests.length})
            </span>
          </div>
          {shareGuests.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
              No guests yet. When someone scans the QR and enters name + phone, they show up here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ color: 'var(--ink-3)', textAlign: 'left' }}>
                    <th className="py-2 font-medium">Name</th>
                    <th className="py-2 font-medium">Phone</th>
                    <th className="py-2 font-medium">Entered</th>
                    <th className="py-2 font-medium">Face</th>
                  </tr>
                </thead>
                <tbody>
                  {shareGuests.map((g: any) => (
                    <tr key={g.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="py-2.5" style={{ color: 'var(--ink)' }}>{g.name}</td>
                      <td className="py-2.5" style={{ color: 'var(--ink-2)' }}>{g.phone}</td>
                      <td className="py-2.5" style={{ color: 'var(--ink-3)' }}>
                        {g.createdAt ? new Date(g.createdAt).toLocaleString() : '—'}
                      </td>
                      <td className="py-2.5" style={{ color: g.faceSessionId ? 'var(--green)' : 'var(--ink-3)' }}>
                        {g.faceSessionId ? 'Done' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Face analytics + admin face search */}
      <div className="card p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ScanFace size={16} style={{ color: 'var(--ink-2)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Face search</h2>
          {faceAnalytics && (
            <span className="badge badge-neutral ml-auto">{faceAnalytics.faceIndexStatus || '—'}</span>
          )}
        </div>

        {faceAnalytics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13px] mb-5">
            <div>
              <div style={{ color: 'var(--ink-3)' }}>Photos indexed</div>
              <div className="font-semibold mt-0.5" style={{ color: 'var(--ink)' }}>
                {faceAnalytics.photosIndexed}/{faceAnalytics.photosTotal}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--ink-3)' }}>Active faces</div>
              <div className="font-semibold mt-0.5" style={{ color: 'var(--ink)' }}>{faceAnalytics.activeFaces}</div>
            </div>
            <div>
              <div style={{ color: 'var(--ink-3)' }}>DLQ jobs</div>
              <div className="font-semibold mt-0.5" style={{ color: faceAnalytics.deadLetterJobs ? 'var(--rose)' : 'var(--ink)' }}>
                {faceAnalytics.deadLetterJobs}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--ink-3)' }}>Est. index cost</div>
              <div className="font-semibold mt-0.5" style={{ color: 'var(--ink)' }}>
                ${faceAnalytics.estimatedCostUsd?.indexingOneTime ?? '0'}
              </div>
            </div>
          </div>
        )}

        {!faceOn ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            Turn on <strong>Face search</strong> above, then click <strong>Reindex faces</strong> so photos are scanned.
            After indexing finishes, upload a selfie here to find matching photos in this gallery.
          </p>
        ) : (
          <>
            <p className="text-[13px] mb-3" style={{ color: 'var(--ink-2)' }}>
              Upload a clear selfie (one face). Matching photos in this gallery are ranked by similarity (admin-only scores).
            </p>
            <label
              className="inline-flex items-center gap-2 btn-primary px-4 py-2 cursor-pointer"
              style={{ opacity: faceSearching ? 0.7 : 1 }}
            >
              <ScanFace size={16} />
              {faceSearching ? 'Searching…' : 'Upload selfie to search'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={faceSearching}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  e.target.value = '';
                  runFaceSearch(f);
                }}
              />
            </label>
            {faceOn && (
              <button
                type="button"
                onClick={() => reindexMutation.mutate()}
                disabled={reindexMutation.isPending}
                className="btn-ghost ml-2 px-3 py-2 text-[13px] inline-flex items-center gap-1.5"
              >
                <RefreshCw size={14} className={reindexMutation.isPending ? 'animate-spin' : ''} />
                Reindex faces
              </button>
            )}
            {faceSearchMessage && (
              <p className="text-[13px] mt-3" style={{ color: 'var(--ink-2)' }}>{faceSearchMessage}</p>
            )}
            {faceResults && faceResults.length > 0 && (
              <div className="mt-5">
                <h3 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--ink)' }}>
                  Matches · {faceResults.length}
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                  {faceResults.map((r: any) => (
                    <button
                      key={r.photoId}
                      type="button"
                      onClick={() => {
                        const idx = (gallery.photos || []).findIndex((p: any) => p.id === r.photoId);
                        if (idx >= 0) {
                          // Open lightbox using viewable list
                          const viewableIds = (gallery.photos || [])
                            .filter((p: any) => p.previewUrl || p.downloadUrl || p.thumbnailUrl)
                            .map((p: any) => p.id);
                          const vi = viewableIds.indexOf(r.photoId);
                          if (vi >= 0) setViewerIndex(vi);
                        }
                      }}
                      className="relative aspect-square rounded-lg overflow-hidden text-left"
                      style={{ background: 'var(--surface-sunken)' }}
                    >
                      {r.thumbnailUrl ? (
                        <img src={r.thumbnailUrl} alt={r.filename || ''} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[11px]" style={{ color: 'var(--ink-3)' }}>
                          No thumb
                        </div>
                      )}
                      <div
                        className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-[10px] font-semibold text-white"
                        style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}
                      >
                        {r.similarity?.toFixed?.(1) ?? r.similarity}% match
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {faceResults && faceResults.length === 0 && !faceSearching && (
              <p className="text-[13px] mt-3" style={{ color: 'var(--ink-3)' }}>No matches in this gallery for that selfie.</p>
            )}
          </>
        )}
      </div>

      {/* Upload */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Upload photos &amp; videos</h2>
          {processingStatus && processingStatus.total > 0 && (
            <div className="flex gap-3 text-[12px] items-center">
              <span className="flex items-center gap-1" style={{ color: 'var(--green)' }}>
                <CheckCircle2 size={12} />{processingStatus.complete}
              </span>
              {(processingStatus.uploaded + processingStatus.processing + processingStatus.registered) > 0 && (
                <span className="flex items-center gap-1" style={{ color: 'var(--amber)' }}>
                  <Clock size={12} />
                  {(processingStatus.uploaded || 0) + (processingStatus.processing || 0) + (processingStatus.registered || 0)}
                </span>
              )}
              {processingStatus.failed > 0 && (
                <button onClick={() => retryMutation.mutate()} className="flex items-center gap-1" style={{ color: 'var(--rose)' }}>
                  <AlertCircle size={12} />{processingStatus.failed} · retry
                </button>
              )}
            </div>
          )}
        </div>
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); doUpload(Array.from(e.dataTransfer.files)); }}
          className="flex flex-col items-center justify-center w-full h-36 rounded-xl cursor-pointer transition-colors"
          style={{ border: `1.5px dashed ${dragOver ? 'var(--ink)' : 'var(--line)'}`, background: dragOver ? 'var(--surface-sunken)' : 'transparent' }}>
          <UploadCloud size={26} style={{ color: 'var(--ink-3)' }} className="mb-2.5" />
          <span className="text-[14px] font-medium" style={{ color: 'var(--ink)' }}>Drop media here, or click to browse</span>
          <span className="text-[12px] mt-1" style={{ color: 'var(--ink-3)' }}>
            Photos: JPG · PNG · WEBP · HEIC · Videos: MP4 · MOV · WEBM — uploads run in the background
          </span>
          <input
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/webm"
            multiple
            className="hidden"
            onChange={(e) => doUpload(Array.from(e.target.files || []))}
          />
        </label>
      </div>

      {/* Photos / Videos sections */}
      {(gallery.photos?.length > 0 || (gallery.photoTotal || gallery._count?.photos || 0) > 0) && (
        <div>
          {(() => {
            const photos = (gallery.photos || []).filter((p: any) => (p.mediaType || 'IMAGE') !== 'VIDEO');
            const videos = (gallery.photos || []).filter((p: any) => p.mediaType === 'VIDEO');
            const list = mediaTab === 'VIDEO' ? videos : photos;
            const totalInDb = gallery.photoTotal ?? gallery._count?.photos ?? (gallery.photos || []).length;
            const loaded = (gallery.photos || []).length;
            const pipeTotal = processingStatus?.total;
            return (
              <>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <button
              type="button"
              className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
              style={mediaTab === 'PHOTO' ? { borderColor: 'var(--ink)', color: 'var(--ink)' } : {}}
              onClick={() => setMediaTab('PHOTO')}
            >
              <ImageIcon size={14} /> Photos · {photos.length}
            </button>
            <button
              type="button"
              className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-[13px]"
              style={mediaTab === 'VIDEO' ? { borderColor: 'var(--ink)', color: 'var(--ink)' } : {}}
              onClick={() => setMediaTab('VIDEO')}
            >
              <Film size={14} /> Videos · {videos.length}
            </button>
            <span className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
              Showing {loaded} of {totalInDb} in gallery
              {pipeTotal != null && pipeTotal !== totalInDb ? ` · pipeline ${pipeTotal}` : ''}
            </span>
          </div>
          {gallery.photoLimitApplied && (
            <p className="text-[12px] mb-3" style={{ color: 'var(--amber)' }}>
              Only the first {loaded} items are loaded in this view. Refresh if you expected more.
            </p>
          )}
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {list.map((photo: any) => {
              const canOpen = !!(photo.previewUrl || photo.downloadUrl || photo.thumbnailUrl || photo.streamUrl);
              const isVideo = photo.mediaType === 'VIDEO';
              return (
              <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
                {photo.thumbnailUrl || photo.previewUrl ? (
                  <button
                    type="button"
                    onClick={() => canOpen && openViewer(photo.id)}
                    className="w-full h-full block cursor-zoom-in focus:outline-none relative"
                    title={isVideo ? 'Play video' : 'Click for full size'}
                  >
                    <img src={photo.thumbnailUrl || photo.previewUrl} alt={photo.filename || ''} className="w-full h-full object-cover" loading="lazy" />
                    {isVideo && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="rounded-full p-2" style={{ background: 'rgba(0,0,0,0.55)' }}>
                          <Play size={16} color="#fff" fill="#fff" />
                        </span>
                      </span>
                    )}
                  </button>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-2">
                    {statusIcon(photo.ingestionStatus || photo.processingStatus)}
                    <span className="text-[10px] text-center" style={{ color: 'var(--ink-3)' }}>
                      {photo.processingStatus === 'COMPLETE' ? 'No preview' : (photo.ingestionStatus || photo.processingStatus || '…')}
                    </span>
                  </div>
                )}
                {/* Hover actions */}
                <div className="absolute bottom-1.5 left-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canOpen && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openViewer(photo.id); }}
                      className="flex-1 rounded-md py-1 text-[10px] font-medium"
                      style={{ background: 'rgba(26,25,23,0.8)', color: '#fff' }}
                    >
                      View
                    </button>
                  )}
                  {(photo.thumbnailUrl || photo.previewUrl) && (
                    <button
                      type="button"
                      title="Use as gallery cover / QR thumbnail"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCropPhotoId(photo.id);
                        setCropSrc(photo.previewUrl || photo.thumbnailUrl || photo.downloadUrl || null);
                        setCropOpen(true);
                      }}
                      className="rounded-md px-1.5 py-1 text-[10px] font-medium"
                      style={{ background: 'rgba(154,123,79,0.95)', color: '#fff' }}
                    >
                      Cover
                    </button>
                  )}
                  {(photo.downloadUrl || photo.previewUrl) && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); downloadPhoto(photo); }}
                      className="rounded-md p-1"
                      style={{ background: 'rgba(26,25,23,0.8)', color: '#fff' }}
                      title="Download original"
                    >
                      <Download size={12} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete this photo? Faces and files will be removed.')) deleteMutation.mutate(photo.id);
                  }}
                  className="absolute top-1.5 right-1.5 rounded-md p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(26,25,23,0.75)', color: '#fff' }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
              );
            })}
          </div>
          {list.length === 0 && (
            <p className="text-sm py-8 text-center" style={{ color: 'var(--ink-3)' }}>
              No {mediaTab === 'VIDEO' ? 'videos' : 'photos'} yet.
            </p>
          )}
              </>
            );
          })()}
        </div>
      )}

      <Modal
        open={faceCostOpen}
        onClose={() => !faceMutation.isPending && setFaceCostOpen(false)}
        title="Enable face search?"
        preventClose={faceMutation.isPending}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-ghost flex-1 py-2.5" onClick={() => setFaceCostOpen(false)} disabled={faceMutation.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={faceMutation.isPending}
              onClick={() => {
                faceMutation.mutate(
                  { faceSearchEnabled: true, confirmCost: true },
                  { onSettled: () => setFaceCostOpen(false) },
                );
              }}
            >
              Enable (costs money)
            </button>
          </>
        }
      >
        <p className="text-[13px] mb-3" style={{ color: 'var(--ink-2)' }}>
          Face search uses <strong>Amazon Rekognition</strong> and is billed per indexed photo.
          Estimated one-time index cost for this gallery:{' '}
          <strong>
            ${faceAnalytics?.estimatedCostUsd?.indexingOneTime ?? '—'}
          </strong>
          . Searches also incur charges.
        </p>
        <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
          Leave it off unless you need relatives to find their photos via QR. Bulk uploads never index faces until this is on.
        </p>
      </Modal>

      <Modal
        open={confirmSoftDelete}
        onClose={() => !softDeleteGallery.isPending && setConfirmSoftDelete(false)}
        title="Move gallery to recycle bin?"
        description="Clients lose access immediately. Media stays in storage for 30 days, then is permanently deleted from S3."
        preventClose={softDeleteGallery.isPending}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              disabled={softDeleteGallery.isPending}
              onClick={() => setConfirmSoftDelete(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={softDeleteGallery.isPending}
              onClick={() => softDeleteGallery.mutate()}
            >
              {softDeleteGallery.isPending ? 'Moving…' : 'Move to bin'}
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          Restore anytime from Galleries → Recycle bin within 30 days.
        </p>
      </Modal>

      <Modal
        open={!!dupModal}
        onClose={() => setDupModal(null)}
        title="Duplicate file names"
        description={
          dupModal
            ? `${dupModal.conflicts.length} of ${dupModal.files.length} files already exist. Skip them, replace, or keep both.`
            : undefined
        }
        size="lg"
        footer={
          <>
            <button type="button" className="btn-ghost flex-1 py-2.5" onClick={() => setDupModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              onClick={async () => {
                if (!dupModal) return;
                const { files, decisions } = dupModal;
                const skipN = files.filter((f) => decisions[f.name]?.action === 'skip').length;
                const uploadN = files.length - skipN;
                setDupModal(null);
                if (uploadN === 0 && skipN > 0) {
                  toast.success(`Skipped all ${skipN} duplicates`);
                  return;
                }
                await startUpload(files, decisions);
              }}
            >
              {(() => {
                if (!dupModal) return 'Continue';
                const skipN = dupModal.files.filter((f) => dupModal.decisions[f.name]?.action === 'skip').length;
                const uploadN = dupModal.files.length - skipN;
                if (uploadN === 0) return `Skip all ${skipN}`;
                if (skipN === 0) return `Upload ${uploadN}`;
                return `Upload ${uploadN} · skip ${skipN}`;
              })()}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary text-[12px] px-3 py-2"
              onClick={() => setAllDupDecisions('skip')}
            >
              Skip all duplicates
            </button>
            <button
              type="button"
              className="btn-ghost text-[12px] px-3 py-2"
              onClick={() => setAllDupDecisions('replace')}
            >
              Replace all
            </button>
            <button
              type="button"
              className="btn-ghost text-[12px] px-3 py-2"
              onClick={() => setAllDupDecisions('keep_both')}
            >
              Keep both (all)
            </button>
          </div>
          <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
            New files (not listed) always upload. Defaults to <strong>Skip</strong> so bulk re-uploads don’t create ghost rows.
          </p>
          <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
            {dupModal?.conflicts.map((c) => {
              const action = dupModal.decisions[c.name]?.action || 'skip';
              const chip = (act: 'skip' | 'replace' | 'keep_both', label: string) => (
                <button
                  key={act}
                  type="button"
                  className="text-[12px] font-semibold px-2 py-1 rounded-lg"
                  style={{
                    background: action === act ? 'var(--ink)' : 'transparent',
                    color: action === act ? '#fff' : 'var(--ink)',
                    border: '1px solid var(--line)',
                  }}
                  onClick={() =>
                    setDupModal({
                      ...dupModal,
                      decisions: {
                        ...dupModal.decisions,
                        [c.name]: { action: act, replacePhotoId: c.existing?.id },
                      },
                    })
                  }
                >
                  {label}
                </button>
              );
              return (
                <div
                  key={c.name}
                  className="rounded-xl px-3 py-2.5 flex flex-wrap items-center gap-2 justify-between"
                  style={{ background: 'var(--surface-sunken)' }}
                >
                  <div className="text-[13px] font-medium truncate min-w-0 flex-1" style={{ color: 'var(--ink)' }}>
                    {c.name}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {chip('skip', 'Skip')}
                    {chip('replace', 'Replace')}
                    {chip('keep_both', 'Keep both')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* Full-size lightbox */}
      <Modal
        open={!!activePhoto}
        onClose={closeViewer}
        variant="fullscreen"
        title={activePhoto?.filename || 'Media'}
        description={
          activePhoto
            ? `${viewerIndex! + 1} / ${viewable.length}${
                activePhoto.width && activePhoto.height ? ` · ${activePhoto.width}×${activePhoto.height}` : ''
              }`
            : undefined
        }
        ariaLabel="Photo viewer"
        footer={
          activePhoto ? (
            <button
              type="button"
              onClick={() => downloadPhoto(activePhoto)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
              style={{ background: '#fff', color: '#1a1917' }}
            >
              <Download size={16} /> Download original
            </button>
          ) : null
        }
      >
        {activePhoto && (
          <div className="relative flex-1 flex items-center justify-center min-h-0 px-12 pb-6">
            {viewable.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={prevPhoto}
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/80 hover:text-white hover:bg-white/10"
                  aria-label="Previous"
                >
                  <ChevronLeft size={28} />
                </button>
                <button
                  type="button"
                  onClick={nextPhoto}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/80 hover:text-white hover:bg-white/10"
                  aria-label="Next"
                >
                  <ChevronRight size={28} />
                </button>
              </>
            )}
            {activePhoto.mediaType === 'VIDEO' && (activePhoto.streamUrl || activePhoto.downloadUrl) ? (
              <VideoPlayer
                key={activePhoto.id}
                src={activePhoto.streamUrl || activePhoto.downloadUrl}
                poster={activePhoto.previewUrl || activePhoto.thumbnailUrl}
                autoPlay
                className="w-full max-w-5xl px-2"
              />
            ) : (
              <img
                src={activePhoto.previewUrl || activePhoto.downloadUrl || activePhoto.thumbnailUrl}
                alt={activePhoto.filename || ''}
                className="max-w-full max-h-full object-contain rounded-sm shadow-2xl select-none"
                draggable={false}
              />
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={assignOpen}
        onClose={() => {
          if (grantClientsMutation.isPending) return;
          setAssignOpen(false);
        }}
        title="Assign to clients"
        description="Assign and publish makes this gallery available in the client app. Extend an expired gallery before assigning it."
        size="md"
        preventClose={grantClientsMutation.isPending}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              disabled={grantClientsMutation.isPending}
              onClick={() => setAssignOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={!pickedClientIds.length || grantClientsMutation.isPending}
              onClick={() => grantClientsMutation.mutate(pickedClientIds)}
            >
              {grantClientsMutation.isPending
                ? 'Assigning…'
                : pickedClientIds.length
                  ? `Assign and publish for ${pickedClientIds.length} client${pickedClientIds.length === 1 ? '' : 's'}`
                  : 'Assign and publish'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <input
            className="input w-full"
            placeholder="Search name or phone…"
            value={assignSearch}
            onChange={(e) => setAssignSearch(e.target.value)}
            autoFocus
          />
          <div className="max-h-72 overflow-y-auto space-y-1">
            {(clientsPicker?.customers || [])
              .filter((c: any) => !(gallery.assignedClients || []).some((a: any) => a.id === c.id))
              .map((c: any) => {
                const on = pickedClientIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setPickedClientIds((prev) =>
                        on ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                      )
                    }
                    className="w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-3"
                    style={{
                      background: on ? 'var(--nav-active-bg)' : 'var(--surface-sunken)',
                      border: `1px solid ${on ? 'var(--nav-active-ring)' : 'transparent'}`,
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium truncate" style={{ color: 'var(--ink)' }}>{c.name}</span>
                      <span className="block text-[12px] truncate" style={{ color: 'var(--ink-3)' }}>
                        {c.phone || c.loginId || 'No phone'}
                      </span>
                    </span>
                    {on && <Check size={16} style={{ color: 'var(--ink)' }} />}
                  </button>
                );
              })}
            {!(clientsPicker?.customers || []).filter(
              (c: any) => !(gallery.assignedClients || []).some((a: any) => a.id === c.id),
            ).length && (
              <div className="text-center py-8 text-sm" style={{ color: 'var(--ink-3)' }}>
                {assignSearch ? 'No matching clients' : 'Every client already has this gallery, or none exist yet.'}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={rawOpen}
        onClose={() => {
          if (grantRawMutation.isPending) return;
          setRawOpen(false);
        }}
        title="Give full access"
        description="This client gets every original in this gallery — no selection cap, no culling. Search by name, phone, or email."
        size="md"
        preventClose={grantRawMutation.isPending}
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              disabled={grantRawMutation.isPending}
              onClick={() => setRawOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={!rawPickId || grantRawMutation.isPending}
              onClick={() => grantRawMutation.mutate(rawPickId)}
            >
              {grantRawMutation.isPending ? 'Granting…' : 'Give full access'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-xl px-3 py-3" style={{ background: 'var(--surface-sunken)' }}>
            <input type="checkbox" className="mt-1" checked={rawFaceEnabled} onChange={(e) => setRawFaceEnabled(e.target.checked)} disabled={grantRawMutation.isPending} />
            <span>
              <span className="block text-[13px] font-medium" style={{ color: 'var(--ink)' }}>Enable face scan for this client</span>
              <span className="block text-[12px] mt-1" style={{ color: 'var(--ink-3)' }}>
                Let this client use a selfie to find their photos while keeping full access to all originals.
                {!faceOn && ' Turn on Face search for this gallery to make scanning available.'}
              </span>
            </span>
          </label>
          <input
            className="input w-full"
            placeholder="Search name, phone, email…"
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            autoFocus
          />
          <div className="max-h-72 overflow-y-auto space-y-1">
            {(rawClientsPicker?.customers || []).map((c: any) => {
              const on = rawPickId === c.id;
              const already = (gallery.assignedClients || []).some((a: any) => a.id === c.id && a.rawAccess);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setRawPickId(c.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-3"
                  style={{
                    background: on ? 'var(--nav-active-bg)' : 'var(--surface-sunken)',
                    border: `1px solid ${on ? 'var(--nav-active-ring)' : 'transparent'}`,
                  }}
                >
                  <span className="min-w-0">
                    <span className="block font-medium truncate" style={{ color: 'var(--ink)' }}>{c.name}</span>
                    <span className="block text-[12px] truncate" style={{ color: 'var(--ink-3)' }}>
                      {c.phone || c.email || c.loginId || 'No phone'}
                      {already ? ' · full access already granted' : ''}
                    </span>
                  </span>
                  {on && <Check size={16} style={{ color: 'var(--ink)' }} />}
                </button>
              );
            })}
            {!(rawClientsPicker?.customers || []).length && (
              <div className="text-center py-8 text-sm" style={{ color: 'var(--ink-3)' }}>
                {rawSearch ? 'No matching clients' : 'Type to search clients'}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!accessEdit}
        onClose={() => !accessMutation.isPending && setAccessEdit(null)}
        title={accessEdit ? `Access · ${accessEdit.name}` : 'Client access'}
        preventClose={accessMutation.isPending}
        size="md"
        footer={
          <>
            <button type="button" className="btn-ghost flex-1 py-2.5" disabled={accessMutation.isPending} onClick={() => setAccessEdit(null)}>Cancel</button>
            <button type="button" className="btn-primary flex-1 py-2.5" disabled={accessMutation.isPending} onClick={() => accessMutation.mutate()}>
              {accessMutation.isPending ? 'Saving…' : 'Save access'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
            This is only for this client in this gallery. Clients see watermarked previews. Full access lets them download the original files.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['SELECTION', 'Selection', 'Choose freely, review extras, submit'],
              ['RAW', 'Full access', 'All originals · optional face scan'],
              ['VIEW', 'View only', 'Watermarked preview · no download'],
            ] as const).map(([mode, label, hint]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAccessMode(mode)}
                className="rounded-xl px-2.5 py-2.5 text-left"
                style={{
                  background: accessMode === mode ? 'var(--nav-active-bg)' : 'var(--surface-sunken)',
                  border: `1px solid ${accessMode === mode ? 'var(--nav-active-ring)' : 'transparent'}`,
                }}
              >
                <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>{label}</div>
                <div className="text-[10px] mt-0.5 leading-snug" style={{ color: 'var(--ink-3)' }}>{hint}</div>
              </button>
            ))}
          </div>
          {accessMode === 'SELECTION' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] mb-1" style={{ color: 'var(--ink-3)' }}>Included for this client</div>
                <input className="input w-full" type="number" min={0} placeholder="From gallery / package" value={accessLimit} onChange={(e) => setAccessLimit(e.target.value)} />
              </div>
              <div>
                <div className="text-[11px] mb-1" style={{ color: 'var(--ink-3)' }}>₹ / extra for this client</div>
                <input className="input w-full" type="number" min={1} placeholder="From gallery / package" value={accessExtra} onChange={(e) => setAccessExtra(e.target.value)} />
              </div>
            </div>
          )}
          {accessMode === 'RAW' && (
            <p className="text-[12px] rounded-xl px-3 py-2" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
              Client gets every original. No hearts, no extras invoice. Enable face scan below so they can find photos of themselves.
            </p>
          )}
          {accessMode === 'RAW' && (
            <label className="flex items-start gap-3 rounded-xl px-3 py-3" style={{ background: 'var(--surface-sunken)' }}>
              <input type="checkbox" className="mt-1" checked={accessFaceEnabled} onChange={(e) => setAccessFaceEnabled(e.target.checked)} disabled={accessMutation.isPending} />
              <span>
                <span className="block text-[13px] font-medium" style={{ color: 'var(--ink)' }}>Enable face scan for this client</span>
                <span className="block text-[12px] mt-1" style={{ color: 'var(--ink-3)' }}>
                  Let this client use a selfie to find their photos while keeping full access to all originals.
                  {!faceOn && ' Turn on Face search for this gallery to make scanning available.'}
                </span>
              </span>
            </label>
          )}
          {accessMode === 'VIEW' && (
            <p className="text-[12px] rounded-xl px-3 py-2" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
              Watermarked previews only. No download of masters, no selection.
            </p>
          )}
        </div>
      </Modal>

      <ImageCropModal
        open={cropOpen}
        title="Crop gallery cover"
        src={cropSrc}
        aspect={16 / 10}
        saving={cropSaving}
        onClose={() => { if (!cropSaving) { setCropOpen(false); setCropSrc(null); setCropPhotoId(null); } }}
        onSave={async ({ blob, crop }) => {
          setCropSaving(true);
          try {
            if (blob) {
              await galleryApi.setCover(id, { file: blob, photoId: cropPhotoId || undefined, crop });
            } else {
              await galleryApi.update(id, { coverPhotoId: cropPhotoId, coverCrop: crop });
            }
            qc.invalidateQueries({ queryKey: ['gallery', id] });
            qc.invalidateQueries({ queryKey: ['galleries'] });
            toast.success('Cover cropped and saved');
            setCropOpen(false);
            setCropSrc(null);
            setCropPhotoId(null);
          } catch (e: any) {
            toast.error(e.response?.data?.error || 'Could not save cover');
          } finally {
            setCropSaving(false);
          }
        }}
      />
    </div>
  );
}
