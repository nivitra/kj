'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { adminApi } from '@/lib/api';

export default function JobsPage() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['dead-letter-jobs'],
    queryFn: () => adminApi.jobs({ status: 'DEAD_LETTER' }).then((r) => r.data),
    refetchInterval: 20000,
  });

  const replay = useMutation({
    mutationFn: (id: string) => adminApi.replayJob(id),
    onSuccess: () => {
      toast.success('Job requeued');
      qc.invalidateQueries({ queryKey: ['dead-letter-jobs'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.error?.message || 'Replay failed'),
  });

  const jobs = data?.jobs || [];

  return (
    <div className="animate-fade-up max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-[28px]" style={{ color: 'var(--ink)' }}>Dead-letter jobs</h1>
          <p className="text-[14px] mt-1" style={{ color: 'var(--ink-2)' }}>
            Exhausted retries land here. Inspect safe errors and replay when ready.
          </p>
        </div>
        <button onClick={() => refetch()} className="btn-ghost flex items-center gap-2 px-3.5 py-2">
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--ink-3)' }}>Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="p-10 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
            No dead-letter jobs. Queue is healthy.
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {jobs.map((job: any) => (
              <li key={job.id} className="px-5 py-4 flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>{job.jobType}</span>
                    <span className="badge badge-neutral">{job.status}</span>
                    {job.lastErrorCode && (
                      <span className="text-[12px]" style={{ color: 'var(--rose)' }}>{job.lastErrorCode}</span>
                    )}
                  </div>
                  <p className="text-[13px] mt-1" style={{ color: 'var(--ink-2)' }}>
                    {job.lastErrorMessageSafe || 'No message'}
                  </p>
                  <p className="text-[11px] mt-1.5 font-mono" style={{ color: 'var(--ink-3)' }}>
                    {job.idempotencyKey}
                    {job.photoId ? ` · photo ${job.photoId.slice(0, 8)}…` : ''}
                    {job.galleryId ? ` · gallery ${job.galleryId.slice(0, 8)}…` : ''}
                    {' · '}
                    attempts {job.attempts}/{job.maxAttempts}
                    {' · '}
                    {job.updatedAt ? new Date(job.updatedAt).toLocaleString() : ''}
                  </p>
                </div>
                <button
                  onClick={() => replay.mutate(job.id)}
                  disabled={replay.isPending}
                  className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 shrink-0 text-[13px]"
                >
                  <RotateCcw size={14} /> Replay
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
