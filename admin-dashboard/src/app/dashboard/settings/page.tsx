'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/lib/store';
import { portalApi } from '@/lib/api';
import {
  applyTheme,
  useUiStore,
  type ColorTheme,
  type ThemeMode,
  type SidebarDensity,
} from '@/lib/ui-store';
import { Check, Monitor, Moon, Sun, Smartphone } from 'lucide-react';

const COLOR_THEMES: {
  id: ColorTheme;
  label: string;
  blurb: string;
  swatches: string[];
}[] = [
  {
    id: 'zinc',
    label: 'Zinc',
    blurb: 'Neutral · Linear / Vercel',
    swatches: ['#FAFAFA', '#E4E4E7', '#52525B', '#18181B'],
  },
  {
    id: 'stone',
    label: 'Stone',
    blurb: 'Warm · craft / studio',
    swatches: ['#FAFAF9', '#E7E5E4', '#B45309', '#1C1917'],
  },
  {
    id: 'slate',
    label: 'Slate',
    blurb: 'Cool · GitHub / ops',
    swatches: ['#F8FAFC', '#E2E8F0', '#2563EB', '#0F172A'],
  },
];

const APP_THEMES = [
  {
    id: 'warm',
    label: 'Warm',
    blurb: 'Editorial paper · photography',
    swatches: ['#FBFAF8', '#EAE6DE', '#8B6914', '#1A1917'],
  },
  {
    id: 'zinc',
    label: 'Zinc',
    blurb: 'Clean neutral greys',
    swatches: ['#FAFAFA', '#E4E4E7', '#18181B', '#18181B'],
  },
  {
    id: 'stone',
    label: 'Stone',
    blurb: 'Warm amber accent',
    swatches: ['#FAFAF9', '#E7E5E4', '#B45309', '#1C1917'],
  },
  {
    id: 'slate',
    label: 'Slate',
    blurb: 'Cool blue accent',
    swatches: ['#F8FAFC', '#E2E8F0', '#2563EB', '#0F172A'],
  },
] as const;

const MODES: { id: ThemeMode; label: string; icon: React.ElementType }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'Auto', icon: Monitor },
];

const APP_MODES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Auto (device)' },
] as const;

export default function SettingsPage() {
  const admin = useAuthStore((s) => s.admin);
  const qc = useQueryClient();
  const theme = useUiStore((s) => s.theme);
  const colorTheme = useUiStore((s) => s.colorTheme);
  const sidebarDensity = useUiStore((s) => s.sidebarDensity);
  const setTheme = useUiStore((s) => s.setTheme);
  const setColorTheme = useUiStore((s) => s.setColorTheme);
  const setSidebarDensity = useUiStore((s) => s.setSidebarDensity);

  const { data: profileData } = useQuery({
    queryKey: ['portal-profile'],
    queryFn: () => portalApi.getProfile().then((r) => r.data),
  });
  const profile = profileData?.profile || profileData?.raw || {};

  const [appTheme, setAppTheme] = useState('warm');
  const [appThemeMode, setAppThemeMode] = useState('system');

  useEffect(() => {
    if (profile?.appTheme) setAppTheme(String(profile.appTheme).toLowerCase());
    if (profile?.appThemeMode) setAppThemeMode(String(profile.appThemeMode).toLowerCase());
  }, [profile?.appTheme, profile?.appThemeMode]);

  useEffect(() => {
    applyTheme(theme, colorTheme);
  }, [theme, colorTheme, sidebarDensity]);

  const saveAppTheme = useMutation({
    mutationFn: async (payload: { appTheme?: string; appThemeMode?: string }) => {
      const fd = new FormData();
      if (payload.appTheme) fd.append('appTheme', payload.appTheme);
      if (payload.appThemeMode) fd.append('appThemeMode', payload.appThemeMode);
      return portalApi.saveProfile(fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-profile'] });
      toast.success('Customer app theme saved — clients see it on next open');
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error?.message || e?.response?.data?.error || 'Save failed'),
  });

  const rows = [
    ['Studio', admin?.studio?.name],
    ['Your role', admin?.role],
    ['Signed in as', admin?.email],
  ];

  const pickColor = (id: ColorTheme) => {
    setColorTheme(id);
    applyTheme(useUiStore.getState().theme, id);
  };

  const pickMode = (id: ThemeMode) => {
    setTheme(id);
    applyTheme(id, useUiStore.getState().colorTheme);
  };

  const pickDensity = (d: SidebarDensity) => {
    setSidebarDensity(d);
    applyTheme(useUiStore.getState().theme, useUiStore.getState().colorTheme);
  };

  const pickAppTheme = (id: string) => {
    setAppTheme(id);
    saveAppTheme.mutate({ appTheme: id, appThemeMode });
  };

  const pickAppMode = (id: string) => {
    setAppThemeMode(id);
    saveAppTheme.mutate({ appTheme, appThemeMode: id });
  };

  return (
    <div className="animate-fade-up max-w-3xl">
      <p className="kicker mb-2">Settings</p>
      <h1 className="font-display text-[32px] leading-tight mb-7" style={{ color: 'var(--ink)' }}>
        Workspace
      </h1>

      {/* Admin dashboard appearance (this device) */}
      <div className="card p-6 mb-5">
        <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>
          Admin dashboard appearance
        </h2>
        <p className="text-[13px] mb-5" style={{ color: 'var(--ink-2)' }}>
          Theme for this admin panel only. Stored on this device.
        </p>

        <p
          className="text-[11px] font-semibold uppercase tracking-wider mb-2.5"
          style={{ color: 'var(--ink-3)' }}
        >
          Color theme
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {COLOR_THEMES.map((t) => {
            const on = colorTheme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className="theme-swatch"
                data-active={on}
                onClick={() => pickColor(t.id)}
              >
                <div className="theme-swatch-grid">
                  {t.swatches.map((c) => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {t.label}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                      {t.blurb}
                    </div>
                  </div>
                  {on && (
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
                    >
                      <Check size={14} strokeWidth={2.5} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <p
          className="text-[11px] font-semibold uppercase tracking-wider mb-2.5"
          style={{ color: 'var(--ink-3)' }}
        >
          Mode
        </p>
        <div className="grid grid-cols-3 gap-2 mb-6">
          {MODES.map((m) => {
            const on = theme === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => pickMode(m.id)}
                className="flex flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-[13px] font-medium transition-colors"
                style={{
                  background: on ? 'var(--nav-active-bg)' : 'var(--surface-sunken)',
                  color: on ? 'var(--ink)' : 'var(--ink-2)',
                  border: `1px solid ${on ? 'var(--nav-active-ring)' : 'var(--line)'}`,
                  boxShadow: on ? 'inset 0 0 0 1px var(--nav-active-ring)' : undefined,
                }}
              >
                <Icon size={18} />
                {m.label}
              </button>
            );
          })}
        </div>

        <p
          className="text-[11px] font-semibold uppercase tracking-wider mb-2.5"
          style={{ color: 'var(--ink-3)' }}
        >
          Sidebar density
        </p>
        <div className="flex flex-col gap-2">
          {(
            [
              { id: 'comfortable' as const, label: 'Comfortable (default)' },
              { id: 'compact' as const, label: 'Compact' },
            ] as const
          ).map((d) => (
            <label
              key={d.id}
              className="flex items-center gap-2.5 text-[14px] cursor-pointer"
              style={{ color: 'var(--ink)' }}
            >
              <input
                type="radio"
                name="density"
                checked={sidebarDensity === d.id}
                onChange={() => pickDensity(d.id)}
              />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      {/* Customer app appearance (studio-wide) */}
      <div className="card p-6 mb-5">
        <div className="flex items-start gap-3 mb-1">
          <Smartphone size={18} style={{ color: 'var(--ink-2)', marginTop: 2 }} />
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Customer app appearance
            </h2>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
              Controls colors in the client app (Home, Profile, packages…). Saved for your whole
              studio — clients pick it up on next open.
              {saveAppTheme.isPending ? ' · Saving…' : ''}
            </p>
          </div>
        </div>

        <p
          className="text-[11px] font-semibold uppercase tracking-wider mb-2.5 mt-5"
          style={{ color: 'var(--ink-3)' }}
        >
          App color palette
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {APP_THEMES.map((t) => {
            const on = appTheme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className="theme-swatch"
                data-active={on}
                disabled={saveAppTheme.isPending}
                onClick={() => pickAppTheme(t.id)}
              >
                <div className="theme-swatch-grid">
                  {t.swatches.map((c) => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {t.label}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                      {t.blurb}
                    </div>
                  </div>
                  {on && (
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
                    >
                      <Check size={14} strokeWidth={2.5} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <p
          className="text-[11px] font-semibold uppercase tracking-wider mb-2.5"
          style={{ color: 'var(--ink-3)' }}
        >
          Default light / dark
        </p>
        <div className="grid grid-cols-3 gap-2">
          {APP_MODES.map((m) => {
            const on = appThemeMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={saveAppTheme.isPending}
                onClick={() => pickAppMode(m.id)}
                className="rounded-xl px-3 py-3 text-[13px] font-medium transition-colors"
                style={{
                  background: on ? 'var(--nav-active-bg)' : 'var(--surface-sunken)',
                  color: on ? 'var(--ink)' : 'var(--ink-2)',
                  border: `1px solid ${on ? 'var(--nav-active-ring)' : 'var(--line)'}`,
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="text-[12px] mt-3" style={{ color: 'var(--ink-3)' }}>
          Clients can still toggle dark mode in the app drawer; this sets the studio default.
        </p>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>
          Studio details
        </h2>
        <div className="divide-y" style={{ borderColor: 'var(--line-2)' }}>
          {rows.map(([label, value]) => (
            <div key={label as string} className="flex justify-between py-3 text-sm">
              <span style={{ color: 'var(--ink-2)' }}>{label}</span>
              <span className="font-medium capitalize" style={{ color: 'var(--ink)' }}>
                {typeof value === 'string' ? value.toLowerCase() : value || '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
