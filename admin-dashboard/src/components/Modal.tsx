'use client';

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Sticky action row at bottom */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /**
   * dialog — standard card/sheet (default)
   * fullscreen — edge-to-edge overlay (lightbox, PDF viewer)
   */
  variant?: 'dialog' | 'fullscreen';
  /** Close when backdrop clicked (default true) */
  closeOnScrim?: boolean;
  /** Disable all close paths (e.g. while submitting) */
  preventClose?: boolean;
  /** Hide the X button */
  hideClose?: boolean;
  className?: string;
  /** Extra classes on the body region */
  bodyClassName?: string;
  /** Accessible label when title is missing */
  ariaLabel?: string;
};

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-xl',
  xl: 'max-w-2xl',
  full: 'max-w-[min(96vw,1100px)]',
};

let openCount = 0;

function lockBody() {
  openCount += 1;
  if (openCount === 1) {
    const scrollY = window.scrollY;
    document.body.dataset.modalScrollY = String(scrollY);
    document.body.classList.add('modal-open');
    document.body.style.top = `-${scrollY}px`;
  }
}

function unlockBody() {
  openCount = Math.max(0, openCount - 1);
  if (openCount === 0) {
    const y = parseInt(document.body.dataset.modalScrollY || '0', 10);
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    delete document.body.dataset.modalScrollY;
    window.scrollTo(0, y);
  }
}

/**
 * Optimized admin modal: portal, scroll lock, Escape, sticky header/footer,
 * mobile bottom-sheet layout, focus return.
 *
 * Important: onClose / preventClose are read from refs so parent re-renders
 * (e.g. typing in controlled inputs) do NOT re-run this effect and steal focus.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  variant = 'dialog',
  closeOnScrim = true,
  preventClose = false,
  hideClose = false,
  className = '',
  bodyClassName = '',
  ariaLabel,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const preventCloseRef = useRef(preventClose);
  const closeOnScrimRef = useRef(closeOnScrim);
  const isFullscreen = variant === 'fullscreen';

  onCloseRef.current = onClose;
  preventCloseRef.current = preventClose;
  closeOnScrimRef.current = closeOnScrim;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    lockBody();

    // Focus first field only when the modal opens — not on every parent re-render
    const t = window.setTimeout(() => {
      const root = panelRef.current;
      if (!root) return;
      // Prefer first text/number input so forms start in the right place
      const preferred = root.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
      );
      if (preferred) {
        preferred.focus();
        if (preferred instanceof HTMLInputElement || preferred instanceof HTMLTextAreaElement) {
          const len = preferred.value?.length ?? 0;
          try {
            preferred.setSelectionRange(len, len);
          } catch {
            /* type=number may not support selection */
          }
        }
        return;
      }
      const focusable = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      (focusable || root).focus();
    }, 20);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !preventCloseRef.current) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      unlockBody();
      previouslyFocused.current?.focus?.();
    };
  }, [open]); // only re-bind when open flips — never while typing

  if (!open || typeof document === 'undefined') return null;

  const tryClose = () => {
    if (!preventCloseRef.current) onCloseRef.current();
  };

  const onScrimClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && closeOnScrimRef.current) tryClose();
  };

  const showHeader = isFullscreen
    ? title != null || description != null || !hideClose || footer != null
    : title != null || !hideClose;

  return createPortal(
    <div
      className={isFullscreen ? 'modal-scrim modal-scrim--fullscreen' : 'modal-scrim'}
      onClick={onScrimClick}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        aria-label={!title ? ariaLabel || 'Dialog' : undefined}
        tabIndex={-1}
        className={
          isFullscreen
            ? `modal-card modal-card--fullscreen ${className}`
            : `modal-card ${SIZE[size]} ${className}`
        }
        onClick={(e) => e.stopPropagation()}
      >
        {showHeader && (
          <div className={isFullscreen ? 'modal-header modal-header--fullscreen' : 'modal-header'}>
            <div className="min-w-0 flex-1 pr-2">
              {title != null && (
                <h2 id={titleId} className={isFullscreen ? 'modal-title modal-title--fullscreen' : 'modal-title'}>
                  {title}
                </h2>
              )}
              {description != null && (
                <p id={descId} className={isFullscreen ? 'modal-desc modal-desc--fullscreen' : 'modal-desc'}>
                  {description}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isFullscreen && footer}
              {!hideClose && (
                <button
                  type="button"
                  className={isFullscreen ? 'modal-close modal-close--fullscreen' : 'modal-close'}
                  onClick={tryClose}
                  disabled={preventClose}
                  aria-label="Close"
                >
                  <X size={18} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        )}

        {(children != null && children !== false) && (
          <div
            className={
              isFullscreen
                ? `modal-body modal-body--fullscreen ${bodyClassName}`
                : `modal-body ${bodyClassName}`
            }
          >
            {children}
          </div>
        )}

        {!isFullscreen && footer != null && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
