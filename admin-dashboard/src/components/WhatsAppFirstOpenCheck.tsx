'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  MessageCircle, Wifi, WifiOff, CheckCircle2, AlertTriangle, ExternalLink,
} from 'lucide-react';
import Modal from '@/components/Modal';
import { whatsappApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

const sessionKey = (studioId: string) => `wa-dashboard-first-open:${studioId}`;

/**
 * Every time an admin lands on the Command Center for the first time in a
 * browser session, show WhatsApp reliability status + the Baileys checklist
 * so “Waiting for this message” stays rare and recoverable.
 */
export default function WhatsAppFirstOpenCheck() {
  const admin = useAuthStore((s) => s.admin);
  const studioId = admin?.studio?.id || 'default';
  const studioName = admin?.studio?.name || 'Studio';

  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const seen = sessionStorage.getItem(sessionKey(studioId));
      if (!seen) {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
    setReady(true);
  }, [studioId]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['wa-status-dashboard-first'],
    queryFn: () => whatsappApi.status().then((r) => r.data),
    enabled: ready && open,
    staleTime: 15_000,
    refetchInterval: open ? 8_000 : false,
  });

  const session = data?.session;
  const online = session?.online === true || session?.status === 'CONNECTED';
  const phone = session?.phoneNumber ? `+${session.phoneNumber}` : null;

  const checks = useMemo(
    () => [
      {
        ok: online,
        title: 'WhatsApp Web linked',
        detail: online
          ? `${studioName} is online${phone ? ` as ${phone}` : ''}. Single server session active.`
          : 'Offline — connect from Messaging so client messages can send and decrypt.',
      },
      {
        ok: true,
        title: 'getMessage + message store',
        detail:
          'Server stores every outbound message (memory, disk, database) so WhatsApp can retry decrypt when iOS shows “Waiting for this message”.',
      },
      {
        ok: true,
        title: 'No link previews on auto texts',
        detail:
          'Previews are disabled on studio sends — preview media keys are a common cause of permanent waiting bubbles.',
      },
      {
        ok: true,
        title: 'Fresh Signal sessions',
        detail:
          'Before each send we re-assert the recipient session (and clear group sender keys when needed). Keep the studio phone online for first messages.',
      },
    ],
    [online, phone, studioName],
  );

  const dismiss = () => {
    try {
      sessionStorage.setItem(sessionKey(studioId), new Date().toISOString());
    } catch { /* ignore */ }
    setOpen(false);
  };

  if (!ready) return null;

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title={
        <span className="inline-flex items-center gap-2">
          <MessageCircle size={18} strokeWidth={1.75} />
          WhatsApp readiness · {studioName}
        </span>
      }
      description="First open this session — quick check so clients never stay stuck on “Waiting for this message”."
      size="lg"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2 w-full">
          <button type="button" className="btn-ghost px-4 py-2" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Checking…' : 'Recheck status'}
          </button>
          <Link href="/dashboard/messaging" className="btn-ghost px-4 py-2 inline-flex items-center gap-1.5" onClick={dismiss}>
            Messaging
            <ExternalLink size={14} />
          </Link>
          <button type="button" className="btn-primary px-4 py-2" onClick={dismiss}>
            Got it — open dashboard
          </button>
        </div>
      )}
    >
      <div className="space-y-5">
        <div
          className="rounded-xl border px-4 py-3 flex items-start gap-3"
          style={{
            borderColor: online ? 'color-mix(in srgb, var(--green) 35%, var(--line))' : 'color-mix(in srgb, var(--amber) 40%, var(--line))',
            background: online
              ? 'color-mix(in srgb, var(--green) 8%, var(--surface))'
              : 'color-mix(in srgb, var(--amber) 10%, var(--surface))',
          }}
        >
          {online ? (
            <Wifi size={20} style={{ color: 'var(--green)', marginTop: 2 }} />
          ) : (
            <WifiOff size={20} style={{ color: 'var(--amber)', marginTop: 2 }} />
          )}
          <div className="min-w-0">
            <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
              {isLoading ? 'Checking WhatsApp…' : online ? `${studioName} WhatsApp is online` : `${studioName} WhatsApp is offline`}
            </div>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
              {online
                ? 'Baileys can answer decrypt retries. Keep this device’s WhatsApp open in the background when you expect client messages.'
                : 'Connect and scan QR under Messaging → Connection before messaging clients.'}
            </p>
            {session?.lastError && !online && (
              <p className="text-[12px] mt-1" style={{ color: 'var(--rose)' }}>{session.lastError}</p>
            )}
          </div>
        </div>

        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--ink-3)' }}>
            Why clients see “Waiting for this message”
          </p>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            WhatsApp uses Signal encryption. If a phone (especially iOS) can’t decrypt a message, it asks
            {' '}
            <strong style={{ color: 'var(--ink)' }}>{studioName}</strong>
            ’s linked session to resend the original content. If the server lost that content, the bubble stays stuck forever.
          </p>
        </div>

        <ul className="space-y-2.5">
          {checks.map((c) => (
            <li
              key={c.title}
              className="flex gap-3 rounded-xl px-3 py-2.5 border"
              style={{ borderColor: 'var(--line)', background: 'var(--canvas)' }}
            >
              {c.ok ? (
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--green)' }} />
              ) : (
                <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--amber)' }} />
              )}
              <div className="min-w-0">
                <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>{c.title}</div>
                <div className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--ink-2)' }}>{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="rounded-xl px-3 py-2.5 text-[12px] leading-relaxed" style={{ background: 'var(--canvas)', color: 'var(--ink-3)', border: '1px solid var(--line)' }}>
          <strong style={{ color: 'var(--ink-2)' }}>If issues persist:</strong>
          {' '}
          Messaging → Connection → Log out → scan QR again (after phone change / reinstall). Never run two dashboards linked to the same number on different servers. Old stuck bubbles on a client phone cannot be fixed — resend a new message.
        </div>
      </div>
    </Modal>
  );
}
