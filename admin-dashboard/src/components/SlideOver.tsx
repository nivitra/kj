'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  preventClose?: boolean;
};

const WIDTH = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-xl',
  xl: 'max-w-2xl',
};

/**
 * Right-side slide-over panel — preferred over blocking modals for create/edit.
 * Esc / backdrop click dismiss (unless preventClose).
 */
export default function SlideOver({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
  preventClose = false,
}: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !preventClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('slideover-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('slideover-open');
    };
  }, [open, onClose, preventClose]);

  if (typeof document === 'undefined' || !open) return null;

  return createPortal(
    <div className="slideover-root fixed inset-0 z-[80] flex justify-end" role="presentation">
      <button
        type="button"
        className="slideover-scrim absolute inset-0 border-0 cursor-default"
        aria-label="Close panel"
        onClick={() => !preventClose && onClose()}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`slideover-panel relative h-full w-full ${WIDTH[width]} flex flex-col shadow-2xl`}
        style={{
          background: 'var(--surface)',
          borderLeft: '1px solid var(--line)',
        }}
      >
        <header
          className="flex items-start justify-between gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <div className="min-w-0">
            {title && (
              <h2 id={titleId} className="font-display text-xl leading-tight" style={{ color: 'var(--ink)' }}>
                {title}
              </h2>
            )}
            {description && (
              <p className="text-[13px] mt-1" style={{ color: 'var(--ink-2)' }}>{description}</p>
            )}
          </div>
          {!preventClose && (
            <button
              type="button"
              className="btn-ghost p-2 shrink-0"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
        {footer && (
          <footer
            className="px-5 py-4 flex gap-2 shrink-0"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            {footer}
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  );
}
