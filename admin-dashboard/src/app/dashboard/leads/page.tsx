'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { portalApi } from '@/lib/api';
import SlideOver from '@/components/SlideOver';

const COLUMNS = [
  { id: 'NEW', label: 'New', dot: '#C47A7A' },
  { id: 'CONTACTED', label: 'Contacted', dot: '#C4A06A' },
  { id: 'WON', label: 'Won', dot: '#6B9B7A' },
  { id: 'LOST', label: 'Lost', dot: '#9A9A96' },
] as const;

function formatSource(raw?: string | null) {
  if (!raw) return 'ENQUIRE';
  return String(raw)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toUpperCase()
    .slice(0, 24);
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Tabular-friendly US-style short date matching product examples
  return d.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

function leadPrimaryLine(l: {
  package?: { title?: string } | null;
  message?: string | null;
  source?: string | null;
}) {
  const msg = (l.message || '').trim();
  if (msg) return msg;
  if (l.package?.title) return l.package.title;
  return '';
}

function leadContactLine(l: {
  customer?: { name?: string; phone?: string; email?: string } | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}) {
  const phone = l.customer?.phone || l.phone || '';
  const email = l.customer?.email || l.email || '';
  if (phone) return phone;
  if (email) return email;
  return '';
}

function leadName(l: {
  customer?: { name?: string } | null;
  name?: string | null;
  phone?: string | null;
}) {
  const n = (l.customer?.name || l.name || '').trim();
  if (n) return n;
  // Guest with only phone — use phone as title so the card still has a primary line
  if (l.phone) return l.phone;
  return 'Guest';
}

export default function LeadsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['portal-leads'],
    queryFn: () => portalApi.leads().then((r) => r.data),
    refetchInterval: 20000,
  });
  const leads = data?.leads || [];

  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; slotAction?: string; adminNote?: string; confirmedDate?: string; confirmedTime?: string }) =>
      portalApi.updateLead(id, body),
    onMutate: async ({ id, status }) => {
      if (!status) return {};
      await qc.cancelQueries({ queryKey: ['portal-leads'] });
      const prev = qc.getQueryData(['portal-leads']);
      qc.setQueryData(['portal-leads'], (old: any) => {
        if (!old?.leads) return old;
        return {
          ...old,
          leads: old.leads.map((l: any) => (l.id === id ? { ...l, status } : l)),
        };
      });
      return { prev };
    },
    onError: (e: any, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['portal-leads'], ctx.prev);
      toast.error(e?.response?.data?.error?.message || e?.response?.data?.error || 'Update failed');
    },
    onSuccess: (res: any, vars) => {
      qc.invalidateQueries({ queryKey: ['portal-leads'] });
      qc.invalidateQueries({ queryKey: ['portal-bookings'] });
      const lead = res?.data?.lead || res?.lead;
      if (lead) setDetail(lead);
      if (vars.slotAction === 'ACCEPT') toast.success('Slot confirmed — locked for client');
      else if (vars.slotAction === 'DECLINE') toast.success('Slot declined — client notified');
    },
  });

  const byCol = useMemo(() => {
    const map: Record<string, any[]> = { NEW: [], CONTACTED: [], WON: [], LOST: [] };
    for (const l of leads) {
      const s = String(l.status || 'NEW').toUpperCase();
      if (map[s]) map[s].push(l);
      else map.NEW.push(l);
    }
    // Stable newest-first within column
    for (const k of Object.keys(map)) {
      map[k].sort(
        (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      );
    }
    return map;
  }, [leads]);

  const onDrop = (status: string) => {
    if (!dragId) return;
    const lead = leads.find((l: any) => l.id === dragId);
    if (lead && String(lead.status || 'NEW').toUpperCase() !== status) {
      update.mutate({ id: dragId, status });
    }
    setDragId(null);
    setOverCol(null);
  };

  return (
    <div className="enquiries-page animate-fade-up">
      <header className="enquiries-header">
        <p className="enquiries-kicker">Clients &amp; workflow</p>
        <h1 className="enquiries-title">Enquiries</h1>
        <p className="enquiries-sub">
          Book requests include a preferred date &amp; time. Accept locks the slot for the client.
          Drag cards to update pipeline status.
        </p>
      </header>

      {isLoading && (
        <div className="enquiries-board">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="enquiries-col skeleton" style={{ minHeight: 280 }} />
          ))}
        </div>
      )}

      {!isLoading && (
        <div className="enquiries-board">
          {COLUMNS.map((col) => {
            const items = byCol[col.id] || [];
            const isOver = overCol === col.id;
            return (
              <section
                key={col.id}
                className={`enquiries-col ${isOver ? 'is-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overCol !== col.id) setOverCol(col.id);
                }}
                onDragLeave={() => {
                  if (overCol === col.id) setOverCol(null);
                }}
                onDrop={() => onDrop(col.id)}
              >
                <div className="enquiries-col-head">
                  <div className="enquiries-col-label">
                    <span className="enquiries-dot" style={{ background: col.dot }} aria-hidden />
                    <span>{col.label}</span>
                  </div>
                  <span className="enquiries-count tabular">{items.length}</span>
                </div>

                <div className="enquiries-col-body">
                  {items.length === 0 ? (
                    <div className="enquiries-empty">
                      {col.id === 'LOST' ? 'Nothing lost yet' : 'No cards'}
                    </div>
                  ) : (
                    items.map((l: any) => {
                      const name = leadName(l);
                      const contact = leadContactLine(l);
                      // Avoid repeating phone as both name and contact line
                      const showContact = contact && contact !== name;
                      const intent = leadPrimaryLine(l);
                      const tag = formatSource(l.source);
                      const date = formatDate(l.createdAt);
                      const dragging = dragId === l.id;

                      return (
                        <article
                          key={l.id}
                          draggable
                          onDragStart={(e) => {
                            setDragId(l.id);
                            e.dataTransfer.effectAllowed = 'move';
                            try {
                              e.dataTransfer.setData('text/plain', l.id);
                            } catch {
                              /* ignore */
                            }
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverCol(null);
                          }}
                          onClick={() => setDetail(l)}
                          className={`enquiries-card ${dragging ? 'is-dragging' : ''}`}
                        >
                          <h3 className="enquiries-card-name">{name}</h3>
                          {showContact && (
                            <p className="enquiries-card-contact tabular">{contact}</p>
                          )}
                          {l.package?.title && (
                            <p className="enquiries-card-intent" style={{ fontWeight: 600 }}>
                              {l.package.title}
                            </p>
                          )}
                          {(l.slotStatus === 'REQUESTED' || l.slotStatus === 'RESCHEDULE_REQUESTED' || l.slotStatus === 'ACCEPTED' || l.requestedSlotLabel || l.slotLabel) && (
                            <p
                              className="enquiries-card-intent"
                              style={{
                                color:
                                  l.slotStatus === 'ACCEPTED'
                                    ? 'var(--green)'
                                    : l.slotStatus === 'DECLINED'
                                      ? 'var(--rose)'
                                      : 'var(--gold)',
                                fontWeight: 600,
                                fontSize: 12,
                              }}
                            >
                              {l.slotStatus === 'ACCEPTED' ? '✓ ' : (l.slotStatus === 'REQUESTED' || l.slotStatus === 'RESCHEDULE_REQUESTED') ? '⏳ ' : ''}
                              {l.confirmedSlotLabel || l.requestedSlotLabel || l.slotLabel}
                              {l.slotStatus === 'REQUESTED' ? ' · needs confirm' : ''}
                              {l.slotStatus === 'RESCHEDULE_REQUESTED' ? ' · reschedule' : ''}
                              {l.slotStatus === 'ACCEPTED' ? ' · final' : ''}
                            </p>
                          )}
                          {intent && !l.package?.title ? (
                            <p className="enquiries-card-intent">{intent}</p>
                          ) : null}
                          <div className="enquiries-card-meta">
                            <span className="enquiries-tag">{tag}</span>
                            {l.slotStatus === 'REQUESTED' && (
                              <span className="enquiries-tag" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>
                                SLOT
                              </span>
                            )}
                            {date ? <span className="enquiries-date tabular">{date}</span> : null}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <SlideOver
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? leadName(detail) : 'Enquiry'}
        description={detail?.package?.title || formatSource(detail?.source)}
        footer={
          detail && (
            <div className="flex flex-col gap-3 w-full">
              {(detail.slotStatus === 'REQUESTED' || detail.slotStatus === 'RESCHEDULE_REQUESTED') && (
                <div className="flex flex-wrap gap-2 w-full">
                  <button
                    type="button"
                    className="btn-primary px-4 py-2.5 text-sm flex-1"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: detail.id, slotAction: 'ACCEPT' })}
                  >
                    Accept slot (final)
                  </button>
                  <button
                    type="button"
                    className="btn-ghost px-4 py-2.5 text-sm flex-1"
                    disabled={update.isPending}
                    onClick={() => {
                      const note = window.prompt('Optional note to client (why declined / suggest other time)') || undefined;
                      update.mutate({ id: detail.id, slotAction: 'DECLINE', adminNote: note });
                    }}
                  >
                    Decline slot
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2 w-full">
                {COLUMNS.map((c) => {
                  const active = String(detail.status || 'NEW').toUpperCase() === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={active ? 'btn-primary px-3 py-2 text-sm' : 'btn-ghost px-3 py-2 text-sm'}
                      onClick={() => {
                        update.mutate({ id: detail.id, status: c.id });
                        setDetail({ ...detail, status: c.id });
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: c.dot }}
                        />
                        {c.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )
        }
      >
        {detail && (
          <div className="space-y-5 text-[14px]">
            <div>
              <div className="enquiries-detail-label">Contact</div>
              <div style={{ color: 'var(--ink)' }}>
                {[detail.customer?.phone || detail.phone, detail.customer?.email || detail.email]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </div>
            </div>
            {detail.package?.title && (
              <div>
                <div className="enquiries-detail-label">Package</div>
                <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{detail.package.title}</div>
              </div>
            )}
            {(detail.slotStatus && detail.slotStatus !== 'NONE') && (
              <div
                className="rounded-xl p-4"
                style={{
                  background:
                    detail.slotStatus === 'ACCEPTED'
                      ? 'color-mix(in srgb, var(--green) 10%, var(--surface))'
                      : detail.slotStatus === 'DECLINED'
                        ? 'color-mix(in srgb, var(--rose) 10%, var(--surface))'
                        : 'color-mix(in srgb, var(--gold) 12%, var(--surface))',
                  border: '1px solid var(--line)',
                }}
              >
                <div className="enquiries-detail-label">Time slot &amp; Schedule</div>
                <div style={{ color: 'var(--ink)', fontWeight: 700, fontSize: 16, marginTop: 4 }}>
                  {detail.confirmedSlotLabel || detail.requestedSlotLabel || detail.slotLabel || '—'}
                </div>
                <p style={{ color: 'var(--ink-2)', fontSize: 12, marginTop: 4 }}>
                  {detail.slotStatus === 'RESCHEDULE_REQUESTED' && 'Client requested to edit/reschedule this slot'}
                  {detail.slotStatus === 'REQUESTED' && 'Client requested initial booking slot'}
                  {detail.slotStatus === 'ACCEPTED' && 'Confirmed session slot'}
                  {detail.slotStatus === 'DECLINED' && (detail.adminNote ? `Declined · ${detail.adminNote}` : 'Declined')}
                </p>
                {detail.rescheduleNote && (
                  <p className="text-[12px] italic mt-1.5" style={{ color: 'var(--ink-3)' }}>
                    Client note: &quot;{detail.rescheduleNote}&quot;
                  </p>
                )}

                <div className="mt-4 pt-3 border-t space-y-3" style={{ borderColor: 'var(--line)' }}>
                  <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Confirm / Edit Shoot Timeslot:</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      className="input text-xs"
                      defaultValue={detail.confirmedDate ? detail.confirmedDate.split('T')[0] : (detail.requestedDate ? detail.requestedDate.split('T')[0] : '')}
                      id={`edit-lead-date-${detail.id}`}
                    />
                    <input
                      type="text"
                      className="input text-xs"
                      placeholder="e.g. 10:00 AM"
                      defaultValue={detail.confirmedTime || detail.requestedTime || '10:00'}
                      id={`edit-lead-time-${detail.id}`}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-primary w-full py-2 text-xs"
                    disabled={update.isPending}
                    onClick={() => {
                      const dateEl = document.getElementById(`edit-lead-date-${detail.id}`) as HTMLInputElement;
                      const timeEl = document.getElementById(`edit-lead-time-${detail.id}`) as HTMLInputElement;
                      const dateVal = dateEl?.value;
                      const timeVal = timeEl?.value || '10:00';
                      update.mutate({
                        id: detail.id,
                        slotAction: 'ACCEPT',
                        confirmedDate: dateVal,
                        confirmedTime: timeVal,
                      });
                    }}
                  >
                    Confirm / Update Shoot Time
                  </button>
                </div>
              </div>
            )}
            {String(detail.status || '').toUpperCase() === 'WON' && (
              <div
                className="rounded-xl p-4 text-[13px] leading-relaxed"
                style={{ background: 'color-mix(in srgb, var(--green) 10%, var(--surface))', border: '1px solid var(--line)' }}
              >
                This enquiry is won. The client booking timeline is live — confirm the shoot slot if you haven’t, then push stages from Bookings.
              </div>
            )}
            {detail.message && (
              <div>
                <div className="enquiries-detail-label">Message</div>
                <p style={{ color: 'var(--ink-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {detail.message}
                </p>
              </div>
            )}
            <div>
              <div className="enquiries-detail-label">Meta</div>
              <p className="tabular" style={{ color: 'var(--ink-2)' }}>
                {formatSource(detail.source)}
                {' · '}
                {detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '—'}
                {' · '}
                {String(detail.status || 'NEW').toUpperCase()}
                {detail.slotStatus && detail.slotStatus !== 'NONE' ? ` · SLOT ${detail.slotStatus}` : ''}
              </p>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
