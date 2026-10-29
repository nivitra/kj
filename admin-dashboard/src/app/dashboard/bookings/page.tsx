'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { portalApi, adminApi } from '@/lib/api';
import SearchableSelect from '@/components/SearchableSelect';
import SlideOver from '@/components/SlideOver';

function humanize(s: string) {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeKey(raw: string) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'CUSTOM';
}

/** Client-side fallback if API hasn't returned merged steps yet. */
function mergeFlowClient(
  base: { key: string; label: string; custom?: boolean }[],
  history: any[],
  currentStatus: string,
) {
  const result = (base.length
    ? base
    : []
  ).map((s) => ({ key: s.key, label: s.label, custom: !!s.custom }));

  const findIdx = (raw: string) => {
    const u = String(raw || '').trim().toUpperCase();
    const nk = normalizeKey(raw);
    return result.findIndex(
      (s) => s.key === nk || s.key.toUpperCase() === u || s.label.toUpperCase() === u,
    );
  };

  let cursor = 0;
  for (const h of history || []) {
    const raw = (h?.status ?? h?.key ?? '').toString();
    if (!raw) continue;
    const key = normalizeKey(raw);
    const label = (h.label || raw).toString();
    let idx = findIdx(key);
    if (idx < 0) idx = findIdx(raw);
    if (idx >= 0) {
      cursor = idx + 1;
    } else {
      result.splice(cursor, 0, { key, label, custom: true });
      cursor += 1;
    }
  }

  if (currentStatus) {
    let idx = findIdx(normalizeKey(currentStatus));
    if (idx < 0) idx = findIdx(currentStatus);
    if (idx < 0) {
      result.splice(cursor, 0, {
        key: normalizeKey(currentStatus),
        label: currentStatus.includes('_') ? humanize(currentStatus) : currentStatus,
        custom: true,
      });
    }
  }
  return result;
}

export default function BookingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-bookings'],
    queryFn: () => portalApi.bookings().then((r) => r.data),
  });
  const { data: customersData } = useQuery({
    queryKey: ['customers-for-booking'],
    queryFn: () => adminApi.customers({ limit: 100 }).then((r) => r.data),
  });
  const { data: pkgData } = useQuery({
    queryKey: ['portal-packages'],
    queryFn: () => portalApi.packages().then((r) => r.data),
  });

  const [jobSearch, setJobSearch] = useState('');
  /** '' = all, 'none' = no package, otherwise a service package id */
  const [packageFilter, setPackageFilter] = useState('');

  const bookingPackageIds = (b: any): string[] => {
    const ids = new Set<string>();
    if (b.servicePackageId) ids.add(String(b.servicePackageId));
    if (b.package?.id) ids.add(String(b.package.id));
    for (const j of Array.isArray(b.jobs) ? b.jobs : []) {
      if (j?.packageId) ids.add(String(j.packageId));
    }
    return [...ids];
  };

  const bookings = useMemo(() => {
    const all = data?.bookings || [];
    const q = jobSearch.trim().toLowerCase();
    return all.filter((b: any) => {
      const ids = bookingPackageIds(b);
      if (packageFilter === 'none' && ids.length) return false;
      if (packageFilter && packageFilter !== 'none' && !ids.includes(packageFilter)) return false;
      if (!q) return true;
      const hay = [
        b.customer?.name, b.customer?.phone, b.package?.title, b.status,
        b.confirmedSlotLabel, b.slotStatus, b.notes,
        ...(Array.isArray(b.jobs) ? b.jobs.map((j: any) => j.packageTitle) : []),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [data, jobSearch, packageFilter]);

  const packageCounts = useMemo(() => {
    const all = data?.bookings || [];
    const counts: Record<string, number> = { all: all.length, none: 0 };
    for (const b of all) {
      const ids = bookingPackageIds(b);
      if (!ids.length) counts.none = (counts.none || 0) + 1;
      for (const id of ids) counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  }, [data]);
  const defaultStatuses: string[] = data?.statuses || [];
  const customers = customersData?.customers || [];
  const packages = pkgData?.packages || [];

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [servicePackageId, setServicePackageId] = useState('');
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [activeBooking, setActiveBooking] = useState<any | null>(null);
  const [jobId, setJobId] = useState('');
  const [createJob, setCreateJob] = useState(false);

  const selectedPkg = useMemo(
    () => packages.find((p: any) => p.id === servicePackageId),
    [packages, servicePackageId],
  );

  const stepOptions = useMemo(() => {
    if (selectedPkg?.bookingSteps?.length) {
      return selectedPkg.bookingSteps.map((s: any) => ({
        key: s.key || normalizeKey(s.label || s),
        label: s.label || s.key || s,
      }));
    }
    return (defaultStatuses || []).map((s: string) => ({
      key: s,
      label: humanize(s),
    }));
  }, [selectedPkg, defaultStatuses]);

  const save = useMutation({
    mutationFn: () => {
      if (!customerId) throw new Error('Pick a customer');
      if (activeBooking?.jobs?.length > 1 && !jobId && !createJob) throw new Error('Choose a shoot');
      const payload: any = {
        ...(jobId && !createJob && { jobId }),
        ...(createJob && { createJob: true }),
        status: mode === 'custom' ? status.trim() : (status || stepOptions[0]?.key),
        notes: note || undefined,
      };
      payload.servicePackageId = servicePackageId || null;
      return portalApi.updateBooking(customerId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-bookings'] });
      toast.success(
        createJob ? 'Shoot added with its own timeline' : mode === 'custom'
          ? 'Custom stage added to this client’s flow'
          : 'Booking status updated — client app will show it',
      );
      setOpen(false);
      setNote('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || e.message || 'Failed'),
  });

  const canSave =
    !!customerId &&
    (mode === 'custom' ? status.trim().length > 0 : true) &&
    !save.isPending && (!activeBooking || createJob || !!jobId);

  const openPush = (b?: any, job?: any) => {
    const selected = job || b?.jobs?.[0];
    setJobId(selected?.id || '');
    setCreateJob(!b);
    if (b) {
      setCustomerId(b.customerId || b.customer?.id || '');
      setServicePackageId(selected?.packageId || b.servicePackageId || b.packageId || '');
      setStatus(selected?.status || b.status || '');
      setActiveBooking(b);
    } else {
      setCustomerId('');
      setServicePackageId('');
      setStatus('');
      setActiveBooking(null);
    }
    setNote('');
    setMode('preset');
    setOpen(true);
  };

  const timelineFor = (b: any) => {
    // Prefer server-merged steps (includes customs in the base flow)
    if (Array.isArray(b.steps) && b.steps.length) {
      return b.steps.map((s: any) => ({
        key: s.key || s,
        label: s.label || humanize(String(s.key || s)),
        custom: !!s.custom,
      }));
    }
    const pkg = packages.find((p: any) => p.id === (b.servicePackageId || b.packageId));
    const base = pkg?.bookingSteps?.length
      ? pkg.bookingSteps.map((s: any) => ({
        key: s.key || normalizeKey(s.label || s),
        label: s.label || s.key || s,
        custom: false,
      }))
      : (defaultStatuses || []).map((s: string) => ({ key: s, label: humanize(s), custom: false }));
    return mergeFlowClient(base, b.history || [], String(b.status || ''));
  };

  const indexFor = (steps: { key: string; label: string }[], status: string) => {
    if (typeof (status as any) === 'number') return status as unknown as number;
    const u = String(status || '').toUpperCase();
    const nk = normalizeKey(status);
    const idx = steps.findIndex(
      (s) => s.key === nk || s.key.toUpperCase() === u || s.label.toUpperCase() === u,
    );
    return idx >= 0 ? idx : Math.max(0, steps.length - 1);
  };

  const [slotOpen, setSlotOpen] = useState(false);
  const [slotCustomerId, setSlotCustomerId] = useState('');
  const [slotJobId, setSlotJobId] = useState('');
  const [slotDate, setSlotDate] = useState('');
  const [slotTime, setSlotTime] = useState('10:00');
  const [slotNote, setSlotNote] = useState('');

  const updateSlot = useMutation({
    mutationFn: (override?: { customerId?: string; jobId?: string; date?: string; time?: string; note?: string }) => {
      const customerId = override?.customerId || slotCustomerId;
      const date = override?.date || slotDate;
      const time = override?.time || slotTime;
      const note = override?.note ?? slotNote;
      if (!customerId || !date) throw new Error('Customer and Date required');
      return portalApi.updateBookingTimeslot(customerId, {
        jobId: override?.jobId || slotJobId || undefined,
        confirmedDate: date,
        confirmedTime: time,
        adminNote: note || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-bookings'] });
      qc.invalidateQueries({ queryKey: ['portal-leads'] });
      toast.success('Shoot timeslot saved');
      setSlotOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message || e.message || 'Slot update failed'),
  });

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="kicker mb-2">Clients &amp; workflow</p>
          <h1 className="font-display text-[28px] sm:text-[30px] leading-tight" style={{ color: 'var(--ink)' }}>
            Booking status &amp; Shoot Schedule
          </h1>
          <p className="text-[13px] mt-1.5 max-w-xl leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            Each shoot has its own timeline and schedule. Choose S1, S2, or add another shoot to keep updates separate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input w-56"
            placeholder="Search jobs — name, phone, package…"
            value={jobSearch}
            onChange={(e) => setJobSearch(e.target.value)}
          />
          <button type="button" className="btn-primary px-4 py-2.5" onClick={() => openPush()}>
            Push status
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {([
          { id: '', label: 'All packages', count: packageCounts.all || 0 },
          ...packages.map((p: any) => ({
            id: p.id,
            label: p.title || p.name || 'Package',
            count: packageCounts[p.id] || 0,
          })),
          { id: 'none', label: 'No package', count: packageCounts.none || 0 },
        ] as { id: string; label: string; count: number }[]).map((c) => {
          const on = packageFilter === c.id;
          return (
            <button
              key={c.id || 'all'}
              type="button"
              onClick={() => setPackageFilter(c.id)}
              className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors"
              style={{
                background: on ? 'var(--nav-active-bg)' : 'var(--surface)',
                color: on ? 'var(--ink)' : 'var(--ink-2)',
                border: `1px solid ${on ? 'var(--nav-active-ring)' : 'var(--line)'}`,
                boxShadow: on ? 'inset 0 0 0 1px var(--nav-active-ring)' : undefined,
              }}
            >
              {c.label}
              <span className="ml-1.5 text-[11px]" style={{ color: 'var(--ink-3)' }}>{c.count}</span>
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-5 h-24 skeleton" />
          ))}
        </div>
      )}

      {!isLoading && bookings.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-[15px] font-medium mb-1" style={{ color: 'var(--ink)' }}>
            {packageFilter || jobSearch ? 'No jobs match this filter' : 'No booking updates yet'}
          </p>
          <p className="text-[13px] mb-4" style={{ color: 'var(--ink-3)' }}>
            {packageFilter || jobSearch
              ? 'Try another package, or clear search.'
              : 'Push a stage for a client so their app shows progress.'}
          </p>
          {(packageFilter || jobSearch) ? (
            <button
              type="button"
              className="btn-ghost px-4 py-2.5"
              onClick={() => { setPackageFilter(''); setJobSearch(''); }}
            >
              Show all jobs
            </button>
          ) : (
            <button type="button" className="btn-primary px-4 py-2.5" onClick={() => openPush()}>
              First update
            </button>
          )}
        </div>
      )}

      <div className="jp-list">
        {bookings.map((b: any) => {
          const steps = timelineFor(b);
          const idx = typeof b.stepIndex === 'number' ? b.stepIndex : indexFor(steps, b.status);
          const name = b.customer?.name || 'Client';
          const history = Array.isArray(b.history) ? [...b.history] : [];
          history.sort((a: any, c: any) => {
            const ta = new Date(a?.at || 0).getTime();
            const tb = new Date(c?.at || 0).getTime();
            return ta - tb;
          });

          const headerMeta = [
            b.package?.title || 'Default flow',
            steps[idx]?.custom ? steps[idx].label : null,
            b.updatedAt
              ? new Date(b.updatedAt).toLocaleString('en-US', {
                  month: 'numeric',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · ');

          const secondaryNote = b.notes?.toString()?.trim() || null;

          return (
            <article key={b.customerId || b.id} className="jp-card">
              {/* Job header */}
              <div className="jp-header">
                <div className="jp-header-text">
                  <h2 className="jp-client">{name}</h2>
                  <p className="jp-meta">{headerMeta}</p>
                  {secondaryNote && <p className="jp-secondary">{secondaryNote}</p>}
                  {Array.isArray(b.jobs) && b.jobs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {b.jobs.map((j: any) => (
                        <span
                          key={j.id}
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}
                          title={j.history?.length ? `${j.history.length} updates` : ''}
                        >
                          {j.shootLabel || 'S1'} · {j.packageTitle || 'Job'}
                          {j.status ? ` · ${humanize(String(j.status))}` : ''}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Shoot Timeslot Bar */}
                  {(!b.jobs || b.jobs.length <= 1) && <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg mt-3" style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line)' }}>
                    <div className="flex items-center gap-2 flex-wrap text-[13px]">
                      <span className="font-semibold" style={{ color: 'var(--ink)' }}>Shoot Slot:</span>
                      <span style={{ color: 'var(--ink-2)' }}>
                        {b.confirmedSlotLabel || (b.requestedDate ? `${b.requestedDate.split('T')[0]} ${b.requestedTime || ''}` : 'Not scheduled')}
                      </span>
                      {b.slotStatus === 'RESCHEDULE_REQUESTED' && (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                          Reschedule requested
                        </span>
                      )}
                      {b.slotStatus === 'ACCEPTED' && (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          Confirmed
                        </span>
                      )}
                      {b.rescheduleNote && (
                        <span className="text-[11px] italic" style={{ color: 'var(--ink-3)' }}>
                          Note: &quot;{b.rescheduleNote}&quot;
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {b.slotStatus === 'RESCHEDULE_REQUESTED' && (b.requestedDate || b.confirmedDate) && (
                        <button
                          type="button"
                          className="btn-primary px-3 py-1.5 text-[12px] font-semibold"
                          disabled={updateSlot.isPending}
                          onClick={() => {
                            const customerId = b.customerId || b.customer?.id || '';
                            const date = b.requestedDate
                              ? String(b.requestedDate).split('T')[0]
                              : (b.confirmedDate ? String(b.confirmedDate).split('T')[0] : '');
                            const time = b.requestedTime || b.confirmedTime || '10:00';
                            if (!customerId || !date) return;
                            updateSlot.mutate({ customerId, jobId: b.jobs?.[0]?.id, date, time });
                          }}
                        >
                          Confirm requested slot
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost px-3 py-1.5 text-[12px] flex items-center gap-1.5 font-semibold"
                        onClick={() => {
                          setSlotCustomerId(b.customerId || b.customer?.id || '');
                          setSlotJobId(b.jobs?.[0]?.id || '');
                          setSlotDate(b.confirmedDate ? b.confirmedDate.split('T')[0] : (b.requestedDate ? b.requestedDate.split('T')[0] : ''));
                          setSlotTime(b.confirmedTime || b.requestedTime || '10:00');
                          setSlotNote('');
                          setSlotOpen(true);
                        }}
                      >
                        Edit shoot time
                      </button>
                    </div>
                  </div>}
                </div>
                <button type="button" className="jp-advance" onClick={() => openPush(b)}>
                  Advance stage
                </button>
              </div>

              {/* One timeline per job when the client has parallel services */}
              {(Array.isArray(b.jobs) && b.jobs.length > 0 ? b.jobs : [{ steps, stepIndex: idx, packageTitle: b.package?.title, history }]).map((job: any, ji: number) => {
                const jobSteps = (job.steps && job.steps.length
                  ? job.steps
                  : steps
                ).map((s: any) => ({ key: s.key, label: s.label || humanize(String(s.key || '')), custom: !!s.custom }));
                const jIdx = typeof job.stepIndex === 'number'
                  ? job.stepIndex
                  : jobSteps.findIndex((s: any) => s.key === job.status);
                const safeIdx = jIdx >= 0 ? jIdx : idx;
                return (
                  <div key={job.id || ji} className="mt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
                      <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>
                        {job.shootLabel || `S${ji + 1}`} · {job.packageTitle || 'Job'}
                        {job.status ? ` · ${humanize(String(job.status))}` : ''}
                        <div className="font-normal mt-1">
                          {job.confirmedDate ? `${String(job.confirmedDate).split('T')[0]} ${job.confirmedTime || ''}` : 'Not scheduled'}
                          {job.slotStatus === 'RESCHEDULE_REQUESTED' && ` · Reschedule requested: ${String(job.requestedDate || '').split('T')[0]} ${job.requestedTime || ''}`}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" className="btn-ghost text-xs" onClick={() => openPush(b, job)}>Advance {job.shootLabel || `S${ji + 1}`}</button>
                        <button type="button" className="btn-ghost text-xs" onClick={() => {
                          setSlotCustomerId(b.customerId || b.customer?.id || ''); setSlotJobId(job.id || '');
                          setSlotDate(String(job.requestedDate || job.confirmedDate || '').split('T')[0]);
                          setSlotTime(job.requestedTime || job.confirmedTime || '10:00'); setSlotNote(''); setSlotOpen(true);
                        }}>Edit {job.shootLabel || `S${ji + 1}`} shoot time</button>
                      </div>
                    </div>
                    <div className="jp-timeline-scroll">
                      <div className="jp-timeline" style={{ minWidth: Math.max(jobSteps.length * 108, 320) }}>
                        <div className="jp-rail" aria-hidden>
                          <div className="jp-rail-bg" />
                          <div
                            className="jp-rail-fill"
                            style={{
                              width:
                                jobSteps.length <= 1
                                  ? '100%'
                                  : `${Math.round((Math.max(0, safeIdx) / (jobSteps.length - 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="jp-steps">
                          {jobSteps.map((s: any, i: number) => {
                            const done = i < safeIdx;
                            const current = i === safeIdx;
                            const upcoming = i > safeIdx;
                            return (
                              <div
                                key={`${s.key}-${i}`}
                                className={`jp-step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''} ${upcoming ? 'is-upcoming' : ''}`}
                              >
                                <button
                                  type="button"
                                  className="jp-dot"
                                  aria-label={s.label}
                                  title={s.custom ? `${s.label} (custom)` : s.label}
                                  onClick={() => {
                                    setJobId(job.id || '');
                                    setCreateJob(false);
                                    setCustomerId(b.customerId || b.customer?.id || '');
                                    setServicePackageId(job.packageId || b.servicePackageId || b.packageId || '');
                                    setMode(s.custom ? 'custom' : 'preset');
                                    setStatus(s.custom ? s.label || s.key : s.key);
                                    setActiveBooking(b);
                                    setOpen(true);
                                  }}
                                />
                                <span className="jp-step-label">{s.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* History */}
              {history.length > 0 && (
                <div className="jp-history">
                  <div className="jp-history-label">History</div>
                  <div className="jp-history-chips">
                    {history.map((h: any, i: number) => {
                      const label = h.label || humanize(String(h.status || ''));
                      const date = h.at
                        ? new Date(h.at).toLocaleDateString('en-US', {
                            month: 'numeric',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : '';
                      return (
                        <span key={i} className="jp-chip">
                          <span className="jp-chip-name">{label}</span>
                          {date ? <span className="jp-chip-date"> · {date}</span> : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <SlideOver
        open={open}
        onClose={() => !save.isPending && setOpen(false)}
        title="Push booking status"
        description={
          activeBooking
            ? `Update ${activeBooking.customer?.name || 'client'} — custom stages join the same flow`
            : 'Preset package steps or insert a custom stage into the client flow'
        }
        preventClose={save.isPending}
        footer={
          <>
            <button type="button" className="btn-ghost flex-1 py-2.5" disabled={save.isPending} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary flex-1 py-2.5" disabled={!canSave} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : mode === 'custom' ? 'Add to flow' : 'Push to client'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <SearchableSelect
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              const b = data?.bookings?.find((x: any) => (x.customerId || x.customer?.id) === v);
              setActiveBooking(b || null); setCreateJob(!b); setJobId(b?.jobs?.length === 1 ? b.jobs[0].id : '');
              setServicePackageId(b?.jobs?.length === 1 ? b.jobs[0].packageId || '' : ''); setStatus('');
            }}
            options={customers.map((c: any) => ({
              value: c.id,
              label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}${c.email ? ` · ${c.email}` : ''}`,
              keywords: `${c.phone || ''} ${c.email || ''}`,
            }))}
            placeholder="Search customer…"
            emptyLabel="Select customer…"
            allowEmpty={false}
            hint="Type to search — keyboard opens on iPad"
          />

          {activeBooking && <div className="space-y-2">
            <label className="text-xs font-semibold">Shoot timeline</label>
            <select className="input w-full" aria-label="Shoot timeline" value={createJob ? 'new' : jobId} onChange={e => {
              const adding = e.target.value === 'new'; setCreateJob(adding); setJobId(adding ? '' : e.target.value);
              const job = activeBooking.jobs?.find((j: any) => j.id === e.target.value);
              setServicePackageId(job?.packageId || ''); setStatus(job?.status || '');
            }}>
              <option value="">Choose a shoot</option>
              {(activeBooking.jobs || []).map((j: any, i: number) => <option key={j.id} value={j.id}>{j.shootLabel || `S${i + 1}`} · {j.packageTitle}</option>)}
              <option value="new">Add another shoot with a separate timeline</option>
            </select>
          </div>}

          <SearchableSelect
            value={servicePackageId}
            onChange={(v) => {
              setServicePackageId(v);
              setStatus('');
            }}
            options={packages.map((p: any) => ({
              value: p.id,
              label: `${p.title}${(p.bookingSteps || []).length ? ` · ${p.bookingSteps.length} steps` : ''}`,
              keywords: p.title,
            }))}
            placeholder="Search package for timeline…"
            emptyLabel="No package (default studio flow)"
            allowEmpty
          />

          <div className="flex gap-2 p-1 rounded-[8px]" style={{ background: 'var(--surface-sunken)' }}>
            <button
              type="button"
              className="flex-1 py-2 rounded-[6px] text-[12px] font-medium transition-colors"
              style={{
                background: mode === 'preset' ? 'var(--surface)' : 'transparent',
                color: mode === 'preset' ? 'var(--ink)' : 'var(--ink-3)',
                boxShadow: mode === 'preset' ? '0 1px 2px rgba(0,0,0,0.06)' : undefined,
              }}
              onClick={() => setMode('preset')}
            >
              Package stage
            </button>
            <button
              type="button"
              className="flex-1 py-2 rounded-[6px] text-[12px] font-medium transition-colors"
              style={{
                background: mode === 'custom' ? 'var(--surface)' : 'transparent',
                color: mode === 'custom' ? 'var(--ink)' : 'var(--ink-3)',
                boxShadow: mode === 'custom' ? '0 1px 2px rgba(0,0,0,0.06)' : undefined,
              }}
              onClick={() => setMode('custom')}
            >
              Custom stage
            </button>
          </div>

          {mode === 'preset' ? (
            <select
              className="input"
              value={status || stepOptions[0]?.key || ''}
              onChange={(e) => setStatus(e.target.value)}
            >
              {stepOptions.map((s: any) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          ) : (
            <div>
              <input
                className="input"
                placeholder="e.g. Client approved album design"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              />
              <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--ink-3)' }}>
                Inserts into this client&apos;s existing flow after their current stage — not a new separate timeline.
              </p>
            </div>
          )}

          <textarea
            className="input"
            rows={3}
            placeholder="Note for client (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </SlideOver>

      {/* Edit Shoot Timeslot SlideOver */}
      <SlideOver
        open={slotOpen}
        onClose={() => !updateSlot.isPending && setSlotOpen(false)}
        title="Edit Shoot Date & Time"
        description="Confirm or change shoot timeslot. Updates customer app and sends automatic WhatsApp notification."
        preventClose={updateSlot.isPending}
        footer={
          <>
            <button type="button" className="btn-ghost flex-1 py-2.5" disabled={updateSlot.isPending} onClick={() => setSlotOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={!slotDate || updateSlot.isPending}
              onClick={() => updateSlot.mutate(undefined)}
            >
              {updateSlot.isPending ? 'Saving…' : 'Confirm & Sync Slot'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-[12px] font-semibold mb-1 block" style={{ color: 'var(--ink)' }}>
              Shoot Date
            </label>
            <input
              type="date"
              className="input"
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[12px] font-semibold mb-1 block" style={{ color: 'var(--ink)' }}>
              Shoot Time Slot
            </label>
            <input
              type="text"
              className="input"
              placeholder="e.g. 10:00 AM or 14:30"
              value={slotTime}
              onChange={(e) => setSlotTime(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[12px] font-semibold mb-1 block" style={{ color: 'var(--ink)' }}>
              Note / Message for Client (WhatsApp)
            </label>
            <textarea
              className="input"
              rows={3}
              placeholder="e.g. Shoot confirmed at studio location. Please arrive 10 mins early."
              value={slotNote}
              onChange={(e) => setSlotNote(e.target.value)}
            />
          </div>
        </div>
      </SlideOver>
    </div>
  );
}
