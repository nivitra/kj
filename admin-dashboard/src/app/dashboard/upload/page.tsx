'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { UploadCloud, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { galleryApi } from '@/lib/api';
import { useUploadQueue } from '@/lib/upload-queue';
import SearchableSelect from '@/components/SearchableSelect';

export default function UploadPage() {
  const [selectedGallery, setSelectedGallery] = useState('');
  const { enqueue, jobs } = useUploadQueue();
  const job = jobs.find((j) => j.galleryId === selectedGallery);
  const progress = job && ['queued', 'running'].includes(job.status) ? Math.round((job.done + job.failed) / Math.max(1, job.total) * 100) : null;
  const results = job && ['done', 'error'].includes(job.status) ? { uploaded: job.done, errors: job.errors.map((e) => ({ filename: e.name, error: e.error })) } : null;
  const [dragOver, setDragOver] = useState(false);

  const { data } = useQuery({ queryKey: ['galleries-all'], queryFn: () => galleryApi.list({ limit: 100 }).then((r) => r.data) });

  const galleryOptions = useMemo(
    () =>
      (data?.galleries || []).map((g: any) => ({
        value: g.id,
        label: `${g.name} · ${g._count?.photos ?? 0} photos`,
        keywords: g.name,
      })),
    [data],
  );

  const doUpload = async (files: File[]) => {
    if (!files.length || !selectedGallery) return;
    await enqueue({ galleryId: selectedGallery, files,
      galleryName: data?.galleries?.find((g: any) => g.id === selectedGallery)?.name,
    });
    toast.success('Upload queued. You can keep working while files upload.');
  };

  return (
    <div className="animate-fade-up">
      <p className="kicker mb-2">Upload</p>
      <h1 className="font-display text-[32px] leading-tight mb-1.5" style={{ color: 'var(--ink)' }}>Bulk upload</h1>
      <p className="text-[14px] mb-7" style={{ color: 'var(--ink-2)' }}>Send a batch of photos to any gallery. Previews and thumbnails render automatically.</p>

      <div className="card p-6 mb-6">
        <label className="block text-[13px] font-medium mb-2" style={{ color: 'var(--ink)' }}>Destination gallery</label>
        <div className="mb-5">
          <SearchableSelect
            value={selectedGallery}
            onChange={setSelectedGallery}
            options={galleryOptions}
            placeholder="Search gallery by name…"
            emptyLabel="Choose a gallery…"
            allowEmpty={false}
            hint="Type to search — opens keyboard on iPad"
          />
        </div>

        {selectedGallery && (
          progress !== null ? (
            <div>
              <div className="flex items-center justify-between mb-2 text-[13px]"><span style={{ color: 'var(--ink-2)' }}>Uploading…</span><span style={{ color: 'var(--ink)' }}>{progress}%</span></div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: 'var(--ink)' }} />
              </div>
            </div>
          ) : (
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); doUpload(Array.from(e.dataTransfer.files)); }}
              className="flex flex-col items-center justify-center w-full h-52 rounded-xl cursor-pointer transition-colors"
              style={{ border: `1.5px dashed ${dragOver ? 'var(--ink)' : 'var(--line)'}`, background: dragOver ? 'var(--surface-sunken)' : 'transparent' }}>
              <UploadCloud size={34} style={{ color: 'var(--ink-3)' }} className="mb-3" />
              <span className="text-[15px] font-medium" style={{ color: 'var(--ink)' }}>Drop photos here, or click to browse</span>
              <span className="text-[13px] mt-1.5" style={{ color: 'var(--ink-2)' }}>JPG · PNG · WEBP · HEIC · TIFF</span>
              <span className="text-[12px] mt-0.5" style={{ color: 'var(--ink-3)' }}>Max 50MB per file · up to 100 at once</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => doUpload(Array.from(e.target.files || []))} />
            </label>
          )
        )}
      </div>

      {results && (
        <div className="card p-6">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>Upload results</h2>
          <div className="flex flex-wrap gap-5 mb-4">
            <div className="flex items-center gap-2" style={{ color: 'var(--green)' }}><CheckCircle2 size={16} /><span className="font-semibold">{results.uploaded}</span><span className="text-[13px]" style={{ color: 'var(--ink-2)' }}>uploaded</span></div>
            {results.errors.length > 0 && <div className="flex items-center gap-2" style={{ color: 'var(--rose)' }}><AlertCircle size={16} /><span className="font-semibold">{results.errors.length}</span><span className="text-[13px]" style={{ color: 'var(--ink-2)' }}>failed</span></div>}
            <div className="flex items-center gap-2" style={{ color: 'var(--amber)' }}><Clock size={16} /><span className="text-[13px]" style={{ color: 'var(--ink-2)' }}>generating previews…</span></div>
          </div>
          {results.errors.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: 'var(--rose-bg)', border: '1px solid rgba(196,65,58,0.2)' }}>
              <p className="text-[12px] font-medium mb-2" style={{ color: 'var(--rose)' }}>Failed files</p>
              {results.errors.map((e: any, i: number) => <p key={i} className="text-[12px]" style={{ color: 'var(--rose)' }}>{e.filename}: {e.error}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
