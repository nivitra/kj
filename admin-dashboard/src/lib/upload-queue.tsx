'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import toast from 'react-hot-toast';
import { uploadApi } from './api';

export type DuplicateDecision = 'replace' | 'keep_both' | 'skip';

export type UploadJob = {
  id: string;
  galleryId: string;
  galleryName: string;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  status: 'queued' | 'running' | 'done' | 'error';
  errors: { name: string; error: string }[];
  startedAt: number;
};

type DecisionMap = Record<string, { action: DuplicateDecision; replacePhotoId?: string }>;

type EnqueueOptions = {
  galleryId: string;
  galleryName?: string;
  files: File[];
  /** Map original file name → decision when filename already exists */
  decisions?: DecisionMap;
};

type UploadQueueCtx = {
  jobs: UploadJob[];
  active: UploadJob | null;
  totals: { done: number; total: number; left: number; failed: number; skipped: number };
  enqueue: (opts: EnqueueOptions) => Promise<void>;
  checkDuplicates: (galleryId: string, files: File[]) => Promise<
    { name: string; existing: { id: string; filename: string } | null }[]
  >;
  dismissJob: (id: string) => void;
  clearFinished: () => void;
};

const Ctx = createContext<UploadQueueCtx | null>(null);

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function putWithRetry(url: string, file: File, attempts = 2): Promise<void> {
  let lastErr: Error | null = null;
  for (let a = 0; a < attempts; a++) {
    try {
      const put = await fetch(url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!put.ok) {
        const body = await put.text().catch(() => '');
        throw new Error(`S3 PUT ${put.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
      }
      return;
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e?.message || e));
      if (a < attempts - 1) await sleep(600 * (a + 1));
    }
  }
  throw lastErr || new Error('upload_failed');
}

async function completeWithRetry(galleryId: string, photoIds: string[], attempts = 3): Promise<void> {
  let lastErr: Error | null = null;
  for (let a = 0; a < attempts; a++) {
    try {
      await uploadApi.complete(galleryId, photoIds);
      return;
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e?.message || e));
      if (a < attempts - 1) await sleep(500 * (a + 1));
    }
  }
  throw lastErr || new Error('complete_failed');
}

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const running = useRef(false);
  const queueRef = useRef<
    {
      jobId: string;
      galleryId: string;
      galleryName: string;
      files: File[];
      decisions: DecisionMap;
    }[]
  >([]);

  const updateJob = useCallback((id: string, patch: Partial<UploadJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  const processQueue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (queueRef.current.length) {
      const item = queueRef.current.shift()!;
      updateJob(item.jobId, { status: 'running' });
      const { galleryId, decisions = {} } = item;

      // Skip duplicates entirely — never register or PUT them
      const toUpload = item.files.filter((f) => decisions[f.name]?.action !== 'skip');
      const skipped = item.files.length - toUpload.length;

      const BATCH = 40;
      const CONCURRENCY = 4;
      let done = 0;
      let failed = 0;
      const errors: { name: string; error: string }[] = [];
      const total = toUpload.length;

      updateJob(item.jobId, {
        total,
        skipped,
        done: 0,
        failed: 0,
      });

      if (!toUpload.length) {
        updateJob(item.jobId, { status: 'done', done: 0, failed: 0, skipped });
        toast.success(
          skipped
            ? `Skipped ${skipped} duplicate${skipped === 1 ? '' : 's'} — nothing new to upload`
            : 'Nothing to upload',
        );
        continue;
      }

      try {
        for (let i = 0; i < toUpload.length; i += BATCH) {
          const slice = toUpload.slice(i, i + BATCH);
          const manifest = slice.map((f) => {
            const d = decisions[f.name];
            return {
              name: f.name,
              type: f.type || (f.name.match(/\.(mp4|mov|webm)$/i) ? 'video/mp4' : 'image/jpeg'),
              size: f.size,
              onDuplicate: d?.action === 'replace' ? 'replace' : 'keep_both',
              replacePhotoId: d?.replacePhotoId,
            };
          });

          const reg = await uploadApi.register(galleryId, manifest);
          const items: any[] = reg.data?.items || [];
          // Match by clientRef/filename — never by array index (errors shift positions)
          const byRef = new Map<string, any>();
          for (const it of items) {
            if (it?.clientRef) byRef.set(String(it.clientRef), it);
          }

          const queue = slice.map((file) => ({
            file,
            regItem: byRef.get(file.name) || null,
          }));

          const completedIds: string[] = [];
          let cursor = 0;

          const worker = async () => {
            while (cursor < queue.length) {
              const my = cursor++;
              const entry = queue[my];
              if (!entry) continue;
              const { file, regItem } = entry;

              if (!regItem?.uploadUrl || regItem.error) {
                failed++;
                errors.push({
                  name: file.name,
                  error: regItem?.error || 'register_failed',
                });
                done++;
                updateJob(item.jobId, { done, failed, errors: [...errors] });
                continue;
              }

              try {
                await putWithRetry(regItem.uploadUrl, file, 2);
                completedIds.push(regItem.photoId);
              } catch (e: any) {
                failed++;
                errors.push({ name: file.name, error: e.message || 'upload_failed' });
              }
              done++;
              updateJob(item.jobId, { done, failed, errors: [...errors] });
            }
          };

          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
          );

          // Confirm in batches so incomplete PUTs don't leave ghost REGISTERED rows forever
          for (let c = 0; c < completedIds.length; c += 25) {
            const batch = completedIds.slice(c, c + 25);
            try {
              await completeWithRetry(galleryId, batch, 3);
            } catch (e: any) {
              // Mark these as failed in progress (files may be on S3 — admin can re-queue later)
              for (const pid of batch) {
                const match = queue.find((q) => q.regItem?.photoId === pid);
                failed++;
                errors.push({
                  name: match?.file?.name || pid,
                  error: e.message || 'complete_failed',
                });
              }
              updateJob(item.jobId, { failed, errors: [...errors] });
            }
          }
        }

        const okCount = Math.max(0, total - failed);
        updateJob(item.jobId, {
          status: failed === total ? 'error' : 'done',
          done,
          failed,
          skipped,
          errors,
        });

        const parts: string[] = [];
        if (okCount) parts.push(`${okCount} uploaded`);
        if (skipped) parts.push(`${skipped} skipped`);
        if (failed) parts.push(`${failed} failed`);
        if (failed === total) {
          toast.error(parts.join(' · ') || 'Upload failed');
        } else {
          toast.success(`${parts.join(' · ')} — processing…`);
        }
      } catch (e: any) {
        updateJob(item.jobId, {
          status: 'error',
          errors: [{ name: 'batch', error: e.message || 'Upload failed' }],
        });
        toast.error(e.message || 'Upload failed');
      }
    }
    running.current = false;
  }, [updateJob]);

  const enqueue = useCallback(
    async (opts: EnqueueOptions) => {
      if (!opts.files?.length) return;
      const id = newId();
      const decisions = opts.decisions || {};
      const willUpload = opts.files.filter((f) => decisions[f.name]?.action !== 'skip').length;
      const willSkip = opts.files.length - willUpload;
      const job: UploadJob = {
        id,
        galleryId: opts.galleryId,
        galleryName: opts.galleryName || 'Gallery',
        total: willUpload,
        done: 0,
        failed: 0,
        skipped: willSkip,
        status: 'queued',
        errors: [],
        startedAt: Date.now(),
      };
      setJobs((prev) => [job, ...prev].slice(0, 20));
      queueRef.current.push({
        jobId: id,
        galleryId: opts.galleryId,
        galleryName: opts.galleryName || 'Gallery',
        files: opts.files,
        decisions,
      });
      processQueue();
    },
    [processQueue],
  );

  const checkDuplicates = useCallback(async (galleryId: string, files: File[]) => {
    // Chunk large selections so the API stays under validation limits
    const names = files.map((f) => f.name);
    const CHUNK = 400;
    const all: { name: string; existing: { id: string; filename: string } | null }[] = [];
    for (let i = 0; i < names.length; i += CHUNK) {
      const slice = names.slice(i, i + CHUNK);
      const res = await uploadApi.checkDuplicates(galleryId, slice);
      const conflicts = (res.data?.conflicts || []) as {
        name: string;
        existing: { id: string; filename: string } | null;
      }[];
      all.push(...conflicts);
    }
    return all;
  }, []);

  const dismissJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === 'queued' || j.status === 'running'));
  }, []);

  const active = useMemo(
    () => jobs.find((j) => j.status === 'running' || j.status === 'queued') || null,
    [jobs],
  );

  const totals = useMemo(() => {
    const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
    if (!activeJobs.length) {
      const last = jobs[0];
      if (last && (last.status === 'done' || last.status === 'error')) {
        return {
          done: last.done,
          total: last.total,
          left: 0,
          failed: last.failed,
          skipped: last.skipped || 0,
        };
      }
      return { done: 0, total: 0, left: 0, failed: 0, skipped: 0 };
    }
    const total = activeJobs.reduce((s, j) => s + j.total, 0);
    const done = activeJobs.reduce((s, j) => s + j.done, 0);
    const failed = activeJobs.reduce((s, j) => s + j.failed, 0);
    const skipped = activeJobs.reduce((s, j) => s + (j.skipped || 0), 0);
    return { done, total, left: Math.max(0, total - done), failed, skipped };
  }, [jobs]);

  const value = useMemo(
    () => ({ jobs, active, totals, enqueue, checkDuplicates, dismissJob, clearFinished }),
    [jobs, active, totals, enqueue, checkDuplicates, dismissJob, clearFinished],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUploadQueue() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUploadQueue must be used within UploadQueueProvider');
  return ctx;
}

/** Floating bottom-right counter while uploads run. */
export function UploadHud() {
  const { active, totals, jobs, clearFinished } = useUploadQueue();
  const [open, setOpen] = useState(false);

  if (!active && !jobs.some((j) => j.status === 'done' || j.status === 'error')) return null;

  const show = active || jobs[0];
  if (!show) return null;

  const label = active
    ? `${totals.done} / ${totals.total} uploaded · ${totals.left} left${
        totals.skipped ? ` · ${totals.skipped} skipped` : ''
      }`
    : jobs[0]?.status === 'done'
      ? `Done · ${jobs[0].done}/${jobs[0].total}${jobs[0].skipped ? ` · ${jobs[0].skipped} skipped` : ''}`
      : jobs[0]?.status === 'error'
        ? `Failed · ${jobs[0].failed} errors`
        : null;

  if (!label) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[80] max-w-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-2xl shadow-lg border px-4 py-3 text-left w-full"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--line)',
          color: 'var(--ink)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.14)',
        }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
          {active ? 'Uploading in background' : 'Upload'}
        </div>
        <div className="text-[14px] font-semibold mt-0.5">{label}</div>
        {active && totals.total > 0 && (
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-sunken)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round((totals.done / totals.total) * 100)}%`,
                background: 'var(--ink)',
              }}
            />
          </div>
        )}
      </button>
      {open && (
        <div
          className="mt-2 rounded-2xl border p-3 text-[12px] max-h-56 overflow-auto"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink-2)' }}
        >
          {jobs.slice(0, 5).map((j) => (
            <div key={j.id} className="py-1.5 border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
              <div className="font-medium" style={{ color: 'var(--ink)' }}>
                {j.galleryName}
              </div>
              <div>
                {j.status} · {j.done}/{j.total}
                {j.skipped ? ` · ${j.skipped} skipped` : ''}
                {j.failed ? ` · ${j.failed} failed` : ''}
              </div>
            </div>
          ))}
          <button type="button" className="mt-2 underline" onClick={() => clearFinished()}>
            Clear finished
          </button>
        </div>
      )}
    </div>
  );
}
