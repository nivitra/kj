'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  MessageCircle, QrCode, Wifi, WifiOff, RefreshCw, Send, Users, Plus,
  Pencil, Trash2, Copy, Power, PowerOff, Eye,
} from 'lucide-react';
import { whatsappApi } from '@/lib/api';
import Modal from '@/components/Modal';

type Tab = 'session' | 'templates' | 'send' | 'bulk' | 'logs';

export default function MessagingPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('session');

  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ['wa-status'],
    queryFn: () => whatsappApi.status().then((r) => r.data),
    refetchInterval: (q) => {
      const s = (q.state.data as any)?.session?.status;
      return s === 'QR' || s === 'CONNECTING' ? 2500 : 10000;
    },
  });

  const { data: tplData, refetch: refetchTpl } = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => whatsappApi.templates().then((r) => r.data),
  });

  const { data: msgData, refetch: refetchMsg } = useQuery({
    queryKey: ['wa-messages'],
    queryFn: () => whatsappApi.messages({ limit: 120 }).then((r) => r.data),
    refetchInterval: 6000,
  });

  const { data: campData } = useQuery({
    queryKey: ['wa-campaigns'],
    queryFn: () => whatsappApi.campaigns().then((r) => r.data),
    refetchInterval: 5000,
  });

  const { data: recipData } = useQuery({
    queryKey: ['wa-recipients'],
    queryFn: () => whatsappApi.recipients().then((r) => r.data),
  });

  const session = statusData?.session;
  const templates = tplData?.templates || [];
  const placeholders = statusData?.placeholders || [];
  const triggers = statusData?.triggers || [];
  const messages = msgData?.messages || [];
  const campaigns = campData?.campaigns || [];

  const connect = useMutation({
    mutationFn: () => whatsappApi.connect(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      toast.success('Connecting — scan the QR with WhatsApp on your phone');
      setTab('session');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Connect failed'),
  });

  const disconnect = useMutation({
    mutationFn: (logout: boolean) => whatsappApi.disconnect(logout),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      toast.success('Disconnected');
    },
  });

  const saveSettings = useMutation({
    mutationFn: (data: any) => whatsappApi.updateSettings(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      toast.success('Settings saved');
    },
  });

  const online = session?.online === true || session?.status === 'CONNECTED';
  const quota = session?.quota;
  const statusColor =
    session?.status === 'CONNECTED' ? 'var(--green)'
      : session?.status === 'QR' || session?.status === 'CONNECTING' ? 'var(--amber)'
        : 'var(--ink-3)';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'session', label: 'Connection' },
    { id: 'templates', label: 'Templates' },
    { id: 'send', label: 'Send' },
    { id: 'bulk', label: 'Bulk (≤80/day)' },
    { id: 'logs', label: 'Activity' },
  ];

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <p className="kicker mb-2">Communications</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>
            Messaging
          </h1>
          <p className="text-[14px] mt-1.5" style={{ color: 'var(--ink-2)' }}>
            Baileys WhatsApp Web · typing 15–20s · max <strong>80 messages/day</strong> · outbound only
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div
            className="flex items-center gap-2 rounded-2xl px-4 py-2.5 border"
            style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
          >
            {online ? <Wifi size={16} style={{ color: 'var(--green)' }} /> : <WifiOff size={16} style={{ color: 'var(--ink-3)' }} />}
            <div>
              <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--ink-3)' }}>
                WhatsApp Web
              </div>
              <div className="text-[13px] font-semibold" style={{ color: statusColor }}>
                {session?.status || 'DISCONNECTED'}
                {session?.phoneNumber ? ` · +${session.phoneNumber}` : ''}
              </div>
            </div>
          </div>
          {quota && (
            <div
              className="rounded-2xl px-4 py-2.5 border"
              style={{
                borderColor: quota.exhausted ? 'var(--rose)' : 'var(--line)',
                background: 'var(--surface)',
              }}
            >
              <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--ink-3)' }}>
                Today&apos;s quota
              </div>
              <div
                className="text-[13px] font-semibold"
                style={{ color: quota.exhausted ? 'var(--rose)' : 'var(--ink)' }}
              >
                {quota.used} / {quota.limit} sent · {quota.remaining} left
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="px-4 py-2 rounded-xl text-sm font-semibold border"
            style={{
              background: tab === t.id ? 'var(--ink)' : 'var(--surface)',
              color: tab === t.id ? '#fff' : 'var(--ink)',
              borderColor: 'var(--line)',
            }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'session' && (
        <SessionPanel
          session={session}
          connect={connect}
          disconnect={disconnect}
          saveSettings={saveSettings}
          onRefresh={() => refetchStatus()}
        />
      )}
      {tab === 'templates' && (
        <TemplatesPanel
          templates={templates}
          placeholders={placeholders}
          triggers={triggers}
          onChanged={() => { refetchTpl(); }}
        />
      )}
      {tab === 'send' && (
        <SendPanel
          templates={templates}
          online={online}
          quota={quota}
          onSent={() => {
            refetchMsg();
            refetchStatus();
          }}
        />
      )}
      {tab === 'bulk' && (
        <BulkPanel
          templates={templates}
          online={online}
          quota={quota}
          recipients={recipData || {}}
          campaigns={campaigns}
          onSent={() => {
            refetchMsg();
            refetchStatus();
            qc.invalidateQueries({ queryKey: ['wa-campaigns'] });
          }}
        />
      )}
      {tab === 'logs' && <LogsPanel messages={messages} campaigns={campaigns} />}
    </div>
  );
}

function SessionPanel({ session, connect, disconnect, saveSettings, onRefresh }: any) {
  const [autoSend, setAutoSend] = useState(true);
  const [minMs, setMinMs] = useState(15000);
  const [maxMs, setMaxMs] = useState(20000);
  const [dailyLimit, setDailyLimit] = useState(80);

  useEffect(() => {
    if (!session) return;
    setAutoSend(session.autoSendEnabled !== false);
    setMinMs(session.typingMinMs ?? 15000);
    setMaxMs(session.typingMaxMs ?? 20000);
    setDailyLimit(Math.min(80, session.dailyTouchpointLimit ?? 80));
  }, [session]);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-3">
          <QrCode size={16} style={{ color: 'var(--ink-2)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Link WhatsApp Web</h2>
        </div>
        <p className="text-[13px] mb-4" style={{ color: 'var(--ink-2)' }}>
          Click <strong>Connect</strong>, then open WhatsApp on your phone → Linked devices → Link a device,
          and scan the QR below. Session is stored on the server so you stay logged in after restarts.
        </p>
        <p className="text-[12px] mb-4 rounded-xl px-3 py-2" style={{ color: 'var(--ink-2)', background: 'var(--canvas)', border: '1px solid var(--line)' }}>
          If people see <strong>Waiting for this message</strong>, the studio phone must stay online.
          Prefer <strong>Log out</strong> + re-scan once after major phone changes. New sends re-establish
          Signal sessions and store exact content for WhatsApp decrypt retries.
        </p>

        <div className="flex flex-wrap gap-2 mb-5">
          <button
            type="button"
            className="btn-primary flex items-center gap-2 px-4 py-2"
            disabled={connect.isPending}
            onClick={() => connect.mutate()}
          >
            <Power size={15} />
            {connect.isPending ? 'Starting…' : session?.status === 'CONNECTED' ? 'Reconnect' : 'Connect / show QR'}
          </button>
          <button type="button" className="btn-ghost flex items-center gap-2 px-3 py-2" onClick={onRefresh}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            type="button"
            className="btn-ghost flex items-center gap-2 px-3 py-2"
            style={{ color: 'var(--rose)' }}
            onClick={() => disconnect.mutate(false)}
          >
            <PowerOff size={15} /> Disconnect
          </button>
          <button
            type="button"
            className="btn-ghost flex items-center gap-2 px-3 py-2"
            style={{ color: 'var(--rose)' }}
            onClick={() => {
              if (confirm('Log out WhatsApp completely? You will need to scan QR again.')) {
                disconnect.mutate(true);
              }
            }}
          >
            Log out
          </button>
        </div>

        <div
          className="rounded-2xl border flex items-center justify-center min-h-[280px] p-4"
          style={{ borderColor: 'var(--line)', background: 'var(--canvas)' }}
        >
          {session?.qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.qrDataUrl} alt="WhatsApp QR" width={260} height={260} className="rounded-xl" />
          ) : session?.status === 'CONNECTED' ? (
            <div className="text-center">
              <MessageCircle size={36} style={{ color: 'var(--green)' }} className="mx-auto mb-2" />
              <div className="font-semibold" style={{ color: 'var(--ink)' }}>Online</div>
              <div className="text-sm mt-1" style={{ color: 'var(--ink-2)' }}>
                {session.displayName || 'WhatsApp'} · +{session.phoneNumber}
              </div>
            </div>
          ) : (
            <div className="text-sm text-center px-6" style={{ color: 'var(--ink-3)' }}>
              No QR yet — press Connect to generate one.
              {session?.lastError ? (
                <div className="mt-2 text-[12px]" style={{ color: 'var(--rose)' }}>{session.lastError}</div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Send behaviour</h2>
        <label className="flex items-center gap-3 text-[13px]" style={{ color: 'var(--ink)' }}>
          <input
            type="checkbox"
            checked={autoSend}
            onChange={(e) => setAutoSend(e.target.checked)}
          />
          Auto-send templates on events (guest QR, invoices, bookings, enquiries)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Typing min (ms)</div>
            <input className="input w-full" type="number" min={12000} max={30000} value={minMs} onChange={(e) => setMinMs(Number(e.target.value))} />
          </div>
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Typing max (ms)</div>
            <input className="input w-full" type="number" min={12000} max={35000} value={maxMs} onChange={(e) => setMaxMs(Number(e.target.value))} />
          </div>
        </div>
        <div>
          <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Daily message limit (max 80)</div>
          <input
            className="input w-full"
            type="number"
            min={1}
            max={80}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(Math.min(80, Math.max(1, Number(e.target.value) || 80)))}
          />
        </div>
        <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
          Typing shows as “composing…” for 15–20s (refreshed so WhatsApp keeps the indicator), then send.
          Hard cap <strong>80 outbound messages per UTC day</strong>. Replies are ignored.
        </p>
        {session?.quota && (
          <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: 'var(--surface-sunken)' }}>
            Used today: <strong>{session.quota.used}</strong> / {session.quota.limit}
            {' · '}
            Unique recipients: {session.quota.uniqueRecipientsToday}
            {session.quota.exhausted ? (
              <span style={{ color: 'var(--rose)' }}> · Limit reached</span>
            ) : null}
          </div>
        )}
        <button
          type="button"
          className="btn-primary px-4 py-2"
          onClick={() =>
            saveSettings.mutate({
              autoSendEnabled: autoSend,
              typingMinMs: minMs,
              typingMaxMs: maxMs,
              dailyTouchpointLimit: dailyLimit,
            })
          }
        >
          Save settings
        </button>

        <div className="pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink-2)' }}>Status detail</div>
          <dl className="text-[13px] space-y-1.5" style={{ color: 'var(--ink-2)' }}>
            <div className="flex justify-between gap-4">
              <dt>State</dt>
              <dd style={{ color: 'var(--ink)' }}>{session?.status || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Number</dt>
              <dd style={{ color: 'var(--ink)' }}>{session?.phoneNumber ? `+${session.phoneNumber}` : '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Last connected</dt>
              <dd style={{ color: 'var(--ink)' }}>
                {session?.lastConnectedAt ? new Date(session.lastConnectedAt).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

function TemplatesPanel({ templates, placeholders, triggers, onChanged }: any) {
  const [edit, setEdit] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState('');

  const blank = {
    name: '',
    key: '',
    body: 'Hi {{name}},\n\n{{message}}\n\n— {{studioName}}',
    description: '',
    category: 'GENERAL',
    trigger: '',
    active: true,
  };
  const [form, setForm] = useState<any>(blank);

  const openEdit = (t: any) => {
    setCreating(false);
    setEdit(t);
    setForm({
      name: t.name,
      key: t.key,
      body: t.body,
      description: t.description || '',
      category: t.category || 'GENERAL',
      trigger: t.trigger || '',
      active: t.active,
    });
    setPreview('');
  };

  const openCreate = () => {
    setCreating(true);
    setEdit({});
    setForm(blank);
    setPreview('');
  };

  const save = useMutation({
    mutationFn: async () => {
      if (creating) {
        return whatsappApi.createTemplate({
          name: form.name,
          key: form.key || undefined,
          body: form.body,
          description: form.description || undefined,
          category: form.category,
          trigger: form.trigger || null,
          active: form.active,
        });
      }
      return whatsappApi.updateTemplate(edit.id, {
        name: form.name,
        body: form.body,
        description: form.description || null,
        category: form.category,
        trigger: form.trigger || null,
        active: form.active,
      });
    },
    onSuccess: () => {
      toast.success(creating ? 'Template created' : 'Template saved');
      setEdit(null);
      onChanged();
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Save failed'),
  });

  const del = useMutation({
    mutationFn: (id: string) => whatsappApi.deleteTemplate(id),
    onSuccess: () => {
      toast.success('Removed / deactivated');
      onChanged();
    },
  });

  const doPreview = async () => {
    try {
      const r = await whatsappApi.previewTemplate(form.body);
      setPreview(r.data?.preview || '');
    } catch {
      toast.error('Preview failed');
    }
  };

  const insertPh = (key: string) => {
    setForm((f: any) => ({ ...f, body: `${f.body}{{${key}}}` }));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
          Use placeholders like <code className="text-[12px]">{'{{name}}'}</code>. Auto templates fire when connected.
        </p>
        <button type="button" className="btn-primary flex items-center gap-2 px-3 py-2" onClick={openCreate}>
          <Plus size={15} /> New template
        </button>
      </div>

      <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
        {templates.map((t: any) => (
          <div key={t.id} className="px-5 py-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[14px]" style={{ color: 'var(--ink)' }}>{t.name}</span>
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-3)' }}>
                  {t.key}
                </span>
                {!t.active && <span className="text-[11px]" style={{ color: 'var(--rose)' }}>Off</span>}
                {t.trigger && (
                  <span className="text-[11px]" style={{ color: 'var(--gold)' }}>auto · {t.trigger}</span>
                )}
              </div>
              <p className="text-[12px] mt-1 line-clamp-2 whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>
                {t.body}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button type="button" className="btn-ghost p-2" onClick={() => openEdit(t)} title="Edit">
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="btn-ghost p-2"
                title="Copy body"
                onClick={() => {
                  navigator.clipboard?.writeText(t.body);
                  toast.success('Copied template text');
                }}
              >
                <Copy size={14} />
              </button>
              <button type="button" className="btn-ghost p-2" style={{ color: 'var(--rose)' }} onClick={() => del.mutate(t.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {!templates.length && (
          <div className="py-10 text-center text-sm" style={{ color: 'var(--ink-3)' }}>No templates yet</div>
        )}
      </div>

      <Modal
        open={!!edit}
        onClose={() => !save.isPending && setEdit(null)}
        title={creating ? 'New template' : 'Edit template'}
        preventClose={save.isPending}
        size="xl"
        footer={
          <>
            <button type="button" className="btn-ghost px-3 py-2 flex items-center gap-1" onClick={doPreview}>
              <Eye size={14} /> Preview
            </button>
            <button type="button" className="btn-ghost flex-1 py-2.5" onClick={() => setEdit(null)} disabled={save.isPending}>Cancel</button>
            <button type="button" className="btn-primary flex-1 py-2.5" disabled={!form.name || !form.body || save.isPending} onClick={() => save.mutate()}>
              Save
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <input className="input w-full" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          {creating && (
            <input className="input w-full" placeholder="Key (optional, auto from name)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })} />
          )}
          <input className="input w-full" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <select className="input w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['GENERAL', 'GALLERY', 'BILLING', 'BOOKING', 'LEADS'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select className="input w-full" value={form.trigger || ''} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
              <option value="">Manual only (no auto trigger)</option>
              {triggers.map((t: any) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {placeholders.map((p: any) => (
              <button
                key={p.key}
                type="button"
                className="text-[11px] px-2 py-1 rounded-lg border"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
                onClick={() => insertPh(p.key)}
                title={p.label}
              >
                {`{{${p.key}}}`}
              </button>
            ))}
          </div>
          <textarea
            className="input w-full min-h-[180px] font-mono text-[13px]"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
          {preview && (
            <div className="rounded-xl p-3 text-[13px] whitespace-pre-wrap" style={{ background: 'var(--surface-sunken)', color: 'var(--ink)' }}>
              {preview}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

function SendPanel({ templates, online, onSent, quota }: any) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const exhausted = quota?.exhausted === true;

  const selected = useMemo(
    () => templates.find((t: any) => t.key === templateKey),
    [templates, templateKey],
  );

  useEffect(() => {
    if (selected) setBody(selected.body);
  }, [selected]);

  const send = async () => {
    if (!online) {
      toast.error('WhatsApp is offline');
      return;
    }
    if (exhausted) {
      toast.error(`Daily limit of ${quota.limit} reached`);
      return;
    }
    if (!phone.trim()) {
      toast.error('Enter phone with country code (e.g. 9198…)');
      return;
    }
    setBusy(true);
    try {
      toast('Typing for ~15–20s, then sending…', { duration: 4000 });
      const r = await whatsappApi.send({
        phone: phone.trim(),
        name: name.trim() || undefined,
        templateKey: templateKey || undefined,
        body: templateKey ? undefined : body,
        vars: { name: name.trim() || 'there' },
      });
      const st = r.data?.message?.status;
      if (st === 'SKIPPED') {
        toast.error(r.data?.message?.error || 'Skipped (quota)');
      } else if (st === 'FAILED') {
        toast.error(r.data?.message?.error || 'Send failed');
      } else {
        toast.success(st === 'SENT' ? 'Sent' : 'Queued — typing then send');
      }
      onSent?.();
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-6 max-w-xl space-y-3">
      {!online && (
        <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: 'var(--rose-bg, #fef2f2)', color: 'var(--rose)' }}>
          WhatsApp is offline — connect from the Connection tab first.
        </div>
      )}
      {exhausted && (
        <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: 'var(--rose-bg, #fef2f2)', color: 'var(--rose)' }}>
          Daily limit reached ({quota.used}/{quota.limit}). Wait until tomorrow UTC.
        </div>
      )}
      <input className="input w-full" placeholder="Phone (country code, no +) e.g. 919876543210" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
        10-digit Indian numbers are auto-prefixed with 91 on the server.
      </p>
      <input className="input w-full" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input w-full" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
        <option value="">Custom text</option>
        {templates.filter((t: any) => t.active).map((t: any) => (
          <option key={t.id} value={t.key}>{t.name}</option>
        ))}
      </select>
      <textarea
        className="input w-full min-h-[160px] font-mono text-[13px]"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message body — use {{name}}, {{studioName}}, …"
      />
      <button type="button" className="btn-primary flex items-center gap-2 px-4 py-2.5" disabled={busy || !online || exhausted} onClick={send}>
        <Send size={15} /> {busy ? 'Typing ~15–20s…' : 'Send message'}
      </button>
    </div>
  );
}

function BulkPanel({ templates, online, recipients, campaigns, onSent, quota }: any) {
  const customers = recipients.customers || [];
  const leads = recipients.leads || [];
  const guests = recipients.guests || [];
  const all = useMemo(
    () => [...customers, ...leads, ...guests],
    [customers, leads, guests],
  );

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [templateKey, setTemplateKey] = useState('CUSTOM_MANUAL');
  const [body, setBody] = useState('Hi {{name}},\n\n{{message}}\n\n— {{studioName}}');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const maxPick = Math.min(80, Math.max(0, quota?.remaining ?? 80));
  const exhausted = quota?.exhausted === true || maxPick <= 0;

  const picked = all.filter((r: any) => selected[`${r.type}-${r.id}`]);
  const count = picked.length;

  const toggle = (r: any) => {
    const k = `${r.type}-${r.id}`;
    setSelected((s) => {
      const next = { ...s, [k]: !s[k] };
      const n = Object.values(next).filter(Boolean).length;
      if (n > maxPick) {
        toast.error(`Max ${maxPick} recipients left for today`);
        return s;
      }
      return next;
    });
  };

  const selectAllCustomers = () => {
    const next: Record<string, boolean> = {};
    customers.slice(0, maxPick).forEach((c: any) => {
      next[`customer-${c.id}`] = true;
    });
    setSelected(next);
  };

  const sendBulk = async () => {
    if (!online) return toast.error('WhatsApp offline');
    if (exhausted) return toast.error('Daily limit reached');
    if (!count) return toast.error('Select recipients');
    if (count > maxPick) return toast.error(`Max ${maxPick} today`);
    setBusy(true);
    try {
      const bodyWithMsg = body.replace(/\{\{\s*message\s*\}\}/gi, message || '');
      await whatsappApi.bulk({
        templateKey: templateKey || undefined,
        body: bodyWithMsg,
        name: `Bulk ${new Date().toLocaleString()}`,
        recipients: picked.map((r: any) => ({
          phone: r.phone,
          name: r.name,
          vars: { name: r.name, message },
        })),
      });
      toast.success(`Bulk started for ${count} · ~${Math.round((count * 18) / 60)} min with typing`);
      onSent?.();
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Bulk failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <Users size={15} /> Recipients · {count}/{maxPick} today
          </h2>
          <button type="button" className="text-[12px] underline" onClick={selectAllCustomers} disabled={exhausted}>
            Select customers (≤{maxPick})
          </button>
        </div>
        {quota && (
          <p className="text-[12px] mb-2" style={{ color: quota.exhausted ? 'var(--rose)' : 'var(--ink-3)' }}>
            Daily quota {quota.used}/{quota.limit} · {quota.remaining} remaining
          </p>
        )}
        <div className="max-h-[420px] overflow-auto space-y-1">
          {all.slice(0, 400).map((r: any) => {
            const k = `${r.type}-${r.id}`;
            return (
              <label
                key={k}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] cursor-pointer"
                style={{ background: selected[k] ? 'var(--surface-sunken)' : 'transparent' }}
              >
                <input type="checkbox" checked={!!selected[k]} onChange={() => toggle(r)} />
                <span className="font-medium truncate" style={{ color: 'var(--ink)' }}>{r.name || '—'}</span>
                <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>+{r.phone}</span>
                <span className="ml-auto text-[10px] uppercase" style={{ color: 'var(--ink-3)' }}>{r.type}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="card p-6 space-y-3">
        <select className="input w-full" value={templateKey} onChange={(e) => {
          setTemplateKey(e.target.value);
          const t = templates.find((x: any) => x.key === e.target.value);
          if (t) setBody(t.body);
        }}>
          {templates.filter((t: any) => t.active).map((t: any) => (
            <option key={t.id} value={t.key}>{t.name}</option>
          ))}
        </select>
        <textarea
          className="input w-full min-h-[120px] font-mono text-[13px]"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <textarea
          className="input w-full min-h-[70px]"
          placeholder="Value for {{message}} (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          type="button"
          className="btn-primary flex items-center gap-2 px-4 py-2.5 w-full justify-center"
          disabled={busy || !online || !count || exhausted}
          onClick={sendBulk}
        >
          <Send size={15} />
          {busy ? 'Starting bulk…' : `Send to ${count} people`}
        </button>
        <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
          Sequential: ~15–20s typing each + cool-down. Capped by daily 80-message limit.
        </p>

        {campaigns?.length > 0 && (
          <div className="pt-3 border-t space-y-2" style={{ borderColor: 'var(--line)' }}>
            <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>Recent campaigns</div>
            {campaigns.slice(0, 8).map((c: any) => (
              <div key={c.id} className="text-[12px] flex justify-between gap-2" style={{ color: 'var(--ink-2)' }}>
                <span className="truncate">{c.name || c.id.slice(0, 8)}</span>
                <span>{c.status} · {c.sent}/{c.total}{c.failed ? ` · ${c.failed} fail` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LogsPanel({ messages, campaigns }: any) {
  const [open, setOpen] = useState<any | null>(null);

  const statusColor = (st: string) => (
    st === 'SENT' ? 'var(--green)'
      : st === 'FAILED' ? 'var(--rose)'
        : st === 'TYPING' || st === 'QUEUED' ? 'var(--amber)'
          : 'var(--ink-3)'
  );

  return (
    <div className="space-y-4">
      <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
        <div className="px-5 py-3 flex items-center justify-between gap-3">
          <div className="text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>
            Outbound messages
          </div>
          <div className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
            Click <strong>See message</strong> for the exact text delivered
          </div>
        </div>
        {messages.map((m: any) => {
          const delivery = m.meta?.deliveryStatus;
          const preview = (m.body || '').replace(/\s+/g, ' ').trim();
          return (
            <div key={m.id} className="px-5 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                  {m.toName || '—'} · +{m.toPhone}
                </div>
                <div className="text-[12px] mt-0.5 line-clamp-2 whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>
                  {preview || '—'}
                </div>
                <div className="text-[11px] mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: 'var(--ink-3)' }}>
                  <span>
                    {m.source}
                    {m.templateKey ? ` · ${m.templateKey}` : ''}
                    {' · '}
                    {new Date(m.sentAt || m.createdAt).toLocaleString()}
                  </span>
                  {delivery && (
                    <span style={{ color: delivery === 'READ' ? 'var(--green)' : 'var(--ink-2)' }}>
                      · {delivery}
                    </span>
                  )}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
                    style={{ color: 'var(--ink)' }}
                    onClick={() => setOpen(m)}
                  >
                    <Eye size={12} />
                    See message
                  </button>
                </div>
              </div>
              <div className="text-[11px] font-semibold shrink-0 text-right max-w-[40%]" style={{ color: statusColor(m.status) }}>
                {m.status}
                {m.error ? (
                  <div className="font-normal mt-0.5" style={{ color: 'var(--rose)' }}>{m.error}</div>
                ) : null}
              </div>
            </div>
          );
        })}
        {!messages.length && (
          <div className="py-10 text-center text-sm" style={{ color: 'var(--ink-3)' }}>No messages yet</div>
        )}
      </div>

      {campaigns?.length > 0 && (
        <div className="card p-5">
          <div className="text-[12px] font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>Campaigns</div>
          <div className="space-y-2">
            {campaigns.slice(0, 12).map((c: any) => (
              <div key={c.id} className="text-[12px] flex justify-between gap-2" style={{ color: 'var(--ink-2)' }}>
                <span className="truncate">{c.name || c.id.slice(0, 8)}</span>
                <span>{c.status} · {c.sent}/{c.total}{c.failed ? ` · ${c.failed} fail` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title="Exact message sent"
      >
        {open && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="kicker mb-1">To</div>
                <div style={{ color: 'var(--ink)' }}>
                  {open.toName || '—'} · +{open.toPhone}
                </div>
              </div>
              <div>
                <div className="kicker mb-1">Status</div>
                <div style={{ color: statusColor(open.status) }}>
                  {open.status}
                  {open.meta?.deliveryStatus ? ` · ${open.meta.deliveryStatus}` : ''}
                </div>
              </div>
              <div>
                <div className="kicker mb-1">Source</div>
                <div style={{ color: 'var(--ink-2)' }}>
                  {open.source}{open.templateKey ? ` · ${open.templateKey}` : ''}
                </div>
              </div>
              <div>
                <div className="kicker mb-1">When</div>
                <div style={{ color: 'var(--ink-2)' }}>
                  {new Date(open.sentAt || open.createdAt).toLocaleString()}
                </div>
              </div>
              {open.meta?.waMessageId && (
                <div className="sm:col-span-2">
                  <div className="kicker mb-1">WhatsApp message id</div>
                  <div className="font-mono text-[11px] break-all" style={{ color: 'var(--ink-3)' }}>
                    {open.meta.waMessageId}
                    {open.meta.waJid ? ` · ${open.meta.waJid}` : ''}
                  </div>
                </div>
              )}
              {open.error && (
                <div className="sm:col-span-2">
                  <div className="kicker mb-1">Error</div>
                  <div style={{ color: 'var(--rose)' }}>{open.error}</div>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="kicker">Full message body</div>
                <button
                  type="button"
                  className="text-[12px] font-semibold inline-flex items-center gap-1"
                  style={{ color: 'var(--ink-2)' }}
                  onClick={() => {
                    navigator.clipboard?.writeText(open.body || '');
                    toast.success('Copied message');
                  }}
                >
                  <Copy size={12} /> Copy
                </button>
              </div>
              <pre
                className="rounded-xl p-4 text-[13px] leading-relaxed whitespace-pre-wrap break-words max-h-[50vh] overflow-auto"
                style={{
                  background: 'var(--canvas)',
                  border: '1px solid var(--line)',
                  color: 'var(--ink)',
                  fontFamily: 'inherit',
                }}
              >
                {open.body || '(empty)'}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
