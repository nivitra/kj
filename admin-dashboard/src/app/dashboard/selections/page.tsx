'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CheckSquare, ChevronRight } from 'lucide-react';
import { adminApi } from '@/lib/api';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'SUBMITTED', label: 'Submitted' },
  { id: 'OPEN', label: 'In progress' },
  { id: 'UNLOCKED', label: 'Unlocked' },
] as const;

const statusClass = (s: string) => {
  if (s === 'SUBMITTED') return 'badge-green';
  if (s === 'UNLOCKED') return 'badge-amber';
  return 'badge-neutral';
};

export default function SelectionsPage() {
  const [status, setStatus] = useState<string>('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['selections', status],
    queryFn: () =>
      adminApi.selections(status ? { status } : undefined).then((r) => r.data),
    staleTime: 10000,
    refetchInterval: 30000,
  });

  const selections = data?.selections || [];

  // Number selections per client chronologically (Selection 1, Selection 2, Selection 3...)
  const clientSelectionMap: Record<string, number> = {};
  const clientCounts: Record<string, number> = {};
  const sorted = [...selections].sort(
    (a, b) => new Date(a.submittedAt || 0).getTime() - new Date(b.submittedAt || 0).getTime()
  );
  for (const s of sorted) {
    const custId = s.customer?.id || 'client';
    clientCounts[custId] = (clientCounts[custId] || 0) + 1;
    clientSelectionMap[s.id] = clientCounts[custId];
  }

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <p className="kicker mb-2">Selections</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>
            Client selections
          </h1>
          <p className="text-[14px] mt-1.5" style={{ color: 'var(--ink-2)' }}>
            Photos clients selected and submitted for fulfillment.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 p-1 rounded-[10px]" style={{ background: 'var(--surface-sunken)' }}>
          {FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              type="button"
              onClick={() => setStatus(f.id)}
              className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold transition-colors"
              style={{
                background: status === f.id ? 'var(--surface)' : 'transparent',
                color: status === f.id ? 'var(--ink)' : 'var(--ink-3)',
                boxShadow: status === f.id ? '0 1px 2px rgba(0,0,0,0.06)' : undefined,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
        {isLoading && (
          <div className="text-center py-14 text-sm" style={{ color: 'var(--ink-3)' }}>Loading…</div>
        )}
        {isError && (
          <div className="text-center py-14 text-sm" style={{ color: 'var(--rose)' }}>
            Could not load selections.{' '}
            <button type="button" className="underline" onClick={() => refetch()}>Retry</button>
          </div>
        )}
        {!isLoading && !isError && selections.length === 0 && (
          <div className="text-center py-14 px-6">
            <CheckSquare size={28} className="mx-auto mb-3" style={{ color: 'var(--ink-3)' }} />
            <div className="text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>No selections yet</div>
            <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
              When a client submits their photo picks, they will show up here.
            </div>
          </div>
        )}
        {selections.map((s: any, idx: number) => {
          const selNum = clientSelectionMap[s.id] || (idx + 1);
          return (
            <Link
              key={s.id}
              href={`/dashboard/selections/${s.id}`}
              className="flex items-center justify-between px-5 py-4 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-[var(--surface-sunken)]"
              style={{ borderColor: 'var(--line-2)' }}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className="w-10 h-10 rounded-[11px] flex items-center justify-center shrink-0 font-semibold text-[13px]"
                  style={{ background: 'var(--surface-sunken)', color: 'var(--ink)' }}
                >
                  #{selNum}
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                    <span className="truncate">
                      Selection {selNum} · {s.customer?.name || 'Client'}
                      <span className="font-normal" style={{ color: 'var(--ink-3)' }}> · {s.gallery?.name}</span>
                    </span>
                    {s.unread && (
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: 'var(--green)' }}
                        aria-label="Unopened"
                      />
                    )}
                  </div>
                  <div className="text-[13px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
                    {s.count} photo{s.count === 1 ? '' : 's'}
                    {s.includedLimit != null || s.estimate?.includedPhotos != null
                      ? ` · ${s.includedLimit ?? s.estimate.includedPhotos} included`
                      : ''}
                    {(s.extraCount || s.estimate?.extraCount) > 0
                      ? ` · ${s.extraCount || s.estimate.extraCount} extras`
                      : ''}
                    {s.submittedAt ? ` · ${new Date(s.submittedAt).toLocaleString()}` : ' · not submitted'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`badge ${statusClass(s.status || '')}`}>
                  {s.status === 'SUBMITTED'
                    ? 'Submitted'
                    : s.status === 'UNLOCKED'
                      ? 'Unlocked'
                      : 'In progress'}
                </span>
                <ChevronRight size={16} style={{ color: 'var(--ink-3)' }} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
