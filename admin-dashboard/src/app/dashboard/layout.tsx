'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { applyTheme, useUiStore } from '@/lib/ui-store';
import Sidebar from '@/components/Sidebar';
import ShareLinkButton from '@/components/ShareLinkButton';
import CommandPalette from '@/components/CommandPalette';
import { UploadHud, UploadQueueProvider } from '@/lib/upload-queue';
import Link from 'next/link';
import { Search, Menu, ChevronRight } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenu, setMobileMenu] = useState(false);
  const closeMenu = useCallback(() => setMobileMenu(false), []);
  const section = pathname.split('/')[2];
  const names: Record<string, string> = { clients: 'Clients', galleries: 'Galleries', quotes: 'Quotations', invoices: 'Invoices', bookings: 'Jobs', inquiries: 'Inquiries', selections: 'Editing & selections', messaging: 'Messages', 'service-packages': 'Packages & pricing', payments: 'Confirm payments', settings: 'Settings', templates: 'Inquiry templates', leads: 'Other leads', upload: 'Upload', portfolio: 'Portfolio', studio: 'Studio profile', announcements: 'Announcements', coupons: 'Coupons', team: 'Team', jobs: 'Failed jobs', 'wedding-inquiries': 'Wedding inquiries' };
  const sectionName = names[section] || 'Overview';
  const clientPages: Record<string, string> = { galleries: '/galleries', quotes: '/quotes', invoices: '/invoices', 'service-packages': '/packages', portfolio: '/portfolio', announcements: '/announcements', bookings: '/booking', studio: '/contact' };
  const clientPage = clientPages[section];
  const token = useAuthStore((s) => s.token);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const theme = useUiStore((s) => s.theme);
  const colorTheme = useUiStore((s) => s.colorTheme);
  const sidebarDensity = useUiStore((s) => s.sidebarDensity);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);

  useEffect(() => {
    if (hasHydrated && !token) router.replace('/login');
  }, [token, hasHydrated, router]);

  useEffect(() => {
    applyTheme(theme, colorTheme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const st = useUiStore.getState();
      if (st.theme === 'system') applyTheme('system', st.colorTheme);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, colorTheme, sidebarDensity]);

  if (!hasHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--canvas)' }}>
        <div className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!token) return null;

  return (
    <UploadQueueProvider>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="flex min-h-screen" style={{ background: 'var(--canvas)' }}>
        {mobileMenu && <button type="button" aria-label="Close navigation" className="admin-nav-scrim md:hidden" onClick={closeMenu} />}
        <Sidebar mobileOpen={mobileMenu} onMobileClose={closeMenu} />
        <main inert={mobileMenu || undefined} id="main-content" tabIndex={-1} className="flex-1 overflow-auto min-w-0">
          <div
            className="sticky top-0 z-30 flex items-center justify-between gap-2 px-4 sm:px-8 py-3"
            style={{
              background: 'var(--canvas)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <button type="button" className="btn-ghost md:hidden p-2.5" aria-label="Open navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(true)}><Menu size={20}/></button>
              <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] min-w-0">
                <Link href="/dashboard" className="hidden sm:inline" style={{ color: 'var(--ink-2)' }}>Studio</Link>
                <ChevronRight size={13} className="hidden sm:inline" style={{color:'var(--ink-3)'}}/>
                <Link href={section ? `/dashboard/${section}` : '/dashboard'} className="truncate font-medium">{sectionName}</Link>
                {pathname.split('/').length > 3 && <><ChevronRight size={13}/><span className="hidden sm:inline" style={{color:'var(--ink-2)'}}>Details</span></>}
              </nav>
            </div>
            <div className="flex items-center gap-2">
            {clientPage && <div className="hidden sm:block"><ShareLinkButton path={clientPage} title="Share client page"/></div>}
            <button
              type="button"
              className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] rounded-[6px] transition-colors"
              style={{ color: 'var(--ink-3)' }}
              onClick={() => {
                window.dispatchEvent(
                  new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
                );
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--ink-2)';
                e.currentTarget.style.background = 'var(--surface-sunken)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--ink-3)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Search size={14} strokeWidth={1.75} />
              <span className="hidden sm:inline">Search</span>
              <kbd
                className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded-[4px] font-medium"
                style={{ background: 'var(--surface-sunken)', color: 'var(--ink-3)', border: '1px solid var(--line)' }}
              >
                Ctrl K
              </kbd>
            </button>
            {sidebarCollapsed && (
              <span className="text-[11px] hidden lg:inline" style={{ color: 'var(--ink-3)' }}>
                [ expands menu
              </span>
            )}
            </div>
          </div>
          <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-10">{children}</div>
        </main>
        <UploadHud />
        <CommandPalette />
      </div>
    </UploadQueueProvider>
  );
}
