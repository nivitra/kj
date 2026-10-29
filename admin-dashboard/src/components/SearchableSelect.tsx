'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export type SearchableOption = {
  value: string;
  label: string;
  /** Extra text matched in search (email, phone, …) */
  keywords?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  /** Empty / clear option label */
  emptyLabel?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
  name?: string;
  /** Hint under field */
  hint?: string;
};

/**
 * Native text input + filtered list so iPad/iOS keyboard always opens.
 * Avoids bare <select> which only shows the wheel picker on tablet.
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Search…',
  emptyLabel = '— None —',
  allowEmpty = true,
  disabled = false,
  className = '',
  name,
  hint,
}: Props) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  const [query, setQuery] = useState(selected?.label || '');
  const [open, setOpen] = useState(false);

  // Keep input label in sync when value changes externally
  useEffect(() => {
    const s = options.find((o) => o.value === value);
    setQuery(s?.label || (value ? value : ''));
  }, [value, options]);

  useEffect(() => {
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    return options
      .filter((o) => {
        const hay = `${o.label} ${o.keywords || ''} ${o.value}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 80);
  }, [options, query]);

  const pick = (v: string, label: string) => {
    onChange(v);
    setQuery(label);
    setOpen(false);
    // blur after pick so keyboard can dismiss cleanly on iOS
    inputRef.current?.blur();
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="search"
        name={name}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={disabled}
        className="input w-full"
        style={{ fontSize: 16 }} /* iOS: <16px can block keyboard / force zoom */
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // Clear selection if user edits text away from selected label
          if (value && e.target.value !== selected?.label) {
            onChange('');
          }
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        role="combobox"
      />
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>
          {hint}
        </p>
      )}
      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl border shadow-lg"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--line)',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {allowEmpty && (
            <li>
              <button
                type="button"
                role="option"
                className="w-full text-left px-3 py-2.5 text-[14px]"
                style={{ color: 'var(--ink-3)' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick('', emptyLabel)}
              >
                {emptyLabel}
              </button>
            </li>
          )}
          {filtered.length === 0 && (
            <li className="px-3 py-2.5 text-[13px]" style={{ color: 'var(--ink-3)' }}>
              No matches
            </li>
          )}
          {filtered.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className="w-full text-left px-3 py-2.5 text-[14px]"
                style={{
                  background: o.value === value ? 'var(--surface-sunken)' : 'transparent',
                  color: 'var(--ink)',
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.value, o.label)}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
