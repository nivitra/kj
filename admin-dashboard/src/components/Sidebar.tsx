'use client';
import ShareLinkButton from '@/components/ShareLinkButton';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import {
  LayoutDashboard, Users, Images, Settings, LogOut, Shield, AlertTriangle,
  CheckSquare, Package, Building2, ImageIcon, Megaphone, Inbox,
  TicketPercent, FileText, Receipt, MessageCircle, ChevronDown, PanelLeftClose, PanelLeft,
  Moon, Sun, Briefcase, Heart, X,
} from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { applyTheme, useUiStore, type ColorTheme } from '@/lib/ui-store';

type NavItem = { href: string; label: string; icon: React.ElementType };

/** Primary rail — calm, operational, product-grade */
const primaryNav: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/clients', label: 'Clients', icon: Users },
  { href: '/dashboard/bookings', label: 'Jobs', icon: Briefcase },
  { href: '/dashboard/inquiries', label: 'Inquiries', icon: Heart },
  { href: '/dashboard/galleries', label: 'Galleries', icon: Images },
  { href: '/dashboard/quotes', label: 'Quotations', icon: FileText },
  { href: '/dashboard/invoices', label: 'Invoices', icon: Receipt },
  { href: '/dashboard/selections', label: 'Editing & selections', icon: CheckSquare },
  { href: '/dashboard/messaging', label: 'Messages', icon: MessageCircle },
];

const moreItems: NavItem[] = [
  { href: '/dashboard/service-packages', label: 'Packages & pricing', icon: Package },
  { href: '/dashboard/payments', label: 'Confirm payments', icon: Receipt },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },

  { href: '/dashboard/templates', label: 'Inquiry templates', icon: FileText },
  { href: '/dashboard/leads', label: 'Other leads', icon: Inbox },
  { href: '/dashboard/upload', label: 'Upload', icon: Images },
  { href: '/dashboard/portfolio', label: 'Portfolio', icon: ImageIcon },
  { href: '/dashboard/studio', label: 'Studio profile', icon: Building2 },
  { href: '/dashboard/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/dashboard/coupons', label: 'Coupons', icon: TicketPercent },
  { href: '/dashboard/team', label: 'Team', icon: Shield },
  { href: '/dashboard/jobs', label: 'Failed jobs', icon: AlertTriangle },
];

function PrimaryLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      data-active={active ? 'true' : 'false'}
      className={`nav-link-cc flex items-center gap-2.5 text-[13px] font-medium transition-colors ${
        collapsed ? 'justify-center px-2 py-2.5' : 'pl-3 pr-2.5 py-2'
      }`}
      style={{ color: active ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)' }}
    >
      <Icon size={16} strokeWidth={active ? 2.1 : 1.75} className="shrink-0 opacity-90" />
      {!collapsed && <span className="truncate tracking-[-0.01em]">{item.label}</span>}
    </Link>
  );
}

export default function Sidebar({ mobileOpen = false, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => { onMobileClose?.(); }, [pathname, onMobileClose]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement;
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose?.();
      if (e.key !== 'Tab') return;
      const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a, button:not([disabled])') || []).filter(n => n.getClientRects().length);
      if (!nodes.length) return;
      if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length - 1].focus(); }
      if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) { e.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [mobileOpen, onMobileClose]);
  const { admin, logout } = useAuthStore();
  const {
    sidebarCollapsed: storedCollapsed,
    toggleSidebar,
    theme,
    setTheme,
    colorTheme,
  } = useUiStore();
  const collapsed = mobileOpen ? false : storedCollapsed;
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { if (moreItems.some(item => pathname.startsWith(item.href))) setMoreOpen(true); }, [pathname]);

  useEffect(() => {
    applyTheme(theme, colorTheme);
  }, [theme, colorTheme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === '[' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href));

  const cycleTheme = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
    applyTheme(next, colorTheme as ColorTheme);
  };

  return (
    <aside
      ref={panelRef}
      aria-label="Studio navigation"
      data-mobile-open={mobileOpen}
      className="sidebar flex flex-col h-screen sticky top-0 shrink-0 transition-[width] duration-200 ease-out"
      style={{
        width: collapsed ? 64 : 220,
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--sidebar-border)',
        color: 'var(--sidebar-text)',
      }}
    >
      <button type="button" className="md:hidden flex items-center justify-between px-4 py-3 text-sm font-medium" aria-label="Close navigation" onClick={onMobileClose}>Menu<X size={18}/></button>
      {/* Brand — top-left: logo + SJ Clicks and Films / Studio by Warmkelvin */}
      <div
        className={`shrink-0 ${collapsed ? 'px-2 pt-4 pb-3' : 'px-3.5 pt-4 pb-3.5'}`}
        style={{ borderBottom: '1px solid var(--sidebar-border)' }}
      >
        <Link
          href="/dashboard"
          className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'justify-center' : ''}`}
          title="SJ Clicks and Films"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-square.png"
            alt="SJ Clicks and Films"
            className="w-9 h-9 rounded-[8px] object-cover shrink-0"
            style={{ border: '1px solid var(--sidebar-border)' }}
          />
          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              <div
                className="text-[13px] font-semibold tracking-[-0.02em] leading-[1.2]"
                style={{ color: 'var(--sidebar-text-active)' }}
              >
                SJ Clicks and Films
              </div>
              <div
                className="text-[10.5px] leading-[1.25] mt-0.5 truncate"
                style={{ color: 'var(--ink-3)' }}
              >
                Studio by Warmkelvin
              </div>
            </div>
          )}
        </Link>
      </div>

      <nav className={`flex-1 overflow-y-auto pb-3 space-y-0.5 ${collapsed ? 'px-1.5' : 'px-2'}`}>
        {primaryNav.map((item) => (
          <PrimaryLink
            key={item.href + item.label}
            item={item}
            active={item.href === '/dashboard' ? pathname === '/dashboard' : isActive(item.href)}
            collapsed={collapsed}
          />
        ))}

        <div className="pt-3 mt-2" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
          {!collapsed ? (
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium tracking-wide"
              style={{ color: 'var(--ink-3)' }}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <span>More</span>
              <ChevronDown
                size={13}
                className="transition-transform duration-150"
                style={{ transform: moreOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
              />
            </button>
          ) : (
            <div className="h-px mx-2 my-2" style={{ background: 'var(--sidebar-border)' }} />
          )}
          <div
            className="space-y-0.5 overflow-hidden transition-all duration-150"
            hidden={!(collapsed || moreOpen)}
            style={{
              maxHeight: collapsed || moreOpen ? 640 : 0,
              opacity: collapsed || moreOpen ? 1 : 0,
            }}
          >
            {moreItems.map((item) => (
              <PrimaryLink
                key={item.href + item.label}
                item={item}
                active={isActive(item.href)}
                collapsed={collapsed}
              />
            ))}
          </div>
        </div>
      {!collapsed && <ShareLinkButton path="/app" title="Share app" />}</nav>

      {/* Footer controls */}
      <div className="p-2 space-y-1" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
        <div className={`flex gap-0.5 ${collapsed ? 'flex-col items-center' : ''}`}>
          <button
            type="button"
            className="p-2 rounded-[6px] transition-colors"
            style={{ color: 'var(--sidebar-text)' }}
            onClick={toggleSidebar}
            title={collapsed ? 'Expand ( [ )' : 'Collapse ( [ )'}
          >
            {collapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
          </button>
          <button
            type="button"
            className="p-2 rounded-[6px] transition-colors"
            style={{ color: 'var(--sidebar-text)' }}
            onClick={cycleTheme}
            title={`Mode: ${theme}`}
          >
            {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
          </button>
        </div>
        <div className={`flex items-center gap-2.5 py-1.5 ${collapsed ? 'justify-center px-0' : 'px-2'}`}>
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
            style={{
              background: 'var(--surface-sunken)',
              color: 'var(--sidebar-text-active)',
              border: '1px solid var(--sidebar-border)',
            }}
          >
            {admin?.name?.[0]?.toUpperCase() || 'A'}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium truncate" style={{ color: 'var(--sidebar-text-active)' }}>
                  {admin?.name}
                </div>
                <div className="text-[10px] truncate" style={{ color: 'var(--ink-3)' }}>
                  {admin?.email}
                </div>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                className="p-1.5 rounded-[6px] transition-colors"
                style={{ color: 'var(--sidebar-text)' }}
              >
                <LogOut size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
