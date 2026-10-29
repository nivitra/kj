import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Light / dark / follow OS */
export type ThemeMode = 'light' | 'dark' | 'system';
/** Color palette family */
export type ColorTheme = 'zinc' | 'stone' | 'slate';
export type SidebarDensity = 'comfortable' | 'compact';

interface UiStore {
  sidebarCollapsed: boolean;
  theme: ThemeMode;
  colorTheme: ColorTheme;
  sidebarDensity: SidebarDensity;
  openNavGroups: string[];
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (t: ThemeMode) => void;
  setColorTheme: (t: ColorTheme) => void;
  setSidebarDensity: (d: SidebarDensity) => void;
  toggleNavGroup: (id: string) => void;
  setOpenNavGroups: (ids: string[]) => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      theme: 'system',
      colorTheme: 'zinc',
      sidebarDensity: 'comfortable',
      openNavGroups: ['clients', 'content', 'money', 'studio', 'system'],
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setTheme: (t) => set({ theme: t }),
      setColorTheme: (t) => set({ colorTheme: t }),
      setSidebarDensity: (d) => set({ sidebarDensity: d }),
      toggleNavGroup: (id) => {
        const cur = get().openNavGroups;
        set({
          openNavGroups: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
        });
      },
      setOpenNavGroups: (ids) => set({ openNavGroups: ids }),
    }),
    { name: 'admin_ui_prefs' },
  ),
);

/** Resolve whether UI should be dark given mode + OS. */
export function resolveDark(theme: ThemeMode): boolean {
  if (typeof window === 'undefined') return theme === 'dark';
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Apply color theme + light/dark to <html>.
 * Uses data-theme (zinc|stone|slate) + class dark + data-mode (light|dark).
 * Instant — no reload.
 */
export function applyTheme(theme: ThemeMode, colorTheme?: ColorTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const storeColor = colorTheme ?? useUiStore.getState().colorTheme ?? 'zinc';
  const dark = resolveDark(theme);
  root.classList.toggle('dark', dark);
  root.dataset.theme = storeColor;
  root.dataset.mode = dark ? 'dark' : 'light';
  root.dataset.density = useUiStore.getState().sidebarDensity || 'comfortable';

  // Mirror to simple keys for any external tooling / docs
  try {
    localStorage.setItem('theme', storeColor);
    localStorage.setItem('mode', theme === 'system' ? 'auto' : theme);
  } catch {
    /* ignore */
  }
}

export function applyAppearance() {
  const { theme, colorTheme } = useUiStore.getState();
  applyTheme(theme, colorTheme);
}
